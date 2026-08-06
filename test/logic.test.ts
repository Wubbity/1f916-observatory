import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildTree, countNodes, modelsInThread } from '../src/lib/tree';
import { familyBreakdown, familyOf, modelColor } from '../src/lib/models';
import { search } from '../src/lib/search';
import { judge } from '../src/lib/witness';
import { cents, relative, utcDay } from '../src/lib/time';
import type { CensusResponse, ChangesResponse, Comment, Thread } from '../src/types';

/** Fixtures are verbatim responses captured from the live API on 2026-08-06. */
function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${name}.json`, import.meta.url)), 'utf8')) as T;
}

const thread88 = fixture<Thread>('post88');
const thread15 = fixture<Thread>('post15');
const changes = fixture<ChangesResponse>('changes');
const census = fixture<CensusResponse>('citizens');

describe('comment threading', () => {
  it('rebuilds a real thread without losing a single comment', () => {
    const roots = buildTree(thread88.comments);
    expect(countNodes(roots)).toBe(thread88.comments.length);
  });

  it('nests replies under their parent', () => {
    const roots = buildTree(thread88.comments);
    const withChildren = roots.filter((node) => node.children.length > 0);
    expect(withChildren.length).toBeGreaterThan(0);

    for (const parent of withChildren) {
      for (const child of parent.children) {
        expect(child.comment.parent_id).toBe(parent.comment.id);
        expect(child.depth).toBe(parent.depth + 1);
      }
    }
  });

  it('promotes orphans to root rather than dropping them', () => {
    // A comment whose parent was moderated out of the thread must still appear.
    const orphan: Comment = {
      ...thread88.comments[0]!,
      id: 999_999,
      parent_id: 888_888, // not present in this thread
    };
    const roots = buildTree([...thread88.comments, orphan]);

    expect(countNodes(roots)).toBe(thread88.comments.length + 1);
    const found = roots.find((node) => node.comment.id === 999_999);
    expect(found?.orphaned).toBe(true);
    expect(found?.depth).toBe(0);
  });

  it('survives a parent cycle without hanging', () => {
    const a: Comment = { ...thread88.comments[0]!, id: 1, parent_id: 2, depth: 0 };
    const b: Comment = { ...thread88.comments[0]!, id: 2, parent_id: 1, depth: 0 };
    expect(() => buildTree([a, b])).not.toThrow();
  });

  it('sorts siblings oldest first', () => {
    const roots = buildTree(thread15.comments);
    for (let i = 1; i < roots.length; i++) {
      expect(roots[i]!.comment.created_at).toBeGreaterThanOrEqual(roots[i - 1]!.comment.created_at);
    }
  });

  it('lists the distinct models in a thread, author first', () => {
    const models = modelsInThread(thread88.comments, thread88.post.author_model);
    expect(models[0]).toBe(thread88.post.author_model);
    expect(new Set(models).size).toBe(models.length);
  });
});

describe('model colouring', () => {
  it('is stable across calls', () => {
    expect(modelColor('claude-opus-5')).toBe(modelColor('claude-opus-5'));
  });

  it('groups variants into the right family', () => {
    expect(familyOf('claude-fable-5').key).toBe('claude');
    expect(familyOf('claude-sonnet-4-5').key).toBe('claude');
    expect(familyOf('deepseek-v4-flash').key).toBe('deepseek');
    expect(familyOf('openai-codex/gpt-5.6-sol').key).toBe('openai');
    expect(familyOf('grok-4').key).toBe('grok');
    expect(familyOf('perplexity-computer').key).toBe('perplexity');
  });

  it('gives unrecognised models a colour anyway', () => {
    expect(modelColor('some-model-nobody-has-seen')).toMatch(/^hsl\(/);
  });

  it('accounts for every citizen in the breakdown', () => {
    const models = census.citizens.map((citizen) => citizen.model);
    const total = familyBreakdown(models).reduce((sum, entry) => sum + entry.count, 0);
    expect(total).toBe(census.citizens.length);
  });

  it('is sorted most populous first', () => {
    const breakdown = familyBreakdown(census.citizens.map((c) => c.model));
    for (let i = 1; i < breakdown.length; i++) {
      expect(breakdown[i - 1]!.count).toBeGreaterThanOrEqual(breakdown[i]!.count);
    }
  });
});

describe('search', () => {
  it('finds a phrase that exists in the corpus', () => {
    const hits = search(changes, 'memory');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => Number.isInteger(hit.postId))).toBe(true);
  });

  it('ranks title matches above comment matches', () => {
    const hits = search(changes, 'memory');
    const firstComment = hits.findIndex((hit) => hit.where === 'comment');
    const lastTitle = hits.map((hit) => hit.where).lastIndexOf('title');
    if (firstComment !== -1 && lastTitle !== -1) expect(lastTitle).toBeLessThan(firstComment);
  });

  it('ignores queries too short to be meaningful', () => {
    expect(search(changes, 'a')).toEqual([]);
    expect(search(changes, ' ')).toEqual([]);
  });

  it('is case-insensitive', () => {
    expect(search(changes, 'MEMORY').length).toBe(search(changes, 'memory').length);
  });

  it('returns an excerpt around the match, not the whole comment', () => {
    const hit = search(changes, 'memory').find((h) => h.where === 'comment');
    expect(hit).toBeDefined();
    expect(hit!.excerpt.length).toBeLessThan(400);
  });
});

describe('the witness', () => {
  const head = (h: string, sealed: number) => ({ head: h, sealed });

  it('records a first sighting without alarming', () => {
    const finding = judge('identity', null, head('abc', 3));
    expect(finding.verdict).toBe('first-sighting');
  });

  it('accepts growth: new sealed entries and a moved head', () => {
    const finding = judge('identity', head('abc', 3), head('def', 5));
    expect(finding.verdict).toBe('appended');
    expect(finding.detail).toContain('2 new sealed');
  });

  it('accepts an unchanged chain', () => {
    expect(judge('identity', head('abc', 3), head('abc', 3)).verdict).toBe('unchanged');
  });

  it('ALARMS when the head moves but nothing was appended', () => {
    const finding = judge('identity', head('abc', 3), head('xyz', 3));
    expect(finding.verdict).toBe('ALARM-REWRITTEN');
  });

  it('ALARMS when the log shrinks', () => {
    const finding = judge('identity', head('abc', 9), head('abc', 4));
    expect(finding.verdict).toBe('ALARM-TRUNCATED');
  });

  it('explains that a genesis head seals nothing', () => {
    const finding = judge('treasury', null, head('0'.repeat(64), 0));
    expect(finding.detail).toContain('genesis');
  });
});

describe('time and money', () => {
  it('formats negative balances with the sign outside the dollar', () => {
    expect(cents(-9000)).toBe('-$90.00');
    expect(cents(100)).toBe('$1.00');
    expect(cents(0)).toBe('$0.00');
  });

  it('groups by UTC day, which is the society’s own unit', () => {
    expect(utcDay(Date.UTC(2026, 7, 6, 23, 59))).toBe('2026-08-06');
    expect(utcDay(Date.UTC(2026, 7, 7, 0, 1))).toBe('2026-08-07');
  });

  it('describes recent timestamps in relative terms', () => {
    const now = Date.UTC(2026, 7, 6, 12, 0);
    expect(relative(now - 30_000, now)).toBe('30s ago');
    expect(relative(now - 5 * 60_000, now)).toBe('5m ago');
    expect(relative(now - 3 * 3_600_000, now)).toBe('3h ago');
    expect(relative(now - 2 * 86_400_000, now)).toBe('2d ago');
  });
});

describe('the corpus itself', () => {
  it('is close enough to the documented ceilings to matter', () => {
    // The API caps /api/changes at 500 comments and 200 posts with no has_more
    // flag, so a full corpus read silently truncates once the society passes
    // them. This test is a tripwire: if the fixture is ever refreshed at or
    // above a cap, the archive view is no longer showing everything.
    expect(changes.comments.length).toBeLessThan(500);
    expect(changes.posts.length).toBeLessThan(200);
  });
});

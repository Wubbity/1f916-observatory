import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { buildTree, countNodes, modelsInThread } from '../src/lib/tree';
import { familyBreakdown, familyOf, modelColor } from '../src/lib/models';
import { search } from '../src/lib/search';
import { judge } from '../src/lib/witness';
import { hiddenPosts, parseModerationLog } from '../src/lib/moderation';
import { findReplies, mentions } from '../src/views/watch';
import { humanCensus } from '../src/lib/humans';
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

describe('the corpus fixture', () => {
  it('is a single pre-fix page, which is what makes it a useful fixture', () => {
    // Captured 2026-08-06, before the society shipped has_more/next_since. It
    // therefore has neither field — which is exactly the shape the client must
    // still degrade against, since we cannot assume every deployment has the
    // fix. getChanges() treats a page with no has_more as complete.
    expect(changes).not.toHaveProperty('has_more');
    expect(changes.comments.length).toBeLessThanOrEqual(500);
  });

  it('search works against a single page as well as a paged corpus', () => {
    // search() takes a structural {posts, comments}, so one page and an
    // assembled corpus are both valid inputs.
    const hits = search({ posts: changes.posts, comments: changes.comments }, 'memory');
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('moderation log parsing', () => {
  const rows = [
    { kind: 'moderation', detail: 'collapsed post 70: naked memecoin shill — only a token address', created_at: 300, citizen: '1f916-agent' },
    { kind: 'moderation', detail: 'unpinned post 27', created_at: 100, citizen: '1f916-agent' },
    { kind: 'moderation', detail: 'bulletin post 109 (cap-exempt, auto-pinned)', created_at: 200, citizen: '1f916-agent' },
    { kind: 'moderation', detail: 'auto-collapsed post 88: reached 5 community flags', created_at: 400, citizen: '1f916-agent' },
    { kind: 'moderation', detail: 'something the maintainer worded differently', created_at: 500, citizen: '1f916-agent' },
  ];

  it('extracts action, post id and public reason', () => {
    const { events } = parseModerationLog(rows);
    const collapse = events.find((e) => e.postId === 70)!;
    expect(collapse.action).toBe('collapsed');
    expect(collapse.reason).toContain('memecoin');
    expect(events.find((e) => e.postId === 27)!.action).toBe('unpinned');
    expect(events.find((e) => e.postId === 109)!.action).toBe('bulletin');
    expect(events.find((e) => e.postId === 88)!.action).toBe('collapsed');
  });

  it('surfaces rows it cannot classify rather than dropping them', () => {
    // The log is prose. If the maintainer rewords a detail, this client must
    // fail visibly — a silent drop is the exact bug this whole feature fixes.
    const { unparsed } = parseModerationLog(rows);
    expect(unparsed).toHaveLength(1);
    expect(unparsed[0]!.detail).toContain('worded differently');
  });

  it('treats a later restore as undoing an earlier collapse', () => {
    const { events } = parseModerationLog([
      { kind: 'moderation', detail: 'collapsed post 5: spam', created_at: 100, citizen: 'a' },
      { kind: 'moderation', detail: 'restored post 5 to visible', created_at: 200, citizen: 'a' },
      { kind: 'moderation', detail: 'collapsed post 6: spam', created_at: 100, citizen: 'a' },
    ]);
    const hidden = hiddenPosts(events);
    expect(hidden.has(5)).toBe(false);
    expect(hidden.has(6)).toBe(true);
  });
});

describe('reply watch', () => {
  const corpus = {
    posts: [
      { id: 1, title: 'my post', author: 'Wubbity' },
      { id: 2, title: 'their post', author: 'stranger' },
    ],
    comments: [
      { id: 10, post_id: 1, parent_id: null, body: 'nice post', author: 'stranger', author_model: 'x', mod_state: null, created_at: 100 },
      { id: 11, post_id: 2, parent_id: null, body: 'my comment', author: 'Wubbity', author_model: 'Human', mod_state: null, created_at: 200 },
      { id: 12, post_id: 2, parent_id: 11, body: 'replying to you', author: 'stranger', author_model: 'x', mod_state: null, created_at: 300 },
      { id: 13, post_id: 2, parent_id: null, body: 'unrelated', author: 'other', author_model: 'x', mod_state: null, created_at: 400 },
      { id: 14, post_id: 1, parent_id: null, body: 'my own follow-up', author: 'Wubbity', author_model: 'Human', mod_state: null, created_at: 500 },
    ] as never[],
  };

  it('finds comments on a watched handle’s post', () => {
    const replies = findReplies(corpus, ['Wubbity']);
    expect(replies.some((r) => r.comment.id === 10 && r.kind === 'post')).toBe(true);
  });

  it('finds direct replies to a watched handle’s comment', () => {
    const replies = findReplies(corpus, ['Wubbity']);
    const direct = replies.find((r) => r.comment.id === 12)!;
    expect(direct.kind).toBe('comment');
    expect(direct.to).toBe('Wubbity');
  });

  it('never reports the watched handle replying to itself', () => {
    const replies = findReplies(corpus, ['Wubbity']);
    expect(replies.some((r) => r.comment.author === 'Wubbity')).toBe(false);
  });

  it('ignores unrelated comments on threads the handle merely visited', () => {
    const replies = findReplies(corpus, ['Wubbity']);
    expect(replies.some((r) => r.comment.id === 13)).toBe(false);
  });

  it('is case-insensitive, matching the schema’s COLLATE NOCASE', () => {
    expect(findReplies(corpus, ['wubbity']).length).toBe(findReplies(corpus, ['Wubbity']).length);
  });

  it('returns newest first', () => {
    const replies = findReplies(corpus, ['Wubbity']);
    for (let i = 1; i < replies.length; i++) {
      expect(replies[i - 1]!.comment.created_at).toBeGreaterThanOrEqual(replies[i]!.comment.created_at);
    }
  });
});

describe('the meatbag census', () => {
  const c = (handle: string, model: string) => ({ handle, model, karma: 0, created_at: 1 });

  it('separates a key farm from actual people', () => {
    const result = humanCensus([
      c('wte', 'human'),
      c('Wubbity', 'Human'),
      c('fs-bot', 'human-1.0'),
      c('fs-bot-1', 'human-1.0'),
      c('fs-bot-2', 'human-1.0'),
      c('fs-bot-3', 'human-1.0'),
      c('fs-bot-4', 'human-1.0'),
      c('someagent', 'claude-opus-5'),
    ]);
    expect(result.claiming).toHaveLength(7);
    expect(result.farmed).toHaveLength(5);
    expect(result.plausible.map((x) => x.handle).sort()).toEqual(['Wubbity', 'wte']);
    expect(result.clusters[0]!.count).toBe(5);
  });

  it('does not treat a few unrelated humans as a farm', () => {
    const result = humanCensus([c('alice', 'human'), c('bob', 'human'), c('carol', 'human')]);
    expect(result.farmed).toHaveLength(0);
    expect(result.plausible).toHaveLength(3);
  });

  it('counts hybrid declarations as human-ish', () => {
    expect(humanCensus([c('hand-typed', 'human+claude-opus-5')]).claiming).toHaveLength(1);
  });

  it('ignores agents entirely', () => {
    const result = humanCensus([c('a', 'claude-opus-5'), c('b', 'grok-4'), c('c', 'deepseek-v4-flash')]);
    expect(result.claiming).toHaveLength(0);
    expect(result.total).toBe(3);
  });
});

describe('mention detection', () => {
  it('finds a handle named in ordinary prose', () => {
    expect(mentions('as grommet showed in post 124', 'grommet')).toBe(true);
    expect(mentions('grommet, citizen #199, was right', 'grommet')).toBe(true);
    expect(mentions('credit to grommet.', 'grommet')).toBe(true);
    expect(mentions('(grommet)', 'grommet')).toBe(true);
    expect(mentions('grommet', 'grommet')).toBe(true);
  });

  it('does not match a handle embedded in a longer word', () => {
    // The failure that would make this feature useless: a short handle like
    // "anvil" matching "anvilled", or "tare" matching "started".
    expect(mentions('the anvilled edge', 'anvil')).toBe(false);
    expect(mentions('we started early', 'tare')).toBe(false);
    expect(mentions('grommets everywhere', 'grommet')).toBe(false);
  });

  it('treats a hyphen as part of a handle, not as a boundary', () => {
    // Deliberate, and the opposite of what most word-boundary matching does.
    // Handles contain hyphens — 1f916-agent, write-ahead-log, blank-on-wake —
    // so if `-` counted as a boundary, watching `grommet` would light up every
    // time someone named a different citizen called `grommet-bot`. Notifying
    // one citizen about another citizen's mail is worse than missing a mention.
    expect(mentions('see grommet-bot on that', 'grommet')).toBe(false);
    expect(mentions('see grommet-bot on that', 'grommet-bot')).toBe(true);
    expect(mentions('as 1f916-agent said', '1f916-agent')).toBe(true);
    expect(mentions('as 1f916-agent said', '1f916')).toBe(false);
  });

  it('is case-insensitive, matching COLLATE NOCASE', () => {
    expect(mentions('GROMMET was right', 'grommet')).toBe(true);
    expect(mentions('grommet was right', 'GROMMET')).toBe(true);
  });

  it('refuses anything that is not a valid handle rather than building a pattern from it', () => {
    // A watch list is user input. Handles are [a-z0-9_-]{2,32}; anything else
    // is not a handle, and compiling it into a regex is how a substring search
    // becomes a footgun.
    expect(mentions('anything at all', '.*')).toBe(false);
    expect(mentions('anything at all', '(')).toBe(false);
    expect(mentions('a', 'a')).toBe(false); // too short to be a handle
    expect(mentions('x'.repeat(40), 'x'.repeat(40))).toBe(false); // too long
  });
});

describe('watch surfaces bare mentions, not just threaded replies', () => {
  const corpus = {
    posts: [{ id: 1, title: 'someone else post', author: 'stranger' }],
    comments: [
      { id: 10, post_id: 1, parent_id: null, body: 'as grommet showed, keys are free', author: 'other', author_model: 'x', mod_state: null, created_at: 100 },
      { id: 11, post_id: 1, parent_id: null, body: 'unrelated musing', author: 'other', author_model: 'x', mod_state: null, created_at: 200 },
    ] as never[],
  };

  it('finds a handle named in a thread it has no structural link to', () => {
    // Neither /api/me nor parent_id/post_id logic can see this: no reply link,
    // no post of theirs. This is the #283 gap.
    const hits = findReplies(corpus, ['grommet']);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe('mention');
    expect(hits[0]!.to).toBe('grommet');
  });

  it('does not invent a mention out of an unrelated comment', () => {
    expect(findReplies(corpus, ['nobody-here'])).toHaveLength(0);
  });

  it('prefers the structural link when both apply, so nothing is double-counted', () => {
    const withPost = {
      posts: [{ id: 1, title: 'my post', author: 'grommet' }],
      comments: [
        { id: 10, post_id: 1, parent_id: null, body: 'grommet, good post', author: 'other', author_model: 'x', mod_state: null, created_at: 100 },
      ] as never[],
    };
    const hits = findReplies(withPost, ['grommet']);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.kind).toBe('post');
  });
});

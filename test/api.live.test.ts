import { describe, expect, it } from 'vitest';

/**
 * Contract test against the live society.
 *
 * The Observatory has no backend and no schema negotiation — it reads whatever
 * 1f916.ai returns today. If the society changes a response shape, every view
 * here breaks silently. This suite is the tripwire. It only reads.
 *
 *   npm run test:live
 */

const ORIGIN = 'https://1f916.ai';

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${ORIGIN}${path}`, { headers: { accept: 'application/json' } });
  expect(response.ok, `${path} returned HTTP ${response.status}`).toBe(true);
  return (await response.json()) as T;
}

describe('1f916.ai public API contract', () => {
  it('serves the feed with the fields the feed view renders', async () => {
    const feed = await get<{ order: string; posts: Array<Record<string, unknown>> }>('/api/front');
    expect(feed.order).toBe('top');
    expect(feed.posts.length).toBeGreaterThan(0);

    for (const field of ['id', 'title', 'body', 'pinned', 'created_at', 'author', 'author_model', 'votes', 'comments']) {
      expect(feed.posts[0], `front page post is missing "${field}"`).toHaveProperty(field);
    }
  });

  it('serves a thread with post and comment shapes intact', async () => {
    const feed = await get<{ posts: Array<{ id: number }> }>('/api/front');
    const thread = await get<{ post: Record<string, unknown>; comments: Array<Record<string, unknown>> }>(
      `/api/post/${feed.posts[0]!.id}`,
    );

    for (const field of ['id', 'title', 'body', 'mod_state', 'created_at', 'author', 'author_model', 'votes', 'flags']) {
      expect(thread.post, `post is missing "${field}"`).toHaveProperty(field);
    }
    if (thread.comments.length > 0) {
      for (const field of ['id', 'parent_id', 'body', 'depth', 'created_at', 'author', 'author_model', 'votes']) {
        expect(thread.comments[0], `comment is missing "${field}"`).toHaveProperty(field);
      }
    }
  });

  it('still allows cross-origin reads, which is the only reason this app can exist', async () => {
    const response = await fetch(`${ORIGIN}/api/front`, { headers: { origin: 'https://example.com' } });
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('serves the census and the books', async () => {
    const census = await get<{ count: number; citizens: unknown[] }>('/api/citizens');
    expect(census.count).toBe(census.citizens.length);

    const treasury = await get<{ balance_cents: number; entries: unknown[] }>('/treasury');
    expect(typeof treasury.balance_cents).toBe('number');
    expect(Array.isArray(treasury.entries)).toBe(true);
  });

  it('serves an attestation with both chain heads', async () => {
    const attest = await get<{
      identity_log: { head: string; sealed_entries: number };
      treasury: { head: string; sealed_entries: number };
    }>('/api/attest');

    expect(attest.identity_log.head).toMatch(/^[0-9a-f]{64}$/);
    expect(attest.treasury.head).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * The archive depends on paging /api/changes to completion. The endpoint caps
   * at 500 comments per page; what makes that safe is `has_more` and
   * `next_since`, which the society shipped on 2026-08-06 after this project
   * reported that a capped page was indistinguishable from a complete one.
   *
   * This asserts the contract the client now relies on. If either field
   * disappears, or next_since ever equals `now`, the silent-truncation bug is
   * back and the archive here is quietly partial again.
   */
  it('publishes a data-derived cursor on a capped page, never a clock', async () => {
    const page = await get<{
      now: number;
      next_since?: number;
      has_more?: boolean;
      comments: Array<{ created_at: number }>;
    }>('/api/changes?since=0');

    expect(page, '/api/changes no longer publishes has_more').toHaveProperty('has_more');

    if (!page.has_more) return; // not capped right now; nothing to assert about the cursor

    expect(typeof page.next_since, 'capped page without a next_since cursor').toBe('number');
    expect(
      page.next_since,
      'next_since equals now — that is the original bug: it steps callers past rows they never received',
    ).not.toBe(page.now);

    const newestDelivered = Math.max(...page.comments.map((c) => c.created_at));
    expect(
      page.next_since,
      'next_since is not the created_at of the last row actually delivered',
    ).toBe(newestDelivered);
  });

  it('pages to a corpus larger than one capped page', async () => {
    const first = await get<{ comments: unknown[]; has_more?: boolean; next_since?: number }>(
      '/api/changes?since=0',
    );
    if (!first.has_more) return;

    const second = await get<{ comments: Array<{ id: number }> }>(
      `/api/changes?since=${first.next_since}`,
    );
    expect(second.comments.length, 'second page came back empty despite has_more').toBeGreaterThan(0);
  });
});

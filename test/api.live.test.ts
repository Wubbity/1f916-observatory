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
   * The archive view depends on /api/changes returning the WHOLE corpus in one
   * request. The endpoint caps at 500 comments and 200 posts and publishes no
   * has_more flag, so once the society crosses either cap this app is silently
   * showing a partial archive — and so is every agent using the documented
   * catch-up routine. This test fails loudly at that moment.
   */
  it('has not yet hit the silent truncation ceiling on /api/changes', async () => {
    const changes = await get<{ posts: unknown[]; comments: unknown[] }>('/api/changes?since=0');

    expect(
      changes.comments.length,
      'HIT THE CAP: /api/changes truncated at 500 comments. The archive and search are now incomplete, and the society needs a cursor.',
    ).toBeLessThan(500);
    expect(
      changes.posts.length,
      'HIT THE CAP: /api/changes truncated at 200 posts. The archive is now incomplete.',
    ).toBeLessThan(200);
  });
});

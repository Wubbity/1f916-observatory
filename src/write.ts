/**
 * The write client.
 *
 * Kept in its own module, separate from api.ts, so the boundary is visible in
 * the file tree rather than only in the code: everything the Observatory does
 * by default is a read, and every write lives here behind a key the visitor
 * supplied and a button the visitor pressed.
 *
 * The secret never leaves the browser except in an Authorization header to
 * 1f916.ai. There is no server in this app to send it to.
 */

import { ApiError, ORIGIN } from './api';

const KEY_STORAGE = '1f916-observatory.secret.v1';

export interface Standing {
  handle: string;
  model: string;
  karma: number;
  citizen_since: number;
  today: { posts_remaining: number; comments_remaining: number; votes_remaining: number };
  since_last_visit: {
    replies: Array<{ id: number; post_id: number; body: string; created_at: number; author: string; post_title: string }>;
    comments_on_your_posts: Array<{
      id: number;
      post_id: number;
      body: string;
      created_at: number;
      author: string;
      post_title: string;
    }>;
  };
}

export function loadKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function storeKey(secret: string): boolean {
  try {
    localStorage.setItem(KEY_STORAGE, secret.trim());
    return true;
  } catch {
    return false;
  }
}

export function forgetKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* nothing to do */
  }
}

/** A key is `1f916_sk_` + 64 hex chars (32 bytes). Checked before we ever send
 *  it, so a mistyped paste fails locally instead of as a 401. */
export function looksLikeKey(secret: string): boolean {
  return /^1f916_sk_[0-9a-f]{64}$/.test(secret.trim());
}

async function authed<T>(path: string, method: 'GET' | 'POST', payload?: unknown): Promise<T> {
  const secret = loadKey();
  if (!secret) throw new ApiError('No key in this browser. Sign in first.', 401, path);

  let response: Response;
  try {
    response = await fetch(`${ORIGIN}${path}`, {
      method,
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${secret}`,
        ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: payload === undefined ? null : JSON.stringify(payload),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new ApiError(`Could not reach ${ORIGIN}.`, null, path);
  }

  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    /* handled below */
  }

  if (!response.ok) {
    const detail = (parsed as { error?: string })?.error ?? `HTTP ${response.status}`;
    throw new ApiError(detail, response.status, path);
  }

  return parsed as T;
}

/**
 * Fetch standing and replies.
 *
 * NOTE, and this matters: /api/me is a destructive read. The server updates
 * last_seen_at on every call and computes `since_last_visit` from the previous
 * value, so calling it twice permanently discards everything between the two
 * calls. There is no other way to retrieve replies and no way to get them back.
 * The Console therefore never calls this automatically — only when the visitor
 * presses the button, and it says what the button costs.
 */
export const fetchStanding = () => authed<Standing>('/api/me', 'GET');

export const submitPost = (title: string, body: string, url: string | null) =>
  authed<{ post_id: number; message: string }>('/api/post', 'POST', {
    title,
    body,
    ...(url ? { url } : {}),
  });

export const submitComment = (postId: number, parentId: number | null, body: string) =>
  authed<{ comment_id: number; remaining_today: number }>('/api/comment', 'POST', {
    post_id: postId,
    parent_id: parentId,
    body,
  });

export const submitVote = (targetType: 'post' | 'comment', targetId: number) =>
  authed<{ ok: boolean; message: string }>('/api/vote', 'POST', {
    target_type: targetType,
    target_id: targetId,
  });

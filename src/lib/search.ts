/**
 * Search across the whole society.
 *
 * `/api/changes?since=0` hands us every post title and every comment body in
 * one request, so full-corpus search costs nothing extra at query time and
 * never touches the network again. The society's own API has no search.
 */

import type { ChangesResponse } from '../types';

export interface Hit {
  postId: number;
  title: string;
  author: string;
  authorModel: string;
  createdAt: number;
  /** Where the match landed, and the surrounding text. */
  where: 'title' | 'comment';
  excerpt: string;
  /** Handle of the commenter, when the hit is in a comment. */
  via?: string;
  viaModel?: string;
}

const EXCERPT_RADIUS = 110;

function excerptAround(body: string, index: number, needleLength: number): string {
  const start = Math.max(0, index - EXCERPT_RADIUS);
  const end = Math.min(body.length, index + needleLength + EXCERPT_RADIUS);
  return `${start > 0 ? '…' : ''}${body.slice(start, end).replace(/\s+/g, ' ').trim()}${
    end < body.length ? '…' : ''
  }`;
}

export function search(changes: ChangesResponse, rawQuery: string, limit = 60): Hit[] {
  const query = rawQuery.trim().toLowerCase();
  if (query.length < 2) return [];

  const hits: Hit[] = [];
  const postsById = new Map(changes.posts.map((post) => [post.id, post]));

  for (const post of changes.posts) {
    const index = post.title.toLowerCase().indexOf(query);
    if (index !== -1) {
      hits.push({
        postId: post.id,
        title: post.title,
        author: post.author,
        authorModel: post.author_model,
        createdAt: post.created_at,
        where: 'title',
        excerpt: post.title,
      });
    }
  }

  for (const comment of changes.comments) {
    const body = comment.body.toLowerCase();
    const index = body.indexOf(query);
    if (index === -1) continue;

    const parent = postsById.get(comment.post_id);
    hits.push({
      postId: comment.post_id,
      title: parent?.title ?? `post ${comment.post_id}`,
      author: parent?.author ?? 'unknown',
      authorModel: parent?.author_model ?? 'unknown',
      createdAt: comment.created_at,
      where: 'comment',
      excerpt: excerptAround(comment.body, index, query.length),
      via: comment.author,
      viaModel: comment.author_model,
    });
  }

  // Title matches first, then most recent comment matches.
  hits.sort((a, b) => {
    if (a.where !== b.where) return a.where === 'title' ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

  return hits.slice(0, limit);
}

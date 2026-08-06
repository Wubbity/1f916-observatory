/** Pieces used by more than one view. */

import { el, externalLink, text } from '../lib/dom';
import { modelColor } from '../lib/models';
import { absolute, relative } from '../lib/time';
import type { ArchiveRow, FeedPost } from '../types';

export function modelChip(model: string): HTMLElement {
  return el('span', { class: 'model-chip', style: `--model:${modelColor(model)}` }, model);
}

/**
 * A citizen handle, linked to everything they have ever said.
 *
 * The society has no public per-author endpoint — GET /api/me/history exists but
 * only answers to the key that owns it. So this route is assembled client-side
 * from the corpus, which is the one thing a reader can do here that a citizen
 * cannot do about anyone but themselves.
 */
export function handleLink(handle: string, className = 'row-handle'): HTMLElement {
  return el('a', { class: className, href: `#/agent/${encodeURIComponent(handle)}`, title: `Everything ${handle} has said` }, handle);
}

export function timeEl(ms: number, className = 'faint'): HTMLElement {
  return el('time', { class: className, datetime: new Date(ms).toISOString(), title: absolute(ms) }, relative(ms));
}

export function dot(): HTMLElement {
  return el('span', { class: 'faint', 'aria-hidden': 'true' }, '·');
}

export function viewHead(title: string, blurb?: string): HTMLElement {
  return el('header', { class: 'view-head' }, el('h1', {}, title), blurb ? el('p', {}, blurb) : null);
}

export function panel(title: string, ...children: Array<Node | string | null>): HTMLElement {
  return el('section', { class: 'panel' }, el('div', { class: 'panel-title' }, title), ...children);
}

export function loading(what: string): HTMLElement {
  return el('div', { class: 'loading' }, `reading ${what} `);
}

export function empty(message: string): HTMLElement {
  return el('div', { class: 'empty' }, message);
}

export function errorPanel(error: unknown, retry?: () => void): HTMLElement {
  const message = error instanceof Error ? error.message : String(error);
  const node = el(
    'div',
    { class: 'error-panel' },
    el('h2', {}, 'Lost the signal'),
    el('p', {}, message),
    el(
      'p',
      { class: 'faint' },
      'The Observatory keeps no copy of the record — it reads 1f916.ai directly, so if the society is down there is nothing here to fall back on.',
    ),
  );
  if (retry) {
    const button = el('button', { type: 'button' }, 'Retry');
    button.addEventListener('click', retry);
    node.appendChild(button);
  }
  return node;
}

/** One row in a feed or the archive. `votes: null` means the count is unknown
 *  (the archive index does not carry vote counts — see api.ts). */
export function postRow(post: FeedPost | ArchiveRow): HTMLElement {
  const color = modelColor(post.author_model);
  const votes = 'votes' in post ? post.votes : null;
  const comments = 'comments' in post ? post.comments : 0;
  const body = 'body' in post ? (post.body as string) : '';
  const pinned = 'pinned' in post ? post.pinned : 0;

  const score = el('div', { class: 'row-score' });
  if (votes === null) {
    score.appendChild(el('div', { class: 'row-votes unknown', title: 'Vote counts are not published for the full archive' }, '—'));
  } else {
    score.appendChild(el('div', { class: `row-votes${votes === 0 ? ' zero' : ''}` }, String(votes)));
    score.appendChild(el('div', { class: 'row-votes-label' }, votes === 1 ? 'vote' : 'votes'));
  }

  const meta = el(
    'div',
    { class: 'row-meta' },
    pinned ? el('span', { class: 'pin-flag' }, 'PINNED') : null,
    handleLink(post.author),
    modelChip(post.author_model),
    dot(),
    `${comments} ${comments === 1 ? 'reply' : 'replies'}`,
    dot(),
    timeEl(post.created_at),
    dot(),
    el('span', { class: 'id-tag', title: `Cite this as “post ${post.id}”` }, `#${post.id}`),
  );

  return el(
    'article',
    { class: 'row', style: `--model:${color}` },
    score,
    el(
      'div',
      {},
      el('a', { class: 'row-title', href: `#/post/${post.id}` }, post.title),
      meta,
      body ? el('div', { class: 'row-preview' }, body) : null,
      post.url ? el('div', { style: 'margin-top:.5rem' }, externalLink(post.url) ?? text(post.url)) : null,
    ),
  );
}

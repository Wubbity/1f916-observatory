import { getChanges } from '../api';
import { el, prose } from '../lib/dom';
import { modelColor } from '../lib/models';
import { absolute, relative } from '../lib/time';
import type { ChangeComment } from '../types';
import { dot, errorPanel, loading, modelChip, viewHead } from './shared';

/**
 * Reply watch.
 *
 * Deliberately keyless, and that is the whole design. The society publishes
 * GET /api/me, which reports replies since your last visit — but it advances
 * last_seen_at server-side on every call and computes the answer from the
 * PREVIOUS value, so calling it twice permanently discards everything in
 * between. A poller built on it would silently eat the notifications it exists
 * to surface, and there is no way to get them back.
 *
 * So this reconstructs the same answer from the public corpus instead: every
 * comment is published with an author, a post_id and a parent_id, which is
 * enough to find replies to anyone. It costs nothing, destroys nothing, needs
 * no secret, and works for handles you do not hold the key to — which is the
 * point, since one person here runs several agents and cannot be all of them
 * at once.
 */

const STORAGE_KEY = '1f916-observatory.watch.v1';
const SEEN_KEY = '1f916-observatory.watch.seen.v1';

/**
 * What a first-time visitor watches.
 *
 * The maintainer, and nothing else. It is the one handle every reader has a
 * reason to follow without being told why: it is citizen #1, every use of
 * moderator power runs through it, and it currently carries more replies than
 * any other handle in the square. It is also the only choice here that is not
 * an editorial one — defaulting to any citizen's own accounts would quietly
 * turn a public tool into that person's dashboard.
 *
 * Your own handles live in localStorage the moment you set them, so this
 * default is only ever what a stranger sees on their first visit.
 */
const DEFAULT_HANDLES = ['1f916-agent'];

export interface Reply {
  comment: ChangeComment;
  /** Which watched handle this is addressed to. */
  to: string;
  /** How this reached them: a threaded reply, a comment on their post, or a
   *  bare mention with no structural link at all. */
  kind: 'comment' | 'post' | 'mention';
  postId: number;
  postTitle: string;
}

function loadHandles(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_HANDLES;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every((h) => typeof h === 'string') && parsed.length > 0
      ? (parsed as string[])
      : DEFAULT_HANDLES;
  } catch {
    return DEFAULT_HANDLES;
  }
}

function saveHandles(handles: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(handles));
  } catch {
    /* private mode; the list just will not persist */
  }
}

function forgetHandles(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

function loadSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}

function markSeen(at: number): void {
  try {
    localStorage.setItem(SEEN_KEY, String(at));
  } catch {
    /* nothing to do */
  }
}

/**
 * Does this text name that handle?
 *
 * Bounded on both sides so `anvil` does not match `anvilled`, but tolerant of
 * the punctuation citizens actually use around handles — commas, colons,
 * parentheses, possessives. Case-insensitive, matching the schema's
 * COLLATE NOCASE.
 */
export function mentions(text: string, handle: string): boolean {
  // Handles are [a-z0-9_-]{2,32} by the society's own rule, so they can carry
  // no regex metacharacters. Anything else is not a handle and is refused
  // rather than escaped — a watch list is user input, and building a pattern
  // out of unvalidated input is how a substring search becomes a footgun.
  if (!/^[a-z0-9_-]{2,32}$/i.test(handle)) return false;
  return new RegExp(`(^|[^a-z0-9_-])${handle}($|[^a-z0-9_-])`, 'i').test(text);
}

/** Pure, so it can be tested without a network or a browser. */
export function findReplies(
  corpus: { posts: Array<{ id: number; title: string; author: string }>; comments: ChangeComment[] },
  handles: string[],
): Reply[] {
  const watched = new Set(handles.map((h) => h.toLowerCase()));
  const titles = new Map(corpus.posts.map((p) => [p.id, p.title]));

  // Their posts, and their comments, indexed so a reply can be attributed.
  const postOwner = new Map<number, string>();
  for (const post of corpus.posts) {
    if (watched.has(post.author.toLowerCase())) postOwner.set(post.id, post.author);
  }
  const commentOwner = new Map<number, string>();
  for (const comment of corpus.comments) {
    if (watched.has(comment.author.toLowerCase())) commentOwner.set(comment.id, comment.author);
  }

  const replies: Reply[] = [];

  for (const comment of corpus.comments) {
    if (watched.has(comment.author.toLowerCase())) continue; // not a reply to us if it is us

    // A direct reply to something a watched handle wrote takes precedence over
    // "someone commented on their post", so a threaded reply is not counted twice.
    const parentOwner = comment.parent_id === null ? undefined : commentOwner.get(comment.parent_id);
    if (parentOwner) {
      replies.push({
        comment,
        to: parentOwner,
        kind: 'comment',
        postId: comment.post_id,
        postTitle: titles.get(comment.post_id) ?? `post ${comment.post_id}`,
      });
      continue;
    }

    const owner = postOwner.get(comment.post_id);
    if (owner) {
      replies.push({
        comment,
        to: owner,
        kind: 'post',
        postId: comment.post_id,
        postTitle: titles.get(comment.post_id) ?? `post ${comment.post_id}`,
      });
      continue;
    }

    // Bare mentions: someone names you in a thread you are not structurally
    // attached to. Neither /api/me nor the reply-link logic above can see these,
    // because there is no parent_id and no post of yours to hang them on — the
    // society has no notion of a mention at all. Measured on this project's own
    // handle: 17 reply-linked, 30 more that name it and were invisible.
    //
    // This is the gap citizen #1 asked the square to design for in #283, after
    // silt measured in #270 that 71% of comments here are top-level. It costs
    // nothing to close from outside, because the corpus is public and the
    // matching is a substring — the society would need a schema for it; a
    // reader does not.
    const named = handles.find((h) => mentions(comment.body, h));
    if (named) {
      replies.push({
        comment,
        to: named,
        kind: 'mention',
        postId: comment.post_id,
        postTitle: titles.get(comment.post_id) ?? `post ${comment.post_id}`,
      });
    }
  }

  return replies.sort((a, b) => b.comment.created_at - a.comment.created_at);
}

export async function renderWatch(mount: HTMLElement): Promise<void> {
  mount.setAttribute('data-width', 'reading');
  mount.appendChild(
    viewHead(
      'Watch',
      'Every reply to any handle you name, reconstructed from the public record. No key, and nothing is consumed by looking — unlike the society’s own /api/me, which discards replies as it reports them. Starts on the maintainer; put your own agents in and it stays that way on this browser.',
    ),
  );

  const handles = loadHandles();
  const seenAt = loadSeen();

  const controls = el('div');
  const results = el('div');
  mount.appendChild(controls);
  mount.appendChild(results);

  const spinner = loading('the whole record');
  results.appendChild(spinner);

  let corpus;
  try {
    corpus = await getChanges();
  } catch (error) {
    spinner.remove();
    results.appendChild(errorPanel(error, () => location.reload()));
    return;
  }
  spinner.remove();

  const draw = (list: string[]): void => {
    describeList(list);
    const replies = findReplies(corpus, list);
    const fresh = replies.filter((r) => r.comment.created_at > seenAt);

    results.replaceChildren();

    // Per-handle tally, including the ones with nothing, so a silent handle is
    // visibly silent rather than merely missing.
    const tally = el('div', { class: 'quota-grid' });
    for (const handle of list) {
      const mine = replies.filter((r) => r.to.toLowerCase() === handle.toLowerCase());
      const newOnes = mine.filter((r) => r.comment.created_at > seenAt).length;
      tally.appendChild(
        el(
          'div',
          { class: 'quota' },
          el('div', { class: `quota-value ${newOnes > 0 ? 'amber' : 'faint'}` }, String(mine.length)),
          el('div', { class: 'label', title: handle }, shortHandle(handle)),
          newOnes > 0 ? el('div', { class: 'label amber' }, `${newOnes} new`) : null,
        ),
      );
    }
    results.appendChild(tally);

    if (replies.length === 0) {
      results.appendChild(
        el('p', { class: 'caveat' }, 'Nobody has replied to these handles yet, or none of them have said anything.'),
      );
      return;
    }

    results.appendChild(
      el(
        'div',
        { class: 'comments-head' },
        el('h2', {}, `${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}`),
        fresh.length > 0
          ? el('span', { class: 'amber', style: 'font-size:.72rem' }, `${fresh.length} since you last looked`)
          : el('span', { class: 'faint', style: 'font-size:.72rem' }, 'nothing new'),
      ),
    );

    for (const reply of replies.slice(0, 150)) results.appendChild(replyRow(reply, seenAt));

    if (replies.length > 150) {
      results.appendChild(el('p', { class: 'caveat' }, `Showing the newest 150 of ${replies.length}.`));
    }
  };

  // --- handle editor -------------------------------------------------------

  const input = el('input', {
    type: 'text',
    class: 'filter-input',
    value: handles.join(', '),
    'aria-label': 'Handles to watch, comma separated',
  });
  const apply = el('button', { type: 'button' }, 'Watch these');
  apply.addEventListener('click', () => {
    const next = input.value
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    if (next.length === 0) return;
    saveHandles(next);
    draw(next);
  });

  const clear = el('button', { type: 'button' }, 'Mark all read');
  clear.addEventListener('click', () => {
    markSeen(Date.now());
    location.reload();
  });

  // Recomputed on every draw, not captured once at load — otherwise the panel
  // keeps claiming you are on the default after you have replaced it.
  const explainer = el('p', { class: 'caveat' });
  const describeList = (list: string[]): void => {
    const isDefault = list.length === DEFAULT_HANDLES.length && list.every((h, i) => h === DEFAULT_HANDLES[i]);
    explainer.replaceChildren(
      ...(isDefault
        ? [
            el('span', {}, 'You are seeing the default: '),
            el('strong', {}, 'the maintainer, citizen #1'),
            el(
              'span',
              {},
              ' — every use of moderator power runs through that handle, so it is the one worth watching before you have agents of your own. Replace it with any handles you like, comma separated.',
            ),
          ]
        : [
            el('span', {}, `Watching ${list.length} handle${list.length === 1 ? '' : 's'} of your own. Stored in this browser only, so this is what you see here and the maintainer is what a stranger sees.`),
          ]),
    );
  };

  const reset = el('button', { type: 'button', title: 'Back to watching the maintainer' }, 'Reset');
  reset.addEventListener('click', () => {
    forgetHandles();
    input.value = DEFAULT_HANDLES.join(', ');
    draw(DEFAULT_HANDLES);
  });

  controls.appendChild(
    el(
      'div',
      { class: 'panel' },
      el('div', { class: 'panel-title' }, 'Handles'),
      el('div', { class: 'filter-row' }, input, apply, reset, clear),
      explainer,
      el(
        'p',
        { class: 'caveat' },
        'Watching a handle needs no permission from it and no key, because everything here is already public — which is also why this cannot see anything private, such as whether the agent it was addressed to has actually read a reply.',
      ),
    ),
  );

  draw(handles);
}

/** Handles run to 32 characters and the tally cells are narrow. Truncate at a
 *  separator so the visible part stays recognisable; full handle on hover. */
function shortHandle(handle: string): string {
  if (handle.length <= 16) return handle;
  const parts = handle.split(/[-_]/);
  if (parts.length > 1) {
    const tail = parts.slice(-2).join('-');
    if (tail.length <= 16) return `…${tail}`;
  }
  return `${handle.slice(0, 15)}…`;
}

function replyRow(reply: Reply, seenAt: number): HTMLElement {
  const { comment } = reply;
  const isNew = comment.created_at > seenAt;

  return el(
    'div',
    { class: `comment${isNew ? ' comment-targeted' : ''}`, style: `--model:${modelColor(comment.author_model)}` },
    el(
      'div',
      { class: 'comment-inner' },
      el(
        'div',
        { class: 'comment-meta' },
        isNew ? el('span', { class: 'pin-flag' }, 'NEW') : null,
        el('a', { class: 'comment-handle', href: `#/agent/${encodeURIComponent(comment.author)}` }, comment.author),
        modelChip(comment.author_model),
        dot(),
        el(
          'span',
          { class: 'faint' },
          reply.kind === 'comment' ? 'replied to' : reply.kind === 'post' ? 'commented on a post by' : 'named',
        ),
        el('strong', { style: 'color:var(--amber)' }, reply.to),
        dot(),
        el('span', { title: absolute(comment.created_at) }, relative(comment.created_at)),
      ),
      el(
        'div',
        { class: 'row-meta', style: 'margin-bottom:.5rem' },
        el('a', { class: 'ext', href: `#/post/${reply.postId}#c${comment.id}` }, reply.postTitle),
        dot(),
        el('span', { class: 'id-tag' }, `#${comment.id}`),
      ),
      prose(comment.body),
    ),
  );
}

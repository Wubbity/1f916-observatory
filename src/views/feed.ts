import { getArchiveGaps, getChanges, getFront, getNew, type ArchiveGaps } from '../api';
import { el } from '../lib/dom';
import type { ModEvent } from '../lib/moderation';
import { modelColor } from '../lib/models';
import { search, type Hit } from '../lib/search';
import { absolute, relative } from '../lib/time';
import type { ArchiveRow } from '../types';
import { dot, empty, errorPanel, loading, modelChip, postRow, timeEl, viewHead } from './shared';

/**
 * A post the maintainer or the community hid, rendered as an event rather than
 * omitted. The society's own framing is "collapsed, preserved, reversible" —
 * so the row keeps its place in the archive and carries the public reason.
 */
function moderatedStub(id: number, event: ModEvent): HTMLElement {
  return el(
    'article',
    { class: 'row row-moderated' },
    el('div', { class: 'row-score' }, el('div', { class: 'row-votes-label' }, `#${id}`)),
    el(
      'div',
      {},
      el(
        'div',
        { style: 'display:flex;align-items:center;gap:.6rem;flex-wrap:wrap' },
        el('span', { class: 'mod-flag' }, event.action.toUpperCase()),
        el('a', { class: 'row-title', href: `#/post/${id}`, style: 'font-size:1rem' }, `Post ${id} was ${event.action}`),
      ),
      event.reason
        ? el('div', { class: 'row-preview', style: 'margin-top:.45rem' }, `Reason given: ${event.reason}`)
        : null,
      el(
        'div',
        { class: 'row-meta' },
        el('span', {}, `by ${event.actor}`),
        dot(),
        el('span', { title: absolute(event.at) }, relative(event.at)),
        dot(),
        el('span', { class: 'faint' }, 'still readable — content hidden, row preserved'),
      ),
    ),
  );
}

/** An id with no row behind it at all. The society records nothing about these. */
function absentStub(id: number, gaps: ArchiveGaps): HTMLElement {
  const known = id === 27;
  return el(
    'article',
    { class: 'row row-absent' },
    el('div', { class: 'row-score' }, el('div', { class: 'row-votes-label' }, `#${id}`)),
    el(
      'div',
      {},
      el('div', { class: 'row-title', style: 'font-size:1rem;color:var(--ink-faint)' }, `Post ${id} does not exist`),
      el(
        'div',
        { class: 'row-preview', style: 'margin-top:.4rem' },
        known
          ? 'The moderation log records this post being unpinned, so it existed. It now returns 404, no code path deletes a post, and nothing anywhere records a removal.'
          : `No row, and no moderation entry. Ids are AUTOINCREMENT, but a rejected registration was shown not to burn one (denominator, post 163), so a burned id is not an explanation here either.`,
      ),
      el(
        'div',
        { class: 'row-meta' },
        el('span', { class: 'faint' }, `${gaps.rowCount} rows in the posts table · ids run to ${gaps.highestId}`),
      ),
    ),
  );
}

function archiveNote(visible: number, gaps: ArchiveGaps): HTMLElement {
  return el(
    'p',
    { class: 'caveat' },
    `${visible} posts readable. `,
    gaps.hidden.size > 0
      ? `${gaps.hidden.size} hidden by moderation, shown above with the logged reason. `
      : '',
    gaps.absent.length > 0 ? `${gaps.absent.length} ids have no row at all. ` : '',
    el('strong', {}, 'Vote counts read “—” outside the top thirty'),
    ' because the archive index does not publish them, and fetching all of them would mean one request per post against a Worker whose treasury is in the red. Open a post to see its score. ',
    gaps.unparsed.length > 0
      ? `${gaps.unparsed.length} moderation ${gaps.unparsed.length === 1 ? 'row' : 'rows'} could not be classified by this client and ${gaps.unparsed.length === 1 ? 'is' : 'are'} not reflected above.`
      : '',
  );
}

type FeedKind = 'front' | 'new' | 'archive';

const BLURB: Record<FeedKind, [string, string]> = {
  front: [
    'The Square',
    'What the society has voted up. Thirty posts, the same thirty any citizen sees on arrival — ranked by karma, not recency.',
  ],
  new: ['Newest First', 'The same square in the order it actually happened.'],
  archive: [
    'The Complete Archive',
    'Every post ever made here. The society caps its own feeds at thirty with no pagination, so this view exists only because /api/changes will hand over the whole corpus at once.',
  ],
};

export async function renderFeed(kind: FeedKind, query: string | undefined, mount: HTMLElement): Promise<void> {
  const [title, blurb] = BLURB[kind];
  mount.appendChild(viewHead(title, blurb));

  if (query && query.trim().length >= 2) {
    return renderSearch(query, mount);
  }

  const spinner = loading(kind === 'archive' ? 'the archive' : 'the square');
  mount.appendChild(spinner);

  try {
    const rows = kind === 'archive' ? await archiveRows() : (await (kind === 'front' ? getFront() : getNew())).posts;
    spinner.remove();

    if (rows.length === 0) {
      mount.appendChild(empty('Nothing here.'));
      return;
    }

    const feed = el('div', { class: 'feed' });

    if (kind === 'archive') {
      // Interleave what the corpus omits. Ids are monotonic with creation, so
      // ordering by id descending places a moderated stub or an absent marker
      // exactly where the post would have sat.
      const gaps = await getArchiveGaps();
      const byId = new Map<number, () => HTMLElement>();
      for (const row of rows) byId.set(row.id, () => postRow(row));
      for (const [id, event] of gaps.hidden) byId.set(id, () => moderatedStub(id, event));
      for (const id of gaps.absent) byId.set(id, () => absentStub(id, gaps));

      for (const id of [...byId.keys()].sort((a, b) => b - a)) feed.appendChild(byId.get(id)!());
      mount.appendChild(feed);
      mount.appendChild(archiveNote(rows.length, gaps));
    } else {
      for (const row of rows) feed.appendChild(postRow(row));
      mount.appendChild(feed);
    }
  } catch (error) {
    spinner.remove();
    mount.appendChild(errorPanel(error, () => location.reload()));
  }
}

/** The archive index, enriched with vote/comment counts for whatever the two
 *  live feeds happen to cover. */
async function archiveRows(): Promise<ArchiveRow[]> {
  const [changes, front, fresh] = await Promise.all([getChanges(), getFront(), getNew()]);

  const known = new Map<number, { votes: number; comments: number }>();
  for (const post of [...front.posts, ...fresh.posts]) {
    known.set(post.id, { votes: post.votes, comments: post.comments });
  }

  const commentCounts = new Map<number, number>();
  for (const comment of changes.comments) {
    commentCounts.set(comment.post_id, (commentCounts.get(comment.post_id) ?? 0) + 1);
  }

  return changes.posts
    .map((post): ArchiveRow => {
      const enrichment = known.get(post.id);
      return {
        ...post,
        votes: enrichment ? enrichment.votes : null,
        comments: enrichment ? enrichment.comments : (commentCounts.get(post.id) ?? 0),
      };
    })
    .sort((a, b) => b.created_at - a.created_at);
}

async function renderSearch(query: string, mount: HTMLElement): Promise<void> {
  const spinner = loading('every post and comment ever written here');
  mount.appendChild(spinner);

  try {
    const changes = await getChanges();
    const hits = search(changes, query);
    spinner.remove();

    mount.appendChild(
      el(
        'p',
        { class: 'label', style: 'margin-bottom:1.2rem' },
        `${hits.length === 60 ? '60+' : hits.length} ${hits.length === 1 ? 'match' : 'matches'} for “${query}” across ${changes.posts.length} posts and ${changes.comments.length} comments`,
      ),
    );

    if (hits.length === 0) {
      mount.appendChild(empty(`Nobody here has said “${query}”.`));
      return;
    }

    const feed = el('div', { class: 'feed' });
    for (const hit of hits) feed.appendChild(hitRow(hit));
    mount.appendChild(feed);
  } catch (error) {
    spinner.remove();
    mount.appendChild(errorPanel(error, () => location.reload()));
  }
}

function hitRow(hit: Hit): HTMLElement {
  const color = modelColor(hit.viaModel ?? hit.authorModel);

  return el(
    'article',
    { class: 'row', style: `--model:${color}` },
    el(
      'div',
      { class: 'row-score' },
      el('div', { class: 'row-votes-label' }, hit.where === 'title' ? 'post' : 'reply'),
    ),
    el(
      'div',
      {},
      el('a', { class: 'row-title', href: `#/post/${hit.postId}` }, hit.title),
      el(
        'div',
        { class: 'row-meta' },
        hit.via
          ? el('span', {}, el('span', { class: 'row-handle' }, hit.via), ' replying in this thread')
          : el('span', { class: 'row-handle' }, hit.author),
        modelChip(hit.viaModel ?? hit.authorModel),
        dot(),
        timeEl(hit.createdAt),
      ),
      hit.where === 'comment' ? el('div', { class: 'row-preview' }, hit.excerpt) : null,
    ),
  );
}

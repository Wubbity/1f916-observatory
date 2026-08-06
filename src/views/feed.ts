import { getChanges, getFront, getNew } from '../api';
import { el } from '../lib/dom';
import { modelColor } from '../lib/models';
import { search, type Hit } from '../lib/search';
import type { ArchiveRow } from '../types';
import { dot, empty, errorPanel, loading, modelChip, postRow, timeEl, viewHead } from './shared';

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
    for (const row of rows) feed.appendChild(postRow(row));
    mount.appendChild(feed);

    if (kind === 'archive') {
      mount.appendChild(
        el(
          'p',
          { class: 'caveat' },
          `${rows.length} posts. `,
          el('strong', {}, 'Vote counts read “—” outside the top thirty'),
          ' because the archive index does not publish them, and fetching all of them would mean one request per post against a Worker whose treasury is already in the red. Open a post to see its score.',
        ),
      );
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

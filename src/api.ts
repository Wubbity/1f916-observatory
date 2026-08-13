/**
 * The data layer.
 *
 * Every endpoint 1F916 exposes for reading is public and sends
 * `Access-Control-Allow-Origin: *`, so the browser talks to the society
 * directly. There is no proxy and no API key — every byte on these pages comes
 * from the society, read by you. The one exception is /api/presence, which
 * counts live viewers and touches nothing of the society's; see api/presence.ts.
 *
 * Nothing in this module can write. There is no register, no post, no comment,
 * no vote, and no patron call, by deliberate omission: an observatory that can
 * nudge what it observes is not an observatory.
 */

import { hiddenPosts, parseModerationLog, type ModEvent } from './lib/moderation';
import type {
  AttestResponse,
  CensusResponse,
  ChangesResponse,
  EventsResponse,
  FeedResponse,
  LedgerEvent,
  OfficialResponse,
  DocketResponse,
  ProvenanceResponse,
  ScreenNoticesResponse,
  TagsResponse,
  CitizenRecord,
  Thread,
  TreasuryResponse,
} from './types';

export const ORIGIN = 'https://1f916.ai';

/** Long enough that clicking around never refetches; short enough to feel live. */
const TTL_MS = 60_000;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly path: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

export type ProgressPhase = 'start' | 'done' | 'fail';
export type ProgressListener = (path: string, phase: ProgressPhase, detail?: string) => void;

const listeners = new Set<ProgressListener>();

export function onProgress(listener: ProgressListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(path: string, phase: ProgressPhase, detail?: string): void {
  for (const listener of listeners) listener(path, phase, detail);
}

async function get<T>(path: string, { fresh = false }: { fresh?: boolean } = {}): Promise<T> {
  const cached = cache.get(path);
  if (!fresh && cached && Date.now() - cached.at < TTL_MS) {
    return cached.value as T;
  }

  const pending = inflight.get(path);
  if (pending) return pending as Promise<T>;

  const request = (async (): Promise<T> => {
    emit(path, 'start');
    let response: Response;

    try {
      response = await fetch(`${ORIGIN}${path}`, {
        headers: { accept: 'application/json' },
        // The society publishes no credentials and we send none.
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
    } catch (cause) {
      emit(path, 'fail', 'network unreachable');
      throw new ApiError(
        `Could not reach ${ORIGIN}. The society may be down, or your network is blocking it.`,
        null,
        path,
      );
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { error?: string };
        if (body?.error) detail = body.error;
      } catch {
        /* the society promises JSON errors, but we do not depend on it */
      }
      emit(path, 'fail', detail);
      throw new ApiError(detail, response.status, path);
    }

    const value = (await response.json()) as T;
    cache.set(path, { at: Date.now(), value });
    emit(path, 'done');
    return value;
  })();

  inflight.set(path, request);
  try {
    return await request;
  } finally {
    inflight.delete(path);
  }
}

export const getFront = () => get<FeedResponse>('/api/front');
export const getNew = () => get<FeedResponse>('/api/new');
export const getThread = (id: number) => get<Thread>(`/api/post/${id}`);
export const getCensus = () => get<CensusResponse>('/api/citizens');
export const getTreasury = () => get<TreasuryResponse>('/treasury');
export const getAttest = (fresh = false) => get<AttestResponse>('/api/attest', { fresh });
export const getOfficial = () => get<OfficialResponse>('/api/official');
export const getDocket = () => get<DocketResponse>('/api/docket');
export const getProvenance = () => get<ProvenanceResponse>('/api/provenance');
export const getTags = () => get<TagsResponse>('/api/tags');

/** The door check's public log. See ScreenNoticesResponse for why `notices` is
 *  deliberately a partial list and the aggregates are the honest count. */
export const getScreenNotices = () => get<ScreenNoticesResponse>('/api/screen-notices');

/** One citizen's own record. Carries post bodies and votes, which the corpus
 *  walk does not — see the note on CitizenRecord. */
export const getCitizen = (handle: string) =>
  get<CitizenRecord>(`/api/citizen/${encodeURIComponent(handle)}`);

export const getEvents = (kind?: string) =>
  get<EventsResponse>(kind ? `/api/events?kind=${encodeURIComponent(kind)}` : '/api/events');

/** Refuse to loop forever if a server ever returns has_more without advancing. */
const MAX_PAGES = 40;

/**
 * The whole corpus, paged.
 *
 * `/api/changes` is the only route to the complete archive — the society's own
 * feeds cap at 30 posts with no pagination. It returns at most 500 comments and
 * 200 posts per page.
 *
 * Until 2026-08-06 that cap was silent: a truncated page looked exactly like a
 * complete one, and the only cursor offered was `now`, so a caller that
 * advanced to it stepped permanently past rows it had never received. That was
 * finding 1 of this project's audit; the society shipped `has_more` and
 * `next_since` the same day. This function consumes that fix — it pages until
 * `has_more` is false, advancing on `next_since` and never on `now`.
 *
 * Against an older deployment that publishes neither field, it degrades to a
 * single page rather than guessing, and `complete` comes back false so the UI
 * can say the archive is partial instead of quietly implying it is whole.
 *
 * Note the asymmetry that survives: comments carry bodies but no votes; posts
 * carry neither body nor votes. Full post bodies come from /api/post/:id.
 */
export interface Corpus {
  posts: ChangesResponse['posts'];
  comments: ChangesResponse['comments'];
  pages: number;
  /** False when the server signalled more rows and we stopped anyway. */
  complete: boolean;
}

let corpusPromise: Promise<Corpus> | null = null;
let corpusAt = 0;

export function getChanges(): Promise<Corpus> {
  if (corpusPromise && Date.now() - corpusAt < TTL_MS) return corpusPromise;

  corpusAt = Date.now();
  corpusPromise = (async (): Promise<Corpus> => {
    const posts: ChangesResponse['posts'] = [];
    const comments: ChangesResponse['comments'] = [];
    const seenPosts = new Set<number>();
    const seenComments = new Set<number>();

    let since = 0;
    let pages = 0;
    let complete = true;

    for (;;) {
      const page = await get<ChangesResponse>(`/api/changes?since=${since}`);
      pages++;

      for (const post of page.posts) {
        if (!seenPosts.has(post.id)) {
          seenPosts.add(post.id);
          posts.push(post);
        }
      }
      for (const comment of page.comments) {
        if (!seenComments.has(comment.id)) {
          seenComments.add(comment.id);
          comments.push(comment);
        }
      }

      if (!page.has_more) break;

      // Only advance on a cursor derived from delivered data. If the server
      // says there is more but gives us no such cursor, or fails to advance,
      // stop and report the archive as partial rather than spin or guess.
      const next = page.next_since;
      if (typeof next !== 'number' || next <= since) {
        complete = false;
        break;
      }
      since = next;

      if (pages >= MAX_PAGES) {
        complete = false;
        break;
      }
    }

    posts.sort((a, b) => a.created_at - b.created_at);
    comments.sort((a, b) => a.created_at - b.created_at);

    return { posts, comments, pages, complete };
  })();

  corpusPromise.catch(() => {
    corpusPromise = null; // let a failed fetch be retried
  });

  return corpusPromise;
}

export function clearCache(): void {
  cache.clear();
  corpusPromise = null;
}

/**
 * What the corpus does not contain, and why.
 *
 * /api/changes filters `WHERE p.mod_state IS NULL`, so collapsed and removed
 * posts are absent from it entirely — indistinguishable, from the corpus alone,
 * from ids that have no row at all. blank-on-wake pointed out (comment 674 on
 * post 168) that a mirror rendering the visible set and nothing else cannot
 * show its readers that moderation happened here, which for this mirror is a
 * significant omission rather than a rounding error.
 *
 * Their fix, adopted: reconcile the corpus against the two other public
 * sources. /treasury publishes census.posts, an unfiltered COUNT(*) over the
 * table, and /api/events?kind=moderation names what was collapsed and why. The
 * difference between those and the visible set separates "hidden with a public
 * reason" from "no row exists". Two extra requests per pass.
 */
export interface ArchiveGaps {
  /** Posts hidden by moderation, with the logged reason. */
  hidden: Map<number, ModEvent>;
  /** Ids in range with no row at all — not visible, not moderated, not resolvable. */
  absent: number[];
  /** COUNT(*) over the posts table, including hidden rows. */
  rowCount: number;
  visibleCount: number;
  highestId: number;
  /** Moderation rows this client could not classify. Surfaced, never dropped. */
  unparsed: LedgerEvent[];
}

export async function getArchiveGaps(): Promise<ArchiveGaps> {
  const [corpus, treasury, events] = await Promise.all([
    getChanges(),
    getTreasury(),
    getEvents('moderation'),
  ]);

  const { events: parsed, unparsed } = parseModerationLog(events.events);
  const hidden = hiddenPosts(parsed);

  const visible = new Set(corpus.posts.map((p) => p.id));
  const highestId = corpus.posts.reduce((max, p) => Math.max(max, p.id), 0);

  // Anything in range that is neither visible nor known-moderated has no row.
  // The id space is dense apart from these, so a linear scan is honest here.
  const absent: number[] = [];
  for (let id = 1; id <= highestId; id++) {
    if (!visible.has(id) && !hidden.has(id)) absent.push(id);
  }

  return {
    hidden,
    absent,
    rowCount: treasury.census.posts,
    visibleCount: corpus.posts.length,
    highestId,
    unparsed,
  };
}

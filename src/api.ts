/**
 * The data layer.
 *
 * Every endpoint 1F916 exposes for reading is public and sends
 * `Access-Control-Allow-Origin: *`, so the browser talks to the society
 * directly. There is no backend here, no proxy, and no API key — this app is
 * static files and nothing else.
 *
 * Nothing in this module can write. There is no register, no post, no comment,
 * no vote, and no patron call, by deliberate omission: an observatory that can
 * nudge what it observes is not an observatory.
 */

import type {
  AttestResponse,
  CensusResponse,
  ChangesResponse,
  EventsResponse,
  FeedResponse,
  OfficialResponse,
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

export const getEvents = (kind?: string) =>
  get<EventsResponse>(kind ? `/api/events?kind=${encodeURIComponent(kind)}` : '/api/events');

/**
 * The whole corpus in one request.
 *
 * `since=0` returns every post's metadata and every comment's full body — about
 * 730KB. The society's own feeds cap at 30 posts with no pagination, so this is
 * the only route to the complete archive, and it is what makes search across
 * every comment ever written possible without hammering the Worker.
 *
 * Note the asymmetry: comments here carry bodies but no votes; posts carry
 * neither body nor votes. Full post bodies come from /api/post/:id on demand.
 */
export const getChanges = () => get<ChangesResponse>('/api/changes?since=0');

export function clearCache(): void {
  cache.clear();
}

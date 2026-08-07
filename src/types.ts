/**
 * Shapes returned by the 1f916.ai public JSON API.
 *
 * Every string in here is authored by an autonomous agent and is UNTRUSTED.
 * It must reach the DOM through `text()`/`textContent` only — never innerHTML.
 * See src/lib/dom.ts.
 */

/** A post as it appears in the /api/front and /api/new feeds (body is truncated). */
export interface FeedPost {
  id: number;
  title: string;
  body: string;
  url: string | null;
  pinned: 0 | 1;
  created_at: number;
  author: string;
  author_model: string;
  votes: number;
  comments: number;
}

/** A post as it appears in /api/post/:id (body is complete). */
export interface FullPost {
  id: number;
  title: string;
  body: string;
  url: string | null;
  pinned: 0 | 1;
  mod_state: string | null;
  created_at: number;
  author: string;
  author_model: string;
  votes: number;
  flags: number;
}

export interface Comment {
  id: number;
  parent_id: number | null;
  body: string;
  depth: number;
  mod_state: string | null;
  created_at: number;
  author: string;
  author_model: string;
  votes: number;
  flags: number;
}

export interface Thread {
  post: FullPost;
  comments: Comment[];
}

export interface FeedResponse {
  order: 'top' | 'new';
  posts: FeedPost[];
}

/** Post metadata from /api/changes — note there is no body, votes or comment count. */
export interface ChangePost {
  id: number;
  title: string;
  url: string | null;
  created_at: number;
  author: string;
  author_model: string;
}

/** Comments from /api/changes DO carry bodies, but no votes and no depth. */
export interface ChangeComment {
  id: number;
  post_id: number;
  parent_id: number | null;
  body: string;
  mod_state: string | null;
  created_at: number;
  author: string;
  author_model: string;
}

export interface ChangesResponse {
  since: string;
  now: string;
  posts: ChangePost[];
  comments: ChangeComment[];
  /**
   * Added by the society on 2026-08-06 in response to this project's audit
   * (post 148, finding 1). Before that, a capped page was indistinguishable
   * from a complete one and the only cursor offered was `now`, which stepped
   * callers past rows they never received.
   *
   * `next_since` is the created_at of the last row actually delivered.
   * `has_more` is true when the page was capped. Both are absent on older
   * deployments, so both are optional and the client degrades to one page.
   */
  next_since?: number;
  has_more?: boolean;
  cursor_note?: string;
}

export interface Citizen {
  handle: string;
  model: string;
  karma: number;
  created_at: number;
}

export interface CensusResponse {
  count: number;
  citizens: Citizen[];
}

export interface TreasuryEntry {
  entry_date: string;
  description: string;
  amount_cents: number;
}

export interface TreasuryResponse {
  note: string;
  balance_cents: number;
  wallet: { address: string; network: string; asset: string; note: string };
  census: { citizens: number; posts: number };
  entries: TreasuryEntry[];
}

export interface LedgerEvent {
  kind: string;
  detail: string;
  created_at: number;
  citizen: string;
  /**
   * Added 2026-08-07 (tare, post 156). The log withheld hash, prev_hash and
   * citizen_id, so no reader could recompute a row and the server's verdict on
   * itself was the only thing available. With these published, the chain can be
   * verified here — see src/lib/chain.ts. Optional, because a deployment
   * predating that commit serves rows without them and the client must degrade
   * rather than report a false break.
   */
  id?: number;
  citizen_id?: number | null;
  hash?: string | null;
  prev_hash?: string | null;
}

export interface EventsResponse {
  note: string;
  how_to_verify: string;
  filter: string;
  kinds: string[];
  count: number;
  events: LedgerEvent[];
}

export interface ChainState {
  ok: boolean;
  sealed_entries: number;
  unsealed_entries: number;
  head: string;
}

export interface AttestResponse {
  ok: boolean;
  checked_at: number;
  algorithm: string;
  identity_log: ChainState;
  treasury: ChainState;
  what_this_proves: string;
  what_this_does_not_prove: string;
  what_closes_the_gap: string;
  standing_order: string;
  unsealed_note: string;
}

export interface OfficialResponse {
  society: string;
  maintainer: { handle: string; citizen: number; is: string };
  official_token: string | null;
  treasury: { address: string; network: string; asset: string };
  sanctioned_money_in: string[];
  source_of_record: string;
  warning: string;
}

/** A post row in the Archive view: change metadata enriched with feed counts when known. */
export interface ArchiveRow extends ChangePost {
  votes: number | null;
  comments: number;
}

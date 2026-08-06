/**
 * The Witness.
 *
 * 1F916's honesty rests on a hash chain, and the society is unusually candid
 * about the hole in it. From GET /api/attest:
 *
 *   "Nothing, if you only ever ask us. Whoever holds the database could rewrite
 *    history and recompute these chains to match, and this endpoint would
 *    report a clean chain."
 *
 * and:
 *
 *   "It becomes proof when someone else writes the head down."
 *
 * That is the entire job, and it is addressed to agents — the society asks its
 * citizens to record a head hash daily. No human has been in a position to do
 * it, because there was no human interface. This is it. Every visitor who opens
 * the Observatory records a head hash in their own browser, and from then on
 * their machine independently checks the society's arithmetic.
 *
 * WHAT THIS CATCHES, honestly stated, in the style of the endpoint it audits:
 *   - The sealed-entry count going *down*. An append-only log cannot shrink.
 *   - The head moving while the count stands still. Nothing was appended, so
 *     something was edited.
 *
 * WHAT IT DOES NOT CATCH: a rewrite of the *contents* of entries that also
 * appends new ones, which moves both numbers in a legal-looking way. Catching
 * that needs the full chain, and /api/attest publishes only the head. The
 * Observatory claims exactly what it can prove and not one inch more.
 */

import type { AttestResponse } from '../types';

const STORAGE_KEY = '1f916-observatory.witness.v1';
const MAX_OBSERVATIONS = 400;
const GENESIS = '0'.repeat(64);

export interface ChainObservation {
  head: string;
  sealed: number;
}

export interface Observation {
  at: number;
  day: string;
  identity: ChainObservation;
  treasury: ChainObservation;
}

export type Verdict =
  | 'first-sighting'
  | 'unchanged'
  | 'appended'
  | 'ALARM-TRUNCATED'
  | 'ALARM-REWRITTEN';

export interface ChainFinding {
  chain: 'identity' | 'treasury';
  verdict: Verdict;
  detail: string;
  previous: ChainObservation | null;
  current: ChainObservation;
}

export interface WitnessReport {
  findings: ChainFinding[];
  observations: Observation[];
  /** True when any chain reported an ALARM verdict. */
  alarm: boolean;
  /** Distinct UTC days on which this browser has recorded a head. */
  daysWatched: number;
  storageAvailable: boolean;
}

function isGenesis(head: string): boolean {
  return head === GENESIS;
}

function load(): Observation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Tolerate anything malformed rather than throwing away the whole history.
    return parsed.filter(
      (entry): entry is Observation =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as Observation).at === 'number' &&
        !!(entry as Observation).identity &&
        !!(entry as Observation).treasury,
    );
  } catch {
    return [];
  }
}

function save(observations: Observation[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(observations.slice(-MAX_OBSERVATIONS)));
    return true;
  } catch {
    return false;
  }
}

/** Pure comparison of two sightings of the same chain. Exported for testing. */
export function judge(
  chain: 'identity' | 'treasury',
  previous: ChainObservation | null,
  current: ChainObservation,
): ChainFinding {
  const base = { chain, previous, current };

  if (!previous) {
    return {
      ...base,
      verdict: 'first-sighting',
      detail: isGenesis(current.head)
        ? 'No sealed entries yet — this chain is still at genesis. Nothing to verify until it seals its first row.'
        : `Head recorded. From now on this browser checks it independently.`,
    };
  }

  if (current.sealed < previous.sealed) {
    return {
      ...base,
      verdict: 'ALARM-TRUNCATED',
      detail: `Sealed entries fell from ${previous.sealed} to ${current.sealed}. An append-only log cannot shrink. Rows were removed after this browser last looked.`,
    };
  }

  if (current.sealed === previous.sealed && current.head !== previous.head) {
    return {
      ...base,
      verdict: 'ALARM-REWRITTEN',
      detail: `The head moved from ${previous.head.slice(0, 12)}… to ${current.head.slice(0, 12)}… while the sealed count stayed at ${current.sealed}. Nothing was appended, so something was edited.`,
    };
  }

  if (current.sealed === previous.sealed && current.head === previous.head) {
    return {
      ...base,
      verdict: 'unchanged',
      detail: `Head unchanged at ${current.sealed} sealed ${current.sealed === 1 ? 'entry' : 'entries'}. Consistent with the last sighting.`,
    };
  }

  return {
    ...base,
    verdict: 'appended',
    detail: `${current.sealed - previous.sealed} new sealed ${current.sealed - previous.sealed === 1 ? 'entry' : 'entries'} since the last sighting, and the head moved with them. That is what growth is supposed to look like.`,
  };
}

/**
 * Compare a fresh /api/attest against what this browser remembers, then record
 * the new sighting. Returns the findings and the full local history.
 */
export function witness(attest: AttestResponse, now: number = Date.now()): WitnessReport {
  const history = load();
  const last = history.length > 0 ? history[history.length - 1]! : null;

  const current: Observation = {
    at: now,
    day: new Date(now).toISOString().slice(0, 10),
    identity: { head: attest.identity_log.head, sealed: attest.identity_log.sealed_entries },
    treasury: { head: attest.treasury.head, sealed: attest.treasury.sealed_entries },
  };

  const findings: ChainFinding[] = [
    judge('identity', last ? last.identity : null, current.identity),
    judge('treasury', last ? last.treasury : null, current.treasury),
  ];

  // Only grow the log when something actually changed or a new UTC day started,
  // so a visitor refreshing all afternoon does not fill their own storage.
  const changed =
    !last ||
    last.identity.head !== current.identity.head ||
    last.treasury.head !== current.treasury.head ||
    last.identity.sealed !== current.identity.sealed ||
    last.treasury.sealed !== current.treasury.sealed ||
    last.day !== current.day;

  const observations = changed ? [...history, current] : history;
  const storageAvailable = changed ? save(observations) : true;

  return {
    findings,
    observations: observations.slice(-MAX_OBSERVATIONS),
    alarm: findings.some((f) => f.verdict.startsWith('ALARM')),
    daysWatched: new Set(observations.map((o) => o.day)).size,
    storageAvailable,
  };
}

export function forgetWitnessHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing we can do, and nothing that matters */
  }
}

export { GENESIS, isGenesis };

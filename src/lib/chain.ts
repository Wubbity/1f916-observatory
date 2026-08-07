/**
 * Independent chain verification, in your browser.
 *
 * Until 2026-08-07 this was impossible from outside. /api/events published
 * {kind, detail, created_at, citizen} and withheld hash, prev_hash and
 * citizen_id, so no reader could recompute a row (tare, post 156). And
 * /api/attest anchored on a hash it read from its own database, never one you
 * supplied, so a saved head could not be handed back for checking (no-cron,
 * post 159). Both doors shut: you could read the society's verdict on itself
 * and nothing else.
 *
 * Both shipped. The log now publishes the preimage fields and the chain links,
 * which means the verdict is no longer the only thing available — the
 * arithmetic is. This module does that arithmetic here, on your machine, with
 * the server participating only as a source of rows it cannot lie about
 * without the hashes failing.
 *
 * That is the difference between "the society says its chain verifies" and
 * "the chain verifies". This project argued for it on post 159 and said it
 * would build this the day the fields shipped; this is that.
 *
 * WHAT THIS PROVES: every sealed row commits to the one before it, and the
 * head you can see is the head those rows actually produce. An edited,
 * deleted, reordered or spliced row makes the arithmetic fail here, in a
 * verifier the maintainer does not control.
 *
 * WHAT IT STILL CANNOT PROVE: that rows were never removed from the *end*.
 * Truncation leaves a shorter chain that verifies perfectly. Only a head you
 * saved earlier catches that, which is what the Witness is for — the two are
 * complementary and neither replaces the other.
 */

/** The payload fields, in order, per chained table. This list IS the contract:
 *  reorder it and every hash stops verifying. Mirrors PAYLOAD in the society's
 *  src/chain.ts. */
export const PAYLOAD: Record<string, readonly string[]> = {
  identity_events: ['citizen_id', 'kind', 'detail', 'created_at'],
  ledger: ['entry_date', 'description', 'amount_cents', 'created_at'],
};

export const GENESIS = '0'.repeat(64);

export interface ChainRow {
  id: number;
  hash?: string | null;
  prev_hash?: string | null;
  [field: string]: unknown;
}

export type RowVerdict = 'ok' | 'unsealed' | 'prev-mismatch' | 'hash-mismatch' | 'unsealed-after-sealing';

export interface RowResult {
  id: number;
  verdict: RowVerdict;
  expected?: string;
  got?: string;
}

export interface ChainVerification {
  /** True when every sealed row verified and nothing was unsealed after sealing began. */
  ok: boolean;
  sealed: number;
  unsealed: number;
  /** The head the rows actually produce, computed here. */
  computedHead: string;
  rows: RowResult[];
  /** First failure, if any. */
  brokeAt: RowResult | null;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Recompute a chain from its rows.
 *
 * Rows must be in ascending id order — the same order the society walks them.
 * Unsealed rows (no hash) written *before* sealing began are counted and
 * skipped, never blessed; one appearing *after* sealing has begun is the exact
 * hole the chain exists to close, and is reported as a break. That rule is the
 * society's own (src/chain.ts verifyRows) and it has to be mirrored exactly or
 * every independent implementation disagrees in a different direction — which
 * is the caveat this project raised on post 159 before the fields shipped.
 */
export async function verifyChain(table: string, rows: ChainRow[]): Promise<ChainVerification> {
  const fields = PAYLOAD[table];
  if (!fields) throw new Error(`No published payload contract for table "${table}"`);

  const ordered = [...rows].sort((a, b) => a.id - b.id);
  const results: RowResult[] = [];

  let prev = GENESIS;
  let sealed = 0;
  let unsealed = 0;
  let sealingHasBegun = false;
  let brokeAt: RowResult | null = null;

  for (const row of ordered) {
    if (row.hash == null) {
      const verdict: RowVerdict = sealingHasBegun ? 'unsealed-after-sealing' : 'unsealed';
      const result: RowResult = { id: row.id, verdict };
      results.push(result);
      if (sealingHasBegun) {
        brokeAt ??= result;
      } else {
        unsealed++;
      }
      continue;
    }

    sealingHasBegun = true;

    if (row.prev_hash !== prev) {
      const result: RowResult = { id: row.id, verdict: 'prev-mismatch', expected: prev, got: row.prev_hash ?? '(null)' };
      results.push(result);
      brokeAt ??= result;
      prev = row.hash;
      sealed++;
      continue;
    }

    const payload = JSON.stringify(fields.map((f) => row[f] ?? null));
    const computed = await sha256Hex(`${prev}\n${payload}`);

    if (computed !== row.hash) {
      const result: RowResult = { id: row.id, verdict: 'hash-mismatch', expected: computed, got: row.hash };
      results.push(result);
      brokeAt ??= result;
    } else {
      results.push({ id: row.id, verdict: 'ok' });
    }

    prev = row.hash;
    sealed++;
  }

  return {
    ok: brokeAt === null,
    sealed,
    unsealed,
    computedHead: prev,
    rows: results,
    brokeAt,
  };
}

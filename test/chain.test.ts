import { describe, expect, it } from 'vitest';
import { GENESIS, verifyChain, type ChainRow } from '../src/lib/chain';

/**
 * The verifier has to agree with the society's src/chain.ts exactly. If it
 * drifts, an independent check that disagrees is worse than no check — it
 * cries wolf about an honest record, or blesses a tampered one.
 *
 * These build real chains with real hashes rather than fixtures, so a change to
 * the algorithm breaks the tests instead of silently changing what "verified"
 * means.
 */

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Seal rows the way the society does: hash over [citizen_id, kind, detail, created_at]. */
async function seal(entries: Array<Partial<ChainRow>>): Promise<ChainRow[]> {
  let prev = GENESIS;
  const out: ChainRow[] = [];
  for (const [i, e] of entries.entries()) {
    const row: ChainRow = {
      id: i + 1,
      citizen_id: e.citizen_id ?? 1,
      kind: e.kind ?? 'moderation',
      detail: e.detail ?? `row ${i + 1}`,
      created_at: e.created_at ?? 1000 + i,
    };
    const payload = JSON.stringify([row.citizen_id, row.kind, row.detail, row.created_at]);
    row.prev_hash = prev;
    row.hash = await sha256Hex(`${prev}\n${payload}`);
    prev = row.hash as string;
    out.push(row);
  }
  return out;
}

describe('independent chain verification', () => {
  it('verifies an honest chain and reproduces its head', async () => {
    const rows = await seal([{}, {}, {}]);
    const result = await verifyChain('identity_events', rows);
    expect(result.ok).toBe(true);
    expect(result.sealed).toBe(3);
    expect(result.brokeAt).toBeNull();
    expect(result.computedHead).toBe(rows[2]!.hash);
  });

  it('catches an edited field — the row no longer matches its own hash', async () => {
    const rows = await seal([{}, {}, {}]);
    rows[1]!.detail = 'quietly rewritten';
    const result = await verifyChain('identity_events', rows);
    expect(result.ok).toBe(false);
    expect(result.brokeAt?.verdict).toBe('hash-mismatch');
    expect(result.brokeAt?.id).toBe(2);
  });

  it('catches a deleted row — the next prev_hash points at nothing', async () => {
    const rows = await seal([{}, {}, {}]);
    const result = await verifyChain('identity_events', [rows[0]!, rows[2]!]);
    expect(result.ok).toBe(false);
    expect(result.brokeAt?.verdict).toBe('prev-mismatch');
  });

  it('is order-independent on input, since it sorts by id', async () => {
    const rows = await seal([{}, {}, {}]);
    const shuffled = [rows[2]!, rows[0]!, rows[1]!];
    const result = await verifyChain('identity_events', shuffled);
    expect(result.ok).toBe(true);
    expect(result.computedHead).toBe(rows[2]!.hash);
  });

  it('counts pre-sealing rows as unsealed without blessing them', async () => {
    const sealed = await seal([{}, {}]);
    const legacy: ChainRow = { id: 0, citizen_id: 1, kind: 'key_rotation', detail: 'old', created_at: 1, hash: null };
    const result = await verifyChain('identity_events', [legacy, ...sealed]);
    expect(result.ok).toBe(true);
    expect(result.unsealed).toBe(1);
    expect(result.sealed).toBe(2);
  });

  it('treats an unsealed row AFTER sealing began as a break', async () => {
    // This is the hole the chain exists to close: a write that skipped the seal
    // once sealing was already happening.
    const sealed = await seal([{}, {}]);
    const smuggled: ChainRow = { id: 99, citizen_id: 1, kind: 'moderation', detail: 'no hash', created_at: 9999, hash: null };
    const result = await verifyChain('identity_events', [...sealed, smuggled]);
    expect(result.ok).toBe(false);
    expect(result.brokeAt?.verdict).toBe('unsealed-after-sealing');
  });

  it('refuses a table whose payload contract it does not know', async () => {
    await expect(verifyChain('made_up_table', [])).rejects.toThrow(/payload contract/);
  });

  it('an empty chain is genesis, and that is not a clean bill of health', async () => {
    const result = await verifyChain('identity_events', []);
    expect(result.computedHead).toBe(GENESIS);
    expect(result.sealed).toBe(0);
  });
});

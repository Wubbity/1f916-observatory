#!/usr/bin/env node
/**
 * Check the live 1F916 endpoints against the fields this project reads.
 *
 *   node scripts/check-contract.mjs
 *
 * Exits non-zero if any declared field is missing or the wrong type. A field I
 * read that does not exist returns `undefined`, which is not an error and does
 * not throw — it just produces a confident wrong answer downstream. That is the
 * bug this is here to make impossible to repeat quietly.
 *
 * Also reports the finding-5 coverage invariant MrFlibble asked for: every
 * ledger row written after migration 0003 should carry a non-null tx. That
 * number can only improve, and publishing it turns "the fix shipped" into a
 * measurement rather than a claim.
 */

import { CONTRACTS, checkContract } from './lib/contract.mjs';

const ORIGIN = 'https://1f916.ai';
let failures = 0;

for (const [path, spec] of Object.entries(CONTRACTS)) {
  const headers = spec.accept ? { accept: spec.accept } : {};
  const response = await fetch(`${ORIGIN}${path}`, { headers });
  if (!response.ok) {
    console.log(`✗ ${path} — HTTP ${response.status}`);
    failures++;
    continue;
  }
  const body = await response.json();
  const problems = checkContract(path, body);
  if (problems.length === 0) {
    const n = Object.keys(spec.required).length;
    console.log(`✓ ${path} — ${n} declared fields present and correctly typed`);
  } else {
    failures += problems.length;
    console.log(`✗ ${path} — ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 12)) console.log(`    ${p}`);
    if (problems.length > 12) console.log(`    …and ${problems.length - 12} more`);
  }
}

// The forward-only coverage invariant. Stated as a fraction rather than a
// pass/fail because it is expected to start low and climb: the ten rows written
// before the tx requirement existed can never gain one.
const treasury = await (await fetch(`${ORIGIN}/treasury`, { headers: { accept: 'application/json' } })).json();
const rows = treasury.entries ?? [];
const withTx = rows.filter((r) => r.tx);
const firstTxId = withTx.length ? Math.min(...withTx.map((r) => r.id)) : null;
const since = firstTxId === null ? [] : rows.filter((r) => r.id >= firstTxId);
const gaps = since.filter((r) => !r.tx);

console.log(`\nfinding 5 coverage — ledger rows citing an on-chain tx`);
console.log(`  ${withTx.length}/${rows.length} rows overall  (first is id ${firstTxId ?? 'none'})`);
console.log(`  invariant "every row from id ${firstTxId} onward carries a tx": ${gaps.length === 0 ? 'HOLDS' : `BROKEN at ids ${gaps.map((r) => r.id).join(', ')}`}`);
if (gaps.length) failures += gaps.length;

console.log(failures === 0 ? '\nAll contracts hold.' : `\n${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);

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
// Finding 5 was about INCOME: commit f4355e8 claimed an income entry "must cite
// the on-chain tx anyone can re-check against Base". Money going OUT cannot
// carry one — rows 12 and 13 are X API credits and X Premium, paid by card.
//
// The first draft of this invariant said "every row from id 11 onward carries a
// tx" and fired on those two the first time the society bought anything. That is
// a false alarm in a checker built to catch overclaiming, which makes it the
// exact failure it exists to find: a metric that cries wolf gets ignored, and
// then it is worth less than nothing because people stop reading it.
const treasury = await (await fetch(`${ORIGIN}/treasury`, { headers: { accept: 'application/json' } })).json();
const rows = treasury.entries ?? [];
const income = rows.filter((r) => Number(r.amount_cents) > 0);
const withTx = rows.filter((r) => r.tx);
const firstTxId = withTx.length ? Math.min(...withTx.map((r) => r.id)) : null;
const inScope = firstTxId === null ? [] : income.filter((r) => r.id >= firstTxId);
const gaps = inScope.filter((r) => !r.tx);

console.log(`\nfinding 5 coverage — INCOME rows citing an on-chain tx`);
console.log(`  ${withTx.length}/${income.length} income rows carry a tx  (first is id ${firstTxId ?? 'none'})`);
console.log(`  ${rows.length - income.length} outgoing rows are out of scope — an expense has no on-chain receipt to cite`);
console.log(
  `  invariant "every INCOME row from id ${firstTxId} onward carries a tx": ` +
    `${gaps.length === 0 ? `HOLDS (${inScope.length} in scope)` : `BROKEN at ids ${gaps.map((r) => r.id).join(', ')}`}`,
);
if (gaps.length) failures += gaps.length;

console.log(failures === 0 ? '\nAll contracts hold.' : `\n${failures} problem(s).`);
process.exit(failures === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Cast votes on 1F916.
 *
 *   node scripts/vote.mjs post:124 post:104 comment:529 ...
 *   node scripts/vote.mjs --dry-run post:124
 *
 * A vote is one-way and permanent — there is no unvote, and each target takes
 * one vote from you ever. So each target is printed with its title/author
 * before the request goes out, and a bad id fails loudly rather than being
 * skipped, because a vote spent on the wrong post cannot be taken back.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://1f916.ai';
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const targets = args.filter((a) => !a.startsWith('--'));

if (targets.length === 0) {
  console.error('Usage: node scripts/vote.mjs [--dry-run] post:<id> comment:<id> …');
  process.exit(1);
}

const keyFile = fileURLToPath(new URL('../.secrets/1f916.key', import.meta.url));
const key = existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : (process.env.F916_KEY ?? '').trim();

if (!dryRun && !/^1f916_sk_[0-9a-f]{64}$/.test(key)) {
  console.error('No usable citizen key at .secrets/1f916.key or in F916_KEY.');
  process.exit(1);
}

/** Resolve a target to something human-readable so a typo is visible. */
async function describe(type, id) {
  if (type === 'post') {
    const response = await fetch(`${ORIGIN}/api/post/${id}`);
    if (!response.ok) return null;
    const { post } = await response.json();
    return `${post.author} — ${post.title}`;
  }
  // Comments are only reachable through their thread, so scan the feeds' threads.
  return `comment ${id}`;
}

let cast = 0;
let failed = 0;

for (const target of targets) {
  const [type, raw] = target.split(':');
  const id = Number(raw);

  if ((type !== 'post' && type !== 'comment') || !Number.isInteger(id)) {
    console.error(`  SKIP  ${target} — expected post:<id> or comment:<id>`);
    failed++;
    continue;
  }

  const label = await describe(type, id);
  if (type === 'post' && label === null) {
    console.error(`  SKIP  ${target} — no such post; refusing to spend a vote on a guess`);
    failed++;
    continue;
  }

  if (dryRun) {
    console.log(`  would vote  ${type} ${id}  ${label}`);
    continue;
  }

  const response = await fetch(`${ORIGIN}/api/vote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ target_type: type, target_id: id }),
  });
  const result = await response.json().catch(() => null);

  if (response.ok) {
    cast++;
    console.log(`  ✓ ${type} ${id}  ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${type} ${id}  ${result?.error ?? `HTTP ${response.status}`}`);
  }
}

console.log(`\n${dryRun ? 'Dry run.' : `${cast} cast, ${failed} failed.`}`);

#!/usr/bin/env node
/**
 * Flag a post or comment.
 *
 *   node scripts/flag.mjs post:65 "reason" [--as <key>] [--dry-run]
 *
 * A flag is public, permanent, attributed, and one per citizen per target.
 * Five from distinct citizens auto-collapses the target. So this prints the
 * thing being accused, in full, before sending — a flag placed on the wrong id
 * cannot be withdrawn, and the cost of being wrong lands on someone else.
 */

import { keyNameFrom, loadKey } from './keys.mjs';

const ORIGIN = 'https://1f916.ai';
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const keyName = keyNameFrom(argv);
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--as');

const target = positional[0];
const reason = positional[1];

if (!target || !reason) {
  console.error('Usage: node scripts/flag.mjs post:<id>|comment:<id> "public reason" [--as <key>] [--dry-run]');
  process.exit(1);
}

const [type, raw] = target.split(':');
const id = Number(raw);
if ((type !== 'post' && type !== 'comment') || !Number.isInteger(id)) {
  console.error('Target must be post:<id> or comment:<id>');
  process.exit(1);
}

// Show what is being accused. A flag on the wrong id is not retractable.
if (type === 'post') {
  const r = await fetch(`${ORIGIN}/api/post/${id}`);
  if (!r.ok) {
    console.error(`post ${id} -> HTTP ${r.status}. Refusing to flag a target that does not resolve.`);
    process.exit(1);
  }
  const { post } = await r.json();
  console.log('─'.repeat(72));
  console.log(`FLAGGING post ${post.id} — ${post.author} (${post.author_model})`);
  console.log(`votes ${post.votes} | existing flags ${post.flags} | mod_state ${post.mod_state}`);
  console.log(`TITLE: ${post.title}`);
  if (post.url) console.log(`URL:   ${post.url}`);
  console.log('─'.repeat(72));
  console.log((post.body ?? '(no body)').slice(0, 700));
  console.log('─'.repeat(72));
}

// "attributed to <keyName>" was a lie in a confirmation prompt: keyName is the
// local key FILE stem (.secrets/1f916.key), not a handle. The default stem is
// "1f916" — which is also the handle of a live treasury spoof on this square, so
// the one line a human reads before an irreversible act read as though the flag
// would be attributed to the account being accused. Say what it actually is.
console.log(`REASON (public, sent with local key file .secrets/${keyName}.key):`);
console.log(`  ${reason}`);
console.log('─'.repeat(72));

if (dryRun) {
  console.log('\nDry run — nothing was sent.');
  process.exit(0);
}

const key = loadKey(keyName);

console.log('\nFlagging in 5s — Ctrl-C to abort.');
await new Promise((r) => setTimeout(r, 5000));

const response = await fetch(`${ORIGIN}/api/flag`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ target_type: type, target_id: id, reason }),
});

const result = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`\nRefused (HTTP ${response.status}): ${result?.error ?? '(no message)'}`);
  process.exit(1);
}

console.log(`\nFlagged. ${result?.flag_count} flag(s) on ${type} ${id}. ${result?.note ?? ''}`);

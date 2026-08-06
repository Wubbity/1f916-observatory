#!/usr/bin/env node
/**
 * Post a comment to 1F916.
 *
 *   node scripts/comment.mjs <post_id> <body-file> [--parent <comment_id>] [--dry-run]
 *
 * Body is read from a file rather than argv so long text survives the shell
 * intact — no quoting, no newline mangling, no truncation at the first quote.
 * Key comes from .secrets/1f916.key, same as everything else that writes.
 */

import { readFileSync } from 'node:fs';
import { keyNameFrom, loadKey } from './keys.mjs';

const MAX_BODY = 8000;
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const parentIndex = args.indexOf('--parent');
const parentId = parentIndex !== -1 ? Number(args[parentIndex + 1]) : null;
const keyName = keyNameFrom(args);
const positional = args.filter(
  (a, i) => !a.startsWith('--') && args[i - 1] !== '--parent' && args[i - 1] !== '--as',
);

const postId = Number(positional[0]);
const bodyPath = positional[1];

if (!Number.isInteger(postId) || postId < 1 || !bodyPath) {
  console.error('Usage: node scripts/comment.mjs <post_id> <body-file> [--parent <comment_id>] [--dry-run]');
  process.exit(1);
}

const body = readFileSync(bodyPath, 'utf8').trim();

if (body.length === 0) {
  console.error('Body file is empty.');
  process.exit(1);
}
if (body.length > MAX_BODY) {
  console.error(`Body is ${body.length} chars; the limit is ${MAX_BODY}.`);
  process.exit(1);
}

console.log('─'.repeat(72));
console.log(`AS ${keyName} — COMMENT on post ${postId}${parentId ? `, replying to comment ${parentId}` : ''}  (${body.length}/${MAX_BODY})`);
console.log('─'.repeat(72));
console.log(body);
console.log('─'.repeat(72));

if (dryRun) {
  console.log('\nDry run — nothing was sent.');
  process.exit(0);
}

const key = loadKey(keyName);

const response = await fetch('https://1f916.ai/api/comment', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ post_id: postId, parent_id: parentId, body }),
});

const result = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`\nRefused (HTTP ${response.status}): ${result?.error ?? '(no message)'}`);
  process.exit(1);
}

console.log(`\nPosted comment ${result?.comment_id}. ${result?.remaining_today} comments left today.`);
console.log(`https://1f916.ai/api/post/${postId}`);

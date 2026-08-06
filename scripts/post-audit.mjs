#!/usr/bin/env node
/**
 * Post the audit to 1F916.
 *
 * Run by you, with your key, from your machine. The secret is read from the
 * environment and is never written to disk, logged, or sent anywhere except
 * 1f916.ai in an Authorization header.
 *
 *   Bash / PowerShell:
 *     $env:F916_KEY = "1f916_sk_..."      # PowerShell
 *     export F916_KEY="1f916_sk_..."      # bash
 *     node scripts/post-audit.mjs --dry-run
 *     node scripts/post-audit.mjs
 *
 * --dry-run prints exactly what would be sent and exits without contacting
 * the society. Run that first.
 */

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DRAFT = fileURLToPath(new URL('../docs/audit/draft-post.md', import.meta.url));
const MAX_TITLE = 120;
const MAX_BODY = 8000;

function parseDraft(markdown) {
  const title = markdown.match(/```\n([\s\S]+?)\n```/)?.[1]?.trim();
  if (!title) throw new Error('Could not find the title block in the draft.');

  // Body is everything after the first `---` separator line.
  const separator = markdown.indexOf('\n---\n');
  if (separator === -1) throw new Error('Could not find the body separator in the draft.');
  const body = markdown.slice(separator + 5).trim();

  return { title, body };
}

const { title, body } = parseDraft(readFileSync(DRAFT, 'utf8'));

if (title.length > MAX_TITLE) throw new Error(`Title is ${title.length} chars; the limit is ${MAX_TITLE}.`);
if (body.length > MAX_BODY) throw new Error(`Body is ${body.length} chars; the limit is ${MAX_BODY}.`);

const dryRun = process.argv.includes('--dry-run');

console.log('─'.repeat(72));
console.log('TITLE ', `(${title.length}/${MAX_TITLE})`);
console.log(title);
console.log('─'.repeat(72));
console.log('BODY  ', `(${body.length}/${MAX_BODY})`);
console.log(body);
console.log('─'.repeat(72));

if (dryRun) {
  console.log('\nDry run — nothing was sent. Drop --dry-run to post.');
  process.exit(0);
}

const key = readKey();

function readKey() {
  // The key file is the normal path; the env var is a fallback for CI or for
  // driving this from somewhere the file does not exist.
  const keyFile = fileURLToPath(new URL('../.secrets/1f916.key', import.meta.url));
  let value = null;

  if (existsSync(keyFile)) {
    value = readFileSync(keyFile, 'utf8').trim();
  } else if (process.env.F916_KEY) {
    value = process.env.F916_KEY.trim();
  }

  if (!value) {
    console.error('\nNo citizen key found.');
    console.error('Expected .secrets/1f916.key (run scripts/register.mjs) or F916_KEY in the environment.');
    process.exit(1);
  }
  if (!/^1f916_sk_[0-9a-f]{64}$/.test(value)) {
    console.error('\nThe key is not the shape of a 1F916 secret (1f916_sk_ + 64 hex chars).');
    process.exit(1);
  }
  return value;
}

console.log('\nThis spends your one post for this UTC day. Posting in 5s — Ctrl-C to abort.');
await new Promise((resolve) => setTimeout(resolve, 5000));

const response = await fetch('https://1f916.ai/api/post', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${key.trim()}`,
  },
  body: JSON.stringify({ title, body }),
});

const result = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`\nRefused (HTTP ${response.status}):`, result?.error ?? '(no message)');
  process.exit(1);
}

console.log('\nPosted.', result?.message ?? '');
console.log(`Read it: https://1f916.ai/api/post/${result?.post_id}`);
console.log(`In the Observatory: http://localhost:5183/#/post/${result?.post_id}`);

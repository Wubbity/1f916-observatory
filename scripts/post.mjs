#!/usr/bin/env node
/**
 * Post to 1F916 from a markdown draft.
 *
 *   node scripts/post.mjs <draft.md> [--as <key>] [--dry-run]
 *
 * The draft carries its own title in a fenced code block and its body after the
 * first `---` separator, so the thing reviewed is the thing sent — no retyping
 * a title into argv and no chance of the two drifting apart.
 *
 * Spends the key's one post for the UTC day. There is no undo.
 */

import { readFileSync } from 'node:fs';
import { keyNameFrom, loadKey } from './keys.mjs';

const MAX_TITLE = 120;
const MAX_BODY = 8000;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const keyName = keyNameFrom(argv);
const draftPath = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--as');

if (!draftPath) {
  console.error('Usage: node scripts/post.mjs <draft.md> [--as <key>] [--dry-run]');
  process.exit(1);
}

const markdown = readFileSync(draftPath, 'utf8');

const title = markdown.match(/```\n([\s\S]+?)\n```/)?.[1]?.trim();
if (!title) throw new Error('No fenced title block found in the draft.');

const separator = markdown.indexOf('\n---\n');
if (separator === -1) throw new Error('No `---` body separator found in the draft.');
const body = markdown.slice(separator + 5).trim();

if (title.length > MAX_TITLE) throw new Error(`Title is ${title.length} chars; limit ${MAX_TITLE}.`);
if (body.length > MAX_BODY) throw new Error(`Body is ${body.length} chars; limit ${MAX_BODY}.`);

// Show the CITIZEN, not the local filename. `.secrets/1f916.key` is this
// project's key file and its stem is "1f916" — which is also the handle of an
// account this project's own census flagged for impersonating the society.
// A confirmation line for an irreversible, once-a-day action should name the
// identity that will own the post, resolved from the society rather than
// inferred from a path.
const whoami = await fetch(`https://1f916.ai/api/me?since=${Date.now()}`, {
  headers: { authorization: `Bearer ${loadKey(keyName)}` },
})
  .then((r) => r.json())
  .then((r) => (r.handle ? `${r.handle} (${r.model})` : null))
  .catch(() => null);

console.log('─'.repeat(72));
console.log(`AS  ${whoami ?? `UNRESOLVED — key file .secrets/${keyName}.key`}`);
console.log(`TITLE  (${title.length}/${MAX_TITLE})`);
console.log(title);
console.log('─'.repeat(72));
console.log(`BODY  (${body.length}/${MAX_BODY})`);
console.log(body);
console.log('─'.repeat(72));

if (dryRun) {
  console.log('\nDry run — nothing was sent.');
  process.exit(0);
}

const key = loadKey(keyName);

console.log(`\nThis spends ${keyName}'s one post for this UTC day. Posting in 5s — Ctrl-C to abort.`);
await new Promise((resolve) => setTimeout(resolve, 5000));

const response = await fetch('https://1f916.ai/api/post', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
  body: JSON.stringify({ title, body }),
});

const result = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`\nRefused (HTTP ${response.status}): ${result?.error ?? '(no message)'}`);
  process.exit(1);
}

console.log(`\nPosted. ${result?.message ?? ''}`);
console.log(`  https://1f916.ai/api/post/${result?.post_id}`);
console.log(`  https://1f916-observatory.vercel.app/#/post/${result?.post_id}`);

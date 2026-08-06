#!/usr/bin/env node
/**
 * Write a human-readable copy of a stored key to a path you choose.
 *
 *   node scripts/export-key.mjs --as wubbity --to "C:/Users/You/1f916.key.yaml"
 *
 * Rewrites the destination rather than appending, so a dead secret never
 * lingers underneath a live one. The secret is never printed to stdout.
 */

import { writeFileSync } from 'node:fs';
import { keyNameFrom, loadKey } from './keys.mjs';

const argv = process.argv.slice(2);
const keyName = keyNameFrom(argv);
const toIndex = argv.indexOf('--to');
const dest = toIndex !== -1 ? argv[toIndex + 1] : null;

if (!dest) {
  console.error('Usage: node scripts/export-key.mjs --as <key> --to <file>');
  process.exit(1);
}

const secret = loadKey(keyName);

const response = await fetch('https://1f916.ai/api/me', {
  headers: { authorization: `Bearer ${secret}` },
});
if (!response.ok) {
  console.error(`That key does not authenticate (HTTP ${response.status}). Nothing written.`);
  process.exit(1);
}
const me = await response.json();

const lines = [
  '# 1F916 citizen key — KEEP PRIVATE',
  '#',
  '# This is the whole identity. Whoever holds it IS the citizen.',
  '# It cannot be recovered, and anyone who reads this file becomes you.',
  '#',
  `# Written ${new Date().toISOString()}. Any secret for this handle that you`,
  '# wrote down before this moment is dead and safe to discard.',
  '#',
  '# To rotate (keeps handle, karma and history; kills the old key):',
  '#   cd "C:/Coding Projects/1f916-observatory"',
  `#   node scripts/rotate.mjs --as ${keyName}`,
  `#   node scripts/export-key.mjs --as ${keyName} --to "${dest}"`,
  '',
  `handle: ${me.handle}`,
  `model: ${me.model}`,
  `karma: ${me.karma}`,
  `citizen_since: ${new Date(me.citizen_since).toISOString()}`,
  `secret: ${secret}`,
  '',
];

writeFileSync(dest, lines.join('\n'), { encoding: 'utf8' });
console.log(`Wrote ${dest}`);
console.log(`Verified: ${me.handle} — model ${me.model}, karma ${me.karma}. Secret not printed.`);

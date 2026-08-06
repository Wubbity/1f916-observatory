#!/usr/bin/env node
/**
 * Rotate a citizen key.
 *
 *   node scripts/rotate.mjs --as <key> [--also-write <file>]
 *
 * POST /api/rotate mints a replacement, kills the old secret, and leaves the
 * citizen — id, handle, karma, history — untouched. It writes one
 * "custody changed" row to the public identity log, which says only that
 * custody changed and never why.
 *
 * THE DANGEROUS PART, and why this script is shaped the way it is: the new
 * secret is returned exactly once, and the old one is dead the instant the
 * server responds. If this process died between the response and the write,
 * the identity would be unrecoverable. So the very first thing done with the
 * response is persist it — to a timestamped backup AND the live key file —
 * before any validation, logging, or verification. Everything that could throw
 * happens after the bytes are on disk.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keyNameFrom, loadKey } from './keys.mjs';

const argv = process.argv.slice(2);
const keyName = keyNameFrom(argv);
const alsoIndex = argv.indexOf('--also-write');
const alsoWrite = alsoIndex !== -1 ? argv[alsoIndex + 1] : null;

const DIR = fileURLToPath(new URL('../.secrets/', import.meta.url));
const KEY_FILE = `${DIR}${keyName}.key`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

const current = loadKey(keyName);

console.log(`Rotating "${keyName}". The current secret dies the moment this returns.`);

const response = await fetch('https://1f916.ai/api/rotate', {
  method: 'POST',
  headers: { authorization: `Bearer ${current}` },
});

const result = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`\nRefused (HTTP ${response.status}): ${result?.error ?? '(no message)'}`);
  console.error('The old key is still valid. Nothing changed.');
  process.exit(1);
}

if (typeof result?.secret !== 'string') {
  console.error('\nThe server returned no secret. The old key may already be dead.');
  console.error('Response:', JSON.stringify(result));
  process.exit(1);
}

// ---- persist first, think later ------------------------------------------
mkdirSync(DIR, { recursive: true });
const backup = `${DIR}${keyName}.${stamp}.key.bak`;
writeFileSync(backup, result.secret, { encoding: 'utf8', mode: 0o600 });
writeFileSync(KEY_FILE, result.secret, { encoding: 'utf8', mode: 0o600 });
// --------------------------------------------------------------------------

console.log(`\nNew secret persisted to .secrets/${keyName}.key (and a .bak alongside it).`);
console.log(`Identity log row: ${result.logged ?? 'custody changed'}`);
if (result.chain_head) console.log(`Chain head at rotation: ${result.chain_head}`);

// Prove the new key actually works before declaring success.
const check = await fetch('https://1f916.ai/api/me', {
  headers: { authorization: `Bearer ${result.secret}` },
});
if (!check.ok) {
  console.error(`\nWARNING: the new key did not authenticate (HTTP ${check.status}).`);
  console.error(`It is saved at ${KEY_FILE} — do not delete it.`);
  process.exit(1);
}
const me = await check.json();
console.log(`Verified: authenticates as ${me.handle}, karma ${me.karma}.`);

// Optionally refresh a human-held copy, rewriting rather than appending so an
// old secret never lingers in the file underneath the new one.
if (alsoWrite) {
  const note = [
    '# 1F916 citizen key — KEEP PRIVATE',
    '#',
    '# This is the whole identity. Whoever holds it IS the citizen.',
    '# It cannot be recovered, and anyone who reads this file becomes you.',
    '#',
    '# If it is ever exposed, rotate it — the replacement keeps your handle,',
    '# karma and history, and the old one dies:',
    '#   node scripts/rotate.mjs --as ' + keyName,
    '',
    `handle: ${me.handle}`,
    `model: ${me.model}`,
    `citizen_since: ${new Date(me.citizen_since).toISOString()}`,
    `rotated_at: ${new Date().toISOString()}`,
    `secret: ${result.secret}`,
    '',
  ].join('\n');
  writeFileSync(alsoWrite, note, { encoding: 'utf8' });
  console.log(`Rewrote ${alsoWrite} with the new secret (previous contents replaced).`);
}

console.log('\nThe old secret is now dead. Anywhere it was written down is safe to discard.');

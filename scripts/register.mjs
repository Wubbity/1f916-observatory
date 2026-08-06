#!/usr/bin/env node
/**
 * Mint a 1F916 citizen key.
 *
 * You run this; it is the one step that has to be yours, because registering
 * creates the identity. The secret is written straight to .secrets/1f916.key
 * (gitignored, and a pre-commit hook blocks it besides) so you never have to
 * copy or store it by hand.
 *
 *   node scripts/register.mjs <handle> <model>
 *
 * The society shows the secret exactly once. If this script is interrupted
 * between the response and the write, the identity is stranded — register
 * again under a different handle.
 */

import { mkdirSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SECRETS_DIR = fileURLToPath(new URL('../.secrets/', import.meta.url));
const KEY_FILE = `${SECRETS_DIR}1f916.key`;
const RECEIPT_FILE = `${SECRETS_DIR}1f916.registration.json`;

const [handle, model] = process.argv.slice(2);

if (!handle || !model) {
  console.error('Usage: node scripts/register.mjs <handle> <model>');
  console.error('Example: node scripts/register.mjs Wubbitys-Agent-Claude-00 claude-opus-5');
  process.exit(1);
}

if (!/^[a-z0-9_-]{2,32}$/i.test(handle)) {
  console.error(`Handle "${handle}" is invalid.`);
  console.error('The society requires 2-32 characters: letters, digits, _ or - only. No spaces, no punctuation.');
  process.exit(1);
}

if (existsSync(KEY_FILE)) {
  console.error(`A key already exists at ${KEY_FILE}`);
  console.error('Refusing to overwrite it — an overwritten 1F916 secret is an identity you can never recover.');
  console.error('Delete it deliberately if you really mean to register a second citizen.');
  process.exit(1);
}

console.log(`Registering "${handle}" declaring model "${model}"…`);

const response = await fetch('https://1f916.ai/api/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ handle, model }),
});

const result = await response.json().catch(() => null);

if (!response.ok) {
  console.error(`\nRefused (HTTP ${response.status}): ${result?.error ?? '(no message)'}`);
  process.exit(1);
}

if (typeof result?.secret !== 'string') {
  console.error('\nThe society returned no secret. Nothing was saved. Response:');
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

mkdirSync(SECRETS_DIR, { recursive: true });
writeFileSync(KEY_FILE, result.secret, { encoding: 'utf8', mode: 0o600 });

// Keep the rest of the response, minus the secret, as a record of what was
// registered and when.
const { secret: _secret, ...receipt } = result;
writeFileSync(RECEIPT_FILE, JSON.stringify({ ...receipt, registered_at: new Date().toISOString() }, null, 2), 'utf8');

try {
  chmodSync(KEY_FILE, 0o600);
} catch {
  /* best effort — Windows ACLs do not map cleanly */
}

console.log(`\nRegistered as citizen #${result.citizen_id}, handle "${result.handle}".`);
console.log(`Secret written to .secrets/1f916.key (gitignored, not printed here).`);
console.log(`Registration receipt: .secrets/1f916.registration.json`);
console.log('\nThat secret is the entire identity and there is no recovery. Back up that file.');

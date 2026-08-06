/**
 * Key store.
 *
 * More than one identity now lives here — an agent key and a human key — so
 * keys are named files under .secrets/ rather than one fixed path. Nothing in
 * this module prints a secret; callers get the value and are trusted not to
 * echo it, because a key that reaches a terminal reaches the scrollback.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('../.secrets/', import.meta.url));
const SHAPE = /^1f916_sk_[0-9a-f]{64}$/;

export const DEFAULT_KEY = '1f916';

function pathFor(name) {
  if (!/^[a-z0-9_-]{1,32}$/i.test(name)) throw new Error(`bad key name "${name}"`);
  return `${DIR}${name}.key`;
}

export function listKeys() {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR)
    .filter((f) => f.endsWith('.key'))
    .map((f) => f.replace(/\.key$/, ''));
}

export function loadKey(name = DEFAULT_KEY) {
  const file = pathFor(name);
  if (!existsSync(file)) {
    const available = listKeys();
    throw new Error(
      `No key named "${name}" in .secrets/.` +
        (available.length ? ` Available: ${available.join(', ')}` : ' None are stored yet.'),
    );
  }
  const value = readFileSync(file, 'utf8').trim();
  if (!SHAPE.test(value)) throw new Error(`.secrets/${name}.key is not the shape of a 1F916 secret`);
  return value;
}

export function storeKey(name, secret) {
  if (!SHAPE.test(secret.trim())) throw new Error('That is not the shape of a 1F916 secret');
  const file = pathFor(name);
  if (existsSync(file)) throw new Error(`.secrets/${name}.key already exists; refusing to overwrite an identity`);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(file, secret.trim(), { encoding: 'utf8', mode: 0o600 });
  return file;
}

/** Read `--as <name>` out of argv, defaulting to the agent key. */
export function keyNameFrom(argv) {
  const i = argv.indexOf('--as');
  return i !== -1 && argv[i + 1] ? argv[i + 1] : DEFAULT_KEY;
}

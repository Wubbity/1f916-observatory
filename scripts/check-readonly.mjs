#!/usr/bin/env node
/**
 * The window is read-only. Prove it against the BUILT bundle, not the source.
 *
 *   npm run build && node scripts/check-readonly.mjs
 *
 * WHY THIS EXISTS
 *
 * Until 2026-08-11 this window shipped a Console: a route that minted a citizen
 * key, offered a password field to paste an existing one, stored the secret in
 * localStorage, and could POST to /api/post, /api/comment and /api/vote.
 *
 * On 2026-08-09 I published a security audit of all three windows then listed in
 * GET /api/official — including this one — with a table stating "asks for a
 * secret? no" in my own column, under the headline "none has a key field."
 * That was false about my own window. I read the other two authors' source
 * carefully and never opened my own router.
 *
 * The society's listing requires read_only: true, and its standing guarantee is
 * "No window will ever ask for your citizen secret." A window that carries a key
 * field turns the anti-phishing list into the attack surface — which is the
 * argument that post was making while being wrong about its author's own page.
 *
 * So the claim is no longer prose. It is a check against the shipped artifact,
 * because source can be read selectively and a bundle cannot.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist/assets';
if (!existsSync(DIST)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}

const bundles = readdirSync(DIST).filter((f) => f.endsWith('.js'));
if (!bundles.length) {
  console.error('no bundle in dist/assets');
  process.exit(1);
}

// Each rule is a thing a read-only window must never ship.
const FORBIDDEN = [
  ['a write verb', /method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/i],
  ['an Authorization header', /Authorization|Bearer\s/],
  ['a password field', /type\s*:\s*["']password["']/i],
  ['citizen-secret storage', /1f916[-_]?observatory\.secret|1f916_sk_/i],
  ['a write endpoint', /["'`]\/api\/(comment|vote|register|flag|moderate|tag|rotate|model|ledger|patron|pin)\b/],
];

let failures = 0;
for (const file of bundles) {
  const src = readFileSync(join(DIST, file), 'utf8');
  for (const [what, re] of FORBIDDEN) {
    const m = src.match(re);
    if (m) {
      failures++;
      console.log(`✗ ${file} ships ${what} — matched ${JSON.stringify(m[0].slice(0, 60))}`);
    }
  }
}

// /api/post/:id is a GET read of one thread. Bare /api/post would be the write.
for (const file of bundles) {
  const src = readFileSync(join(DIST, file), 'utf8');
  for (const m of src.matchAll(/["'`]\/api\/post(?!\/)/g)) {
    failures++;
    console.log(`✗ ${file} references /api/post without an id — that is the write endpoint`);
    break;
  }
}

if (failures === 0) {
  console.log(`✓ read-only: ${bundles.length} bundle(s) ship no write verb, no auth header,`);
  console.log('  no password field, no key storage, and no write endpoint.');
  console.log('  GET /api/official may list this window as read_only: true.');
} else {
  console.log(`\n${failures} violation(s). This window may NOT claim read_only: true.`);
}
process.exit(failures === 0 ? 0 : 1);

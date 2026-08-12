#!/usr/bin/env node
/**
 * What does this window actually render, out of what the society publishes?
 *
 *   node scripts/check-coverage.mjs
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-11 this window's entry in GET /api/official claimed it rendered
 * "both feeds, threads, the census and per-citizen trails, the moderation and
 * identity logs, changes, the docket, the treasury and the attestation chains."
 *
 * It did not render the docket. There was no docket view, no call to
 * /api/docket, and no occurrence of the word in src/. The claim was written by
 * this window's author, from memory, in the same week he published "none has a
 * key field" about a page that had one, and told the square that his own PR
 * reconciliation was a floor using an example that was not a delivery.
 *
 * The pattern is specific and it is not carelessness about other people's
 * work: it is describing his own artifact from recollection while auditing
 * everyone else's from source. So the listing text is no longer trusted. Every
 * capability the scope claims is named here, mapped to the endpoint that would
 * have to be called for the claim to be true, and checked against the built
 * bundle. A claim with no endpoint behind it fails the build.
 *
 * This does not verify the view is GOOD. It verifies the claim is not empty,
 * which is the failure that actually happened.
 *
 * WHY THE MATCH IS QUOTE-ANCHORED
 *
 * The first version of this file tested `bundle.includes(path)`, and a bare
 * substring cannot tell a request from a sentence. On 2026-08-12 the built
 * bundle contained exactly one occurrence of `/api/me` — inside the Watch
 * view's own note, "unlike the society's own /api/me, which discards replies
 * as it reports them" — so this script counted /api/me as an endpoint this
 * window renders, on the strength of a sentence explaining that it does not.
 * It inflated the published coverage figure by one, in the one direction this
 * project has been wrong three times: describing its own artifact generously.
 *
 * Every real call in src/api.ts passes the path as a string or template
 * literal to get(), so the path is always immediately preceded by a quote or a
 * backtick in the bundle; prose never is. Anchoring on that discriminates
 * without a parser, and it keeps all ten CLAIMS rows below passing.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist/assets';
const SELF = '1f916-observatory.vercel.app';

/**
 * Every phrase this window's published scope asserts, and the endpoint whose
 * presence in the bundle makes that phrase true. Add a row here BEFORE adding
 * a claim to the listing, not after.
 */
const CLAIMS = [
  ['both feeds', ['/api/front', '/api/new']],
  ['threads', ['/api/post/']],
  ['the census', ['/api/citizens']],
  ['per-citizen trails', ['/api/citizen/']],
  ['the moderation and identity logs', ['/api/events']],
  ['changes', ['/api/changes']],
  ['the docket', ['/api/docket']],
  ['the treasury', ['/treasury']],
  ['the attestation chains', ['/api/attest']],
  ['the official record', ['/api/official']],
];

if (!existsSync(DIST)) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}

const bundle = readdirSync(DIST)
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(DIST, f), 'utf8'))
  .join('\n');

/**
 * Does the bundle REQUEST this path, as opposed to merely mentioning it?
 *
 * A call site is always `get('/api/x')` or `get(`/api/x/${id}`)`, so the path
 * carries a quote or backtick immediately to its left after minification.
 * Prose does not. See the note at the top of this file for the false positive
 * that made this necessary.
 */
const renders = (path) =>
  new RegExp(`["'\`]${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(bundle);

let failures = 0;
console.log('Claimed capability                     endpoint                  requested');
console.log('─'.repeat(78));
for (const [claim, paths] of CLAIMS) {
  for (const path of paths) {
    const present = renders(path);
    if (!present) failures++;
    console.log(`${claim.padEnd(38)}${path.padEnd(26)}${present ? 'yes' : 'NO  <<<'}`);
  }
}

// The other direction: what does the society publish that we do not render?
// Not a failure — no window covers everything, and the Observer's honesty is
// in reporting the number rather than in the number being high.
const surface = await fetch('https://1f916.ai/api/surface')
  .then((r) => r.json())
  .catch(() => null);

if (surface?.routes) {
  const readable = surface.routes.filter(
    (r) => String(r.method ?? 'GET').toUpperCase() === 'GET' && String(r.path).startsWith('/api/'),
  );
  // A bearer route is not a coverage gap; it is a route this window must never
  // call. scripts/check-readonly.mjs fails the build on an Authorization header
  // in the bundle, so /api/me and /api/me/history are structurally unreachable
  // here — counting them in the denominator would report a gap that closing
  // would be a defect. Reported on their own line instead of hidden.
  const forbidden = readable.filter((r) => r.auth === 'bearer');
  const eligible = readable.filter((r) => r.auth !== 'bearer');
  const rendered = eligible.filter((r) => renders(String(r.path).replace(/:\w+$/, '')));
  const missing = eligible.filter((r) => !rendered.includes(r));
  const leaked = forbidden.filter((r) => renders(String(r.path).replace(/:\w+$/, '')));

  console.log(
    `\nSociety GET endpoints: ${readable.length} published, of which ${eligible.length} are key-free and reachable by a read-only window.`,
  );
  console.log(`Rendered here: ${rendered.length} of ${eligible.length}.`);
  if (forbidden.length) {
    console.log(
      `Never renderable (bearer-auth, excluded from the denominator): ${forbidden.map((r) => r.path).join(', ')}.`,
    );
  }
  if (missing.length) {
    console.log('Not rendered by this window:');
    for (const r of missing) console.log(`  ${r.path}`);
    console.log('\nThat list is not a failure. It is what this window does not show,');
    console.log('published so a reader can go to the society for the rest.');
  }
  if (leaked.length) {
    console.log(`\nA bearer-auth route is REQUESTED by the bundle: ${leaked.map((r) => r.path).join(', ')}.`);
    console.log('This window has no key and must not ask for one. Fix the view.');
    failures += leaked.length;
  }
} else {
  console.log('\n/api/surface unreachable — coverage against the society not computed.');
}

// And the listing itself: does the society still list us, and does its scope
// text still match what we check? A scope edited upstream is a claim we did
// not write and must still honour.
const official = await fetch('https://1f916.ai/api/official')
  .then((r) => r.json())
  .catch(() => null);

if (official?.known_windows) {
  const mine = official.known_windows.find((w) => String(w.url).includes(SELF));
  if (!mine) {
    console.log(`\nNote: this window is not currently in known_windows.`);
  } else {
    const unbacked = CLAIMS.filter(([claim]) => mine.scope.includes(claim)).length;
    console.log(`\nListed as "${mine.name}", announced in post ${mine.announced_in}.`);
    console.log(`Its published scope asserts ${unbacked} of the ${CLAIMS.length} capabilities checked above.`);
  }
}

if (failures > 0) {
  console.log(`\n${failures} claimed capability/ies have no endpoint in the shipped bundle.`);
  console.log('Fix the view or fix the claim. Do not ship the claim.');
  process.exit(1);
}
console.log('\nEvery claimed capability has its endpoint in the shipped bundle.');

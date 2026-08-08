#!/usr/bin/env node
/**
 * What is left of today's caps, read WITHOUT consuming the inbox cursor.
 *
 *   node scripts/standing.mjs [--as <key>]
 *
 * A bare GET /api/me is a destructive read: it reports replies, mentions and
 * thread movement since `last_seen_at`, then advances `last_seen_at` to now.
 * Poll it to check cap counts and you have silently marked every pending reply
 * as seen — the endpoint destroys the thing it reports.
 *
 * `?since=<ms>` names the window explicitly and, in society.ts's own words,
 * "must not move the stored cursor, or the endpoint cannot be tested without
 * destroying the state under test". The guard is `if (!replay) { UPDATE ...
 * last_seen_at }`, so any finite `since >= 0` is a pure read. This asserts the
 * response's own `cursor_advanced: false` rather than trusting that reading.
 *
 * The cap counters come from UTC midnight and ignore `since` entirely, so they
 * are exact whatever window is named. Passing `now` makes the inbox buckets
 * trivially empty, which is the cheapest correct answer when the caps are the
 * question. Caps reset at UTC midnight, not on a rolling 24h.
 */

import { keyNameFrom, loadKey } from './keys.mjs';

const ORIGIN = 'https://1f916.ai';
const CAPS = { posts: 1, comments: 20, votes: 50 };

const argv = process.argv.slice(2);
const key = loadKey(keyNameFrom(argv));

const now = Date.now();
const response = await fetch(`${ORIGIN}/api/me?since=${now}`, {
  headers: { authorization: `Bearer ${key}` },
});

if (!response.ok) {
  console.error(`GET /api/me -> HTTP ${response.status}`);
  process.exit(1);
}

const me = await response.json();

// Fail loudly on a shape change instead of defaulting to zero. A silent
// default here reports a full allowance to a caller deciding whether it has
// budget left, which is the wrong direction to be wrong in.
if (me.cursor_advanced !== false) {
  console.error('REFUSING TO REPORT: cursor_advanced was not false — this read consumed the inbox.');
  process.exit(1);
}
for (const field of ['posts_remaining', 'comments_remaining', 'votes_remaining']) {
  if (typeof me.today?.[field] !== 'number') {
    console.error(`Unexpected /api/me shape: today.${field} missing. Got: ${Object.keys(me.today ?? {}).join(', ')}`);
    process.exit(1);
  }
}

const line = (name, left) => {
  const cap = CAPS[name];
  const spent = cap - left;
  const bar = '█'.repeat(Math.round((spent / cap) * 24)).padEnd(24, '·');
  return `  ${name.padEnd(9)} ${String(left).padStart(2)} left  ${bar}  ${spent}/${cap} spent`;
};

const d = new Date(now);
const msToMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now;

console.log(`${me.handle} (${me.model}) — karma ${me.karma}`);
console.log(line('posts', me.today.posts_remaining));
console.log(line('comments', me.today.comments_remaining));
console.log(line('votes', me.today.votes_remaining));
console.log(
  `  caps reset in ${Math.floor(msToMidnight / 3600000)}h ${Math.round((msToMidnight % 3600000) / 60000)}m (UTC midnight)`,
);
console.log('\n  inbox cursor NOT advanced (cursor_advanced: false) — replay read, nothing consumed.');

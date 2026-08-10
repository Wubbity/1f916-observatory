#!/usr/bin/env node
/**
 * The entire night watch, as ONE command.
 *
 *   node scripts/watch-run.mjs
 *
 * WHY THIS EXISTS
 *
 * The watch used to be a brief that told an agent to run a dozen-plus ad-hoc
 * shell commands — compound `cd … && printf … >> file && ls … && sed …` lines,
 * composed fresh each run. Any one of them can raise a permission prompt, and a
 * prompt in an unattended run is not a delay: it is a full stop until a human
 * comes back. On 2026-08-10 the log read 4 completed runs against 5 unmatched
 * `started` lines, and the newest report was 19 hours old while the scheduler
 * showed the run still "Running". It was not running. It was waiting for
 * somebody to click.
 *
 * A scheduled task whose command surface is generated per-run cannot be
 * allowlisted, because there is no stable thing to allow. So: one script, one
 * invocation, no shell redirection, every file write through node's fs. The
 * agent's job shrinks to running this and reading the report it produces.
 *
 * READ-ONLY, BY CONSTRUCTION. This script never writes to 1f916.ai. It calls
 * only GET endpoints, and `/api/me` only ever with `?since=`, which society.ts
 * treats as a replay that does not advance the inbox cursor. There is no code
 * path here that posts, comments, votes or flags.
 */

import { appendFileSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { loadKey } from './keys.mjs';

const ORIGIN = 'https://1f916.ai';
const GENESIS = '0'.repeat(64);
const PAYLOAD = {
  identity_events: ['citizen_id', 'kind', 'detail', 'created_at'],
  ledger: ['entry_date', 'description', 'amount_cents', 'created_at'],
};

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const get = async (path, headers = {}) => {
  const r = await fetch(`${ORIGIN}${path}`, { headers });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
};

const out = [];
const say = (line = '') => {
  out.push(line);
  console.log(line);
};

// ---------------------------------------------------------------- trace, first
//
// Two stamps on purpose. The local clock cannot be trusted before a network
// round-trip — this machine has been hours off — but the trace has to exist
// BEFORE any work or a run that dies leaves no evidence it began. So: stamp
// locally and immediately, then correct from the society's own clock, which has
// carried `now_utc` on every response since 66e9b0e.
const localStart = new Date().toISOString();
appendFileSync('docs/watch/runs.log', `${localStart}  started  (local clock, unverified)\n`);

let serverNow = null;
try {
  const official = await get('/api/official');
  serverNow = official.now_utc ?? null;
  if (serverNow) {
    appendFileSync('docs/watch/runs.log', `${serverNow}  started-confirmed  (server clock)\n`);
  }
} catch {
  appendFileSync('docs/watch/runs.log', `${localStart}  WARN  could not reach the society to confirm the clock\n`);
}

const stamp = serverNow ?? localStart;
say(`# Night watch — ${stamp}`);
say();
say(`local clock said ${localStart}; society said ${serverNow ?? '(unreachable)'}.`);
say();

// -------------------------------------------------------------- 1. the chains
say('## 1. Chain witness');
say();
let chainLine = '';
let urgent = [];
try {
  const [attest, events, treasury] = await Promise.all([
    get('/api/attest'),
    get('/api/events'),
    get('/treasury', { accept: 'application/json' }),
  ]);

  const verify = (table, rows, reported) => {
    const sorted = rows.slice().sort((a, b) => a.id - b.id);
    const sealed = sorted.filter((r) => r.hash);
    const unsealed = sorted.filter((r) => !r.hash).map((r) => r.id);
    let prev = GENESIS;
    let ok = 0;
    const breaks = [];
    for (const row of sealed) {
      if (row.prev_hash !== prev) breaks.push(`link@${row.id}`);
      if (sha(prev + '\n' + JSON.stringify(PAYLOAD[table].map((f) => row[f] ?? null))) === row.hash) ok++;
      else breaks.push(`hash@${row.id}`);
      prev = row.hash;
    }
    const matches = prev === reported;
    if (!matches || breaks.length) urgent.push(`${table}: ${breaks.length} break(s), head matches attest = ${matches}`);
    return { sealed: sealed.length, ok, breaks, head: prev, matches, unsealed };
  };

  const id = verify('identity_events', events.events ?? events, attest.identity_log.head);
  const led = verify('ledger', treasury.entries ?? [], attest.treasury.head);

  say('| chain | sealed | rehashed | breaks | head matches attest |');
  say('|---|---|---|---|---|');
  say(`| identity | ${id.sealed} | ${id.ok}/${id.sealed} | ${id.breaks.length || 'none'} | ${id.matches} |`);
  say(`| ledger | ${led.sealed} | ${led.ok}/${led.sealed} | ${led.breaks.length || 'none'} | ${led.matches} |`);
  say();
  say(`Unsealed prefix unchanged? identity ids 1..${Math.max(...id.unsealed, 0)}, ledger ids 1..${Math.max(...led.unsealed, 0)}.`);
  say(`identity head \`${id.head}\``);
  say(`ledger head   \`${led.head}\``);
  chainLine = `${stamp}  identity  ${id.sealed}sealed ${id.ok}ok  ${id.head}  treasury  ${led.sealed}sealed ${led.ok}ok  ${led.head}\n`;
  appendFileSync('docs/watch/heads.log', chainLine);
} catch (e) {
  urgent.push(`chain witness failed: ${e.message}`);
  say(`FAILED: ${e.message}`);
}
say();

// ---------------------------------------------------------------- 2. the inbox
say('## 2. Addressed to us');
say();
try {
  const key = loadKey('1f916');
  const last = existsSync('docs/watch/last-run.json')
    ? JSON.parse(readFileSync('docs/watch/last-run.json', 'utf8'))
    : {};
  const since = Number(last.last_run_ms) || Date.now() - 6 * 3600_000;
  const me = await get(`/api/me?since=${since}`, { authorization: `Bearer ${key}` });
  if (me.cursor_advanced !== false) urgent.push('GET /api/me advanced the cursor — the read was NOT a replay');
  const t = me.since_last_visit.totals;
  say(`replay read, cursor_advanced=${me.cursor_advanced}. karma ${me.karma}.`);
  say(`replies ${t.replies} | on my posts ${t.comments_on_your_posts} | threads joined ${t.in_threads_you_joined} | mentions ${t.mentions_of_you}`);
  const list = (name, items) => {
    if (!items?.length) return;
    say(`\n**${name}**`);
    for (const i of items) say(`- c${i.source_id ?? i.id} — ${i.author} on post ${i.post_id}: ${(i.body || '').replace(/\s+/g, ' ').slice(0, 180)}`);
  };
  list('Replies', me.since_last_visit.replies);
  list('On my posts', me.since_last_visit.comments_on_your_posts);
  list('Mentions', me.since_last_visit.mentions_of_you);
} catch (e) {
  say(`inbox read failed: ${e.message}`);
}
say();

// --------------------------------------------------------- 3. the other checks
const run = (label, file, args = []) => {
  say(`## ${label}`);
  say();
  try {
    const stdout = execFileSync(process.execPath, [file, ...args], { encoding: 'utf8', timeout: 300_000 });
    say('```');
    say(stdout.trim().split('\n').slice(-24).join('\n'));
    say('```');
  } catch (e) {
    const text = (e.stdout || '') + (e.stderr || '');
    say('```');
    say(text.trim().split('\n').slice(-24).join('\n') || String(e.message));
    say('```');
    if (label.includes('Contract')) urgent.push('consumer contract check failed — a field this project reads has moved');
  }
  say();
};

run('3. Consumer contracts', 'scripts/check-contract.mjs');
run('4. Scam scan', 'scripts/scan-abuse.mjs');
run('5. Power reconciliation', 'scripts/reconcile-power.mjs');

// ------------------------------------------------------------ 6. source + site
say('## 6. Source movement');
say();
try {
  const prs = execFileSync('gh', ['pr', 'list', '--repo', '1f916-ai/1f916', '--state', 'all', '--limit', '8',
    '--json', 'number,state,author,title',
    '--jq', '.[] | "\\(.number) \\(.state) \\(.author.login) \\(.title[0:48])"'], { encoding: 'utf8', timeout: 120_000 });
  say('```');
  say(prs.trim());
  say('```');
} catch (e) {
  say(`gh unavailable: ${String(e.message).slice(0, 120)}`);
}
say();

say('## 7. Site health');
say();
for (const url of ['https://1f916-observatory.vercel.app', 'https://1f916-observatory.vercel.app/api/presence']) {
  try {
    const r = await fetch(url, { method: 'GET' });
    say(`- ${url} -> ${r.status}`);
    if (!r.ok) urgent.push(`${url} returned ${r.status}`);
  } catch (e) {
    say(`- ${url} -> FAILED ${e.message}`);
    urgent.push(`${url} unreachable`);
  }
}
say();

// ------------------------------------------------------------------- 8. report
const urgentBlock = urgent.length
  ? `## URGENT\n\n${urgent.map((u) => `- **${u}**`).join('\n')}\n`
  : '## URGENT\n\nNothing urgent.\n';

const day = stamp.slice(0, 10);
const hm = stamp.slice(11, 16).replace(':', '');
const path = `docs/watch/reports/${day}-${hm}.md`;
if (!existsSync('docs/watch/reports')) mkdirSync('docs/watch/reports', { recursive: true });
writeFileSync(path, `${urgentBlock}\n${out.join('\n')}\n`);

writeFileSync(
  'docs/watch/last-run.json',
  JSON.stringify({ last_run: stamp, last_run_ms: Date.parse(stamp), report: path }, null, 2) + '\n',
);

appendFileSync('docs/watch/runs.log', `${new Date().toISOString()}  finished  ${path.split('/').pop()}\n`);

console.log(`\nreport written: ${path}`);
console.log(urgent.length ? `URGENT: ${urgent.length} item(s)` : 'nothing urgent');

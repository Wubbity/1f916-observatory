#!/usr/bin/env node
/**
 * The wake cycle, as ONE command.
 *
 *   node scripts/wake.mjs
 *
 * Writes a brief to docs/wake/ and prints its path on the last line. It does
 * not post, comment, vote, push, or open anything. Reading is free; every
 * outward action is left to the agent that reads the brief, inside the budget
 * the brief states.
 *
 * WHY ONE COMMAND
 *
 * The previous scheduled task told the agent to compose a dozen ad-hoc shell
 * commands per run. Any one of them can raise a permission prompt, and in an
 * unattended run a prompt is not a delay — it is a full stop. On 2026-08-10 the
 * scheduler showed "Running" for 19 hours while it sat waiting for someone to
 * click Allow. A command surface generated fresh each run cannot be
 * allowlisted, because there is nothing stable to allow. This one is stable.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not decide what to say. Composing a reply worth reading needs the
 * thing reading the thread, not a template — this project has spent two days
 * documenting what canned replies look like from the outside. So the brief
 * carries the material and the budget, and the agent writes the words.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { budget, loadState, saveState, utcDay } from './lib/wake-state.mjs';
import { commitFiles, commitsSince, prForCommit, scanCommit } from './lib/security-scan.mjs';

const ORIGIN = 'https://1f916.ai';
const INTERVAL_HOURS = Number(process.env.WAKE_INTERVAL_HOURS ?? 3);
const KEY_FILE = '.secrets/1f916.key';

const iso = (t) => new Date(t).toISOString();
const short = (s, n = 100) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

async function api(path, auth = false) {
  const headers = { accept: 'application/json' };
  if (auth) headers.authorization = `Bearer ${readFileSync(KEY_FILE, 'utf8').trim()}`;
  const r = await fetch(ORIGIN + path, { headers });
  if (!r.ok) throw new Error(`${path} -> HTTP ${r.status}`);
  return r.json();
}

const out = [];
const say = (s = '') => out.push(s);

// ── state ───────────────────────────────────────────────────────────────────
const state = loadState();
const today = utcDay();
if (state.quota_day !== today) {
  state.quota_day = today;
  state.runs_today = 0;
}

say(`# Wake brief — ${iso(Date.now())}`);
say('');
say(`Run ${state.runs_today + 1} of this UTC day. Last wake: ${state.last_wake_utc ?? 'never (first run)'}.`);
say('');

// ── standing and budget ─────────────────────────────────────────────────────
// ?since= makes this a replay read. Reads never move the cursor, but passing
// the parameter makes that explicit and lets the response confirm it.
const me = await api(`/api/me?since=${Date.now()}`, true);
if (me.cursor_advanced !== false) {
  say('> **WARNING** — `/api/me` did not confirm `cursor_advanced: false`. The inbox may have been consumed by this read. Treat the reply list below as possibly the only delivery.');
  say('');
}

// Pacing no longer depends on how often this runs — see budget() in
// lib/wake-state.mjs. Votes get a wider ceiling because there are 50 of them
// and spending one costs nobody's attention.
const commentBudget = budget({ remaining: me.today.comments_remaining, perWake: 3, reserve: 4 });
const voteBudget = budget({ remaining: me.today.votes_remaining, perWake: 12, reserve: 8 });

say('## Budget for THIS run — do not exceed');
say('');
say('```');
say(`comments  ${String(commentBudget.allowance).padStart(2)} of ${me.today.comments_remaining} left    ${commentBudget.formula}`);
say(`votes     ${String(voteBudget.allowance).padStart(2)} of ${me.today.votes_remaining} left    ${voteBudget.formula}`);
say(`posts      ${me.today.posts_remaining} of 1 left`);
say('');
say(`Caps reset in ${commentBudget.hoursToReset}h (UTC midnight). Wakes are every ${INTERVAL_HOURS * 60}min, but the allowance above does NOT depend on that — it is a flat per-wake ceiling.`);
say(commentBudget.reserveReleased
  ? 'FINAL STRETCH of the day — the reserve is released, unspent quota expires at midnight.'
  : `Holding ${commentBudget.reserveHeld} comment(s) in reserve for people who reply to you later today.`);
say('```');
say('');
say(`Karma ${me.karma}. If a run has nothing worth ${commentBudget.allowance} comments, spend less. An unspent comment costs nothing; a filler comment costs the thing this account is for.`);
say('');

// ── recon ───────────────────────────────────────────────────────────────────
say('## Recon');
say('');

// /api/pulse is the cheap high-water signal and the ONLY honest source for
// "what is the newest post". The first draft of this script read page 1 of
// /api/changes and took the max id from it — but that walk is oldest-first and
// pages, so page 1 returned the 200 OLDEST posts. It recorded high_water_post
// as 202 on a board whose latest was 779, and would then have reported the
// oldest 200 posts as "new" on every run, forever.
//
// That is class 1 from post #763 committed by the auditor who wrote it: a
// well-formed response, every returned field true, and the part that mattered
// simply not in the page I looked at.
const [pulse, front, recent, official] = await Promise.all([
  api('/api/pulse'),
  api('/api/front'),
  api('/api/new'),
  api('/api/official'),
]);

const pinned = (front.posts ?? []).filter((p) => p.pinned);
say(`**Pinned (${pinned.length}):** ${pinned.length ? pinned.map((p) => `#${p.id} "${short(p.title, 60)}"`).join(' · ') : 'none'}`);

const highest = pulse.board?.latest_post_id ?? 0;
const fresh = (recent.posts ?? [])
  .filter((p) => p.id > state.high_water_post)
  .sort((a, b) => b.id - a.id);
const missed = Math.max(0, highest - state.high_water_post - fresh.length);
say('');
say(`**Board high-water: post ${highest}, comment ${pulse.board?.latest_comment_id}, ${pulse.board?.citizens} citizens.**`);
say('');
say(`**New posts since last wake (${fresh.length} shown, last seen #${state.high_water_post}):**`);
say('');
for (const p of fresh) say(`- #${p.id} — ${p.author} — "${short(p.title, 78)}" (${p.votes ?? 0} votes, ${p.comments ?? 0} comments)`);
if (missed > 0) {
  say('');
  say(`> \`/api/new\` is a bounded feed and ~${missed} post(s) in that range are not in it. Walk \`/api/changes\` on \`next_since\` to \`has_more:false\` if this run needs the complete set — the feed is a window, not the archive.`);
}
say('');

// The inbox. This is the part the requirement calls out: read the replies.
const inbox = me.since_last_visit ?? {};
const buckets = ['replies', 'comments_on_your_posts', 'in_threads_you_joined', 'mentions_of_you'];
say(`**Inbox** — totals: \`${JSON.stringify(inbox.totals ?? {})}\``);
say('');
const answered = new Set();
for (const b of ['replies', 'comments_on_your_posts', 'mentions_of_you']) {
  const rows = inbox[b] ?? [];
  if (!rows.length) continue;
  say(`### ${b} (${rows.length})`);
  say('');
  for (const r of rows) {
    if (answered.has(r.id)) continue;
    answered.add(r.id);
    say(`- **c${r.id}** on post ${r.post_id} — ${r.author} — ${short(r.body, 150)}`);
  }
  say('');
}
say('Read every one of these in full before replying to any. `GET /api/post/:id` returns the thread; the excerpt above is a pointer, not the comment.');
say('');

// ── freshness: has the society outgrown our window? ─────────────────────────
say('## Window freshness');
say('');
let routes = [];
try {
  const surface = await api('/api/surface');
  // Dedupe: several paths are published twice because GET and POST share
  // them, and a duplicated entry made the 'new routes' diff noisy.
  routes = [...new Set((surface.routes ?? []).map((r) => r.path).filter(Boolean))];
  const added = routes.filter((r) => !state.known_routes.includes(r));
  const removed = state.known_routes.filter((r) => !routes.includes(r));
  say(`${routes.length} routes published. ${added.length} new, ${removed.length} gone since last wake.`);
  if (added.length) {
    say('');
    say('**New routes — the window may now be stale:**');
    for (const r of added) say(`- \`${r}\``);
  }
  if (removed.length) {
    say('');
    say('**Routes that disappeared — anything we render from these will break:**');
    for (const r of removed) say(`- \`${r}\``);
  }
} catch (e) {
  say(`\`/api/surface\` unavailable (${e.message}); freshness not computed this run.`);
}
say('');
let coverage = '(not run)';
try {
  coverage = execFileSync(process.execPath, ['scripts/check-coverage.mjs'], { encoding: 'utf8' });
} catch (e) {
  coverage = (e.stdout ?? '') + '\n(check-coverage exited non-zero — a claimed capability has no endpoint behind it)';
}
say('```');
say(coverage.split('\n').filter((l) => /Society GET|Not rendered|^  \/api|claimed capability|Listed as/.test(l)).join('\n').trim() || coverage.trim().slice(0, 600));
say('```');
say('');

// ── security ────────────────────────────────────────────────────────────────
say('## Security');
say('');
let newSha = state.last_audited_sha;
// Hoisted out of the try block below so the quiet verdict at the end can see
// it. A scan that throws leaves this at 0 — and the catch says so loudly, so a
// broken scanner cannot masquerade as a clean board.
let securityCandidates = 0;
try {
  const { commits, baseline, gap } = commitsSince(state.last_audited_sha);
  newSha = commits[0]?.sha ?? state.last_audited_sha;

  if (!state.full_audit_done) {
    say('**FIRST RUN — full audit is owed.**');
    say('');
    say('The commit scan below covers only recent history. A full audit means reading `src/` end to end: every write path against its cap, every read path against `mod_state`, every privileged branch against its authorization, and the hash chains against what they actually seal. Do that this run, publish it as a post if it finds anything, and set `full_audit_done` in `.state/wake.json` only once it is genuinely done.');
    say('');
  }
  if (gap) {
    say('> The last audited SHA was not found in the recent history page — force-push, or more than 100 commits since. Coverage below is INCOMPLETE and this run should say so in anything it publishes.');
    say('');
  }

  say(`${commits.length} new commit(s)${baseline ? ' (baseline page — no prior SHA)' : ''}.`);
  say('');
  const findings = [];
  for (const c of commits.slice(0, 25)) {
    const files = commitFiles(c.sha);
    const hits = scanCommit(c.sha, files);
    if (hits.length) {
      const pr = prForCommit(c.sha);
      findings.push({ commit: c, hits, pr });
    }
  }

  securityCandidates = findings.length;

  if (!findings.length) {
    say('No candidate patterns in the new commits. That is not a clean bill of health — it is the absence of a pattern match, and these rules only cover defect classes this project has already seen.');
  } else {
    const A = findings.filter((f) => f.hits.some((h) => h.lane === 'A'));
    const B = findings.filter((f) => !f.hits.some((h) => h.lane === 'A'));

    if (A.length) {
      say('### CLASS A candidates — PRIVATE FIRST, do not post publicly');
      say('');
      say('`security.txt`: *anything that lets one actor act as many, spend past a cap, hide another citizen\'s words, or write to the books* goes to a GitHub security advisory BEFORE the square. If reading confirms one of these, write it to `docs/wake/staged/` and escalate to the human. **Do not open a public PR or a board comment describing it.**');
      say('');
      for (const f of A) {
        say(`- \`${f.commit.sha.slice(0, 7)}\` ${short(f.commit.msg.split('\n')[0], 70)}${f.pr ? ` (PR #${f.pr.number})` : ''}`);
        for (const h of f.hits.filter((x) => x.lane === 'A')) say(`    - **${h.rule}** in \`${h.file}\` — ${h.why}`);
      }
      say('');
    }
    if (B.length) {
      say('### CLASS B candidates — open disclosure is appropriate');
      say('');
      for (const f of B) {
        say(`- \`${f.commit.sha.slice(0, 7)}\` ${short(f.commit.msg.split('\n')[0], 70)}${f.pr ? ` (PR #${f.pr.number} — disclose there)` : ''}`);
        for (const h of f.hits) say(`    - **${h.rule}** in \`${h.file}\` — ${h.why}`);
      }
      say('');
    }
  }
  say('');
  say('**These are candidates, not findings.** Every rule is a pattern match over added lines. Read the surrounding code and state the concrete failure path before publishing anything. A finding you cannot describe as "input X reaches line Y and produces Z" is not ready.');
} catch (e) {
  say(`Security pass failed: ${e.message}`);
  say('');
  say('Report the failure and stop; do not improvise shell commands to debug it. That is what strands unattended runs.');
}
say('');

// ── PR posture ──────────────────────────────────────────────────────────────
say('## Filing');
say('');
say(state.auto_file_prs
  ? '`auto_file_prs` is **true** — you may push a branch and open a PR for a Class B fix. Class A still goes private and still needs a human.'
  : '`auto_file_prs` is **false** — stage any fix as a branch plus a written PR body under `docs/wake/staged/` and report it. Do not push and do not open a PR. Flip the flag in `.state/wake.json` to hand over that step.');
say('');

// ── the standing instruction ────────────────────────────────────────────────
say('## Rules for this run');
say('');
say(`1. Read every inbox item in full via \`GET /api/post/:id\` before replying to any of them.`);
say(`2. Spend at most **${commentBudget.allowance} comments** and **${voteBudget.allowance} votes**. Under is fine. Over is not.`);
say('3. Every number you publish must be re-derivable by a reader from public endpoints, and you must say which calls produce it.');
say('4. State the room for error. If a measurement has a bound, publish the bound; if a classifier is lossy, say so and give the recall if you know it.');
say('5. Do not post to say you have nothing to say. Silence is legible; filler is not.');
say('6. Post `comment.mjs` drafts from files, so what was reviewed is what was sent.');
say('');

// ── the quiet verdict ───────────────────────────────────────────────────────
//
// Wakes are frequent now, and most of them will have nothing to do. A run that
// still reads the whole brief, re-checks the feed and reasons about a silent
// board costs real tokens for no output, and the temptation to justify the wake
// by saying something is exactly the failure the constitution warns about.
//
// So the brief answers the only question a quiet wake needs answered, in its
// first line, before anything else is read. Everything below it stays intact
// for the runs that are not quiet.
const inboxTotals = inbox.totals ?? {};
const inboxWaiting = ['replies', 'comments_on_your_posts', 'in_threads_you_joined', 'mentions_of_you']
  .reduce((n, b) => n + Number(inboxTotals[b] ?? 0), 0);
const newPosts = Math.max(0, highest - state.high_water_post);
const routesChanged = routes.length
  ? routes.filter((r) => !state.known_routes.includes(r)).length +
    state.known_routes.filter((r) => !routes.includes(r)).length
  : 0;
const quiet = inboxWaiting === 0 && newPosts === 0 && routesChanged === 0 && securityCandidates === 0;

const verdict = quiet
  ? [
      '> ## QUIET — STOP HERE',
      '>',
      '> Nothing is waiting: inbox 0, no new posts, no route changes, no security candidates.',
      '> **Do not read further, do not fetch anything, do not comment.** Report "quiet board"',
      '> in one line and end the run. This is a success, not a wasted wake — the loop is fast',
      '> so that it is THERE when a thread moves, which means most wakes finding nothing is the',
      '> design working, not a reason to manufacture something to say.',
      '',
    ]
  : inboxWaiting > 0
    ? [
        `> ## REPLIES WAITING — inbox ${inboxWaiting}, new posts ${newPosts}, route changes ${routesChanged}, security candidates ${securityCandidates}`,
        '>',
        '> Answering the people who answered you comes first. Step 3.',
        '',
      ]
    : [
        `> ## ENGAGE LANE — inbox 0, but the board moved: ${newPosts} new post(s), route changes ${routesChanged}, security candidates ${securityCandidates}`,
        '>',
        '> Nobody replied to you, and that is not a reason to say nothing. Until',
        '> 2026-08-13 this run would have stopped here, because every instruction it',
        '> had was about answering its own inbox — so a busy board and a quiet inbox',
        '> produced 21 hours of silence while 60 posts went by. Read the new posts',
        '> below and engage where you can actually add something. Step 3b.',
        '',
      ];
// Slot the verdict directly under the run header so it is the first thing read.
out.splice(4, 0, ...verdict);

// ── persist ─────────────────────────────────────────────────────────────────
//
// --dry-run exists because this script is stateful and testing it is not free.
// Running it by hand on 2026-08-12 advanced high_water_post past 7 posts no
// agent had read, which would have made the next real wake report a quiet board
// and skip them. The inbox cursor was never at risk (that read is a replay),
// but the "what is new" mark was, and a test that silently eats real signal is
// a bad test.
if (process.argv.includes('--dry-run')) {
  console.log(out.join('\n'));
  console.log('\nDRY RUN — state NOT persisted, no brief written.');
  process.exit(0);
}

state.last_wake_utc = iso(Date.now());
state.runs_today += 1;
state.high_water_post = Math.max(state.high_water_post, highest);
if (routes.length) state.known_routes = routes;
if (newSha) state.last_audited_sha = newSha;
saveState(state);

mkdirSync('docs/wake', { recursive: true });
const path = `docs/wake/brief-${iso(Date.now()).replace(/[:.]/g, '-')}.md`;
writeFileSync(path, out.join('\n') + '\n');
console.log(out.join('\n'));
console.log(`\nBRIEF: ${path}`);

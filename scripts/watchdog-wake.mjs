#!/usr/bin/env node
/**
 * Kill a wake run that has stopped moving, so it cannot hold the schedule shut.
 *
 *   node scripts/watchdog-wake.mjs --dry-run    # report only
 *   node scripts/watchdog-wake.mjs              # report and kill
 *
 * WHY THIS EXISTS
 *
 * On 2026-08-12 the 09:53 wake run called WebFetch on a 1f916.ai post, hung on
 * that one call, and never returned. Five hours later its process was still
 * alive (104 CPU-seconds, transcript untouched since 09:54) and the 12:37 slot
 * had been skipped, because the scheduler will not start a run while one is
 * still in flight. The endpoint was healthy the entire time — it answered in
 * 0.6s when someone finally checked by hand. One stuck call cost two runs and
 * five hours of a board nobody was watching.
 *
 * The SKILL.md now forbids WebFetch, which closes that particular door. This
 * closes the corridor: ANY future stall — a prompt nobody answers, a read with
 * no timeout, a wedged subprocess — dies here instead of silently eating every
 * later slot.
 *
 * WHY IT LIVES OUTSIDE THE TASK
 *
 * A watchdog inside the wake cycle is useless by construction: the state it
 * needs to fix is the state where no new run can start. So this is driven by
 * Windows Task Scheduler, on its own cadence, in the user's own session — it
 * does not need and must not have elevation.
 *
 * HOW IT DECIDES, AND WHAT IT REFUSES TO TOUCH
 *
 * A run is stalled when its transcript has not been written for STALL_MINUTES.
 * That is the right signal rather than process age: a healthy run writes
 * constantly, and a long run is not a sick one.
 *
 * Two hard exemptions, because killing the wrong session is worse than the bug:
 *
 *   1. Only sessions whose opening prompt carries the wake-cycle marker are
 *      considered at all. Every other Claude session on this machine is
 *      invisible to this script.
 *   2. If a human has typed into the session, it is left alone forever, however
 *      quiet it goes. A scheduled run that a person picked up and is now talking
 *      to is a conversation, and a conversation is allowed to pause. This is the
 *      exemption that keeps the watchdog from reaping someone mid-thought.
 */

// execFileSync, never exec: the argument array goes to the process directly and
// no shell parses it, so nothing here can be turned into a command by a path.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const DRY_RUN = process.argv.includes('--dry-run');

/** No wake run has ever legitimately gone this long without writing a line. */
const STALL_MINUTES = 10;
/** The marker that identifies a scheduled wake run's opening prompt. */
const WAKE_MARKER = '1f916-wake-cycle';

const PROJECTS = join(homedir(), '.claude', 'projects');
const LOG = join(homedir(), '.claude', 'wake-watchdog.log');

const now = Date.now();
const log = (line) => {
  const stamped = `${new Date(now).toISOString()} ${line}`;
  console.log(stamped);
  try {
    appendFileSync(LOG, stamped + '\n');
  } catch {
    /* the watchdog must not die because it could not write its own log */
  }
};

// ---------------------------------------------------------------------------
// 1. Every live Claude agent process, with the moment it started.
// ---------------------------------------------------------------------------
// Returns null — not [] — when the enumeration itself failed. An empty list and
// a broken query are opposite facts, and the first version of this function
// reported "ok: no live agent processes" when the query had actually errored.
// A watchdog whose failure mode is a clean bill of health is worse than none.
// (-AsArray is PowerShell 7+; this must also run on Windows PowerShell 5.1, so
// the array is forced with @() and -InputObject instead.)
function liveAgents() {
  const ps =
    "$r = @(Get-CimInstance Win32_Process -Filter \"Name = 'claude.exe'\" | " +
    'Where-Object { $_.CommandLine -like "*claude-code*" -and $_.CommandLine -like "*stream-json*" } | ' +
    'ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; created = ' +
    '$_.CreationDate.ToUniversalTime().ToString("o") } }); ' +
    'ConvertTo-Json -InputObject $r -Compress -Depth 3';
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      encoding: 'utf8',
      timeout: 30000,
    }).trim();
    if (!out || out === 'null') return [];
    const rows = JSON.parse(out);
    return (Array.isArray(rows) ? rows : [rows]).map((r) => ({ pid: Number(r.pid), created: Date.parse(r.created) }));
  } catch (e) {
    log(`ERROR could not enumerate processes: ${String(e).slice(0, 200)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Every wake-cycle transcript, when it started, and whether a human spoke.
// ---------------------------------------------------------------------------
function wakeSessions() {
  if (!existsSync(PROJECTS)) return [];
  const found = [];
  for (const project of readdirSync(PROJECTS)) {
    const dir = join(PROJECTS, project);
    let files;
    try {
      files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
    } catch {
      continue;
    }
    for (const file of files) {
      const path = join(dir, file);
      let stat, entries;
      try {
        stat = statSync(path);
        // Only recent files can belong to a live process; skip the archive.
        if (now - stat.mtimeMs > 24 * 3600 * 1000) continue;
        entries = readFileSync(path, 'utf8')
          .trim()
          .split('\n')
          .map((l) => {
            try {
              return JSON.parse(l);
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      } catch {
        continue;
      }
      if (entries.length === 0) continue;

      const opening = JSON.stringify(entries.slice(0, 3));
      if (!opening.includes(WAKE_MARKER)) continue; // not a wake run — invisible to us

      // A human turn is a user entry whose content is plain text. Tool results
      // are also type "user" but arrive as arrays of tool_result blocks, so the
      // shape distinguishes them without guessing.
      const humanTurns = entries.filter((e) => {
        if (e.type !== 'user') return false;
        const c = e.message?.content;
        if (typeof c === 'string') return true;
        if (Array.isArray(c)) return c.some((b) => b.type === 'text');
        return false;
      }).length;

      // The signature of a hang, as opposed to a finish.
      //
      // Both a stalled run and a completed one stop writing, so file mtime
      // alone cannot tell them apart — and every run that finished in the last
      // 24h would look stalled, which defeats the cheap path entirely. But a
      // run that is stuck is stuck ON something: its final entry is an
      // assistant tool_use whose tool_result never arrived. A run that finished
      // ends on assistant text. Both real hangs seen on 2026-08-12 (WebFetch at
      // 14:54, Bash/gh at 20:09) end exactly this way.
      const last = entries[entries.length - 1];
      const awaitingTool =
        last?.type === 'assistant' &&
        Array.isArray(last.message?.content) &&
        last.message.content.some((b) => b.type === 'tool_use');

      found.push({
        path,
        session: file.replace(/\.jsonl$/, ''),
        startedAt: Date.parse(entries[0].timestamp),
        lastWrite: stat.mtimeMs,
        // The opening prompt is itself a user turn, so a human spoke only if
        // there is more than one.
        humanPresent: humanTurns > 1,
        awaitingTool,
        entries: entries.length,
      });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// 3. Match, judge, act.
// ---------------------------------------------------------------------------
// Transcripts first, because reading them is pure filesystem work and costs
// nothing visible. Process enumeration needs PowerShell, and on an interactive
// logon every spawn of it paints a window on the user's desktop — 144 of them a
// day for a machine that is almost always healthy. So the expensive, visible
// half only runs once something actually looks stalled.
// Sessions already dealt with, so a corpse is not re-examined every 10 minutes.
//
// A run this watchdog killed keeps a transcript that ends mid-tool-call — the
// exact signature it looks for — so without this it matches forever, and the
// cheap path never engages while any past kill is still inside the 24h window.
// Recording the id once and skipping it afterwards is what makes the steady
// state genuinely free.
const HANDLED = join(homedir(), '.claude', 'wake-watchdog-handled.json');
const loadHandled = () => {
  try {
    const rows = JSON.parse(readFileSync(HANDLED, 'utf8'));
    // Drop anything older than the 24h transcript window, twice over, so the
    // file cannot grow without bound.
    return rows.filter((r) => now - r.at < 48 * 3600 * 1000);
  } catch {
    return [];
  }
};
const handled = loadHandled();
const handledIds = new Set(handled.map((r) => r.session));
const rememberHandled = (ids) => {
  if (ids.length === 0) return;
  const merged = [...handled, ...ids.map((session) => ({ session, at: now }))];
  try {
    writeFileSync(HANDLED, JSON.stringify(merged, null, 1));
  } catch {
    /* worst case it re-checks next tick; not worth failing the run over */
  }
};

const sessions = wakeSessions();
const stalled = sessions.filter(
  (s) =>
    !s.humanPresent &&
    s.awaitingTool &&
    !handledIds.has(s.session) &&
    (now - s.lastWrite) / 60000 >= STALL_MINUTES,
);

if (stalled.length === 0) {
  const humans = sessions.filter((s) => s.humanPresent).length;
  const finished = sessions.filter((s) => !s.humanPresent && !s.awaitingTool).length;
  log(
    `ok: ${sessions.length} wake session(s) in the last 24h - ${humans} with a human present, ` +
      `${finished} finished on their own, 0 waiting on a tool call. No process scan needed.`,
  );
  process.exit(0);
}

const agents = liveAgents();

if (agents === null) {
  log('FAILED: could not enumerate processes - this run checked NOTHING. Not a clean bill.');
  process.exit(1);
}
if (agents.length === 0) {
  log(`ok: ${stalled.length} stalled transcript(s) but no live agent process - they already exited`);
  process.exit(0);
}

let killed = 0;
let checked = 0;

for (const agent of agents) {
  // A process and its transcript begin within a second or two of each other;
  // nothing else on this machine shares that timestamp.
  const session = sessions.find((s) => Math.abs(s.startedAt - agent.created) < 10_000);
  if (!session) continue; // not a wake run, or no transcript yet — leave it alone
  checked++;

  const idleMin = (now - session.lastWrite) / 60000;
  const ageMin = (now - agent.created) / 60000;
  const label = `pid ${agent.pid} session ${session.session.slice(0, 8)} age ${ageMin.toFixed(0)}m idle ${idleMin.toFixed(0)}m entries ${session.entries}`;

  if (session.humanPresent) {
    log(`skip (human present) ${label}`);
    continue;
  }
  if (idleMin < STALL_MINUTES) {
    log(`ok ${label}`);
    continue;
  }

  if (DRY_RUN) {
    log(`WOULD KILL ${label} - idle past ${STALL_MINUTES}m and no human in the session`);
    continue;
  }
  try {
    execFileSync('taskkill', ['/PID', String(agent.pid), '/T', '/F'], { encoding: 'utf8', timeout: 20000 });
    killed++;
    log(`KILLED ${label} - stalled past ${STALL_MINUTES}m; it was holding the wake schedule shut`);
  } catch (e) {
    log(`FAILED to kill pid ${agent.pid}: ${String(e).slice(0, 200)}`);
  }
}

// Every candidate examined this tick is now settled: either it was killed, or
// no live process claimed it and it is a corpse. Either way it must not cost a
// process scan again.
if (!DRY_RUN) rememberHandled(stalled.map((s) => s.session));

log(`done: ${agents.length} agent process(es) live, ${checked} wake run(s) matched, ${killed} killed${DRY_RUN ? ' (dry run)' : ''}`);

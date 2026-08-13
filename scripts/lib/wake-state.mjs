/**
 * Wake-cycle state: what this agent knew last time it woke.
 *
 * Kept as one small JSON file rather than derived each run, because three of
 * the four things here CANNOT be recomputed from the outside:
 *
 *   - the last commit SHA audited: without it, every wake re-audits all of
 *     history and finds nothing new, or audits nothing and misses everything.
 *   - whether the full security audit has been done: run one is a different
 *     job from run two hundred.
 *   - how much quota this UTC day has already been spent by earlier runs:
 *     /api/me reports what is LEFT, which is enough to avoid overspending but
 *     not enough to pace. Pacing needs to know how many runs remain.
 *
 * Everything else is read live, because a cache of the society is a second
 * source of truth and this project has spent a week documenting what those do.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const STATE_FILE = '.state/wake.json';

/** Shape written on first run. Every field is explained where it is used. */
const EMPTY = {
  version: 1,
  /** ISO of the last completed wake. */
  last_wake_utc: null,
  /** UTC day (YYYY-MM-DD) the run counter belongs to. */
  quota_day: null,
  /** How many wakes have completed on quota_day. Pacing divides by what is left. */
  runs_today: 0,
  /** Society repo HEAD at the end of the last security pass. */
  last_audited_sha: null,
  /** Set once the first full audit is done; after that it is commit diffs only. */
  full_audit_done: false,
  /** Endpoints GET /api/surface published last time, so new ones are detectable. */
  known_routes: [],
  /** Highest post id seen, so "new posts" is a fact rather than a guess. */
  high_water_post: 0,
  /**
   * Whether this agent may push branches and open PRs without a human.
   *
   * Default FALSE, deliberately. The standing instruction on this project is
   * that publishing is a human decision, and a scheduled agent that can open
   * PRs against someone else's repository is the sharpest version of that.
   * When false the cycle still does the whole job — it writes the branch, the
   * diff and the PR body to docs/wake/staged/ and reports them — it just does
   * not press send. Flip to true to hand over that last step.
   */
  auto_file_prs: false,
};

export function loadState() {
  if (!existsSync(STATE_FILE)) return { ...EMPTY };
  try {
    return { ...EMPTY, ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) };
  } catch {
    // A corrupt state file must not strand the cycle. Start clean and say so;
    // the cost is one redundant full audit, which is the safe direction.
    return { ...EMPTY };
  }
}

export function saveState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

export function utcDay(ms = Date.now()) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * How much of today's quota this run may spend.
 *
 * The requirement is "do not burn the whole allowance in one run, and keep
 * enough back to answer the people who answer you." Both halves matter: an
 * agent that spends 20 comments at 02:00 has nothing left when its own thread
 * fills up at 14:00, and replying to your own repliers is the part that makes
 * a thread worth anything.
 *
 * THE OLD SHAPE, AND WHY IT HAD TO GO (2026-08-12)
 *
 * This divided what remains by the RUNS that remain: `floor((remaining -
 * reserve) / runsLeft)`, with runsLeft derived from the wake interval. That
 * ties the per-run allowance to how OFTEN the agent wakes, which is exactly
 * backwards once waking gets cheap. With 20 comments left and ~19h to reset it
 * yields 2 at a 3h interval, 1 at 2h, and 0 at 1h or faster. Speeding the loop
 * up to answer a live thread sooner would have silently forbidden it from
 * answering at all — a more attentive mute. Any responsiveness change had to
 * fix this first.
 *
 * THE SHAPE NOW
 *
 * A flat per-wake ceiling, plus a reserve released only in the final stretch of
 * the UTC day. Frequency is no longer an input at all. The hard daily cap is
 * enforced by the society regardless (20 comments, 50 votes); this is the
 * self-imposed pacing that stops a busy morning from spending the evening's
 * budget before anyone in another timezone has woken up.
 *
 * "Balanced", chosen 2026-08-12: up to 3 comments a wake, holding 4 back until
 * the last 6 hours. Enough to hold a conversation while a thread is moving,
 * with something left when someone answers at 22:00.
 */
export function budget({
  remaining,
  perWake = 3,
  reserve = 4,
  releaseReserveWithinHours = 6,
  now = Date.now(),
}) {
  const msToReset = new Date(new Date(now).toISOString().slice(0, 10) + 'T23:59:59.999Z').getTime() - now + 1;
  const hoursToReset = Math.max(0, msToReset / 3_600_000);

  // Late enough that holding quota back would only expire it at midnight. The
  // reserve protects the evening; in the evening it protects nothing.
  const reserveReleased = hoursToReset <= releaseReserveWithinHours;
  const spendable = reserveReleased ? remaining : Math.max(0, remaining - reserve);
  const allowance = Math.max(0, Math.min(perWake, spendable));

  return {
    allowance,
    hoursToReset: Number(hoursToReset.toFixed(1)),
    reserveReleased,
    reserveHeld: reserveReleased ? 0 : Math.min(reserve, remaining),
    // Stated so a reader of the brief can check the arithmetic rather than
    // trust it. Every number this project publishes should be re-derivable.
    formula: reserveReleased
      ? `min(${perWake}, ${remaining}) = ${allowance}  [final ${releaseReserveWithinHours}h: reserve released]`
      : `min(${perWake}, max(0, ${remaining} - ${reserve})) = ${allowance}`,
  };
}

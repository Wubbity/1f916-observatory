/**
 * Security review of the society's code — full on first run, then commit diffs.
 *
 * DISCLOSURE ROUTING IS THE MOST IMPORTANT THING IN THIS FILE.
 *
 * https://1f916.ai/.well-known/security.txt says, verbatim:
 *
 *   "If what you found is exploitable before it is arguable — something that
 *    lets one actor act as many, spend past a cap, hide another citizen's
 *    words, or write to the books — please use a Contact above BEFORE posting
 *    it. Everything else belongs on the square in the open."
 *
 * So an automated auditor that posts everything it finds to a public board is
 * not thorough, it is a policy violation with a cron schedule. Findings are
 * triaged into two lanes and ONLY the open lane may ever be published without
 * a human:
 *
 *   CLASS A (private first) — touches identity, caps/quota, moderation
 *     visibility, or the ledger. Never auto-posted. Never auto-PR'd. Written to
 *     docs/wake/staged/ and escalated to the human, because the private contact
 *     is a GitHub security advisory and filing one is a publication decision.
 *
 *   CLASS B (open) — hardening, clarity, missing tests, defensive gaps with no
 *     immediate exploit. These are what the square is for.
 *
 * SECOND THING: these are CANDIDATES, not verdicts. Every rule here is a
 * pattern match over a diff, and this project has published enough false
 * positives in one week to know what that is worth. The scan surfaces hunks to
 * READ. A finding becomes a finding when a human or an agent has read the
 * surrounding code and can state the failure path. The brief says so, loudly.
 */

import { execFileSync } from 'node:child_process';

const REPO = '1f916-ai/1f916';

function gh(args) {
  return JSON.parse(execFileSync('gh', args, { maxBuffer: 1 << 26 }).toString());
}

/**
 * Patterns worth a second look, each with why and which lane it lands in.
 *
 * These are drawn from defects this project actually found or that the society
 * actually shipped fixes for — not from a generic checklist. A rule that has
 * never corresponded to a real bug here is noise on every future run.
 */
export const RULES = [
  {
    id: 'cap-toctou',
    lane: 'A',
    // The society's daily caps were once checked and then written in two
    // statements; two concurrent requests on one key could both pass. Fixed by
    // moving the count inside the INSERT. A new cap written the old way is the
    // same hole.
    why: 'a cap checked in one statement and written in another can be raced by two requests on one key',
    test: (d) =>
      /(INSERT|UPDATE)[\s\S]{0,400}/i.test(d) &&
      /COUNT\(\*\)[\s\S]{0,200}(remaining|cap|limit|per_day|PER_DAY)/i.test(d) &&
      !/WHERE\s*\(\s*SELECT\s+COUNT/i.test(d),
  },
  {
    id: 'modstate-unfiltered',
    lane: 'A',
    // Collapsed and removed rows must not leak through a new read path. This is
    // the "hide another citizen's words" clause, inverted: a read that ignores
    // mod_state un-hides them.
    why: 'a read path that selects posts/comments without a mod_state filter can surface collapsed or removed content',
    test: (d) =>
      /FROM\s+(posts|comments)\b/i.test(d) && !/mod_state/i.test(d) && /SELECT/i.test(d),
  },
  {
    id: 'identity-write-unbatched',
    lane: 'A',
    // A key rotation that updates state without its log row in the same batch
    // can destroy the citizen if the second write fails. The society shipped
    // PR #52 for exactly this.
    why: 'an identity or ledger mutation not batched with its log row can half-apply and lose the citizen or the audit trail',
    test: (d) =>
      /(rotate|identity|ledger|citizens)\b[\s\S]{0,300}(UPDATE|INSERT)/i.test(d) &&
      !/batch\(|\.batch\b/i.test(d),
  },
  {
    id: 'maintainer-check',
    lane: 'A',
    why: 'a privileged path whose authorization is a bare id comparison is one refactor from being wrong; check it is present and correct',
    test: (d) => /MAINTAINER_ID|is_maintainer|isMaintainer/i.test(d),
  },
  {
    id: 'sql-concat',
    lane: 'A',
    why: 'SQL assembled by interpolation rather than bound parameters',
    test: (d) => /(SELECT|INSERT|UPDATE|DELETE)[^\n]*\$\{/i.test(d),
  },
  {
    id: 'cursor-moved-on-read',
    lane: 'B',
    why: 'a read path that advances last_seen_at consumes an inbox the caller did not ask to consume',
    test: (d) => /last_seen_at/i.test(d) && /UPDATE/i.test(d),
  },
  {
    id: 'new-route-unsurfaced',
    lane: 'B',
    why: 'a route added without a matching entry in the surface manifest is invisible to every window that self-checks',
    test: (d) => /router\.(get|post)\(|case\s+["'`]\/api\//i.test(d),
  },
  {
    id: 'projection-undeclared',
    lane: 'B',
    // The class this project has documented repeatedly: a response that omits
    // a field without saying so.
    why: 'a response projection that drops a field without declaring it produces well-formed output a reader will misread',
    test: (d) => /SELECT\s+[a-z_,\s.]+FROM/i.test(d) && !/projection|omits/i.test(d),
  },
];

/** Commits on main since a SHA, or the most recent page on first run. */
export function commitsSince(sha) {
  const all = gh(['api', `repos/${REPO}/commits?per_page=100`, '--jq', '[.[] | {sha, msg: .commit.message, date: .commit.author.date, author: .commit.author.name}]']);
  if (!sha) return { commits: all.slice(0, 30), baseline: true };
  const idx = all.findIndex((c) => c.sha.startsWith(sha) || sha.startsWith(c.sha));
  // Unknown SHA (force-push, or older than one page): do not silently scan
  // everything. Report the gap so the brief can say coverage is incomplete.
  if (idx === -1) return { commits: all, baseline: false, gap: true };
  return { commits: all.slice(0, idx), baseline: false };
}

/** The unified diff of one commit, per file. */
export function commitFiles(sha) {
  const c = gh(['api', `repos/${REPO}/commits/${sha}`, '--jq', '{files: [.files[] | {filename, additions, deletions, patch}]}']);
  return c.files ?? [];
}

/** Run every rule over one commit's added lines. */
export function scanCommit(sha, files) {
  const hits = [];
  for (const f of files) {
    if (!f.patch) continue; // binary or too large; reported separately
    if (!/\.(ts|js|mjs|sql)$/.test(f.filename)) continue;
    // Only ADDED lines. A rule firing on unchanged context produces a finding
    // about code that was already reviewed, every run, forever.
    const added = f.patch
      .split('\n')
      .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      .map((l) => l.slice(1))
      .join('\n');
    if (!added.trim()) continue;
    for (const rule of RULES) {
      if (rule.test(added)) {
        hits.push({ sha, file: f.filename, rule: rule.id, lane: rule.lane, why: rule.why, added: added.length });
      }
    }
  }
  return hits;
}

/** Which PR, if any, introduced a commit — so a finding can be disclosed there. */
export function prForCommit(sha) {
  try {
    const prs = gh(['api', `repos/${REPO}/commits/${sha}/pulls`, '--jq', '[.[] | {number, title, state}]']);
    return prs[0] ?? null;
  } catch {
    return null;
  }
}

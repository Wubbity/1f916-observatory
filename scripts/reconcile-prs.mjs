#!/usr/bin/env node
/**
 * Does the merge record say what shipped?
 *
 *   node scripts/reconcile-prs.mjs
 *
 * A PR can be CLOSED and its code still be live: the maintainer sometimes takes
 * a contribution and lands it directly, crediting it in the commit message or in
 * a docket verdict. That is a fine way to run a repo. It does mean the one
 * artifact an outside auditor reaches for first — the list of merged PRs —
 * undercounts what was actually delivered, and undercounts it silently.
 *
 * This reconciles three records against each other:
 *   1. PR state on GitHub
 *   2. commit messages on main (which cite "#N" when they land a contribution)
 *   3. docket verdicts (which cite "PR #N")
 *
 * Read-only. gh for the first two, the public /api/docket for the third.
 */

import { execFileSync } from 'node:child_process';

const gh = (args) => JSON.parse(execFileSync('gh', args, { maxBuffer: 1 << 24 }).toString());

const prs = gh([
  'pr', 'list', '--repo', '1f916-ai/1f916',
  '--state', 'all', '--limit', '200',
  '--json', 'number,state,title,author',
]);

const commits = gh([
  'api', 'repos/1f916-ai/1f916/commits?per_page=100',
  '--jq', '[.[] | {sha: .sha[0:7], msg: (.commit.message | split("\n")[0])}]',
]);

const docket = await (await fetch('https://1f916.ai/api/docket')).json();
const verdicts = JSON.stringify(docket.docket ?? []);

const byState = {};
for (const p of prs) byState[p.state] = (byState[p.state] ?? 0) + 1;

console.log(`PRs: ${prs.length}   ${JSON.stringify(byState)}`);
console.log(`commits inspected on main: ${commits.length}`);
console.log();

const closed = prs.filter((p) => p.state === 'CLOSED');
const shipped = [];

console.log('CLOSED PRs — is the number cited by a main commit, or by a docket verdict?');
for (const p of closed) {
  const commit = commits.find((c) => c.msg.includes(`#${p.number}`));
  const inDocket = new RegExp(`PR #${p.number}\\b`).test(verdicts);
  if (commit || inDocket) shipped.push({ ...p, commit, inDocket });
  const mark = commit || inDocket ? 'SHIPPED' : '  --   ';
  const where = [commit ? `commit ${commit.sha}` : '', inDocket ? 'docket-verdict' : ''].filter(Boolean).join(' + ');
  console.log(`  #${String(p.number).padStart(2)}  ${mark}  ${where.padEnd(26)} ${p.title.slice(0, 44)}`);
}

const merged = byState.MERGED ?? 0;
const delivered = merged + shipped.length;

console.log();
console.log(`closed-but-shipped : ${shipped.length} of ${closed.length} closed PRs`);
console.log(`merged             : ${merged}`);
console.log(`actual deliveries  : ${delivered}`);
console.log(
  `the merge list shows ${merged}/${delivered} = ${((100 * merged) / delivered).toFixed(0)}% of what landed` +
    ` — it undercounts by ${shipped.length}`,
);
console.log();
console.log('by author, deliveries the merge list does not show:');
const byAuthor = {};
for (const s of shipped) byAuthor[s.author.login] = (byAuthor[s.author.login] ?? 0) + 1;
for (const [who, n] of Object.entries(byAuthor).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(2)}  ${who}`);
}

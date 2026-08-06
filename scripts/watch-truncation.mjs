#!/usr/bin/env node
/**
 * Watch /api/changes for the truncation ceiling — and, once it is crossed,
 * measure the rows an agent following the society's documented catch-up
 * routine would silently lose.
 *
 *   node scripts/watch-truncation.mjs            # poll every 60s
 *   node scripts/watch-truncation.mjs --once     # single check, exit
 *   node scripts/watch-truncation.mjs --interval 20
 *
 * Exit code is 2 once truncation is confirmed, so this can gate a script.
 *
 * WHY THE LOSS IS PERMANENT
 *
 * changes() is `WHERE created_at > ? ORDER BY created_at ASC LIMIT 500`, so a
 * capped response returns the OLDEST 500 rows after the cursor and drops the
 * newest. But the response also hands back `now` = Date.now(), and the door
 * tells agents to carry that forward. So the agent advances its cursor past
 * rows it never received, and no later query returns them.
 *
 * This script measures that gap directly: everything created after the last
 * row actually returned, but before the cursor the agent is told to keep.
 */

const ORIGIN = 'https://1f916.ai';
const COMMENT_CAP = 500;
const POST_CAP = 200;

const args = process.argv.slice(2);
const once = args.includes('--once');
const intervalIndex = args.indexOf('--interval');
const intervalMs = (intervalIndex !== -1 ? Number(args[intervalIndex + 1]) || 60 : 60) * 1000;

async function get(path) {
  const response = await fetch(`${ORIGIN}${path}`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`${path} -> HTTP ${response.status}`);
  return response.json();
}

function stamp() {
  return new Date().toISOString().replace('T', ' ').slice(11, 19);
}

function bar(used, cap, width = 34) {
  const filled = Math.min(width, Math.round((used / cap) * width));
  return `[${'█'.repeat(filled)}${'░'.repeat(width - filled)}]`;
}

/**
 * Once the cap is hit, measure the rows that fall into the gap between the
 * last row returned and the cursor the caller is told to advance to.
 */
async function measureLoss(capped) {
  const returned = capped.comments;
  if (returned.length === 0) return { lost: [], newestReturned: null };

  const newestReturned = Math.max(...returned.map((c) => c.created_at));
  const seen = new Set(returned.map((c) => c.id));

  const followUp = await get(`/api/changes?since=${newestReturned}`);
  const lost = followUp.comments.filter((c) => !seen.has(c.id) && c.created_at < capped.now);

  return { lost, newestReturned };
}

async function check() {
  const changes = await get('/api/changes?since=0');
  const comments = changes.comments.length;
  const posts = changes.posts.length;
  const truncated = comments >= COMMENT_CAP || posts >= POST_CAP;

  console.log(
    `${stamp()}  comments ${bar(comments, COMMENT_CAP)} ${String(comments).padStart(3)}/${COMMENT_CAP}` +
      `   posts ${String(posts).padStart(3)}/${POST_CAP}` +
      (truncated ? '   ← CAPPED' : `   (${COMMENT_CAP - comments} headroom)`),
  );

  if (!truncated) return false;

  console.log('');
  console.log('═'.repeat(78));
  console.log('  TRUNCATION CONFIRMED — /api/changes is silently dropping rows');
  console.log('═'.repeat(78));

  const { lost, newestReturned } = await measureLoss(changes);

  console.log(`  Rows returned by ?since=0 ............ ${changes.comments.length} (the cap)`);
  console.log(`  Newest row actually returned ......... ${newestReturned}`);
  console.log(`  Cursor the response tells you to keep  ${changes.now}`);
  console.log(`  Gap between them ..................... ${((changes.now - newestReturned) / 1000 / 60).toFixed(1)} minutes`);
  console.log('');
  console.log(`  COMMENTS AN AGENT WOULD SILENTLY LOSE: ${lost.length}`);
  console.log('');

  for (const comment of lost.slice(0, 8)) {
    const body = comment.body.replace(/\s+/g, ' ').slice(0, 76);
    console.log(`    lost #${comment.id} — ${comment.author} on post ${comment.post_id}`);
    console.log(`      "${body}${comment.body.length > 76 ? '…' : ''}"`);
  }
  if (lost.length > 8) console.log(`    …and ${lost.length - 8} more.`);

  console.log('');
  console.log('  No has_more flag. No cursor derived from the data. A caller cannot');
  console.log('  tell this response apart from a complete one.');
  console.log('');

  return true;
}

if (once) {
  process.exit((await check()) ? 2 : 0);
}

console.log(`Watching ${ORIGIN}/api/changes every ${intervalMs / 1000}s. Ctrl-C to stop.\n`);

for (;;) {
  try {
    if (await check()) process.exit(2);
  } catch (error) {
    console.log(`${stamp()}  error: ${error.message}`);
  }
  await new Promise((resolve) => setTimeout(resolve, intervalMs));
}

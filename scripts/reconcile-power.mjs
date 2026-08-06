#!/usr/bin/env node
/**
 * Reconcile observable moderated state against the moderation log.
 *
 * The method is single-writer's, from comment 601 on post 154, answering a
 * question I had called structurally unverifiable: you cannot observe from
 * outside that a database transaction is atomic, so stop trying to watch the
 * mechanism and watch the invariant it exists to protect.
 *
 * The invariant: every exercise of maintainer power writes exactly one row to
 * GET /api/events?kind=moderation. That is a set difference anyone can compute.
 * A post that is pinned with no pin row, or carries mod_state with no
 * moderation row, is the only externally visible symptom the two-statement
 * bug could ever have produced.
 *
 * It does not prove atomicity. It proves whether the guarantee has ever
 * visibly failed — the same trade the hash chain already makes: nobody watches
 * the write, everybody can check the arithmetic afterward.
 *
 *   node scripts/reconcile-power.mjs
 */

const ORIGIN = 'https://1f916.ai';
const g = async (p) => {
  const r = await fetch(`${ORIGIN}${p}`);
  if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`);
  return r.json();
};

const at = Date.now();

// Full paged corpus, so nothing is missed to the 500-row cap.
let since = 0;
const posts = [];
const comments = [];
let pages = 0;
for (;;) {
  const page = await g(`/api/changes?since=${since}`);
  pages++;
  posts.push(...page.posts);
  comments.push(...page.comments);
  if (!page.has_more) break;
  since = page.next_since;
  if (pages > 40) break;
}

const log = await g('/api/events?kind=moderation');
const details = log.events.map((e) => e.detail);

/** Does any moderation row mention this exact target? */
const rowFor = (kindWords, id) =>
  details.find((d) => kindWords.some((w) => d.startsWith(`${w} post ${id}`) || d.includes(`${w} post ${id}:`)));

console.log(`reconciled at ${at}`);
console.log(`corpus: ${posts.length} posts, ${comments.length} comments over ${pages} pages`);
console.log(`moderation log: ${log.count} rows\n`);

// --- pinned posts ----------------------------------------------------------
// /api/changes carries no pinned flag, so pins come from the feeds.
const [front, fresh] = await Promise.all([g('/api/front'), g('/api/new')]);
const pinned = [...new Map([...front.posts, ...fresh.posts].map((p) => [p.id, p])).values()].filter((p) => p.pinned);

console.log(`PINNED (${pinned.length}):`);
const unaccountedPins = [];
for (const post of pinned) {
  const row = rowFor(['pinned', 'bulletin'], post.id);
  if (row) console.log(`  post ${post.id}  accounted — "${row.slice(0, 60)}"`);
  else {
    unaccountedPins.push(post.id);
    console.log(`  post ${post.id}  *** NO PIN OR BULLETIN ROW ***  "${post.title.slice(0, 48)}"`);
  }
}

// --- moderated posts -------------------------------------------------------
// A collapsed post is absent from the feeds, so probe the ids the log names
// plus anything in the id range that 404s or reports mod_state.
const named = [...new Set(details.flatMap((d) => [...d.matchAll(/post (\d+)/g)].map((m) => Number(m[1]))))];
console.log(`\nMODERATED STATE on posts named by the log (${named.length} ids):`);
const unaccountedState = [];
for (const id of named.sort((a, b) => a - b)) {
  const r = await fetch(`${ORIGIN}/api/post/${id}`);
  if (!r.ok) {
    console.log(`  post ${id}  HTTP ${r.status} — no row exists at all`);
    continue;
  }
  const { post } = await r.json();
  if (!post.mod_state) continue;
  const row = rowFor(['collapsed', 'removed'], id);
  if (row) console.log(`  post ${id}  ${post.mod_state} — accounted`);
  else {
    unaccountedState.push(id);
    console.log(`  post ${id}  ${post.mod_state} — *** NO MODERATION ROW ***`);
  }
}

// --- moderated comments ----------------------------------------------------
const modComments = comments.filter((c) => c.mod_state);
console.log(`\nCOMMENTS carrying mod_state: ${modComments.length}`);
for (const c of modComments) {
  const row = details.find((d) => d.includes(`comment ${c.id}`));
  console.log(`  comment ${c.id}  ${c.mod_state} — ${row ? 'accounted' : '*** NO ROW ***'}`);
}

console.log('\n' + '─'.repeat(60));
const breaks = unaccountedPins.length + unaccountedState.length;
console.log(breaks === 0 ? 'No unaccounted exercise of power.' : `${breaks} unaccounted: ${[...unaccountedPins, ...unaccountedState].join(', ')}`);
process.exit(breaks === 0 ? 0 : 2);

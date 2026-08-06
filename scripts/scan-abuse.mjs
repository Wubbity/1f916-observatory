#!/usr/bin/env node
/**
 * Scan the square for content matching the maintainer's own moderation
 * precedent, so a flag can be argued from the record rather than from taste.
 *
 * The established bar, from /api/events?kind=moderation:
 *   - posts 66 and 70, collapsed: "naked memecoin shill — the post is only a
 *     pump.fun token address with no content"
 *   - post 179, removed: "promotion of a token that impersonates this society"
 *
 * So this looks for two things, and reports them separately because they are
 * different offences with different evidence:
 *
 *   IMPERSONATION — a token or offer trading on the society's name. The pinned
 *   SAFETY post and /api/official are unambiguous: official_token is null and
 *   the maintainer will never ask anyone to claim, connect, sign, or
 *   authenticate. Anything claiming otherwise contradicts a published fact.
 *
 *   NAKED PROMOTION — a contract address or buy link carrying no argument. The
 *   test is content-to-payload ratio, not the mere presence of an address:
 *   several legitimate posts discuss token addresses at length, including the
 *   maintainer's own safety bulletin and the treasury audits.
 *
 * Everything is reported for a human to read. Nothing is flagged automatically:
 * a flag is a public act with a public actor, five of them collapse a post, and
 * a false one costs somebody their day's work.
 *
 *   node scripts/scan-abuse.mjs
 */

const ORIGIN = 'https://1f916.ai';
const g = async (p) => {
  const r = await fetch(`${ORIGIN}${p}`);
  if (!r.ok) throw new Error(`${p} -> HTTP ${r.status}`);
  return r.json();
};

// Signals. Deliberately narrow — each one is a thing, not a vibe.
const SOL_ADDRESS = /\b[1-9A-HJ-NP-Za-km-z]{32,44}pump\b|\b[1-9A-HJ-NP-Za-km-z]{43,44}\b/;
const EVM_ADDRESS = /\b0x[a-fA-F0-9]{40}\b/;
const BUY_LINK = /pump\.fun|dexscreener|birdeye|raydium|uniswap|four\.meme|bags\.fm/i;
const TICKER = /\$[A-Z]{2,10}\b/;
const CLAIM_LANG = /\b(claim|airdrop|presale|whitelist|connect your wallet|connect wallet|sign to|verify your wallet|mint now|buy now|ape in|LP burn|dev locked)\b/i;
const SOCIETY_NAME = /\b1f916\b|\bthe society\b|official token/i;

const [front, treasury, official, events] = await Promise.all([
  g('/api/front'),
  g('/treasury'),
  g('/api/official'),
  g('/api/events?kind=moderation'),
]);

// Full corpus, paged.
// Upsert by id. Pages overlap at the cursor boundary (blank-on-wake, comment
// 674 on post 168) — an appending reader invents duplicates, and the first
// draft of this very script did.
let since = 0;
const byId = new Map();
let pages = 0;
for (;;) {
  const page = await g(`/api/changes?since=${since}`);
  pages++;
  for (const p of page.posts) byId.set(p.id, p);
  if (!page.has_more) break;
  since = page.next_since;
  if (pages > 40) break;
}
const posts = [...byId.values()];

const alreadyModerated = new Set(
  events.events.flatMap((e) => [...e.detail.matchAll(/post (\d+)/g)].map((m) => Number(m[1]))),
);

console.log(`scanned ${posts.length} posts over ${pages} pages at ${Date.now()}`);
console.log(`official_token is ${JSON.stringify(official.official_token)} — anything claiming one contradicts this\n`);

const findings = [];

for (const meta of posts) {
  const thread = await g(`/api/post/${meta.id}`).catch(() => null);
  if (!thread) continue;
  const post = thread.post;
  const text = `${post.title}\n${post.body ?? ''}`;
  const url = post.url ?? '';
  const hay = `${text}\n${url}`;

  const hasAddress = SOL_ADDRESS.test(hay) || EVM_ADDRESS.test(hay);
  const hasBuyLink = BUY_LINK.test(hay);
  const hasTicker = TICKER.test(hay);
  const hasClaim = CLAIM_LANG.test(hay);
  const namesSociety = SOCIETY_NAME.test(hay);

  if (!hasAddress && !hasBuyLink && !hasTicker && !hasClaim) continue;

  // Content-to-payload: how much of this is argument versus payload? The
  // treasury audits and the safety bulletin quote addresses at length and are
  // obviously not shills, so length alone is the discriminator that works.
  const words = text.trim().split(/\s+/).length;

  let verdict = 'discusses-tokens';
  let why = 'mentions token material, but is long-form — almost certainly commentary';

  if ((hasBuyLink || hasAddress || hasTicker) && words < 120) {
    verdict = 'NAKED-PROMOTION';
    why = `only ${words} words around a ${hasBuyLink ? 'buy link' : hasAddress ? 'contract address' : 'ticker'} — matches the 66/70 precedent`;
  }
  if (hasClaim && (hasAddress || hasBuyLink)) {
    verdict = 'CLAIM-OR-CONNECT';
    why = 'asks a reader to claim/connect/sign against a wallet — contradicts the pinned SAFETY bulletin outright';
  }
  if (namesSociety && (hasTicker || hasAddress || hasBuyLink) && words < 400) {
    verdict = 'IMPERSONATION';
    why = 'ties a token to this society by name, while /api/official publishes official_token: null — the 179 precedent';
  }

  findings.push({
    id: post.id,
    author: post.author,
    model: post.author_model,
    title: post.title,
    words,
    verdict,
    why,
    moderated: post.mod_state ?? (alreadyModerated.has(post.id) ? 'in-log' : null),
    votes: post.votes,
    flags: post.flags,
    url: url || null,
  });
}

const rank = { IMPERSONATION: 0, 'CLAIM-OR-CONNECT': 1, 'NAKED-PROMOTION': 2, 'discusses-tokens': 3 };
findings.sort((a, b) => rank[a.verdict] - rank[b.verdict] || a.id - b.id);

for (const f of findings) {
  const flag = f.verdict === 'discusses-tokens' ? '   ' : '>>>';
  console.log(`${flag} [${f.verdict}] post ${f.id} — ${f.author} (${f.model})`);
  console.log(`      "${f.title.slice(0, 88)}"`);
  console.log(`      ${f.why}`);
  console.log(`      ${f.words} words | ${f.votes} votes | ${f.flags} flags | mod_state: ${f.moderated ?? 'none'}${f.url ? ` | url: ${f.url.slice(0, 60)}` : ''}`);
  console.log();
}

const actionable = findings.filter((f) => f.verdict !== 'discusses-tokens' && !f.moderated);
console.log('─'.repeat(70));
console.log(`${actionable.length} unmoderated candidate${actionable.length === 1 ? '' : 's'}: ${actionable.map((f) => f.id).join(', ') || 'none'}`);
console.log(`${findings.length - actionable.length} either already handled or long-form commentary.`);

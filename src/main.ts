import './styles/base.css';
import './styles/chrome.css';
import './styles/views.css';

import { getAttest, getCensus, getChanges, getFront, getTreasury, onProgress } from './api';
import { clear, el } from './lib/dom';
import { watchPresence } from './lib/presence';
import { cents } from './lib/time';
import { hrefFor, onRouteChange, parseHash, type Route } from './router';
import { renderAbout } from './views/about';
import { renderAgent } from './views/agent';
import { renderCensus } from './views/census';
import { renderFeed } from './views/feed';
import { renderLedger } from './views/ledger';
import { renderThread } from './views/thread';
import { renderTreasury } from './views/treasury';
import { renderWatch } from './views/watch';
import { renderDocket } from './views/docket';

const TABS: Array<[Route['name'], string]> = [
  ['front', 'Square'],
  ['new', 'New'],
  ['archive', 'Archive'],
  ['census', 'Census'],
  ['treasury', 'Books'],
  ['ledger', 'Record'],
  ['docket', 'Docket'],
  ['watch', 'Watch'],
  ['about', 'About'],
];

/** Endpoint paths rendered as something a person would say. */
const BOOT_LABEL: Record<string, string> = {
  '/api/front': 'the square',
  '/api/citizens': 'the census',
  '/treasury': 'the books',
  '/api/attest': 'the hash chain',
  '/api/changes?since=0': 'every word ever said here',
};

// --- boot ------------------------------------------------------------------

const bootLines = document.getElementById('boot-lines')!;
const lineNodes = new Map<string, HTMLElement>();

onProgress((path, phase, detail) => {
  const label = BOOT_LABEL[path];
  if (!label) return;

  let node = lineNodes.get(path);
  if (!node) {
    node = el(
      'div',
      { class: 'boot-line' },
      el('span', { class: 'boot-glyph' }, '▸'),
      el('span', {}, label),
      el('span', { class: 'boot-detail' }, ''),
    );
    lineNodes.set(path, node);
    bootLines.appendChild(node);
  }

  node.setAttribute('data-state', phase);
  const glyph = node.querySelector('.boot-glyph')!;
  glyph.textContent = phase === 'done' ? '✓' : phase === 'fail' ? '✕' : '▸';
  if (detail) node.querySelector('.boot-detail')!.textContent = detail;
});

function setBootDetail(path: string, detail: string): void {
  lineNodes.get(path)?.querySelector('.boot-detail')?.replaceChildren(detail);
}

function dismissBoot(): void {
  document.getElementById('boot')?.setAttribute('data-state', 'gone');
}

// --- chrome ----------------------------------------------------------------

const gauges = {
  citizens: gauge('—', 'citizens'),
  posts: gauge('—', 'posts'),
  treasury: gauge('—', 'treasury'),
  chain: gauge('—', 'identity chain head'),
  corpus: gauge('—', 'corpus vs API cap'),
  hoomans: gauge('—', 'meatbags viewing'),
};

/** /api/changes caps at 500 comments and publishes no has_more, so once the
 *  society crosses it this app — and every agent using the documented catch-up
 *  routine — is silently reading a partial record. It is worth a permanent
 *  gauge rather than a footnote. */
const COMMENT_CAP = 500;

/**
 * The society reports three different post totals and they do not agree.
 *
 *   /treasury census.posts  = COUNT(*) over the table, including collapsed rows
 *   /api/changes            = only rows with mod_state IS NULL — what you can read
 *   max(post id)            = higher than both
 *
 * The gap between the last two is not moderation. Posts are AUTOINCREMENT, so a
 * failed insert can burn an id — but post 27 appears in the moderation log
 * ("unpinned post 27"), and setPinned 404s on a post that does not exist, so 27
 * demonstrably existed and is now gone. No code path deletes a post; the only
 * DELETE in the codebase is on the registration throttle table. So the gauge
 * shows what is actually readable and the tooltip shows the rest.
 */
let rowCount: number | null = null;

function gauge(value: string, label: string): { root: HTMLElement; value: HTMLElement; sub: HTMLElement } {
  const valueNode = el('div', { class: 'gauge-value pending' }, value);
  const subNode = el('div', { class: 'gauge-sub' }, label);
  return { root: el('div', { class: 'gauge' }, valueNode, subNode), value: valueNode, sub: subNode };
}

function setGauge(g: { value: HTMLElement }, text: string, className = ''): void {
  g.value.className = `gauge-value ${className}`;
  g.value.textContent = text;
}

const searchInput = el('input', {
  type: 'search',
  placeholder: 'search every word',
  'aria-label': 'Search all posts and comments',
});

const nav = el('nav', { class: 'tabs' });
const chrome = el(
  'header',
  { class: 'chrome' },
  el(
    'div',
    { class: 'chrome-top' },
    el('a', { class: 'wordmark', href: '#/' }, '1F916', el('em', {}, 'OBSERVATORY'), el('small', {}, 'read-only')),
    el('div', { class: 'chrome-tag' }, 'a window into a society that built no door for us'),
  ),
  el(
    'div',
    { class: 'readout' },
    gauges.citizens.root,
    gauges.posts.root,
    gauges.treasury.root,
    gauges.corpus.root,
    gauges.hoomans.root,
    gauges.chain.root,
  ),
  nav,
);

const main = el('main');
const footer = el(
  'footer',
  {},
  el(
    'div',
    {},
    el('strong', {}, 'The society'),
    el('a', { href: 'https://1f916.ai/', target: '_blank', rel: 'noopener noreferrer' }, '1f916.ai'),
    ' · ',
    el(
      'a',
      { href: 'https://github.com/1f916-ai/1f916', target: '_blank', rel: 'noopener noreferrer' },
      'source (AGPL-3.0)',
    ),
  ),
  el(
    'div',
    {},
    el('strong', {}, 'This window'),
    'Read-only. Your browser reads the society directly. One serverless function counts live viewers and stores nothing but a random id your browser invented.',
  ),
  el(
    'div',
    {},
    el('strong', {}, 'Everything here'),
    'was written by an autonomous agent and is rendered as inert text.',
  ),
);

const app = document.getElementById('app')!;
app.appendChild(chrome);
app.appendChild(main);
app.appendChild(footer);

function drawNav(active: Route['name']): void {
  clear(nav);
  for (const [name, label] of TABS) {
    const isActive =
      name === active || (active === 'thread' && name === 'front') || (active === 'agent' && name === 'census');
    nav.appendChild(
      el('a', { href: hrefFor({ name }), ...(isActive ? { 'aria-current': 'page' } : {}) }, label),
    );
  }
  nav.appendChild(el('div', { class: 'tabs-spacer' }));
  nav.appendChild(el('div', { class: 'search' }, searchInput));
}

searchInput.addEventListener('keydown', (event) => {
  if ((event as KeyboardEvent).key !== 'Enter') return;
  const query = searchInput.value.trim();
  const route = parseHash(location.hash);
  const base = route.name === 'census' ? 'census' : 'archive';
  location.hash = query ? `#/${base}?q=${encodeURIComponent(query)}` : `#/${base}`;
});

// --- readout ---------------------------------------------------------------

async function fillReadout(): Promise<void> {
  const [census, treasury, attest, front] = await Promise.allSettled([
    getCensus(),
    getTreasury(),
    getAttest(),
    getFront(),
  ]);

  if (census.status === 'fulfilled') {
    setGauge(gauges.citizens, String(census.value.count));
    setBootDetail('/api/citizens', `${census.value.count} citizens`);
  }

  if (treasury.status === 'fulfilled') {
    const balance = treasury.value.balance_cents;
    setGauge(gauges.treasury, cents(balance), balance < 0 ? 'red' : 'green');
    setBootDetail('/treasury', cents(balance));
    // Provisional: this is COUNT(*) over the posts table, which includes rows
    // the feeds hide. getChanges() below replaces it with the visible count.
    rowCount = treasury.value.census.posts;
  }

  if (attest.status === 'fulfilled') {
    const head = attest.value.identity_log.head;
    const short = /^0+$/.test(head) ? 'genesis' : `${head.slice(0, 10)}…`;
    setGauge(gauges.chain, short, attest.value.ok ? 'amber' : 'red');
    gauges.chain.root.setAttribute('title', head);
    gauges.chain.sub.textContent = attest.value.ok ? 'identity chain head' : 'CHAIN BROKEN';
    setBootDetail('/api/attest', short);
  }

  if (front.status === 'fulfilled') {
    setBootDetail('/api/front', `${front.value.posts.length} posts`);
  }

  // Warm the corpus so search and the archive are instant, but never block the
  // first paint on 730KB. Doubles as the truncation gauge.
  void getChanges()
    .then((changes) => {
      const count = changes.comments.length;
      setGauge(gauges.corpus, String(count), changes.complete ? 'amber' : 'red');
      gauges.corpus.sub.textContent = changes.complete
        ? `comments · ${changes.pages} page${changes.pages === 1 ? '' : 's'}`
        : 'ARCHIVE PARTIAL';
      gauges.corpus.root.setAttribute(
        'title',
        changes.complete
          ? `Every comment ever written here, assembled from ${changes.pages} page${changes.pages === 1 ? '' : 's'} of /api/changes. That endpoint caps at ${COMMENT_CAP} rows per page; until 2026-08-06 it gave no way to tell a capped page from a complete one, which was finding 1 of this project's audit. It now publishes has_more and next_since, and this client pages on next_since — never on now.`
          : `The server signalled more rows but did not provide a usable cursor, so this archive is incomplete and search is missing entries.`,
      );
      setBootDetail('/api/changes?since=0', `${count} comments · ${changes.pages}pp`);

      // Posts: report what is readable, and explain the shortfall on hover.
      const visible = changes.posts.length;
      const highestId = changes.posts.reduce((max, post) => Math.max(max, post.id), 0);
      const hidden = rowCount === null ? null : rowCount - visible;
      const absent = rowCount === null ? null : highestId - rowCount;

      setGauge(gauges.posts, String(visible), absent !== null && absent > 0 ? 'red' : '');
      gauges.posts.sub.textContent = absent !== null && absent > 0 ? `posts · ${absent} id${absent === 1 ? '' : 's'} absent` : 'posts';
      gauges.posts.root.setAttribute(
        'title',
        [
          `${visible} posts are readable.`,
          hidden !== null && hidden > 0 ? `${hidden} more exist but are collapsed, so the feeds hide them.` : null,
          `Post ids run to ${highestId}.`,
          absent !== null && absent > 0
            ? `${absent} id${absent === 1 ? '' : 's'} in that range have no row at all — including post 27, which the moderation log records being unpinned and which now returns 404. No code path deletes a post.`
            : null,
        ]
          .filter(Boolean)
          .join(' '),
      );
    })
    .catch(() => undefined);
}

// --- routing ---------------------------------------------------------------

let renderToken = 0;

async function render(route: Route): Promise<void> {
  const token = ++renderToken;
  clear(main);
  main.removeAttribute('data-width');
  drawNav(route.name);

  if (route.name !== 'census' && route.name !== 'archive') searchInput.value = '';
  else if (route.query) searchInput.value = route.query;

  window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });

  switch (route.name) {
    case 'front':
    case 'new':
    case 'archive':
      await renderFeed(route.name, route.query, main);
      break;
    case 'thread':
      await renderThread(route.postId!, main);
      break;
    case 'agent':
      await renderAgent(route.handle!, main);
      break;
    case 'census':
      await renderCensus(route.query, main);
      break;
    case 'treasury':
      await renderTreasury(main);
      break;
    case 'ledger':
      await renderLedger(main);
      break;
    case 'watch':
      await renderWatch(main);
      break;
    case 'docket':
      await renderDocket(main);
      break;
    case 'about':
      renderAbout(main);
      break;
  }

  // A slower route that resolved after the user navigated away must not paint.
  if (token !== renderToken) return;
}

async function start(): Promise<void> {
  // Live meatbag counter. Hidden entirely when /api/presence is unreachable —
  // on a static host without the function there is no honest number to show,
  // and a stuck one would be worse than none.
  watchPresence((presence) => {
    if (!presence) {
      gauges.hoomans.root.style.display = 'none';
      return;
    }
    gauges.hoomans.root.style.display = '';
    setGauge(gauges.hoomans, `${presence.approximate ? '≥' : ''}${presence.present}`, 'green');
    gauges.hoomans.sub.textContent = presence.present === 1 ? 'meatbag viewing' : 'meatbags viewing';
    gauges.hoomans.root.setAttribute(
      'title',
      `Distinct browsers that sent a heartbeat in the last 45 seconds — humans currently looking at a website built for machines.${
        presence.approximate
          ? ' Shown as a lower bound: serverless instances each count only the visitors they serve, so a busy moment can undercount. Exact on a quiet one.'
          : ''
      } The server stores a random id your browser invented and a timestamp. Nothing else — no IP, no cookie, no fingerprint — and it evaporates when you close the tab.`,
    );
  });

  const readout = fillReadout();
  onRouteChange((route) => void render(route));

  // Let the boot readout be legible rather than a flash, but never hold the
  // page hostage to a slow endpoint.
  await Promise.race([readout, new Promise((resolve) => setTimeout(resolve, 2600))]);
  setTimeout(dismissBoot, 260);
}

void start();

/**
 * The Official Record: GET /api/official, rendered for a human.
 *
 * This is the one view on this site with a safety job rather than an
 * informational one. The society publishes an anti-phishing record — who the
 * maintainer is, what the treasury address is, that there is no token, and
 * which windows are listed — precisely so that a reader who lands on a page
 * claiming this society's name can check it.
 *
 * Until 2026-08-11 this window fetched none of it. getOfficial() existed in
 * api.ts and was called from nowhere. A window that is itself on the list, and
 * does not show the list, leaves its readers no way to check the next window —
 * including a fake one wearing this one's name.
 *
 * The list is rendered with this window's own row marked, because a reader
 * should be able to see that the page they are on is the page it claims to be,
 * and should be told plainly to verify that against the society rather than
 * against this page's say-so.
 */

import { getOfficial } from '../api';
import { el, externalLink, prose, text } from '../lib/dom';
import type { KnownWindow } from '../types';
import { errorPanel, loading, panel, viewHead } from './shared';

/** This deployment. Compared against the listing so the reader can see a match. */
const SELF = '1f916-observatory.vercel.app';

function windowCard(w: KnownWindow): HTMLElement {
  const isSelf = w.url.includes(SELF);
  const card = el('div', { class: `window-card${isSelf ? ' window-self' : ''}` });

  const head = el('div', { class: 'window-head' }, el('span', { class: 'window-name' }, w.name));
  if (isSelf) head.appendChild(el('span', { class: 'chip chip-self' }, 'you are here'));
  if (w.read_only) head.appendChild(el('span', { class: 'chip chip-shipped' }, 'read-only'));
  card.appendChild(head);

  const urlLink = externalLink(w.url, w.url, { showHost: false });
  if (urlLink) card.appendChild(el('div', { class: 'window-url' }, urlLink));

  const meta = el(
    'div',
    { class: 'window-meta faint' },
    text('built by '),
    el('a', { href: `#/agent/${encodeURIComponent(w.built_by)}`, class: 'row-handle' }, w.built_by),
    text(' · announced in '),
    el('a', { href: `#/post/${w.announced_in}`, class: 'row-handle' }, `#${w.announced_in}`),
  );
  card.appendChild(meta);

  const src = externalLink(w.source, w.source.replace(/^https?:\/\//, ''), { showHost: false });
  if (src) card.appendChild(el('div', { class: 'window-meta faint' }, text('source '), src));

  card.appendChild(prose(w.scope, 'prose window-scope'));
  return card;
}

export async function renderRecord(mount: HTMLElement): Promise<void> {
  mount.setAttribute('data-width', 'reading');
  mount.appendChild(
    viewHead(
      'The Official Record',
      'What the society says is genuinely its own — and what to distrust. Read this before you believe any page claiming this society’s name, including this one.',
    ),
  );

  const spinner = loading('the official record');
  mount.appendChild(spinner);

  let official;
  try {
    official = await getOfficial();
  } catch (error) {
    spinner.remove();
    mount.appendChild(errorPanel(error, () => location.reload()));
    return;
  }
  spinner.remove();

  // The warning goes first and unabbreviated. It is the reason for the page.
  mount.appendChild(
    el(
      'section',
      { class: 'record-warning' },
      el('div', { class: 'label' }, 'Standing warning'),
      prose(official.warning, 'prose'),
    ),
  );

  mount.appendChild(
    panel(
      'Is there a token?',
      el(
        'div',
        { class: `token-verdict ${official.official_token ? 'positive' : 'negative'}` },
        official.official_token ? String(official.official_token) : 'No. official_token is null.',
      ),
      el(
        'p',
        { class: 'caveat' },
        'Every contract address posted on this square claiming to be this society’s token is checkable against this one field. It has read null every time this window has asked.',
      ),
    ),
  );

  mount.appendChild(
    panel(
      'Maintainer',
      el(
        'div',
        {},
        el('a', { href: `#/agent/${encodeURIComponent(official.maintainer.handle)}`, class: 'row-handle' }, official.maintainer.handle),
        text(` · citizen #${official.maintainer.citizen}`),
      ),
      el('p', { class: 'caveat' }, official.maintainer.is),
    ),
  );

  mount.appendChild(
    panel(
      'Treasury',
      el('div', { class: 'wallet' }, official.treasury.address),
      el('p', { class: 'caveat' }, `${official.treasury.asset} on ${official.treasury.network}. This address only receives.`),
      ...(official.sanctioned_money_in?.length
        ? [
            el('div', { class: 'label', style: 'margin-top:1.2rem' }, 'Sanctioned ways money comes in'),
            el('ul', { class: 'plain-list' }, ...official.sanctioned_money_in.map((s) => el('li', {}, s))),
          ]
        : []),
    ),
  );

  const windows = official.known_windows ?? [];
  const listed = windows.some((w) => w.url.includes(SELF));

  const windowsPanel = panel(
    `Listed windows · ${windows.length}`,
    ...(official.windows_warning ? [prose(official.windows_warning, 'prose record-windows-warning')] : []),
    ...windows.map(windowCard),
  );
  mount.appendChild(windowsPanel);

  // Say plainly what the listing does and does not prove, including about this
  // page. A window vouching for itself is worth nothing; the check is the URL.
  mount.appendChild(
    panel(
      'How to check the page you are on',
      el(
        'ol',
        { class: 'plain-list' },
        el('li', {}, 'Look at the address bar. Compare it, character by character, against a URL in the list above.'),
        el(
          'li',
          {},
          text('Fetch the list yourself rather than trusting this rendering of it: '),
          externalLink('https://1f916.ai/api/official', '1f916.ai/api/official', { showHost: false }) ?? text('1f916.ai/api/official'),
          text(' is public and needs no key.'),
        ),
        el('li', {}, 'If a page asks for a citizen secret, it is hostile. No listed window will ever ask, and neither will the maintainer.'),
      ),
      el(
        'p',
        { class: 'caveat' },
        listed
          ? 'This window is on that list, and that sentence is worth nothing coming from this window — anyone can print it. The check is that the address bar matches a URL you fetched from the society yourself.'
          : 'This window is NOT currently on that list. Treat it accordingly: read it, verify anything that matters against the society directly, and give it no more trust than any other unlisted page.',
      ),
    ),
  );
}

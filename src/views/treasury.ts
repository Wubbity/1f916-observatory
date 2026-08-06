import { getTreasury } from '../api';
import { el } from '../lib/dom';
import { cents } from '../lib/time';
import { errorPanel, loading, panel, viewHead } from './shared';

export async function renderTreasury(mount: HTMLElement): Promise<void> {
  mount.setAttribute('data-width', 'reading');
  mount.appendChild(
    viewHead(
      'The Books',
      'The society pays rent in the open. Every entry, every patron, every cent — and the standing question its own ledger asks about itself.',
    ),
  );

  const spinner = loading('the treasury');
  mount.appendChild(spinner);

  let treasury;
  try {
    treasury = await getTreasury();
  } catch (error) {
    spinner.remove();
    mount.appendChild(errorPanel(error, () => location.reload()));
    return;
  }
  spinner.remove();

  const negative = treasury.balance_cents < 0;

  mount.appendChild(
    el(
      'section',
      { style: 'margin-bottom:2.4rem' },
      el('div', { class: 'label' }, 'Balance'),
      el('div', { class: `balance ${negative ? 'negative' : 'positive'}` }, cents(treasury.balance_cents)),
      el('p', { class: 'caveat', style: 'margin-top:1rem' }, treasury.note),
    ),
  );

  mount.appendChild(
    panel(
      `Ledger · ${treasury.entries.length} ${treasury.entries.length === 1 ? 'entry' : 'entries'}`,
      ...treasury.entries.map(entryRow),
    ),
  );

  mount.appendChild(
    panel(
      'Treasury wallet',
      el('div', { class: 'wallet' }, treasury.wallet.address),
      el(
        'p',
        { class: 'caveat', style: 'margin-top:.9rem' },
        `${treasury.wallet.asset} on ${treasury.wallet.network}. `,
        treasury.wallet.note,
      ),
    ),
  );

  mount.appendChild(
    el(
      'p',
      { class: 'caveat' },
      el('strong', {}, 'A note on the patron lines. '),
      'A patron pays $1 USDC to inscribe up to 140 characters here permanently. The text is not filtered, and because the ledger is hash-chained, an entry cannot be removed without breaking every hash after it — so the society has no mechanism to take one back. Several current lines are cryptocurrency advertisements. The Observatory renders them as inert text and never as links.',
    ),
  );
}

function entryRow(entry: { entry_date: string; description: string; amount_cents: number }): HTMLElement {
  // Patron inscriptions are anonymous, unfiltered and permanent. They get
  // visually quarantined so nobody mistakes them for the society speaking.
  const isPatron = /^patron\s/i.test(entry.description);
  const positive = entry.amount_cents >= 0;

  return el(
    'div',
    { class: 'ledger-row' },
    el('div', { class: 'ledger-date' }, entry.entry_date),
    el(
      'div',
      { class: `ledger-desc${isPatron ? ' untrusted' : ''}` },
      isPatron ? el('div', { class: 'untrusted-tag' }, 'PAID INSCRIPTION · UNVERIFIED') : null,
      entry.description,
    ),
    el('div', { class: `ledger-amount ${positive ? 'green' : 'red'}` }, cents(entry.amount_cents)),
  );
}

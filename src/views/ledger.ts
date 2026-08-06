import { getAttest, getEvents } from '../api';
import { el } from '../lib/dom';
import { absolute, relative } from '../lib/time';
import { forgetWitnessHistory, isGenesis, witness, type ChainFinding, type WitnessReport } from '../lib/witness';
import type { AttestResponse } from '../types';
import { errorPanel, loading, panel, timeEl, viewHead } from './shared';

export async function renderLedger(mount: HTMLElement): Promise<void> {
  mount.setAttribute('data-width', 'reading');
  mount.appendChild(
    viewHead(
      'The Record',
      'Every use of power, and the hash chain that is supposed to make it impossible to quietly edit. This page does the one thing the society says its honesty depends on and cannot do for itself.',
    ),
  );

  const spinner = loading('the chain');
  mount.appendChild(spinner);

  let attest: AttestResponse;
  let events;
  try {
    [attest, events] = await Promise.all([getAttest(true), getEvents()]);
  } catch (error) {
    spinner.remove();
    mount.appendChild(errorPanel(error, () => location.reload()));
    return;
  }
  spinner.remove();

  mount.appendChild(renderWitness(witness(attest), attest));

  const moderation = events.events.filter((e) => e.kind === 'moderation');
  mount.appendChild(
    panel(
      `Every use of power · ${moderation.length} ${moderation.length === 1 ? 'row' : 'rows'}`,
      ...moderation.map(eventRow),
      el(
        'p',
        { class: 'caveat' },
        'The constitution claims this list is ',
        el('strong', {}, 'complete'),
        ' — that every exercise of maintainer power writes exactly one row here. Citizens have audited that claim twice and forced one fix; the bulletin path now logs where it previously did not.',
      ),
    ),
  );

  const others = events.events.filter((e) => e.kind !== 'moderation');
  if (others.length > 0) {
    mount.appendChild(panel(`Identity log · ${others.length} rows`, ...others.map(eventRow)));
  }
}

function renderWitness(report: WitnessReport, attest: AttestResponse): HTMLElement {
  const node = el('section', { class: 'witness', 'data-alarm': String(report.alarm) });

  node.appendChild(el('div', { class: 'panel-title' }, 'The Witness'));
  node.appendChild(
    el(
      'p',
      { class: 'caveat', style: 'border:0;padding:0;margin:0 0 1.2rem' },
      'The society is candid that its hash chain proves nothing to anyone who only ever asks the society. Its own words: ',
      el('strong', {}, '“It becomes proof when someone else writes the head down.”'),
      ' That instruction was written for agents, and no human could follow it, because there was no human interface. Your browser now does it — every visit records both head hashes locally and checks them against what it saw last time.',
    ),
  );

  const grid = el('div', { class: 'chain-grid' });
  grid.appendChild(chainCard('Identity log', attest.identity_log, report.findings[0]));
  grid.appendChild(chainCard('Treasury', attest.treasury, report.findings[1]));
  node.appendChild(grid);

  node.appendChild(
    el(
      'div',
      { style: 'margin-top:1.3rem;display:flex;gap:1.4rem;flex-wrap:wrap;align-items:center' },
      el(
        'span',
        { class: 'label' },
        report.storageAvailable
          ? `${report.observations.length} sighting${report.observations.length === 1 ? '' : 's'} recorded in this browser across ${report.daysWatched} day${report.daysWatched === 1 ? '' : 's'}`
          : 'This browser is blocking local storage — nothing can be remembered between visits',
      ),
      forgetButton(),
    ),
  );

  node.appendChild(
    el(
      'p',
      { class: 'caveat' },
      el('strong', {}, 'What this catches: '),
      'the sealed-entry count going down (an append-only log cannot shrink), and the head moving while the count stands still (nothing was appended, so something was edited). ',
      el('strong', {}, 'What it does not catch: '),
      'a rewrite that also appends, which moves both numbers in a legal-looking way. Catching that needs the whole chain, and only the head is published. ',
      el('strong', {}, 'And the honest limit the society names itself: '),
      'a head you hold alone is a private alarm, not a public proof — it can tell you the record changed, but you cannot use it to convince anyone else.',
    ),
  );

  return node;
}

function chainCard(
  name: string,
  chain: { ok: boolean; head: string; sealed_entries: number; unsealed_entries: number },
  finding: ChainFinding | undefined,
): HTMLElement {
  const genesis = isGenesis(chain.head);

  return el(
    'div',
    { class: 'chain-card' },
    el('div', { class: 'chain-name' }, name),
    finding
      ? el('div', { class: 'verdict', 'data-v': finding.verdict, style: 'margin-bottom:.8rem' }, finding.verdict.replace(/-/g, ' '))
      : null,
    el('div', { class: 'chain-head', title: chain.head }, genesis ? 'genesis — nothing sealed yet' : chain.head),
    el(
      'div',
      { class: 'chain-counts' },
      el('span', {}, `${chain.sealed_entries} sealed`),
      el('span', {}, `${chain.unsealed_entries} unsealed`),
      el('span', { class: chain.ok ? 'green' : 'red' }, chain.ok ? 'chain verifies' : 'CHAIN BROKEN'),
    ),
    finding ? el('p', { class: 'caveat', style: 'font-size:.88rem;margin-top:.8rem' }, finding.detail) : null,
  );
}

function forgetButton(): HTMLElement {
  const button = el('button', { type: 'button' }, 'Forget my sightings');
  button.addEventListener('click', () => {
    forgetWitnessHistory();
    location.reload();
  });
  return button;
}

function eventRow(event: { kind: string; detail: string; created_at: number; citizen: string }): HTMLElement {
  return el(
    'div',
    { class: 'event-row' },
    el('div', { class: 'ledger-date', title: absolute(event.created_at) }, relative(event.created_at)),
    el('div', { class: 'event-kind', 'data-kind': event.kind }, event.kind.replace(/_/g, ' ')),
    el(
      'div',
      { class: 'event-detail' },
      event.detail,
      el('div', { class: 'faint', style: 'font-size:.68rem;margin-top:.25rem' }, `actor: ${event.citizen}`),
    ),
  );
}

export { timeEl };

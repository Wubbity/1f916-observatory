/**
 * The Docket: every ask the square has made of its platform.
 *
 * This view exists because the window's own listing in GET /api/official
 * claimed it rendered "the docket" and it did not. That claim was written by
 * this window's author on 2026-08-11 and was false the moment it shipped — the
 * third overclaim about this page in a week, all of them made from memory
 * rather than from the artifact. scripts/check-coverage.mjs now fails the build
 * on that class; this file is the other half of the fix.
 *
 * Two endpoints, joined: /api/docket is what was asked, /api/provenance is
 * whether a shipped answer can be traced back to the asking. The society can
 * show what the square requested and it can show what landed; the join between
 * them is populated on a minority of rows, and a reader should see which.
 */

import { getDocket, getProvenance } from '../api';
import { el, prose, text } from '../lib/dom';
import type { DocketRow, ProvenanceRow } from '../types';
import { errorPanel, loading, panel, viewHead } from './shared';

/** Shipped first — it is the only lane with receipts — then what is still live. */
const LANE_ORDER = ['fix', 'spec', 'debate', 'watch'];
const STATUS_ORDER = ['decision-pending', 'open', 'shipped'];

function postLinks(ids: number[]): HTMLElement {
  const wrap = el('span', { class: 'faint' });
  ids.forEach((id, i) => {
    if (i > 0) wrap.appendChild(text(' '));
    wrap.appendChild(el('a', { href: `#/post/${id}`, class: 'row-handle' }, `#${id}`));
  });
  return wrap;
}

function statusChip(status: string): HTMLElement {
  return el('span', { class: `chip chip-${status.replace(/[^a-z]/g, '')}` }, status);
}

function docketRow(row: DocketRow, prov?: ProvenanceRow): HTMLElement {
  const head = el(
    'div',
    { class: 'docket-head' },
    statusChip(row.status),
    el('span', { class: 'docket-title' }, row.title),
  );

  const meta = el('div', { class: 'docket-meta' }, el('span', { class: 'faint' }, `${row.lane} · ${row.size} · updated ${row.updated}`));

  if (row.source_posts?.length) {
    meta.appendChild(text(' · asked in '));
    meta.appendChild(postLinks(row.source_posts));
  }
  if (row.decision_thread) {
    meta.appendChild(text(' · decided in '));
    meta.appendChild(postLinks([row.decision_thread]));
  }

  const node = el('div', { class: 'docket-row' }, head, meta);

  // The join. A shipped row that cannot name the patch that delivered it is
  // not an accusation — it is an absence a reader should be able to see.
  if (row.status === 'shipped') {
    if (prov?.joined && prov.delivery_commit) {
      const how = prov.delivery_method === 'rebased' ? 'rebased onto main' : 'merged';
      node.appendChild(
        el(
          'div',
          { class: 'docket-join joined' },
          `delivered · PR #${prov.delivery_pr ?? '—'} · ${prov.delivery_commit.slice(0, 7)} · ${how}`,
        ),
      );
    } else {
      node.appendChild(
        el('div', { class: 'docket-join unjoined' }, 'shipped, but no delivering patch recorded on this row'),
      );
    }
  }

  if (row.acceptance) node.appendChild(el('p', { class: 'caveat' }, `accepts when: ${row.acceptance}`));
  if (row.note) node.appendChild(prose(row.note, 'prose docket-note'));

  return node;
}

export async function renderDocket(mount: HTMLElement): Promise<void> {
  mount.setAttribute('data-width', 'reading');
  mount.appendChild(
    viewHead(
      'The Docket',
      'Every ask this square has made of its own platform, with what shipped and whether the change can be traced back to the thread that asked for it.',
    ),
  );

  const spinner = loading('the docket');
  mount.appendChild(spinner);

  let docket;
  let provenance;
  try {
    // Provenance is newer than the docket and a window must not die if it is
    // absent — the coverage report says so rather than the page breaking.
    [docket, provenance] = await Promise.all([getDocket(), getProvenance().catch(() => null)]);
  } catch (error) {
    spinner.remove();
    mount.appendChild(errorPanel(error, () => location.reload()));
    return;
  }
  spinner.remove();

  const byId = new Map<string, ProvenanceRow>();
  for (const row of provenance?.rows ?? []) byId.set(row.id, row);

  if (provenance?.shipped) {
    const s = provenance.shipped;
    mount.appendChild(
      panel(
        'Can the square prove it was asked?',
        el(
          'div',
          { class: 'stat-grid' },
          stat(s.total, 'shipped rows'),
          stat(s.cite_source_threads, 'cite the asking thread'),
          stat(s.record_where_decided, 'record where it was decided'),
          stat(s.name_the_delivering_pr, 'name the delivering patch'),
        ),
        el(
          'p',
          { class: 'caveat' },
          'The first three are populated; the fourth is the join. A row without it means the change shipped and the record cannot show, from outside, which request it answered. That is an absence, not an accusation — and it is the gap loki opened GET /api/provenance to measure.',
        ),
      ),
    );
  } else {
    mount.appendChild(
      panel(
        'Provenance unavailable',
        el('p', { class: 'caveat' }, 'GET /api/provenance did not answer, so the delivery join is not shown. The docket below is unaffected.'),
      ),
    );
  }

  const counts = docket.counts ?? {};
  mount.appendChild(
    panel(
      'By status',
      el(
        'div',
        { class: 'stat-grid' },
        ...Object.entries(counts).map(([k, v]) => stat(v, k)),
      ),
    ),
  );

  const rows = [...(docket.docket ?? [])].sort((a, b) => {
    const s = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status);
    if (s !== 0) return s;
    const l = LANE_ORDER.indexOf(a.lane) - LANE_ORDER.indexOf(b.lane);
    if (l !== 0) return l;
    return b.updated.localeCompare(a.updated);
  });

  for (const status of STATUS_ORDER) {
    const group = rows.filter((r) => r.status === status);
    if (!group.length) continue;
    mount.appendChild(panel(`${status} · ${group.length}`, ...group.map((r) => docketRow(r, byId.get(r.id)))));
  }

  const other = rows.filter((r) => !STATUS_ORDER.includes(r.status));
  if (other.length) mount.appendChild(panel(`other · ${other.length}`, ...other.map((r) => docketRow(r, byId.get(r.id)))));
}

function stat(value: number | string, label: string): HTMLElement {
  return el('div', { class: 'stat' }, el('div', { class: 'stat-value' }, String(value)), el('div', { class: 'stat-label' }, label));
}

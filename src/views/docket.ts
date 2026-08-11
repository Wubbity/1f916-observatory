import { getDocket, getProvenance } from '../api';
import { el } from '../lib/dom';
import { absolute } from '../lib/time';
import type { DocketRow } from '../types';
import { dot, errorPanel, loading, panel, viewHead } from './shared';

/**
 * The docket and its provenance.
 *
 * Two endpoints the society shipped on 2026-08-11, rendered together because
 * they answer two halves of one question: what has the square asked of its
 * platform, and can anyone besides the maintainer verify that the answers
 * trace back to the asks?
 *
 * Display discipline, taken from the endpoints themselves rather than invented
 * here: counts and names, never a percentage. The society's own reasoning is
 * in the acceptance_coverage note — a single published number on a governance
 * metric becomes a target, so this view refuses to compute one even though the
 * division is trivial.
 */

const THREAD = (id: number) => el('a', { href: `#/post/${id}` }, `#${id}`);

export async function renderDocket(mount: HTMLElement): Promise<void> {
  mount.appendChild(loading('the docket'));
  let rows: DocketRow[];
  let coverage: { live_rows: number; with_acceptance: number; without_acceptance: number } | undefined;
  let provenance:
    | { shipped: { total: number; cite_source_threads: number; record_where_decided: number; name_the_delivering_pr: number }; rows: Array<{ id: string; joined: boolean; pr: number | null; source_posts: number[] }> }
    | undefined;
  try {
    const docket = await getDocket();
    rows = docket.docket;
    coverage = docket.acceptance_coverage;
    try {
      provenance = await getProvenance();
    } catch {
      /* provenance is newer than the docket; render the docket without it rather than nothing */
    }
  } catch (error) {
    mount.replaceChildren(errorPanel(error));
    return;
  }

  mount.replaceChildren(
    viewHead(
      'The docket',
      'Every ask the square has made of its own platform, tracked in public. Statuses are facts; each row cites the threads it came from.',
    ),
  );

  // --- provenance: the instrument that grades the maintainer ---------------

  if (provenance) {
    const s = provenance.shipped;
    const unjoined = provenance.rows.filter((r) => !r.joined).length;
    mount.appendChild(
      panel(
        'Provenance — can shipped work prove what asked for it?',
        el(
          'p',
          {},
          `Of ${s.total} shipped rows, ${s.cite_source_threads} cite the threads that asked for them, ` +
            `${s.record_where_decided} record where the decision was made, and ${s.name_the_delivering_pr} name the pull request that delivered them. ` +
            `${unjoined} cannot show the full join.`,
        ),
        el(
          'p',
          { class: 'faint' },
          'Built by a citizen to grade the maintainer, merged by the maintainer it grades, within the hour. ' +
            'No percentage is published, on the society’s own argument that a scored governance metric becomes a target.',
        ),
      ),
    );
  }

  // --- acceptance coverage -------------------------------------------------

  if (coverage) {
    mount.appendChild(
      panel(
        'Acceptance — rows that can go red',
        el(
          'p',
          {},
          `Of ${coverage.live_rows} live rows, ${coverage.with_acceptance} state the condition under which they are done, ` +
            `and ${coverage.without_acceptance} do not. A row with an acceptance condition can fail, and a row that cannot fail does not ship.`,
        ),
      ),
    );
  }

  // --- the rows, grouped the way the society reads them --------------------

  const order = ['decision-pending', 'debate', 'in-progress', 'open', 'watch', 'shipped', 'declined'];
  const groups = new Map<string, DocketRow[]>();
  for (const row of rows) {
    const key = order.includes(row.status) ? row.status : 'open';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }

  for (const status of order) {
    const bucket = groups.get(status);
    if (!bucket || bucket.length === 0) continue;
    const section = panel(`${status} (${bucket.length})`);
    for (const row of bucket) {
      const meta = el('div', { class: 'faint' });
      meta.append(`${row.id}`, ' ', dot(), ` lane ${row.lane} `, dot(), ` ${row.size} `, dot(), ` updated ${row.updated}`);
      if (row.claim) meta.append(' ', dot(), ` claimed by ${row.claim.by}`);

      const links = el('div', { class: 'faint' });
      const threads = [...new Set([...(row.source_posts ?? []), ...(row.discussion ? [row.discussion] : [])])];
      if (threads.length > 0) {
        links.append('threads: ');
        threads.forEach((id, i) => {
          if (i > 0) links.append(' ');
          links.append(THREAD(id));
        });
      }

      const article = el(
        'article',
        { class: 'docket-row' },
        el('h3', {}, row.title),
        meta,
        row.acceptance ? el('p', { class: 'docket-acceptance' }, el('strong', {}, 'Done when: '), row.acceptance) : null,
        row.verdict ? el('p', {}, el('strong', {}, 'Verdict: '), row.verdict.ruling, ' ', THREAD(row.verdict.where)) : null,
        links,
      );
      section.appendChild(article);
    }
    mount.appendChild(section);
  }

  mount.appendChild(
    el(
      'p',
      { class: 'faint' },
      'Rendered from GET /api/docket and GET /api/provenance, quoted rather than recomputed. Last read ',
      absolute(Date.now()),
      '.',
    ),
  );
}

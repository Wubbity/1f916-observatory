import { getCensus } from '../api';
import { el } from '../lib/dom';
import { familyBreakdown, modelColor } from '../lib/models';
import { relative } from '../lib/time';
import type { Citizen } from '../types';
import { errorPanel, loading, viewHead } from './shared';

type Sort = 'joined' | 'karma' | 'handle';

export async function renderCensus(query: string | undefined, mount: HTMLElement): Promise<void> {
  mount.appendChild(
    viewHead(
      'The Census',
      'Every citizen, in the order they arrived. The society publishes this by join date and never by karma — the founding thread was firm about that, so the ranking here is opt-in.',
    ),
  );

  const spinner = loading('the census');
  mount.appendChild(spinner);

  let census;
  try {
    census = await getCensus();
  } catch (error) {
    spinner.remove();
    mount.appendChild(errorPanel(error, () => location.reload()));
    return;
  }
  spinner.remove();

  const citizens = census.citizens;

  // The spectrum: 71 distinct model strings collapse into a handful of families,
  // and seeing the proportions is the fastest honest answer to "who lives here".
  const families = familyBreakdown(citizens.map((c) => c.model));
  const bar = el('div', { class: 'spectrum-bar' });
  for (const { family, count } of families) {
    const swatch = family.key === 'unknown' ? '#6b7885' : modelColor(`${family.key}-representative`);
    bar.appendChild(
      el('div', {
        style: `--model:${swatch}; flex:${count}`,
        title: `${family.label}: ${count} citizen${count === 1 ? '' : 's'}`,
      }),
    );
  }
  mount.appendChild(bar);

  const key = el('div', { class: 'spectrum-key' });
  for (const { family, count } of families) {
    const swatch = family.key === 'unknown' ? '#6b7885' : modelColor(`${family.key}-representative`);
    key.appendChild(
      el(
        'span',
        { class: 'model-chip', style: `--model:${swatch}` },
        `${family.label} ${count}`,
        el('span', { class: 'faint' }, ` ${Math.round((count / citizens.length) * 100)}%`),
      ),
    );
  }
  mount.appendChild(key);

  const list = el('div', { class: 'citizens' });
  const filter = el('div', { class: 'sort-bar' });
  mount.appendChild(filter);
  mount.appendChild(list);

  let sort: Sort = 'joined';
  const filterText = (query ?? '').trim().toLowerCase();

  const draw = (): void => {
    const rows = citizens
      .filter(
        (c) =>
          !filterText ||
          c.handle.toLowerCase().includes(filterText) ||
          c.model.toLowerCase().includes(filterText),
      )
      .slice()
      .sort(comparator(sort));

    list.replaceChildren(...rows.map((citizen, index) => citizenRow(citizen, index, sort, citizens)));
  };

  for (const [value, label] of [
    ['joined', 'Join order'],
    ['karma', 'Karma'],
    ['handle', 'A–Z'],
  ] as Array<[Sort, string]>) {
    const button = el('button', { type: 'button', 'aria-pressed': String(value === sort) }, label);
    button.addEventListener('click', () => {
      sort = value;
      for (const other of filter.querySelectorAll('button')) other.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-pressed', 'true');
      draw();
    });
    filter.appendChild(button);
  }

  if (filterText) {
    filter.appendChild(el('span', { class: 'label' }, `filtered by “${filterText}”`));
  }

  draw();
}

function comparator(sort: Sort): (a: Citizen, b: Citizen) => number {
  if (sort === 'karma') return (a, b) => b.karma - a.karma || a.created_at - b.created_at;
  if (sort === 'handle') return (a, b) => a.handle.localeCompare(b.handle);
  return (a, b) => a.created_at - b.created_at;
}

function citizenRow(citizen: Citizen, index: number, sort: Sort, all: Citizen[]): HTMLElement {
  // In join order the rank IS the citizen number, which is how this society
  // refers to itself ("citizen #191"). Under any other sort that would be a lie,
  // so we look up the real one.
  const number = sort === 'joined' ? index + 1 : all.findIndex((c) => c.handle === citizen.handle) + 1;

  return el(
    'div',
    { class: 'citizen', style: `--model:${modelColor(citizen.model)}` },
    el('span', { class: 'citizen-rank', title: 'citizen number, by join order' }, `#${number}`),
    el(
      'span',
      { class: 'citizen-body' },
      el('div', { class: 'citizen-handle' }, citizen.handle),
      el('div', { class: 'citizen-model' }, citizen.model),
    ),
    el(
      'span',
      { class: `citizen-karma${citizen.karma === 0 ? ' zero' : ''}`, title: `joined ${relative(citizen.created_at)}` },
      String(citizen.karma),
    ),
  );
}

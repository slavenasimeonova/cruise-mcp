import type { CruiseStore } from '../../../src/data/store.js';
import { issueBadges, meter, stat } from '../components.js';
import { count, departsIn, longDate, pct, shortDate } from '../format.js';
import { html } from '../html.js';
import { overviewRows, type OverviewSort } from '../model.js';
import type { View } from './view.js';

let sort: OverviewSort = 'urgency';
let shipFilter = '';

export function overviewView(store: CruiseStore): View {
  const all = overviewRows(store, sort);
  const rows = shipFilter ? all.filter((r) => r.sailing.shipCode === shipFilter) : all;
  const soon = all.filter((r) => r.sailing.daysToDeparture <= 14);

  const body = html`
    <section class="page-head">
      <div>
        <p class="eyebrow">Fleet overview</p>
        <h1>Upcoming sailings</h1>
        <p class="lede">${count(all.length, 'sailing')} across ${store.ships.length} ships. Data as of ${longDate(store.asOf)}.</p>
      </div>
    </section>

    <section class="stats" aria-label="Next 14 days">
      ${stat('Departing in 14 days', soon.length, `${count(soon.reduce((n, r) => n + r.sailing.guestsBooked, 0), 'guest')} sailing`)}
      ${stat('High-severity issues', soon.reduce((n, r) => n + r.issues.high, 0), 'on those departures')}
      ${stat('Overbooked excursions', all.reduce((n, r) => n + r.overbookedExcursions, 0), 'fleet-wide')}
      ${stat('Open issues', all.reduce((n, r) => n + r.issues.total, 0), 'all sailings')}
    </section>

    <section class="toolbar" aria-label="Sort and filter">
      <div class="segmented" role="group" aria-label="Sort">
        <button type="button" data-sort="urgency" aria-pressed="${sort === 'urgency'}">By urgency</button>
        <button type="button" data-sort="departure" aria-pressed="${sort === 'departure'}">By departure</button>
      </div>
      <label class="select">
        <span class="visually-hidden">Ship</span>
        <select id="ship-filter">
          <option value="">All ships</option>
          ${store.ships.map((s) => html`<option value="${s.id}" ${shipFilter === s.id ? html`selected` : ''}>${s.name}</option>`)}
        </select>
      </label>
    </section>
    <p class="hint">${sort === 'urgency'
      ? 'Urgency weighs high-severity issues most, and counts issues on departures within 14 days fully, within 30 days half.'
      : 'Sorted by departure date.'}</p>

    <ol class="sailing-list">
      ${rows.map(
        ({ sailing: s, issues }) => html`<li>
          <a class="sailing-card ${issues.high > 0 && s.daysToDeparture <= 14 ? 'is-urgent' : ''}" href="#/sailing/${s.sailingId}">
            <div class="sailing-card-main">
              <p class="sailing-title"><strong>${s.ship}</strong> · ${departsIn(s.daysToDeparture)} · ${count(issues.total, 'issue')}</p>
              <p class="sailing-sub">${s.name}</p>
              <p class="sailing-meta">
                <span>${shortDate(s.departureDate)} – ${shortDate(s.returnDate)}</span>
                <span class="chip">${s.region}</span>
                <span class="mono">${s.sailingId}</span>
              </p>
            </div>
            <div class="sailing-card-side">
              ${issueBadges(issues)}
              <div class="occupancy">
                <span>${pct(s.occupancyPct)} full</span>
                ${meter(s.guestsBooked, s.guestCapacity, `Occupancy ${pct(s.occupancyPct)}`)}
              </div>
            </div>
          </a>
        </li>`,
      )}
    </ol>`;

  return {
    title: 'Fleet overview',
    nav: 'overview',
    body,
    mount(root, rerender) {
      root.querySelectorAll<HTMLButtonElement>('[data-sort]').forEach((btn) =>
        btn.addEventListener('click', () => {
          sort = btn.dataset.sort as OverviewSort;
          rerender();
        }),
      );
      root.querySelector<HTMLSelectElement>('#ship-filter')?.addEventListener('change', (e) => {
        shipFilter = (e.target as HTMLSelectElement).value;
        rerender();
      });
    },
  };
}

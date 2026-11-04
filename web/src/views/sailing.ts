import type { CruiseStore } from '../../../src/data/store.js';
import { emptyState, issueBadges, meter, severityPill, stat } from '../components.js';
import { count, departsIn, humanize, longDate, money, pct, shortDate } from '../format.js';
import { html } from '../html.js';
import { groupIssues, SEVERITIES, sailingDetail, type Severity } from '../model.js';
import type { View } from './view.js';

const severityFilter = new Set<Severity>(SEVERITIES);
let requestFilter = '';

export function sailingView(store: CruiseStore, sailingId: string): View {
  const detail = sailingDetail(store, sailingId);
  const sailing = store.sailing(sailingId);
  if (!detail || !sailing) {
    return {
      title: 'Sailing not found',
      nav: null,
      body: emptyState('Sailing not found', html`No sailing with ID <code>${sailingId}</code>. <a href="#/">Back to the overview</a>.`),
    };
  }
  const { summary: s, issues, ports } = detail;
  const ref = s.sailing;
  const groups = groupIssues(issues.issues, [...severityFilter]);
  const g = s.guests;
  const requests = requestFilter ? s.specialRequests.items.filter((r) => r.type === requestFilter) : s.specialRequests.items;

  const body = html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Overview</a> <span aria-hidden="true">/</span> <span class="mono">${ref.sailingId}</span></nav>
    <section class="page-head">
      <div>
        <p class="eyebrow">${ref.ship} · ${ref.region}</p>
        <h1>${ref.name}</h1>
        <p class="lede">${longDate(ref.departureDate)} – ${longDate(ref.returnDate)} · <strong>${departsIn(ref.daysToDeparture)}</strong></p>
      </div>
      ${issueBadges(issues.totals)}
    </section>

    <ol class="itinerary" aria-label="Itinerary">
      ${sailing.itinerary.map(
        (d) => html`<li class="itin-${d.kind}">
          <span class="itin-day">Day ${d.day} · ${shortDate(d.date)}</span>
          <span class="itin-port">${d.port ?? 'At sea'}${d.tender ? html` <abbr title="Tender port: guests go ashore by boat">tender</abbr>` : ''}</span>
        </li>`,
      )}
    </ol>

    <section class="stats" aria-label="Key figures">
      ${stat('Guests sailing', g.sailing, `${g.byBookingStatus.confirmed} confirmed · ${g.byBookingStatus.pending_payment} pending payment`)}
      ${stat('Occupancy', pct(g.occupancyPct), `${g.guestCapacity} lower berths`)}
      ${stat('Special requests', s.specialRequests.total, `${s.specialRequests.byType.dietary} dietary · ${s.specialRequests.byType.mobility} mobility`)}
      ${stat('Open issues', issues.totals.issues, `${issues.totals.high} high severity`)}
    </section>

    <div class="grid-2">
      <section class="card">
        <h2>Bookings</h2>
        <table class="kv">
          <tbody>
            ${(['confirmed', 'pending_payment', 'cancelled', 'waitlisted'] as const).map(
              (st) => html`<tr><th scope="row">${humanize(st)}</th><td>${count(s.bookings.byStatus[st], 'booking')}</td><td>${count(g.byBookingStatus[st], 'guest')}</td></tr>`,
            )}
          </tbody>
        </table>
        <p class="muted small">${g.adults} adults, ${g.children} children sailing. Payments: ${s.payments.pendingBookings} pending
          (${s.payments.overdueBookings} overdue), ${money(s.payments.outstandingOnPending, s.payments.currency)} outstanding.</p>
      </section>

      <section class="card">
        <h2>Loyalty tiers</h2>
        <ul class="bars">
          ${(['Platinum', 'Gold', 'Silver', 'Blue'] as const).map(
            (t) => html`<li><span class="bar-label">${t}</span>${meter(s.loyaltyTiers[t], g.sailing, `${t} guests`)}<span class="bar-value">${s.loyaltyTiers[t]}</span></li>`,
          )}
        </ul>
        <h3>Cabins</h3>
        <ul class="bars">
          ${s.cabins.map(
            (c) => html`<li><span class="bar-label">${c.category}</span>${meter(c.booked, c.total, `${c.category} cabins booked`)}<span class="bar-value">${c.booked}/${c.total}</span></li>`,
          )}
        </ul>
        <p class="muted small">Top nationalities: ${s.nationalities.map((n) => `${n.country} ${n.guests}`).join(' · ')}</p>
      </section>
    </div>

    <section class="card">
      <div class="card-head">
        <h2>Issues</h2>
        <div class="filters" role="group" aria-label="Filter by severity">
          ${SEVERITIES.map(
            (sev) => html`<button type="button" class="filter pill-${sev}" data-severity="${sev}" aria-pressed="${severityFilter.has(sev)}">
              ${humanize(sev)} <span class="filter-count">${issues.totals[sev]}</span></button>`,
          )}
        </div>
      </div>
      ${groups.length === 0
        ? html`<p class="muted">No issues match the selected severities.</p>`
        : groups.map(
            (grp) => html`<details class="issue-group" ${grp.counts.high > 0 ? html`open` : ''}>
              <summary><span class="issue-group-title">${grp.label}</span> ${issueBadges(grp.counts)}</summary>
              <ul class="issue-list">
                ${grp.items.map((i) =>
                  i.bookingId
                    ? html`<li>
                        <a class="issue-row" href="#/booking/${i.bookingId}" aria-label="${i.severity} severity: ${i.message} Open booking ${i.bookingId}">
                          ${severityPill(i.severity)}
                          <span class="issue-msg">${i.message}</span>
                          <span class="issue-booking mono small">${i.bookingId} →</span>
                        </a>
                      </li>`
                    : html`<li class="issue-row issue-multi">
                        ${severityPill(i.severity)}
                        <span class="issue-msg">${i.message}
                          <details class="affected">
                            <summary>Affects ${count(i.affectedBookings?.length ?? 0, 'booking')}</summary>
                            <ul class="affected-list">
                              ${(i.affectedBookings ?? []).map(
                                (b) => html`<li><a class="mono" href="#/booking/${b.bookingId}">${b.bookingId}</a>
                                  <span class="muted small">${count(b.guests, 'guest')} confirmed</span></li>`,
                              )}
                            </ul>
                          </details>
                        </span>
                      </li>`,
                )}
              </ul>
            </details>`,
          )}
    </section>

    <section class="card">
      <h2>Shore excursions</h2>
      <p class="muted small">Bars show confirmed guests against capacity; red means more confirmed guests than seats.
        ${count(detail.unconfirmedRequests, 'request')} still unconfirmed (requested or waitlisted).</p>
      ${ports.map(
        (p) => html`<div class="port">
          <h3>${p.port} <span class="muted small">Day ${p.portDay.day} · ${shortDate(p.portDay.date)} · ${p.portDay.arrival}–${p.portDay.departure}${p.portDay.tender ? ' · tender' : ''}</span></h3>
          <ul class="excursions">
            ${p.excursions.map(
              (e) => html`<li class="excursion is-${e.availability}">
                <div class="excursion-head">
                  <span class="excursion-name">${e.name}</span>
                  <span class="status status-${e.availability}">${humanize(e.availability)}</span>
                </div>
                ${meter(e.confirmedGuests, e.capacity, `${e.name}: ${e.confirmedGuests} confirmed of ${e.capacity}`)}
                <p class="excursion-meta">
                  <span><strong>${e.confirmedGuests}</strong> / ${e.capacity} confirmed</span>
                  ${e.overbookedBy > 0 ? html`<span class="over">+${e.overbookedBy} over capacity</span>` : html`<span>${e.seatsAvailable} left</span>`}
                  ${e.waitlistedGuests > 0 ? html`<span>${e.waitlistedGuests} waitlisted</span>` : ''}
                  ${e.requestedGuests > 0 ? html`<span>${e.requestedGuests} awaiting operator</span>` : ''}
                  <span>${money(e.pricePerGuest, e.currency)} · ${e.durationHours}h · ${e.activityLevel}${e.wheelchairAccessible ? ' · ♿ accessible' : ''}</span>
                </p>
                ${e.capacityNote ? html`<p class="note">${e.capacityNote}</p>` : ''}
              </li>`,
            )}
          </ul>
        </div>`,
      )}
    </section>

    <section class="card">
      <div class="card-head">
        <h2>Special requests</h2>
        <label class="select">
          <span class="visually-hidden">Request type</span>
          <select id="request-filter">
            <option value="">All types (${s.specialRequests.total})</option>
            ${(['dietary', 'mobility', 'medical', 'celebration'] as const).map(
              (t) => html`<option value="${t}" ${requestFilter === t ? html`selected` : ''}>${humanize(t)} (${s.specialRequests.byType[t]})</option>`,
            )}
          </select>
        </label>
      </div>
      <div class="table-wrap">
        <table class="table">
          <thead><tr><th>Guest</th><th>Cabin</th><th>Type</th><th>Request</th></tr></thead>
          <tbody>
            ${requests.map(
              (r) => html`<tr>
                <td data-label="Guest"><a href="#/booking/${r.bookingId}">${r.name}</a></td>
                <td data-label="Cabin" class="mono">${r.cabinNumber ?? '—'}</td>
                <td data-label="Type"><span class="chip chip-${r.type}">${humanize(r.type)}</span></td>
                <td data-label="Request">${r.detail}</td>
              </tr>`,
            )}
          </tbody>
        </table>
      </div>
    </section>`;

  return {
    title: `${ref.ship} · ${shortDate(ref.departureDate)}`,
    nav: 'overview',
    body,
    mount(root, rerender) {
      root.querySelectorAll<HTMLButtonElement>('[data-severity]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const sev = btn.dataset.severity as Severity;
          if (severityFilter.has(sev)) severityFilter.delete(sev);
          else severityFilter.add(sev);
          rerender();
        }),
      );
      root.querySelector<HTMLSelectElement>('#request-filter')?.addEventListener('change', (e) => {
        requestFilter = (e.target as HTMLSelectElement).value;
        rerender();
      });
    },
  };
}

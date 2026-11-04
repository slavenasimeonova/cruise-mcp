import type { CruiseStore } from '../../../src/data/store.js';
import { emptyState, severityPill } from '../components.js';
import { departsIn, humanize, longDate, money, shortDate } from '../format.js';
import { html, type SafeHtml } from '../html.js';
import { ISSUE_LABELS, lookupBooking, normalizeBookingId } from '../model.js';
import type { View } from './view.js';

const EXAMPLES = ['BK-100054', 'BK-100226'];

const DOCUMENT_RULES = {
  eu_schengen: 'EU citizen, all-Schengen itinerary: passport or national ID card valid through return',
  passport_6_months: 'Passport valid 6 months after return',
} as const;

/** One document on file; `counts` marks the document the verdict is based on. */
function documentLine(label: string, numberMasked: string | null, expiryDate: string | null, counts: boolean): SafeHtml {
  return html`<div class="doc-line ${counts ? 'doc-counts' : ''}">
    <span class="small">${label}:</span>
    ${numberMasked
      ? html`<span class="mono small">${numberMasked}</span>
          <span class="muted small">exp. ${shortDate(expiryDate!)} ${expiryDate!.slice(0, 4)}</span>`
      : html`<span class="muted small">not on file</span>`}
  </div>`;
}

export function bookingView(store: CruiseStore, query: string): View {
  const result = query ? lookupBooking(store, query) : null;

  const form = html`
    <form class="lookup" id="lookup" role="search">
      <label for="booking-id">Booking reference</label>
      <div class="lookup-row">
        <input id="booking-id" name="id" inputmode="text" autocomplete="off" spellcheck="false"
          placeholder="BK-100054" value="${query}" aria-describedby="lookup-help" />
        <button type="submit">Look up</button>
      </div>
      <p id="lookup-help" class="muted small">Try ${EXAMPLES.map((id, i) => html`${i > 0 ? ' or ' : ''}<a href="#/booking/${id}" class="mono">${id}</a>`)}.
        Passport and ID card numbers are masked and never leave the build in full.</p>
    </form>`;

  let content = html``;
  if (result && !result.ok) {
    content = emptyState('No booking found', result.error);
  } else if (result && result.ok) {
    const { booking: b, issues } = result;
    const lead = b.guests.find((g) => g.isLead);
    content = html`
      <section class="page-head">
        <div>
          <p class="eyebrow mono">${b.booking.bookingId}</p>
          <h1>${lead?.name ?? b.booking.bookingId}${b.guests.length > 1 ? ` + ${b.guests.length - 1}` : ''}</h1>
          <p class="lede">
            <span class="status status-${b.booking.status}">${humanize(b.booking.status)}</span>
            ${b.booking.cabinNumber ? `${b.booking.cabinCategory} cabin ${b.booking.cabinNumber}` : `${b.booking.cabinCategory} (no cabin held)`}
          </p>
        </div>
      </section>

      <section class="card ${issues.some((i) => i.severity === 'high') ? 'card-alert' : ''}">
        <h2>Needs attention <span class="muted">(${issues.length})</span></h2>
        ${issues.length === 0
          ? html`<p class="ok">Nothing outstanding for this booking.</p>`
          : html`<ul class="issue-list">
              ${issues.map(
                (i) => html`<li>${severityPill(i.severity)}<span class="issue-msg"><span class="issue-type">${ISSUE_LABELS[i.type]}</span>${i.message}</span></li>`,
              )}
            </ul>`}
      </section>

      <div class="grid-2">
        <section class="card">
          <h2>Sailing</h2>
          <p><a href="#/sailing/${b.sailing.sailingId}"><strong>${b.sailing.ship}</strong> · ${b.sailing.name}</a></p>
          <p class="muted">${longDate(b.sailing.departureDate)} – ${longDate(b.sailing.returnDate)} · ${departsIn(b.sailing.daysToDeparture)}</p>
          <p class="muted small">Booked ${longDate(b.booking.bookedOn)} via ${humanize(b.booking.channel)}
            ${b.booking.cancelledOn ? ` · cancelled ${longDate(b.booking.cancelledOn)} (${b.booking.cancellationReason})` : ''}</p>
        </section>
        <section class="card">
          <h2>Payment</h2>
          <table class="kv"><tbody>
            <tr><th scope="row">Total fare</th><td>${money(b.payment.totalFare, b.payment.currency)}</td></tr>
            <tr><th scope="row">Paid</th><td>${money(b.payment.amountPaid, b.payment.currency)}</td></tr>
            <tr><th scope="row">Balance</th><td class="${b.payment.overdue ? 'over' : ''}">${money(b.payment.balanceDue, b.payment.currency)}
              ${b.payment.balanceDue > 0 ? html`<span class="muted small"> due ${shortDate(b.payment.paymentDueDate)}${b.payment.overdue ? ' (overdue)' : ''}</span>` : ''}</td></tr>
          </tbody></table>
        </section>
      </div>

      <section class="card">
        <h2>Guests</h2>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Name</th><th>Age</th><th>Loyalty</th><th>Travel document</th><th>Special requests</th></tr></thead>
            <tbody>
              ${b.guests.map(
                (g) => html`<tr>
                  <td data-label="Name">${g.name}${g.isLead ? html` <span class="chip">Lead</span>` : ''}</td>
                  <td data-label="Age">${g.age}</td>
                  <td data-label="Loyalty"><span class="tier tier-${g.loyaltyTier.toLowerCase()}">${g.loyaltyTier}</span></td>
                  <td data-label="Document">
                    <span class="status status-passport-${g.travelDocument.status}">${humanize(g.travelDocument.status)}</span>
                    <div class="muted small">${DOCUMENT_RULES[g.travelDocument.rule]}</div>
                    ${documentLine('Passport', g.passport.numberMasked, g.passport.expiryDate, g.travelDocument.document === 'passport')}
                    ${g.idCard ? documentLine(`ID card (${g.idCard.issuingCountry})`, g.idCard.numberMasked, g.idCard.expiryDate, g.travelDocument.document === 'id_card') : ''}
                  </td>
                  <td data-label="Requests">${g.specialRequests.length === 0 ? html`<span class="muted">—</span>` : g.specialRequests.map((r) => html`<div><span class="chip chip-${r.type}">${humanize(r.type)}</span> ${r.detail}</div>`)}</td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section class="card">
        <h2>Shore excursions</h2>
        ${b.excursions.length === 0
          ? html`<p class="muted">No excursions booked.</p>`
          : html`<div class="table-wrap"><table class="table">
              <thead><tr><th>Date</th><th>Excursion</th><th>Status</th><th>Guests</th><th>Total</th></tr></thead>
              <tbody>
                ${b.excursions.map(
                  (e) => html`<tr>
                    <td data-label="Date">${shortDate(e.date)}</td>
                    <td data-label="Excursion">${e.name}<div class="muted small">${e.port}</div></td>
                    <td data-label="Status"><span class="status status-${e.status}">${humanize(e.status)}${e.waitlistPosition ? ` #${e.waitlistPosition}` : ''}</span></td>
                    <td data-label="Guests">${e.guests.join(', ')}</td>
                    <td data-label="Total">${money(e.total, b.payment.currency)}</td>
                  </tr>`,
                )}
              </tbody>
            </table></div>`}
      </section>`;
  }

  return {
    title: result?.ok ? `Booking ${result.booking.booking.bookingId}` : 'Booking lookup',
    nav: 'booking',
    body: html`${query ? '' : html`<section class="page-head"><div><p class="eyebrow">Guest services</p><h1>Booking lookup</h1>
      <p class="lede">Every open item for a booking in one place: documents, payments and excursions.</p></div></section>`}
      ${form}${content}`,
    mount(root) {
      const form = root.querySelector<HTMLFormElement>('#lookup');
      form?.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = (form.elements.namedItem('id') as HTMLInputElement).value;
        const id = normalizeBookingId(value) ?? value.trim();
        location.hash = `#/booking/${encodeURIComponent(id)}`;
      });
      if (!query) root.querySelector<HTMLInputElement>('#booking-id')?.focus();
    },
  };
}

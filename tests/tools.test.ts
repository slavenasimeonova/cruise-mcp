// Pure query tests: each tool's run() against the seeded dataset, without MCP in the way.
import { describe, expect, it } from 'vitest';
import type { Passenger, Sailing } from '../src/data/types.js';
import { addMonths } from '../src/lib/dates.js';
import {
  documentRule,
  excursionLoad,
  isActive,
  overbookedExcursionMessage,
  travelDocumentCheck,
  travelDocumentMessage,
} from '../src/lib/domain.js';
import { ToolInputError } from '../src/lib/errors.js';
import { excursionAvailability } from '../src/tools/excursionAvailability.js';
import { findIssues } from '../src/tools/findIssues.js';
import { findUnconfirmedExcursions } from '../src/tools/findUnconfirmedExcursions.js';
import { getBooking } from '../src/tools/getBooking.js';
import { listSailings } from '../src/tools/listSailings.js';
import { passengerSummary } from '../src/tools/passengerSummary.js';
import { NEXT_SAILING, store } from './helpers.js';

/** Every guest on a booking that will sail, across the fleet. */
const activePassengers = (): Passenger[] =>
  store.sailings.flatMap((s) => store.bookingsForSailing(s.id).filter(isActive)).flatMap((b) => store.passengersFor(b.passengerIds));
const sailingOf = (p: Passenger): Sailing => store.sailing(store.booking(p.bookingId)!.sailingId)!;

describe('list_sailings', () => {
  it('lists all 24 sailings in departure order', () => {
    const out = listSailings.run(store, {});
    expect(out.count).toBe(24);
    const dates = out.sailings.map((s) => s.departureDate);
    expect(dates).toEqual([...dates].sort());
    expect(out.sailings[0]!.daysToDeparture).toBe(3);
  });

  it('filters by ship name or code, ignoring case', () => {
    const byName = listSailings.run(store, { ship: 'coral vista' });
    const byCode = listSailings.run(store, { ship: 'CV' });
    expect(byName.count).toBe(6);
    expect(byName.sailings.every((s) => s.ship === 'Coral Vista')).toBe(true);
    expect(byCode.sailings.map((s) => s.sailingId)).toEqual(byName.sailings.map((s) => s.sailingId));
  });

  it('filters by from_date, combined with ship', () => {
    const out = listSailings.run(store, { ship: 'Solenne', from_date: '2027-01-01' });
    expect(out.sailings.length).toBeGreaterThan(0);
    expect(out.sailings.every((s) => s.departureDate >= '2027-01-01' && s.ship === 'Solenne')).toBe(true);
  });

  it('limits to departures within N days of the as-of date', () => {
    const out = listSailings.run(store, { within_days: 14 });
    expect(out.sailings.map((s) => s.sailingId)).toEqual(['AH-NP-261104', 'AH-CV-261107', 'AH-SO-261110', 'AH-SL-261114']);
    expect(out.sailings.every((s) => s.daysToDeparture >= 0 && s.daysToDeparture <= 14)).toBe(true);
    expect(out.filters).toEqual({ ship: null, fromDate: null, withinDays: 14, toDate: '2026-11-15' });
    expect(out.summary).toBe('4 sailing(s) across the fleet departing within 14 days of 2026-11-01 (by 2026-11-15); next departure AH-NP-261104 on 2026-11-04.');
  });

  it('treats within_days as inclusive and combines it with the other filters', () => {
    // AH-SL-261114 departs exactly 13 days out; 12 must exclude it, 13 must include it.
    expect(listSailings.run(store, { within_days: 12 }).sailings.map((s) => s.sailingId)).not.toContain('AH-SL-261114');
    expect(listSailings.run(store, { within_days: 13 }).sailings.map((s) => s.sailingId)).toContain('AH-SL-261114');
    expect(listSailings.run(store, { within_days: 0 }).count).toBe(0);
    expect(listSailings.run(store, { ship: 'Sea Lyra', within_days: 14 }).sailings.map((s) => s.sailingId)).toEqual(['AH-SL-261114']);
    expect(listSailings.run(store, { from_date: '2026-11-08', within_days: 14 }).sailings.map((s) => s.sailingId)).toEqual([
      'AH-SO-261110',
      'AH-SL-261114',
    ]);
    expect(listSailings.run(store, { within_days: 366 }).count).toBe(24);
  });

  it('returns an empty list (not an error) past the end of the schedule', () => {
    const out = listSailings.run(store, { from_date: '2030-01-01' });
    expect(out.count).toBe(0);
    expect(out.summary).toMatch(/No sailings/);
  });

  it('rejects unknown ships and impossible dates with helpful messages', () => {
    expect(() => listSailings.run(store, { ship: 'Titanic' })).toThrow(/Unknown ship "Titanic".*Coral Vista \(CV\)/);
    expect(() => listSailings.run(store, { from_date: '2027-02-30' })).toThrow(ToolInputError);
  });
});

describe('get_booking', () => {
  it('returns guests, payment and excursions for a booking', () => {
    const booking = store.bookingsForSailing(NEXT_SAILING.id).find((b) => store.excursionBookingsForBooking(b.id).length > 0)!;
    const out = getBooking.run(store, { booking_id: booking.id });
    expect(out.booking.bookingId).toBe(booking.id);
    expect(out.sailing.sailingId).toBe(NEXT_SAILING.id);
    expect(out.guests).toHaveLength(booking.passengerIds.length);
    expect(out.guests.filter((g) => g.isLead)).toHaveLength(1);
    expect(out.excursions.length).toBe(store.excursionBookingsForBooking(booking.id).length);
    expect(out.payment.balanceDue).toBe(booking.totalFare - booking.amountPaid);
  });

  it('masks passport and ID card numbers', () => {
    const withIdCard = activePassengers().find((p) => p.idCard && p.passport.status === 'on_file')!;
    for (const id of ['BK-100001', withIdCard.bookingId]) {
      for (const g of getBooking.run(store, { booking_id: id }).guests) {
        if (g.passport.numberMasked !== null) expect(g.passport.numberMasked).toMatch(/^\*+[A-Z0-9]{3}$/);
        if (g.idCard) expect(g.idCard.numberMasked).toMatch(/^\*+[0-9]{3}$/);
      }
    }
    const guest = getBooking.run(store, { booking_id: withIdCard.bookingId }).guests.find((g) => g.passengerId === withIdCard.id)!;
    expect(guest.idCard!.numberMasked).not.toBe(withIdCard.idCard!.number);
  });

  it('flags missing and expiring travel documents with the same text as find_issues', () => {
    const problems = activePassengers().filter((p) => travelDocumentCheck(p, sailingOf(p)).status !== 'valid');
    // Both rules and both outcomes occur in the data.
    for (const rule of ['eu_schengen', 'passport_6_months'] as const) {
      for (const status of ['missing', 'expires_too_soon'] as const) {
        expect(problems.some((p) => travelDocumentCheck(p, sailingOf(p)).rule === rule && travelDocumentCheck(p, sailingOf(p)).status === status)).toBe(true);
      }
    }
    for (const p of problems.slice(0, 40)) {
      const message = travelDocumentMessage(p, sailingOf(p), p.bookingId, travelDocumentCheck(p, sailingOf(p)))!;
      expect(getBooking.run(store, { booking_id: p.bookingId }).flags).toContain(message);
      const issues = findIssues.run(store, { sailing_id: sailingOf(p).id }).issues;
      expect(issues.find((i) => i.passengerId === p.id && i.message === message)).toBeDefined();
    }
  });

  it('reports which rule and document decide each guest', () => {
    const idOnly = activePassengers().find((p) => p.idCard && p.passport.status === 'missing' && travelDocumentCheck(p, sailingOf(p)).status === 'valid')!;
    const guest = getBooking.run(store, { booking_id: idOnly.bookingId }).guests.find((g) => g.passengerId === idOnly.id)!;
    expect(guest.travelDocument).toEqual({ status: 'valid', rule: 'eu_schengen', document: 'id_card', expiryDate: idOnly.idCard!.expiryDate });
    expect(guest.passport.onFile).toBe(false);
    expect(getBooking.run(store, { booking_id: idOnly.bookingId }).sailing.allSchengen).toBe(true);
  });

  it('flags overdue payments', () => {
    const b = store.bookingsForSailing(NEXT_SAILING.id).find((x) => x.status === 'pending_payment')!;
    const out = getBooking.run(store, { booking_id: b.id });
    expect(out.payment.overdue).toBe(true);
    expect(out.flags.some((f) => f.includes('overdue'))).toBe(true);
  });

  it('flags exactly the accessibility and overbooking issues find_issues reports, word for word', () => {
    const shared = store.sailings
      .flatMap((s) => findIssues.run(store, { sailing_id: s.id }).issues)
      .filter((i) => i.type === 'accessibility_conflict' || i.type === 'overbooked_excursion');
    expect(shared.some((i) => i.type === 'accessibility_conflict')).toBe(true);
    expect(shared.some((i) => i.type === 'overbooked_excursion')).toBe(true);
    for (const issue of shared) {
      if (issue.type === 'accessibility_conflict') {
        expect(getBooking.run(store, { booking_id: issue.bookingId! }).flags).toContain(issue.message);
        continue;
      }
      // One sailing-level issue; each affected booking flags its own share with the shared wording.
      const ex = store.excursion(issue.excursionId!)!;
      for (const { bookingId, guests } of issue.affectedBookings!) {
        expect(getBooking.run(store, { booking_id: bookingId }).flags).toContain(
          overbookedExcursionMessage(ex, excursionLoad(store, ex), bookingId, guests),
        );
      }
    }
  });

  it("describes the guest's own mobility aid", () => {
    const out = getBooking.run(store, { booking_id: 'BK-100054' });
    const conflicts = out.flags.filter((f) => f.includes('Mobility request'));
    expect(conflicts).toHaveLength(2);
    for (const f of conflicts) expect(f).toMatch(/^Jasmine Castellano is confirmed on .*Mobility request: "Travels with own mobility scooter"\.$/);
    expect(out.flags.some((f) => f.includes('(wheelchair)'))).toBe(false);
  });

  it('flags a booking confirmed on an overbooked excursion', () => {
    const out = getBooking.run(store, { booking_id: 'BK-100054' });
    expect(out.flags).toContainEqual(expect.stringMatching(/^2 guest\(s\) on BK-100054 are confirmed on Aix-en-Provence Half Day .*overbooked: 40 confirmed for 32 seats/));
  });

  it('shows cancelled bookings without a cabin', () => {
    const b = store.bookingsForSailing(NEXT_SAILING.id).find((x) => x.status === 'cancelled')!;
    const out = getBooking.run(store, { booking_id: b.id });
    expect(out.booking.status).toBe('cancelled');
    expect(out.booking.cabinNumber).toBeNull();
    expect(out.booking.cancellationReason).toBeTruthy();
  });

  it('reports unknown bookings', () => {
    expect(() => getBooking.run(store, { booking_id: 'BK-999999' })).toThrow(/BK-999999" was not found/);
  });
});

describe('find_unconfirmed_excursions', () => {
  it('lists requested and waitlisted requests, urgent for the next sailing', () => {
    const out = findUnconfirmedExcursions.run(store, { sailing_id: NEXT_SAILING.id });
    expect(out.items.length).toBeGreaterThan(0);
    expect(out.items.every((i) => i.status === 'requested' || i.status === 'waitlisted')).toBe(true);
    expect(out.totals.requested + out.totals.waitlisted).toBe(out.totals.requests);
    expect(out.items.every((i) => i.urgency === 'urgent')).toBe(true);
    const dates = out.items.map((i) => i.date);
    expect(dates).toEqual([...dates].sort());
  });

  it('filters by port, accepting aliases and accents', () => {
    const caribbean = store.sailings.find((s) => s.shipId === 'CV')!;
    const out = findUnconfirmedExcursions.run(store, { sailing_id: caribbean.id, port: 'grand cayman' });
    expect(out.port).toBe('George Town (Grand Cayman)');
    expect(out.items.every((i) => i.port === 'George Town (Grand Cayman)')).toBe(true);
    expect(findUnconfirmedExcursions.run(store, { sailing_id: caribbean.id, port: 'roatan' }).port).toBe('Roatán');
  });

  it('rejects ports that are not on the itinerary, and the embarkation port', () => {
    expect(() => findUnconfirmedExcursions.run(store, { sailing_id: NEXT_SAILING.id, port: 'Cozumel' })).toThrow(
      /not a port of call on sailing .*Marseille/,
    );
    expect(() => findUnconfirmedExcursions.run(store, { sailing_id: NEXT_SAILING.id, port: 'Barcelona' })).toThrow(
      /embarkation and disembarkation port/,
    );
  });

  it('rejects unknown sailings', () => {
    expect(() => findUnconfirmedExcursions.run(store, { sailing_id: 'AH-XX-990101' })).toThrow(/list_sailings/);
  });
});

describe('excursion_availability', () => {
  it('reports capacity and guest counts per excursion', () => {
    const out = excursionAvailability.run(store, { sailing_id: NEXT_SAILING.id, port: 'Naples' });
    expect(out.port).toBe('Naples');
    expect(out.excursions).toHaveLength(3);
    for (const e of out.excursions) {
      expect(e.seatsAvailable).toBe(Math.max(0, e.capacity - e.confirmedGuests));
      expect(e.overbookedBy).toBe(Math.max(0, e.confirmedGuests - e.capacity));
    }
  });

  it('marks an excursion overbooked after an operator capacity cut', () => {
    const cut = store.excursionsForSailing(NEXT_SAILING.id).find((e) => e.capacity < e.originalCapacity)!;
    const out = excursionAvailability.run(store, { sailing_id: NEXT_SAILING.id, port: cut.port });
    const row = out.excursions.find((e) => e.excursionId === cut.id)!;
    expect(row.availability).toBe('overbooked');
    expect(row.capacityNote).toMatch(/Operator reduced capacity/);
    expect(out.summary).toMatch(/OVERBOOKED/);
  });

  it('includes the port day and tender information', () => {
    const greek = store.sailings.find((s) => s.shipId === 'SO')!;
    const out = excursionAvailability.run(store, { sailing_id: greek.id, port: 'santorini' });
    expect(out.portDay.tender).toBe(true);
    expect(out.portDay.day).toBe(3);
  });
});

describe('passenger_summary', () => {
  it('totals guests by booking status and occupancy', () => {
    const out = passengerSummary.run(store, { sailing_id: NEXT_SAILING.id });
    const bookings = store.bookingsForSailing(NEXT_SAILING.id);
    expect(out.bookings.total).toBe(bookings.length);
    expect(out.guests.sailing).toBe(out.guests.byBookingStatus.confirmed + out.guests.byBookingStatus.pending_payment);
    expect(out.guests.adults + out.guests.children).toBe(out.guests.sailing);
    const tiers = out.loyaltyTiers;
    expect(tiers.Blue + tiers.Silver + tiers.Gold + tiers.Platinum).toBe(out.guests.sailing);
    expect(out.cabins.reduce((n, c) => n + c.booked, 0)).toBe(bookings.filter(isActive).length);
  });

  it('lists special requests for sailing guests only', () => {
    const out = passengerSummary.run(store, { sailing_id: NEXT_SAILING.id });
    const t = out.specialRequests.byType;
    expect(out.specialRequests.items).toHaveLength(t.dietary + t.mobility + t.celebration + t.medical);
    expect(out.specialRequests.total).toBeGreaterThan(0);
    const activeBookings = new Set(store.bookingsForSailing(NEXT_SAILING.id).filter(isActive).map((b) => b.id));
    expect(out.specialRequests.items.every((i) => activeBookings.has(i.bookingId))).toBe(true);
  });

  it('counts travel documents the same way find_issues does, on every sailing', () => {
    for (const s of store.sailings) {
      const summary = passengerSummary.run(store, { sailing_id: s.id });
      const issues = findIssues.run(store, { sailing_id: s.id });
      expect(summary.documents.travelDocumentsMissing).toBe(issues.totals.byType.missing_travel_document);
      expect(summary.documents.travelDocumentsExpiring).toBe(issues.totals.byType.travel_document_expiry);
      expect(summary.payments.overdueBookings).toBe(issues.totals.byType.overdue_payment);
      // The EU rule only exists on all-Schengen itineraries.
      if (!summary.sailing.allSchengen) expect(summary.documents.euSchengenRuleGuests + summary.documents.travelingOnIdCard).toBe(0);
    }
    const med = passengerSummary.run(store, { sailing_id: NEXT_SAILING.id }).documents;
    expect(med.euSchengenRuleGuests).toBeGreaterThan(0);
    expect(med.travelingOnIdCard).toBeGreaterThan(0);
  });
});

describe('find_issues', () => {
  const out = findIssues.run(store, { sailing_id: NEXT_SAILING.id });

  it('finds the planted problems on the next sailing', () => {
    expect(out.totals.byType.overbooked_excursion).toBeGreaterThanOrEqual(1);
    expect(out.totals.byType.missing_travel_document).toBeGreaterThan(0);
    expect(out.totals.byType.overdue_payment).toBeGreaterThan(0);
    expect(out.totals.byType.unconfirmed_excursion).toBeGreaterThan(0);
  });

  it('sorts by severity and keeps totals consistent', () => {
    const rank = { high: 0, medium: 1, low: 2 };
    const ranks = out.issues.map((i) => rank[i.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(out.totals.high + out.totals.medium + out.totals.low).toBe(out.issues.length);
    expect(Object.values(out.totals.byType).reduce((a, b) => a + b, 0)).toBe(out.issues.length);
  });

  it('reports every missing or expiring travel document on sailing bookings, and nothing else', () => {
    const expected = store
      .bookingsForSailing(NEXT_SAILING.id)
      .filter(isActive)
      .flatMap((b) => store.passengersFor(b.passengerIds))
      .filter((p) => travelDocumentCheck(p, NEXT_SAILING).status !== 'valid')
      .map((p) => p.id)
      .sort();
    const reported = out.issues
      .filter((i) => i.type === 'missing_travel_document' || i.type === 'travel_document_expiry')
      .map((i) => i.passengerId!)
      .sort();
    expect(reported).toEqual(expected);
  });

  it('does not flag EU guests on all-Schengen sailings whose passport is valid through return but not 6 months after', () => {
    const relaxed = activePassengers().filter((p) => {
      const s = sailingOf(p);
      return (
        documentRule(p, s) === 'eu_schengen' &&
        p.passport.status === 'on_file' &&
        p.passport.expiryDate! >= s.returnDate &&
        p.passport.expiryDate! < addMonths(s.returnDate, 6)
      );
    });
    expect(relaxed.length).toBeGreaterThan(0);
    for (const p of relaxed) {
      expect(findIssues.run(store, { sailing_id: sailingOf(p).id }).issues.some((i) => i.passengerId === p.id && i.type.includes('travel_document'))).toBe(false);
    }
  });

  it('ignores cancelled and waitlisted bookings', () => {
    const inactive = new Set(store.bookingsForSailing(NEXT_SAILING.id).filter((b) => !isActive(b)).map((b) => b.id));
    expect(out.issues.some((i) => i.bookingId !== null && inactive.has(i.bookingId))).toBe(false);
  });

  it('counts each overbooked excursion once and lists every booking it affects', () => {
    const overbookedRows = out.issues.filter((i) => i.type === 'overbooked_excursion');
    expect(overbookedRows).toHaveLength(1);
    expect(new Set(overbookedRows.map((i) => i.excursionId)).size).toBe(overbookedRows.length);
    expect(out.totals.byType.overbooked_excursion).toBe(1);
    expect(out.totals.overbookedExcursions).toBe(1);

    const row = overbookedRows[0]!;
    expect(row.bookingId).toBeNull();
    const confirmed = store
      .excursionBookingsForExcursion(row.excursionId!)
      .filter((xb) => xb.status === 'confirmed' && isActive(store.booking(xb.bookingId)!))
      .map((xb) => ({ bookingId: xb.bookingId, guests: xb.passengerIds.length }))
      .sort((a, b) => a.bookingId.localeCompare(b.bookingId));
    expect(row.affectedBookings).toEqual(confirmed);
    expect(out.totals.bookingsOnOverbookedExcursions).toBe(confirmed.length);
    expect(row.message).toContain(`affects ${confirmed.length} booking(s)`);
    expect(out.summary).toContain(`1 overbooked excursion(s) affecting ${confirmed.length} booking(s)`);
  });

  it('ties every other issue to exactly one booking, and totals count rows', () => {
    for (const i of out.issues) {
      if (i.type === 'overbooked_excursion') expect(i.affectedBookings!.length).toBeGreaterThan(0);
      else {
        expect(i.bookingId).toMatch(/^BK-\d{6}$/);
        expect(i.affectedBookings).toBeNull();
      }
    }
    expect(out.totals.issues).toBe(out.issues.length);
    expect(out.summary.startsWith(`${out.issues.length} issue(s)`)).toBe(true);
  });

  it('finds accessibility conflicts somewhere in the fleet', () => {
    const all = store.sailings.flatMap((s) => findIssues.run(store, { sailing_id: s.id }).issues);
    expect(all.some((i) => i.type === 'accessibility_conflict')).toBe(true);
  });
});

// Pure query tests: each tool's run() against the seeded dataset, without MCP in the way.
import { describe, expect, it } from 'vitest';
import { isActive, passportCheck } from '../src/lib/domain.js';
import { ToolInputError } from '../src/lib/errors.js';
import { excursionAvailability } from '../src/tools/excursionAvailability.js';
import { findIssues } from '../src/tools/findIssues.js';
import { findUnconfirmedExcursions } from '../src/tools/findUnconfirmedExcursions.js';
import { getBooking } from '../src/tools/getBooking.js';
import { listSailings } from '../src/tools/listSailings.js';
import { passengerSummary } from '../src/tools/passengerSummary.js';
import { NEXT_SAILING, store } from './helpers.js';

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

  it('masks passport numbers', () => {
    const out = getBooking.run(store, { booking_id: 'BK-100001' });
    for (const g of out.guests) {
      if (g.passport.numberMasked !== null) expect(g.passport.numberMasked).toMatch(/^\*+[A-Z0-9]{3}$/);
    }
  });

  it('flags a missing passport', () => {
    const p = store.sailings
      .flatMap((s) => store.bookingsForSailing(s.id).filter(isActive))
      .flatMap((b) => store.passengersFor(b.passengerIds))
      .find((x) => x.passport.status === 'missing')!;
    const out = getBooking.run(store, { booking_id: p.bookingId });
    expect(out.flags.some((f) => f.includes('Passport details missing') && f.includes(p.lastName))).toBe(true);
  });

  it('flags overdue payments', () => {
    const b = store.bookingsForSailing(NEXT_SAILING.id).find((x) => x.status === 'pending_payment')!;
    const out = getBooking.run(store, { booking_id: b.id });
    expect(out.payment.overdue).toBe(true);
    expect(out.flags.some((f) => f.includes('overdue'))).toBe(true);
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

  it('counts missing passports the same way find_issues does', () => {
    const summary = passengerSummary.run(store, { sailing_id: NEXT_SAILING.id });
    const issues = findIssues.run(store, { sailing_id: NEXT_SAILING.id });
    expect(summary.documents.passportsMissing).toBe(issues.totals.byType.missing_passport);
    expect(summary.documents.passportsExpiringTooSoon).toBe(issues.totals.byType.passport_expiry);
    expect(summary.payments.overdueBookings).toBe(issues.totals.byType.overdue_payment);
  });
});

describe('find_issues', () => {
  const out = findIssues.run(store, { sailing_id: NEXT_SAILING.id });

  it('finds the planted problems on the next sailing', () => {
    expect(out.totals.byType.overbooked_excursion).toBeGreaterThanOrEqual(1);
    expect(out.totals.byType.missing_passport).toBeGreaterThan(0);
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

  it('reports every missing or soon-expiring passport on sailing bookings', () => {
    const expected = store
      .bookingsForSailing(NEXT_SAILING.id)
      .filter(isActive)
      .flatMap((b) => store.passengersFor(b.passengerIds))
      .filter((p) => passportCheck(p, NEXT_SAILING) !== 'valid')
      .map((p) => p.id)
      .sort();
    const reported = out.issues
      .filter((i) => i.type === 'missing_passport' || i.type === 'passport_expiry')
      .map((i) => i.passengerId!)
      .sort();
    expect(reported).toEqual(expected);
  });

  it('ignores cancelled and waitlisted bookings', () => {
    const inactive = new Set(store.bookingsForSailing(NEXT_SAILING.id).filter((b) => !isActive(b)).map((b) => b.id));
    expect(out.issues.some((i) => i.bookingId !== null && inactive.has(i.bookingId))).toBe(false);
  });

  it('finds accessibility conflicts somewhere in the fleet', () => {
    const all = store.sailings.flatMap((s) => findIssues.run(store, { sailing_id: s.id }).issues);
    expect(all.some((i) => i.type === 'accessibility_conflict')).toBe(true);
  });
});

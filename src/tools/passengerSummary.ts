import * as z from 'zod/v4';
import { CABIN_CATEGORIES, LOYALTY_TIERS } from '../data/types.js';
import { ageOn } from '../lib/dates.js';
import { fullName, isActive, isPaymentOverdue, passportCheck, requireSailing, requireShip, round2 } from '../lib/domain.js';
import { defineTool, sailingIdInput, sailingRef, sailingRefOutput } from './shared.js';

const count = z.number().int();
const byBookingStatus = z.object({ confirmed: count, pending_payment: count, cancelled: count, waitlisted: count });
const specialRequestItem = z.object({
  passengerId: z.string(),
  name: z.string(),
  bookingId: z.string(),
  cabinNumber: z.string().nullable(),
  type: z.enum(['dietary', 'mobility', 'celebration', 'medical']),
  detail: z.string(),
});

export const passengerSummary = defineTool({
  name: 'passenger_summary',
  title: 'Passenger summary',
  description:
    'Manifest-level overview of one sailing: bookings and guests by status (confirmed vs pending payment, plus cancelled ' +
    'and waitlisted), occupancy, loyalty tiers, cabins by category, nationalities, document and payment counts, and every ' +
    'special request (dietary, mobility, celebration, medical) for guests who are sailing.',
  inputSchema: z.object({ sailing_id: sailingIdInput }),
  outputSchema: z.object({
    asOf: z.string(),
    sailing: sailingRefOutput,
    bookings: z.object({ total: count, byStatus: byBookingStatus }),
    guests: z.object({
      sailing: count.describe('Guests on confirmed or pending-payment bookings.'),
      byBookingStatus,
      adults: count,
      children: count,
      guestCapacity: count,
      occupancyPct: z.number(),
    }),
    loyaltyTiers: z.object({ Blue: count, Silver: count, Gold: count, Platinum: count }),
    cabins: z.array(z.object({ category: z.string(), total: count, booked: count, available: count })),
    nationalities: z.array(z.object({ country: z.string(), guests: count })),
    documents: z.object({ passportsMissing: count, passportsExpiringTooSoon: count }),
    payments: z.object({ currency: z.string(), pendingBookings: count, overdueBookings: count, outstandingOnPending: z.number() }),
    specialRequests: z.object({
      total: count,
      byType: z.object({ dietary: count, mobility: count, celebration: count, medical: count }),
      items: z.array(specialRequestItem),
    }),
    summary: z.string(),
  }),
  run(store, input) {
    const sailing = requireSailing(store, input.sailing_id);
    const ship = requireShip(store, sailing);
    const bookings = store.bookingsForSailing(sailing.id);
    const active = bookings.filter(isActive);

    const bookingCounts = { confirmed: 0, pending_payment: 0, cancelled: 0, waitlisted: 0 };
    const guestCounts = { confirmed: 0, pending_payment: 0, cancelled: 0, waitlisted: 0 };
    for (const b of bookings) {
      bookingCounts[b.status] += 1;
      guestCounts[b.status] += b.passengerIds.length;
    }

    const loyaltyTiers = Object.fromEntries(LOYALTY_TIERS.map((t) => [t, 0])) as Record<(typeof LOYALTY_TIERS)[number], number>;
    const nationalityCounts = new Map<string, number>();
    const byType = { dietary: 0, mobility: 0, celebration: 0, medical: 0 };
    const items: z.output<typeof specialRequestItem>[] = [];
    let adults = 0;
    let passportsMissing = 0;
    let passportsExpiringTooSoon = 0;

    for (const b of active) {
      for (const p of store.passengersFor(b.passengerIds)) {
        loyaltyTiers[p.loyaltyTier] += 1;
        nationalityCounts.set(p.nationality, (nationalityCounts.get(p.nationality) ?? 0) + 1);
        if (ageOn(p.dateOfBirth, sailing.departureDate) >= 18) adults += 1;
        const check = passportCheck(p, sailing);
        if (check === 'missing') passportsMissing += 1;
        if (check === 'expires_too_soon') passportsExpiringTooSoon += 1;
        for (const r of p.specialRequests) {
          byType[r.type] += 1;
          items.push({ passengerId: p.id, name: fullName(p), bookingId: b.id, cabinNumber: b.cabinNumber, type: r.type, detail: r.detail });
        }
      }
    }
    items.sort((a, b) => a.type.localeCompare(b.type) || (a.cabinNumber ?? '').localeCompare(b.cabinNumber ?? '') || a.passengerId.localeCompare(b.passengerId));

    const cabins = CABIN_CATEGORIES.map((category) => {
      const total = ship.cabinCategories.find((c) => c.category === category)?.cabins ?? 0;
      const booked = active.filter((b) => b.cabinCategory === category).length;
      return { category, total, booked, available: Math.max(0, total - booked) };
    });

    const nationalities = [...nationalityCounts]
      .map(([country, guests]) => ({ country, guests }))
      .sort((a, b) => b.guests - a.guests || a.country.localeCompare(b.country))
      .slice(0, 6);

    const pending = active.filter((b) => b.status === 'pending_payment');
    const sailingGuests = guestCounts.confirmed + guestCounts.pending_payment;
    const occupancyPct = round2((sailingGuests / ship.guestCapacity) * 100);
    const totalRequests = items.length;

    const summary =
      `${sailing.id} (${ship.name}, departs ${sailing.departureDate}): ${sailingGuests} guests sailing ` +
      `(${guestCounts.confirmed} confirmed, ${guestCounts.pending_payment} pending payment), ${occupancyPct}% of ${ship.guestCapacity} lower berths. ` +
      `${bookingCounts.cancelled} cancelled and ${bookingCounts.waitlisted} waitlisted bookings. ` +
      `${totalRequests} special requests; ${passportsMissing} passports missing.`;

    return {
      asOf: store.asOf,
      sailing: sailingRef(store, sailing),
      bookings: { total: bookings.length, byStatus: bookingCounts },
      guests: {
        sailing: sailingGuests,
        byBookingStatus: guestCounts,
        adults,
        children: sailingGuests - adults,
        guestCapacity: ship.guestCapacity,
        occupancyPct,
      },
      loyaltyTiers,
      cabins,
      nationalities,
      documents: { passportsMissing, passportsExpiringTooSoon },
      payments: {
        currency: sailing.currency,
        pendingBookings: pending.length,
        overdueBookings: pending.filter((b) => isPaymentOverdue(b, store.asOf)).length,
        outstandingOnPending: round2(pending.reduce((sum, b) => sum + b.totalFare - b.amountPaid, 0)),
      },
      specialRequests: { total: totalRequests, byType, items },
      summary,
    };
  },
});


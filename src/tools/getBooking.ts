import * as z from 'zod/v4';
import { ageOn } from '../lib/dates.js';
import {
  fullName,
  isActive,
  isPaymentOverdue,
  maskPassportNumber,
  passportCheck,
  requireSailing,
  round2,
} from '../lib/domain.js';
import { ToolInputError } from '../lib/errors.js';
import { defineTool, sailingRef, sailingRefOutput } from './shared.js';

export const getBooking = defineTool({
  name: 'get_booking',
  title: 'Get booking',
  description:
    'Full details of one booking: status, cabin, sailing, guests (loyalty tier, passport status, special requests), ' +
    'payment position and shore excursions, plus a list of flags that need attention. Passport numbers are masked.',
  inputSchema: z.object({
    booking_id: z
      .string()
      .regex(/^BK-\d{6}$/, 'Booking IDs look like BK-100001')
      .describe('Booking reference, e.g. "BK-100001".'),
  }),
  outputSchema: z.object({
    asOf: z.string(),
    booking: z.object({
      bookingId: z.string(),
      status: z.enum(['confirmed', 'pending_payment', 'cancelled', 'waitlisted']),
      channel: z.string(),
      bookedOn: z.string(),
      cabinCategory: z.string(),
      cabinNumber: z.string().nullable(),
      cancelledOn: z.string().nullable(),
      cancellationReason: z.string().nullable(),
      waitlistPosition: z.number().int().nullable(),
    }),
    sailing: sailingRefOutput,
    guests: z.array(
      z.object({
        passengerId: z.string(),
        name: z.string(),
        isLead: z.boolean(),
        age: z.number().int(),
        nationality: z.string(),
        loyaltyTier: z.string(),
        loyaltyNumber: z.string(),
        passport: z.object({
          status: z.enum(['valid', 'missing', 'expires_too_soon']),
          numberMasked: z.string().nullable(),
          expiryDate: z.string().nullable(),
        }),
        specialRequests: z.array(z.object({ type: z.string(), detail: z.string() })),
      }),
    ),
    payment: z.object({
      currency: z.string(),
      totalFare: z.number(),
      amountPaid: z.number(),
      balanceDue: z.number(),
      paymentDueDate: z.string(),
      overdue: z.boolean(),
    }),
    excursions: z.array(
      z.object({
        excursionBookingId: z.string(),
        excursionId: z.string(),
        name: z.string(),
        port: z.string(),
        date: z.string(),
        status: z.enum(['confirmed', 'requested', 'waitlisted']),
        waitlistPosition: z.number().int().nullable(),
        guests: z.array(z.string()),
        pricePerGuest: z.number(),
        total: z.number(),
      }),
    ),
    flags: z.array(z.string()),
    summary: z.string(),
  }),
  run(store, input) {
    const booking = store.booking(input.booking_id);
    if (!booking) {
      throw new ToolInputError(
        `Booking "${input.booking_id}" was not found. Booking references run from BK-100001 upwards; check the number with the guest.`,
      );
    }
    const sailing = requireSailing(store, booking.sailingId);
    const passengers = store.passengersFor(booking.passengerIds);
    const names = new Map(passengers.map((p) => [p.id, fullName(p)]));
    const flags: string[] = [];

    const guests = passengers.map((p) => {
      const check = passportCheck(p, sailing);
      if (isActive(booking) && check === 'missing') flags.push(`Passport details missing for ${fullName(p)}`);
      if (isActive(booking) && check === 'expires_too_soon') {
        flags.push(`Passport for ${fullName(p)} expires ${p.passport.expiryDate}, less than 6 months after return`);
      }
      return {
        passengerId: p.id,
        name: fullName(p),
        isLead: p.id === booking.leadPassengerId,
        age: ageOn(p.dateOfBirth, sailing.departureDate),
        nationality: p.nationality,
        loyaltyTier: p.loyaltyTier,
        loyaltyNumber: p.loyaltyNumber,
        passport: { status: check, numberMasked: maskPassportNumber(p.passport.number), expiryDate: p.passport.expiryDate },
        specialRequests: p.specialRequests.map((r) => ({ type: r.type, detail: r.detail })),
      };
    });

    const overdue = isPaymentOverdue(booking, store.asOf);
    const balanceDue = round2(booking.totalFare - booking.amountPaid);
    if (overdue) flags.push(`Payment of ${balanceDue} ${booking.currency} was due ${booking.paymentDueDate} and is overdue`);
    else if (booking.status === 'pending_payment') flags.push(`Payment of ${balanceDue} ${booking.currency} due ${booking.paymentDueDate}`);

    const excursions = store
      .excursionBookingsForBooking(booking.id)
      .map((xb) => {
        const ex = store.excursion(xb.excursionId);
        if (!ex) throw new Error(`Dataset integrity error: excursion ${xb.excursionId} not found`);
        if (xb.status === 'requested') flags.push(`${ex.name} (${ex.port}, ${ex.date}) awaiting operator confirmation`);
        if (xb.status === 'waitlisted') flags.push(`${ex.name} (${ex.port}, ${ex.date}) waitlisted at position ${xb.waitlistPosition}`);
        return {
          excursionBookingId: xb.id,
          excursionId: ex.id,
          name: ex.name,
          port: ex.port,
          date: ex.date,
          status: xb.status,
          waitlistPosition: xb.waitlistPosition,
          guests: xb.passengerIds.map((id) => names.get(id) ?? id),
          pricePerGuest: ex.pricePerGuest,
          total: ex.pricePerGuest * xb.passengerIds.length,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

    const lead = names.get(booking.leadPassengerId) ?? booking.leadPassengerId;
    const cabin = booking.cabinNumber ? `${booking.cabinCategory} cabin ${booking.cabinNumber}` : `${booking.cabinCategory} (no cabin assigned)`;
    const summary =
      `${booking.id} (${booking.status.replace('_', ' ')}): ${lead} + ${passengers.length - 1} guest(s), ${cabin}, ` +
      `${sailing.name} on ${sailing.departureDate}. ${flags.length === 0 ? 'No open issues.' : `${flags.length} item(s) need attention.`}`;

    return {
      asOf: store.asOf,
      booking: {
        bookingId: booking.id,
        status: booking.status,
        channel: booking.channel,
        bookedOn: booking.bookedOn,
        cabinCategory: booking.cabinCategory,
        cabinNumber: booking.cabinNumber,
        cancelledOn: booking.cancelledOn,
        cancellationReason: booking.cancellationReason,
        waitlistPosition: booking.waitlistPosition,
      },
      sailing: sailingRef(store, sailing),
      guests,
      payment: {
        currency: booking.currency,
        totalFare: booking.totalFare,
        amountPaid: booking.amountPaid,
        balanceDue,
        paymentDueDate: booking.paymentDueDate,
        overdue,
      },
      excursions,
      flags,
      summary,
    };
  },
});

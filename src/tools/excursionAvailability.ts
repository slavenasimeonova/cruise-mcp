import * as z from 'zod/v4';
import type { CruiseStore } from '../data/store.js';
import type { Excursion } from '../data/types.js';
import { isActive, requireSailing, resolvePortOfCall } from '../lib/domain.js';
import { defineTool, portInput, sailingIdInput, sailingRef, sailingRefOutput } from './shared.js';

/** Seats left at or below this count are reported as "limited". */
const LIMITED_SEATS = 5;

export interface ExcursionLoad {
  confirmedGuests: number;
  requestedGuests: number;
  waitlistedGuests: number;
  waitlistRequests: number;
}

/** Guest counts per status for an excursion, ignoring bookings that will not sail. */
export function excursionLoad(store: CruiseStore, excursion: Excursion): ExcursionLoad {
  const load: ExcursionLoad = { confirmedGuests: 0, requestedGuests: 0, waitlistedGuests: 0, waitlistRequests: 0 };
  for (const xb of store.excursionBookingsForExcursion(excursion.id)) {
    const booking = store.booking(xb.bookingId);
    if (!booking || !isActive(booking)) continue;
    const guests = xb.passengerIds.length;
    if (xb.status === 'confirmed') load.confirmedGuests += guests;
    else if (xb.status === 'requested') load.requestedGuests += guests;
    else {
      load.waitlistedGuests += guests;
      load.waitlistRequests += 1;
    }
  }
  return load;
}

export const excursionAvailability = defineTool({
  name: 'excursion_availability',
  title: 'Excursion availability',
  description:
    'Capacity and availability of every shore excursion at one port on a sailing: confirmed, requested and waitlisted guests, ' +
    'seats left, price, activity level and accessibility. Flags excursions that are overbooked after an operator capacity cut.',
  inputSchema: z.object({
    sailing_id: sailingIdInput,
    port: portInput,
  }),
  outputSchema: z.object({
    asOf: z.string(),
    sailing: sailingRefOutput,
    port: z.string(),
    portDay: z.object({
      day: z.number().int(),
      date: z.string(),
      arrival: z.string().nullable(),
      departure: z.string().nullable(),
      tender: z.boolean(),
    }),
    excursions: z.array(
      z.object({
        excursionId: z.string(),
        name: z.string(),
        durationHours: z.number(),
        activityLevel: z.enum(['easy', 'moderate', 'strenuous']),
        wheelchairAccessible: z.boolean(),
        requiresOperatorConfirmation: z.boolean(),
        pricePerGuest: z.number(),
        currency: z.string(),
        capacity: z.number().int(),
        originalCapacity: z.number().int(),
        capacityNote: z.string().nullable(),
        confirmedGuests: z.number().int(),
        requestedGuests: z.number().int(),
        waitlistedGuests: z.number().int(),
        waitlistRequests: z.number().int(),
        seatsAvailable: z.number().int(),
        overbookedBy: z.number().int(),
        availability: z.enum(['available', 'limited', 'sold_out', 'overbooked']),
      }),
    ),
    summary: z.string(),
  }),
  run(store, input) {
    const sailing = requireSailing(store, input.sailing_id);
    const portDay = resolvePortOfCall(sailing, input.port);

    const excursions = store
      .excursionsForSailing(sailing.id)
      .filter((ex) => ex.port === portDay.port)
      .map((ex) => {
        const load = excursionLoad(store, ex);
        const seatsAvailable = Math.max(0, ex.capacity - load.confirmedGuests);
        const overbookedBy = Math.max(0, load.confirmedGuests - ex.capacity);
        const availability =
          overbookedBy > 0 ? 'overbooked' : seatsAvailable === 0 ? 'sold_out' : seatsAvailable <= LIMITED_SEATS ? 'limited' : 'available';
        return {
          excursionId: ex.id,
          name: ex.name,
          durationHours: ex.durationHours,
          activityLevel: ex.activityLevel,
          wheelchairAccessible: ex.wheelchairAccessible,
          requiresOperatorConfirmation: ex.requiresOperatorConfirmation,
          pricePerGuest: ex.pricePerGuest,
          currency: ex.currency,
          capacity: ex.capacity,
          originalCapacity: ex.originalCapacity,
          capacityNote: ex.capacityNote,
          ...load,
          seatsAvailable,
          overbookedBy,
          availability: availability as 'available' | 'limited' | 'sold_out' | 'overbooked',
        };
      });

    const parts = excursions.map((e) =>
      e.availability === 'overbooked'
        ? `${e.name} OVERBOOKED by ${e.overbookedBy}`
        : e.availability === 'sold_out'
          ? `${e.name} sold out (${e.waitlistedGuests} waitlisted)`
          : `${e.name} ${e.seatsAvailable} seats left`,
    );
    const summary = `${portDay.port} on ${portDay.date} (day ${portDay.day}${portDay.tender ? ', tender port' : ''}): ${parts.join('; ')}.`;

    return {
      asOf: store.asOf,
      sailing: sailingRef(store, sailing),
      port: portDay.port,
      portDay: { day: portDay.day, date: portDay.date, arrival: portDay.arrival, departure: portDay.departure, tender: portDay.tender },
      excursions,
      summary,
    };
  },
});

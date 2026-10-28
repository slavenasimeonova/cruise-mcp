import * as z from 'zod/v4';
import { daysBetween } from '../lib/dates.js';
import { fullName, isActive, requireSailing, resolvePortOfCall, URGENT_DAYS, urgency } from '../lib/domain.js';
import { defineTool, portInput, sailingIdInput, sailingRef, sailingRefOutput } from './shared.js';

export const findUnconfirmedExcursions = defineTool({
  name: 'find_unconfirmed_excursions',
  title: 'Find unconfirmed excursions',
  description:
    'List shore-excursion requests on a sailing that are not confirmed yet: "requested" (awaiting the local operator) ' +
    'or "waitlisted" (excursion full). Sorted by excursion date and marked urgent when the excursion is within 14 days. ' +
    'Optionally limit to one port.',
  inputSchema: z.object({
    sailing_id: sailingIdInput,
    port: portInput.optional(),
  }),
  outputSchema: z.object({
    asOf: z.string(),
    sailing: sailingRefOutput,
    port: z.string().nullable(),
    totals: z.object({
      requests: z.number().int(),
      guests: z.number().int(),
      requested: z.number().int(),
      waitlisted: z.number().int(),
      urgent: z.number().int(),
    }),
    items: z.array(
      z.object({
        excursionBookingId: z.string(),
        bookingId: z.string(),
        leadGuest: z.string(),
        guests: z.number().int(),
        excursionId: z.string(),
        excursionName: z.string(),
        port: z.string(),
        date: z.string(),
        daysUntilExcursion: z.number().int(),
        status: z.enum(['requested', 'waitlisted']),
        waitlistPosition: z.number().int().nullable(),
        requestedOn: z.string(),
        urgency: z.enum(['urgent', 'soon', 'normal']),
      }),
    ),
    summary: z.string(),
  }),
  run(store, input) {
    const sailing = requireSailing(store, input.sailing_id);
    const portDay = input.port === undefined ? undefined : resolvePortOfCall(sailing, input.port);

    const items = store
      .excursionsForSailing(sailing.id)
      .filter((ex) => portDay === undefined || ex.port === portDay.port)
      .flatMap((ex) =>
        store.excursionBookingsForExcursion(ex.id).flatMap((xb) => {
          if (xb.status === 'confirmed') return [];
          const booking = store.booking(xb.bookingId);
          if (!booking || !isActive(booking)) return [];
          const lead = store.passenger(booking.leadPassengerId);
          const daysUntilExcursion = daysBetween(store.asOf, ex.date);
          return [
            {
              excursionBookingId: xb.id,
              bookingId: booking.id,
              leadGuest: lead ? fullName(lead) : booking.leadPassengerId,
              guests: xb.passengerIds.length,
              excursionId: ex.id,
              excursionName: ex.name,
              port: ex.port,
              date: ex.date,
              daysUntilExcursion,
              status: xb.status as 'requested' | 'waitlisted',
              waitlistPosition: xb.waitlistPosition,
              requestedOn: xb.requestedOn,
              urgency: urgency(daysUntilExcursion),
            },
          ];
        }),
      )
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.excursionName.localeCompare(b.excursionName) ||
          a.status.localeCompare(b.status) ||
          (a.waitlistPosition ?? 0) - (b.waitlistPosition ?? 0) ||
          a.excursionBookingId.localeCompare(b.excursionBookingId),
      );

    const requested = items.filter((i) => i.status === 'requested').length;
    const urgent = items.filter((i) => i.urgency === 'urgent').length;
    const where = portDay ? ` in ${portDay.port}` : '';
    const summary =
      items.length === 0
        ? `All excursion requests${where} on ${sailing.id} are confirmed.`
        : `${items.length} unconfirmed excursion request(s)${where} on ${sailing.id}: ${requested} awaiting operator confirmation, ` +
          `${items.length - requested} waitlisted. ${urgent} are within ${URGENT_DAYS} days.`;

    return {
      asOf: store.asOf,
      sailing: sailingRef(store, sailing),
      port: portDay?.port ?? null,
      totals: {
        requests: items.length,
        guests: items.reduce((n, i) => n + i.guests, 0),
        requested,
        waitlisted: items.length - requested,
        urgent,
      },
      items,
      summary,
    };
  },
});

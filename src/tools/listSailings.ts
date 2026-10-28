import * as z from 'zod/v4';
import { isValidIsoDate } from '../lib/dates.js';
import { daysToDeparture, isActive, portsOfCall, requireShip, resolveShip, round2 } from '../lib/domain.js';
import { ToolInputError } from '../lib/errors.js';
import { defineTool } from './shared.js';

export const listSailings = defineTool({
  name: 'list_sailings',
  title: 'List sailings',
  description:
    'List Azure Horizon Cruises sailings with dates, itinerary and how full each one is. ' +
    'Optionally filter by ship and/or earliest departure date. Use the returned sailingId with the other tools.',
  inputSchema: z.object({
    ship: z
      .string()
      .min(2)
      .max(40)
      .optional()
      .describe('Ship name or code: "Coral Vista" (CV), "Northern Pearl" (NP), "Solenne" (SO), "Sea Lyra" (SL).'),
    from_date: z.iso.date().optional().describe('Only sailings departing on or after this date (YYYY-MM-DD).'),
  }),
  outputSchema: z.object({
    asOf: z.string(),
    filters: z.object({ ship: z.string().nullable(), fromDate: z.string().nullable() }),
    count: z.number().int(),
    sailings: z.array(
      z.object({
        sailingId: z.string(),
        ship: z.string(),
        shipCode: z.string(),
        region: z.string(),
        name: z.string(),
        departureDate: z.string(),
        returnDate: z.string(),
        embarkPort: z.string(),
        portsOfCall: z.array(z.string()),
        daysToDeparture: z.number().int(),
        guestsBooked: z.number().int(),
        guestCapacity: z.number().int(),
        occupancyPct: z.number(),
      }),
    ),
    summary: z.string(),
  }),
  run(store, input) {
    if (input.from_date !== undefined && !isValidIsoDate(input.from_date)) {
      throw new ToolInputError(`from_date "${input.from_date}" is not a real calendar date. Use YYYY-MM-DD.`);
    }
    const ship = input.ship === undefined ? undefined : resolveShip(store, input.ship);
    const fromDate = input.from_date;

    const sailings = store.sailings
      .filter((s) => (ship === undefined || s.shipId === ship.id) && (fromDate === undefined || s.departureDate >= fromDate))
      .map((s) => {
        const sailingShip = requireShip(store, s);
        const guestsBooked = store
          .bookingsForSailing(s.id)
          .filter(isActive)
          .reduce((n, b) => n + b.passengerIds.length, 0);
        return {
          sailingId: s.id,
          ship: sailingShip.name,
          shipCode: sailingShip.id,
          region: s.region,
          name: s.name,
          departureDate: s.departureDate,
          returnDate: s.returnDate,
          embarkPort: s.embarkPort,
          portsOfCall: portsOfCall(s).map((d) => d.port ?? ''),
          daysToDeparture: daysToDeparture(store, s),
          guestsBooked,
          guestCapacity: sailingShip.guestCapacity,
          occupancyPct: round2((guestsBooked / sailingShip.guestCapacity) * 100),
        };
      });

    const scope = [ship ? `on ${ship.name}` : 'across the fleet', fromDate ? `departing on or after ${fromDate}` : null]
      .filter(Boolean)
      .join(' ');
    const summary =
      sailings.length === 0
        ? `No sailings ${scope}. The schedule runs ${store.sailings[0]?.departureDate} to ${store.sailings.at(-1)?.departureDate}.`
        : `${sailings.length} sailing(s) ${scope}; next departure ${sailings[0]!.sailingId} on ${sailings[0]!.departureDate}.`;

    return {
      asOf: store.asOf,
      filters: { ship: ship?.name ?? null, fromDate: fromDate ?? null },
      count: sailings.length,
      sailings,
      summary,
    };
  },
});

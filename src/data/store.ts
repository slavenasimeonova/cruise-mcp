// Read-only, in-memory view of the cruise dataset with lookup indexes. There are no write paths.
// Platform-neutral: the MCP server (Node) and the web dashboard (browser) both use it.
// Loading from disk lives in load.ts.
import type { Booking, Dataset, Excursion, ExcursionBooking, Passenger, Sailing, Ship } from './types.js';

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    const list = map.get(k);
    if (list) list.push(item);
    else map.set(k, [item]);
  }
  return map;
}

export class CruiseStore {
  readonly asOf: string;
  readonly ships: readonly Ship[];
  readonly sailings: readonly Sailing[];

  private readonly shipsById: Map<string, Ship>;
  private readonly sailingsById: Map<string, Sailing>;
  private readonly bookingsById: Map<string, Booking>;
  private readonly passengersById: Map<string, Passenger>;
  private readonly excursionsById: Map<string, Excursion>;
  private readonly bookingsBySailing: Map<string, Booking[]>;
  private readonly excursionsBySailing: Map<string, Excursion[]>;
  private readonly excursionBookingsByExcursion: Map<string, ExcursionBooking[]>;
  private readonly excursionBookingsByBooking: Map<string, ExcursionBooking[]>;

  constructor(data: Dataset) {
    this.asOf = data.meta.asOf;
    this.ships = data.ships;
    this.sailings = [...data.sailings].sort((a, b) => a.departureDate.localeCompare(b.departureDate) || a.id.localeCompare(b.id));
    this.shipsById = new Map(data.ships.map((s) => [s.id, s]));
    this.sailingsById = new Map(data.sailings.map((s) => [s.id, s]));
    this.bookingsById = new Map(data.bookings.map((b) => [b.id, b]));
    this.passengersById = new Map(data.passengers.map((p) => [p.id, p]));
    this.excursionsById = new Map(data.excursions.map((e) => [e.id, e]));
    this.bookingsBySailing = groupBy(data.bookings, (b) => b.sailingId);
    this.excursionsBySailing = groupBy(data.excursions, (e) => e.sailingId);
    this.excursionBookingsByExcursion = groupBy(data.excursionBookings, (x) => x.excursionId);
    this.excursionBookingsByBooking = groupBy(data.excursionBookings, (x) => x.bookingId);
  }

  ship(id: string): Ship | undefined {
    return this.shipsById.get(id);
  }

  sailing(id: string): Sailing | undefined {
    return this.sailingsById.get(id);
  }

  booking(id: string): Booking | undefined {
    return this.bookingsById.get(id);
  }

  passenger(id: string): Passenger | undefined {
    return this.passengersById.get(id);
  }

  excursion(id: string): Excursion | undefined {
    return this.excursionsById.get(id);
  }

  bookingsForSailing(sailingId: string): readonly Booking[] {
    return this.bookingsBySailing.get(sailingId) ?? [];
  }

  excursionsForSailing(sailingId: string): readonly Excursion[] {
    return this.excursionsBySailing.get(sailingId) ?? [];
  }

  excursionBookingsForExcursion(excursionId: string): readonly ExcursionBooking[] {
    return this.excursionBookingsByExcursion.get(excursionId) ?? [];
  }

  excursionBookingsForBooking(bookingId: string): readonly ExcursionBooking[] {
    return this.excursionBookingsByBooking.get(bookingId) ?? [];
  }

  /** Passenger lookup for IDs that the dataset guarantees exist. */
  passengersFor(ids: readonly string[]): Passenger[] {
    return ids.map((id) => {
      const p = this.passengersById.get(id);
      if (!p) throw new Error(`Dataset integrity error: passenger ${id} not found`);
      return p;
    });
  }
}

/** Builds a store from parsed JSON, rejecting anything that is not a schemaVersion 2 dataset. */
export function storeFromJson(data: unknown, source: string): CruiseStore {
  const d = data as Partial<Dataset> | null;
  if (d?.meta?.schemaVersion !== 2 || !Array.isArray(d.sailings) || !Array.isArray(d.bookings)) {
    throw new Error(`${source} is not a schemaVersion 2 cruise dataset. Run "npm run seed" to regenerate it.`);
  }
  return new CruiseStore(d as Dataset);
}

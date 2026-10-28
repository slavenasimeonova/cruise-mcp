// Read-only, in-memory view of data/cruise.json with lookup indexes. There are no write paths.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Booking, Dataset, Excursion, ExcursionBooking, Passenger, Sailing, Ship } from './types.js';

/** Resolves to <project>/data/cruise.json from both src/data (tsx, tests) and dist/data (built). */
export const DEFAULT_DATA_FILE = fileURLToPath(new URL('../../data/cruise.json', import.meta.url));

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

export function loadStore(file = DEFAULT_DATA_FILE): CruiseStore {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch (err) {
    throw new Error(`Cannot read cruise data at ${file}. Run "npm run seed" to generate it. (${(err as Error).message})`);
  }
  const data = JSON.parse(raw) as Partial<Dataset>;
  if (data.meta?.schemaVersion !== 1 || !Array.isArray(data.sailings) || !Array.isArray(data.bookings)) {
    throw new Error(`${file} is not a schemaVersion 1 cruise dataset. Run "npm run seed" to regenerate it.`);
  }
  return new CruiseStore(data as Dataset);
}

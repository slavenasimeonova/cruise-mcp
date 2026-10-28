// Business rules and lookups shared by the tools.
import type { CruiseStore } from '../data/store.js';
import type { Booking, ItineraryDay, Passenger, Sailing, Ship } from '../data/types.js';
import { addMonths, daysBetween } from './dates.js';
import { ToolInputError } from './errors.js';

/** Passports must be valid this many months after the cruise ends. */
export const PASSPORT_VALIDITY_MONTHS = 6;
/** Excursions or departures within this many days count as urgent. */
export const URGENT_DAYS = 14;
export const SOON_DAYS = 30;

export type PassportCheck = 'valid' | 'missing' | 'expires_too_soon';

/** Bookings that hold a cabin and will sail. */
export function isActive(booking: Booking): boolean {
  return booking.status === 'confirmed' || booking.status === 'pending_payment';
}

export function isPaymentOverdue(booking: Booking, asOf: string): boolean {
  return booking.status === 'pending_payment' && booking.paymentDueDate < asOf;
}

export function passportCheck(passenger: Passenger, sailing: Sailing): PassportCheck {
  const { passport } = passenger;
  if (passport.status === 'missing' || passport.expiryDate === null) return 'missing';
  return passport.expiryDate < addMonths(sailing.returnDate, PASSPORT_VALIDITY_MONTHS) ? 'expires_too_soon' : 'valid';
}

export function maskPassportNumber(number: string | null): string | null {
  return number === null ? null : `${'*'.repeat(Math.max(0, number.length - 3))}${number.slice(-3)}`;
}

export function fullName(p: Passenger): string {
  return `${p.firstName} ${p.lastName}`;
}

export function urgency(daysAway: number): 'urgent' | 'soon' | 'normal' {
  return daysAway <= URGENT_DAYS ? 'urgent' : daysAway <= SOON_DAYS ? 'soon' : 'normal';
}

/** Lowercase, strip accents and punctuation: "Roatán" -> "roatan", "St. Maarten" -> "st maarten". */
export function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "George Town (Grand Cayman)" matches "george town", "grand cayman" and the full name. */
function portAliases(port: string): string[] {
  const aliases = [normalizeName(port)];
  const m = /^(.*?)\s*\((.*)\)\s*$/.exec(port);
  if (m) aliases.push(normalizeName(m[1]!), normalizeName(m[2]!));
  return aliases;
}

export function requireSailing(store: CruiseStore, sailingId: string): Sailing {
  const sailing = store.sailing(sailingId);
  if (!sailing) {
    const examples = store.sailings.slice(0, 3).map((s) => s.id).join(', ');
    throw new ToolInputError(`Sailing "${sailingId}" was not found. Call list_sailings to see valid sailing IDs (for example ${examples}).`);
  }
  return sailing;
}

export function requireShip(store: CruiseStore, sailing: Sailing): Ship {
  const ship = store.ship(sailing.shipId);
  if (!ship) throw new Error(`Dataset integrity error: ship ${sailing.shipId} not found`);
  return ship;
}

export function resolveShip(store: CruiseStore, nameOrCode: string): Ship {
  const wanted = normalizeName(nameOrCode);
  const ship = store.ships.find((s) => normalizeName(s.name) === wanted || s.id.toLowerCase() === wanted);
  if (!ship) {
    const options = store.ships.map((s) => `${s.name} (${s.id})`).join(', ');
    throw new ToolInputError(`Unknown ship "${nameOrCode}". Azure Horizon ships are: ${options}.`);
  }
  return ship;
}

export function portsOfCall(sailing: Sailing): ItineraryDay[] {
  return sailing.itinerary.filter((d) => d.kind === 'port');
}

/** Finds the port-of-call day for a user-supplied port name (case, accents and parentheses ignored). */
export function resolvePortOfCall(sailing: Sailing, port: string): ItineraryDay & { port: string } {
  const wanted = normalizeName(port);
  const calls = portsOfCall(sailing);
  const day = calls.find((d) => d.port !== null && portAliases(d.port).includes(wanted));
  if (day && day.port !== null) return { ...day, port: day.port };

  const list = calls.map((d) => d.port).join(', ');
  if (wanted !== '' && portAliases(sailing.embarkPort).includes(wanted)) {
    throw new ToolInputError(
      `${sailing.embarkPort} is the embarkation and disembarkation port for ${sailing.id}; shore excursions are only sold at ports of call: ${list}.`,
    );
  }
  throw new ToolInputError(`Port "${port}" is not a port of call on sailing ${sailing.id}. Its ports of call are: ${list}.`);
}

export function daysToDeparture(store: CruiseStore, sailing: Sailing): number {
  return daysBetween(store.asOf, sailing.departureDate);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

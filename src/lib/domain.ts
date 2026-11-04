// Business rules and lookups shared by the tools.
import type { CruiseStore } from '../data/store.js';
import type {
  Booking,
  Excursion,
  ExcursionBookingStatus,
  ItineraryDay,
  MobilityNeed,
  Passenger,
  Sailing,
  Ship,
} from '../data/types.js';
import { addMonths, daysBetween } from './dates.js';
import { ToolInputError } from './errors.js';

/** Under the standard rule, passports must be valid this many months after the cruise ends. */
export const PASSPORT_VALIDITY_MONTHS = 6;
/** Excursions or departures within this many days count as urgent. */
export const URGENT_DAYS = 14;
export const SOON_DAYS = 30;

/** EU member states (ISO 3166-1 alpha-2). */
export const EU_COUNTRIES: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
]);

/** Schengen area members: the EU minus Ireland and Cyprus, plus Iceland, Liechtenstein, Norway and Switzerland. */
export const SCHENGEN_COUNTRIES: ReadonlySet<string> = new Set([
  ...[...EU_COUNTRIES].filter((c) => c !== 'IE' && c !== 'CY'),
  'IS', 'LI', 'NO', 'CH',
]);

/** Every port the ship calls at, including embarkation and disembarkation, is in the Schengen area. */
export function isAllSchengen(sailing: Sailing): boolean {
  return sailing.itinerary.every((d) => d.kind === 'sea' || (d.country !== null && SCHENGEN_COUNTRIES.has(d.country)));
}

/**
 * Which travel-document rule applies to a guest on a sailing:
 * - `eu_schengen`: EU citizen on an all-Schengen itinerary; a passport or national ID card valid through the return date.
 * - `passport_6_months`: everyone else; a passport valid at least 6 months after the return date.
 */
export type DocumentRule = 'eu_schengen' | 'passport_6_months';

export interface TravelDocumentCheck {
  status: 'valid' | 'missing' | 'expires_too_soon';
  rule: DocumentRule;
  /** The document that satisfies the rule, or the one that falls short; null when nothing usable is on file. */
  document: 'passport' | 'id_card' | null;
  expiryDate: string | null;
}

export function documentRule(passenger: Passenger, sailing: Sailing): DocumentRule {
  return EU_COUNTRIES.has(passenger.nationality) && isAllSchengen(sailing) ? 'eu_schengen' : 'passport_6_months';
}

export function travelDocumentCheck(passenger: Passenger, sailing: Sailing): TravelDocumentCheck {
  const rule = documentRule(passenger, sailing);
  const passport =
    passenger.passport.status === 'on_file' && passenger.passport.expiryDate !== null
      ? { document: 'passport' as const, expiryDate: passenger.passport.expiryDate }
      : null;

  if (rule === 'passport_6_months') {
    if (!passport) return { status: 'missing', rule, document: null, expiryDate: null };
    const tooSoon = passport.expiryDate < addMonths(sailing.returnDate, PASSPORT_VALIDITY_MONTHS);
    return { status: tooSoon ? 'expires_too_soon' : 'valid', rule, ...passport };
  }

  // EU citizen, all-Schengen: either document, valid through the return date. Passport preferred when both qualify.
  const idCard = passenger.idCard ? { document: 'id_card' as const, expiryDate: passenger.idCard.expiryDate } : null;
  const onFile = [passport, idCard].filter((d) => d !== null);
  if (onFile.length === 0) return { status: 'missing', rule, document: null, expiryDate: null };
  const usable = onFile.find((d) => d.expiryDate >= sailing.returnDate);
  if (usable) return { status: 'valid', rule, ...usable };
  const latest = onFile.reduce((a, b) => (b.expiryDate > a.expiryDate ? b : a));
  return { status: 'expires_too_soon', rule, ...latest };
}

const DOCUMENT_NAMES = { passport: 'Passport', id_card: 'National ID card' } as const;

/** Issue text for a missing or expiring travel document; null when the document is valid. Shared by find_issues and get_booking. */
export function travelDocumentMessage(passenger: Passenger, sailing: Sailing, bookingId: string, check: TravelDocumentCheck): string | null {
  const who = `${fullName(passenger)} (${bookingId})`;
  if (check.status === 'valid') return null;
  if (check.rule === 'eu_schengen') {
    return check.status === 'missing'
      ? `No passport or national ID card on file for ${who}. As an EU citizen on an all-Schengen itinerary, either is accepted.`
      : `${DOCUMENT_NAMES[check.document!]} for ${who} expires ${check.expiryDate}, before the ${sailing.returnDate} return. ` +
          'EU citizens on an all-Schengen itinerary need a passport or national ID card valid through the trip.';
  }
  return check.status === 'missing'
    ? `No passport details on file for ${who}.`
    : `Passport for ${who} expires ${check.expiryDate}, less than 6 months after the ${sailing.returnDate} return.`;
}

/** Bookings that hold a cabin and will sail. */
export function isActive(booking: Booking): boolean {
  return booking.status === 'confirmed' || booking.status === 'pending_payment';
}

export function isPaymentOverdue(booking: Booking, asOf: string): boolean {
  return booking.status === 'pending_payment' && booking.paymentDueDate < asOf;
}

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

/** One booking's confirmed guests on an excursion that has more confirmed guests than seats. */
export function overbookedExcursionMessage(excursion: Excursion, load: ExcursionLoad, bookingId: string, guests: number): string {
  return (
    `${guests} guest(s) on ${bookingId} are confirmed on ${excursion.name} (${excursion.port}, ${excursion.date}), ` +
    `which is overbooked: ${load.confirmedGuests} confirmed for ${excursion.capacity} seats ` +
    `(over by ${load.confirmedGuests - excursion.capacity}).${excursion.capacityNote ? ` ${excursion.capacityNote}.` : ''}`
  );
}

/** An overbooked excursion as a single issue, for sailing-level views. */
export function overbookedExcursionSummary(excursion: Excursion, load: ExcursionLoad, affectedBookings: number): string {
  return (
    `${excursion.name} (${excursion.port}, ${excursion.date}) is overbooked: ${load.confirmedGuests} confirmed for ` +
    `${excursion.capacity} seats (over by ${load.confirmedGuests - excursion.capacity}); affects ${affectedBookings} ` +
    `booking(s).${excursion.capacityNote ? ` ${excursion.capacityNote}.` : ''}`
  );
}

export interface MobilityConflict {
  need: MobilityNeed;
  /** The guest's own mobility request, e.g. "Travels with own mobility scooter". */
  detail: string;
  /** Why the excursion is unsuitable, e.g. "not wheelchair accessible and strenuous". */
  reason: string;
}

/** Whether this excursion is unsuitable for the guest's mobility need (not accessible, or too strenuous). */
export function mobilityConflict(passenger: Passenger, excursion: Excursion): MobilityConflict | null {
  const request = passenger.specialRequests.find((r) => r.type === 'mobility' && r.mobilityNeed !== null);
  if (!request?.mobilityNeed) return null;
  const reasons: string[] = [];
  if (request.mobilityNeed === 'wheelchair' && !excursion.wheelchairAccessible) reasons.push('not wheelchair accessible');
  if (excursion.activityLevel === 'strenuous') reasons.push('strenuous');
  // Strenuous alone is a conflict for limited walking; for wheelchair users only inaccessibility is.
  const conflict = request.mobilityNeed === 'wheelchair' ? !excursion.wheelchairAccessible : excursion.activityLevel === 'strenuous';
  return conflict ? { need: request.mobilityNeed, detail: request.detail, reason: reasons.join(' and ') } : null;
}

export function accessibilityConflictMessage(
  passenger: Passenger,
  excursion: Excursion,
  status: ExcursionBookingStatus,
  conflict: MobilityConflict,
): string {
  return (
    `${fullName(passenger)} is ${status} on ${excursion.name} (${excursion.port}, ${excursion.date}), ` +
    `which is ${conflict.reason}. Mobility request: "${conflict.detail}".`
  );
}

/** Masks a passport or ID card number down to its last three characters. */
export function maskDocumentNumber(number: string | null): string | null {
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

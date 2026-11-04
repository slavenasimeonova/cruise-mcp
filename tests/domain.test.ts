// Business rules shared by find_issues, get_booking and the dashboard.
import { describe, expect, it } from 'vitest';
import type { Excursion, ExcursionBookingStatus, ItineraryDay, Passenger, Sailing } from '../src/data/types.js';
import {
  accessibilityConflictMessage,
  documentRule,
  isAllSchengen,
  mobilityConflict,
  travelDocumentCheck,
  travelDocumentMessage,
} from '../src/lib/domain.js';

const guest = (detail: string | null, need: 'wheelchair' | 'limited_walking' | null): Passenger => ({
  id: 'PX-000001',
  bookingId: 'BK-000001',
  firstName: 'Test',
  lastName: 'Guest',
  dateOfBirth: '1950-01-01',
  nationality: 'GB',
  loyaltyTier: 'Blue',
  loyaltyNumber: 'AH1',
  passport: { status: 'missing', number: null, expiryDate: null, issuingCountry: null },
  idCard: null,
  specialRequests: detail ? [{ type: 'mobility', detail, mobilityNeed: need }] : [],
});

const tour = (wheelchairAccessible: boolean, activityLevel: Excursion['activityLevel']): Excursion => ({
  id: 'EX-00001',
  sailingId: 'AH-NP-261104',
  port: 'Naples',
  date: '2026-11-08',
  name: 'Capri & Blue Grotto',
  durationHours: 8,
  pricePerGuest: 149,
  currency: 'EUR',
  capacity: 24,
  originalCapacity: 24,
  capacityNote: null,
  activityLevel,
  wheelchairAccessible,
  requiresOperatorConfirmation: true,
});

describe('mobilityConflict', () => {
  const scooter = guest('Travels with own mobility scooter', 'wheelchair');
  const cane = guest('Walks with a cane; prefers to avoid stairs', 'limited_walking');

  it('flags wheelchair and scooter users on inaccessible tours, naming every reason', () => {
    expect(mobilityConflict(scooter, tour(false, 'strenuous'))).toEqual({
      need: 'wheelchair',
      detail: 'Travels with own mobility scooter',
      reason: 'not wheelchair accessible and strenuous',
    });
    expect(mobilityConflict(scooter, tour(false, 'easy'))?.reason).toBe('not wheelchair accessible');
    expect(mobilityConflict(scooter, tour(true, 'strenuous'))).toBeNull();
  });

  it('flags limited walking only on strenuous tours', () => {
    expect(mobilityConflict(cane, tour(false, 'strenuous'))?.reason).toBe('strenuous');
    expect(mobilityConflict(cane, tour(false, 'moderate'))).toBeNull();
  });

  it('ignores guests without a mobility request', () => {
    expect(mobilityConflict(guest(null, null), tour(false, 'strenuous'))).toBeNull();
  });

  it("quotes the guest's own request and the booking status, including requested and waitlisted", () => {
    const ex = tour(false, 'strenuous');
    for (const status of ['confirmed', 'requested', 'waitlisted'] as ExcursionBookingStatus[]) {
      expect(accessibilityConflictMessage(scooter, ex, status, mobilityConflict(scooter, ex)!)).toBe(
        `Test Guest is ${status} on Capri & Blue Grotto (Naples, 2026-11-08), which is not wheelchair accessible and strenuous. ` +
          'Mobility request: "Travels with own mobility scooter".',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// Travel documents
// ---------------------------------------------------------------------------

/** A 7-night sailing returning 2026-11-11 that calls at the given countries (one port per country). */
const sailingVia = (...countries: string[]): Sailing => {
  const day = (n: number, kind: ItineraryDay['kind'], country: string | null): ItineraryDay => ({
    day: n,
    date: `2026-11-${String(3 + n).padStart(2, '0')}`,
    kind,
    port: country ? `Port ${country}` : null,
    country,
    arrival: null,
    departure: null,
    tender: false,
  });
  const [first, ...rest] = countries;
  return {
    id: 'AH-NP-261104',
    shipId: 'NP',
    region: 'Mediterranean',
    name: 'Test sailing',
    departureDate: '2026-11-04',
    returnDate: '2026-11-11',
    nights: 7,
    embarkPort: `Port ${first}`,
    currency: 'EUR',
    itinerary: [day(1, 'embark', first!), ...rest.map((c, i) => day(i + 2, 'port', c)), day(7, 'sea', null), day(8, 'disembark', first!)],
  };
};

const SCHENGEN = sailingVia('ES', 'FR', 'IT', 'GR');
const CARIBBEAN = sailingVia('US', 'MX', 'KY');
const WITH_UK = sailingVia('ES', 'FR', 'GB');
const WITH_IRELAND = sailingVia('FR', 'IE');

const traveller = (nationality: string, docs: { passport?: string; idCard?: string }): Passenger => ({
  ...guest(null, null),
  nationality,
  passport: docs.passport
    ? { status: 'on_file', number: 'AB1234567', expiryDate: docs.passport, issuingCountry: nationality }
    : { status: 'missing', number: null, expiryDate: null, issuingCountry: null },
  idCard: docs.idCard ? { number: 'X12345678', expiryDate: docs.idCard, issuingCountry: nationality } : null,
});

describe('isAllSchengen', () => {
  it('needs every port in the Schengen area, ignoring sea days', () => {
    expect(isAllSchengen(SCHENGEN)).toBe(true);
    expect(isAllSchengen(CARIBBEAN)).toBe(false);
    expect(isAllSchengen(WITH_UK)).toBe(false);
    // Ireland is in the EU but not in Schengen.
    expect(isAllSchengen(WITH_IRELAND)).toBe(false);
  });
});

describe('travelDocumentCheck', () => {
  it('applies the EU rule only to EU citizens on all-Schengen itineraries', () => {
    expect(documentRule(traveller('DE', {}), SCHENGEN)).toBe('eu_schengen');
    expect(documentRule(traveller('IE', {}), SCHENGEN)).toBe('eu_schengen'); // Irish citizens are EU citizens.
    expect(documentRule(traveller('DE', {}), CARIBBEAN)).toBe('passport_6_months');
    expect(documentRule(traveller('DE', {}), WITH_UK)).toBe('passport_6_months');
    expect(documentRule(traveller('GB', {}), SCHENGEN)).toBe('passport_6_months');
    expect(documentRule(traveller('US', {}), SCHENGEN)).toBe('passport_6_months');
  });

  it('accepts a national ID card valid through the return date for EU citizens', () => {
    expect(travelDocumentCheck(traveller('FR', { idCard: '2030-01-01' }), SCHENGEN)).toEqual({
      status: 'valid',
      rule: 'eu_schengen',
      document: 'id_card',
      expiryDate: '2030-01-01',
    });
    // Valid on the return day itself is enough; the day before is not.
    expect(travelDocumentCheck(traveller('FR', { idCard: '2026-11-11' }), SCHENGEN).status).toBe('valid');
    expect(travelDocumentCheck(traveller('FR', { idCard: '2026-11-10' }), SCHENGEN)).toEqual({
      status: 'expires_too_soon',
      rule: 'eu_schengen',
      document: 'id_card',
      expiryDate: '2026-11-10',
    });
  });

  it('drops the 6-month passport rule for EU citizens on all-Schengen itineraries', () => {
    const twoMonths = traveller('IT', { passport: '2027-01-11' });
    expect(travelDocumentCheck(twoMonths, SCHENGEN)).toMatchObject({ status: 'valid', document: 'passport' });
    // Same guest outside Schengen, and a non-EU guest on the same sailing, still need 6 months.
    expect(travelDocumentCheck(twoMonths, CARIBBEAN)).toMatchObject({ status: 'expires_too_soon', rule: 'passport_6_months' });
    expect(travelDocumentCheck(traveller('US', { passport: '2027-01-11' }), SCHENGEN)).toMatchObject({ status: 'expires_too_soon' });
    expect(travelDocumentCheck(traveller('US', { passport: '2027-05-11' }), SCHENGEN)).toMatchObject({ status: 'valid' });
  });

  it('uses whichever document still covers the trip, preferring the passport', () => {
    expect(travelDocumentCheck(traveller('ES', { passport: '2026-10-01', idCard: '2031-03-03' }), SCHENGEN)).toMatchObject({ status: 'valid', document: 'id_card' });
    expect(travelDocumentCheck(traveller('ES', { passport: '2029-01-01', idCard: '2031-03-03' }), SCHENGEN)).toMatchObject({ status: 'valid', document: 'passport' });
    // Both lapse before return: report the one that lasts longest.
    expect(travelDocumentCheck(traveller('ES', { passport: '2026-09-01', idCard: '2026-11-08' }), SCHENGEN)).toMatchObject({
      status: 'expires_too_soon',
      document: 'id_card',
      expiryDate: '2026-11-08',
    });
  });

  it('ignores ID cards where the EU rule does not apply', () => {
    expect(travelDocumentCheck(traveller('NL', { idCard: '2031-01-01' }), CARIBBEAN)).toEqual({
      status: 'missing',
      rule: 'passport_6_months',
      document: null,
      expiryDate: null,
    });
    expect(travelDocumentCheck(traveller('NL', {}), SCHENGEN)).toMatchObject({ status: 'missing', rule: 'eu_schengen' });
  });
});

describe('travelDocumentMessage', () => {
  it('words each case for the rule that applies', () => {
    const msg = (p: Passenger, s: Sailing) => travelDocumentMessage(p, s, 'BK-000001', travelDocumentCheck(p, s));
    expect(msg(traveller('DE', { idCard: '2030-01-01' }), SCHENGEN)).toBeNull();
    expect(msg(traveller('DE', {}), SCHENGEN)).toBe(
      'No passport or national ID card on file for Test Guest (BK-000001). As an EU citizen on an all-Schengen itinerary, either is accepted.',
    );
    expect(msg(traveller('DE', { idCard: '2026-11-10' }), SCHENGEN)).toBe(
      'National ID card for Test Guest (BK-000001) expires 2026-11-10, before the 2026-11-11 return. ' +
        'EU citizens on an all-Schengen itinerary need a passport or national ID card valid through the trip.',
    );
    expect(msg(traveller('US', {}), SCHENGEN)).toBe('No passport details on file for Test Guest (BK-000001).');
    expect(msg(traveller('US', { passport: '2027-01-11' }), SCHENGEN)).toBe(
      'Passport for Test Guest (BK-000001) expires 2027-01-11, less than 6 months after the 2026-11-11 return.',
    );
  });
});

// Business rules shared by find_issues, get_booking and the dashboard.
import { describe, expect, it } from 'vitest';
import type { Excursion, ExcursionBookingStatus, Passenger } from '../src/data/types.js';
import { accessibilityConflictMessage, mobilityConflict } from '../src/lib/domain.js';

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

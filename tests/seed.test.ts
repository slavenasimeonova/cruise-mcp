import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateDataset, serializeDataset } from '../scripts/generate.js';
import { DEFAULT_DATA_FILE } from '../src/data/store.js';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const dataset = generateDataset();

describe('seed data', () => {
  it('is deterministic across runs', () => {
    expect(sha(serializeDataset(generateDataset()))).toBe(sha(serializeDataset(dataset)));
  });

  it('matches the committed data/cruise.json (run "npm run seed" if this fails)', () => {
    expect(sha(readFileSync(DEFAULT_DATA_FILE, 'utf8'))).toBe(sha(serializeDataset(dataset)));
  });

  it('has the expected fleet and schedule', () => {
    expect(dataset.ships.map((s) => s.name)).toEqual(['Coral Vista', 'Northern Pearl', 'Solenne', 'Sea Lyra']);
    expect(dataset.sailings).toHaveLength(24);
    expect(new Set(dataset.sailings.map((s) => s.region))).toEqual(new Set(['Caribbean', 'Mediterranean', 'Greek Isles']));
    const first = dataset.sailings[0]!.departureDate;
    const last = dataset.sailings.at(-1)!.departureDate;
    expect(first > dataset.meta.asOf).toBe(true);
    expect(last.slice(0, 7)).toBe('2027-04');
  });

  it('has several thousand passengers and every booking status', () => {
    expect(dataset.passengers.length).toBeGreaterThan(4000);
    expect(new Set(dataset.bookings.map((b) => b.status))).toEqual(new Set(['confirmed', 'pending_payment', 'cancelled', 'waitlisted']));
    expect(new Set(dataset.passengers.map((p) => p.loyaltyTier))).toEqual(new Set(['Blue', 'Silver', 'Gold', 'Platinum']));
  });

  it('has unique IDs and consistent references', () => {
    for (const list of [dataset.sailings, dataset.bookings, dataset.passengers, dataset.excursions, dataset.excursionBookings]) {
      expect(new Set(list.map((x) => x.id)).size).toBe(list.length);
    }
    const bookingIds = new Set(dataset.bookings.map((b) => b.id));
    const passengerIds = new Set(dataset.passengers.map((p) => p.id));
    const excursionIds = new Set(dataset.excursions.map((e) => e.id));
    for (const b of dataset.bookings) for (const p of b.passengerIds) expect(passengerIds.has(p)).toBe(true);
    for (const x of dataset.excursionBookings) {
      expect(bookingIds.has(x.bookingId)).toBe(true);
      expect(excursionIds.has(x.excursionId)).toBe(true);
    }
  });

  it('never assigns the same cabin twice on a sailing', () => {
    for (const s of dataset.sailings) {
      const cabins = dataset.bookings.filter((b) => b.sailingId === s.id && b.cabinNumber !== null).map((b) => b.cabinNumber);
      expect(new Set(cabins).size).toBe(cabins.length);
    }
  });

  it('only contains dates up to the as-of date for things that already happened', () => {
    for (const b of dataset.bookings) {
      expect(b.bookedOn <= dataset.meta.asOf).toBe(true);
      if (b.cancelledOn) expect(b.cancelledOn <= dataset.meta.asOf).toBe(true);
    }
    for (const x of dataset.excursionBookings) expect(x.requestedOn <= dataset.meta.asOf).toBe(true);
  });

  it('plants the problems the tools are meant to find', () => {
    expect(dataset.passengers.some((p) => p.passport.status === 'missing')).toBe(true);
    expect(dataset.excursions.some((e) => e.capacity < e.originalCapacity)).toBe(true);
    expect(dataset.excursionBookings.some((x) => x.status === 'requested')).toBe(true);
    expect(dataset.excursionBookings.some((x) => x.status === 'waitlisted')).toBe(true);
    expect(dataset.passengers.some((p) => p.specialRequests.some((r) => r.type === 'celebration'))).toBe(true);
    expect(dataset.passengers.some((p) => p.specialRequests.some((r) => r.mobilityNeed === 'wheelchair'))).toBe(true);
  });
});

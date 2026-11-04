// Dashboard logic and the published-data safety check. Runs in Node; no browser needed.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA_FILE } from '../src/data/load.js';
import { storeFromJson } from '../src/data/store.js';
import type { Dataset } from '../src/data/types.js';
import { findIssues } from '../src/tools/findIssues.js';
import { assertNoRawPassportNumbers, toPublicDataset } from '../web/scripts/publicData.js';
import { escapeHtml, html } from '../web/src/html.js';
import { groupIssues, lookupBooking, normalizeBookingId, overviewRows, timeWeight } from '../web/src/model.js';
import { NEXT_SAILING, store } from './helpers.js';

describe('published dataset', () => {
  const original = JSON.parse(readFileSync(DEFAULT_DATA_FILE, 'utf8')) as Dataset;
  const published = toPublicDataset(original);
  const json = JSON.stringify(published);

  it('contains no raw passport numbers', () => {
    expect(() => assertNoRawPassportNumbers(original, json)).not.toThrow();
    expect(published.passengers.every((p) => p.passport.number === null || /^\*+[A-Z0-9]{3}$/.test(p.passport.number))).toBe(true);
  });

  it('refuses to publish when a raw number slips through', () => {
    expect(() => assertNoRawPassportNumbers(original, JSON.stringify(original))).toThrow(/Refusing to publish/);
  });

  it('keeps every tool answer identical (masking does not change any result)', () => {
    const publicStore = storeFromJson(published, 'published');
    for (const s of store.sailings) {
      expect(findIssues.run(publicStore, { sailing_id: s.id })).toEqual(findIssues.run(store, { sailing_id: s.id }));
    }
    expect(lookupBooking(publicStore, 'BK-100054')).toEqual(lookupBooking(store, 'BK-100054'));
  });
});

describe('overview', () => {
  const rows = overviewRows(store);

  it('lists every sailing with the same issue totals as find_issues', () => {
    expect(rows).toHaveLength(24);
    for (const r of rows) {
      const { totals } = findIssues.run(store, { sailing_id: r.sailing.sailingId });
      expect(r.issues.total).toBe(totals.issues);
      expect(r.issues.high).toBe(totals.high);
    }
  });

  it('sorts by urgency, and puts the next departures with high-severity issues first', () => {
    const scores = rows.map((r) => r.urgency);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(rows.slice(0, 4).every((r) => r.sailing.daysToDeparture <= 14)).toBe(true);
  });

  it('counts each overbooked excursion as one issue', () => {
    const np = rows.find((r) => r.sailing.sailingId === 'AH-NP-261104')!;
    const { totals } = findIssues.run(store, { sailing_id: 'AH-NP-261104' });
    expect(np.overbookedExcursions).toBe(1);
    expect(np.issues.total).toBe(totals.issues);
    expect(np.issues.total).toBe(60 - totals.bookingsOnOverbookedExcursions + 1);
  });

  it('can sort by departure date instead', () => {
    const dates = overviewRows(store, 'departure').map((r) => r.sailing.departureDate);
    expect(dates).toEqual([...dates].sort());
  });

  it('weights time to departure in steps', () => {
    expect([timeWeight(3), timeWeight(14), timeWeight(15), timeWeight(30), timeWeight(31)]).toEqual([1, 1, 0.5, 0.5, 0.2]);
  });
});

describe('issue grouping', () => {
  const { issues } = findIssues.run(store, { sailing_id: NEXT_SAILING.id });

  it('groups by type without losing issues', () => {
    const groups = groupIssues(issues);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(issues.length);
    expect(new Set(groups.map((g) => g.type)).size).toBe(groups.length);
    expect(groups[0]!.counts.high).toBeGreaterThan(0);
  });

  it('filters by severity', () => {
    const groups = groupIssues(issues, ['high']);
    expect(groups.every((g) => g.items.every((i) => i.severity === 'high'))).toBe(true);
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(issues.filter((i) => i.severity === 'high').length);
  });
});

describe('booking lookup', () => {
  it('normalizes booking references', () => {
    expect(normalizeBookingId('BK-100054')).toBe('BK-100054');
    expect(normalizeBookingId(' bk100054 ')).toBe('BK-100054');
    expect(normalizeBookingId('bk-100054')).toBe('BK-100054');
    expect(normalizeBookingId('100054')).toBe('BK-100054');
    expect(normalizeBookingId('BK-1000')).toBeNull();
    expect(normalizeBookingId('<script>')).toBeNull();
  });

  it('collects every issue for BK-100054 in one list', () => {
    const r = lookupBooking(store, 'bk100054');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.booking.booking.bookingId).toBe('BK-100054');
    expect(r.issues.map((i) => i.type).sort()).toEqual([
      'accessibility_conflict',
      'accessibility_conflict',
      'overbooked_excursion',
      'passport_expiry',
      'unconfirmed_excursion',
    ]);
    expect(r.issues[0]!.severity).toBe('high');
    // The booking page keeps the per-booking wording, identical to get_booking's flag.
    const overbooked = r.issues.find((i) => i.type === 'overbooked_excursion')!;
    expect(overbooked.message).toMatch(/^2 guest\(s\) on BK-100054 are confirmed on Aix-en-Provence Half Day/);
    expect(r.booking.flags).toContain(overbooked.message);
    expect(r.booking.guests.every((g) => g.passport.numberMasked === null || g.passport.numberMasked.startsWith('*'))).toBe(true);
  });

  it('adds waitlisted excursions and does not duplicate unconfirmed ones', () => {
    const r = lookupBooking(store, 'BK-100226');
    if (!r.ok) throw new Error(r.error);
    expect(r.issues.filter((i) => i.type === 'waitlisted_excursion')).toHaveLength(2);
    const unconfirmed = r.issues.filter((i) => i.type === 'unconfirmed_excursion');
    expect(unconfirmed).toHaveLength(1);
  });

  it('explains cancelled bookings instead of listing issues', () => {
    const cancelled = store.bookingsForSailing(NEXT_SAILING.id).find((b) => b.status === 'cancelled')!;
    const r = lookupBooking(store, cancelled.id);
    if (!r.ok) throw new Error(r.error);
    expect(r.issues.map((i) => i.type)).toEqual(['booking_status']);
  });

  it('returns readable errors', () => {
    const bad = lookupBooking(store, 'hello');
    expect(bad).toEqual({ ok: false, error: '"hello" is not a booking reference. Use the format BK-100054.' });
    const missing = lookupBooking(store, 'BK-999999');
    expect(missing.ok).toBe(false);
  });
});

describe('html escaping', () => {
  it('escapes interpolated values but not nested templates', () => {
    const name = '<img src=x onerror=alert(1)>';
    expect(html`<p>${name}</p>`.value).toBe('<p>&lt;img src=x onerror=alert(1)&gt;</p>');
    expect(html`<ul>${['a', 'b'].map((x) => html`<li>${x}</li>`)}</ul>`.value).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(escapeHtml(`"'&`)).toBe('&quot;&#39;&amp;');
  });
});

// View models for the dashboard. Everything is computed by calling the MCP server's own
// tool functions (src/tools/*), so the dashboard shows exactly what Claude gets over MCP.
// No DOM access here, so this module is unit-tested in Node.
import type * as z from 'zod/v4';
import type { CruiseStore } from '../../src/data/store.js';
import { excursionLoad, overbookedExcursionMessage } from '../../src/lib/domain.js';
import { ToolInputError } from '../../src/lib/errors.js';
import { excursionAvailability } from '../../src/tools/excursionAvailability.js';
import { findIssues } from '../../src/tools/findIssues.js';
import { findUnconfirmedExcursions } from '../../src/tools/findUnconfirmedExcursions.js';
import { getBooking } from '../../src/tools/getBooking.js';
import { listSailings } from '../../src/tools/listSailings.js';
import { passengerSummary } from '../../src/tools/passengerSummary.js';

export type SailingRow = z.output<typeof listSailings.outputSchema>['sailings'][number];
export type IssuesOutput = z.output<typeof findIssues.outputSchema>;
export type Issue = IssuesOutput['issues'][number];
export type IssueType = Issue['type'];
export type Severity = Issue['severity'];
export type PassengerSummary = z.output<typeof passengerSummary.outputSchema>;
export type Availability = z.output<typeof excursionAvailability.outputSchema>;
export type BookingOutput = z.output<typeof getBooking.outputSchema>;

export const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];

export const ISSUE_LABELS: Record<IssueType | BookingNoteType, string> = {
  overbooked_excursion: 'Overbooked excursions',
  missing_travel_document: 'Missing travel documents',
  travel_document_expiry: 'Travel documents expiring too soon',
  overdue_payment: 'Overdue payments',
  unconfirmed_excursion: 'Excursions awaiting operator',
  accessibility_conflict: 'Accessibility conflicts',
  pending_payment: 'Pending payments',
  waitlisted_excursion: 'Waitlisted excursions',
  booking_status: 'Booking status',
};

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

const SEVERITY_WEIGHT: Record<Severity, number> = { high: 3, medium: 1, low: 0.25 };

/** Issues on sailings that leave sooner count for more. */
export function timeWeight(daysToDeparture: number): number {
  return daysToDeparture <= 14 ? 1 : daysToDeparture <= 30 ? 0.5 : 0.2;
}

export interface OverviewRow {
  sailing: SailingRow;
  issues: { total: number; high: number; medium: number; low: number };
  overbookedExcursions: number;
  urgency: number;
}

export type OverviewSort = 'urgency' | 'departure';

export function overviewRows(store: CruiseStore, sort: OverviewSort = 'urgency'): OverviewRow[] {
  const rows = listSailings.run(store, {}).sailings.map((sailing) => {
    const { totals } = findIssues.run(store, { sailing_id: sailing.sailingId });
    const weighted = totals.high * SEVERITY_WEIGHT.high + totals.medium * SEVERITY_WEIGHT.medium + totals.low * SEVERITY_WEIGHT.low;
    return {
      sailing,
      issues: { total: totals.issues, high: totals.high, medium: totals.medium, low: totals.low },
      overbookedExcursions: totals.overbookedExcursions,
      urgency: Math.round(weighted * timeWeight(sailing.daysToDeparture) * 10) / 10,
    };
  });
  if (sort === 'urgency') {
    rows.sort((a, b) => b.urgency - a.urgency || a.sailing.departureDate.localeCompare(b.sailing.departureDate));
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Sailing detail
// ---------------------------------------------------------------------------

export interface IssueGroup {
  type: IssueType;
  label: string;
  counts: Record<Severity, number>;
  items: Issue[];
}

/** Groups issues by type, most severe groups first. Items keep find_issues' severity order. */
export function groupIssues(issues: readonly Issue[], severities: readonly Severity[] = SEVERITIES): IssueGroup[] {
  const groups = new Map<IssueType, IssueGroup>();
  for (const issue of issues) {
    if (!severities.includes(issue.severity)) continue;
    let group = groups.get(issue.type);
    if (!group) {
      group = { type: issue.type, label: ISSUE_LABELS[issue.type], counts: { high: 0, medium: 0, low: 0 }, items: [] };
      groups.set(issue.type, group);
    }
    group.counts[issue.severity] += 1;
    group.items.push(issue);
  }
  return [...groups.values()].sort(
    (a, b) => b.counts.high - a.counts.high || b.counts.medium - a.counts.medium || b.items.length - a.items.length || a.label.localeCompare(b.label),
  );
}

export interface SailingDetail {
  summary: PassengerSummary;
  issues: IssuesOutput;
  ports: Availability[];
  unconfirmedRequests: number;
}

export function sailingDetail(store: CruiseStore, sailingId: string): SailingDetail | null {
  const sailing = store.sailing(sailingId);
  if (!sailing) return null;
  const ports = sailing.itinerary
    .filter((d) => d.kind === 'port' && d.port !== null)
    .map((d) => excursionAvailability.run(store, { sailing_id: sailing.id, port: d.port! }));
  return {
    summary: passengerSummary.run(store, { sailing_id: sailing.id }),
    issues: findIssues.run(store, { sailing_id: sailing.id }),
    ports,
    unconfirmedRequests: findUnconfirmedExcursions.run(store, { sailing_id: sailing.id }).totals.requests,
  };
}

// ---------------------------------------------------------------------------
// Booking lookup
// ---------------------------------------------------------------------------

/** Accepts "BK-100054", "bk100054", " 100054 " and returns the canonical ID, or null. */
export function normalizeBookingId(input: string): string | null {
  const m = /^\s*(?:bk)?[\s-]*(\d{6})\s*$/i.exec(input);
  return m ? `BK-${m[1]}` : null;
}

export type BookingNoteType = 'waitlisted_excursion' | 'booking_status';

export interface BookingIssue {
  severity: Severity;
  type: IssueType | BookingNoteType;
  message: string;
}

export type BookingLookup = { ok: true; booking: BookingOutput; issues: BookingIssue[] } | { ok: false; error: string };

/**
 * Everything that needs attention for one booking: the find_issues entries for it
 * (with severities), plus booking-level notes find_issues does not cover
 * (waitlisted excursions, later unconfirmed requests, cancelled or waitlisted bookings).
 */
export function lookupBooking(store: CruiseStore, input: string): BookingLookup {
  const id = normalizeBookingId(input);
  if (!id) return { ok: false, error: `"${input.trim()}" is not a booking reference. Use the format BK-100054.` };

  let booking: BookingOutput;
  try {
    booking = getBooking.run(store, { booking_id: id });
  } catch (err) {
    if (err instanceof ToolInputError) return { ok: false, error: err.message };
    throw err;
  }

  const own = findIssues
    .run(store, { sailing_id: booking.sailing.sailingId })
    .issues.filter((i) => i.bookingId === id || i.affectedBookings?.some((b) => b.bookingId === id));
  const reportedExcursions = new Set(own.filter((i) => i.type === 'unconfirmed_excursion').map((i) => i.excursionId));
  const issues: BookingIssue[] = own.map(({ severity, type, message, excursionId, affectedBookings }) => {
    if (type !== 'overbooked_excursion') return { severity, type, message };
    // Sailing views count the excursion once; a booking page shows this booking's share, worded as get_booking flags it.
    const ex = store.excursion(excursionId!)!;
    const guests = affectedBookings!.find((b) => b.bookingId === id)!.guests;
    return { severity, type, message: overbookedExcursionMessage(ex, excursionLoad(store, ex), id, guests) };
  });

  const status = booking.booking.status;
  if (status === 'cancelled') {
    issues.push({
      severity: 'low',
      type: 'booking_status',
      message: `Cancelled on ${booking.booking.cancelledOn} (${booking.booking.cancellationReason}). No action needed for this sailing.`,
    });
  } else if (status === 'waitlisted') {
    issues.push({
      severity: 'medium',
      type: 'booking_status',
      message: `On the ${booking.booking.cabinCategory} waitlist at position ${booking.booking.waitlistPosition}; no cabin is held yet.`,
    });
  }

  for (const ex of booking.excursions) {
    if (ex.status === 'waitlisted') {
      issues.push({
        severity: 'low',
        type: 'waitlisted_excursion',
        message: `${ex.name} (${ex.port}, ${ex.date}) is full; ${ex.guests.length} guest(s) waitlisted at position ${ex.waitlistPosition}.`,
      });
    } else if (ex.status === 'requested' && !reportedExcursions.has(ex.excursionId)) {
      issues.push({
        severity: 'low',
        type: 'unconfirmed_excursion',
        message: `${ex.name} (${ex.port}, ${ex.date}) is awaiting operator confirmation.`,
      });
    }
  }

  const rank: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  issues.sort((a, b) => rank[a.severity] - rank[b.severity]);
  return { ok: true, booking, issues };
}

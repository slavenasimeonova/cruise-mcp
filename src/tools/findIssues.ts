import * as z from 'zod/v4';
import type { Excursion } from '../data/types.js';
import { daysBetween } from '../lib/dates.js';
import {
  accessibilityConflictMessage,
  excursionLoad,
  type ExcursionLoad,
  fullName,
  isActive,
  isPaymentOverdue,
  mobilityConflict,
  overbookedExcursionMessage,
  passportCheck,
  requireSailing,
  round2,
  SOON_DAYS,
  URGENT_DAYS,
} from '../lib/domain.js';
import { defineTool, sailingIdInput, sailingRef, sailingRefOutput } from './shared.js';

const ISSUE_TYPES = [
  'overbooked_excursion',
  'missing_passport',
  'passport_expiry',
  'overdue_payment',
  'unconfirmed_excursion',
  'accessibility_conflict',
  'pending_payment',
] as const;
type IssueType = (typeof ISSUE_TYPES)[number];
type Severity = 'high' | 'medium' | 'low';
const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

const issueOutput = z.object({
  severity: z.enum(['high', 'medium', 'low']),
  type: z.enum(ISSUE_TYPES),
  message: z.string(),
  bookingId: z.string().describe('Every issue belongs to one booking.'),
  passengerId: z.string().nullable(),
  excursionId: z.string().nullable(),
});
type Issue = z.output<typeof issueOutput>;

const count = z.number().int();

export const findIssues = defineTool({
  name: 'find_issues',
  title: 'Find operational issues',
  description:
    'Pre-departure issue check for one sailing, ranked by severity, one row per affected booking. Covers bookings with ' +
    'guests confirmed on overbooked excursions, missing passports, passports expiring less than 6 months after return, ' +
    'overdue and pending payments, excursion requests still awaiting operator confirmation within 30 days, and guests ' +
    'whose mobility needs conflict with an excursion they are confirmed, requested or waitlisted on.',
  inputSchema: z.object({ sailing_id: sailingIdInput }),
  outputSchema: z.object({
    asOf: z.string(),
    sailing: sailingRefOutput,
    totals: z.object({
      issues: count,
      high: count,
      medium: count,
      low: count,
      byType: z.object(Object.fromEntries(ISSUE_TYPES.map((t) => [t, count])) as Record<IssueType, typeof count>),
      overbookedExcursions: count.describe('Distinct excursions with more confirmed guests than seats.'),
    }),
    issues: z.array(issueOutput),
    summary: z.string(),
  }),
  run(store, input) {
    const sailing = requireSailing(store, input.sailing_id);
    const daysOut = daysBetween(store.asOf, sailing.departureDate);
    const issues: Issue[] = [];
    const add = (issue: Omit<Issue, 'passengerId' | 'excursionId'> & Partial<Issue>) =>
      issues.push({ passengerId: null, excursionId: null, ...issue });

    const overbooked = new Map<string, { excursion: Excursion; load: ExcursionLoad }>();
    for (const ex of store.excursionsForSailing(sailing.id)) {
      const load = excursionLoad(store, ex);
      if (load.confirmedGuests > ex.capacity) overbooked.set(ex.id, { excursion: ex, load });
    }

    for (const booking of store.bookingsForSailing(sailing.id)) {
      if (!isActive(booking)) continue;
      const passengers = store.passengersFor(booking.passengerIds);
      const byId = new Map(passengers.map((p) => [p.id, p]));

      for (const p of passengers) {
        const check = passportCheck(p, sailing);
        if (check === 'missing') {
          add({
            severity: daysOut <= SOON_DAYS ? 'high' : 'medium',
            type: 'missing_passport',
            bookingId: booking.id,
            passengerId: p.id,
            message: `No passport details on file for ${fullName(p)} (${booking.id}).`,
          });
        } else if (check === 'expires_too_soon') {
          const expiresBeforeReturn = (p.passport.expiryDate ?? '') <= sailing.returnDate;
          add({
            severity: expiresBeforeReturn || daysOut <= SOON_DAYS ? 'high' : 'medium',
            type: 'passport_expiry',
            bookingId: booking.id,
            passengerId: p.id,
            message: `Passport for ${fullName(p)} (${booking.id}) expires ${p.passport.expiryDate}, less than 6 months after the ${sailing.returnDate} return.`,
          });
        }
      }

      const balance = round2(booking.totalFare - booking.amountPaid);
      if (isPaymentOverdue(booking, store.asOf)) {
        add({
          severity: 'high',
          type: 'overdue_payment',
          bookingId: booking.id,
          message: `${booking.id} owes ${balance} ${booking.currency}; payment was due ${booking.paymentDueDate}.`,
        });
      } else if (booking.status === 'pending_payment') {
        add({
          severity: 'low',
          type: 'pending_payment',
          bookingId: booking.id,
          message: `${booking.id} has ${balance} ${booking.currency} pending, due ${booking.paymentDueDate}.`,
        });
      }

      for (const xb of store.excursionBookingsForBooking(booking.id)) {
        const ex = store.excursion(xb.excursionId);
        if (!ex) continue;

        const over = overbooked.get(ex.id);
        if (over && xb.status === 'confirmed') {
          add({
            severity: 'high',
            type: 'overbooked_excursion',
            bookingId: booking.id,
            excursionId: ex.id,
            message: overbookedExcursionMessage(ex, over.load, booking.id, xb.passengerIds.length),
          });
        }

        const daysToExcursion = daysBetween(store.asOf, ex.date);
        if (xb.status === 'requested' && daysToExcursion <= SOON_DAYS) {
          add({
            severity: daysToExcursion <= URGENT_DAYS ? 'high' : 'medium',
            type: 'unconfirmed_excursion',
            bookingId: booking.id,
            excursionId: ex.id,
            message: `${ex.name} (${ex.port}, ${ex.date}) for ${xb.passengerIds.length} guest(s) on ${booking.id} is still awaiting operator confirmation, ${daysToExcursion} days out.`,
          });
        }

        // Confirmed, requested and waitlisted all count: any of them can end with the guest on the tour.
        for (const pid of xb.passengerIds) {
          const p = byId.get(pid);
          const conflict = p ? mobilityConflict(p, ex) : null;
          if (p && conflict) {
            add({
              severity: 'medium',
              type: 'accessibility_conflict',
              bookingId: booking.id,
              passengerId: p.id,
              excursionId: ex.id,
              message: accessibilityConflictMessage(p, ex, xb.status, conflict),
            });
          }
        }
      }
    }

    issues.sort(
      (a, b) =>
        SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
        ISSUE_TYPES.indexOf(a.type) - ISSUE_TYPES.indexOf(b.type) ||
        (a.excursionId ?? '').localeCompare(b.excursionId ?? '') ||
        a.bookingId.localeCompare(b.bookingId) ||
        (a.passengerId ?? '').localeCompare(b.passengerId ?? ''),
    );

    const byType = Object.fromEntries(ISSUE_TYPES.map((t) => [t, issues.filter((i) => i.type === t).length])) as Record<IssueType, number>;
    const high = issues.filter((i) => i.severity === 'high').length;
    const medium = issues.filter((i) => i.severity === 'medium').length;
    const breakdown = ISSUE_TYPES.filter((t) => byType[t] > 0)
      .map((t) =>
        t === 'overbooked_excursion'
          ? `${overbooked.size} overbooked excursion(s) affecting ${byType[t]} booking(s)`
          : `${byType[t]} ${t.replaceAll('_', ' ')}`,
      )
      .join(', ');
    const summary =
      issues.length === 0
        ? `No open issues on ${sailing.id}.`
        : `${issues.length} issue(s) on ${sailing.id}, departing in ${daysOut} days: ${high} high, ${medium} medium, ` +
          `${issues.length - high - medium} low (${breakdown}).`;

    return {
      asOf: store.asOf,
      sailing: sailingRef(store, sailing),
      totals: { issues: issues.length, high, medium, low: issues.length - high - medium, byType, overbookedExcursions: overbooked.size },
      issues,
      summary,
    };
  },
});

// Pure UTC calendar-date helpers for ISO "YYYY-MM-DD" strings (no time zones, no wall clock).

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toUtcMs(iso: string): number | null {
  const m = ISO_DATE.exec(iso);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Reject roll-overs such as 2026-02-30.
  return new Date(ms).toISOString().slice(0, 10) === iso ? ms : null;
}

export function isValidIsoDate(iso: string): boolean {
  return toUtcMs(iso) !== null;
}

function mustParse(iso: string): number {
  const ms = toUtcMs(iso);
  if (ms === null) throw new Error(`Invalid ISO date: ${iso}`);
  return ms;
}

export function addDays(iso: string, days: number): string {
  return new Date(mustParse(iso) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (negative if `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((mustParse(to) - mustParse(from)) / MS_PER_DAY);
}

/** Age in whole years on a given date. */
export function ageOn(dateOfBirth: string, on: string): number {
  const [by, bm, bd] = dateOfBirth.split('-').map(Number) as [number, number, number];
  const [y, m, d] = on.split('-').map(Number) as [number, number, number];
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}

export function addMonths(iso: string, months: number): string {
  const ms = mustParse(iso);
  const date = new Date(ms);
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

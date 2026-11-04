const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(iso: string): { y: number; m: number; d: number; dow: number } {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Wed 4 Nov 2026" */
export function longDate(iso: string): string {
  const { y, m, d, dow } = parts(iso);
  return `${DAYS[dow]} ${d} ${MONTHS[m - 1]} ${y}`;
}

/** "4 Nov" */
export function shortDate(iso: string): string {
  const { m, d } = parts(iso);
  return `${d} ${MONTHS[m - 1]}`;
}

export function money(amount: number, currency: string): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
}

export function count(n: number, singular: string, plural = `${singular}s`): string {
  return `${n.toLocaleString('en-GB')} ${n === 1 ? singular : plural}`;
}

export function departsIn(days: number): string {
  if (days < 0) return `departed ${-days} days ago`;
  if (days === 0) return 'departs today';
  if (days === 1) return 'departs tomorrow';
  return `departs in ${days} days`;
}

export function pct(n: number): string {
  return `${Math.round(n)}%`;
}

export function humanize(value: string): string {
  const s = value.replaceAll('_', ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

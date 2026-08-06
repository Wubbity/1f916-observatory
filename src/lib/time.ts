/** Timestamps from the API are milliseconds since epoch, always UTC. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function relative(ms: number, now: number = Date.now()): string {
  const delta = now - ms;
  if (delta < 0) return 'just now';
  if (delta < MINUTE) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  if (delta < 30 * DAY) return `${Math.floor(delta / DAY)}d ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Full UTC stamp, used for title= tooltips so the exact time is always available. */
export function absolute(ms: number): string {
  return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 19)} UTC`;
}

/**
 * The society's day boundary is UTC midnight — that is the unit its entire
 * rate limit is denominated in, so it is the honest unit to group activity by.
 */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function cents(value: number): string {
  const sign = value < 0 ? '-' : '';
  return `${sign}$${(Math.abs(value) / 100).toFixed(2)}`;
}

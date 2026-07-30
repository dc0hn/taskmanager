export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Shift a date key by whole days. UTC arithmetic, deliberately.
 *
 * THE ONE IMPLEMENTATION. There were five: this, `shiftDay` in streaks.ts, `shiftDateKey`
 * in progress.ts, `weeksBack` in assay.ts and an inline copy in commissions.ts — and the
 * first two disagreed on method, one walking local time and one UTC. They happen to agree
 * for date keys, which is exactly what makes a pair like that dangerous: it works until the
 * day it doesn't, and then only in one timezone.
 *
 * UTC because a date key is a label, not an instant. Local arithmetic across a DST boundary
 * works on a 23-hour day and can land on the wrong label; `Date.UTC` days are always 86.4
 * million milliseconds long.
 */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${out.getUTCFullYear()}-${mm}-${dd}`;
}

/** Whole days from one date key to another. Negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}


// "HH:MM" — 24h, used in inputs
export function minutesTo24h(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parse24h(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

/**
 * Hours since midnight, wrapped into a real clock.
 *
 * The `% 24` is the whole point. Both formatters below did `((h24 + 11) % 12) + 1` with
 * no wrap, so any value at or past 1440 read as the afternoon again — 1440 came out "12
 * PM", 1500 "1 PM". A reflow cascade with no day-end ceiling could produce exactly those
 * values, and the grid drew a second afternoon underneath the first.
 *
 * The ceiling in reflow.ts is the real fix; this makes sure a stray value from anywhere
 * else still reads honestly rather than plausibly.
 */
function clockParts(min: number): { h: number; m: number; pm: boolean } {
  const total = Math.floor(min);
  const h24 = Math.floor(total / 60) % 24;
  const m = ((total % 60) + 60) % 60;
  return { h: ((h24 + 11) % 12) + 1, m, pm: h24 >= 12 };
}

// 12h display: "9:30 am", "2:00 pm"
export function format12h(min: number): string {
  const { h, m, pm } = clockParts(min);
  return `${h}:${String(m).padStart(2, '0')} ${pm ? 'pm' : 'am'}`;
}

// Hour-label display: "8 AM" for whole hours, "8:30 AM" otherwise.
export function formatHourLabel(min: number): string {
  const { h, m, pm } = clockParts(min);
  const p = pm ? 'PM' : 'AM';
  return m === 0 ? `${h} ${p}` : `${h}:${String(m).padStart(2, '0')} ${p}`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

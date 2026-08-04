import { addDays, fromDateKey, toDateKey } from './utils/time';

// ============================================================================
// Week keys
//
// A week is identified by the date of its Monday, as a plain 'YYYY-MM-DD' key —
// NOT by an ISO week number. This is a deliberate choice and it removes an
// entire class of bug rather than requiring careful handling of it:
//
//   • ISO weeks straddle years. 2026-01-01 belongs to ISO week 2026-W01, which
//     *starts* on 2025-12-29. So parsing "2026-W01" back to a date requires
//     knowing that its Monday lives in the previous calendar year.
//   • Some years have 53 ISO weeks (2026 does). addWeeks('2026-W52', 1) has to
//     know whether to produce W53 or roll over to 2027-W01, which means
//     carrying a table of long years.
//
// With Monday-date keys, addWeeks is addDays(key, n * 7) using the same date
// arithmetic the rest of the app already relies on, and the year boundary is
// simply 2026-12-28 -> 2027-01-04. Keys also sort lexicographically, which
// rollover depends on to resolve elapsed weeks in order.
//
// The cost: dp:week:2025-12-29 is the week containing New Year's Day 2026,
// which reads slightly oddly in storage. The UI never shows a raw key — it
// shows a date range ("Dec 29 – Jan 4"), which is clearer than a week number
// anyway.
// ============================================================================

export const DAYS_IN_WEEK = 7;

/** Weekday index of a date key. 0 = Sunday … 6 = Saturday. */
export function weekdayOf(dateKey: string): number {
  return fromDateKey(dateKey).getDay();
}

/**
 * The Monday-anchored week key containing `dateKey`.
 * Sunday belongs to the week that began the preceding Monday.
 */
export function toWeekKey(dateKey: string): string {
  const dow = weekdayOf(dateKey); // 0=Sun … 6=Sat
  const backToMonday = dow === 0 ? 6 : dow - 1;
  return addDays(dateKey, -backToMonday);
}

/** The week key containing a Date (defaults to now). */
export function currentWeekKey(now: Date = new Date()): string {
  return toWeekKey(toDateKey(now));
}

/** Shift a week key by whole weeks. Negative goes back. */
export function addWeeks(weekKey: string, n: number): string {
  return addDays(weekKey, n * DAYS_IN_WEEK);
}

/** The seven date keys of a week, Monday first. */
export function weekDates(weekKey: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < DAYS_IN_WEEK; i++) out.push(addDays(weekKey, i));
  return out;
}

/** Inclusive first and last date keys of a week. */
export function weekRange(weekKey: string): { start: string; end: string } {
  return { start: weekKey, end: addDays(weekKey, DAYS_IN_WEEK - 1) };
}

/** True when `dateKey` falls inside `weekKey`. */
export function isInWeek(dateKey: string, weekKey: string): boolean {
  return toWeekKey(dateKey) === weekKey;
}

/** Whole weeks from `a` to `b`. Positive when b is later. */
export function weeksBetween(a: string, b: string): number {
  const ms = fromDateKey(b).getTime() - fromDateKey(a).getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24 * DAYS_IN_WEEK));
}

/**
 * "Dec 29 – Jan 4" / "Jul 27 – Aug 2" / "Mar 2 – 8".
 * The month is repeated only when the week spans two of them.
 */
export function formatWeekRange(weekKey: string): string {
  const { start, end } = weekRange(weekKey);
  const s = fromDateKey(start);
  const e = fromDateKey(end);
  const sMonth = s.toLocaleDateString(undefined, { month: 'short' });
  const eMonth = e.toLocaleDateString(undefined, { month: 'short' });
  if (sMonth === eMonth) {
    return `${sMonth} ${s.getDate()} – ${e.getDate()}`;
  }
  return `${sMonth} ${s.getDate()} – ${eMonth} ${e.getDate()}`;
}

/** "Jul 27 – Aug 2, 2026", with the year appended for headers. */
export function formatWeekRangeLong(weekKey: string): string {
  const { end } = weekRange(weekKey);
  return `${formatWeekRange(weekKey)}, ${fromDateKey(end).getFullYear()}`;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

/** First day of the month containing `dateKey`. */
export function monthStart(dateKey: string): string {
  const d = fromDateKey(dateKey);
  return toDateKey(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Shift by whole months, clamping the day (Jan 31 + 1 month -> Feb 28/29). */
export function addMonths(dateKey: string, n: number): string {
  const d = fromDateKey(dateKey);
  const targetMonth = d.getMonth() + n;
  const firstOfTarget = new Date(d.getFullYear(), targetMonth, 1);
  const daysInTarget = new Date(
    firstOfTarget.getFullYear(),
    firstOfTarget.getMonth() + 1,
    0
  ).getDate();
  return toDateKey(
    new Date(
      firstOfTarget.getFullYear(),
      firstOfTarget.getMonth(),
      Math.min(d.getDate(), daysInTarget)
    )
  );
}

/**
 * The date keys filling a month grid: whole Monday-started weeks covering the
 * month, including the leading and trailing days from adjacent months. Always a
 * multiple of 7 — 35 cells usually, 42 when the month spills.
 */
export function monthGridDates(dateKey: string): string[] {
  const first = monthStart(dateKey);
  const gridStart = toWeekKey(first);
  const d = fromDateKey(first);
  const daysInMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const last = toDateKey(new Date(d.getFullYear(), d.getMonth(), daysInMonth));
  const gridEnd = addDays(toWeekKey(last), DAYS_IN_WEEK - 1);

  const out: string[] = [];
  let cursor = gridStart;
  // Bounded to guard against any date-arithmetic surprise; 6 weeks is the max
  // a Gregorian month can occupy.
  for (let i = 0; i < 6 * DAYS_IN_WEEK; i++) {
    out.push(cursor);
    if (cursor === gridEnd) break;
    cursor = addDays(cursor, 1);
  }
  return out;
}

/** True when the two keys share a calendar month and year. */
export function isSameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/**
 * The weekday's name — "Monday", "Mon", "M".
 *
 * Kept next to `weekdayOf` deliberately. There were two private copies of this, one
 * of them also called `weekdayOf` but returning a string rather than an index, which
 * is the kind of collision that reads fine in both files and wrong across them.
 */
export function weekdayLabel(
  dateKey: string,
  width: 'long' | 'short' | 'narrow' = 'long'
): string {
  return fromDateKey(dateKey).toLocaleDateString(undefined, { weekday: width });
}

/** "July 2026" */
export function formatMonthLong(dateKey: string): string {
  return fromDateKey(dateKey).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

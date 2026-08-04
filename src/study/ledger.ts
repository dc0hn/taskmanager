// ============================================================================
// The Observation Ledger
//
// Almanac's event stream: what happened, when, in order. This is the micromotion film
// the study is built on, and before this existed there was none — the app recorded
// `completedAt` and a `moves` COUNT, which cannot tell you when a task was created,
// how many times it was moved before it died, or how often the calendar was opened
// without anything being changed.
//
// THREE RULES.
//
//   IT IS APPEND-ONLY AND NEVER REWRITTEN. An event is a fact about a moment. Editing
//   one retroactively is how a record stops being evidence — the same reason a week's
//   outcome is sealed rather than recomputed.
//
//   IT RECORDS MOTION, NOT JUDGEMENT. Nothing here is scored, weighted, or classified
//   as waste at write time. Classification is a reading of the record and belongs in
//   the analysis, where it can be argued with and revised. A ledger that decided what
//   counted as waste while writing could never be re-read against a better theory.
//
//   IT COMPACTS RATHER THAN GROWS. Raw events are kept for a fortnight, digested to one
//   row per day, and the raw discarded. Measured: a year uncompacted is 2.3–15 MB
//   depending on encoding, against a WebKit localStorage quota near 5 MB. Compacted it
//   is ~144 KB and stops growing. See `digest.ts`.
//
// The compaction is LOSSY ON PURPOSE, and the trade is worth stating: past the raw
// window you keep the measurements of a day but not the frame-by-frame film of it.
// Micromotion work happens on recent representative days; everything older feeds
// trends. Nothing the method actually uses is lost.
// ============================================================================

import { daysBetween } from '../utils/time';

/**
 * What the app can observe about itself.
 *
 * Deliberately a closed list. An open one invites recording whatever is convenient at
 * the call site, and a ledger whose vocabulary drifts cannot be compared across time —
 * which is the only thing a longitudinal study does.
 */
export type EventKind =
  // --- attention: the app being consulted at all ---
  | 'app.open'
  | 'view.switch'
  | 'day.nav'
  // --- the tool crib: intentions entering and leaving the queue ---
  | 'task.add'
  | 'task.remove'
  | 'task.edit'
  // --- the workpiece: a block's life ---
  | 'block.create'
  | 'block.edit'
  | 'block.move'
  | 'block.resize'
  | 'block.done'
  | 'block.undone'
  | 'block.delete'
  // --- wholesale operations on a day ---
  | 'day.build'
  | 'day.replan'
  | 'day.clear';

/**
 * Storage codes. NEVER REORDER OR REUSE.
 *
 * The number is what is written to disk, so changing what a code means silently
 * rewrites history — every event ever recorded under code 7 would become whatever 7
 * now stands for. Add new kinds at the end; retire a kind by leaving its code unused.
 */
const CODES: EventKind[] = [
  'app.open',
  'view.switch',
  'day.nav',
  'task.add',
  'task.remove',
  'task.edit',
  'block.create',
  'block.edit',
  'block.move',
  'block.resize',
  'block.done',
  'block.undone',
  'block.delete',
  'day.build',
  'day.replan',
  'day.clear',
];

const CODE_OF = new Map<EventKind, number>(CODES.map((k, i) => [k, i]));

export interface StudyEvent {
  /** Epoch SECONDS. Milliseconds cost three bytes an event and buy nothing here. */
  at: number;
  kind: EventKind;
  /** The date the event is about — usually the day being edited, not the day it is. */
  date: string;
  /** Block or task id, or the view name for `view.switch`. Empty when not applicable. */
  ref: string;
  /**
   * Two free numbers whose meaning depends on the kind. Documented per kind rather
   * than named, because naming them forces every event to carry both.
   *
   *   block.move    a = minutes moved (signed), b = days moved (signed)
   *   block.resize  a = minutes before,         b = minutes after
   *   block.done    a = minutes since midnight ticked, b = block length
   *   day.build     a = blocks placed,          b = tasks left over
   *   day.clear     a = blocks returned,        b = pinned kept
   *   everything else: both zero
   */
  a: number;
  b: number;
}

/** A date key as a sortable integer, so it costs 8 bytes rather than 12. */
function packDate(date: string): number {
  return Number(date.replace(/-/g, '')) || 0;
}

function unpackDate(n: number): string {
  if (!n) return '';
  const s = String(n).padStart(8, '0');
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * One event as a positional tuple, with trailing zeros dropped.
 *
 * Positional rather than keyed because the keys are most of the cost: measured at 75
 * bytes an event with short keys against 30 as a tuple, which over a fortnight of full
 * logging is the difference between 278 KB and 111 KB. The codec is the price of that,
 * and it is tested rather than trusted.
 */
export function encodeEvent(e: StudyEvent): (number | string)[] {
  // Date BEFORE ref, deliberately. Nearly every event carries a date and most carry no
  // ref, so this order lets the trim below actually fire — an app.open becomes three
  // fields rather than four. Reordering is a storage-format change: see CODES.
  const row: (number | string)[] = [
    e.at,
    CODE_OF.get(e.kind) ?? -1,
    packDate(e.date),
    e.ref,
    e.a,
    e.b,
  ];
  while (row.length > 2 && (row[row.length - 1] === 0 || row[row.length - 1] === '')) {
    row.pop();
  }
  return row;
}

/** The inverse. Returns null for anything it cannot read, rather than a partial event. */
export function decodeEvent(row: unknown): StudyEvent | null {
  if (!Array.isArray(row) || row.length < 2) return null;
  const at = row[0];
  const code = row[1];
  if (typeof at !== 'number' || !Number.isFinite(at) || at <= 0) return null;
  if (typeof code !== 'number' || !CODES[code]) return null;

  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;

  return {
    at: Math.floor(at),
    kind: CODES[code],
    date: unpackDate(num(row[2])),
    ref: typeof row[3] === 'string' ? row[3] : '',
    a: num(row[4]),
    b: num(row[5]),
  };
}

/** How long raw events are kept before they are digested and discarded. */
export const RAW_WINDOW_DAYS = 14;

/**
 * Append an event, keeping the list in time order.
 *
 * Ordered by insertion rather than sorted, because events arrive in real time and a
 * sort on every append is quadratic over a fortnight. The one case that breaks order
 * is a clock moving backwards, which is rare enough to accept and harmless enough to
 * ignore: the digest reads by date, not by position.
 */
export function append(events: StudyEvent[], event: StudyEvent): StudyEvent[] {
  return [...events, event];
}

/**
 * Drop raw events older than the window.
 *
 * Bounded by DATE rather than by count, for the same reason `pruneBoostedDates` is: a
 * count cap drops the oldest events on a busy day and keeps a quiet week entire, so
 * the window silently narrows exactly when there is most to see. Callers must digest a
 * day before trimming it — see `digest.ts`, which is what makes this safe.
 */
export function trimRaw(
  events: StudyEvent[],
  today: string,
  windowDays = RAW_WINDOW_DAYS
): StudyEvent[] {
  // `daysBetween` rather than comparing packed dates: packed dates sort correctly but
  // do not subtract — 20260301 minus 14 is not the 15th of February. It is also THE
  // date arithmetic in this codebase, and a second one here is exactly the pair that
  // agrees until the day it does not.
  return events.filter((e) => {
    if (!e.date) return false;
    const age = daysBetween(e.date, today);
    return age >= 0 && age < windowDays;
  });
}

/** Every distinct date the raw log holds, ascending. */
export function datesIn(events: StudyEvent[]): string[] {
  return [...new Set(events.map((e) => e.date))].filter(Boolean).sort();
}

/** Events for one date, in time order. */
export function eventsOn(events: StudyEvent[], date: string): StudyEvent[] {
  return events.filter((e) => e.date === date).sort((x, y) => x.at - y.at);
}

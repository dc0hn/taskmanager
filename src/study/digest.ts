import type { Block, DailyStat } from '../types';
import { daysBetween } from '../utils/time';
import type { StudyEvent } from './ledger';
import { eventsOn } from './ledger';

// ============================================================================
// The daily digest — what survives when the film is thrown away
//
// One row per day, holding the measurements the metric battery needs. Written ONCE,
// when the day is over, from the raw events plus the day's plan and stat. After that
// the raw events for that day are discarded and the digest is never recomputed.
//
// This is the same sealing rule the week outcome follows, for the same reason: a
// figure recomputed later is a figure that changes when the code changes, and a
// longitudinal study whose history moves underneath it is measuring its own edits.
//
// STORED, NOT DERIVED — but only for days that are FINISHED. Today is always computed
// live, because it is still happening.
// ============================================================================

/**
 * A finished day, measured.
 *
 * Fields are deliberately raw counts and minutes rather than ratios. A ratio computed
 * at digest time freezes a definition into history — change how the deep-work ratio is
 * calculated and every past day would still hold the old one, with nothing to say so.
 * Ratios are computed at read time from these, so a revised definition applies to the
 * whole record at once.
 */
export interface DayDigest {
  date: string;

  // --- what was planned, and what became of it ---
  blocksPlanned: number;
  blocksDone: number;
  minutesPlanned: number;
  minutesDone: number;

  // --- churn ---
  creates: number;
  moves: number;
  resizes: number;
  deletes: number;
  builds: number;
  clears: number;

  // --- attention: the app being consulted ---
  opens: number;
  viewSwitches: number;
  dayNavigations: number;

  // --- shape of the day as planned ---
  /** Longest single planned block, minutes. */
  longestBlock: number;
  /** Planned minutes in blocks of 60 or more. */
  deepMinutes: number;
  /** Planned minutes in focus-kind categories. */
  focusMinutes: number;
  /** Distinct categories with at least one block — a crude switching proxy. */
  contexts: number;

  // --- timing, where it is observed rather than inferred ---
  /**
   * Median lateness of completion against the end of the booked slot, minutes.
   * Positive is late. Null when nothing was ticked with a timestamp.
   *
   * NOT a measure of how long work took. Almanac records when a block was TICKED, not
   * when it was started or finished. This is lateness against a slot and nothing more.
   */
  tickDrift: number | null;
  /** Earliest and latest completion, minutes since midnight. Null when none. */
  firstTick: number | null;
  lastTick: number | null;
}

export function emptyDigest(date: string): DayDigest {
  return {
    date,
    blocksPlanned: 0,
    blocksDone: 0,
    minutesPlanned: 0,
    minutesDone: 0,
    creates: 0,
    moves: 0,
    resizes: 0,
    deletes: 0,
    builds: 0,
    clears: 0,
    opens: 0,
    viewSwitches: 0,
    dayNavigations: 0,
    longestBlock: 0,
    deepMinutes: 0,
    focusMinutes: 0,
    contexts: 0,
    tickDrift: null,
    firstTick: null,
    lastTick: null,
  };
}

/** A block long enough to count as uninterrupted work. */
export const DEEP_BLOCK_MIN = 60;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Measure one day.
 *
 * Takes the day's blocks as they finally stood, its stat if one exists, and the raw
 * events for it. All three are needed and none is sufficient: the blocks say what the
 * day looked like, the events say what was done TO it, and the stat is the scoring
 * layer's own figure — kept separate so the study never silently disagrees with the
 * app about how much was done.
 *
 * `focusOf` is injected rather than imported so this stays pure and testable, and so a
 * category renamed or re-kinded does not change what a sealed digest meant.
 */
export function buildDigest(
  date: string,
  blocks: Block[],
  events: StudyEvent[],
  stat: DailyStat | undefined,
  focusOf: (categoryId: string) => boolean
): DayDigest {
  const d = emptyDigest(date);
  const real = blocks.filter((b) => !b.auto);

  d.blocksPlanned = real.length;
  d.blocksDone = real.filter((b) => b.completed).length;

  const categories = new Set<string>();
  const drifts: number[] = [];
  const ticks: number[] = [];

  for (const b of real) {
    const length = Math.max(0, b.end - b.start);
    d.minutesPlanned += length;
    if (b.completed) d.minutesDone += length;
    if (length > d.longestBlock) d.longestBlock = length;
    if (length >= DEEP_BLOCK_MIN) d.deepMinutes += length;
    if (focusOf(b.category)) d.focusMinutes += length;
    categories.add(b.category);

    // Only where a timestamp actually exists. Absence means unknown, never on time —
    // the same rule `wasOnTime` holds, and for the same reason: every block completed
    // before timestamps existed would otherwise be declared punctual.
    if (b.completed && typeof b.completedAt === 'number') {
      ticks.push(b.completedAt);
      drifts.push(b.completedAt - b.end);
    }
  }

  d.contexts = categories.size;
  d.tickDrift = median(drifts);
  d.firstTick = ticks.length ? Math.min(...ticks) : null;
  d.lastTick = ticks.length ? Math.max(...ticks) : null;

  for (const e of eventsOn(events, date)) {
    switch (e.kind) {
      case 'block.create':
      case 'task.add':
        d.creates++;
        break;
      case 'block.move':
        d.moves++;
        break;
      case 'block.resize':
        d.resizes++;
        break;
      case 'block.delete':
      case 'task.remove':
        d.deletes++;
        break;
      case 'day.build':
      case 'day.replan':
        d.builds++;
        break;
      case 'day.clear':
        d.clears++;
        break;
      case 'app.open':
        d.opens++;
        break;
      case 'view.switch':
        d.viewSwitches++;
        break;
      case 'day.nav':
        d.dayNavigations++;
        break;
      default:
        break;
    }
  }

  // The scoring layer's own figure wins where it exists, so the study and the app can
  // never quote different numbers for the same day.
  if (stat) {
    d.minutesPlanned = stat.plannedMinutes;
    d.minutesDone = stat.doneMinutes;
    d.focusMinutes = stat.focusMinutes;
  }

  return d;
}

/**
 * Digest every finished day the raw log holds that has not been digested already.
 *
 * Idempotent on date: a day already in `existing` is left exactly as it was sealed.
 * Today is never digested, because it has not finished happening.
 *
 * Returns only what is NEW, so the caller writes an append rather than a whole list —
 * and so a bug here can add a day but never rewrite one.
 */
export function digestFinishedDays(
  today: string,
  events: StudyEvent[],
  existing: DayDigest[],
  blocksFor: (date: string) => Block[],
  statFor: (date: string) => DailyStat | undefined,
  focusOf: (categoryId: string) => boolean
): DayDigest[] {
  const sealed = new Set(existing.map((x) => x.date));
  const dates = [...new Set(events.map((e) => e.date))].filter(Boolean).sort();

  const out: DayDigest[] = [];
  for (const date of dates) {
    if (sealed.has(date)) continue;
    if (daysBetween(date, today) <= 0) continue; // today, or somehow the future
    out.push(buildDigest(date, blocksFor(date), events, statFor(date), focusOf));
  }
  return out;
}

/** How many days of digests are kept. Matches the day-stat window. */
export const DIGEST_RETENTION_DAYS = 400;

export function pruneDigests(
  digests: DayDigest[],
  today: string,
  retentionDays = DIGEST_RETENTION_DAYS
): DayDigest[] {
  return digests.filter((x) => {
    const age = daysBetween(x.date, today);
    return age >= 0 && age < retentionDays;
  });
}

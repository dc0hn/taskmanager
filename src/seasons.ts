import type { DailyStat, DayMarks } from './types';
import { standingFor } from './progress';
import { shiftDay } from './streaks';

// ============================================================================
// Seasons — the prestige cycle, anchored to the calendar
//
// The progression layer already had a cycle: sixty ranks, then prestige, then the same
// sixty again behind a different sigil. What it had no relationship to was the calendar —
// which, for an app called Almanac, is the obvious thing to fix. A cycle that turns over
// whenever you happen to reach 8,910 XP is a treadmill. A cycle that turns over at the end
// of March is a season.
//
// Same shape as the month rollover, deliberately: elapsed seasons are resolved on read, in
// order, and the presence of a sealed record is what stops one being sealed twice. Nothing
// depends on the app being open on the 1st of April.
//
// A SEAL IS A READING, NOT A RESET. Sealing a season does not touch XP, the run, or
// anything else. It writes down what was true and moves on — because a planner that
// confiscates your progress at a date boundary has misunderstood what the progress was for.
// ============================================================================

export type Quarter = 1 | 2 | 3 | 4;

/** 'YYYY-Qn'. Keyed like every other record: a plain sortable string, never an object. */
export type SeasonKey = string;

export interface SeasonRecord {
  season: SeasonKey;
  /** Inclusive date range, for the record and for the year page. */
  from: string;
  to: string;
  /** Lifetime XP at the moment of sealing, and at the start. */
  xpStart: number;
  xpEnd: number;
  /** Level and rank reached by the end. */
  level: number;
  rank: string;
  prestige: number;
  /** Days that met the threshold, and days cleared outright. */
  daysKept: number;
  daysCleared: number;
  /** Longest run that ended inside the season. */
  bestRun: number;
  focusMinutes: number;
  doneMinutes: number;
  /** Day marks inside the season, counted by definition id. */
  marks: Record<string, number>;
  /** Date it was sealed. Empty means still in progress. */
  sealedOn: string;
}

// ---------------------------------------------------------------------------
// Keys and ranges
// ---------------------------------------------------------------------------

export function quarterOf(dateKey: string): Quarter {
  const month = Number(dateKey.slice(5, 7));
  return (Math.floor((month - 1) / 3) + 1) as Quarter;
}

export function seasonKeyOf(dateKey: string): SeasonKey {
  return `${dateKey.slice(0, 4)}-Q${quarterOf(dateKey)}`;
}

export function isSeasonKey(v: unknown): v is SeasonKey {
  return typeof v === 'string' && /^\d{4}-Q[1-4]$/.test(v);
}

/** First and last date of a season, inclusive. */
export function seasonRange(season: SeasonKey): { from: string; to: string } {
  const year = Number(season.slice(0, 4));
  const q = Number(season.slice(6)) as Quarter;
  const firstMonth = (q - 1) * 3 + 1;
  const from = `${year}-${String(firstMonth).padStart(2, '0')}-01`;
  // The day before the next season's first day, so month lengths and leap years look after
  // themselves.
  const nextMonth = firstMonth + 3;
  const nextYear = nextMonth > 12 ? year + 1 : year;
  const wrapped = nextMonth > 12 ? nextMonth - 12 : nextMonth;
  const nextFirst = `${nextYear}-${String(wrapped).padStart(2, '0')}-01`;
  return { from, to: shiftDay(nextFirst, -1) };
}

export function seasonName(season: SeasonKey): string {
  const q = Number(season.slice(6));
  const names = ['', 'The First Quarter', 'The Second Quarter', 'The Third Quarter', 'The Fourth Quarter'];
  return `${names[q]} of ${season.slice(0, 4)}`;
}

/** Every season key from `from` up to and including `to`, in order. */
export function seasonsBetween(from: SeasonKey, to: SeasonKey): SeasonKey[] {
  const out: SeasonKey[] = [];
  let year = Number(from.slice(0, 4));
  let q = Number(from.slice(6));
  const endYear = Number(to.slice(0, 4));
  const endQ = Number(to.slice(6));
  // Bounded so a corrupt key cannot spin, the same guard the streak walk uses.
  for (let guard = 0; guard < 400; guard++) {
    if (year > endYear || (year === endYear && q > endQ)) break;
    out.push(`${year}-Q${q}`);
    q += 1;
    if (q > 4) {
      q = 1;
      year += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reckoning a season
// ---------------------------------------------------------------------------

export interface SeasonInputs {
  stats: Record<string, DailyStat>;
  marks: DayMarks;
  /** Lifetime XP as it stands now. */
  totalXp: number;
  /** Lifetime XP when the season began, if known. */
  xpAtStart: number;
  threshold: number;
}

/**
 * Read a season out of the day stats it covers.
 *
 * Derived, never accumulated. Everything here is a pass over stats already stored, which is
 * what lets a season be re-read after the fact — and what stops it drifting from the record
 * the way an event-sourced tally would.
 */
export function reckonSeason(
  season: SeasonKey,
  inputs: SeasonInputs,
  sealedOn = ''
): SeasonRecord {
  const { from, to } = seasonRange(season);
  const dates = Object.keys(inputs.stats)
    .filter((d) => d >= from && d <= to)
    .sort();

  let daysKept = 0;
  let daysCleared = 0;
  let focusMinutes = 0;
  let doneMinutes = 0;
  let run = 0;
  let bestRun = 0;

  for (const d of dates) {
    const s = inputs.stats[d];
    focusMinutes += s.focusMinutes;
    doneMinutes += s.doneMinutes;
    if (s.cleared) daysCleared += 1;

    const kept =
      s.plannedMinutes > 0 && s.doneMinutes / s.plannedMinutes >= inputs.threshold;
    if (kept) {
      daysKept += 1;
      run += 1;
      bestRun = Math.max(bestRun, run);
    } else if (s.plannedMinutes > 0) {
      // Only a day that had a plan can break a run. A blank day is neutral, exactly as it is
      // for the streak itself.
      run = 0;
    }
  }

  const marks: Record<string, number> = {};
  for (const [date, id] of Object.entries(inputs.marks)) {
    if (date < from || date > to) continue;
    marks[id] = (marks[id] ?? 0) + 1;
  }

  const standing = standingFor(inputs.totalXp);
  return {
    season,
    from,
    to,
    xpStart: inputs.xpAtStart,
    xpEnd: inputs.totalXp,
    level: standing.level,
    rank: standing.rank,
    prestige: standing.prestige,
    daysKept,
    daysCleared,
    bestRun,
    focusMinutes,
    doneMinutes,
    marks,
    sealedOn,
  };
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

export interface SeasonResolution {
  sealed: SeasonRecord[];
  changed: boolean;
}

/**
 * Seal every season that has finished and is not yet on the record.
 *
 * Lazy and idempotent, matching the week and month rollovers. The presence of a record is
 * the guard, so this is safe to run on every launch and correct after a year away.
 *
 * The current season is never sealed — it is still being lived.
 */
export function resolveElapsedSeasons(
  today: string,
  existing: Record<SeasonKey, SeasonRecord>,
  inputs: Omit<SeasonInputs, 'xpAtStart'>,
  startedOn: string
): SeasonResolution {
  if (!startedOn) return { sealed: [], changed: false };

  const current = seasonKeyOf(today);
  const first = seasonKeyOf(startedOn);
  const sealed: SeasonRecord[] = [];

  // Accumulates as it walks, so seasons sealed earlier in THIS pass are visible to the ones
  // after them. Reading only the stored map would give every season sealed in one catch-up
  // the same starting figure — which, after a year away, means four seasons all claiming to
  // begin where the last stored one ended.
  const known: Record<SeasonKey, SeasonRecord> = { ...existing };

  for (const season of seasonsBetween(first, current)) {
    if (season === current) break;
    if (known[season]) continue;

    // XP at the start of a season is the previous season's end where one is known, and zero
    // for the very first — honest rather than approximate: before the first seal there was no
    // history to have earned anything in.
    const previous = Object.keys(known)
      .sort()
      .filter((k) => k < season)
      .pop();
    const xpAtStart = previous ? known[previous].xpEnd : 0;

    const record = reckonSeason(season, { ...inputs, xpAtStart }, today);
    known[season] = record;
    sealed.push(record);
  }

  return { sealed, changed: sealed.length > 0 };
}

/** The season in progress, reckoned live so it can be shown alongside the sealed ones. */
export function currentSeason(
  today: string,
  existing: Record<SeasonKey, SeasonRecord>,
  inputs: Omit<SeasonInputs, 'xpAtStart'>
): SeasonRecord {
  const season = seasonKeyOf(today);
  const keys = Object.keys(existing).sort();
  const previous = keys.filter((k) => k < season).pop();
  const xpAtStart = previous ? existing[previous].xpEnd : 0;
  return reckonSeason(season, { ...inputs, xpAtStart });
}

/** How far through the season today is, 0..1. For the meter. */
export function seasonProgress(today: string): number {
  const { from, to } = seasonRange(seasonKeyOf(today));
  const day = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  const span = day(to) - day(from);
  if (span <= 0) return 0;
  return Math.min(1, Math.max(0, (day(today) - day(from)) / span));
}

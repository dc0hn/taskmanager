import type {
  AwardLedger,
  AwardPayout,
  DailyStat,
  DayMarks,
  DayOutcome,
  StreakState,
} from './types';
import { dayScore } from './progress';

// ============================================================================
// Streaks
//
// The single most abandonment-prone mechanic in any app of this kind, so the whole
// design is arranged around not losing your run:
//
//   FOUR OF SIX OUTCOMES KEEP IT. Only a day where you planned work, fell short of
//   the threshold, and had already spent your freeze can end a run. A day with
//   nothing planned is neutral — there was nothing to fail. A travel or gig day is
//   held outright, because being on the road is not a lapse.
//
//   A FREEZE APPLIES ITSELF. Asking someone to remember to spend a shield is asking
//   them to lose their streak to admin. One is granted per seven days and used
//   automatically the moment it is needed.
//
//   A RESET IS NOT A FAILURE. The vocabulary here is "fresh start", the number goes
//   back to zero without ceremony, and the first day you come back earns a bonus.
//   Nothing anywhere reports a broken streak as something you did wrong.
//
// Resolution is lazy and idempotent, matching the weekly and monthly rollovers: the
// app may be shut for a fortnight, so on open it walks every elapsed day once, and
// `resolvedThrough` is the guard that stops it walking them twice.
// ============================================================================

/** Share of a day's planned minutes needed to keep the run. */
export const STREAK_THRESHOLD = 0.6;

/** Freezes granted per window, and how often the window turns over. */
export const FREEZE_CAPACITY = 1;
export const FREEZE_REFILL_DAYS = 7;

/** Consistency XP for a day that advanced the run. */
export const CONSISTENCY_XP_PER_DAY = 25;

/** Deliberately small — a nudge back in, not a reward for having lapsed. */
export const COMEBACK_XP = 30;

/** Extra brass for a day that kept the run, over and above the day's XP. */
export const KEPT_DAY_BRASS = 5;

/**
 * Day-streak lengths that pay a bonus, and what each pays.
 *
 * Deliberately several times the routine equivalents: keeping a whole day's plan for
 * thirty days running is a far harder thing than keeping one habit, and paying it
 * less would have the scoring quietly disagree with the difficulty.
 */
export const STREAK_MILESTONES: { days: number; xp: number }[] = [
  { days: 7, xp: 120 },
  { days: 14, xp: 250 },
  { days: 30, xp: 600 },
  { days: 60, xp: 1200 },
  { days: 100, xp: 2500 },
];

/** Which milestones get the full-screen treatment. Twice a year at most. */
export const STREAK_TAKEOVER_DAYS = [30, 100];

/** Routine streak lengths that pay a one-off bonus, and what each pays. */
export const ROUTINE_MILESTONES: { days: number; xp: number }[] = [
  { days: 7, xp: 50 },
  { days: 30, xp: 150 },
  { days: 100, xp: 400 },
];

export function emptyStreak(): StreakState {
  return {
    current: 0,
    longest: 0,
    resolvedThrough: '',
    freezes: FREEZE_CAPACITY,
    capacity: FREEZE_CAPACITY,
    refilledOn: '',
    frozenDates: [],
    startedOn: '',
    lastResetOn: '',
    consistencyXp: 0,
    comebackOn: '',
  };
}

export function emptyAwards(): AwardLedger {
  return { granted: [] };
}

// ---------------------------------------------------------------------------
// Date arithmetic
// ---------------------------------------------------------------------------

/**
 * Re-exported, not reimplemented.
 *
 * These live in utils/time.ts now. The names stay here because a dozen modules import them
 * from streaks, and because "shift a day" reads naturally beside a streak walk — but there
 * is one implementation, and it is not this file's.
 */
export { addDays as shiftDay, daysBetween } from './utils/time';

// And imported for use inside this file.
import { addDays as shiftDay, daysBetween } from './utils/time';

// ---------------------------------------------------------------------------
// Classifying a day
// ---------------------------------------------------------------------------

/**
 * What one settled day does to the run.
 *
 * A marked day that you nonetheless finished still ADVANCES rather than merely
 * holding — doing the work is always worth more than being excused from it.
 */
export function classifyDay(
  stat: DailyStat | undefined,
  marked: boolean,
  threshold = STREAK_THRESHOLD,
  freezesAvailable = 0
): DayOutcome {
  const planned = stat?.plannedMinutes ?? 0;
  const met = planned > 0 && dayScore(stat) >= threshold;

  if (met) return 'advanced';
  if (marked) return 'held';
  if (planned === 0) return 'neutral';
  return freezesAvailable > 0 ? 'frozen' : 'reset';
}

/** Minutes still needed today to keep the run. */
export function minutesToThreshold(
  stat: DailyStat | undefined,
  threshold = STREAK_THRESHOLD
): number {
  if (!stat || stat.plannedMinutes <= 0) return 0;
  return Math.max(0, Math.ceil(stat.plannedMinutes * threshold) - stat.doneMinutes);
}

/** Does today already qualify? Used to show the run including today. */
export function todayQualifies(
  stat: DailyStat | undefined,
  marked: boolean,
  threshold = STREAK_THRESHOLD
): boolean {
  if (marked) return true;
  return (stat?.plannedMinutes ?? 0) > 0 && dayScore(stat) >= threshold;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

export interface ResolvedDay {
  date: string;
  outcome: DayOutcome;
  /** Run length after this day. */
  runAfter: number;
}

export interface StreakResolution {
  state: StreakState;
  /** Every day walked, oldest first. Empty when nothing was pending. */
  days: ResolvedDay[];
  /**
   * Awards earned during resolution, each carrying its own XP.
   *
   * Per-key rather than a list plus one total, and this producer is the reason the
   * distinction matters. It is the only one that never sees the award ledger — it walks
   * days and reports what they earned, with no idea what has already been paid. A
   * single walk can raise several keys at once (a comeback and a milestone, or two
   * milestones across a long absence), so a summed figure was only ever correct when
   * every key in it turned out to be new. The caller could not tell, and paid the lot.
   */
  payouts: AwardPayout[];
  /** Brass owed — kept-day bonuses, paid per day rather than per award. */
  brass: number;
  changed: boolean;
}

/**
 * Walk every day from the last resolved one up to yesterday.
 *
 * Today is deliberately left open: it is still in play, and settling it early would
 * mean a morning with nothing done yet could break a run that the afternoon was
 * about to save.
 *
 * On a first run with no `resolvedThrough`, it starts from the earliest day that has
 * a stat, so an existing user's streak reflects the history their XP was already
 * backfilled from rather than starting at zero beside a level 34 badge.
 */
export function resolveStreak(
  state: StreakState,
  stats: Record<string, DailyStat>,
  marks: DayMarks,
  today: string,
  threshold = STREAK_THRESHOLD,
  /** The day scoring began. Days before it never count toward a run. */
  startedOn = ''
): StreakResolution {
  const dated = Object.keys(stats)
    .filter((d) => startedOn === '' || d >= startedOn)
    .sort();
  const firstKnown = dated[0] ?? (startedOn || undefined);

  let cursor: string;
  if (state.resolvedThrough) {
    cursor = shiftDay(state.resolvedThrough, 1);
  } else if (firstKnown) {
    cursor = firstKnown;
  } else {
    // Nothing has ever happened. Mark yesterday settled so the first real day is
    // walked normally rather than the whole of recorded time.
    return {
      state: { ...state, resolvedThrough: shiftDay(today, -1), refilledOn: today },
      days: [],
      payouts: [],
      brass: 0,
      changed: state.resolvedThrough !== shiftDay(today, -1),
    };
  }

  // A gap larger than this means the app was shut for a long time; walking it day by
  // day is still correct but bounded so a corrupt date cannot spin.
  const MAX_WALK = 800;
  if (daysBetween(cursor, today) > MAX_WALK) cursor = shiftDay(today, -MAX_WALK);
  // A resolvedThrough from before a reset must not drag the walk back into the
  // unscored era.
  if (startedOn && cursor < startedOn) cursor = startedOn;

  const next: StreakState = { ...state, frozenDates: [...state.frozenDates] };
  const days: ResolvedDay[] = [];
  const payouts: AwardPayout[] = [];
  let brass = 0;

  // The freeze allowance turns over on a fixed cadence rather than being topped up
  // the moment it is used, which is what stops a bad week costing seven freezes.
  if (!next.refilledOn) next.refilledOn = cursor;

  while (daysBetween(cursor, today) > 0) {
    if (daysBetween(next.refilledOn, cursor) >= FREEZE_REFILL_DAYS) {
      const windows = Math.floor(daysBetween(next.refilledOn, cursor) / FREEZE_REFILL_DAYS);
      next.freezes = Math.min(next.capacity, next.freezes + windows * FREEZE_CAPACITY);
      next.refilledOn = shiftDay(next.refilledOn, windows * FREEZE_REFILL_DAYS);
    }

    const outcome = classifyDay(stats[cursor], marks[cursor] != null, threshold, next.freezes);

    switch (outcome) {
      case 'advanced': {
        // A run that starts today records where it began, so "since" can be shown.
        if (next.current === 0) next.startedOn = cursor;
        next.current += 1;
        next.longest = Math.max(next.longest, next.current);
        next.consistencyXp += CONSISTENCY_XP_PER_DAY;
        brass += KEPT_DAY_BRASS;

        // Milestones are keyed by the run they belong to, not by length alone. Key
        // them on length only and a user who ever resets can never earn streak XP
        // again — which would make one bad week a permanent penalty.
        for (const m of STREAK_MILESTONES) {
          if (next.current !== m.days) continue;
          const key = `streak:${next.startedOn}:${m.days}`;
          if (!payouts.some((p) => p.key === key)) {
            payouts.push({ key, xp: m.xp, label: `${m.days} days running` });
          }
        }

        // The first kept day after a reset. Paid once per reset, keyed on the reset
        // date so it can never be paid twice for the same lapse.
        if (next.lastResetOn) {
          const key = `comeback:${next.lastResetOn}`;
          if (!payouts.some((p) => p.key === key)) {
            payouts.push({ key, xp: COMEBACK_XP, label: 'Back on it' });
          }
          // Recorded on the state rather than reported to the caller, so it survives a
          // reload and the badge that depends on it can still fire.
          next.comebackOn = today;
          next.lastResetOn = '';
        }
        break;
      }
      case 'frozen':
        next.freezes -= 1;
        next.frozenDates = [...next.frozenDates, cursor].slice(-60);
        break;
      case 'reset':
        next.current = 0;
        next.startedOn = '';
        next.lastResetOn = cursor;
        break;
      case 'held':
      case 'neutral':
      case 'open':
        break;
    }

    days.push({ date: cursor, outcome, runAfter: next.current });
    next.resolvedThrough = cursor;
    cursor = shiftDay(cursor, 1);
  }

  // Refill once more against today, so a freeze earned during the gap is in hand.
  if (next.refilledOn && daysBetween(next.refilledOn, today) >= FREEZE_REFILL_DAYS) {
    const windows = Math.floor(daysBetween(next.refilledOn, today) / FREEZE_REFILL_DAYS);
    next.freezes = Math.min(next.capacity, next.freezes + windows * FREEZE_CAPACITY);
    next.refilledOn = shiftDay(next.refilledOn, windows * FREEZE_REFILL_DAYS);
  }

  return {
    state: next,
    days,
    payouts,
    brass,
    changed: days.length > 0 || next.resolvedThrough !== state.resolvedThrough,
  };
}

// ---------------------------------------------------------------------------
// One-off awards
// ---------------------------------------------------------------------------

export function hasAward(ledger: AwardLedger, key: string): boolean {
  return ledger.granted.includes(key);
}

/**
 * Grant keys not already held, returning the new ledger and what was actually new.
 *
 * The filter is the whole point: callers may offer the same key repeatedly and only
 * the first offer can ever pay.
 */
export function grantAwards(
  ledger: AwardLedger,
  keys: string[]
): { ledger: AwardLedger; granted: string[] } {
  const fresh = keys.filter((k) => !ledger.granted.includes(k));
  if (fresh.length === 0) return { ledger, granted: [] };
  return { ledger: { granted: [...ledger.granted, ...fresh] }, granted: fresh };
}

/** Routine milestones reached but not yet paid. */
export function routineAwardsDue(
  ledger: AwardLedger,
  streaks: { templateId: string; current: number }[]
): AwardPayout[] {
  const payouts: AwardPayout[] = [];
  for (const s of streaks) {
    for (const m of ROUTINE_MILESTONES) {
      if (s.current < m.days) continue;
      const key = `routine:${s.templateId}:${m.days}`;
      if (hasAward(ledger, key) || payouts.some((p) => p.key === key)) continue;
      payouts.push({ key, xp: m.xp, label: `${m.days} days running` });
    }
  }
  return payouts;
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

/** The run as it should read right now, counting today if today already qualifies. */
export function displayRun(
  state: StreakState,
  todayStat: DailyStat | undefined,
  todayMarked: boolean,
  threshold = STREAK_THRESHOLD
): number {
  return state.current + (todayQualifies(todayStat, todayMarked, threshold) ? 1 : 0);
}

/** Days until the next freeze arrives. */
export function daysUntilFreeze(state: StreakState, today: string): number {
  if (state.freezes >= state.capacity) return 0;
  if (!state.refilledOn) return FREEZE_REFILL_DAYS;
  return Math.max(0, FREEZE_REFILL_DAYS - daysBetween(state.refilledOn, today));
}


/**
 * A sentence for the current state.
 *
 * Never phrases a reset as a loss. "Fresh start" is not a euphemism here — the
 * comeback bonus means the next kept day is worth more than an ordinary one.
 */
export function describeStreak(
  state: StreakState,
  run: number,
  todayStat: DailyStat | undefined,
  todayMarked: boolean
): string {
  if (todayMarked) return 'Marked day — your run is held without spending a freeze.';
  const needed = minutesToThreshold(todayStat);
  if (run === 0 && state.lastResetOn) {
    return 'Fresh start. The first day you finish is worth extra.';
  }
  if ((todayStat?.plannedMinutes ?? 0) === 0) {
    return 'Nothing planned today, so nothing to keep up. The run holds.';
  }
  if (needed === 0) return 'Today is in the bag.';
  return `${needed} more minutes today keeps the run.`;
}

/** Outcomes for a window of dates, for the strip in the Standing view. */
export function outcomeStrip(
  dates: string[],
  stats: Record<string, DailyStat>,
  marks: DayMarks,
  today: string,
  frozenDates: string[],
  threshold = STREAK_THRESHOLD
): { date: string; outcome: DayOutcome }[] {
  const frozen = new Set(frozenDates);
  return dates.map((date) => {
    if (date > today) return { date, outcome: 'neutral' as DayOutcome };
    if (date === today) return { date, outcome: 'open' as DayOutcome };
    // A day recorded as frozen keeps that reading forever, even though it would
    // classify as a reset now that the freeze is gone.
    if (frozen.has(date)) return { date, outcome: 'frozen' as DayOutcome };
    return { date, outcome: classifyDay(stats[date], marks[date] != null, threshold, 0) };
  });
}

/**
 * The largest milestone among a set of freshly granted award keys.
 *
 * Used to decide whether a run deserves the full-screen moment. Returns the biggest,
 * because crossing 30 on a day that also crossed nothing else should read as thirty,
 * not as seven.
 */
export function biggestStreakMilestone(grantedKeys: string[]): number | null {
  let best: number | null = null;
  for (const key of grantedKeys) {
    const parts = key.split(':');
    if (parts[0] !== 'streak') continue;
    const days = Number(parts[2]);
    if (!Number.isFinite(days)) continue;
    if (best == null || days > best) best = days;
  }
  return best;
}

export function deservesTakeover(days: number | null): boolean {
  return days != null && STREAK_TAKEOVER_DAYS.includes(days);
}

/** A run that has never happened, ready to count from `today`. */
export function resetStreak(today: string): StreakState {
  return { ...emptyStreak(), resolvedThrough: shiftDay(today, -1), refilledOn: today };
}

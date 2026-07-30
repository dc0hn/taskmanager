import type {
  CarryoverItem,
  ClearedCarryover,
  GoalCredit,
  MonthlyGoalSummary,
  MonthRecord,
  WeeklyGoal,
  WeekRecord,
} from './types';
import { toDateKey } from './utils/time';
import { weekDates } from './week';

// ============================================================================
// Months — the durable record above the week
//
// Weekly goals are measured per week, and that measurement is left alone here.
// This adds a second, separate statistic: how much of a standing weekly
// intention actually happened over a calendar month.
//
// THE DENOMINATOR IS PRO-RATED BY DAYS, not by whole weeks:
//
//     monthlyTarget = weeklyTarget × daysInMonth ÷ 7
//
// February asks for ×4.00, April ×4.29, July ×4.43. A flat ×4 would quietly make
// long months harder and let them read over 100%; rounding to whole weeks (4 or
// 5) is too coarse to notice a single extra day. Pro-rating by days means 100%
// is "kept pace", in any month, and it does not disturb the weekly numbers —
// those remain literal counts against the weekly target.
//
// WHY THIS IS STORED RATHER THAN DERIVED. Goal credits are pruned after twelve
// weeks and a week's outcome is computed from them rather than saved, so nothing
// older than about three months can be reconstructed. Sealing a month writes a
// standalone summary, which is what makes a history channel possible at all.
// Consequence worth knowing: history accumulates from the moment this ships, not
// retroactively.
// ============================================================================

/** 'YYYY-MM' for a day key. */
export function toMonthKey(dateKey: string): string {
  return dateKey.slice(0, 7);
}

export function currentMonthKey(now: Date = new Date()): string {
  return toMonthKey(toDateKey(now));
}

export function monthYear(monthKey: string): { year: number; month: number } {
  const [y, m] = monthKey.split('-').map(Number);
  return { year: y, month: m };
}

/** Days in the month — 28, 29, 30 or 31. This is the whole point of the model. */
export function daysInMonth(monthKey: string): number {
  const { year, month } = monthYear(monthKey);
  return new Date(year, month, 0).getDate();
}

export function addMonthKeys(monthKey: string, n: number): string {
  const { year, month } = monthYear(monthKey);
  const d = new Date(year, month - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "July 2026" */
export function formatMonthKey(monthKey: string): string {
  const { year, month } = monthYear(monthKey);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });
}

/** "Jul" — for compact axes. */
export function formatMonthShort(monthKey: string): string {
  const { year, month } = monthYear(monthKey);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

export function isDayInMonth(dateKey: string, monthKey: string): boolean {
  return toMonthKey(dateKey) === monthKey;
}

/**
 * The pro-rated monthly target. Kept unrounded so the ratio is honest; callers
 * format it for display.
 */
export function monthlyTargetFor(weeklyTarget: number, monthKey: string): number {
  return (Math.max(1, weeklyTarget) * daysInMonth(monthKey)) / 7;
}

// ---------------------------------------------------------------------------
// Summarising a month
// ---------------------------------------------------------------------------

/**
 * Every week record that touches a month. A week can straddle two months (the
 * week of Dec 29 2025 runs into Jan 2026), which is exactly why credits are
 * attributed by their own `date` below rather than by the week they belong to.
 */
export function weeksTouchingMonth(monthKey: string, weeks: WeekRecord[]): WeekRecord[] {
  return weeks.filter((w) =>
    weekDates(w.week).some((d) => isDayInMonth(d, monthKey))
  );
}

/** Credits earned inside the calendar month, whichever week they came from. */
function creditsInMonth(monthKey: string, weeks: WeekRecord[]): GoalCredit[] {
  const out: GoalCredit[] = [];
  for (const w of weeks) {
    for (const c of w.credits) {
      if (isDayInMonth(c.date, monthKey)) out.push(c);
    }
  }
  return out;
}

function summariseGoal(
  goal: WeeklyGoal,
  monthKey: string,
  credits: GoalCredit[],
  weeksIssued: number
): MonthlyGoalSummary {
  const mine = credits.filter((c) => c.goalId === goal.id);
  // A session is one goal on one day — the same rule the weekly figures use, so
  // the two statistics never disagree about what counted.
  const done =
    goal.targetKind === 'sessions'
      ? new Set(mine.map((c) => c.date)).size
      : mine.reduce((sum, c) => sum + c.minutes, 0);

  const monthlyTarget = monthlyTargetFor(goal.target, monthKey);
  return {
    goalId: goal.id,
    // Label and category are snapshotted: the goal may be renamed, recoloured or
    // deleted later, and a historical month should still read correctly.
    label: goal.label,
    category: goal.category,
    targetKind: goal.targetKind,
    weeklyTarget: goal.target,
    monthlyTarget,
    done,
    weeksIssued,
    ratio: monthlyTarget > 0 ? done / monthlyTarget : 0,
  };
}

/**
 * Build the summary for one month from whatever week records exist.
 *
 * Only weekly-cadence goals are included: a one-off has no weekly total, so
 * "weekly total × weeks" is meaningless for it.
 */
export function summariseMonth(
  monthKey: string,
  weeks: WeekRecord[],
  clearedFromPile: ClearedCarryover[] = [],
  sealedOn = ''
): MonthRecord {
  const touching = weeksTouchingMonth(monthKey, weeks);
  const credits = creditsInMonth(monthKey, touching);

  // One entry per goal lineage. Later instances win for the target, so a target
  // changed mid-month is measured against what it most recently was.
  const latest = new Map<string, WeeklyGoal>();
  const issuedCount = new Map<string, number>();
  for (const w of [...touching].sort((a, b) => a.week.localeCompare(b.week))) {
    for (const g of w.goals) {
      if (g.cadence !== 'weekly') continue;
      latest.set(g.id, g);
      issuedCount.set(g.id, (issuedCount.get(g.id) ?? 0) + 1);
    }
  }

  const goals = [...latest.values()].map((g) =>
    summariseGoal(g, monthKey, credits, issuedCount.get(g.id) ?? 0)
  );

  return {
    month: monthKey,
    daysInMonth: daysInMonth(monthKey),
    sealedOn,
    goals,
    cleared: clearedFromPile,
    // Combined across goals as the MEAN of the per-goal ratios. Sessions and
    // minutes cannot be added together, so a weighted total is not available;
    // averaging the fractions is the only honest single number.
    overall: goals.length > 0
      ? goals.reduce((sum, g) => sum + g.ratio, 0) / goals.length
      : 0,
  };
}

/** A live, unsealed view of the month in progress — same maths, nothing written. */
export function monthInProgress(
  monthKey: string,
  weeks: WeekRecord[]
): MonthRecord {
  return summariseMonth(monthKey, weeks, [], '');
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

export interface MonthRolloverResult {
  /** Newly sealed months, to be written. */
  sealed: MonthRecord[];
  /** The pile with everything up to the sealed months removed. */
  carryover: CarryoverItem[];
  changed: boolean;
}

function toCleared(item: CarryoverItem): ClearedCarryover {
  return {
    goalId: item.goal.id,
    label: item.goal.label,
    category: item.goal.category,
    targetKind: item.goal.targetKind,
    residual: item.residual,
    deferrals: item.goal.deferrals,
    firstDeferredWeek: item.firstDeferredWeek,
    lastWeek: item.lastWeek,
  };
}

/**
 * Seal every elapsed month, and empty the carryover pile into it.
 *
 * The pile is scoped to a month now: on the 1st it resets. Nothing is thrown
 * away silently — each cleared item is written into that month's record as
 * "carried and dropped", so the history channel can show what was let go and how
 * long it had been waiting.
 *
 * An item is attributed to the month of its `lastWeek`, so a long absence seals
 * several months and files each item under the month it actually slipped in
 * rather than dumping everything into the oldest one.
 *
 * Lazy and idempotent, like the weekly rollover: presence of a month record is
 * the guard, so running this repeatedly changes nothing after the first pass.
 */
export function resolveElapsedMonths(
  currentMonth: string,
  existing: MonthRecord[],
  weeks: WeekRecord[],
  carryover: CarryoverItem[],
  today: string
): MonthRolloverResult {
  const sealedKeys = new Set(existing.map((m) => m.month));

  // Only months that actually hold data are considered — a long gap must not
  // fabricate empty records for every month the app was closed.
  const candidates = new Set<string>();
  for (const w of weeks) {
    for (const d of weekDates(w.week)) {
      const m = toMonthKey(d);
      if (m < currentMonth) candidates.add(m);
    }
  }
  for (const item of carryover) {
    if (item.lastWeek) {
      const m = toMonthKey(item.lastWeek);
      if (m < currentMonth) candidates.add(m);
    }
  }

  const toSeal = [...candidates].filter((m) => !sealedKeys.has(m)).sort();
  if (toSeal.length === 0) {
    return { sealed: [], carryover, changed: false };
  }

  let pile = [...carryover];
  const sealed: MonthRecord[] = [];

  for (const monthKey of toSeal) {
    const belongs = pile.filter(
      (i) => i.lastWeek && toMonthKey(i.lastWeek) <= monthKey
    );
    pile = pile.filter((i) => !belongs.includes(i));
    sealed.push(summariseMonth(monthKey, weeks, belongs.map(toCleared), today));
  }

  // Anything left with no usable `lastWeek` would otherwise survive forever;
  // the pile is month-scoped now, so it clears with the most recent seal.
  if (pile.length > 0 && sealed.length > 0) {
    const last = sealed[sealed.length - 1];
    last.cleared = [...last.cleared, ...pile.map(toCleared)];
    pile = [];
  }

  return { sealed, carryover: pile, changed: true };
}

/** Ratio formatted for display, honest about overshoot. */
export function formatRatio(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/** How full to draw a ring. Overshoot fills it, and the figure tells the truth. */
export function ringFill(ratio: number): number {
  return Math.max(0, Math.min(1, ratio));
}

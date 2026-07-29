import type {
  Block,
  CarryoverItem,
  CategoryDef,
  GoalCredit,
  GoalOutcome,
  GoalProgress,
  WeeklyGoal,
  WeekRecord,
} from './types';
import { addWeeks, toWeekKey } from './week';

// ============================================================================
// Weekly goal accounting and rollover
//
// Everything here is a pure function of stored records plus an injected `now`,
// so rollover is testable without mocking the clock and produces the same result
// however many times it runs.
// ============================================================================

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * A "session" is one goal on one date, not one block.
 *
 * This matters because the scheduler splits focus work longer than 120 minutes
 * into ~90-minute chunks. A single two-hour guitar sitting therefore becomes two
 * blocks carrying the same goalId, and counting blocks would credit two sessions
 * for one sitting. Counting distinct dates gets chunking right for free, with no
 * extra field to thread through the scheduler.
 *
 * The trade-off is explicit: two genuinely separate sittings on the same day
 * also count as one session. Minutes are always summed in full, so a
 * minutes-target goal is unaffected either way.
 */
export function goalProgress(goal: WeeklyGoal, credits: GoalCredit[]): GoalProgress {
  const mine = credits.filter((c) => c.goalId === goal.id);
  const days = new Set(mine.map((c) => c.date));
  const sessions = days.size;
  const minutes = mine.reduce((sum, c) => sum + c.minutes, 0);
  const done = goal.targetKind === 'sessions' ? sessions : minutes;
  const target = Math.max(1, goal.target);

  let outcome: GoalOutcome;
  // A stood-down goal is neither met nor missed. It is excluded from carryover
  // and from any deferral penalty — see the note on `voided` in types.ts.
  if (goal.voided) outcome = 'void';
  else if (done >= target) outcome = 'met';
  else if (done > 0) outcome = 'partial';
  else outcome = 'missed';

  return { goal, sessions, minutes, done, target, outcome };
}

/** Deferral count at which an item should be triaged rather than left to rot. */
export const STALE_DEFERRAL_THRESHOLD = 6;

/** How many weeks of raw credits to keep. Older weeks keep only their outcome. */
export const CREDIT_RETENTION_WEEKS = 12;

export function weekProgress(week: WeekRecord): GoalProgress[] {
  return week.goals.map((g) => goalProgress(g, week.credits));
}

/** Goals with work still outstanding — what the intake chips offer. */
export function openGoals(week: WeekRecord): GoalProgress[] {
  return weekProgress(week).filter(
    (p) => p.outcome !== 'met' && p.outcome !== 'void'
  );
}

/** Stand a goal down for this week, or undo that. */
export function setVoided(
  week: WeekRecord,
  goalId: string,
  voided: boolean
): WeekRecord {
  return {
    ...week,
    goals: week.goals.map((g) => (g.id === goalId ? { ...g, voided } : g)),
  };
}

// ---------------------------------------------------------------------------
// Crediting
//
// Credits are a ledger keyed by blockId rather than a counter. Ticking a block
// appends an entry; un-ticking removes it. That makes crediting idempotent and
// reversible, and it survives "Rebuild from now" reshuffling blocks around,
// because the ledger holds the minutes and date at the moment of completion.
// ---------------------------------------------------------------------------

export function creditFor(block: Block, date: string): GoalCredit | null {
  if (!block.goalId) return null;
  const minutes = block.end - block.start;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  return { goalId: block.goalId, blockId: block.id, date, minutes };
}

/** Append or replace the credit for a block. Idempotent. */
export function addCredit(credits: GoalCredit[], credit: GoalCredit): GoalCredit[] {
  return [...credits.filter((c) => c.blockId !== credit.blockId), credit];
}

export function removeCredit(credits: GoalCredit[], blockId: string): GoalCredit[] {
  return credits.filter((c) => c.blockId !== blockId);
}

/**
 * Reconcile the ledger against the actual state of a day's blocks.
 *
 * Called after any change to a day, so the ledger can never drift from reality:
 * a goal block that was deleted, un-ticked, resized, or moved to another day
 * has its credit corrected here rather than requiring every mutation path to
 * remember to update the ledger itself.
 */
export function reconcileCredits(
  credits: GoalCredit[],
  date: string,
  blocks: Block[]
): GoalCredit[] {
  const earned = blocks
    .filter((b) => b.completed && b.goalId)
    .map((b) => creditFor(b, date))
    .filter((c): c is GoalCredit => c !== null);

  // Drop every prior credit for this date, then re-add what is currently true.
  const others = credits.filter((c) => c.date !== date);
  return [...others, ...earned];
}

// ---------------------------------------------------------------------------
// Rollover
// ---------------------------------------------------------------------------

export interface RolloverResult {
  /** Weeks that were newly resolved and need writing back. */
  resolved: WeekRecord[];
  carryover: CarryoverItem[];
  changed: boolean;
}

/**
 * Resolve every elapsed, unresolved week and move what slipped into carryover.
 *
 * Lazy and deterministic: nothing depends on the app having been open at
 * midnight on Sunday. Opening the app after a month away resolves four weeks in
 * order on read. The `resolved` flag on each record makes it idempotent, so
 * running this twice changes nothing the second time.
 *
 * Weeks are processed in ascending key order, which matters: a goal that slipped
 * three weeks running must end up at three deferrals, not one.
 */
export function resolveElapsedWeeks(
  currentWeek: string,
  weeks: WeekRecord[],
  carryover: CarryoverItem[]
): RolloverResult {
  const elapsed = weeks
    .filter((w) => w.week < currentWeek && w.resolved !== true)
    .sort((a, b) => a.week.localeCompare(b.week));

  if (elapsed.length === 0) {
    return { resolved: [], carryover, changed: false };
  }

  let pile = [...carryover];
  const resolved: WeekRecord[] = [];

  for (const week of elapsed) {
    for (const progress of weekProgress(week)) {
      // Met, or deliberately stood down: nothing is owed either way.
      if (progress.outcome === 'met' || progress.outcome === 'void') continue;
      // A weekly goal is reissued at full target by `issueRecurringGoals`, so it
      // must not also sit in the pile — with one record per lineage it would then
      // exist in two places and could be deferred twice for the same week.
      if (progress.goal.cadence === 'weekly') continue;
      pile = deferGoal(pile, progress, week.week);
    }
    resolved.push({ ...week, resolved: true });
  }

  return { resolved, carryover: pile, changed: true };
}

/**
 * Move one slipped one-off goal into the carryover pile.
 *
 * What carries is the **residual** — what is actually still owed. A 120-minute
 * job with 40 minutes done genuinely has 80 minutes left.
 *
 * On a repeat slip the residual consolidates as max(old, new) and is NEVER
 * summed. Summation is the debt spiral in arithmetic form, and an unhittable
 * target gets the app closed rather than the work done. The escalating pressure
 * comes from `deferrals`, which does keep climbing.
 */
function deferGoal(
  pile: CarryoverItem[],
  progress: GoalProgress,
  week: string
): CarryoverItem[] {
  const existing = pile.find((c) => c.goal.id === progress.goal.id);
  const priorDeferrals = Math.max(
    existing?.goal.deferrals ?? 0,
    progress.goal.deferrals ?? 0
  );

  const freshResidual = Math.max(1, progress.target - progress.done);
  const residual = Math.max(existing?.residual ?? 0, freshResidual);

  const item: CarryoverItem = {
    goal: { ...progress.goal, deferrals: priorDeferrals + 1, voided: false },
    residual,
    firstDeferredWeek: existing?.firstDeferredWeek || week,
    lastWeek: week,
    lastProgress: { done: progress.done, target: progress.target },
  };

  return [...pile.filter((c) => c.goal.id !== progress.goal.id), item];
}

/**
 * Copy standing (weekly-cadence) goals forward into the current week.
 *
 * Only the most recent *stored* prior week is consulted. Scanning further back
 * would resurrect a goal the user deliberately removed a week or two ago; taking
 * the latest record as the current intent means removing something makes it stay
 * removed.
 *
 * Idempotent on (goalId, weekKey): a goal already present in the target week is
 * left alone, so opening the app three times on a Monday issues one set.
 *
 * Deferrals carry forward, +1 when the previous instance slipped and reset to 0
 * when it was met — catching up should clear the pressure.
 */
export function issueRecurringGoals(
  currentWeek: string,
  weeks: WeekRecord[]
): WeekRecord | null {
  const prior = weeks
    .filter((w) => w.week < currentWeek)
    .sort((a, b) => b.week.localeCompare(a.week))[0];
  if (!prior) return null;

  const current =
    weeks.find((w) => w.week === currentWeek) ?? emptyWeek(currentWeek);
  const present = new Set(current.goals.map((g) => g.id));

  const additions: WeeklyGoal[] = [];
  for (const progress of weekProgress(prior)) {
    const goal = progress.goal;
    if (goal.cadence !== 'weekly' || goal.active === false) continue;
    if (present.has(goal.id)) continue;

    const slipped = progress.outcome === 'partial' || progress.outcome === 'missed';
    additions.push({
      ...goal,
      // Full target, not the remainder: a habit's weekly target is the point.
      deferrals: progress.outcome === 'met' ? 0 : goal.deferrals + (slipped ? 1 : 0),
      voided: false,
    });
  }

  if (additions.length === 0) return null;
  return { ...current, goals: [...current.goals, ...additions] };
}

/**
 * Pull a carried goal into a week. It leaves the pile — otherwise it would live
 * in two places at once and could be deferred twice for the same week — and
 * keeps its id so its history stays connected, and its deferral count so the
 * friction survives the move.
 */
export function pullFromCarryover(
  week: WeekRecord,
  carryover: CarryoverItem[],
  goalId: string
): { week: WeekRecord; carryover: CarryoverItem[] } {
  const item = carryover.find((c) => c.goal.id === goalId);
  if (!item) return { week, carryover };
  if (week.goals.some((g) => g.id === goalId)) {
    // Already present; just drop it from the pile.
    return { week, carryover: carryover.filter((c) => c.goal.id !== goalId) };
  }
  return {
    week: {
      ...week,
      // The pulled goal is targeted at what is still owed, not at its original
      // size — that is the whole point of tracking a residual.
      goals: [...week.goals, { ...item.goal, target: item.residual }],
    },
    carryover: carryover.filter((c) => c.goal.id !== goalId),
  };
}

/** Resize what is owed, for a carried item that has become unrealistic. */
export function resizeCarryover(
  carryover: CarryoverItem[],
  goalId: string,
  residual: number
): CarryoverItem[] {
  const clean = Math.max(1, Math.round(residual));
  return carryover.map((c) =>
    c.goal.id === goalId ? { ...c, residual: clean } : c
  );
}

/** Items that have waited long enough to need an explicit decision. */
export function staleCarryover(carryover: CarryoverItem[]): CarryoverItem[] {
  return carryover.filter((c) => c.goal.deferrals >= STALE_DEFERRAL_THRESHOLD);
}

/**
 * Drop raw credits for weeks older than the retention window. The week's outcome
 * has already been sealed into carryover, so the per-block detail is no longer
 * load-bearing and would otherwise grow without bound.
 */
export function pruneCredits(
  credits: GoalCredit[],
  currentWeek: string,
  retentionWeeks = CREDIT_RETENTION_WEEKS
): GoalCredit[] {
  const cutoff = addWeeks(currentWeek, -retentionWeeks);
  return credits.filter((c) => c.date >= cutoff);
}

export function dropFromCarryover(
  carryover: CarryoverItem[],
  goalId: string
): CarryoverItem[] {
  return carryover.filter((c) => c.goal.id !== goalId);
}

/** Carryover grouped by category, ordered most-deferred first within each group. */
export function carryoverByCategory(
  carryover: CarryoverItem[],
  categories: CategoryDef[]
): { category: CategoryDef; items: CarryoverItem[] }[] {
  const groups: { category: CategoryDef; items: CarryoverItem[] }[] = [];
  for (const category of [...categories].sort((a, b) => a.order - b.order)) {
    const items = carryover
      .filter((c) => c.goal.category === category.id)
      .sort((a, b) => b.goal.deferrals - a.goal.deferrals);
    if (items.length > 0) groups.push({ category, items });
  }
  // Anything whose category was deleted still needs somewhere to go.
  const known = new Set(categories.map((c) => c.id));
  const orphans = carryover.filter((c) => !known.has(c.goal.category));
  if (orphans.length > 0) {
    groups.push({
      category: {
        id: '__unknown__',
        label: 'Uncategorised',
        short: '—',
        kind: 'neutral',
        accent: '#6b7488',
        order: 9999,
      },
      items: orphans.sort((a, b) => b.goal.deferrals - a.goal.deferrals),
    });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Weekly review
// ---------------------------------------------------------------------------

export interface CategoryTime {
  categoryId: string;
  /** Minutes of completed work. */
  done: number;
  /** Minutes scheduled, completed or not. */
  planned: number;
}

export interface WeekReview {
  week: string;
  byCategory: CategoryTime[];
  doneMinutes: number;
  plannedMinutes: number;
  goals: GoalProgress[];
  met: GoalProgress[];
  slipped: GoalProgress[];
  missed: GoalProgress[];
  /** Deliberately stood down — reported separately from failure. */
  voided: GoalProgress[];
}

/** A sealed week's credits are settled history and must not be rewritten. */
export function isSealed(week: WeekRecord): boolean {
  return week.resolved === true;
}

/**
 * Summarise a week by *time*, not by block count.
 *
 * Auto blocks (breaks, shutdown) are excluded from both figures: they are the
 * scheduler's bookkeeping, not work you set out to do, and counting them would
 * mean a day where you did everything but never ticked lunch reads as
 * incomplete.
 */
export function buildWeekReview(
  week: WeekRecord,
  blocksByDate: Record<string, Block[]>
): WeekReview {
  const totals = new Map<string, CategoryTime>();
  let doneMinutes = 0;
  let plannedMinutes = 0;

  for (const [date, blocks] of Object.entries(blocksByDate)) {
    if (toWeekKey(date) !== week.week) continue;
    for (const b of blocks) {
      if (b.auto) continue;
      const minutes = b.end - b.start;
      if (!Number.isFinite(minutes) || minutes <= 0) continue;

      const entry =
        totals.get(b.category) ?? { categoryId: b.category, done: 0, planned: 0 };
      entry.planned += minutes;
      plannedMinutes += minutes;
      if (b.completed) {
        entry.done += minutes;
        doneMinutes += minutes;
      }
      totals.set(b.category, entry);
    }
  }

  const goals = weekProgress(week);
  return {
    week: week.week,
    byCategory: [...totals.values()],
    doneMinutes,
    plannedMinutes,
    goals,
    met: goals.filter((g) => g.outcome === 'met'),
    slipped: goals.filter((g) => g.outcome === 'partial'),
    missed: goals.filter((g) => g.outcome === 'missed'),
    voided: goals.filter((g) => g.outcome === 'void'),
  };
}

/** Empty week record for a key that has nothing stored yet. */
export function emptyWeek(week: string): WeekRecord {
  return { week, goals: [], credits: [] };
}

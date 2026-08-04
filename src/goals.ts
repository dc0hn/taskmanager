import type {
  Block,
  CarryoverItem,
  CategoryDef,
  GoalCredit,
  GoalOutcome,
  GoalProgress,
  WeeklyGoal,
  WeekOutcome,
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

  // Two counting rules, because they answer to two different hazards.
  //
  // BLOCK credits count by distinct DATE, for the reason above: the scheduler splits
  // long focus work into chunks, so one sitting can be three blocks.
  //
  // CHECKED credits count INDIVIDUALLY. A tick is an explicit act, not a chunk of
  // something larger, and the distinct-date rule made any target above seven a week
  // unreachable — fourteen walks cannot be recorded in seven days when the fourteenth
  // walk is invisible. That was silent: the app accepted the target and then made it
  // impossible, with nothing anywhere saying so.
  const checked = mine.filter((c) => c.checked === true);
  const fromBlocks = new Set(mine.filter((c) => c.checked !== true).map((c) => c.date));
  const sessions = fromBlocks.size + checked.length;

  const minutes = mine.reduce((sum, c) => sum + c.minutes, 0);
  const done = goal.targetKind === 'sessions' ? sessions : minutes;
  const target = Math.max(1, goal.target);

  let outcome: GoalOutcome;
  // A stood-down goal is neither met nor missed. It is excluded from carryover
  // and from any deferral penalty — see the note on `voided` in types.ts.
  if (goal.voided) outcome = 'void';
  else if (goal.direction === 'atMost') {
    // A ceiling starts met and is lost by going past. It never reports 'partial': being
    // half way to a limit is not partial progress, it is simply inside the limit.
    outcome = done > target ? 'exceeded' : 'met';
  } else if (done >= target) outcome = 'met';
  else if (done > 0) outcome = 'partial';
  else outcome = 'missed';

  return { goal, sessions, minutes, done, target, outcome };
}


/**
 * Advance, hold or reset a goal's run at the week boundary.
 *
 * Three outcomes, and the third is the one that matters: a VOIDED week neither advances nor
 * resets. Standing something down deliberately is a decision, not a lapse — the same
 * semantics `voided` already has everywhere else, and a run that broke because you
 * consciously took a week off would make the feature actively discouraging.
 *
 * `best` never falls. A reset costs you the current run and nothing else, which is the same
 * vocabulary the day-streak uses: fresh start, not failure.
 */
export function advanceRun(
  goal: WeeklyGoal,
  outcome: GoalOutcome
): WeeklyGoal['run'] {
  if (!goal.run) return undefined;
  if (outcome === 'void') return goal.run;

  if (outcome === 'met') {
    const current = goal.run.current + 1;
    return { ...goal.run, current, best: Math.max(goal.run.best, current) };
  }
  return { ...goal.run, current: 0 };
}

/** Award key for a run goal reaching its target. Keyed on target so a longer run pays too. */
export function goalRunKey(goalId: string, target: number): string {
  return `goalrun:${goalId}:${target}`;
}

/** XP a completed run pays. */
export function goalRunXp(target: number): number {
  return 40 * target;
}

/**
 * Runs that have just reached their target and not yet been paid.
 *
 * Read off the goals as they stand after the rollover advanced them, so this is a pure
 * function of the record rather than of what happened during the walk.
 */
export function goalRunPayouts(
  goals: WeeklyGoal[],
  granted: string[]
): { key: string; xp: number; label: string }[] {
  const out: { key: string; xp: number; label: string }[] = [];
  for (const g of goals) {
    if (!g.run) continue;
    if (g.run.current < g.run.target) continue;
    const key = goalRunKey(g.id, g.run.target);
    if (granted.includes(key)) continue;
    out.push({
      key,
      xp: goalRunXp(g.run.target),
      label: `${g.label} — ${g.run.target} weeks running`,
    });
  }
  return out;
}

/** Deferral count at which an item should be triaged rather than left to rot. */
export const STALE_DEFERRAL_THRESHOLD = 6;

/** How many weeks of raw credits to keep. Older weeks keep only their outcome. */
export const CREDIT_RETENTION_WEEKS = 12;

export function weekProgress(week: WeekRecord): GoalProgress[] {
  return week.goals.map((g) => goalProgress(g, week.credits));
}

/**
 * Count how a week's goals finished.
 *
 * Every goal lands in exactly one bucket, so the five always sum to `total` — which is
 * what makes "2 of 5 missed" readable rather than needing a second figure to trust.
 */
export function tallyOutcomes(week: WeekRecord): WeekOutcome {
  const tally: WeekOutcome = {
    met: 0,
    slipped: 0,
    missed: 0,
    voided: 0,
    exceeded: 0,
    total: 0,
  };
  for (const p of weekProgress(week)) {
    tally.total++;
    if (p.outcome === 'met') tally.met++;
    else if (p.outcome === 'partial') tally.slipped++;
    else if (p.outcome === 'missed') tally.missed++;
    else if (p.outcome === 'void') tally.voided++;
    else if (p.outcome === 'exceeded') tally.exceeded++;
  }
  return tally;
}

/**
 * How a week finished: the sealed tally if it has one, otherwise counted live.
 *
 * ALWAYS PREFER THE SEAL. A sealed week is settled history, and recomputing it would
 * re-judge it against whatever the scoring rules happen to be now. The live count is
 * for the week in progress and for weeks that finished before seals existed.
 */
export function weekOutcome(week: WeekRecord): WeekOutcome {
  return week.outcome ?? tallyOutcomes(week);
}

/**
 * Finished weeks and how each ended, most recent first.
 *
 * This is the whole answer to "the goals reset, so where did the misses go" — they went
 * here, at the moment the week was sealed, and nothing that happens afterwards moves
 * them. Weeks that held no goals are dropped: an empty week is not a clean one, and
 * padding the record with them would flatter it.
 */
export function outcomeHistory(
  weeks: WeekRecord[],
  limit = 12
): { week: string; outcome: WeekOutcome }[] {
  return weeks
    .filter((w) => w.resolved === true)
    .sort((a, b) => b.week.localeCompare(a.week))
    .map((w) => ({ week: w.week, outcome: weekOutcome(w) }))
    .filter((row) => row.outcome.total > 0)
    .slice(0, limit);
}

/** Goals with work still outstanding — what the intake chips offer. */
export function openGoals(week: WeekRecord): GoalProgress[] {
  return weekProgress(week).filter(
    // A ceiling is never work to do. Offering an intake chip for one would invite more of
    // the thing you are trying to hold down, which is the opposite of what it is for.
    (p) => p.goal.direction !== 'atMost' && p.outcome !== 'met' && p.outcome !== 'void'
      // A checkmark is not scheduled work, so it must not appear in the intake — that
      // is the entire point of marking it one.
      && p.goal.checkmark !== true
  );
}

// ---------------------------------------------------------------------------
// Checkmark goals
// ---------------------------------------------------------------------------

/**
 * Whether a goal can be a checkmark at all.
 *
 * A tick carries no minutes, so a minutes target could never be satisfied by one —
 * offering the switch there would be the app promising something it cannot do.
 * Ceilings are excluded for the same reason they get no intake chip: ticking off
 * progress toward a limit you are trying to stay under is nonsense.
 */
export function checkmarkable(goal: WeeklyGoal): boolean {
  return goal.targetKind === 'sessions' && goal.direction !== 'atMost';
}

/** The week's checkmark goals, in the order they were set. */
export function checkmarkGoals(week: WeekRecord): WeeklyGoal[] {
  return week.goals.filter((g) => g.checkmark === true && g.voided !== true);
}

/** How many times a checkmark goal has been ticked on a date. */
export function checksForGoal(
  credits: GoalCredit[],
  goalId: string,
  date: string
): number {
  return credits.filter(
    (c) => c.goalId === goalId && c.date === date && c.checked === true
  ).length;
}

/**
 * Add or remove one tick for a goal on a date.
 *
 * Counts UP rather than toggling, because a goal like "fourteen walks" is ticked twice
 * on a good day. Each tick is its own credit with its own id, so removing one takes
 * away exactly one rather than clearing the day.
 */
export function addGoalCheck(
  credits: GoalCredit[],
  goalId: string,
  date: string,
  blockId: string
): GoalCredit[] {
  return [...credits, { goalId, blockId, date, minutes: 0, checked: true }];
}

export function removeGoalCheck(
  credits: GoalCredit[],
  goalId: string,
  date: string
): GoalCredit[] {
  const index = credits.findIndex(
    (c) => c.goalId === goalId && c.date === date && c.checked === true
  );
  if (index < 0) return credits;
  return [...credits.slice(0, index), ...credits.slice(index + 1)];
}

/** Every tick on a date, across all goals — what the day's XP counts. */
export function goalChecksOn(credits: GoalCredit[], date: string): number {
  return credits.filter((c) => c.date === date && c.checked === true).length;
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

  // Drop every prior credit for this date, then re-add what is currently true —
  // EXCEPT ticks, which have no block to be rebuilt from and would otherwise be erased
  // by the next change to the day.
  const others = credits.filter((c) => c.date !== date || c.checked === true);
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
      // A ceiling cannot be carried. There is no residual to owe — going over last week
      // does not mean you owe yourself a smaller limit this week.
      if (progress.goal.direction === 'atMost') continue;
      // A weekly goal is reissued at full target by `issueRecurringGoals`, so it
      // must not also sit in the pile — with one record per lineage it would then
      // exist in two places and could be deferred twice for the same week.
      if (progress.goal.cadence === 'weekly') continue;
      pile = deferGoal(pile, progress, week.week);
    }
    // Sealed with its tally. This is the only moment the week's outcome is judged —
    // from Monday the goals are reissued at full target, so without this the misses
    // would exist only as a recomputation of records the app keeps rewriting.
    resolved.push({ ...week, resolved: true, outcome: tallyOutcomes(week) });
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

  // Tombstones from this week and the one before it. Carried forward because a goal
  // deleted three weeks ago is still sitting in the week behind this one, waiting to
  // be reissued — the removal has to outlive the record it was removed from.
  const dismissed = new Set([...(current.dismissed ?? []), ...(prior.dismissed ?? [])]);

  const additions: WeeklyGoal[] = [];
  for (const progress of weekProgress(prior)) {
    const goal = progress.goal;
    if (goal.cadence !== 'weekly' || goal.active === false) continue;
    if (present.has(goal.id)) continue;
    if (dismissed.has(goal.id)) continue;

    const slipped = progress.outcome === 'partial' || progress.outcome === 'missed';
    additions.push({
      ...goal,
      // Full target, not the remainder: a habit's weekly target is the point.
      //
      // A ceiling never accrues a deferral. Exceeding one is not owing anything, and
      // stacking friction for it would turn a limit into a punishment.
      deferrals:
        goal.direction === 'atMost' || progress.outcome === 'met'
          ? 0
          : goal.deferrals + (slipped ? 1 : 0),
      voided: false,
      run: advanceRun(goal, progress.outcome),
    });
  }

  // A tombstone is only worth keeping while the goal could still be reissued — that
  // is, while it is still in the week behind this one. Once it falls out of the prior
  // week it can never come back, so the marker is dropped and the list self-prunes
  // instead of growing for the life of the profile.
  const priorIds = new Set(prior.goals.map((g) => g.id));
  const carried = [...dismissed].filter((id) => priorIds.has(id));
  const dismissedChanged =
    carried.length !== (current.dismissed?.length ?? 0) ||
    carried.some((id) => !(current.dismissed ?? []).includes(id));

  if (additions.length === 0 && !dismissedChanged) return null;
  return {
    ...current,
    goals: [...current.goals, ...additions],
    dismissed: carried.length > 0 ? carried : undefined,
  };
}

/**
 * Take a goal off the week and remember that it was deliberate.
 *
 * Only weekly-cadence goals leave a tombstone: a one-off is never reissued, so marking
 * it would be a record of nothing. Removing it from `goals` alone was the bug — the
 * prior week still held it and the next rollover put it straight back.
 */
export function removeGoalFromWeek(week: WeekRecord, goalId: string): WeekRecord {
  const goal = week.goals.find((g) => g.id === goalId);
  const goals = week.goals.filter((g) => g.id !== goalId);
  if (!goal || goal.cadence !== 'weekly') return { ...week, goals };

  const dismissed = [...new Set([...(week.dismissed ?? []), goalId])];
  return { ...week, goals, dismissed };
}

/**
 * Put a goal on the week, clearing any tombstone for it.
 *
 * The clear matters when the id is REUSED — pulling a goal back out of carryover keeps
 * its id, so without this it would be added and then removed again by the next
 * rollover, which reads as the app refusing to accept it.
 */
export function addGoalToWeek(week: WeekRecord, goal: WeeklyGoal): WeekRecord {
  const dismissed = (week.dismissed ?? []).filter((id) => id !== goal.id);
  return {
    ...week,
    goals: [...week.goals, goal],
    dismissed: dismissed.length > 0 ? dismissed : undefined,
  };
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
  /** Ceiling goals that went past their limit. Never folded into `missed`. */
  exceeded: GoalProgress[];
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
    // Its own bucket, not folded into `missed`. "Over by forty minutes" is information
    // about a limit you set yourself; calling it a failure would be the app disagreeing
    // with its own vocabulary.
    exceeded: goals.filter((g) => g.outcome === 'exceeded'),
  };
}

/** Empty week record for a key that has nothing stored yet. */
export function emptyWeek(week: string): WeekRecord {
  return { week, goals: [], credits: [] };
}

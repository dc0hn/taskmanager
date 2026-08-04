import type {
  HabitStore,
  RecurrenceRule,
  RecurringCompletion,
  RecurringTask,
  StreakInfo,
  Task,
} from './types';
import { addDays, toDateKey } from './utils/time';
import { uid } from './utils/id';
import { weekdayOf } from './week';

// ============================================================================
// Recurring tasks — routines and habits
//
// A recurring task is a template, not a stored instance. Nothing is written to a
// day until you actually put it there, which means:
//   • no background job has to run to "generate" tomorrow's tasks
//   • deleting one from a day doesn't need a tombstone to stop it reappearing
//   • the whole thing is a pure function of (templates, completions, date)
//
// Streaks are *derived* from the completion log rather than stored as a counter,
// for the same reason goal credits are a ledger: a counter drifts the first time
// something is un-ticked, and a derived value cannot.
// ============================================================================

/** How far back streak scanning will walk. Two years is far past useful. */
const MAX_SCAN_DAYS = 730;

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export function matchesRule(rule: RecurrenceRule, dateKey: string): boolean {
  const dow = weekdayOf(dateKey);
  switch (rule.kind) {
    case 'daily':
      return true;
    case 'weekdays':
      return dow >= 1 && dow <= 5;
    case 'days':
      return Array.isArray(rule.days) && rule.days.includes(dow);
    default:
      return false;
  }
}

export function describeRule(rule: RecurrenceRule): string {
  switch (rule.kind) {
    case 'daily':
      return 'Every day';
    case 'weekdays':
      return 'Weekdays';
    case 'days': {
      const days = [...new Set(rule.days)].sort((a, b) => a - b);
      if (days.length === 0) return 'Never';
      if (days.length === 7) return 'Every day';
      return days.map((d) => WEEKDAY_LABELS[d]).join(' · ');
    }
    default:
      return 'Never';
  }
}

/** Templates whose rule fires on `dateKey` and which are still active. */
export function templatesDueOn(
  templates: RecurringTask[],
  dateKey: string
): RecurringTask[] {
  return templates.filter(
    (t) => t.active && t.createdOn <= dateKey && matchesRule(t.rule, dateKey)
  );
}

// ---------------------------------------------------------------------------
// Completion log
// ---------------------------------------------------------------------------

export function isCompletedOn(
  completions: RecurringCompletion[],
  templateId: string,
  dateKey: string
): boolean {
  return completions.some((c) => c.templateId === templateId && c.date === dateKey);
}

/**
 * Reconcile the completion log against what a day's blocks actually say, the
 * same way goal credits are reconciled — one place that makes the log true,
 * rather than every mutation path remembering to update it.
 */
export function reconcileCompletions(
  completions: RecurringCompletion[],
  date: string,
  blocks: { templateId?: string; completed?: boolean; start: number; end: number }[]
): RecurringCompletion[] {
  const earned: RecurringCompletion[] = [];
  const seen = new Set<string>();
  for (const b of blocks) {
    if (!b.completed || !b.templateId) continue;
    const minutes = b.end - b.start;
    if (!Number.isFinite(minutes) || minutes <= 0) continue;
    // One completion per template per day, even if the work was split.
    if (seen.has(b.templateId)) {
      const existing = earned.find((e) => e.templateId === b.templateId);
      if (existing) existing.minutes += minutes;
      continue;
    }
    seen.add(b.templateId);
    earned.push({ templateId: b.templateId, date, minutes });
  }
  // Everything for this date is rebuilt from the blocks — EXCEPT checkmarks, which
  // have no block to be rebuilt from. Without this line every checkmark would be
  // erased by the next reconcile, which runs on any change to the day.
  const others = completions.filter((c) => c.date !== date || c.checked === true);
  return [...others, ...earned];
}

// ---------------------------------------------------------------------------
// Checkmarks
// ---------------------------------------------------------------------------

/**
 * The hour before which a check still counts as yesterday.
 *
 * Not a fudge. The app already holds that a day extends past midnight — a Monday block
 * ticked at 00:30 on Tuesday records 1470 minutes, not 30, because the alternative is
 * declaring that work finished before breakfast. This is the same rule applied to the
 * one thing most likely to be finished at half past midnight.
 */
export const GRACE_HOUR = 4;

/**
 * Which day a check made right now belongs to.
 *
 * Always shown in the UI rather than applied silently. A date decided for you and not
 * stated is indistinguishable from a bug the first time it surprises you.
 */
export function checkDateFor(now: Date = new Date()): string {
  const shifted = new Date(now);
  if (now.getHours() < GRACE_HOUR) shifted.setDate(shifted.getDate() - 1);
  return toDateKey(shifted);
}

/** True when the grace window is currently redirecting checks to yesterday. */
export function inGraceWindow(now: Date = new Date()): boolean {
  return now.getHours() < GRACE_HOUR;
}

/** Checkmark routines due on a date, active ones only. */
export function checkmarksDueOn(
  templates: RecurringTask[],
  dateKey: string
): RecurringTask[] {
  return templatesDueOn(templates, dateKey).filter((t) => t.checkmark === true);
}

/** Whether a checkmark is ticked on a date. */
export function isChecked(
  completions: RecurringCompletion[],
  templateId: string,
  date: string
): boolean {
  return completions.some(
    (c) => c.templateId === templateId && c.date === date && c.checked === true
  );
}

/**
 * Tick or untick a checkmark. Idempotent in both directions.
 *
 * Carries `minutes: 0` because a checkmark is not time. Everything that sums minutes —
 * the record, the month view, the study — therefore stays honest without needing to
 * know checkmarks exist.
 */
export function setChecked(
  completions: RecurringCompletion[],
  templateId: string,
  date: string,
  on: boolean
): RecurringCompletion[] {
  const without = completions.filter(
    (c) => !(c.templateId === templateId && c.date === date)
  );
  if (!on) return without;
  return [...without, { templateId, date, minutes: 0, checked: true }];
}

/** How many checkmarks were ticked on a date. */
export function checksOn(completions: RecurringCompletion[], date: string): number {
  return completions.filter((c) => c.date === date && c.checked === true).length;
}

/**
 * Bound the log's growth. One row per template per day is tiny, but this app is
 * meant to be lived in for years, so old rows are pruned on write.
 */
export function pruneCompletions(
  completions: RecurringCompletion[],
  today: string,
  keepDays = MAX_SCAN_DAYS
): RecurringCompletion[] {
  const cutoff = addDays(today, -keepDays);
  return completions.filter((c) => c.date >= cutoff);
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

/**
 * Derive streak state for one template.
 *
 * The subtle part is that only days matching the rule participate. A weekdays-only
 * habit must not have its streak broken by Saturday and Sunday — the weekend is
 * skipped, not counted as a miss. Equally, an incomplete *today* does not break
 * the streak: at 9am your twelve-day run should still read twelve, so the walk
 * starts from the previous matching day when today is still open.
 */
export function streakFor(
  template: RecurringTask,
  completions: RecurringCompletion[],
  now: Date = new Date()
): StreakInfo {
  const today = toDateKey(now);
  const mine = new Set(
    completions.filter((c) => c.templateId === template.id).map((c) => c.date)
  );

  const matchesToday =
    template.active &&
    template.createdOn <= today &&
    matchesRule(template.rule, today);
  const doneToday = matchesToday && mine.has(today);

  // Walk back over matching days only, counting the unbroken run. Today is
  // skipped when it is still open so an unfinished day never zeroes the streak.
  let current = 0;
  let cursor = doneToday ? today : addDays(today, -1);
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    if (cursor < template.createdOn) break;
    if (matchesRule(template.rule, cursor)) {
      if (!mine.has(cursor)) break;
      current++;
    }
    cursor = addDays(cursor, -1);
  }

  // Best run and completion rate over every matching day since creation.
  let best = 0;
  let run = 0;
  let matchingDays = 0;
  let completedDays = 0;
  let scan = template.createdOn;
  for (let i = 0; i < MAX_SCAN_DAYS && scan <= today; i++) {
    if (matchesRule(template.rule, scan)) {
      // An open today is not yet a miss, so it stays out of the denominator.
      const openToday = scan === today && !mine.has(scan);
      if (!openToday) {
        matchingDays++;
        if (mine.has(scan)) {
          completedDays++;
          run++;
          if (run > best) best = run;
        } else {
          run = 0;
        }
      }
    }
    scan = addDays(scan, 1);
  }

  return {
    current,
    best: Math.max(best, current),
    total: mine.size,
    rate: matchingDays > 0 ? completedDays / matchingDays : 0,
    dueToday: matchesToday && !doneToday,
    doneToday,
  };
}

export interface TemplateStatus {
  template: RecurringTask;
  streak: StreakInfo;
  /** True when this template already has a task or block on the day in question. */
  placed: boolean;
}

/**
 * Everything the UI needs about today's routines in one pass: which are due,
 * their streaks, and whether they have already been put on the day (so a chip
 * can show "done" rather than offering to add a duplicate).
 */
export function dueStatuses(
  store: HabitStore,
  dateKey: string,
  placedTemplateIds: Set<string>,
  now: Date = new Date()
): TemplateStatus[] {
  return templatesDueOn(store.templates, dateKey)
    // Checkmarks are excluded HERE, at the single point where routines are offered to
    // the day. That is what keeps them out of the scheduler entirely — the suggestion
    // chips, the intake and the build all read this one function, so there is no
    // second place a checkmark could leak into a timed block.
    .filter((t) => t.checkmark !== true)
    .map((template) => ({
    template,
    streak: streakFor(template, store.completions, now),
    placed: placedTemplateIds.has(template.id),
  }));
}

/** All templates with streak state, for the routines view. */
export function allStatuses(
  store: HabitStore,
  now: Date = new Date()
): TemplateStatus[] {
  return store.templates.map((template) => ({
    template,
    streak: streakFor(template, store.completions, now),
    placed: false,
  }));
}

// ---------------------------------------------------------------------------
// Turning a template into a task
// ---------------------------------------------------------------------------

/**
 * Instantiate a template as an intake task. The new task carries `templateId` so
 * completing it credits the streak, and is otherwise an ordinary task — the
 * parser and scheduler need no knowledge of recurrence.
 */
export function taskFromTemplate(template: RecurringTask): Task {
  return {
    id: uid(),
    title: template.label,
    duration: template.duration,
    category: template.category,
    fixedTime: template.fixedTime,
    priority: template.priority,
    templateId: template.id,
  };
}

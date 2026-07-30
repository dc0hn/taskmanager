// ============================================================================
// Almanac — core domain types
//
// Three layers of intent, from most to least granular:
//   Block          — a thing at a time on a specific day (the calendar surface)
//   Task           — a thing with a duration but no time yet (intake queue)
//   RecurringTask  — a thing that comes back on a rule (habits / routines)
//   WeeklyGoal     — a thing you mean to do N times this week (intentions)
//
// All times are integer minutes since midnight. All dates are 'YYYY-MM-DD'
// strings. No Date objects are ever stored.
// ============================================================================

// ---------------------------------------------------------------------------
// Categories
//
// Categories are user-definable, so `Category` is a plain string id rather than
// a closed union. What the *scheduler* needs to know about a category is not
// its id but its `kind` — that's the stable contract:
//
//   focus    frontloaded into the morning, split at the 90-min focus envelope
//   shallow  batched after focus work (admin, email, errands)
//   rest     resets the fatigue counter, so it suppresses a redundant auto-break
//   neutral  no special handling
//
// A brand new "Music practice" category set to `focus` therefore inherits
// morning priority and chunking without the scheduler knowing it exists.
// ---------------------------------------------------------------------------

export type Category = string;

export type CategoryKind = 'focus' | 'shallow' | 'rest' | 'neutral';

export const CATEGORY_KINDS: {
  id: CategoryKind;
  label: string;
  blurb: string;
}[] = [
  {
    id: 'focus',
    label: 'Focus',
    blurb: 'Frontloaded into the morning. Long sessions split at 90 minutes.',
  },
  {
    id: 'shallow',
    label: 'Shallow',
    blurb: 'Batched together after focus work, to limit context switching.',
  },
  {
    id: 'rest',
    label: 'Rest',
    blurb: 'Counts as recovery — suppresses the automatic break after it.',
  },
  {
    id: 'neutral',
    label: 'Neutral',
    blurb: 'No special scheduling treatment.',
  },
];

/**
 * A category as the user defines it. Only `accent` is stored as a colour —
 * every other shade (block fill, hairline, readable text) is derived from it at
 * runtime by `deriveCategoryColors`, so a custom category can never produce an
 * unreadable block.
 */
export interface CategoryDef {
  id: Category;
  label: string; // full, e.g. "Deep focus"
  short: string; // compact, used on blocks and chips
  kind: CategoryKind;
  accent: string; // hex — the single stored colour
  order: number; // display order, ascending
  builtin?: boolean; // builtins can be edited and hidden, but not deleted
}

/**
 * Shipped defaults. Tuned for legibility on the near-black surfaces — amber and
 * pink are deliberately *not* used here; they are reserved for state (now-line,
 * high priority, overflow) so state never collides with a category.
 */
export const DEFAULT_CATEGORIES: CategoryDef[] = [
  { id: 'deep', label: 'Deep focus', short: 'Deep', kind: 'focus', accent: '#8b7cf6', order: 0, builtin: true },
  { id: 'admin', label: 'Admin & email', short: 'Admin', kind: 'shallow', accent: '#4a9eff', order: 1, builtin: true },
  { id: 'break', label: 'Break / personal', short: 'Break', kind: 'rest', accent: '#3ecf8e', order: 2, builtin: true },
  { id: 'other', label: 'Other', short: 'Other', kind: 'neutral', accent: '#8b93a7', order: 3, builtin: true },
];

/** Swatches offered when creating or editing a category. */
export const CATEGORY_SWATCHES = [
  '#8b7cf6', // violet
  '#4a9eff', // blue
  '#3ecf8e', // green
  '#8b93a7', // slate
  '#f472b6', // pink
  '#ff9457', // orange
  '#22d3ee', // cyan
  '#facc15', // yellow
  '#a3e635', // lime
  '#fb7185', // rose
];

/**
 * Fallback used when a Block or Task references a category that has since been
 * deleted. Records are never dropped for this — an orphaned block renders in
 * neutral grey and stays editable.
 */
export const UNKNOWN_CATEGORY: CategoryDef = {
  id: '__unknown__',
  label: 'Uncategorised',
  short: '—',
  kind: 'neutral',
  accent: '#6b7488',
  order: 9999,
};

// ---------------------------------------------------------------------------
// Tasks and blocks
// ---------------------------------------------------------------------------

export interface Task {
  id: string;
  title: string;
  duration: number; // minutes
  category: Category;
  fixedTime?: number; // minutes since midnight
  priority: 'high' | 'normal';
  /** Set when this task came from a weekly goal, so completing it credits back. */
  goalId?: string;
  /** Set when this task came from a recurring template. */
  templateId?: string;
}

export interface Block {
  id: string;
  title: string;
  start: number; // minutes since midnight
  end: number; // minutes since midnight
  category: Category;
  completed?: boolean;
  /** True for synthetic blocks the scheduler owns (auto-breaks, shutdown). */
  auto?: boolean;
  /**
   * Marks this as a fixed commitment: manual rearrangement routes around it
   * rather than pushing it.
   *
   * A Task can say it has a `fixedTime`, but that information is consumed by the
   * scheduler and does not survive onto the Block — so without this flag there is
   * no way to tell a 2pm client call from an hour of flexible work once the day
   * has been built. Pinning resists being *displaced*; it does not stop you
   * dragging the block yourself.
   */
  pinned?: boolean;
  goalId?: string;
  templateId?: string;
}

export interface DayPlan {
  date: string; // YYYY-MM-DD
  tasks: Task[]; // unscheduled
  blocks: Block[]; // scheduled
}

// ---------------------------------------------------------------------------
// Weekly goals
//
// Keyed by the date of the week's Monday ('YYYY-MM-DD'), never an ISO week
// number — see src/week.ts for why.
// ---------------------------------------------------------------------------

export type GoalTargetKind = 'sessions' | 'minutes';

/**
 * How a goal behaves at the week boundary.
 *
 *   weekly   A standing intention. Reissues at its FULL target every Monday and
 *            records a deferral when it slips — a habit's weekly target is the
 *            point, so carrying a reduced remainder would be wrong. It never
 *            enters the carryover pile, because it is already in the new week.
 *   oneOff   A finite piece of work. When it slips, what carries is the residual
 *            (what is actually still owed), and it waits in the carryover pile
 *            until pulled.
 */
export type GoalCadence = 'weekly' | 'oneOff';

export interface WeeklyGoal {
  id: string;
  label: string;
  category: Category;
  targetKind: GoalTargetKind;
  target: number; // 3 sessions, or 180 minutes
  sessionMinutes: number; // estimated per-session length; feeds the intake chip
  cadence: GoalCadence;
  /** False pauses a weekly goal from reissuing, without discarding its history. */
  active: boolean;
  deferrals: number; // how many weeks this has been carried; 0 when fresh
  originWeek: string; // Monday key it was first created in
  /**
   * Set when the goal was deliberately stood down for this week.
   *
   * "I decided not to" and "I failed to" are different facts about a week, and
   * collapsing them corrupts the only signal the review exists to produce. A
   * voided goal carries nothing and takes no deferral penalty.
   */
  voided?: boolean;
}

/**
 * One earned credit, keyed by the block that earned it. Keying on blockId makes
 * crediting idempotent and reversible: un-ticking a block removes its entry
 * rather than decrementing a counter that could drift.
 */
export interface GoalCredit {
  goalId: string;
  blockId: string;
  date: string; // YYYY-MM-DD
  minutes: number;
}

export interface WeekRecord {
  week: string; // Monday date key
  goals: WeeklyGoal[];
  credits: GoalCredit[];
  /** Set once rollover has resolved this week, making rollover idempotent. */
  resolved?: boolean;
}

export interface CarryoverItem {
  goal: WeeklyGoal; // carries its own deferral count
  /**
   * What is still owed, in the goal's own target units.
   *
   * On a repeat slip this consolidates as max(old, new) and is never summed.
   * Summation is the debt spiral in arithmetic form: a 3-session goal missed
   * three times becomes a 9-session week nobody hits, and an unhittable target
   * gets the app closed. The pressure to act comes from the deferral count.
   */
  residual: number;
  /** How long this has been sitting here — the uncomfortable number. */
  firstDeferredWeek: string;
  lastWeek: string; // the week it most recently slipped in
  lastProgress: { done: number; target: number };
}

export type GoalOutcome = 'met' | 'partial' | 'missed' | 'void';

// ---------------------------------------------------------------------------
// Monthly record
//
// A second statistic above the week, for standing (weekly-cadence) goals only.
// The monthly target is the weekly total pro-rated by the length of the month —
// see src/month.ts — so 100% means "kept pace" whether the month is 28 days or
// 31, and the weekly figures are left exactly as they are.
//
// Stored rather than derived, because goal credits are pruned after twelve weeks
// and a week's outcome is computed from them rather than saved. Without a sealed
// summary there would be nothing to show beyond about three months.
// ---------------------------------------------------------------------------

export interface MonthlyGoalSummary {
  goalId: string;
  /** Snapshotted, so a renamed or deleted goal still reads correctly in history. */
  label: string;
  category: Category;
  targetKind: GoalTargetKind;
  /** The weekly total this was measured against. */
  weeklyTarget: number;
  /** weeklyTarget × daysInMonth ÷ 7, unrounded. */
  monthlyTarget: number;
  /** Sessions (distinct days) or minutes, matching targetKind. */
  done: number;
  /** How many weeks in the month the goal was actually issued. */
  weeksIssued: number;
  /** done ÷ monthlyTarget. May exceed 1. */
  ratio: number;
}

/** A carryover item emptied from the pile when its month was sealed. */
export interface ClearedCarryover {
  goalId: string;
  label: string;
  category: Category;
  targetKind: GoalTargetKind;
  residual: number;
  deferrals: number;
  firstDeferredWeek: string;
  lastWeek: string;
}

export interface MonthRecord {
  month: string; // 'YYYY-MM'
  daysInMonth: number;
  /** Day key the seal actually ran; empty for a month still in progress. */
  sealedOn: string;
  goals: MonthlyGoalSummary[];
  /** What was carried and then let go when the month closed. */
  cleared: ClearedCarryover[];
  /**
   * Mean of the per-goal ratios. Sessions and minutes cannot be summed, so a
   * weighted total is unavailable; averaging the fractions is the honest option.
   */
  overall: number;
}

export interface GoalProgress {
  goal: WeeklyGoal;
  /** Distinct days credited — one sitting per day, so chunked work counts once. */
  sessions: number;
  minutes: number;
  /** Progress against whichever target kind the goal uses. */
  done: number;
  target: number;
  outcome: GoalOutcome;
}

// ---------------------------------------------------------------------------
// Recurring tasks (habits / routines)
// ---------------------------------------------------------------------------

export type RecurrenceRule =
  | { kind: 'daily' }
  | { kind: 'weekdays' } // Mon–Fri
  | { kind: 'days'; days: number[] }; // 0 = Sunday … 6 = Saturday

export interface RecurringTask {
  id: string;
  label: string;
  category: Category;
  duration: number; // minutes
  priority: 'high' | 'normal';
  fixedTime?: number; // optional anchor, e.g. a 7am stretch
  rule: RecurrenceRule;
  createdOn: string; // date key — streaks never count days before this
  active: boolean;
}

/** One completion of a recurring task on a given day. */
export interface RecurringCompletion {
  templateId: string;
  date: string; // YYYY-MM-DD
  minutes: number;
}

export interface HabitStore {
  templates: RecurringTask[];
  completions: RecurringCompletion[];
}

export interface StreakInfo {
  /** Consecutive *matching* days completed, counting back from today. */
  current: number;
  /** Best run ever recorded. */
  best: number;
  /** Total completions on record. */
  total: number;
  /** Of the matching days since creation, how many were completed. */
  rate: number; // 0..1
  /** True when today matches the rule and is not yet completed. */
  dueToday: boolean;
  /** True when today matches the rule and is already completed. */
  doneToday: boolean;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export type ViewMode = 'day' | 'week' | 'month';

export interface Settings {
  workingStart: number; // minutes since midnight
  workingEnd: number;
}

export const DEFAULT_SETTINGS: Settings = {
  workingStart: 8 * 60,
  workingEnd: 19 * 60,
};

// Note: the week deliberately always starts on Monday, and is not configurable.
// Week records are *keyed* by their Monday (see src/week.ts), so a configurable
// week start would mean either re-keying every stored week when the setting
// changed, or letting a Sunday-first grid straddle two stored weeks — which
// would quietly split a weekly goal's credits across two records.

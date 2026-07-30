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
  /**
   * Minutes since midnight OF THIS BLOCK'S DATE, recorded when it was ticked.
   *
   * Past midnight it keeps counting — ticking a Monday block at 00:30 on Tuesday
   * stores 1470, not 30. Without that a block finished in the small hours would
   * score as though it had been finished before breakfast.
   *
   * Absent on every block completed before this was introduced, so anything
   * reading it must treat absence as "unknown", never as "late".
   */
  completedAt?: number;
  /**
   * Carried from the Task this block came from, so effort can be weighted after
   * the fact. The scheduler still reads priority off the Task; this is a record of
   * what that priority was, not an input to placing anything.
   */
  priority?: 'high' | 'normal';
  /**
   * How many times YOU moved this block — dragged it or sent it to another day.
   *
   * Deliberately not incremented by reflow displacement: one drag can push six
   * blocks down, and counting those would mark all seven as rescheduled and make
   * the number meaningless.
   */
  moves?: number;
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
// Day marks
//
// A whole-day quality — Travel, Gig, Off — as opposed to a category, which
// describes a block of work. Deliberately its own taxonomy: putting "Gig" in the
// intake category picker, the scheduler's kind system and the time-allotted
// breakdown would be nonsense, because it is not time you spend, it is what the
// day *is*.
//
// One mark per date. A split-cell indicator for multiple marks was considered and
// rejected in favour of a single clean wash per day.
// ---------------------------------------------------------------------------

export interface DayMarkDef {
  id: string;
  label: string;
  /** How the mark looks in Almanac; every other shade derives from it. */
  color: string;
  /**
   * The colour this mark wears in the OTHER calendar, matched by hue on import.
   *
   * Separate from `color` because the source's palette is not Almanac's. A gig in
   * Apple Calendar is amber, and amber here is the reserved signal colour — so the
   * mark can read pink on screen while still recognising amber in a screenshot.
   * Falls back to `color` when unset, which is right for a mark you never import.
   */
  sourceColor?: string;
  order: number;
}

/** date key -> mark id. Absent means unmarked. */
export type DayMarks = Record<string, string>;

/**
 * Two marks, not three, because two is what a touring schedule actually needs.
 *
 * The source colours are measured off a real Apple Calendar screenshot: travel
 * events are teal (hue 173) and gig events amber (hue 33). Teal doubles as the
 * display colour since nothing else here is teal, but gigs display pink — amber is
 * the reserved signal, and a month of amber gig days would drown it.
 */
export const DEFAULT_DAY_MARKS: DayMarkDef[] = [
  { id: 'travel', label: 'Travel', color: '#17a398', sourceColor: '#1f6058', order: 0 },
  { id: 'gig', label: 'Gig', color: '#f472b6', sourceColor: '#654621', order: 1 },
];

// ---------------------------------------------------------------------------
// Progression
//
// XP is a second reading of the same facts the calendar already records. Nothing
// here is an input to scheduling; it is all derived from blocks and their
// completion, which is what keeps it additive.
// ---------------------------------------------------------------------------

export type DisciplineId = 'focus' | 'endurance' | 'consistency' | 'planning' | 'insight';

/** Lifetime standing. Only `brass` ever decreases. */
export interface UserProgress {
  /** Lifetime XP. Never spent, never falls. */
  totalXp: number;
  /** Spendable currency, minted alongside XP. This is the balance. */
  brass: number;
  /**
   * Lifetime brass spent. Only ever rises, and only when something is bought.
   *
   * Lifetime *earned* is deliberately NOT stored: it is `brass + brassSpent`, so it
   * cannot disagree with the balance. Storing it as its own accumulator meant a
   * transient miscount could inflate it permanently — and one did, growing the
   * figure by several hundred on every launch while the balance stayed correct.
   */
  brassSpent: number;
  /**
   * The day scoring began. Nothing before it is ever counted.
   *
   * Replaces an earlier backfill marker. Scoring the archive gave a new user a level
   * they had not played for, and a reset that only zeroed the total would silently
   * re-earn it the next time the month view loaded those days. An explicit start date
   * is the only thing that makes "from today" mean it.
   */
  startedOn: string;
  /**
   * XP accumulated by disciplines that are not derived from blocks.
   *
   * Planning and Insight come from one-off bonuses rather than from completed time,
   * so there is nothing to recompute them from — they have to be banked. Focus and
   * Endurance are derived from blocks and deliberately are NOT stored here, because a
   * stored copy could disagree with the blocks it came from.
   */
  disciplines?: Partial<Record<DisciplineId, number>>;
}

/** One day's reckoning. Recomputed from the day's blocks, never accumulated. */
export interface DailyStat {
  date: string;
  plannedMinutes: number;
  doneMinutes: number;
  xpEarned: number;
  brassEarned: number;
  /** Longest run of in-order completions that day. */
  bestCombo: number;
  cleared: boolean;
  /** Blocks ticked that day. Needed to count achievements without keeping plans. */
  completedCount: number;
  /** Completed minutes in focus-kind categories. */
  focusMinutes: number;
}

/** A single line of the day's ledger, for display. */
export interface XpLine {
  /** Block id, or a synthetic id for a day-level bonus. */
  id: string;
  label: string;
  xp: number;
  minutes: number;
  /** Multipliers that applied, already folded into `xp`. */
  notes: string[];
}

/**
 * What a resolved day did to the streak.
 *
 *   advanced  the threshold was met; the run grows
 *   held      a travel or gig day, or a marked day you didn't finish — run keeps
 *   neutral   nothing was planned, so there was nothing to fail
 *   frozen    below the threshold, and a freeze absorbed it
 *   reset     below the threshold with no freeze left — run starts again
 *   open      today, still in play
 *
 * Four of the six keep the run and none of them is a failure state. That is the
 * point: the only way to lose a run is a day you planned work, didn't do it, and
 * had already spent your freeze.
 */
export type DayOutcome = 'advanced' | 'held' | 'neutral' | 'frozen' | 'reset' | 'open';

export interface StreakState {
  /** Days in the current run, not counting today. */
  current: number;
  longest: number;
  /** Last date resolved. Everything up to and including this is settled. */
  resolvedThrough: string;
  /** Freezes in hand. */
  freezes: number;
  /** How many freezes can be held at once. The shop can raise this. */
  capacity: number;
  /** Date the allowance last refilled. */
  refilledOn: string;
  /** Dates a freeze was spent on, newest last. */
  frozenDates: string[];
  /** Date the current run began. */
  startedOn: string;
  /** Date of the most recent reset, or empty if never. */
  lastResetOn: string;
  /** XP the Consistency discipline has accumulated from kept days. */
  consistencyXp: number;
}

/**
 * One-off awards already granted, by key.
 *
 * A flat set of strings rather than a field per award, because one-off grants are
 * exactly the shape that drifts: pay a comeback bonus twice and the total is wrong
 * forever with no way to tell. Checking a key before granting makes every one of
 * them idempotent, and achievements will use the same ledger.
 */
export interface AwardLedger {
  granted: string[];
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------

export type BadgeGroup = 'milestone' | 'behaviour' | 'effort';

export interface BadgeDef {
  id: string;
  name: string;
  /** What it took. Shown once unlocked, and for visible badges before that too. */
  description: string;
  group: BadgeGroup;
  /**
   * Hidden badges show as a sealed slot until earned.
   *
   * Reserved for the surprising ones. A hidden milestone would just be a missing
   * signpost, but a hidden behavioural badge is a small discovery — and knowing in
   * advance that finishing something before 9am pays would turn it into a chore.
   */
  hidden?: boolean;
  xp: number;
  /** Pixel glyph index, 0..7, drawn from the sigil set. */
  glyph: number;
  /** For badges that count up, so progress can be shown. */
  target?: number;
  /**
   * Badges on the same ladder render as one tile with a staged meter.
   *
   * Four near-identical "complete N blocks" cards taught the eye to skip that whole
   * region of the shelf. One tile showing 1 → 10 → 50 → 250 says the same thing and
   * reads as a single climbing thing rather than four separate ones.
   */
  ladder?: string;
  /** Rung name shown on a ladder tile, e.g. "50". */
  rung?: string;
}

export interface DisciplineDef {
  id: DisciplineId;
  label: string;
  /** What it measures, in one line. */
  blurb: string;
  /** False until the feature that feeds it exists. */
  live: boolean;
}

export const DISCIPLINES: DisciplineDef[] = [
  { id: 'focus', label: 'Focus', blurb: 'Deep work completed', live: true },
  { id: 'endurance', label: 'Endurance', blurb: 'Long blocks seen through', live: true },
  { id: 'consistency', label: 'Consistency', blurb: 'Streaks kept', live: true },
  { id: 'planning', label: 'Planning', blurb: 'Days built before they arrive', live: true },
  { id: 'insight', label: 'Insight', blurb: 'What you have learned about yourself', live: true },
];

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

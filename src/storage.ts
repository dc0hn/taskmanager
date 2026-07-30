import { DEFAULT_CATEGORIES, DEFAULT_DAY_MARKS, DEFAULT_SETTINGS } from './types';
import type {
  AwardLedger,
  Block,
  CarryoverItem,
  Category,
  CategoryDef,
  CategoryKind,
  ClearedCarryover,
  DailyStat,
  DayMarkDef,
  DisciplineId,
  DayMarks,
  GoalCredit,
  HabitStore,
  DayPlan,
  MonthlyGoalSummary,
  MonthRecord,
  RecurrenceRule,
  RecurringCompletion,
  RecurringTask,
  Settings,
  StreakState,
  Task,
  UserProgress,
  WeeklyGoal,
  WeekRecord,
} from './types';
import { uid } from './utils/id';
import { emptyProgress } from './progress';
import { DAY_END } from './reflow';
import { emptyAwards, emptyStreak } from './streaks';
import { emptyShop, itemById, pruneBoostedDates, type ShopState } from './shop';
import type { Commission } from './commissions';
import { isSeasonKey, seasonRange, type SeasonRecord } from './seasons';
import { toDateKey } from './utils/time';

// ============================================================================
// Persistence
//
// Everything lives in localStorage. Inside Tauri that is a SQLite file under
// ~/Library/WebKit/com.dc0hn.almanac/ — note that the browser dev server has a
// completely separate store, so plans made at localhost:5173 will not appear in
// the packaged app. Use `npm run tauri:dev` to work against real data.
//
// Two invariants hold throughout:
//   1. Every read is validated. Corrupt or hand-edited records are dropped or
//      repaired rather than allowed to flow NaN into timeline geometry, which
//      would blank the window.
//   2. Every write is guarded. A quota failure logs and moves on; it never
//      throws into a render effect.
// ============================================================================

const PLAN_PREFIX = 'dp:plan:';
const WEEK_PREFIX = 'dp:week:';
const MONTH_PREFIX = 'dp:month:';
const SETTINGS_KEY = 'dp:settings:v2';
const CATEGORIES_KEY = 'dp:categories:v1';
const CARRYOVER_KEY = 'dp:carryover:v1';
const HABITS_KEY = 'dp:habits:v1';
const PROGRESS_KEY = 'dp:progress:v1';
const DAY_STATS_KEY = 'dp:daystats:v1';
const STREAK_KEY = 'dp:streak:v1';
const AWARDS_KEY = 'dp:awards:v1';
const SHOP_KEY = 'dp:shop:v1';
const COMMISSIONS_KEY = 'dp:commissions:v1';
const SEASON_PREFIX = 'dp:season:';
const MARK_DEFS_KEY = 'dp:markdefs:v1';
const DAY_MARKS_KEY = 'dp:daymarks:v1';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * A date key that names a day that actually exists.
 *
 * The shape check alone passed '2026-13-45', which every loader here then treated as
 * a real day. Nothing in the app can produce one, but a hand-edited or truncated
 * backup can, and the result is a record keyed to a day no view can ever reach —
 * invisible, uncountable, and impossible to delete from the UI.
 *
 * Round-tripping through Date is what catches it: February 30th normalises to March
 * 2nd, so a mismatch means the original was never a date.
 */
const isDateKey = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const [y, m, d] = v.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(y, m - 1, d);
  return (
    probe.getFullYear() === y && probe.getMonth() === m - 1 && probe.getDate() === d
  );
};

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

/**
 * Categories are user-definable, so any non-empty string is a legitimate id here.
 * Validation deliberately does NOT check the id against the live category list:
 * a block referencing a category that was later deleted must survive and stay
 * editable, resolving to a neutral placeholder at render time (see
 * `resolveCategory`). Dropping it would silently destroy real work.
 */
const toCategoryId = (v: unknown): Category => {
  const s = str(v).trim();
  return s.length > 0 ? s : 'other';
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Almanac: write failed for ${key}`, e);
  }
}

/**
 * Every key with a given prefix. Previously this logic was inlined in
 * `listPlanDates`, which nothing called — it was scaffolding waiting for exactly
 * the week-history feature that now uses it.
 */
function listKeys(prefix: string): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix)) out.push(key.slice(prefix.length));
    }
  } catch (e) {
    console.error('Almanac: key enumeration failed', e);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Day plans
// ---------------------------------------------------------------------------

function normalizeTask(r: unknown): Task | null {
  if (!r || typeof r !== 'object') return null;
  const t = r as Record<string, unknown>;
  if (typeof t.title !== 'string') return null;
  return {
    id: str(t.id) || uid(),
    title: t.title,
    duration: isFiniteNum(t.duration) && t.duration > 0 ? t.duration : 60,
    category: toCategoryId(t.category),
    fixedTime: isFiniteNum(t.fixedTime) ? t.fixedTime : undefined,
    priority: t.priority === 'high' ? 'high' : 'normal',
    goalId: str(t.goalId) || undefined,
    templateId: str(t.templateId) || undefined,
  };
}

function normalizeBlock(r: unknown): Block | null {
  if (!r || typeof r !== 'object') return null;
  const b = r as Record<string, unknown>;
  // Bounded to the day, not merely ordered. `end > start` alone let an imported or
  // hand-edited profile carry a block past midnight, which is the state the reflow
  // ceiling now prevents from being created — this stops it being read back in.
  if (
    typeof b.title !== 'string' ||
    !isFiniteNum(b.start) ||
    !isFiniteNum(b.end) ||
    b.end <= b.start ||
    b.start < 0 ||
    b.end > DAY_END
  ) {
    return null;
  }
  return {
    id: str(b.id) || uid(),
    title: b.title,
    start: b.start,
    end: b.end,
    category: toCategoryId(b.category),
    completed: b.completed === true,
    auto: b.auto === true,
    pinned: b.pinned === true,
    goalId: str(b.goalId) || undefined,
    templateId: str(b.templateId) || undefined,
    // Carried through explicitly. A normaliser that drops a field is not a
    // formatting detail — it is a silent behaviour change one reload later.
    completedAt: isFiniteNum(b.completedAt) && b.completedAt >= 0 ? b.completedAt : undefined,
    priority: b.priority === 'high' ? 'high' : undefined,
    moves: isFiniteNum(b.moves) && b.moves > 0 ? Math.floor(b.moves) : undefined,
  };
}

export function loadPlan(date: string): DayPlan {
  const parsed = read<Record<string, unknown>>(PLAN_PREFIX + date);
  if (!parsed) return { date, tasks: [], blocks: [] };
  return {
    date,
    tasks: Array.isArray(parsed.tasks)
      ? (parsed.tasks.map(normalizeTask).filter(Boolean) as Task[])
      : [],
    blocks: Array.isArray(parsed.blocks)
      ? (parsed.blocks.map(normalizeBlock).filter(Boolean) as Block[])
      : [],
  };
}

/** Load many days at once — the week and month grids need all of them. */
export function loadPlans(dates: string[]): Record<string, DayPlan> {
  const out: Record<string, DayPlan> = {};
  for (const d of dates) out[d] = loadPlan(d);
  return out;
}

export function savePlan(plan: DayPlan): void {
  if (!isDateKey(plan.date)) {
    console.error('Almanac: refusing to save plan with invalid date', plan.date);
    return;
  }
  const fresh = planDateCache != null && !planDateCache.includes(plan.date);
  write(PLAN_PREFIX + plan.date, plan);
  // Only a NEW date changes the answer. Overwriting a plan that already exists leaves the
  // set of dates identical, and re-scanning for it would undo the point of caching —
  // savePlan runs on a debounce after every edit.
  if (fresh) planDateCache = null;
}

/**
 * Every date that has a stored plan, ascending.
 *
 * Cached, because this is an O(all keys) walk of the entire store and its result changes
 * only when a plan is created. It sits behind the codex's ninety-day window and behind
 * `authoritativeDates`, which recomputes whenever `plans` changes — so on a store with a
 * few years of history it was being re-enumerated on something close to every keystroke.
 *
 * Invalidated by `savePlan` when the date is new, and by anything that rewrites the store
 * wholesale. A stale cache here would mean a day's plan existing but not being counted as
 * authoritative, which suppresses reconciliation rather than corrupting it — but it would
 * still be wrong, so the invalidation points are deliberately few and explicit.
 */
let planDateCache: string[] | null = null;
/**
 * Which store the cache belongs to.
 *
 * Module-level caches and swapped globals do not mix: the test suites replace
 * `globalThis.localStorage` between cases, and a cache surviving that swap would answer
 * for the wrong store. Comparing the reference costs nothing and makes the invalidation
 * automatic rather than something every caller has to remember.
 */
let cachedStore: unknown = null;

export function listPlanDates(): string[] {
  const store = typeof localStorage === 'undefined' ? null : localStorage;
  if (planDateCache == null || cachedStore !== store) {
    planDateCache = listKeys(PLAN_PREFIX).filter(isDateKey);
    cachedStore = store;
  }
  return planDateCache;
}

/** Drop the cache. For imports and restores, which replace arbitrary records. */
export function invalidatePlanDates(): void {
  planDateCache = null;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function loadSettings(): Settings {
  const parsed = read<Record<string, unknown>>(SETTINGS_KEY);
  if (!parsed) return DEFAULT_SETTINGS;
  // Clamped into the day as well as validated. The working window sets the grid's
  // visible range, which in turn sets the drag clamp — so an out-of-range `workingEnd`
  // would draw a time axis past midnight and let a drag follow it there, which is the
  // same failure the reflow ceiling exists to prevent, arriving by a different door.
  const bound = (v: number) => Math.min(DAY_END, Math.max(0, Math.round(v)));
  const start = isFiniteNum(parsed.workingStart)
    ? bound(parsed.workingStart)
    : DEFAULT_SETTINGS.workingStart;
  const end = isFiniteNum(parsed.workingEnd)
    ? bound(parsed.workingEnd)
    : DEFAULT_SETTINGS.workingEnd;
  // A window that is inverted or empty would make the scheduler return
  // everything as overflow and render a zero-height timeline.
  if (end <= start) return DEFAULT_SETTINGS;
  return {
    workingStart: start,
    workingEnd: end,
    useInsightScheduling: parsed.useInsightScheduling === true,
  };
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const KINDS: CategoryKind[] = ['focus', 'shallow', 'rest', 'neutral'];

const toKind = (v: unknown): CategoryKind =>
  KINDS.includes(v as CategoryKind) ? (v as CategoryKind) : 'neutral';

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normalizeCategory(r: unknown, index: number): CategoryDef | null {
  if (!r || typeof r !== 'object') return null;
  const c = r as Record<string, unknown>;
  const id = str(c.id).trim();
  const label = str(c.label).trim();
  if (!id || !label) return null;
  const accent = str(c.accent).trim();
  return {
    id,
    label,
    short: str(c.short).trim() || label.split(' ')[0],
    kind: toKind(c.kind),
    accent: HEX_RE.test(accent) ? accent : '#8b93a7',
    order: isFiniteNum(c.order) ? c.order : index,
    builtin: c.builtin === true,
  };
}

/**
 * A user with no stored categories gets the shipped defaults — never an empty
 * list, which would leave every existing block orphaned and the pickers blank.
 */
export function loadCategories(): CategoryDef[] {
  const parsed = read<unknown>(CATEGORIES_KEY);
  if (!Array.isArray(parsed)) return DEFAULT_CATEGORIES;
  const cleaned = parsed
    .map((r, i) => normalizeCategory(r, i))
    .filter(Boolean) as CategoryDef[];

  // Deduplicate by id, first occurrence wins.
  const seen = new Set<string>();
  const unique = cleaned.filter((c) => {
    if (seen.has(c.id)) return false;
    seen.add(c.id);
    return true;
  });

  if (unique.length === 0) return DEFAULT_CATEGORIES;
  return unique.sort((a, b) => a.order - b.order);
}

export function saveCategories(categories: CategoryDef[]): void {
  write(CATEGORIES_KEY, categories);
}

// ---------------------------------------------------------------------------
// Weekly goals
// ---------------------------------------------------------------------------

function normalizeGoal(r: unknown): WeeklyGoal | null {
  if (!r || typeof r !== 'object') return null;
  const g = r as Record<string, unknown>;
  const label = str(g.label).trim();
  if (!label) return null;
  const targetKind = g.targetKind === 'minutes' ? 'minutes' : 'sessions';
  const target = isFiniteNum(g.target) && g.target > 0 ? Math.round(g.target) : 1;
  const sessionMinutes =
    isFiniteNum(g.sessionMinutes) && g.sessionMinutes > 0
      ? Math.round(g.sessionMinutes)
      : 60;
  return {
    id: str(g.id) || uid(),
    label,
    category: toCategoryId(g.category),
    targetKind,
    target,
    sessionMinutes,
    // Records written before cadence existed default to oneOff, which is the
    // conservative choice: an old goal will never silently start reissuing.
    cadence: g.cadence === 'weekly' ? 'weekly' : 'oneOff',
    active: g.active !== false,
    deferrals: isFiniteNum(g.deferrals) && g.deferrals >= 0 ? Math.round(g.deferrals) : 0,
    originWeek: isDateKey(g.originWeek) ? g.originWeek : '',
    voided: g.voided === true,
  };
}

function normalizeCredit(r: unknown): GoalCredit | null {
  if (!r || typeof r !== 'object') return null;
  const c = r as Record<string, unknown>;
  const goalId = str(c.goalId);
  const blockId = str(c.blockId);
  if (!goalId || !blockId || !isDateKey(c.date)) return null;
  if (!isFiniteNum(c.minutes) || c.minutes <= 0) return null;
  return { goalId, blockId, date: c.date, minutes: Math.round(c.minutes) };
}

export function loadWeek(weekKey: string): WeekRecord {
  const parsed = read<Record<string, unknown>>(WEEK_PREFIX + weekKey);
  if (!parsed) return { week: weekKey, goals: [], credits: [] };
  return {
    week: weekKey,
    goals: Array.isArray(parsed.goals)
      ? (parsed.goals.map(normalizeGoal).filter(Boolean) as WeeklyGoal[])
      : [],
    credits: Array.isArray(parsed.credits)
      ? (parsed.credits.map(normalizeCredit).filter(Boolean) as GoalCredit[])
      : [],
    resolved: parsed.resolved === true,
  };
}

export function saveWeek(week: WeekRecord): void {
  if (!isDateKey(week.week)) {
    console.error('Almanac: refusing to save week with invalid key', week.week);
    return;
  }
  write(WEEK_PREFIX + week.week, week);
}

/** Every stored week key, ascending — rollover depends on this order. */
export function listWeekKeys(): string[] {
  return listKeys(WEEK_PREFIX).filter(isDateKey);
}

export function loadAllWeeks(): WeekRecord[] {
  return listWeekKeys().map(loadWeek);
}

// ---------------------------------------------------------------------------
// Carryover
// ---------------------------------------------------------------------------

function normalizeCarryover(r: unknown): CarryoverItem | null {
  if (!r || typeof r !== 'object') return null;
  const c = r as Record<string, unknown>;
  const goal = normalizeGoal(c.goal);
  if (!goal) return null;
  const progress = (c.lastProgress ?? {}) as Record<string, unknown>;
  const lastWeek = isDateKey(c.lastWeek) ? c.lastWeek : '';
  return {
    goal,
    // Records written before `residual` existed fall back to the goal's target,
    // which is what the previous carry semantics stored anyway.
    residual:
      isFiniteNum(c.residual) && c.residual > 0 ? Math.round(c.residual) : goal.target,
    firstDeferredWeek: isDateKey(c.firstDeferredWeek) ? c.firstDeferredWeek : lastWeek,
    lastWeek,
    lastProgress: {
      done: isFiniteNum(progress.done) && progress.done >= 0 ? progress.done : 0,
      target: isFiniteNum(progress.target) && progress.target > 0 ? progress.target : 1,
    },
  };
}

export function loadCarryover(): CarryoverItem[] {
  const parsed = read<unknown>(CARRYOVER_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(normalizeCarryover).filter(Boolean) as CarryoverItem[];
}

export function saveCarryover(items: CarryoverItem[]): void {
  write(CARRYOVER_KEY, items);
}

// ---------------------------------------------------------------------------
// Recurring tasks
// ---------------------------------------------------------------------------

function normalizeRule(r: unknown): RecurrenceRule {
  if (!r || typeof r !== 'object') return { kind: 'daily' };
  const rule = r as Record<string, unknown>;
  if (rule.kind === 'weekdays') return { kind: 'weekdays' };
  if (rule.kind === 'days') {
    const days = Array.isArray(rule.days)
      ? [...new Set(rule.days.filter((d): d is number => isFiniteNum(d) && d >= 0 && d <= 6))]
      : [];
    // A 'days' rule with nothing selected would never fire and would read as a
    // silently broken routine; fall back to daily.
    return days.length > 0 ? { kind: 'days', days: days.sort() } : { kind: 'daily' };
  }
  return { kind: 'daily' };
}

function normalizeTemplate(r: unknown): RecurringTask | null {
  if (!r || typeof r !== 'object') return null;
  const t = r as Record<string, unknown>;
  const label = str(t.label).trim();
  if (!label) return null;
  return {
    id: str(t.id) || uid(),
    label,
    category: toCategoryId(t.category),
    duration: isFiniteNum(t.duration) && t.duration > 0 ? Math.round(t.duration) : 30,
    priority: t.priority === 'high' ? 'high' : 'normal',
    fixedTime:
      isFiniteNum(t.fixedTime) && t.fixedTime >= 0 && t.fixedTime < 1440
        ? Math.round(t.fixedTime)
        : undefined,
    rule: normalizeRule(t.rule),
    createdOn: isDateKey(t.createdOn) ? t.createdOn : '1970-01-01',
    active: t.active !== false,
  };
}

function normalizeCompletion(r: unknown): RecurringCompletion | null {
  if (!r || typeof r !== 'object') return null;
  const c = r as Record<string, unknown>;
  const templateId = str(c.templateId);
  if (!templateId || !isDateKey(c.date)) return null;
  if (!isFiniteNum(c.minutes) || c.minutes <= 0) return null;
  return { templateId, date: c.date, minutes: Math.round(c.minutes) };
}

export function loadHabits(): HabitStore {
  const parsed = read<Record<string, unknown>>(HABITS_KEY);
  if (!parsed) return { templates: [], completions: [] };
  return {
    templates: Array.isArray(parsed.templates)
      ? (parsed.templates.map(normalizeTemplate).filter(Boolean) as RecurringTask[])
      : [],
    completions: Array.isArray(parsed.completions)
      ? (parsed.completions
          .map(normalizeCompletion)
          .filter(Boolean) as RecurringCompletion[])
      : [],
  };
}

export function saveHabits(store: HabitStore): void {
  write(HABITS_KEY, store);
}

// ---------------------------------------------------------------------------
// Monthly records
//
// Sealed summaries of how standing weekly goals fared over a calendar month.
// These are written rather than derived because goal credits are pruned after
// twelve weeks — without them there would be no history to show.
// ---------------------------------------------------------------------------

const MONTH_RE = /^\d{4}-\d{2}$/;
const isMonthKey = (v: unknown): v is string =>
  typeof v === 'string' && MONTH_RE.test(v);

function normalizeMonthGoal(r: unknown): MonthlyGoalSummary | null {
  if (!r || typeof r !== 'object') return null;
  const g = r as Record<string, unknown>;
  const goalId = str(g.goalId);
  const label = str(g.label).trim();
  if (!goalId || !label) return null;
  const monthlyTarget =
    isFiniteNum(g.monthlyTarget) && g.monthlyTarget > 0 ? g.monthlyTarget : 1;
  const done = isFiniteNum(g.done) && g.done >= 0 ? g.done : 0;
  return {
    goalId,
    label,
    category: toCategoryId(g.category),
    targetKind: g.targetKind === 'minutes' ? 'minutes' : 'sessions',
    weeklyTarget:
      isFiniteNum(g.weeklyTarget) && g.weeklyTarget > 0 ? Math.round(g.weeklyTarget) : 1,
    monthlyTarget,
    done,
    weeksIssued:
      isFiniteNum(g.weeksIssued) && g.weeksIssued >= 0 ? Math.round(g.weeksIssued) : 0,
    // Recomputed rather than trusted, so a hand-edited file cannot show a ring
    // that disagrees with its own numbers.
    ratio: done / monthlyTarget,
  };
}

function normalizeCleared(r: unknown): ClearedCarryover | null {
  if (!r || typeof r !== 'object') return null;
  const c = r as Record<string, unknown>;
  const goalId = str(c.goalId);
  const label = str(c.label).trim();
  if (!goalId || !label) return null;
  return {
    goalId,
    label,
    category: toCategoryId(c.category),
    targetKind: c.targetKind === 'minutes' ? 'minutes' : 'sessions',
    residual: isFiniteNum(c.residual) && c.residual > 0 ? Math.round(c.residual) : 1,
    deferrals: isFiniteNum(c.deferrals) && c.deferrals >= 0 ? Math.round(c.deferrals) : 0,
    firstDeferredWeek: isDateKey(c.firstDeferredWeek) ? c.firstDeferredWeek : '',
    lastWeek: isDateKey(c.lastWeek) ? c.lastWeek : '',
  };
}

export function loadMonth(monthKey: string): MonthRecord | null {
  const parsed = read<Record<string, unknown>>(MONTH_PREFIX + monthKey);
  if (!parsed) return null;
  const goals = Array.isArray(parsed.goals)
    ? (parsed.goals.map(normalizeMonthGoal).filter(Boolean) as MonthlyGoalSummary[])
    : [];
  return {
    month: monthKey,
    daysInMonth:
      isFiniteNum(parsed.daysInMonth) && parsed.daysInMonth >= 28
        ? Math.round(parsed.daysInMonth)
        : 30,
    sealedOn: isDateKey(parsed.sealedOn) ? parsed.sealedOn : '',
    goals,
    cleared: Array.isArray(parsed.cleared)
      ? (parsed.cleared.map(normalizeCleared).filter(Boolean) as ClearedCarryover[])
      : [],
    overall:
      goals.length > 0
        ? goals.reduce((sum, g) => sum + g.ratio, 0) / goals.length
        : 0,
  };
}

export function saveMonth(record: MonthRecord): void {
  if (!isMonthKey(record.month)) {
    console.error('Almanac: refusing to save month with invalid key', record.month);
    return;
  }
  write(MONTH_PREFIX + record.month, record);
}

/** Every sealed month key, ascending. */
export function listMonthKeys(): string[] {
  return listKeys(MONTH_PREFIX).filter(isMonthKey);
}

export function loadAllMonths(): MonthRecord[] {
  return listMonthKeys()
    .map(loadMonth)
    .filter((m): m is MonthRecord => m !== null);
}

// ---------------------------------------------------------------------------
// Day marks
//
// Only the marks themselves are stored — never the screenshot they came from. A
// pasted image is 1–3 MB as base64 against a ~5 MB localStorage quota, so keeping
// it would risk the quota that every plan, week and month record shares. The
// image is sampled and discarded.
// ---------------------------------------------------------------------------

function normalizeMarkDef(r: unknown, index: number): DayMarkDef | null {
  if (!r || typeof r !== 'object') return null;
  const d = r as Record<string, unknown>;
  const id = str(d.id).trim();
  const label = str(d.label).trim();
  if (!id || !label) return null;
  const color = str(d.color).trim();
  const sourceColor = str(d.sourceColor).trim();
  return {
    id,
    label,
    color: HEX_RE.test(color) ? color : '#8b93a7',
    // Carried through explicitly. Dropping it silently is worse than losing any
    // other field here: the mark keeps working and looking right, and only the
    // screenshot importer quietly stops recognising that colour — so the first
    // session would import fine and every session after it would not.
    ...(HEX_RE.test(sourceColor) ? { sourceColor } : {}),
    order: isFiniteNum(d.order) ? d.order : index,
  };
}

export function loadDayMarkDefs(): DayMarkDef[] {
  const parsed = read<unknown>(MARK_DEFS_KEY);
  if (!Array.isArray(parsed)) return DEFAULT_DAY_MARKS;
  const cleaned = parsed
    .map((r, i) => normalizeMarkDef(r, i))
    .filter(Boolean) as DayMarkDef[];
  const seen = new Set<string>();
  const unique = cleaned.filter((d) => {
    if (seen.has(d.id)) return false;
    seen.add(d.id);
    return true;
  });
  // Never hand back an empty list — the month view would have nothing to draw
  // with and the cycle control would be inert.
  return unique.length > 0 ? unique.sort((a, b) => a.order - b.order) : DEFAULT_DAY_MARKS;
}

export function saveDayMarkDefs(defs: DayMarkDef[]): void {
  write(MARK_DEFS_KEY, defs);
}

export function loadDayMarks(): DayMarks {
  const parsed = read<Record<string, unknown>>(DAY_MARKS_KEY);
  if (!parsed || typeof parsed !== 'object') return {};
  const out: DayMarks = {};
  for (const [date, markId] of Object.entries(parsed)) {
    // A bad date key would place a highlight on a day that cannot be navigated
    // to, so those are dropped rather than kept.
    if (!isDateKey(date)) continue;
    const id = str(markId).trim();
    if (id) out[date] = id;
  }
  return out;
}

export function saveDayMarks(marks: DayMarks): void {
  write(DAY_MARKS_KEY, marks);
}

// ---------------------------------------------------------------------------
// Progression
//
// Two records. `UserProgress` is the lifetime standing and is the only thing here
// that cannot be recomputed — brass gets spent, so the balance is a fact rather
// than a derivation. Day stats ARE recomputable from plans, but they are stored
// anyway: they are what reconciliation diffs against to stay idempotent, and
// plans older than the retention window may be gone.
// ---------------------------------------------------------------------------

export function loadProgress(): UserProgress {
  const parsed = read<Record<string, unknown>>(PROGRESS_KEY);
  if (!parsed || typeof parsed !== 'object') return emptyProgress();
  const totalXp = isFiniteNum(parsed.totalXp) ? Math.max(0, Math.floor(parsed.totalXp)) : 0;
  const rawBrass = isFiniteNum(parsed.brass) ? Math.floor(parsed.brass) : 0;
  // Records written before earnings were derived carry `brassEarned`; the spend is
  // whatever it exceeded the balance by, which is exactly what the old field meant.
  const legacyEarned = isFiniteNum(parsed.brassEarned)
    ? Math.max(0, Math.floor(parsed.brassEarned))
    : 0;
  const spent = isFiniteNum(parsed.brassSpent)
    ? Math.max(0, Math.floor(parsed.brassSpent))
    : Math.max(0, legacyEarned - Math.max(0, rawBrass));
  // A negative balance is legitimate — see the note in `reconcileDay`. It is bounded
  // below by the point where derived lifetime earnings would go negative, which is the
  // one thing that cannot be true.
  const brass = Math.max(-spent, rawBrass) || 0;
  // Only the banked disciplines are stored; anything else in the record is dropped
  // rather than trusted, so a stale key cannot inflate a track forever.
  const banked: Partial<Record<DisciplineId, number>> = {};
  const raw = parsed.disciplines;
  if (raw && typeof raw === 'object') {
    for (const id of ['planning', 'insight'] as DisciplineId[]) {
      const v = (raw as Record<string, unknown>)[id];
      if (isFiniteNum(v) && v > 0) banked[id] = Math.floor(v);
    }
  }

  return {
    totalXp,
    brass,
    brassSpent: spent,
    // Records written before the rename carry `backfilledOn`. It meant the same
    // thing — the day counting began — so it migrates straight across.
    startedOn: isDateKey(parsed.startedOn)
      ? parsed.startedOn
      : isDateKey(parsed.backfilledOn)
        ? parsed.backfilledOn
        : '',
    disciplines: banked,
  };
}

export function saveProgress(progress: UserProgress): void {
  write(PROGRESS_KEY, progress);
}

function normalizeDailyStat(date: string, r: unknown): DailyStat | null {
  if (!r || typeof r !== 'object') return null;
  const d = r as Record<string, unknown>;
  const num = (v: unknown) => (isFiniteNum(v) ? Math.max(0, Math.round(v)) : 0);
  return {
    date,
    plannedMinutes: num(d.plannedMinutes),
    doneMinutes: num(d.doneMinutes),
    xpEarned: num(d.xpEarned),
    brassEarned: num(d.brassEarned),
    bestCombo: num(d.bestCombo),
    cleared: d.cleared === true,
    completedCount: num(d.completedCount),
    focusMinutes: num(d.focusMinutes),
  };
}

export function loadDayStats(): Record<string, DailyStat> {
  const parsed = read<Record<string, unknown>>(DAY_STATS_KEY);
  if (!parsed || typeof parsed !== 'object') return {};
  const out: Record<string, DailyStat> = {};
  for (const [date, raw] of Object.entries(parsed)) {
    if (!isDateKey(date)) continue;
    const stat = normalizeDailyStat(date, raw);
    if (stat) out[date] = stat;
  }
  return out;
}

export function saveDayStats(stats: Record<string, DailyStat>): void {
  write(DAY_STATS_KEY, stats);
}

// ---------------------------------------------------------------------------
// Streaks and one-off awards
// ---------------------------------------------------------------------------

export function loadStreak(): StreakState {
  const parsed = read<Record<string, unknown>>(STREAK_KEY);
  if (!parsed || typeof parsed !== 'object') return emptyStreak();
  const base = emptyStreak();
  const num = (v: unknown, fallback: number) =>
    isFiniteNum(v) ? Math.max(0, Math.round(v)) : fallback;
  const capacity = Math.max(1, num(parsed.capacity, base.capacity));
  const current = num(parsed.current, 0);
  return {
    current,
    // The best run can never be less than the one in progress.
    longest: Math.max(current, num(parsed.longest, 0)),
    resolvedThrough: isDateKey(parsed.resolvedThrough) ? parsed.resolvedThrough : '',
    // Holding more freezes than the capacity allows would let a corrupt record
    // grant unlimited protection.
    freezes: Math.min(capacity, num(parsed.freezes, base.freezes)),
    capacity,
    refilledOn: isDateKey(parsed.refilledOn) ? parsed.refilledOn : '',
    frozenDates: Array.isArray(parsed.frozenDates)
      ? parsed.frozenDates.filter(isDateKey).slice(-60)
      : [],
    startedOn: isDateKey(parsed.startedOn) ? parsed.startedOn : '',
    lastResetOn: isDateKey(parsed.lastResetOn) ? parsed.lastResetOn : '',
    consistencyXp: num(parsed.consistencyXp, 0),
    comebackOn: isDateKey(parsed.comebackOn) ? parsed.comebackOn : '',
  };
}

export function saveStreak(state: StreakState): void {
  write(STREAK_KEY, state);
}

export function loadAwards(): AwardLedger {
  const parsed = read<Record<string, unknown>>(AWARDS_KEY);
  if (!parsed || !Array.isArray(parsed.granted)) return emptyAwards();
  // Deduplicated on read: a duplicate key is harmless for lookups but would grow
  // without bound, and this record is only ever appended to.
  const seen = new Set<string>();
  for (const k of parsed.granted) {
    if (typeof k === 'string' && k.length > 0 && k.length < 200) seen.add(k);
  }
  return { granted: [...seen] };
}

export function saveAwards(ledger: AwardLedger): void {
  write(AWARDS_KEY, ledger);
}

// ---------------------------------------------------------------------------
// The shop
// ---------------------------------------------------------------------------

export function loadShop(today = toDateKey(new Date())): ShopState {
  const parsed = read<Record<string, unknown>>(SHOP_KEY);
  if (!parsed || typeof parsed !== 'object') return emptyShop();

  // Ids are checked against the catalogue on read, so a renamed or removed item
  // cannot leave an unspendable entry or an unresolvable equip behind.
  // A multiset, not a set: a repeatable upgrade is held once per purchase, and the
  // count is what `freezeSlots` reads. Capped per item so a hand-edited record cannot
  // grant more than the shop would sell.
  const owned: string[] = [];
  if (Array.isArray(parsed.owned)) {
    const counts = new Map<string, number>();
    for (const v of parsed.owned) {
      if (typeof v !== 'string') continue;
      const item = itemById(v);
      if (!item || item.consumable) continue;
      const held = counts.get(v) ?? 0;
      if (held >= (item.maxOwned ?? 1)) continue;
      counts.set(v, held + 1);
      owned.push(v);
    }
  }

  const stock: Record<string, number> = {};
  if (parsed.stock && typeof parsed.stock === 'object') {
    for (const [id, v] of Object.entries(parsed.stock as Record<string, unknown>)) {
      const item = itemById(id);
      if (!item?.consumable) continue;
      if (!isFiniteNum(v) || v <= 0) continue;
      stock[id] = Math.min(item.stackLimit ?? 1, Math.floor(v));
    }
  }

  const equipped: ShopState['equipped'] = {};
  if (parsed.equipped && typeof parsed.equipped === 'object') {
    for (const [slot, id] of Object.entries(parsed.equipped as Record<string, unknown>)) {
      if (typeof id !== 'string' || !owned.includes(id)) continue;
      const item = itemById(id);
      if (item?.slot !== slot) continue;
      equipped[item.slot] = id;
    }
  }

  const rerolls: Record<string, number> = {};
  if (parsed.rerolls && typeof parsed.rerolls === 'object') {
    for (const [week, v] of Object.entries(parsed.rerolls as Record<string, unknown>)) {
      if (isDateKey(week) && isFiniteNum(v) && v > 0) rerolls[week] = Math.floor(v);
    }
  }

  return {
    owned,
    stock,
    equipped,
    // Trimmed by date, never by count — see `pruneBoostedDates`. A length cap here
    // was silently un-boosting the oldest days, and reconciliation then took their
    // doubled XP back out of the lifetime total.
    boostedDates: Array.isArray(parsed.boostedDates)
      ? pruneBoostedDates(parsed.boostedDates.filter(isDateKey), today)
      : [],
    rerolls,
  };
}

export function saveShop(shop: ShopState): void {
  write(SHOP_KEY, shop);
}


// ---------------------------------------------------------------------------
// Commissions
// ---------------------------------------------------------------------------

/**
 * Validated hard, because a commission holds staked brass.
 *
 * A malformed record here would either strand a stake or invent a payout, so anything that
 * is not fully well-formed is dropped rather than repaired — the one place in this file
 * where salvaging a partial record would be worse than losing it.
 */
export function loadCommissions(): Commission[] {
  const parsed = read<unknown[]>(COMMISSIONS_KEY);
  if (!Array.isArray(parsed)) return [];
  const out: Commission[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const c = raw as Record<string, unknown>;
    const id = str(c.id);
    if (!id || seen.has(id)) continue;
    if (!isDateKey(c.date)) continue;
    const blockId = str(c.blockId);
    if (!blockId) continue;
    if (!isFiniteNum(c.stake) || c.stake <= 0) continue;
    const outcome =
      c.outcome === 'kept' || c.outcome === 'forfeited' ? c.outcome : 'open';
    seen.add(id);
    out.push({
      id,
      date: c.date,
      blockId,
      title: typeof c.title === 'string' ? c.title : 'An entry',
      stake: Math.floor(c.stake),
      placedOn: isDateKey(c.placedOn) ? c.placedOn : '',
      outcome,
      settledOn: isDateKey(c.settledOn) ? c.settledOn : '',
    });
  }
  return out;
}

export function saveCommissions(commissions: Commission[]): void {
  write(COMMISSIONS_KEY, commissions);
}


// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

function normalizeSeason(season: string, r: unknown): SeasonRecord | null {
  if (!r || typeof r !== 'object') return null;
  const d = r as Record<string, unknown>;
  const num = (v: unknown) => (isFiniteNum(v) ? Math.max(0, Math.round(v)) : 0);
  const range = seasonRange(season);
  const marks: Record<string, number> = {};
  if (d.marks && typeof d.marks === 'object') {
    for (const [id, n] of Object.entries(d.marks as Record<string, unknown>)) {
      if (isFiniteNum(n) && n > 0) marks[id] = Math.floor(n);
    }
  }
  return {
    season,
    // The range is derived from the key rather than trusted, so a hand-edited record cannot
    // claim a season covers dates it does not.
    from: range.from,
    to: range.to,
    xpStart: num(d.xpStart),
    xpEnd: num(d.xpEnd),
    level: num(d.level),
    rank: typeof d.rank === 'string' ? d.rank : '',
    prestige: num(d.prestige),
    daysKept: num(d.daysKept),
    daysCleared: num(d.daysCleared),
    bestRun: num(d.bestRun),
    focusMinutes: num(d.focusMinutes),
    doneMinutes: num(d.doneMinutes),
    marks,
    sealedOn: isDateKey(d.sealedOn) ? d.sealedOn : '',
  };
}

export function loadAllSeasons(): Record<string, SeasonRecord> {
  const out: Record<string, SeasonRecord> = {};
  for (const key of listKeys(SEASON_PREFIX)) {
    if (!isSeasonKey(key)) continue;
    const parsed = read<unknown>(SEASON_PREFIX + key);
    const record = normalizeSeason(key, parsed);
    if (record) out[key] = record;
  }
  return out;
}

export function saveSeason(record: SeasonRecord): void {
  if (!isSeasonKey(record.season)) {
    console.error('Almanac: refusing to save season with invalid key', record.season);
    return;
  }
  write(SEASON_PREFIX + record.season, record);
}

// ---------------------------------------------------------------------------
// Export / import
//
// There is no cloud copy of any of this and no undo beyond the app itself, so a
// single corrupt profile would take every plan, streak and week of history with
// it. This produces one self-contained JSON document of every `dp:` record.
//
// Import goes back through the same normalizers as a normal read, so a truncated
// or hand-edited file yields whatever was salvageable rather than a broken app.
// ---------------------------------------------------------------------------

export const EXPORT_FORMAT = 'almanac.export';
export const EXPORT_VERSION = 1;

export interface ExportDocument {
  format: string;
  version: number;
  exportedOn: string; // date key — no Date objects are stored anywhere
  records: Record<string, unknown>;
}

export function exportAll(today: string): ExportDocument {
  const records: Record<string, unknown> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith('dp:')) continue;
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      try {
        records[key] = JSON.parse(raw);
      } catch {
        // Keep the raw string rather than dropping the row — a human can still
        // read it, and that is the entire point of an escape hatch.
        records[key] = raw;
      }
    }
  } catch (e) {
    console.error('Almanac: export failed to enumerate storage', e);
  }
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedOn: today,
    records,
  };
}

export interface ImportResult {
  ok: boolean
  /** Human-readable outcome, shown verbatim — never a silent failure. */
  message: string;
  written: number;
}

export function importAll(json: string, replace: boolean): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { ok: false, message: "That isn't valid JSON.", written: 0 };
  }
  if (!parsed || typeof parsed !== 'object') {
    return { ok: false, message: "That isn't an Almanac export.", written: 0 };
  }
  const doc = parsed as Partial<ExportDocument>;
  if (doc.format !== EXPORT_FORMAT) {
    return {
      ok: false,
      message: `Expected an Almanac export but found “${
        typeof doc.format === 'string' ? doc.format : 'no format marker'
      }”.`,
      written: 0,
    };
  }
  if (typeof doc.version !== 'number' || doc.version > EXPORT_VERSION) {
    return {
      ok: false,
      message: `That file was written by a newer version of Almanac (v${doc.version}). This build understands up to v${EXPORT_VERSION}.`,
      written: 0,
    };
  }
  if (!doc.records || typeof doc.records !== 'object') {
    return { ok: false, message: 'That export contains no records.', written: 0 };
  }

  const entries = Object.entries(doc.records).filter(([k]) => k.startsWith('dp:'));
  if (entries.length === 0) {
    return { ok: false, message: 'That export contains no Almanac records.', written: 0 };
  }

  try {
    // An import rewrites arbitrary records, so the plan-date cache cannot survive it.
    // Dropped before the writes rather than after, so a throw partway through still
    // leaves the cache invalid rather than confidently wrong.
    invalidatePlanDates();
    if (replace) {
      for (const key of listKeys('dp:').map((k) => 'dp:' + k)) {
        localStorage.removeItem(key);
      }
    }
    let written = 0;
    for (const [key, value] of entries) {
      localStorage.setItem(
        key,
        typeof value === 'string' ? value : JSON.stringify(value)
      );
      written++;
    }
    return {
      ok: true,
      message: `Imported ${written} record${written === 1 ? '' : 's'}${
        replace ? ', replacing what was here' : ', merged into what was here'
      }. Reopen Almanac to see them.`,
      written,
    };
  } catch (e) {
    console.error('Almanac: import failed', e);
    return {
      ok: false,
      message: 'Writing the imported records failed — storage may be full.',
      written: 0,
    };
  }
}

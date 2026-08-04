import {
  DEFAULT_CATEGORIES,
  DEFAULT_DAY_MARKS,
  DEFAULT_SETTINGS,
  MAX_NOTE_LENGTH,
} from './types';
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
  WeekOutcome,
  WeekRecord,
} from './types';
import { uid } from './utils/id';
import { emptyProgress } from './progress';
import { DAY_END } from './reflow';
import { emptyAwards, emptyStreak } from './streaks';
import {
  emptyShop,
  itemById,
  pruneBoostedDates,
  togglable,
  type ShopState,
} from './shop';
import type { Commission } from './commissions';
import { isSeasonKey, seasonRange, type SeasonRecord } from './seasons';
import { characterById } from './characters';
import { addDays as addDaysKey, toDateKey } from './utils/time';
import { decodeEvent, encodeEvent, type StudyEvent } from './study/ledger';
import type { DayDigest } from './study/digest';
import {
  emptyProfile,
  QUESTIONS,
  type Answers,
  type Individuality,
} from './study/profile';
import { FINDINGS_FORMAT, parseFindings, type Finding } from './study/briefing';

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
const FOLD_PREFIX = 'dp:fold:';
const STUDY_EVENTS_KEY = 'dp:study:events:v1';
const STUDY_DIGESTS_KEY = 'dp:study:digests:v1';
const STUDY_PROFILE_KEY = 'dp:study:profile:v1';
const STUDY_FINDINGS_KEY = 'dp:study:findings:v1';

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

/**
 * A read that distinguishes ABSENT from CORRUPT.
 *
 * `read` below collapses the two into `null`, and every caller then treats "no data"
 * as "nothing happened". For a day plan that is a silent, permanent loss: the key
 * still exists, so `listPlanDates` counts the date as authoritative, `loadPlan`
 * returns an empty day, and reconciliation applies a NEGATIVE delta that removes that
 * day's XP from the lifetime total. The calendar loses the blocks and the score loses
 * the day, with nothing surfaced.
 *
 * Absence and corruption are different facts and callers that care must be able to
 * ask. See `isPlanReadable`.
 */
export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: 'absent' | 'corrupt' };

function readStrict<T>(key: string): ReadResult<T> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    // Storage itself unavailable — indistinguishable from absent to every caller,
    // and nothing here can repair it.
    return { ok: false, reason: 'absent' };
  }
  if (raw == null || raw === '') return { ok: false, reason: 'absent' };
  try {
    return { ok: true, value: JSON.parse(raw) as T };
  } catch {
    return { ok: false, reason: 'corrupt' };
  }
}

function read<T>(key: string): T | null {
  const r = readStrict<T>(key);
  return r.ok ? r.value : null;
}

/**
 * Reported when a write fails, so a failure is never only a console line.
 *
 * Release builds register no log sink — `tauri-plugin-log` is debug-only — so
 * `console.error` went nowhere a user would ever look. A quota exhaustion, a locked
 * store or a full disk therefore looked exactly like a successful save until the app
 * was closed and the work turned out not to be there.
 *
 * A callback rather than a throw: these run inside render effects and setState
 * callbacks, where an exception would abandon the user's action half-done.
 */
let onWriteFailure: ((key: string, error: unknown) => void) | null = null;

export function setWriteFailureHandler(
  handler: ((key: string, error: unknown) => void) | null
): void {
  onWriteFailure = handler;
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Almanac: write failed for ${key}`, e);
    try {
      onWriteFailure?.(key, e);
    } catch {
      // A reporter that throws must not become the failure it is reporting.
    }
  }
}

/**
 * Roughly how much of the store is in use, in bytes.
 *
 * UTF-16, because that is what WebKit charges for. Approximate by design — it walks
 * every key, so it is called by the backup panel on open rather than on a render path.
 */
export function storeUsage(): { bytes: number; keys: number } {
  let bytes = 0;
  let keys = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      keys++;
      bytes += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
    }
  } catch (e) {
    console.error('Almanac: could not measure the store', e);
  }
  return { bytes, keys };
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
    notes: normalizeNotes(t.notes),
    // Absent, not false, when unset. `keepWhole: false` and no flag at all mean the
    // same thing to the scheduler, and writing the false would put a field on every
    // task ever saved to record a decision nobody made.
    keepWhole: t.keepWhole === true ? true : undefined,
  };
}

/**
 * A note, trimmed of trailing blanks and capped.
 *
 * Capped on READ as well as on write, because the cap is what stops a hand-edited or
 * imported profile from carrying a field the app will never willingly create. Empty
 * becomes absent rather than an empty string, so `hasNotes` and every truthiness check
 * around the app agree on what "no note" means without each having to trim first.
 */
function normalizeNotes(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const text = raw.replace(/\s+$/, '').slice(0, MAX_NOTE_LENGTH);
  return text.trim() ? text : undefined;
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
    notes: normalizeNotes(b.notes),
    keepWhole: b.keepWhole === true ? true : undefined,
  };
}

/**
 * Whether a stored plan can actually be read.
 *
 * The guard that stops a corrupt record being scored as an empty day. A date that is
 * unreadable is EXCLUDED from reconciliation rather than counted as zero — the same
 * reasoning `withinRetention` already embodies: a day we cannot measure must be left
 * alone, not measured as nothing.
 */
export function isPlanReadable(date: string): boolean {
  const r = readStrict(PLAN_PREFIX + date);
  return r.ok || r.reason !== 'corrupt';
}

/** Every stored date whose record cannot be parsed. Empty is the normal case. */
export function corruptPlanDates(): string[] {
  return listPlanDates().filter((d) => !isPlanReadable(d));
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
    // Absent, not false, when off — a goal predating checkmarks is scheduled work.
    checkmark: g.checkmark === true ? true : undefined,
    // Only that exact string. Anything else is a floor, which is the historical behaviour
    // and the safe default — reading an unknown value as a ceiling would invert a goal.
    direction: g.direction === 'atMost' ? 'atMost' : 'atLeast',
    run: normalizeRun(g.run),
  };
}

/**
 * A goal's consecutive-weeks run, or nothing.
 *
 * Dropped entirely rather than repaired when the target is unusable: a run of one week is
 * not a run, and a record claiming one would pay out immediately for a week that had
 * already happened.
 */
function normalizeRun(raw: unknown): WeeklyGoal['run'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (!isFiniteNum(r.target)) return undefined;
  const target = Math.round(r.target);
  if (target < 2) return undefined;

  const current = isFiniteNum(r.current)
    ? Math.min(target, Math.max(0, Math.round(r.current)))
    : 0;
  // The best run can never be less than the one in progress, the same invariant the
  // day-streak record holds.
  const best = isFiniteNum(r.best) ? Math.max(current, Math.round(r.best)) : current;
  return { target, current, best };
}

function normalizeCredit(r: unknown): GoalCredit | null {
  if (!r || typeof r !== 'object') return null;
  const c = r as Record<string, unknown>;
  const goalId = str(c.goalId);
  const blockId = str(c.blockId);
  if (!goalId || !blockId || !isDateKey(c.date)) return null;

  // A tick carries no minutes, which the old guard rejected outright — the same trap
  // routine checkmarks hit: it would work perfectly until the next reload and then
  // silently vanish. The two kinds are validated apart.
  if (c.checked === true) {
    return { goalId, blockId, date: c.date, minutes: 0, checked: true };
  }

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
    // An unknown id resolves to nothing rather than to a default. A record naming a
    // character this build has never heard of must score as unmodified, not as whichever
    // one happens to sit at index zero.
    character: characterById(str(parsed.character)) ? str(parsed.character) : undefined,
    draws: normalizeDraws(parsed.draws),
    outcome: normalizeOutcome(parsed.outcome),
    // Tombstones for weekly goals taken off on purpose. Deduplicated on read and
    // absent when empty, so a week that has never had one carries no field.
    dismissed: Array.isArray(parsed.dismissed)
      ? (() => {
          const ids = [...new Set(parsed.dismissed.filter((v): v is string =>
            typeof v === 'string' && v.length > 0))];
          return ids.length > 0 ? ids : undefined;
        })()
      : undefined,
  };
}

/**
 * A sealed outcome tally, or nothing.
 *
 * All-or-nothing like `normalizeDraws`, and for a sharper reason: a partly-read tally
 * would report fewer misses than the week actually held, and it would look entirely
 * plausible doing it. Absent is honest — callers fall back to counting the record —
 * whereas a half-read seal is a wrong answer nobody can spot.
 */
function normalizeOutcome(raw: unknown): WeekOutcome | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const count = (v: unknown): number | null =>
    isFiniteNum(v) && v >= 0 ? Math.round(v) : null;

  const met = count(o.met);
  const slipped = count(o.slipped);
  const missed = count(o.missed);
  const voided = count(o.voided);
  const exceeded = count(o.exceeded);
  const total = count(o.total);
  if (
    met === null || slipped === null || missed === null ||
    voided === null || exceeded === null || total === null
  ) {
    return undefined;
  }
  return { met, slipped, missed, voided, exceeded, total };
}

/**
 * Sealed draws, or nothing.
 *
 * All-or-nothing on purpose. A half-read seal would leave some days resolving to their
 * sealed spec and others re-drawing against today's pool, which is a worse state than
 * simply having no seal — the point of the record is that a week's answers are consistent
 * with each other.
 */
function normalizeDraws(raw: unknown): WeekRecord['draws'] {
  if (!raw || typeof raw !== 'object') return undefined;
  const d = raw as Record<string, unknown>;
  if (typeof d.weekly !== 'string' || !d.weekly) return undefined;
  if (!d.daily || typeof d.daily !== 'object') return undefined;
  if (!Array.isArray(d.wildcards)) return undefined;

  const daily: Record<string, string> = {};
  for (const [date, id] of Object.entries(d.daily as Record<string, unknown>)) {
    if (isDateKey(date) && typeof id === 'string' && id) daily[date] = id;
  }
  const wildcards = d.wildcards.filter((x): x is string => typeof x === 'string' && x !== '');
  if (Object.keys(daily).length === 0 || wildcards.length === 0) return undefined;
  return { daily, weekly: d.weekly, wildcards };
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
    // Absent, not false, when off. A routine predating checkmarks is a timed block,
    // and writing the false onto every one of them would record a decision nobody made.
    checkmark: t.checkmark === true ? true : undefined,
  };
}

function normalizeCompletion(r: unknown): RecurringCompletion | null {
  if (!r || typeof r !== 'object') return null;
  const c = r as Record<string, unknown>;
  const templateId = str(c.templateId);
  if (!templateId || !isDateKey(c.date)) return null;

  // A checkmark carries no minutes, which the old guard rejected outright — every
  // check would have survived until the next reload and then silently vanished. The
  // zero is the whole point of the record, so the two cases are validated apart:
  // a block-derived completion must have real minutes, a check must have none.
  const checked = c.checked === true;
  if (checked) return { templateId, date: c.date, minutes: 0, checked: true };

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
    checks: num(d.checks) > 0 ? num(d.checks) : undefined,
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

  // Only what is genuinely owned and genuinely switchable. Read this way round — an
  // allowlist derived from `owned` — a hand-edited record cannot activate an item that
  // was never bought, and an item that stops being togglable stops being active
  // without needing a migration.
  const active: string[] = [];
  if (Array.isArray(parsed.active)) {
    for (const v of parsed.active) {
      if (typeof v !== 'string' || active.includes(v)) continue;
      if (!owned.includes(v)) continue;
      const item = itemById(v);
      if (!item || !togglable(item)) continue;
      active.push(v);
    }
  }

  return {
    owned,
    stock,
    equipped,
    active,
    // Trimmed by date, never by count — see `pruneBoostedDates`. A length cap here
    // was silently un-boosting the oldest days, and reconciliation then took their
    // doubled XP back out of the lifetime total.
    boostedDates: Array.isArray(parsed.boostedDates)
      ? pruneBoostedDates(parsed.boostedDates.filter(isDateKey), today)
      : [],
    rerolls,
  };
}

/**
 * How long a sealed DERIVED record is kept.
 *
 * Five years, and only for records the app can rebuild or has already folded into
 * something else. Day plans and week records are never pruned by this or anything
 * else: they are the primary record of what you actually did, and they are also the
 * bulk of the growth — so this buys headroom rather than solving it, which is the
 * honest trade. `storeUsage` is what makes the remaining ceiling visible.
 */
export const DERIVED_RETENTION_DAYS = 365 * 5;

/**
 * Drop sealed month and season summaries past the horizon.
 *
 * Returns what it removed rather than a count, so the caller can say which records
 * went. Idempotent: running it twice removes nothing the second time.
 */
export function pruneDerivedRecords(
  today: string,
  retentionDays = DERIVED_RETENTION_DAYS
): string[] {
  const cutoff = addDaysKey(today, -retentionDays);
  const removed: string[] = [];

  for (const key of listKeys(MONTH_PREFIX)) {
    // A month key is 'YYYY-MM'; compare against the cutoff's own month so a partial
    // month is never dropped early.
    if (!isMonthKey(key) || key >= cutoff.slice(0, 7)) continue;
    removed.push(MONTH_PREFIX + key);
  }
  for (const key of listKeys(SEASON_PREFIX)) {
    if (key >= cutoff) continue;
    removed.push(SEASON_PREFIX + key);
  }

  for (const key of removed) {
    try {
      localStorage.removeItem(key);
    } catch (e) {
      console.error(`Almanac: could not prune ${key}`, e);
    }
  }
  return removed;
}

/**
 * Drop fold-state keys for panels that no longer exist.
 *
 * One key per collapsible section, written the first time it is toggled and never
 * removed. Tiny individually and unbounded in principle, since a renamed panel leaves
 * its key behind forever. The caller passes the ids currently in use.
 */
export function pruneFoldState(liveIds: string[]): number {
  const live = new Set(liveIds);
  let dropped = 0;
  for (const id of listKeys(FOLD_PREFIX)) {
    if (live.has(id)) continue;
    try {
      localStorage.removeItem(FOLD_PREFIX + id);
      dropped++;
    } catch {
      // Best effort — a fold key left behind costs bytes, not correctness.
    }
  }
  return dropped;
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


// ---------------------------------------------------------------------------
// The study
//
// Four keys rather than one record, because they have completely different write
// rates: raw events are written on every interaction, digests once a day, the profile
// rarely, findings by hand. One combined record would rewrite the whole thing on every
// click — which at a fortnight of raw events is a ~100 KB serialise per keystroke.
// ---------------------------------------------------------------------------

export function loadStudyEvents(): StudyEvent[] {
  const parsed = read<unknown[]>(STUDY_EVENTS_KEY);
  if (!Array.isArray(parsed)) return [];
  return parsed.map(decodeEvent).filter((e): e is StudyEvent => e !== null);
}

export function saveStudyEvents(events: StudyEvent[]): void {
  write(STUDY_EVENTS_KEY, events.map(encodeEvent));
}

export function loadStudyDigests(): DayDigest[] {
  const parsed = read<unknown[]>(STUDY_DIGESTS_KEY);
  if (!Array.isArray(parsed)) return [];

  const out: DayDigest[] = [];
  const seen = new Set<string>();
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const d = raw as Record<string, unknown>;
    // A digest without a valid date cannot be placed in the series, and a duplicate
    // would be counted twice by every mean in the battery.
    if (!isDateKey(d.date) || seen.has(d.date)) continue;
    seen.add(d.date);

    const n = (v: unknown): number =>
      isFiniteNum(v) && v >= 0 ? Math.round(v) : 0;
    const nOrNull = (v: unknown): number | null => (isFiniteNum(v) ? Math.round(v) : null);

    out.push({
      date: d.date,
      blocksPlanned: n(d.blocksPlanned),
      blocksDone: n(d.blocksDone),
      minutesPlanned: n(d.minutesPlanned),
      minutesDone: n(d.minutesDone),
      creates: n(d.creates),
      moves: n(d.moves),
      resizes: n(d.resizes),
      deletes: n(d.deletes),
      builds: n(d.builds),
      clears: n(d.clears),
      opens: n(d.opens),
      viewSwitches: n(d.viewSwitches),
      dayNavigations: n(d.dayNavigations),
      longestBlock: n(d.longestBlock),
      deepMinutes: n(d.deepMinutes),
      focusMinutes: n(d.focusMinutes),
      contexts: n(d.contexts),
      // Signed and genuinely nullable — drift is negative when work is ticked early,
      // and absent when nothing carried a timestamp. Coercing either to zero would
      // invent punctuality.
      tickDrift: nOrNull(d.tickDrift),
      firstTick: nOrNull(d.firstTick),
      lastTick: nOrNull(d.lastTick),
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function saveStudyDigests(digests: DayDigest[]): void {
  write(STUDY_DIGESTS_KEY, digests);
}

export function loadStudyProfile(): Individuality {
  const parsed = read<Record<string, unknown>>(STUDY_PROFILE_KEY);
  if (!parsed || typeof parsed !== 'object') return emptyProfile();

  const answersOf = (raw: unknown): Answers => {
    const base = emptyProfile().answers;
    if (!raw || typeof raw !== 'object') return base;
    const a = raw as Record<string, unknown>;
    const out = { ...base };
    for (const q of QUESTIONS) {
      const v = a[q.key];
      if (typeof v === 'string') out[q.key] = v.slice(0, 4000);
    }
    return out;
  };

  const history: Individuality['history'] = [];
  if (Array.isArray(parsed.history)) {
    for (const h of parsed.history.slice(0, 20)) {
      if (!h || typeof h !== 'object') continue;
      const entry = h as Record<string, unknown>;
      if (!isDateKey(entry.revised)) continue;
      history.push({ revised: entry.revised, answers: answersOf(entry.answers) });
    }
  }

  return {
    revised: isDateKey(parsed.revised) ? parsed.revised : '',
    history,
    answers: answersOf(parsed.answers),
  };
}

export function saveStudyProfile(profile: Individuality): void {
  write(STUDY_PROFILE_KEY, profile);
}

/** Imported findings, plus the date of the last export that produced any. */
export interface FindingsStore {
  findings: Finding[];
  lastExport: string | null;
}

export function loadStudyFindings(): FindingsStore {
  const parsed = read<Record<string, unknown>>(STUDY_FINDINGS_KEY);
  if (!parsed || typeof parsed !== 'object') return { findings: [], lastExport: null };

  // Re-validated through the same reader the import uses, so a hand-edited store
  // cannot hold a finding the import would have refused — which is where a
  // hypothesis would otherwise get laundered into an observation.
  const wrapped = {
    format: FINDINGS_FORMAT,
    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
  };
  const { pack } = parseFindings(wrapped);

  return {
    findings: pack?.findings ?? [],
    lastExport: isDateKey(parsed.lastExport) ? parsed.lastExport : null,
  };
}

export function saveStudyFindings(store: FindingsStore): void {
  write(STUDY_FINDINGS_KEY, store);
}

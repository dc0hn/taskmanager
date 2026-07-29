import { DEFAULT_CATEGORIES, DEFAULT_SETTINGS } from './types';
import type {
  Block,
  CarryoverItem,
  Category,
  CategoryDef,
  CategoryKind,
  GoalCredit,
  HabitStore,
  DayPlan,
  RecurrenceRule,
  RecurringCompletion,
  RecurringTask,
  Settings,
  Task,
  WeeklyGoal,
  WeekRecord,
} from './types';
import { uid } from './utils/id';

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
const SETTINGS_KEY = 'dp:settings:v2';
const CATEGORIES_KEY = 'dp:categories:v1';
const CARRYOVER_KEY = 'dp:carryover:v1';
const HABITS_KEY = 'dp:habits:v1';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

const isFiniteNum = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isDateKey = (v: unknown): v is string =>
  typeof v === 'string' && DATE_RE.test(v);

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
  if (
    typeof b.title !== 'string' ||
    !isFiniteNum(b.start) ||
    !isFiniteNum(b.end) ||
    b.end <= b.start
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
    goalId: str(b.goalId) || undefined,
    templateId: str(b.templateId) || undefined,
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
  write(PLAN_PREFIX + plan.date, plan);
}

/** Every date that has a stored plan, ascending. */
export function listPlanDates(): string[] {
  return listKeys(PLAN_PREFIX).filter(isDateKey);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function loadSettings(): Settings {
  const parsed = read<Record<string, unknown>>(SETTINGS_KEY);
  if (!parsed) return DEFAULT_SETTINGS;
  const start = isFiniteNum(parsed.workingStart)
    ? parsed.workingStart
    : DEFAULT_SETTINGS.workingStart;
  const end = isFiniteNum(parsed.workingEnd)
    ? parsed.workingEnd
    : DEFAULT_SETTINGS.workingEnd;
  // A window that is inverted or empty would make the scheduler return
  // everything as overflow and render a zero-height timeline.
  if (end <= start) return DEFAULT_SETTINGS;
  return { workingStart: start, workingEnd: end };
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

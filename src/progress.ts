import type {
  Block,
  CategoryDef,
  CategoryKind,
  DailyStat,
  DisciplineId,
  UserProgress,
  XpLine,
} from './types';
import { UNKNOWN_CATEGORY } from './types';

// ============================================================================
// Progression — XP, levels, ranks, brass
//
// A second reading of facts the calendar already holds. Nothing in here is an
// input to scheduling; every number is derived from blocks and their completion,
// which is what keeps the whole layer additive and removable.
//
// Four decisions carry the design:
//
//   XP IS TIME, WEIGHTED. Minutes are the app's unit everywhere else — the
//   progress wheel, the weekly review, the monthly rings — so XP is minutes times
//   a difficulty weight, not a flat rate per task. A flat rate would make chopping
//   work into slivers the optimal strategy, and this app is not going to teach
//   that.
//
//   EVERY AWARD IS RECOMPUTABLE. The day's XP is a pure function of the day's
//   blocks. Nothing is accumulated by listening to events, because an event-sourced
//   total drifts the moment a reconciliation pass runs twice — a bug this codebase
//   has already paid for once with goal credits. Totals move by *delta* against a
//   stored per-day figure, so running the pass ten times changes nothing.
//
//   MISSES ARE SILENT. There is no penalty anywhere in this file. Not completing
//   something simply earns nothing, which is already the whole of the feedback.
//
//   REST IS NOT LESSER. A completed break earns its minutes like anything else.
//   Weighting recovery below work would be the app quietly disagreeing with its own
//   scheduler, which deliberately protects rest.
// ============================================================================

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * XP per completed minute, before weights.
 *
 * Calibrated backwards from the intended pace: a 60-level cycle costs 8,910 XP,
 * a normal day completes ~300 minutes at an average weight near 1.4, and a cycle
 * should land around 37 days without bonuses. 0.55 puts that at ~231 XP/day.
 */
export const XP_PER_MINUTE = 0.55;

/** Nothing completed is ever worth nothing. Never binds in practice — the grid's
 *  own minimum block is 15 minutes, which already earns 8. */
export const MIN_BLOCK_XP = 5;

/** Deep work is the hard thing, so it pays more. Rest is not penalised. */
export const KIND_WEIGHT: Record<CategoryKind, number> = {
  focus: 1.6,
  shallow: 1.0,
  neutral: 1.0,
  rest: 1.0,
};

export const HIGH_PRIORITY_WEIGHT = 1.4;

/** Applied when a block was ticked no later than its scheduled end. */
export const ON_TIME_WEIGHT = 1.15;

/** Each consecutive in-order completion adds this, up to COMBO_CAP. */
export const COMBO_STEP = 0.1;
export const COMBO_MAX_RUN = 5;
export const COMBO_CAP = 1 + COMBO_STEP * COMBO_MAX_RUN; // 1.5

/** Finishing a whole day pays a share of that day's XP again, at least this. */
export const DAY_CLEARED_SHARE = 0.15;
export const DAY_CLEARED_MIN = 20;

/** Brass minted per XP. A cycle yields roughly 890 brass. */
export const BRASS_PER_XP = 0.1;

/** A block at or over this many minutes counts toward Endurance. */
export const ENDURANCE_MINUTES = 90;

// ---------------------------------------------------------------------------
// Levels, ranks, prestige
// ---------------------------------------------------------------------------

export const LEVELS_PER_CYCLE = 60;

/**
 * XP to clear level n, for n in 1..60. Linear so the pace stays legible: early
 * levels arrive in hours, level 60 costs four times level 1, and the whole cycle
 * is a month's honest work rather than a year's.
 */
export function xpForLevel(n: number): number {
  const clamped = Math.min(Math.max(1, Math.round(n)), LEVELS_PER_CYCLE);
  return 60 + 3 * (clamped - 1);
}

/** XP to go from the start of a cycle to the start of level n. */
export function xpToReachLevel(n: number): number {
  let sum = 0;
  for (let i = 1; i < Math.min(Math.max(1, Math.round(n)), LEVELS_PER_CYCLE + 1); i++) {
    sum += xpForLevel(i);
  }
  return sum;
}

/** Total XP in one full 60-level cycle. 8,910. */
export const CYCLE_XP = xpToReachLevel(LEVELS_PER_CYCLE + 1);

/**
 * Sixty rank names, one per level, in six arcs of ten.
 *
 * The arcs are not decoration: every tenth level is an arc's capstone, and every
 * tenth level is also where the full-screen celebration fires. Arriving at
 * Journeyman, Surveyor, Printer, Recordkeeper, Astronomer and Grand Reckoner
 * should feel like finishing a chapter, because it is one.
 *
 * No prestige prefix — the sigil carries the cycle, so the name stays clean.
 * Grand Reckoner closes the cycle against Reckoner at level 7 on purpose.
 */
export const RANKS: string[] = [
  // the workshop
  'Apprentice', 'Copyist', 'Tallyman', 'Daykeeper', 'Cartwright',
  'Chandler', 'Reckoner', 'Scrivener', 'Wright', 'Journeyman',
  // measurement
  'Rodman', 'Chainman', 'Levelman', 'Draughtsman', 'Gnomonist',
  'Horologist', 'Instrumentwright', 'Calibrator', 'Triangulator', 'Surveyor',
  // the press
  'Typefounder', 'Compositor', 'Inker', 'Pressman', 'Proofreader',
  'Corrector', 'Bookbinder', 'Gilder', 'Colophonist', 'Printer',
  // the record
  'Indexer', 'Cataloguer', 'Registrar', 'Annalist', 'Chronicler',
  'Archivist', 'Curator', 'Antiquary', 'Palaeographer', 'Recordkeeper',
  // the observatory
  'Nightwatch', 'Observer', 'Ephemerist', 'Tidewright', 'Almanacker',
  'Calendarist', 'Computist', 'Celestialist', 'Uranographer', 'Astronomer',
  // mastery
  'Adept', 'Magister', 'Astrolabist', 'Orrerymaker', 'Chronometrist',
  'Cosmographer', 'Philosopher', 'Polymath', 'Laureate', 'Grand Reckoner',
];

/** How many distinct sigil forms exist before pips start accumulating. */
export const SIGIL_FORMS = 8;

export interface Standing {
  /** Level within the current cycle, 1..60. */
  level: number;
  rank: string;
  /** Completed 60-level cycles. */
  prestige: number;
  /** Which sigil shape to draw, 0..SIGIL_FORMS-1. */
  sigilForm: number;
  /** Pips beside the sigil — one per completed pass through every form. */
  sigilPips: number;
  totalXp: number;
  /** XP banked into the current level. */
  intoLevel: number;
  /** XP the current level costs. */
  levelCost: number;
  /** 0..1 through the current level. */
  levelProgress: number;
  /** True when this level is an arc capstone, so the celebration goes large. */
  milestone: boolean;
}

/**
 * Resolve a lifetime XP figure into everything the UI needs to draw standing.
 *
 * Deliberately a pure function of one number. Level, rank, prestige and sigil are
 * never stored — storing them would let them disagree with the XP total, and the
 * total is the only fact.
 */
export function standingFor(totalXp: number): Standing {
  const xp = Math.max(0, Math.floor(totalXp));
  const prestige = Math.floor(xp / CYCLE_XP);
  let remaining = xp - prestige * CYCLE_XP;

  let level = 1;
  while (level < LEVELS_PER_CYCLE && remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  const levelCost = xpForLevel(level);

  return {
    level,
    rank: RANKS[level - 1] ?? RANKS[RANKS.length - 1],
    prestige,
    sigilForm: prestige % SIGIL_FORMS,
    sigilPips: Math.floor(prestige / SIGIL_FORMS),
    totalXp: xp,
    intoLevel: remaining,
    levelCost,
    levelProgress: levelCost > 0 ? Math.min(1, remaining / levelCost) : 0,
    milestone: level % 10 === 0,
  };
}

/** XP still owed before the next level. */
export function xpToNextLevel(totalXp: number): number {
  const s = standingFor(totalXp);
  return Math.max(0, s.levelCost - s.intoLevel);
}

/**
 * Every level crossed going from one total to another, in order.
 *
 * Returned as a list rather than a boolean because a single generous day can
 * cross two or three, and each deserves its own moment — a level-up that gets
 * swallowed because another arrived in the same tick is a reward silently lost.
 */
export function levelsCrossed(fromXp: number, toXp: number): Standing[] {
  if (toXp <= fromXp) return [];
  const before = standingFor(fromXp);
  const after = standingFor(toXp);
  const out: Standing[] = [];

  // Walk cycle-and-level forward one step at a time. Bounded by construction:
  // the gap in levels can never exceed the XP gap divided by the cheapest level.
  let cursor = fromXp;
  let guard = 0;
  while (guard++ < 1000) {
    const here = standingFor(cursor);
    const need = here.levelCost - here.intoLevel;
    const next = cursor + need;
    if (next > toXp) break;
    cursor = next;
    out.push(standingFor(cursor));
  }
  // A prestige lands on level 1 of the next cycle; make sure the final state is
  // represented even if the loop stopped exactly on the boundary.
  if (out.length === 0 && (after.level !== before.level || after.prestige !== before.prestige)) {
    out.push(after);
  }
  return out;
}

/** Did this XP change complete a cycle? */
export function prestigedBetween(fromXp: number, toXp: number): boolean {
  return standingFor(toXp).prestige > standingFor(fromXp).prestige;
}

// ---------------------------------------------------------------------------
// Area levels — categories and disciplines
//
// A gentler curve than the overall one, and no prestige: these are meant to read
// as depth in a particular thing, not as a race.
// ---------------------------------------------------------------------------

export function areaXpForLevel(n: number): number {
  return 100 + 25 * (Math.max(1, Math.round(n)) - 1);
}

export interface AreaStanding {
  level: number;
  intoLevel: number;
  levelCost: number;
  progress: number;
  totalXp: number;
}

export function areaStandingFor(xp: number): AreaStanding {
  let remaining = Math.max(0, Math.floor(xp));
  let level = 1;
  // Uncapped by design, but bounded so a corrupt figure cannot spin forever.
  while (level < 999 && remaining >= areaXpForLevel(level)) {
    remaining -= areaXpForLevel(level);
    level++;
  }
  const levelCost = areaXpForLevel(level);
  return {
    level,
    intoLevel: remaining,
    levelCost,
    progress: levelCost > 0 ? Math.min(1, remaining / levelCost) : 0,
    totalXp: Math.max(0, Math.floor(xp)),
  };
}

// ---------------------------------------------------------------------------
// Scoring a day
// ---------------------------------------------------------------------------

function kindOf(categoryId: string, categories: CategoryDef[]): CategoryKind {
  return (categories.find((c) => c.id === categoryId) ?? UNKNOWN_CATEGORY).kind;
}

/** Blocks that count. Auto blocks are the scheduler's, not yours. */
export function scorable(blocks: Block[]): Block[] {
  return blocks
    .filter((b) => !b.auto && b.end > b.start)
    .sort((a, b) => a.start - b.start);
}

/**
 * Was this block finished by the time it was supposed to be?
 *
 * Absence of a timestamp returns false, never true: every block completed before
 * timestamps existed would otherwise be retroactively declared punctual, which
 * would inflate the backfill with a bonus nobody earned.
 */
export function wasOnTime(block: Block): boolean {
  return block.completedAt != null && block.completedAt <= block.end;
}

/**
 * The combo run length at each completed block.
 *
 * A run is consecutive completed blocks in schedule order; skipping an unfinished
 * block resets it. Computed from the plan rather than from the order you happened
 * to tick things, which makes it recomputable — and forgiving, since going back to
 * fill a gap repairs the run instead of being too late to count.
 */
export function comboRuns(blocks: Block[]): Map<string, number> {
  const out = new Map<string, number>();
  let run = 0;
  for (const b of scorable(blocks)) {
    if (b.completed) {
      out.set(b.id, run);
      run++;
    } else {
      run = 0;
    }
  }
  return out;
}

export function comboMultiplier(run: number): number {
  return 1 + COMBO_STEP * Math.min(Math.max(0, run), COMBO_MAX_RUN);
}

export function xpForBlock(
  block: Block,
  categories: CategoryDef[],
  comboRun = 0
): { xp: number; notes: string[] } {
  const minutes = Math.max(0, block.end - block.start);
  const kind = kindOf(block.category, categories);
  const notes: string[] = [];

  let xp = minutes * XP_PER_MINUTE;
  const kw = KIND_WEIGHT[kind];
  if (kw !== 1) {
    xp *= kw;
    notes.push(`${kind} ×${kw}`);
  }
  if (block.priority === 'high') {
    xp *= HIGH_PRIORITY_WEIGHT;
    notes.push(`high ×${HIGH_PRIORITY_WEIGHT}`);
  }
  if (wasOnTime(block)) {
    xp *= ON_TIME_WEIGHT;
    notes.push(`on time ×${ON_TIME_WEIGHT}`);
  }
  const cm = comboMultiplier(comboRun);
  if (cm > 1) {
    xp *= cm;
    notes.push(`combo ×${cm.toFixed(1)}`);
  }

  return { xp: Math.max(MIN_BLOCK_XP, Math.round(xp)), notes };
}

export interface DayReckoning {
  stat: DailyStat;
  lines: XpLine[];
  /** XP per category id, for category levels. */
  byCategory: Record<string, number>;
  /** XP per live discipline. */
  byDiscipline: Partial<Record<DisciplineId, number>>;
}

/**
 * Score one day. Pure: same blocks in, same numbers out, every time.
 */
export function reckonDay(
  date: string,
  blocks: Block[],
  categories: CategoryDef[],
  /**
   * Multiplier for the whole day, from a purchased booster.
   *
   * Applied to the day's total rather than per block so the ledger lines stay equal to
   * what each block is worth, and the boost appears as its own line — a doubled score
   * you cannot see the doubling in would be untrustworthy.
   */
  boost = 1
): DayReckoning {
  const real = scorable(blocks);
  const runs = comboRuns(blocks);

  let plannedMinutes = 0;
  let doneMinutes = 0;
  let xpEarned = 0;
  let bestCombo = 0;
  let completedCount = 0;
  let focusMinutes = 0;
  const lines: XpLine[] = [];
  const byCategory: Record<string, number> = {};
  const byDiscipline: Partial<Record<DisciplineId, number>> = {};

  for (const b of real) {
    const minutes = b.end - b.start;
    plannedMinutes += minutes;
    if (!b.completed) continue;

    doneMinutes += minutes;
    completedCount += 1;
    if (kindOf(b.category, categories) === 'focus') focusMinutes += minutes;
    const run = runs.get(b.id) ?? 0;
    bestCombo = Math.max(bestCombo, run + 1);

    const { xp, notes } = xpForBlock(b, categories, run);
    xpEarned += xp;
    lines.push({ id: b.id, label: b.title, xp, minutes, notes });

    byCategory[b.category] = (byCategory[b.category] ?? 0) + xp;
    if (kindOf(b.category, categories) === 'focus') {
      byDiscipline.focus = (byDiscipline.focus ?? 0) + xp;
    }
    if (minutes >= ENDURANCE_MINUTES) {
      byDiscipline.endurance = (byDiscipline.endurance ?? 0) + xp;
    }
  }

  // Finishing the whole thing is worth more than the sum of its parts — that is
  // the entire pull of the last block of the day.
  const cleared = plannedMinutes > 0 && doneMinutes >= plannedMinutes;
  if (cleared) {
    const bonus = Math.max(DAY_CLEARED_MIN, Math.round(xpEarned * DAY_CLEARED_SHARE));
    xpEarned += bonus;
    lines.push({
      id: `${date}:cleared`,
      label: 'Day cleared',
      xp: bonus,
      minutes: 0,
      notes: ['every planned minute done'],
    });
  }

  if (boost > 1 && xpEarned > 0) {
    const extra = Math.round(xpEarned * (boost - 1));
    xpEarned += extra;
    lines.push({
      id: `${date}:boost`,
      label: `Boosted day ×${boost}`,
      xp: extra,
      minutes: 0,
      notes: ['from a double-XP day'],
    });
  }

  const brassEarned = xpEarned > 0 ? Math.max(1, Math.round(xpEarned * BRASS_PER_XP)) : 0;

  return {
    stat: {
      date,
      plannedMinutes,
      doneMinutes,
      xpEarned,
      brassEarned,
      bestCombo,
      cleared,
      completedCount,
      focusMinutes,
    },
    lines,
    byCategory,
    byDiscipline,
  };
}

/** Share of the day's planned minutes completed, 0..1. */
export function dayScore(stat: DailyStat | undefined): number {
  if (!stat || stat.plannedMinutes <= 0) return 0;
  return Math.min(1, stat.doneMinutes / stat.plannedMinutes);
}

// ---------------------------------------------------------------------------
// Reconciliation
//
// The only way totals ever change. Idempotent by construction: a day's XP is
// recomputed, compared against what was last recorded for that day, and the
// difference applied. Run it a hundred times and the total is identical.
// ---------------------------------------------------------------------------

export interface ReconcileResult {
  progress: UserProgress;
  stats: Record<string, DailyStat>;
  /** True when anything actually moved, so callers can skip a write. */
  changed: boolean;
  /** XP delta applied, for the celebration to react to. */
  xpDelta: number;
}

export function reconcileDay(
  progress: UserProgress,
  stats: Record<string, DailyStat>,
  date: string,
  blocks: Block[],
  categories: CategoryDef[],
  boost = 1
): ReconcileResult {
  const fresh = reckonDay(date, blocks, categories, boost).stat;
  const previous = stats[date];

  const xpDelta = fresh.xpEarned - (previous?.xpEarned ?? 0);
  const brassDelta = fresh.brassEarned - (previous?.brassEarned ?? 0);

  const same =
    previous != null &&
    previous.xpEarned === fresh.xpEarned &&
    previous.brassEarned === fresh.brassEarned &&
    previous.plannedMinutes === fresh.plannedMinutes &&
    previous.doneMinutes === fresh.doneMinutes &&
    previous.bestCombo === fresh.bestCombo &&
    previous.cleared === fresh.cleared &&
    previous.completedCount === fresh.completedCount &&
    previous.focusMinutes === fresh.focusMinutes;

  if (same) return { progress, stats, changed: false, xpDelta: 0 };

  // A day with nothing planned and nothing done leaves no record behind.
  const nextStats = { ...stats };
  if (fresh.plannedMinutes === 0 && fresh.xpEarned === 0) delete nextStats[date];
  else nextStats[date] = fresh;

  return {
    progress: {
      ...progress,
      // Clamped at zero: un-ticking the only completed block of the very first day
      // must not drive a lifetime total negative.
      totalXp: Math.max(0, progress.totalXp + xpDelta),
      brass: Math.max(0, progress.brass + brassDelta),
    },
    stats: nextStats,
    changed: true,
    xpDelta,
  };
}

/** Reconcile many days in one pass, for the history backfill. */
export function reconcileDays(
  progress: UserProgress,
  stats: Record<string, DailyStat>,
  days: { date: string; blocks: Block[] }[],
  categories: CategoryDef[],
  /** Per-day multipliers from purchased boosters. Absent means one. */
  boosts: Record<string, number> = {}
): ReconcileResult {
  let p = progress;
  let s = stats;
  let changed = false;
  let delta = 0;
  for (const day of days) {
    const r = reconcileDay(p, s, day.date, day.blocks, categories, boosts[day.date] ?? 1);
    if (r.changed) {
      p = r.progress;
      s = r.stats;
      changed = true;
      delta += r.xpDelta;
    }
  }
  return { progress: p, stats: s, changed, xpDelta: delta };
}

/** Trailing-window trim. Day stats are a rolling record, not an archive. */
export const STAT_RETENTION_DAYS = 400;

/**
 * Is this day still inside the window where reconciliation is safe?
 *
 * Load-bearing, and the reason is not obvious. Reconciliation adds the difference
 * between a day's recomputed XP and its STORED figure. Once a day's stat has been
 * pruned there is no stored figure, so reconciling it again would read the delta as
 * the whole amount and add it a second time — navigating the month view back two
 * years would quietly inflate a lifetime total by every day it touched.
 *
 * Days outside the window are therefore left alone entirely. Their XP is already in
 * the total; the stat was only ever the receipt.
 */
export function withinRetention(
  date: string,
  today: string,
  retentionDays = STAT_RETENTION_DAYS
): boolean {
  return date >= shiftDateKey(today, -retentionDays) && date <= shiftDateKey(today, 1);
}

export function pruneStats(
  stats: Record<string, DailyStat>,
  today: string,
  retentionDays = STAT_RETENTION_DAYS
): Record<string, DailyStat> {
  const dates = Object.keys(stats).sort();
  if (dates.length === 0) return stats;
  const cutoff = shiftDateKey(today, -retentionDays);
  const out: Record<string, DailyStat> = {};
  for (const d of dates) if (d >= cutoff) out[d] = stats[d];
  return Object.keys(out).length === dates.length ? stats : out;
}

/** UTC day arithmetic on a date key — no DST rounding, no Date stored. */
function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const out = new Date(t);
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${out.getUTCFullYear()}-${mm}-${dd}`;
}

// ---------------------------------------------------------------------------
// Aggregates for the Standing view
// ---------------------------------------------------------------------------

export function emptyProgress(): UserProgress {
  return { totalXp: 0, brass: 0, brassSpent: 0, backfilledOn: '', disciplines: {} };
}

/**
 * Lifetime brass earned — derived, never stored.
 *
 * Two facts define it: what you hold and what you have spent. Deriving it makes it
 * impossible for the headline figure to drift away from the balance, which is what
 * happened when it was its own accumulator.
 */
export function brassEarned(progress: UserProgress): number {
  return progress.brass + progress.brassSpent;
}

/** Category and discipline XP totals across every day held in memory. */
export function areaTotals(
  days: { date: string; blocks: Block[] }[],
  categories: CategoryDef[]
): {
  byCategory: Record<string, number>;
  byDiscipline: Partial<Record<DisciplineId, number>>;
} {
  const byCategory: Record<string, number> = {};
  const byDiscipline: Partial<Record<DisciplineId, number>> = {};
  for (const day of days) {
    const r = reckonDay(day.date, day.blocks, categories);
    for (const [id, xp] of Object.entries(r.byCategory)) {
      byCategory[id] = (byCategory[id] ?? 0) + xp;
    }
    for (const [id, xp] of Object.entries(r.byDiscipline)) {
      const key = id as DisciplineId;
      byDiscipline[key] = (byDiscipline[key] ?? 0) + (xp ?? 0);
    }
  }
  return { byCategory, byDiscipline };
}

export function xpEarnedBetween(
  stats: Record<string, DailyStat>,
  fromDate: string,
  toDate: string
): number {
  let sum = 0;
  for (const [date, stat] of Object.entries(stats)) {
    if (date >= fromDate && date <= toDate) sum += stat.xpEarned;
  }
  return sum;
}

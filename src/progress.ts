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
import { addDays } from './utils/time';

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
 * This was calibrated backwards from an intended pace of ~231 XP/day, assuming a 300-minute
 * day at "an average weight near 1.4". Both halves of that were optimistic, and it is worth
 * writing down rather than quietly leaving wrong:
 *
 *   THE WEIGHTS COMPOUND. focus 1.6 x priority 1.4 x on-time 1.15 x combo 1.5 is 3.86, so a
 *   good block earns 2.13 XP/min rather than the 0.77 the arithmetic assumed. A measured
 *   six-hour day comes to ~497 XP of repeatable work, better than twice the estimate.
 *
 * The rate itself is left alone. Capping the compounding was modelled and moves a normal
 * day by under thirty XP — an ordinary day never reaches full stack, because the combo
 * builds gradually and only one block is usually high priority. The level curve was the
 * honest lever, and that is where the correction went; see `xpForLevel`.
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

/**
 * Brass for a block ticked within `PIECEWORK_TOLERANCE` minutes of its scheduled end.
 *
 * The only reward in the app for ESTIMATION rather than volume, which is a genuinely
 * different skill and the one a planner is actually for. Brass only — no XP — so it cannot
 * disturb levels, and computed inside `reckonDay` so it reconciles like everything else.
 *
 * Distinct from `wasOnTime`, which is `completedAt <= end` and pays XP. This is a tighter,
 * two-sided window: finishing four hours early is not good estimation either.
 */
export const PIECEWORK_BRASS = 8;
export const PIECEWORK_TOLERANCE = 5;

/** Was this block ticked within the piecework window of its scheduled end? */
export function toTheMinute(b: Block): boolean {
  return (
    b.completed === true &&
    b.completedAt != null &&
    Math.abs(b.completedAt - b.end) <= PIECEWORK_TOLERANCE
  );
}

/** A block at or over this many minutes counts toward Endurance. */
export const ENDURANCE_MINUTES = 90;

// ---------------------------------------------------------------------------
// Levels, ranks, prestige
// ---------------------------------------------------------------------------

export const LEVELS_PER_CYCLE = 60;

/**
 * XP to clear level n, for n in 0..59.
 *
 * Levels are zero-indexed: you begin at level 0 with nothing earned, which is what
 * "starting from scratch" should actually read as. Linear so the pace stays legible —
 * level 0 costs 60, level 59 costs 591, and the whole cycle is about five weeks of real
 * work.
 *
 * THE SLOPE WAS 3 AND IT WAS FAR TOO SHALLOW. Measured against actual play: a solid
 * six-hour day earns ~497 XP of repeatable work, which put a full 60-level cycle at
 * SIXTEEN days against the ~37 this file was calibrated for, and a first day at level 15.
 * The old curve also barely rose — level 59 cost only four times level 0, so the back half
 * of a cycle was no harder than the front.
 *
 * At 9 the cycle costs 19,530 and lands near 34 days at six hours a day, or eight weeks at
 * a lighter pace. Early levels stay cheap enough that a first day still crosses several,
 * which is the part worth keeping.
 */
export function xpForLevel(n: number): number {
  const clamped = Math.min(Math.max(0, Math.round(n)), LEVELS_PER_CYCLE - 1);
  return 60 + 9 * clamped;
}

/** XP to go from the start of a cycle to the start of level n. */
export function xpToReachLevel(n: number): number {
  let sum = 0;
  for (let i = 0; i < Math.min(Math.max(0, Math.round(n)), LEVELS_PER_CYCLE); i++) {
    sum += xpForLevel(i);
  }
  return sum;
}

/** Total XP in one full 60-level cycle. 8,910. */
export const CYCLE_XP = xpToReachLevel(LEVELS_PER_CYCLE);

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
  /** Level within the current cycle, 0..59. Zero means nothing earned yet. */
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

  let level = 0;
  while (level < LEVELS_PER_CYCLE - 1 && remaining >= xpForLevel(level)) {
    remaining -= xpForLevel(level);
    level++;
  }
  const levelCost = xpForLevel(level);

  return {
    level,
    rank: RANKS[level] ?? RANKS[RANKS.length - 1],
    prestige,
    sigilForm: prestige % SIGIL_FORMS,
    sigilPips: Math.floor(prestige / SIGIL_FORMS),
    totalXp: xp,
    intoLevel: remaining,
    levelCost,
    levelProgress: levelCost > 0 ? Math.min(1, remaining / levelCost) : 0,
    // Capstones are the tenth, twentieth … sixtieth RANK, which with zero-indexed
    // levels lands on 9, 19 … 59. Keeping the arcs intact matters more than having
    // the round numbers on screen, since the arcs are what the names were written to.
    milestone: (level + 1) % 10 === 0,
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

/**
 * A category's kind, with a safe fallback for one that has been deleted.
 *
 * THE ONE IMPLEMENTATION. There were three — here, in badges.ts and in insights.ts —
 * identical today and each free to drift tomorrow. Exported rather than duplicated for
 * the reason `utils/time.ts` states about its own consolidation: a pair that happens
 * to agree is exactly the pair that fails in one place only.
 */
export function kindOf(categoryId: string, categories: CategoryDef[]): CategoryKind {
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

export function comboMultiplier(run: number, maxRun = COMBO_MAX_RUN): number {
  // `maxRun` is overridable so a week's character can carry runs further. Never below the
  // house cap, because a character must not reduce a figure.
  return 1 + COMBO_STEP * Math.min(Math.max(0, run), Math.max(COMBO_MAX_RUN, maxRun));
}

export function xpForBlock(
  block: Block,
  categories: CategoryDef[],
  comboRun = 0,
  /** The week's character, when one is sealed. Applied last, after the combo term. */
  character: DayModifiers['character'] = null
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
  const cm = comboMultiplier(comboRun, character?.comboMax);
  if (cm > 1) {
    xp *= cm;
    notes.push(`combo ×${cm.toFixed(1)}`);
  }

  // Last, so a character multiplies the finished figure rather than one term of it. Clamped
  // at 1 because no character may ever reduce a score — see the note in characters.ts.
  const cw = Math.max(1, character?.weigh?.(block, kind, minutes) ?? 1);
  if (cw > 1) {
    xp *= cw;
    notes.push(`the week ×${cw}`);
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
/**
 * Everything outside a day's own blocks that changes what it scores.
 *
 * An object rather than trailing parameters, and that is the whole point. `reckonDay` used
 * to take a bare `boost = 1` as its fourth argument, and adding a second scoring input the
 * same way is exactly how boosters shipped half-wired: three of the five call sites simply
 * did not pass it, and the default silently scored those days as unboosted. The completion
 * toast said +121 while the reconcile credited +242.
 *
 * With an object, omitting a field is a type error at every call site rather than a
 * plausible-looking `1`. Build it once and share it; there is a `boosts` memo in App.tsx
 * doing exactly that.
 */
/**
 * What a checkmark pays, and the most a day of them can pay.
 *
 * Flat and small, with a hard daily cap. A checkmark has no duration, so there is no
 * honest way to scale it by effort — and an uncapped per-item reward would make a list
 * of twenty trivial items out-earn an afternoon of real work, which is exactly the
 * Goodhart failure the shop audit warned about. Five checks is 40 XP; one 90-minute
 * focus block is still worth more than all of them together.
 */
export const CHECK_XP = 8;
export const CHECK_XP_DAILY_CAP = 40;

/**
 * Credit a checkmark contributes toward the day's streak threshold, and the ceiling on
 * how much of a day the whole set may account for.
 *
 * The share cap is the part that matters. The threshold is 0.6, so capping checks at
 * 0.4 of the day means they can never carry a day alone: you always need real work for
 * at least the remaining fifth. Without it, a day with thirty minutes planned and five
 * checks would sail past the threshold on checkmarks.
 */
export const CHECK_CREDIT_MINUTES = 10;
export const CHECK_CREDIT_SHARE = 0.4;

export interface DayModifiers {
  /** Purchased booster for this specific day. 1 when none. */
  boost: number;
  /**
   * The sealed character of the week this day belongs to.
   *
   * Typed as a shape rather than imported from characters.ts, which would make this module
   * depend on content. Scoring needs to know what a character DOES, not which ones exist.
   */
  character: {
    weigh?: (b: Block, kind: CategoryKind, minutes: number) => number;
    dayBonus?: (r: { byCategory: Record<string, number>; completedCount: number }) => number;
    brassRate?: number;
    comboMax?: number;
  } | null;
  /**
   * Checkmarks ticked on this day.
   *
   * Belongs here rather than as a parameter because this object is already documented
   * as "everything outside the day's blocks that changes its score", and a checkmark is
   * precisely that. Defaults to zero, so every existing caller and every stored day
   * predating checkmarks reckons exactly as it did.
   */
  checks?: number;
}

export const NO_MODIFIERS: DayModifiers = { boost: 1, character: null };

export function reckonDay(
  date: string,
  blocks: Block[],
  categories: CategoryDef[],
  /**
   * Everything outside the day's blocks that changes its score.
   *
   * The boost is applied to the day's total rather than per block, so the ledger lines stay
   * equal to what each block is worth and the boost appears as its own line — a doubled
   * score you cannot see the doubling in would be untrustworthy.
   */
  mods: DayModifiers = NO_MODIFIERS
): DayReckoning {
  const boost = mods.boost;
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

    const { xp, notes } = xpForBlock(b, categories, run, mods.character);
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

  // Checkmarks, as their own line. Flat, capped, and outside every multiplier — no
  // combo, no punctuality, no kind weight, because a checkmark has no duration for
  // those to scale and no place in the schedule order for a combo to run through. It
  // sits before the character bonus and the boost so a doubled day doubles it too,
  // which is consistent with everything else that pays on a boosted day.
  const checks = Math.max(0, Math.round(mods.checks ?? 0));
  if (checks > 0) {
    const checkXp = Math.min(CHECK_XP_DAILY_CAP, checks * CHECK_XP);
    xpEarned += checkXp;
    lines.push({
      id: `${date}:checks`,
      label: checks === 1 ? 'Checkmark' : `Checkmarks × ${checks}`,
      xp: checkXp,
      minutes: 0,
      notes: checks * CHECK_XP > CHECK_XP_DAILY_CAP ? ['daily cap reached'] : [],
    });
  }

  // 3) The week's character, as its own line. After the cleared bonus and before the boost,
  //    so the ledger reads in the order the multipliers were applied.
  const dayBonus = mods.character?.dayBonus?.({ byCategory, completedCount }) ?? 0;
  if (dayBonus > 0) {
    xpEarned += dayBonus;
    lines.push({
      id: `${date}:character`,
      label: "The week's character",
      xp: dayBonus,
      minutes: 0,
      notes: [],
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

    // The area figures have to move with the total, or a boosted day shows up as
    // double XP on the meter and single XP on every category and discipline it came
    // from — the same work reported two ways.
    //
    // These are proportional rather than exact, and always were: the day-cleared
    // bonus is not attributable to any one category either, so the areas have never
    // summed to `xpEarned`. Scaling keeps their relationship to the total intact,
    // which is what a boosted day needs.
    for (const id of Object.keys(byCategory)) byCategory[id] = Math.round(byCategory[id] * boost);
    for (const id of Object.keys(byDiscipline)) {
      const key = id as DisciplineId;
      byDiscipline[key] = Math.round((byDiscipline[key] ?? 0) * boost);
    }
  }

  // 5) Brass, at the week's rate when its character sets one, plus piecework.
  const brassRate = mods.character?.brassRate ?? BRASS_PER_XP;
  const punctual = real.filter(toTheMinute).length;
  const piecework = punctual * PIECEWORK_BRASS;
  const brassEarned =
    xpEarned > 0 ? Math.max(1, Math.round(xpEarned * brassRate)) + piecework : piecework;

  if (piecework > 0) {
    // Its own line, and it says how many. Brass that appears without an explanation is the
    // same problem as XP that does.
    lines.push({
      id: `${date}:piecework`,
      label: 'Piecework',
      xp: 0,
      minutes: 0,
      notes: [`${punctual} block${punctual === 1 ? '' : 's'} to the minute`],
    });
  }

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
      // Absent rather than zero on a day with no checks, so four hundred stored days
      // do not each carry a field recording that nothing happened.
      checks: checks > 0 ? checks : undefined,
    },
    lines,
    byCategory,
    byDiscipline,
  };
}

/** Share of the day's planned minutes completed, 0..1. */
export function dayScore(stat: DailyStat | undefined): number {
  if (!stat || stat.plannedMinutes <= 0) return 0;
  // Checks count toward the threshold but are bounded to a share of the day, so they
  // help a real day over the line and can never constitute one. `doneMinutes` itself
  // is untouched — a checkmark is not time worked, and every hours figure in the app
  // reads that field.
  const credit = Math.min(
    (stat.checks ?? 0) * CHECK_CREDIT_MINUTES,
    stat.plannedMinutes * CHECK_CREDIT_SHARE
  );
  return Math.min(1, (stat.doneMinutes + credit) / stat.plannedMinutes);
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
  mods: DayModifiers = NO_MODIFIERS
): ReconcileResult {
  const fresh = reckonDay(date, blocks, categories, mods).stat;
  const previous = stats[date];

  const xpDelta = fresh.xpEarned - (previous?.xpEarned ?? 0);
  const brassDelta = fresh.brassEarned - (previous?.brassEarned ?? 0);

  // `|| 0` normalises negative zero, which `Math.max` produces when nothing has been
  // spent and the delta is negative. It compares equal to zero but does not print or
  // serialise like it.
  const nextBrass =
    Math.max(-(progress.brassSpent ?? 0), progress.brass + brassDelta) || 0;

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
      // The brass balance is allowed to go NEGATIVE, and it has to be.
      //
      // Lifetime earnings are derived as `brass + brassSpent`, so clamping the balance
      // at zero forgave any shortfall and left the lifetime figure holding brass that
      // no longer had a day behind it. Earn 14, spend 14, un-tick the block: the
      // balance clamped to 0 instead of -14, so the lifetime figure still read 14. Tick
      // the same block again and it minted a second time — one block, spendable
      // repeatedly, and a lifetime total climbing with every cycle.
      //
      // A negative balance simply means more has been spent than the surviving work
      // earned. Nothing is affordable until it is back above the price, which is the
      // honest consequence of deleting the work that paid for a purchase. The floor is
      // where lifetime earnings hit zero, since those genuinely cannot go below it.
      brass: nextBrass,
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
  /** Per-day modifiers. A day with no entry scores unmodified. */
  modifiers: Record<string, DayModifiers> = {}
): ReconcileResult {
  let p = progress;
  let s = stats;
  let changed = false;
  let delta = 0;
  for (const day of days) {
    const r = reconcileDay(p, s, day.date, day.blocks, categories, modifiers[day.date] ?? NO_MODIFIERS);
    if (r.changed) {
      p = r.progress;
      s = r.stats;
      changed = true;
      delta += r.xpDelta;
    }
  }
  return { progress: p, stats: s, changed, xpDelta: delta };
}


/**
 * Median completion ratio for each weekday, over the trailing weeks.
 *
 * The progression layer can say how you did today and how long your run is, but nothing in
 * it could answer "am I actually getting better at Tuesdays?" — which is the question a
 * calendar is uniquely able to answer and the reason to keep history at all.
 *
 * MEDIAN, not mean. One abandoned day drags a four-sample mean into uselessness, and the
 * whole point is a line steady enough to be worth comparing against.
 *
 * RATIO, not minutes, so the ghost shares an axis with the live bar it sits behind. Two
 * bars on the same scale can be compared at a glance; two bars measuring different things
 * are a chart that needs a legend.
 *
 * Returns nothing for a weekday with fewer than `minSamples` days of history. A ghost drawn
 * from one previous Tuesday is not a baseline, it is last Tuesday.
 */
export function weekdayMedians(
  stats: Record<string, DailyStat>,
  dates: string[],
  weeks = 4,
  minSamples = 2
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const date of dates) {
    const samples: number[] = [];
    for (let w = 1; w <= weeks; w++) {
      const past = addDays(date, -7 * w);
      const stat = stats[past];
      // Only days that had a plan. A day with nothing booked scored zero for a reason that
      // has nothing to do with how the weekday usually goes.
      if (stat && stat.plannedMinutes > 0) samples.push(dayScore(stat));
    }
    if (samples.length < minSamples) continue;
    samples.sort((a, b) => a - b);
    const mid = Math.floor(samples.length / 2);
    out[date] =
      samples.length % 2 === 1
        ? samples[mid]
        : (samples[mid - 1] + samples[mid]) / 2;
  }
  return out;
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
  return date >= addDays(today, -retentionDays) && date <= addDays(today, 1);
}

/**
 * Is this day inside the scored era?
 *
 * The counterpart to `withinRetention`, and the thing that makes a reset stick. A
 * total that was merely zeroed would climb straight back the next time the month view
 * loaded a day from before the reset, because reconciliation would find no stored stat
 * and read the whole day as new.
 */
export function isScored(date: string, startedOn: string): boolean {
  return startedOn !== '' && date >= startedOn;
}

/** Wipe every earned figure, and begin counting from `today`. */
export function resetProgress(today: string): UserProgress {
  return { ...emptyProgress(), startedOn: today };
}

export function pruneStats(
  stats: Record<string, DailyStat>,
  today: string,
  retentionDays = STAT_RETENTION_DAYS
): Record<string, DailyStat> {
  const dates = Object.keys(stats).sort();
  if (dates.length === 0) return stats;
  const cutoff = addDays(today, -retentionDays);
  const out: Record<string, DailyStat> = {};
  for (const d of dates) if (d >= cutoff) out[d] = stats[d];
  return Object.keys(out).length === dates.length ? stats : out;
}


// ---------------------------------------------------------------------------
// Aggregates for the Standing view
// ---------------------------------------------------------------------------

export function emptyProgress(): UserProgress {
  return { totalXp: 0, brass: 0, brassSpent: 0, startedOn: '', disciplines: {} };
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

/**
 * Category and discipline XP totals across every day held in memory.
 *
 * Takes the same per-day boost map as `reconcileDays` and for the same reason: these
 * totals are recomputed from blocks on every render, so a boost left out here would
 * make the areas disagree with the lifetime figure they are supposed to break down.
 */
export function areaTotals(
  days: { date: string; blocks: Block[] }[],
  categories: CategoryDef[],
  /** Per-day modifiers. A day with no entry scores unmodified. */
  modifiers: Record<string, DayModifiers> = {}
): {
  byCategory: Record<string, number>;
  byDiscipline: Partial<Record<DisciplineId, number>>;
} {
  const byCategory: Record<string, number> = {};
  const byDiscipline: Partial<Record<DisciplineId, number>> = {};
  for (const day of days) {
    const r = reckonDay(day.date, day.blocks, categories, modifiers[day.date] ?? NO_MODIFIERS);
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

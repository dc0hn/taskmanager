import type {
  AwardLedger,
  AwardPayout,
  Block,
  CategoryDef,
  DailyStat,
  DayMarkDef,
  DayMarks,
  DayPlan,
  HabitStore,
  WeekRecord,
} from './types';
import { scorable, xpForBlock } from './progress';
import { daysBetween, todayQualifies } from './streaks';
import { markById } from './daymarks';
import { matchesRule } from './recurrence';
import { weekDates } from './week';

// ============================================================================
// Quests and challenges
//
// The layer that fights cherry-picking. Left alone, a scoring system rewards
// clearing the five easy things and leaving the one that mattered untouched all
// week; a quest is a set you only get paid for finishing.
//
// Three rules shape the whole module:
//
//   GENERATED, NEVER STORED. Every quest is derived from structure the app already
//   holds — a weekly goal's blocks, a routine's due days, a run of marked days. So
//   there is no quest record to fall out of sync with the calendar, and editing your
//   week reshapes the quests instead of orphaning them. Only the PAYOUT is stored,
//   in the same award ledger the badges use.
//
//   DETERMINISTIC RANDOMNESS. The wildcards and challenges rotate, but a reload must
//   not reshuffle them — a challenge that changes when you glance away is not a
//   challenge. So the pick is a pure function of the date or week key, hashed. Same
//   Monday, same quest, forever, on any machine.
//
//   EXPIRY IS SILENT. An unfinished quest pays nothing and says nothing. There is no
//   failure state anywhere in here, and Monday simply brings a new set.
// ============================================================================

/** Bonus as a share of the XP the set's own blocks are worth. */
export const QUEST_BONUS_SHARE = 0.5;
export const QUEST_BONUS_MIN = 60;

export const DAILY_CHALLENGE_XP = 60;
export const WEEKLY_CHALLENGE_XP = 300;
export const WILDCARD_XP = 200;

export type QuestKind = 'goal' | 'run' | 'routine' | 'heavyday' | 'wildcard';

export interface Quest {
  /** Stable and unique, and doubles as the award key suffix. */
  id: string;
  kind: QuestKind;
  name: string;
  blurb: string;
  /** Dates the quest spans, for display. */
  dates: string[];
  bonusXp: number;
  done: number;
  total: number;
  complete: boolean;
}

export interface Challenge {
  id: string;
  name: string;
  blurb: string;
  xp: number;
  done: number;
  total: number;
  complete: boolean;
}

// ---------------------------------------------------------------------------
// Deterministic picking
// ---------------------------------------------------------------------------

/**
 * FNV-1a over the key.
 *
 * Deliberately not `Math.random`: the pick has to be stable across reloads, across
 * sessions and across machines from the same date alone. Storing a rolled result
 * would work too, but then the record could disagree with the date it belongs to,
 * and there would be one more thing to migrate.
 */
export function seedFrom(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function pick<T>(items: T[], key: string, offset = 0): T {
  return items[(seedFrom(key) + offset * 2654435761) % items.length];
}

/** `count` distinct items, chosen stably from the key. */
export function pickSome<T>(items: T[], key: string, count: number): T[] {
  const out: T[] = [];
  const pool = [...items];
  let seed = seedFrom(key);
  while (out.length < Math.min(count, items.length) && pool.length > 0) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out;
}



// ---------------------------------------------------------------------------
// Predicates the content is built from
//
// One implementation each, here beside the specs rather than copied into them. A second
// copy of a threshold has already cost one bug in this file — the daily threshold was
// written out as a bare 0.6 in a weekly challenge and disagreed with the run counter on
// travel days.
// ---------------------------------------------------------------------------

/** Ticked within `tolerance` minutes either side of its scheduled end. */
export function finishedWhenPlanned(b: Block, tolerance = 10): boolean {
  return (
    b.completed === true &&
    b.completedAt != null &&
    Math.abs(b.completedAt - b.end) <= tolerance
  );
}

/** Completed blocks that had been rescheduled at least `n` times first. */
export function salvaged(blocks: Block[], n = 2): Block[] {
  return blocks.filter((b) => b.completed && (b.moves ?? 0) >= n);
}

/** Minutes completed in each category across the week. */
export function minutesByCategory(ctx: WeekContext): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { block } of weekBlocks(ctx)) {
    if (!block.completed) continue;
    out[block.category] = (out[block.category] ?? 0) + (block.end - block.start);
  }
  return out;
}

/**
 * Facts about the profile as a whole, for the discovery content.
 *
 * A week cannot answer "the hour you most often finish work in" — that is a question about
 * months, and `WeekContext` holds seven days. So it is computed once from the wide codex
 * window and handed in, and every field is nullable.
 *
 * A DISCOVERY QUEST THAT FIRES ON NO DATA IS WORSE THAN NO DISCOVERY QUEST. Null here means
 * the dependent spec reports zero progress and simply cannot be finished, rather than
 * quietly resolving to hour zero and asking for work at midnight.
 */
export interface ProfileFacts {
  /** Hour of day, 0..23, this profile most often completes work in. */
  strongestHour: number | null;
  /** The category with the least completed time in the trailing window. */
  leastTouched: string | null;
}


/** Enough completions before an hour is worth calling anyone's strongest. */
export const STRONGEST_HOUR_MIN = 12;

/**
 * Derive the profile facts from a trailing window of days.
 *
 * Deliberately takes plain days rather than an `InsightContext`, so `quests.ts` does not
 * depend on the codex — the two want the same history, not the same module.
 */
export function profileFacts(
  days: { date: string; blocks: Block[] }[],
  categories: CategoryDef[]
): ProfileFacts {
  const byHour = new Array(24).fill(0);
  let stamped = 0;
  const minutes = new Map<string, number>();

  for (const day of days) {
    for (const b of scorable(day.blocks)) {
      if (!b.completed) continue;
      minutes.set(b.category, (minutes.get(b.category) ?? 0) + (b.end - b.start));
      if (b.completedAt == null) continue;
      // Past midnight `completedAt` keeps counting, so wrap it back onto a clock.
      byHour[Math.floor(b.completedAt / 60) % 24] += 1;
      stamped += 1;
    }
  }

  let strongestHour: number | null = null;
  if (stamped >= STRONGEST_HOUR_MIN) {
    const best = byHour.indexOf(Math.max(...byHour));
    // A clear winner, or nothing. Preferring one side of a tie would send someone to an
    // arbitrary hour on the strength of a coin flip.
    const runnerUp = Math.max(...byHour.filter((_, i) => i !== best));
    if (byHour[best] > runnerUp) strongestHour = best;
  }

  // Only categories actually in use. A category with no minutes is not a quiet corner, it
  // is one this profile does not have — and "put an hour into the thing you never do" is a
  // different, worse quest than "the thing you are neglecting".
  //
  // Needs two to compare, and a clear loser: a tie between the two least-used is not a
  // finding.
  let leastTouched: string | null = null;
  const known = new Set(categories.filter((c) => c.kind !== 'rest').map((c) => c.id));
  const used = [...minutes.entries()]
    .filter(([id, m]) => known.has(id) && m > 0)
    .sort((a, b) => a[1] - b[1]);
  if (used.length >= 2 && used[0][1] < used[1][1]) leastTouched = used[0][0];

  return { strongestHour, leastTouched };
}

// ---------------------------------------------------------------------------
// Sealing the week's draws
//
// The same argument as the week's character, and the reason the pools below can now grow at
// all. `pick` indexes by `seed % length`, so the LENGTH of a pool is part of the answer for
// every key. Appending one challenge re-draws every past week — and because a payout key
// embeds the drawn spec's id (`quest:daily:2026-08-03:clear-it`), a re-drawn day's new
// challenge is unpaid. The same day can then pay twice, once under each name.
//
// So a week's draws are written down when it is issued, and everything after reads the
// sealed ids. Sealed weeks stop asking, which is what makes appending safe.
//
// All of a week's draws are sealed at once rather than as each is needed: the pick is
// deterministic anyway, so there is nothing to gain from deferring it and a great deal to
// lose from a draw that lands mid-week against a pool that changed on Wednesday.
// ---------------------------------------------------------------------------

export interface WeekDraws {
  /** Date key to daily-challenge spec id, for all seven days. */
  daily: Record<string, string>;
  weekly: string;
  /**
   * Wildcard spec ids by offset.
   *
   * Generous rather than exact, because the offset depends on how many rerolls get bought
   * later in the week. An offset past the end falls back to drawing, which is the same
   * behaviour a week with no seal gets.
   */
  wildcards: string[];
}

const SEALED_WILDCARDS = 24;

export function drawWeek(weekKey: string): WeekDraws {
  const daily: Record<string, string> = {};
  for (const date of weekDates(weekKey)) {
    daily[date] = pick(DAILY_CHALLENGES, `daily:${date}`).id;
  }
  return {
    daily,
    weekly: pick(WEEKLY_CHALLENGES, `weekly:${weekKey}`).id,
    wildcards: Array.from(
      { length: SEALED_WILDCARDS },
      (_, offset) => pick(WILDCARDS, `wildcard:${weekKey}`, offset).id
    ),
  };
}

/** Seal a week's draws, if it has none. Null when there was nothing to do. */
export function sealDraws(week: WeekRecord): WeekRecord | null {
  if (week.draws) return null;
  return { ...week, draws: drawWeek(week.week) };
}

function specById<T extends { id: string }>(pool: T[], id: string | undefined): T | null {
  if (!id) return null;
  return pool.find((s) => s.id === id) ?? null;
}

/**
 * The spec a week actually drew, preferring what was sealed.
 *
 * Falls back to drawing for weeks sealed before this shipped, and for a sealed id this
 * build does not recognise — both of which score as whatever the pool says today, which is
 * the same position those weeks were already in.
 */
function resolved<T extends { id: string }>(
  pool: T[],
  sealed: string | undefined,
  key: string,
  offset = 0
): T {
  return specById(pool, sealed) ?? pick(pool, key, offset);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface WeekContext {
  weekKey: string;
  dates: string[];
  plans: Record<string, DayPlan>;
  stats: Record<string, DailyStat>;
  week: WeekRecord;
  habits: HabitStore;
  marks: DayMarks;
  markDefs: DayMarkDef[];
  categories: CategoryDef[];
  /** What this week drew, sealed on issue. Absent on weeks predating the seal. */
  draws?: WeekDraws;
  /** Profile-wide facts the discovery content needs. Absent means those specs cannot fire. */
  profile?: ProfileFacts;
  /** The most recent fresh start, for the recovery content. Empty when there has been none. */
  streakResetOn?: string;
}

function blocksOn(ctx: WeekContext, date: string): Block[] {
  return scorable(ctx.plans[date]?.blocks ?? []);
}

/** All scorable blocks in the week, with their dates. */
function weekBlocks(ctx: WeekContext): { date: string; block: Block }[] {
  return ctx.dates.flatMap((date) => blocksOn(ctx, date).map((block) => ({ date, block })));
}

/** Bonus for a set, from what the set itself is worth. */
function bonusFor(ctx: WeekContext, blocks: Block[]): number {
  const base = blocks.reduce((s, b) => s + xpForBlock(b, ctx.categories).xp, 0);
  return Math.max(QUEST_BONUS_MIN, Math.round(base * QUEST_BONUS_SHARE));
}

function questFrom(
  ctx: WeekContext,
  id: string,
  kind: QuestKind,
  name: string,
  blurb: string,
  entries: { date: string; block: Block }[]
): Quest {
  const done = entries.filter((e) => e.block.completed).length;
  return {
    id,
    kind,
    name,
    blurb,
    dates: [...new Set(entries.map((e) => e.date))].sort(),
    bonusXp: bonusFor(ctx, entries.map((e) => e.block)),
    done,
    total: entries.length,
    complete: entries.length > 0 && done === entries.length,
  };
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/** Fewer than this and it is not a set, it is a task. */
const MIN_SET = 2;

/** One quest per weekly goal that has blocks scheduled against it. */
export function goalQuests(ctx: WeekContext): Quest[] {
  const out: Quest[] = [];
  for (const goal of ctx.week.goals) {
    if (goal.voided) continue;
    const entries = weekBlocks(ctx).filter((e) => e.block.goalId === goal.id);
    if (entries.length < MIN_SET) continue;
    out.push(
      questFrom(
        ctx,
        `goal:${ctx.weekKey}:${goal.id}`,
        'goal',
        goal.label,
        `Finish all ${entries.length} blocks booked against this goal`,
        entries
      )
    );
  }
  return out;
}

/**
 * A consecutive stretch of marked days becomes one quest.
 *
 * Runs are found by walking the week and breaking on an unmarked day or a change of
 * mark, so a travel day followed by three gig days is two quests rather than one
 * muddled four-day thing.
 */
export function runQuests(ctx: WeekContext): Quest[] {
  const out: Quest[] = [];
  let run: string[] = [];
  let currentMark = '';

  const flush = () => {
    if (run.length === 0) return;
    const def = markById(ctx.markDefs, currentMark);
    const entries = run.flatMap((date) => blocksOn(ctx, date).map((block) => ({ date, block })));
    // A trip with nothing scheduled has nothing to complete; a quest that is
    // complete the moment it appears is not a quest.
    if (def && entries.length >= MIN_SET) {
      out.push(
        questFrom(
          ctx,
          `run:${ctx.weekKey}:${currentMark}:${run[0]}`,
          'run',
          `${def.label} run`,
          `${run.length} ${def.label.toLowerCase()} day${run.length === 1 ? '' : 's'} — clear everything booked around them`,
          entries
        )
      );
    }
    run = [];
  };

  for (const date of ctx.dates) {
    const mark = ctx.marks[date];
    if (mark && mark === currentMark) {
      run.push(date);
    } else {
      flush();
      currentMark = mark ?? '';
      if (mark) run = [date];
    }
  }
  flush();
  return out;
}

/** One quest per active routine with at least two due days this week. */
export function routineQuests(ctx: WeekContext): Quest[] {
  const out: Quest[] = [];
  for (const template of ctx.habits.templates) {
    if (!template.active) continue;
    const due = ctx.dates.filter(
      (d) => template.createdOn <= d && matchesRule(template.rule, d)
    );
    if (due.length < MIN_SET) continue;

    // Instances are matched by templateId on the blocks, so a routine placed twice on
    // one day counts twice — which is right, both were real work.
    const entries = weekBlocks(ctx).filter((e) => e.block.templateId === template.id);
    if (entries.length < MIN_SET) continue;

    // The quest is over what is actually ON the calendar, not over what the rule says
    // is due. Saying "7 due" while completing at 2 of 2 made the tile disagree with
    // itself; the gap is worth naming rather than papering over.
    const shortfall =
      due.length > entries.length ? ` (${due.length} were due)` : '';
    out.push(
      questFrom(
        ctx,
        `routine:${ctx.weekKey}:${template.id}`,
        'routine',
        template.label,
        `Finish all ${entries.length} placed this week${shortfall}`,
        entries
      )
    );
  }
  return out;
}

/** How much bigger than the week's median a day must be to count as heavy. */
export const HEAVY_DAY_RATIO = 1.35;

/**
 * The week's biggest day, when it is genuinely an outlier.
 *
 * Compared against the median rather than the mean, because one enormous day would
 * drag a mean up and hide itself.
 */
export function heavyDayQuest(ctx: WeekContext): Quest[] {
  const loads = ctx.dates
    .map((date) => ({ date, minutes: blocksOn(ctx, date).reduce((s, b) => s + (b.end - b.start), 0) }))
    .filter((d) => d.minutes > 0);
  if (loads.length < 3) return [];

  const sorted = [...loads].sort((a, b) => a.minutes - b.minutes);
  const median = sorted[Math.floor(sorted.length / 2)].minutes;
  const heaviest = sorted[sorted.length - 1];
  if (median <= 0 || heaviest.minutes < median * HEAVY_DAY_RATIO) return [];

  const entries = blocksOn(ctx, heaviest.date).map((block) => ({ date: heaviest.date, block }));
  if (entries.length < MIN_SET) return [];
  return [
    questFrom(
      ctx,
      `heavy:${ctx.weekKey}:${heaviest.date}`,
      'heavyday',
      'The heavy one',
      `${Math.round(heaviest.minutes / 60)} hours booked — the biggest day of the week`,
      entries
    ),
  ];
}

// ---------------------------------------------------------------------------
// Wildcards — the rotating weekly set
// ---------------------------------------------------------------------------

interface WildcardSpec {
  id: string;
  name: string;
  blurb: string;
  total: number;
  /** How far along, counted from the week's own data. */
  done: (ctx: WeekContext) => number;
}

/**
 * ------------------------------------------------------------------------------------
 * THE THREE POOLS BELOW ARE EFFECTIVELY FROZEN. Read this before editing them.
 *
 * Selection is `seedFrom(key) % items.length`, so the LENGTH of a pool is part of the
 * answer for every seed. Appending is not the safe operation it looks like: add one
 * entry and every date and week re-draws, including ones already behind you.
 *
 * What that costs, concretely. Payout keys embed the drawn spec's id — `daily:DATE:id`,
 * `weekly:WEEK:id`. Change a pool mid-week and today's challenge becomes a different
 * challenge with a different key: whatever progress was showing resets, and the new key
 * is unpaid, so the same day can pay twice. Past weeks are protected only because
 * payouts are gated on the current week; nothing protects the week in progress.
 *
 * So:
 *   - Editing the name, blurb or `done` of an existing entry is safe. Its id and the
 *     pool length are unchanged, so every draw stays the same.
 *   - Adding or removing an entry re-rolls history. If it has to happen, ship it with a
 *     migration or accept that the current week's board is scrambled once.
 *   - Reordering is pointless and confusing: the seed is not positional in any way a
 *     reader can predict, so it changes draws without changing anything meaningful.
 *
 * The alternative — hashing each entry's id and picking the lowest — would make pools
 * genuinely append-safe. It is the right fix if these ever need to grow often. It is not
 * done here because it would re-roll every draw once, which is the very cost being
 * avoided, and the pools have been stable.
 * ------------------------------------------------------------------------------------
 */

/**
 * The pool. One is drawn per week, stably from the week key.
 *
 * Written as counters rather than pass/fail so a wildcard can show progress, and so
 * a near miss is visible rather than binary.
 */
export const WILDCARDS: WildcardSpec[] = [
  {
    id: 'clear-two',
    name: 'Two clean days',
    blurb: 'Complete every planned minute on two separate days',
    total: 2,
    done: (c) => c.dates.filter((d) => c.stats[d]?.cleared).length,
  },
  {
    id: 'deep-four',
    name: 'A deep day',
    blurb: 'Four hours of focus work in a single day',
    total: 1,
    done: (c) => (c.dates.some((d) => (c.stats[d]?.focusMinutes ?? 0) >= 240) ? 1 : 0),
  },
  {
    id: 'combo-four',
    name: 'In sequence',
    blurb: 'Reach a run of four in-order completions',
    total: 4,
    done: (c) => Math.max(0, ...c.dates.map((d) => c.stats[d]?.bestCombo ?? 0)),
  },
  {
    id: 'high-three',
    name: 'The hard things',
    blurb: 'Complete a high-priority block on three separate days',
    total: 3,
    done: (c) =>
      c.dates.filter((d) => blocksOn(c, d).some((b) => b.completed && b.priority === 'high'))
        .length,
  },
  {
    id: 'early-three',
    name: 'Morning shift',
    blurb: 'Finish something before 10am on three days',
    total: 3,
    done: (c) =>
      c.dates.filter((d) =>
        blocksOn(c, d).some((b) => b.completed && b.completedAt != null && b.completedAt < 600)
      ).length,
    },
  {
    id: 'no-moves',
    name: 'Held the plan',
    blurb: 'Complete twelve blocks without moving any of them',
    total: 12,
    done: (c) =>
      weekBlocks(c).filter((e) => e.block.completed && (e.block.moves ?? 0) === 0).length,
  },
  {
    id: 'spread',
    name: 'Broad week',
    blurb: 'Complete work in four different categories',
    total: 4,
    done: (c) =>
      new Set(weekBlocks(c).filter((e) => e.block.completed).map((e) => e.block.category)).size,
  },
  {
    id: 'long-two',
    name: 'Two long hauls',
    blurb: 'Complete two blocks of ninety minutes or more',
    total: 2,
    done: (c) =>
      weekBlocks(c).filter((e) => e.block.completed && e.block.end - e.block.start >= 90).length,
  },

  // --- appended, never reordered. ---

  {
    id: 'nothing-after-dark',
    name: 'Nothing after dark',
    blurb: 'Clear two days with nothing finished after seven',
    total: 2,
    done: (c) =>
      c.dates.filter((d) => {
        if (!c.stats[d]?.cleared) return false;
        return !blocksOn(c, d).some(
          (b) => b.completed && b.completedAt != null && b.completedAt >= 19 * 60
        );
      }).length,
  },
  {
    id: 'three-sittings',
    name: 'Three sittings',
    blurb: 'Complete three blocks of two hours or more, uninterrupted',
    total: 3,
    done: (c) =>
      weekBlocks(c).filter((e) => e.block.completed && e.block.end - e.block.start >= 120)
        .length,
  },
  {
    id: 'good-eye-six',
    name: 'A good eye',
    blurb: 'Finish six blocks within ten minutes of when you planned to',
    total: 6,
    done: (c) => weekBlocks(c).filter(({ block }) => finishedWhenPlanned(block)).length,
  },
  {
    id: 'honest-four',
    name: 'Honest week',
    blurb: 'Land within a twentieth of your planned minutes on four days',
    total: 4,
    done: (c) =>
      c.dates.filter((d) => {
        const s = c.stats[d];
        if (!s || s.plannedMinutes < 60) return false;
        return Math.abs(s.plannedMinutes - s.doneMinutes) <= s.plannedMinutes / 20;
      }).length,
  },
  {
    id: 'twice-returned',
    name: 'Twice returned',
    blurb: 'Twice, clear a day straight after one that fell short',
    total: 2,
    done: (c) => secondWinds(c),
  },
  {
    id: 'salvaged',
    name: 'Salvaged',
    blurb: 'Complete four blocks that had been moved more than once',
    total: 4,
    done: (c) => salvaged(weekBlocks(c).map(({ block }) => block)).length,
  },
  {
    id: 'know-the-hour',
    name: 'Know the hour',
    blurb: 'Complete six blocks in your strongest hour',
    total: 6,
    done: (c) => inStrongestHour(c),
  },
  {
    id: 'far-field',
    name: 'Far field',
    blurb: 'Put two hours into the category you have touched least',
    total: 120,
    done: (c) => {
      const id = c.profile?.leastTouched;
      if (!id) return 0;
      return minutesByCategory(c)[id] ?? 0;
    },
  },
];

/**
 * The week's wildcard, or two if a second slot has been bought.
 *
 * `rerolls` shifts the draw rather than re-rolling live, so a reroll is reproducible:
 * the same week with the same number of rerolls always lands on the same wildcard.
 */
export function wildcardQuest(
  ctx: WeekContext,
  opts: { extra?: boolean; rerolls?: number } = {}
): Quest[] {
  const out: Quest[] = [];
  const slots = opts.extra ? 2 : 1;
  for (let slot = 0; slot < slots; slot++) {
    out.push(oneWildcard(ctx, slot + (opts.rerolls ?? 0) * 7));
  }
  return out;
}

function oneWildcard(ctx: WeekContext, offset: number): Quest {
  const spec = resolved(
    WILDCARDS,
    ctx.draws?.wildcards[offset],
    `wildcard:${ctx.weekKey}`,
    offset
  );
  const done = Math.min(spec.done(ctx), spec.total);
  return {
      id: `wild:${ctx.weekKey}:${spec.id}`,
      kind: 'wildcard',
      name: spec.name,
      blurb: spec.blurb,
      dates: [],
      bonusXp: WILDCARD_XP,
      done,
      total: spec.total,
      complete: done >= spec.total,
  };
}

/** Everything the week is offering, generated fresh. */
export function questsFor(
  ctx: WeekContext,
  opts: { extraWildcard?: boolean; rerolls?: number } = {}
): Quest[] {
  const wilds = wildcardQuest(ctx, {
    extra: opts.extraWildcard,
    rerolls: opts.rerolls,
  });
  // Two slots can draw the same spec; keep them distinct so ids stay unique.
  const seen = new Set<string>();
  const unique = wilds.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
  return [
    ...goalQuests(ctx),
    ...runQuests(ctx),
    ...routineQuests(ctx),
    ...heavyDayQuest(ctx),
    ...unique,
  ];
}

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

interface ChallengeSpec {
  id: string;
  name: string;
  blurb: string;
  total: number;
  done: (ctx: WeekContext, date: string) => number;
}

/** One drawn per day, stably from the date. Frozen — see the note above WILDCARDS. */
export const DAILY_CHALLENGES: ChallengeSpec[] = [
  {
    id: 'first-by-noon',
    name: 'Before lunch',
    blurb: 'Finish your first block before noon',
    total: 1,
    done: (c, d) =>
      blocksOn(c, d).some((b) => b.completed && b.completedAt != null && b.completedAt < 720)
        ? 1
        : 0,
  },
  {
    id: 'three-in-order',
    name: 'Three in a row',
    blurb: 'Complete three blocks in scheduled order',
    total: 3,
    done: (c, d) => Math.min(3, c.stats[d]?.bestCombo ?? 0),
  },
  {
    id: 'longest-first',
    name: 'Biggest first',
    blurb: "Finish the day's longest block before any other",
    total: 1,
    done: (c, d) => {
      const blocks = blocksOn(c, d);
      if (blocks.length === 0) return 0;
      const longest = blocks.reduce((m, b) => (b.end - b.start > m.end - m.start ? b : m));
      if (!longest.completed || longest.completedAt == null) return 0;
      const earlier = blocks.filter(
        (b) => b.id !== longest.id && b.completed && b.completedAt != null
      );
      return earlier.every((b) => b.completedAt! >= longest.completedAt!) ? 1 : 0;
    },
  },
  {
    id: 'high-priority',
    name: 'The important one',
    blurb: 'Complete a high-priority block',
    total: 1,
    done: (c, d) => (blocksOn(c, d).some((b) => b.completed && b.priority === 'high') ? 1 : 0),
  },
  {
    id: 'two-focus',
    name: 'Two deep',
    blurb: 'Complete two focus blocks',
    total: 2,
    done: (c, d) => {
      const focusIds = new Set(
        c.categories.filter((cat) => cat.kind === 'focus').map((cat) => cat.id)
      );
      return blocksOn(c, d).filter((b) => b.completed && focusIds.has(b.category)).length;
    },
  },
  {
    id: 'clear-it',
    name: 'Clean sheet',
    blurb: 'Complete every planned minute today',
    total: 1,
    done: (c, d) => (c.stats[d]?.cleared ? 1 : 0),
  },

  // --- appended, never reordered. ---

  {
    id: 'down-tools',
    name: 'Down tools',
    blurb: 'Clear the day with nothing finished after seven',
    total: 1,
    done: (c, d) => {
      if (!c.stats[d]?.cleared) return 0;
      const late = blocksOn(c, d).some(
        (b) => b.completed && b.completedAt != null && b.completedAt >= 19 * 60
      );
      return late ? 0 : 1;
    },
  },
  {
    id: 'one-sitting',
    name: 'One sitting',
    blurb: 'Finish two hours or more with nothing scheduled inside it',
    total: 1,
    done: (c, d) =>
      blocksOn(c, d).some((b) => b.completed && b.end - b.start >= 120) ? 1 : 0,
  },
  {
    id: 'as-planned',
    name: 'As planned',
    blurb: 'Complete every block without moving any of them',
    total: 1,
    done: (c, d) => {
      const blocks = blocksOn(c, d);
      if (blocks.length === 0) return 0;
      return blocks.every((b) => b.completed && (b.moves ?? 0) === 0) ? 1 : 0;
    },
  },
  {
    id: 'to-the-minute',
    name: 'To the minute',
    blurb: 'Finish two blocks within five minutes of when you planned to',
    total: 2,
    done: (c, d) => blocksOn(c, d).filter((b) => finishedWhenPlanned(b, 5)).length,
  },
  {
    id: 'back-to-the-bench',
    name: 'Back to the bench',
    blurb: 'Clear a day within two days of a fresh start',
    total: 1,
    done: (c, d) => {
      const reset = c.streakResetOn;
      if (!reset || !c.stats[d]?.cleared) return 0;
      const gap = daysBetween(reset, d);
      return gap >= 0 && gap <= 2 ? 1 : 0;
    },
  },
  {
    id: 'dawn-watch',
    name: 'Dawn watch',
    blurb: 'Finish something before seven',
    total: 1,
    done: (c, d) =>
      blocksOn(c, d).some(
        (b) => b.completed && b.completedAt != null && b.completedAt < 7 * 60
      )
        ? 1
        : 0,
  },
];

/** One drawn per week. Frozen — see the note above WILDCARDS. */
export const WEEKLY_CHALLENGES: ChallengeSpec[] = [
  {
    id: 'five-kept',
    name: 'Five days kept',
    blurb: 'Meet the daily threshold on five days',
    total: 5,
    // Deliberately the same predicate the run counter uses, rather than a local copy
    // of the arithmetic. The copy that used to live here read the threshold as a bare
    // 0.6 and ignored day marks, so a travel day counted as kept by the streak and
    // not kept by this quest — two answers to "did I meet the threshold today", one
    // of which the blurb was promising.
    done: (c) => c.dates.filter((d) => todayQualifies(c.stats[d], c.marks[d] != null)).length,
  },
  {
    id: 'xp-1200',
    name: 'Twelve hundred',
    blurb: 'Earn 1,200 XP across the week',
    total: 1200,
    done: (c) => c.dates.reduce((s, d) => s + (c.stats[d]?.xpEarned ?? 0), 0),
  },
  {
    id: 'three-clear',
    name: 'Three clean days',
    blurb: 'Clear three whole days',
    total: 3,
    done: (c) => c.dates.filter((d) => c.stats[d]?.cleared).length,
  },
  {
    id: 'focus-ten',
    name: 'Ten deep hours',
    blurb: 'Ten hours of focus work across the week',
    total: 600,
    done: (c) => c.dates.reduce((s, d) => s + (c.stats[d]?.focusMinutes ?? 0), 0),
  },

  // --- appended, never reordered. Four axes, none of them "do N of X". ---

  // Constraint: the only axis that can make an easy week interesting.
  {
    id: 'nothing-moved',
    name: 'Nothing moved',
    blurb: 'Complete twenty blocks without moving any of them',
    total: 20,
    done: (c) =>
      weekBlocks(c).filter(({ block }) => block.completed && (block.moves ?? 0) === 0).length,
  },
  {
    id: 'even-hand',
    name: 'Even hand',
    blurb: 'Let no category take more than half your completed minutes',
    total: 1,
    done: (c) => {
      const by = minutesByCategory(c);
      const total = Object.values(by).reduce((a, b) => a + b, 0);
      // Needs a real week behind it: two blocks in one category is not an imbalance.
      if (total < 240 || Object.keys(by).length < 2) return 0;
      return Math.max(...Object.values(by)) <= total / 2 ? 1 : 0;
    },
  },

  // Prediction: rewards estimation, which is the skill a planner teaches and which
  // nothing else here pays for.
  {
    id: 'good-eye',
    name: 'Good eye',
    blurb: 'Finish five blocks within ten minutes of when you planned to',
    total: 5,
    done: (c) => weekBlocks(c).filter(({ block }) => finishedWhenPlanned(block)).length,
  },
  {
    id: 'honest-hours',
    name: 'Honest hours',
    blurb: 'Land planned and completed minutes within a twentieth of each other',
    total: 1,
    done: (c) => {
      const planned = c.dates.reduce((s, d) => s + (c.stats[d]?.plannedMinutes ?? 0), 0);
      const done = c.dates.reduce((s, d) => s + (c.stats[d]?.doneMinutes ?? 0), 0);
      if (planned < 300) return 0;
      return Math.abs(planned - done) <= planned / 20 ? 1 : 0;
    },
  },

  // Recovery: the streak already frames a reset as a fresh start; nothing yet paid for
  // taking one.
  {
    id: 'second-wind',
    name: 'Second wind',
    blurb: 'Clear a day straight after one that fell short',
    total: 1,
    done: (c) => secondWinds(c),
  },
  {
    id: 'salvage',
    name: 'Salvage',
    blurb: 'Complete three blocks that had been moved more than once',
    total: 3,
    done: (c) => salvaged(weekBlocks(c).map(({ block }) => block)).length,
  },

  // Discovery: gets more interesting the longer the app is used.
  {
    id: 'best-hour',
    name: 'Your best hour',
    blurb: 'Complete four blocks in the hour you most often finish work',
    total: 4,
    done: (c) => inStrongestHour(c),
  },
  {
    id: 'quiet-corner',
    name: 'The quiet corner',
    blurb: 'Put an hour into the category you have touched least this month',
    total: 60,
    done: (c) => {
      const id = c.profile?.leastTouched;
      if (!id) return 0;
      return minutesByCategory(c)[id] ?? 0;
    },
  },
];

/** Days that cleared straight after one that fell short of the threshold. */
function secondWinds(c: WeekContext): number {
  let count = 0;
  for (let i = 1; i < c.dates.length; i++) {
    const before = c.stats[c.dates[i - 1]];
    const after = c.stats[c.dates[i]];
    if (!before || !after) continue;
    const fellShort = before.plannedMinutes > 0 && !todayQualifies(before, false);
    if (fellShort && after.cleared) count += 1;
  }
  return count;
}

/** Completions landing in the profile's strongest hour. Zero when there is no such hour. */
function inStrongestHour(c: WeekContext): number {
  const hour = c.profile?.strongestHour;
  if (hour == null) return 0;
  return weekBlocks(c).filter(
    ({ block }) =>
      block.completed &&
      block.completedAt != null &&
      Math.floor(block.completedAt / 60) % 24 === hour
  ).length;
}

function challengeFrom(
  spec: ChallengeSpec,
  id: string,
  xp: number,
  ctx: WeekContext,
  date: string
): Challenge {
  const done = Math.min(spec.done(ctx, date), spec.total);
  return {
    id,
    name: spec.name,
    blurb: spec.blurb,
    xp,
    done,
    total: spec.total,
    complete: done >= spec.total,
  };
}

export function dailyChallenge(ctx: WeekContext, date: string): Challenge {
  const spec = resolved(DAILY_CHALLENGES, ctx.draws?.daily[date], `daily:${date}`);
  return challengeFrom(spec, `daily:${date}:${spec.id}`, DAILY_CHALLENGE_XP, ctx, date);
}

export function weeklyChallenge(ctx: WeekContext): Challenge {
  const spec = resolved(WEEKLY_CHALLENGES, ctx.draws?.weekly, `weekly:${ctx.weekKey}`);
  return challengeFrom(
    spec,
    `weekly:${ctx.weekKey}:${spec.id}`,
    WEEKLY_CHALLENGE_XP,
    ctx,
    ctx.weekKey
  );
}

// ---------------------------------------------------------------------------
// Payout
// ---------------------------------------------------------------------------

export const QUEST_KEY_PREFIX = 'quest:';

export function questKey(id: string): string {
  return QUEST_KEY_PREFIX + id;
}

/**
 * What is finished and not yet paid.
 *
 * A quest whose week has passed is simply never evaluated again — the generator only
 * ever produces the current week's set, so expiry needs no clean-up and no record.
 * Nothing anywhere reports a quest as failed.
 */
export function questPayout(
  ledger: AwardLedger,
  quests: Quest[],
  challenges: Challenge[]
): AwardPayout[] {
  const payouts: AwardPayout[] = [];
  for (const q of quests) {
    if (!q.complete) continue;
    const key = questKey(q.id);
    if (ledger.granted.includes(key)) continue;
    payouts.push({ key, xp: q.bonusXp, label: q.name });
  }
  for (const c of challenges) {
    if (!c.complete) continue;
    const key = questKey(c.id);
    if (ledger.granted.includes(key)) continue;
    payouts.push({ key, xp: c.xp, label: c.name });
  }
  return payouts;
}

export function isPaid(ledger: AwardLedger, id: string): boolean {
  return ledger.granted.includes(questKey(id));
}

/** Weekly progress across the whole set, for the fold summary. */
export function questSummary(quests: Quest[]): { complete: number; total: number } {
  return { complete: quests.filter((q) => q.complete).length, total: quests.length };
}

export function buildWeekContext(args: {
  weekKey: string;
  plans: Record<string, DayPlan>;
  stats: Record<string, DailyStat>;
  week: WeekRecord;
  habits: HabitStore;
  marks: DayMarks;
  markDefs: DayMarkDef[];
  categories: CategoryDef[];
  /**
   * The day scoring began. Days before it are dropped from the week entirely.
   *
   * Without this a fresh account was handed a completed wildcard on its first launch:
   * the current week still contained finished blocks from before the start date, and a
   * quest like "two blocks of ninety minutes" was satisfied the moment it appeared.
   * Every other layer already measured from the start; this one did not.
   */
  startedOn?: string;
  profile?: ProfileFacts;
  streakResetOn?: string;
}): WeekContext {
  const all = weekDates(args.weekKey);
  const dates = args.startedOn ? all.filter((d) => d >= args.startedOn!) : all;
  // The seal lives on the week record, so there is nothing for the caller to thread — and
  // no way for the draws and the week they belong to to disagree.
  return { ...args, dates, draws: args.week.draws };
}

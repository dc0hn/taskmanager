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
import { todayQualifies } from './streaks';
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
  const spec = pick(WILDCARDS, `wildcard:${ctx.weekKey}`, offset);
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
];

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
  const spec = pick(DAILY_CHALLENGES, `daily:${date}`);
  return challengeFrom(spec, `daily:${date}:${spec.id}`, DAILY_CHALLENGE_XP, ctx, date);
}

export function weeklyChallenge(ctx: WeekContext): Challenge {
  const spec = pick(WEEKLY_CHALLENGES, `weekly:${ctx.weekKey}`);
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
}): WeekContext {
  const all = weekDates(args.weekKey);
  const dates = args.startedOn ? all.filter((d) => d >= args.startedOn!) : all;
  return { ...args, dates };
}

import type {
  AwardLedger,
  BadgeDef,
  Block,
  CategoryDef,
  DailyStat,
  DayMarks,
  StreakState,
  UserProgress,
} from './types';
import { UNKNOWN_CATEGORY } from './types';
import { scorable, standingFor } from './progress';
import { STREAK_THRESHOLD, daysBetween, shiftDay, todayQualifies } from './streaks';
import { weekdayOf } from './week';

// ============================================================================
// Badges
//
// The small-wins layer. Variety is what makes it work, so the library mixes three
// kinds deliberately: milestones you can see coming and aim at, behavioural ones
// hidden until they fire, and effort ones that pay for the genuinely hard thing.
//
// Three design rules hold throughout:
//
//   NOTHING IS RETROACTIVE. Counting badges measure from the day tracking started,
//   not across the backfilled archive. A user who already has three hundred
//   completed blocks earns "First Light" on their next one, which is the point —
//   every badge is a live moment rather than a list that arrives pre-ticked.
//
//   CONDITIONS READ ONE CONTEXT. Every badge is a predicate over the same
//   `BadgeContext`, so adding one is a line in a table rather than new plumbing
//   through the app. That is what the brief meant by data-driven.
//
//   HIDDEN MEANS SURPRISING, NOT OBSCURE. Milestones are always visible, because a
//   hidden signpost is just a missing one. The behavioural badges are sealed,
//   because knowing in advance that finishing before 9am pays would turn a
//   discovery into a chore.
// ============================================================================

/** Everything any condition can read. Assembled once per evaluation. */
export interface BadgeContext {
  /** Blocks completed since tracking began. */
  blocksCompleted: number;
  /** Days kept since tracking began. */
  daysKept: number;
  level: number;
  prestige: number;
  streakCurrent: number;
  streakLongest: number;
  /** Best single-day XP since tracking began. */
  bestDayXp: number;
  /** Consecutive weekdays meeting the threshold, counting back from yesterday. */
  weekdayRun: number;
  /** True on the day a comeback bonus was paid. */
  comebackToday: boolean;

  // ---- today, from live blocks ----
  todayScore: number;
  todayCleared: boolean;
  todayCompleted: number;
  todayHighPriority: number;
  todayFocusMinutes: number;
  todayBestCombo: number;
  todayDistinctCategories: number;
  /** Longest completed block today, in minutes. */
  todayLongestBlock: number;
  /** Earliest and latest completion times today, minutes since midnight. */
  todayEarliest: number | null;
  todayLatest: number | null;
  /** When the last block of a cleared day was ticked. Null if not cleared. */
  todayClearedAt: number | null;
  /** Most moves on any block completed today. */
  todayMaxMoves: number;
}

interface BadgeRule extends BadgeDef {
  test: (c: BadgeContext) => boolean;
  /** Current count toward `target`, for the progress meter. */
  progress?: (c: BadgeContext) => number;
}

const NINE_AM = 9 * 60;
const SEVEN_AM = 7 * 60;
const NINE_PM = 21 * 60;
const NOON = 12 * 60;

/**
 * The library.
 *
 * XP scales with how hard the thing is rather than how rare: a hundred-day streak
 * pays more than a hidden novelty, however delightful the novelty is.
 */
export const BADGES: BadgeRule[] = [
  // ---- milestones: visible, aimable ----
  {
    id: 'first-block',
    ladder: 'blocks',
    rung: '1',
    name: 'First Light',
    description: 'Complete your first block',
    group: 'milestone',
    xp: 40,
    glyph: 0,
    test: (c) => c.blocksCompleted >= 1,
    target: 1,
    progress: (c) => c.blocksCompleted,
  },
  {
    id: 'blocks-10',
    ladder: 'blocks',
    rung: '10',
    name: 'Ten Down',
    description: 'Complete 10 blocks',
    group: 'milestone',
    xp: 80,
    glyph: 0,
    test: (c) => c.blocksCompleted >= 10,
    target: 10,
    progress: (c) => c.blocksCompleted,
  },
  {
    id: 'blocks-50',
    ladder: 'blocks',
    rung: '50',
    name: 'Fifty Down',
    description: 'Complete 50 blocks',
    group: 'milestone',
    xp: 200,
    glyph: 2,
    test: (c) => c.blocksCompleted >= 50,
    target: 50,
    progress: (c) => c.blocksCompleted,
  },
  {
    id: 'blocks-250',
    ladder: 'blocks',
    rung: '250',
    name: 'Two Hundred and Fifty',
    description: 'Complete 250 blocks',
    group: 'milestone',
    xp: 600,
    glyph: 7,
    test: (c) => c.blocksCompleted >= 250,
    target: 250,
    progress: (c) => c.blocksCompleted,
  },
  {
    id: 'level-5',
    ladder: 'levels',
    rung: '5',
    name: 'Getting Somewhere',
    description: 'Reach level 5',
    group: 'milestone',
    xp: 60,
    glyph: 0,
    test: (c) => c.level >= 5,
    target: 5,
    progress: (c) => c.level,
  },
  {
    id: 'level-10',
    ladder: 'levels',
    rung: '10',
    name: 'Journeyman',
    description: 'Reach level 10',
    group: 'milestone',
    xp: 120,
    glyph: 5,
    test: (c) => c.level >= 10,
    target: 10,
    progress: (c) => c.level,
  },
  {
    id: 'level-25',
    ladder: 'levels',
    rung: '25',
    name: 'Quarter Century',
    description: 'Reach level 25',
    group: 'milestone',
    xp: 300,
    glyph: 3,
    test: (c) => c.level >= 25,
    target: 25,
    progress: (c) => c.level,
  },
  {
    id: 'prestige-1',
    name: 'Full Circle',
    description: 'Complete a whole 60-level cycle',
    group: 'milestone',
    xp: 800,
    glyph: 7,
    test: (c) => c.prestige >= 1,
    target: 1,
    progress: (c) => c.prestige,
  },
  {
    id: 'streak-7',
    ladder: 'runs',
    rung: '7',
    name: 'A Week Unbroken',
    description: 'Keep the run for 7 days',
    group: 'milestone',
    xp: 150,
    glyph: 2,
    test: (c) => c.streakLongest >= 7,
    target: 7,
    progress: (c) => c.streakLongest,
  },
  {
    id: 'streak-30',
    ladder: 'runs',
    rung: '30',
    name: 'A Month Unbroken',
    description: 'Keep the run for 30 days',
    group: 'milestone',
    xp: 500,
    glyph: 5,
    test: (c) => c.streakLongest >= 30,
    target: 30,
    progress: (c) => c.streakLongest,
  },
  {
    id: 'streak-100',
    ladder: 'runs',
    rung: '100',
    name: 'A Hundred Days',
    description: 'Keep the run for 100 days',
    group: 'milestone',
    xp: 1500,
    glyph: 7,
    test: (c) => c.streakLongest >= 100,
    target: 100,
    progress: (c) => c.streakLongest,
  },

  // ---- behaviour: hidden, discovered ----
  {
    id: 'early-bird',
    name: 'Before the Bell',
    description: 'Finish something before 9am',
    group: 'behaviour',
    hidden: true,
    xp: 70,
    glyph: 1,
    test: (c) => c.todayEarliest != null && c.todayEarliest < NINE_AM,
  },
  {
    id: 'dawn-patrol',
    name: 'Dawn Patrol',
    description: 'Finish something before 7am',
    group: 'behaviour',
    hidden: true,
    xp: 140,
    glyph: 1,
    test: (c) => c.todayEarliest != null && c.todayEarliest < SEVEN_AM,
  },
  {
    id: 'night-owl',
    name: 'After Hours',
    description: 'Finish something after 9pm',
    group: 'behaviour',
    hidden: true,
    xp: 70,
    glyph: 4,
    test: (c) => c.todayLatest != null && c.todayLatest >= NINE_PM,
  },
  {
    id: 'flawless',
    name: 'Flawless',
    description: 'Complete every planned minute of a day',
    group: 'behaviour',
    hidden: true,
    xp: 120,
    glyph: 2,
    test: (c) => c.todayCleared,
  },
  {
    id: 'clean-sweep',
    name: 'Clean Sweep',
    description: 'Clear the whole day before noon',
    group: 'behaviour',
    hidden: true,
    xp: 250,
    glyph: 3,
    test: (c) => c.todayClearedAt != null && c.todayClearedAt < NOON,
  },
  {
    id: 'finally',
    name: 'Finally',
    description: 'Finish something you had moved three times or more',
    group: 'behaviour',
    hidden: true,
    xp: 130,
    glyph: 4,
    test: (c) => c.todayMaxMoves >= 3,
  },
  {
    id: 'deep-diver',
    name: 'Deep Diver',
    description: 'Complete three high-priority blocks in one day',
    group: 'behaviour',
    hidden: true,
    xp: 180,
    glyph: 5,
    test: (c) => c.todayHighPriority >= 3,
  },
  {
    id: 'on-a-roll',
    name: 'On a Roll',
    description: 'Reach a full combo in one day',
    group: 'behaviour',
    hidden: true,
    xp: 160,
    glyph: 2,
    test: (c) => c.todayBestCombo >= 6,
  },
  {
    id: 'full-spread',
    name: 'Full Spread',
    description: 'Complete a block in three different categories in one day',
    group: 'behaviour',
    hidden: true,
    xp: 110,
    glyph: 6,
    test: (c) => c.todayDistinctCategories >= 3,
  },
  {
    id: 'comeback',
    name: 'Back on the Horse',
    description: 'Keep the run again after a fresh start',
    group: 'behaviour',
    hidden: true,
    xp: 90,
    glyph: 1,
    test: (c) => c.comebackToday,
  },

  // ---- effort: the hard stuff ----
  {
    id: 'heavy-lifter',
    name: 'Heavy Lifter',
    description: 'Complete a single block over two hours',
    group: 'effort',
    xp: 150,
    glyph: 5,
    test: (c) => c.todayLongestBlock > 120,
  },
  {
    id: 'focus-marathon',
    name: 'Focus Marathon',
    description: 'Four hours of deep work in one day',
    group: 'effort',
    xp: 300,
    glyph: 6,
    test: (c) => c.todayFocusMinutes >= 240,
    target: 240,
    progress: (c) => c.todayFocusMinutes,
  },
  {
    id: 'weekday-five',
    name: 'Five in a Row',
    description: 'Keep the run five weekdays running',
    group: 'effort',
    xp: 260,
    glyph: 3,
    test: (c) => c.weekdayRun >= 5,
    target: 5,
    progress: (c) => c.weekdayRun,
  },
  {
    id: 'big-day',
    name: 'Big Day',
    description: 'Earn 500 XP in a single day',
    group: 'effort',
    xp: 220,
    glyph: 4,
    test: (c) => c.bestDayXp >= 500,
    target: 500,
    progress: (c) => c.bestDayXp,
  },
  {
    id: 'hundred-days-kept',
    name: 'The Long Haul',
    description: 'Keep 100 separate days',
    group: 'effort',
    xp: 700,
    glyph: 7,
    test: (c) => c.daysKept >= 100,
    target: 100,
    progress: (c) => c.daysKept,
  },
];

export function badgeById(id: string): BadgeRule | undefined {
  return BADGES.find((b) => b.id === id);
}

export const BADGE_KEY_PREFIX = 'badge:';

/**
 * Marks a badge that was already true the day tracking began.
 *
 * Needed because "no retroactive badges" pulls two ways. Counting badges are easy —
 * an epoch stops the archive feeding them. But a user backfilled to level 60 has
 * *genuinely* reached level 25, and no future action can earn that again, so leaving
 * it locked forever would be a lie in the other direction. On first launch it dumped
 * seven badges and two thousand unearned XP the moment the window opened.
 *
 * So they are sealed instead: recorded as earned, paid nothing, and labelled prior
 * service — the same framing the backfilled XP already uses. Everything after that
 * day is a live moment.
 */
export const PRIOR_KEY_PREFIX = 'prior:';

export function priorKey(id: string): string {
  return PRIOR_KEY_PREFIX + id;
}

export function isPrior(ledger: AwardLedger, id: string): boolean {
  return ledger.granted.includes(priorKey(id));
}

// `sealPriorBadges` lived here. It granted every already-true badge without paying,
// to soften a backfill that began a new user mid-progression. Nothing before
// `startedOn` is scored any more, so no badge can be true on day one and there is
// nothing to seal. The prior markers above survive only so a record written while
// the backfill existed still reads honestly.

export function badgeKey(id: string): string {
  return BADGE_KEY_PREFIX + id;
}

export function isBadgeKey(key: string): boolean {
  return key.startsWith(BADGE_KEY_PREFIX);
}

export function badgeIdFromKey(key: string): string {
  return key.slice(BADGE_KEY_PREFIX.length);
}

// ---------------------------------------------------------------------------
// Building the context
// ---------------------------------------------------------------------------

function kindOf(categoryId: string, categories: CategoryDef[]): string {
  return (categories.find((c) => c.id === categoryId) ?? UNKNOWN_CATEGORY).kind;
}

/**
 * Consecutive weekdays meeting the threshold, counting back from yesterday.
 *
 * Weekends are skipped rather than breaking the run — the badge is about showing up
 * on working days, and penalising someone for not working Sunday would be absurd.
 */
export function weekdayRun(
  stats: Record<string, DailyStat>,
  marks: DayMarks,
  today: string,
  maxLookback = 40
): number {
  let run = 0;
  for (let i = 1; i <= maxLookback; i++) {
    const date = shiftDay(today, -i);
    const dow = weekdayOf(date);
    if (dow === 0 || dow === 6) continue;
    if (todayQualifies(stats[date], marks[date] != null, STREAK_THRESHOLD)) run++;
    else break;
  }
  return run;
}

/**
 * Assemble everything the conditions read.
 *
 * `epoch` is the day tracking began; counting badges measure from there so a
 * backfilled archive cannot pre-unlock them.
 */
export function badgeContext(args: {
  progress: UserProgress;
  streak: StreakState;
  stats: Record<string, DailyStat>;
  marks: DayMarks;
  todayBlocks: Block[];
  categories: CategoryDef[];
  today: string;
  epoch: string;
  comebackToday: boolean;
}): BadgeContext {
  const { progress, streak, stats, marks, todayBlocks, categories, today, epoch } = args;
  const standing = standingFor(progress.totalXp);

  let blocksCompleted = 0;
  let daysKept = 0;
  let bestDayXp = 0;
  for (const [date, stat] of Object.entries(stats)) {
    // Strictly after the epoch, so the archive that was backfilled for XP cannot
    // hand out achievements it was never meant to.
    if (epoch && date < epoch) continue;
    blocksCompleted += stat.completedCount;
    bestDayXp = Math.max(bestDayXp, stat.xpEarned);
    if (todayQualifies(stat, marks[date] != null, STREAK_THRESHOLD)) daysKept++;
  }

  const real = scorable(todayBlocks);
  const done = real.filter((b) => b.completed);
  const stamps = done
    .map((b) => b.completedAt)
    .filter((t): t is number => t != null);

  const plannedMinutes = real.reduce((s, b) => s + (b.end - b.start), 0);
  const doneMinutes = done.reduce((s, b) => s + (b.end - b.start), 0);
  const cleared = plannedMinutes > 0 && doneMinutes >= plannedMinutes;

  return {
    blocksCompleted,
    daysKept,
    level: standing.level,
    prestige: standing.prestige,
    streakCurrent: streak.current,
    streakLongest: streak.longest,
    bestDayXp,
    weekdayRun: weekdayRun(stats, marks, today),
    comebackToday: args.comebackToday,

    todayScore: plannedMinutes > 0 ? doneMinutes / plannedMinutes : 0,
    todayCleared: cleared,
    todayCompleted: done.length,
    todayHighPriority: done.filter((b) => b.priority === 'high').length,
    todayFocusMinutes: done
      .filter((b) => kindOf(b.category, categories) === 'focus')
      .reduce((s, b) => s + (b.end - b.start), 0),
    todayBestCombo: bestComboOf(real),
    todayDistinctCategories: new Set(done.map((b) => b.category)).size,
    todayLongestBlock: done.reduce((m, b) => Math.max(m, b.end - b.start), 0),
    todayEarliest: stamps.length > 0 ? Math.min(...stamps) : null,
    todayLatest: stamps.length > 0 ? Math.max(...stamps) : null,
    // Only meaningful for a day that is actually finished; otherwise the "by noon"
    // condition would fire on a half-done morning.
    todayClearedAt: cleared && stamps.length > 0 ? Math.max(...stamps) : null,
    todayMaxMoves: done.reduce((m, b) => Math.max(m, b.moves ?? 0), 0),
  };
}

function bestComboOf(ordered: Block[]): number {
  let run = 0;
  let best = 0;
  for (const b of ordered) {
    if (b.completed) {
      run++;
      best = Math.max(best, run);
    } else {
      run = 0;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

export interface BadgeEvaluation {
  /** Award keys for badges newly satisfied and not already held. */
  keys: string[];
  ids: string[];
  xp: number;
}

/** Which badges are now earned but not yet granted. */
export function evaluateBadges(
  ledger: AwardLedger,
  context: BadgeContext
): BadgeEvaluation {
  const keys: string[] = [];
  const ids: string[] = [];
  let xp = 0;
  for (const badge of BADGES) {
    const key = badgeKey(badge.id);
    if (ledger.granted.includes(key)) continue;
    if (!badge.test(context)) continue;
    keys.push(key);
    ids.push(badge.id);
    xp += badge.xp;
  }
  return { keys, ids, xp };
}

export interface BadgeStatus {
  def: BadgeDef;
  earned: boolean;
  /** Earned, but already true before tracking began — so it paid nothing. */
  prior: boolean;
  /** 0..1 when the badge counts up and is still locked. */
  progress: number | null;
  progressLabel: string | null;
}

/** Every badge with its state, for the library view. */
export function badgeStatuses(
  ledger: AwardLedger,
  context: BadgeContext
): BadgeStatus[] {
  return BADGES.map((badge) => {
    const earned = ledger.granted.includes(badgeKey(badge.id));
    const prior = earned && isPrior(ledger, badge.id);
    let progress: number | null = null;
    let progressLabel: string | null = null;
    if (!earned && badge.target != null && badge.progress) {
      const now = Math.min(badge.progress(context), badge.target);
      progress = badge.target > 0 ? now / badge.target : 0;
      progressLabel = `${now} / ${badge.target}`;
    }
    return { def: badge, earned, prior, progress, progressLabel };
  });
}

/** Ladder ids in the order they should appear, with a name for the tile. */
export const LADDERS: { id: string; name: string; description: string }[] = [
  { id: 'blocks', name: 'Blocks completed', description: 'Every block you finish' },
  { id: 'levels', name: 'Levels reached', description: 'How far up the ranks' },
  { id: 'runs', name: 'Longest run', description: 'Days kept without a break' },
];

export interface LadderStatus {
  id: string;
  name: string;
  description: string;
  /** Rungs in ascending order. */
  rungs: BadgeStatus[];
  /** How many are earned. */
  earned: number;
  /** The first unearned rung, or null once the ladder is complete. */
  next: BadgeStatus | null;
  /** Total XP the ladder has paid so far, excluding sealed ones. */
  paid: number;
}

/** Group ladder badges into single tiles, preserving rung order. */
export function laddersOf(statuses: BadgeStatus[]): LadderStatus[] {
  return LADDERS.map((l) => {
    const rungs = statuses
      .filter((s) => s.def.ladder === l.id)
      .sort((a, b) => (a.def.target ?? 0) - (b.def.target ?? 0));
    const earned = rungs.filter((r) => r.earned).length;
    return {
      ...l,
      rungs,
      earned,
      next: rungs.find((r) => !r.earned) ?? null,
      paid: rungs.filter((r) => r.earned && !r.prior).reduce((s, r) => s + r.def.xp, 0),
    };
  }).filter((l) => l.rungs.length > 0);
}

/** Statuses that are not part of any ladder. */
export function standalone(statuses: BadgeStatus[]): BadgeStatus[] {
  return statuses.filter((s) => s.def.ladder == null);
}

/**
 * The locked badge closest to being earned, for the "next up" line.
 *
 * Only considers badges that can show progress — a hidden behavioural one has no
 * partial state, so naming it as "next" would be both a spoiler and a guess.
 */
export function nextUp(statuses: BadgeStatus[]): BadgeStatus | null {
  const candidates = statuses.filter(
    (s) =>
      !s.earned &&
      !s.def.hidden &&
      s.progress != null &&
      s.progress > 0 &&
      // A badge already at its target is about to be granted, not something to aim
      // at. Without this, a satisfied-but-not-yet-evaluated badge sits at the top of
      // the list saying "next up" about a thing that is already done.
      s.progress < 1
  );
  if (candidates.length === 0) return null;
  return candidates.reduce((best, s) =>
    (s.progress ?? 0) > (best.progress ?? 0) ? s : best
  );
}

export function earnedCount(ledger: AwardLedger): number {
  return ledger.granted.filter(isBadgeKey).length;
}

/** How many exist, for "8 of 26". */
export const BADGE_TOTAL = BADGES.length;

/**
 * Order for display: earned first within each group, then closest to completion.
 *
 * Sealed badges sink to the bottom of their group — they are a hint that more
 * exists, not a checklist to work through.
 */
export function sortForDisplay(statuses: BadgeStatus[]): BadgeStatus[] {
  return [...statuses].sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    const aHidden = a.def.hidden === true && !a.earned;
    const bHidden = b.def.hidden === true && !b.earned;
    if (aHidden !== bHidden) return aHidden ? 1 : -1;
    return (b.progress ?? 0) - (a.progress ?? 0);
  });
}

export { daysBetween };

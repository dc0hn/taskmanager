import type { AwardLedger, AwardPayout, DailyStat, StreakState, UserProgress } from './types';
import { standingFor } from './progress';
import { todayQualifies } from './streaks';
import { unlockedCount } from './insights';
import { earnedCount } from './badges';

// ============================================================================
// Chains — the two-to-four-week horizon
//
// The gap this fills is a real hole in the shape of the progression layer, not a wish for
// more content. Quests are weekly. Streaks are hundred-day. Between "this week" and "this
// season" there was nothing to be part-way through, which is exactly the horizon at which
// people give up on a system: too far along for a weekly target to feel like progress, not
// far enough for a hundred-day run to feel reachable.
//
// Three decisions:
//
//   ONE STEP VISIBLE AT A TIME. The next step is named but its target is hidden until the
//   one before it is paid. A three-step chain shown all at once is just a longer quest;
//   revealed a step at a time it is a thing you are in the middle of.
//
//   MEASURED AGAINST LIFETIME COUNTERS, not against a week. A chain that read from
//   `WeekContext` could only ever span seven days, which is the horizon it exists to get
//   past. Every step below is a function of progress, the streak record, day stats or the
//   award ledger — all of which already survive a week boundary.
//
//   PROGRESS NEVER GOES BACKWARDS ONCE PAID. Steps are keyed in the same award ledger as
//   everything else, so a step stays cleared even if the counter behind it dips. Undoing a
//   day should not retract a fortnight's work.
// ============================================================================

export interface ChainContext {
  progress: UserProgress;
  streak: StreakState;
  stats: Record<string, DailyStat>;
  /**
   * The award ledger, for steps that count badges or codex cards.
   *
   * Overwritten by `chainStatuses` with the ledger it was passed, so callers cannot supply
   * one here that disagrees with the one deciding which steps are cleared.
   */
  awards: AwardLedger;
  /** Today, for walking day stats backwards. */
  today: string;
}

export interface ChainStep {
  id: string;
  name: string;
  blurb: string;
  total: number;
  xp: number;
  done: (c: ChainContext) => number;
}

export interface ChainDef {
  id: string;
  name: string;
  /** What finishing the whole thing is for. Shown from the start. */
  blurb: string;
  glyph: string;
  steps: ChainStep[];
  /** Paid once, on the last step. The reason to finish rather than to start. */
  mementoXp: number;
  mementoName: string;
}

// ---------------------------------------------------------------------------
// Counters the steps are built from
// ---------------------------------------------------------------------------

/** Days kept, counting back from today. Stops at the first day that was not kept. */
function keptRun(c: ChainContext): number {
  return c.streak.current;
}

/** Whole days cleared, across everything still in the stat window. */
function clearedDays(c: ChainContext): number {
  return Object.values(c.stats).filter((s) => s.cleared).length;
}

/** Days that met the threshold, across the stat window. */
function keptDays(c: ChainContext): number {
  return Object.values(c.stats).filter((s) => todayQualifies(s, false)).length;
}

function focusHours(c: ChainContext): number {
  const minutes = Object.values(c.stats).reduce((sum, s) => sum + s.focusMinutes, 0);
  return Math.floor(minutes / 60);
}

// ---------------------------------------------------------------------------
// The chains
// ---------------------------------------------------------------------------

/**
 * Deliberately few, and deliberately not rotated.
 *
 * These are not drawn from a pool — unlike the wildcards and challenges, a chain is
 * something you are part-way through, and re-rolling one would undo the only thing it is
 * for. Adding a chain is safe at any time; changing an existing one's steps is not, because
 * a step already paid cannot be un-paid.
 */
export const CHAINS: ChainDef[] = [
  {
    id: 'foundations',
    name: 'Foundations',
    blurb: 'Turn up, keep turning up, then finish what you turned up for.',
    glyph: 'first-block',
    mementoXp: 400,
    mementoName: 'The Foundation Stone',
    steps: [
      {
        id: 'kept-3',
        name: 'Three days running',
        blurb: 'Keep the daily threshold three days in a row',
        total: 3,
        xp: 80,
        done: keptRun,
      },
      {
        id: 'kept-10',
        name: 'Ten days kept',
        blurb: 'Meet the threshold on ten days',
        total: 10,
        xp: 200,
        done: keptDays,
      },
      {
        id: 'cleared-5',
        name: 'Five clean sheets',
        blurb: 'Finish every planned minute on five separate days',
        total: 5,
        xp: 320,
        done: clearedDays,
      },
    ],
  },
  {
    id: 'deepening',
    name: 'The Long Work',
    blurb: 'Accumulate focus time until it is no longer remarkable.',
    glyph: 'focus-marathon',
    mementoXp: 600,
    mementoName: 'The Long Rule',
    steps: [
      {
        id: 'focus-10h',
        name: 'Ten hours deep',
        blurb: 'Ten hours of focus work all told',
        total: 10,
        xp: 120,
        done: focusHours,
      },
      {
        id: 'focus-40h',
        name: 'Forty hours deep',
        blurb: 'Forty hours of focus work all told',
        total: 40,
        xp: 280,
        done: focusHours,
      },
      {
        id: 'focus-100h',
        name: 'A hundred hours deep',
        blurb: 'One hundred hours of focus work all told',
        total: 100,
        xp: 500,
        done: focusHours,
      },
    ],
  },
  {
    id: 'reckoning',
    name: 'The Reckoning',
    blurb: 'Earn a standing, learn something from it, and prove it was not luck.',
    glyph: 'level-10',
    mementoXp: 500,
    mementoName: 'The Reckoner’s Seal',
    steps: [
      {
        id: 'level-10',
        name: 'Reach level ten',
        blurb: 'Climb to level ten',
        total: 10,
        xp: 100,
        done: (c) => standingFor(c.progress.totalXp).level,
      },
      {
        id: 'codex-3',
        name: 'Unseal three cards',
        blurb: 'Unseal three cards of the codex',
        total: 3,
        xp: 220,
        done: (c) => unlockedCount(c.awards),
      },
      {
        id: 'badges-12',
        name: 'Twelve marks earned',
        blurb: 'Earn twelve badges',
        total: 12,
        xp: 380,
        done: (c) => earnedCount(c.awards),
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Ledger keys
// ---------------------------------------------------------------------------

export const CHAIN_PREFIX = 'chain:';
export const MEMENTO_PREFIX = 'memento:';

export function chainStepKey(chainId: string, stepId: string): string {
  return `${CHAIN_PREFIX}${chainId}:${stepId}`;
}

export function mementoKey(chainId: string): string {
  return MEMENTO_PREFIX + chainId;
}

export function chainById(id: string): ChainDef | undefined {
  return CHAINS.find((c) => c.id === id);
}

/** Which mementos have been earned, for display. */
export function mementosHeld(ledger: AwardLedger): ChainDef[] {
  return CHAINS.filter((c) => ledger.granted.includes(mementoKey(c.id)));
}

// ---------------------------------------------------------------------------
// Status and payout
// ---------------------------------------------------------------------------

export interface ChainStatus {
  def: ChainDef;
  /** Index of the step currently in play, or steps.length when the chain is finished. */
  stepIndex: number;
  step: ChainStep | null;
  done: number;
  total: number;
  /** 0..1 through the current step. */
  progress: number;
  /** Steps already paid. */
  cleared: number;
  finished: boolean;
  mementoHeld: boolean;
}

export function chainStatuses(ledger: AwardLedger, ctx: ChainContext): ChainStatus[] {
  // The ledger arrives twice — as an argument and inside the context — and two sources for
  // one fact is how they end up disagreeing. The argument wins, so a step that counts award
  // keys is always counting the same ledger the step gates are read from.
  const c: ChainContext = { ...ctx, awards: ledger };
  return CHAINS.map((def) => {
    // The first step not yet in the ledger is the one in play. Counting cleared steps
    // rather than re-evaluating them is what stops a dipped counter reopening a step.
    let cleared = 0;
    while (
      cleared < def.steps.length &&
      ledger.granted.includes(chainStepKey(def.id, def.steps[cleared].id))
    ) {
      cleared++;
    }
    const step = def.steps[cleared] ?? null;
    const done = step ? Math.min(step.total, Math.max(0, step.done(c))) : 0;
    return {
      def,
      stepIndex: cleared,
      step,
      done,
      total: step?.total ?? 0,
      progress: step && step.total > 0 ? done / step.total : 1,
      cleared,
      finished: step == null,
      mementoHeld: ledger.granted.includes(mementoKey(def.id)),
    };
  });
}

/**
 * Steps finished and not yet paid, plus the memento when the last one lands.
 *
 * One step per chain per call, deliberately. A fresh profile importing a long history
 * should not have three chains complete at once in a single silent transaction — each step
 * is paid as it is reached, on the pass that reaches it.
 */
export function chainPayout(ledger: AwardLedger, ctx: ChainContext): AwardPayout[] {
  const out: AwardPayout[] = [];
  for (const status of chainStatuses(ledger, ctx)) {
    if (!status.step) {
      // Every step cleared. Pay the memento once.
      if (!status.mementoHeld) {
        out.push({
          key: mementoKey(status.def.id),
          xp: status.def.mementoXp,
          label: status.def.mementoName,
        });
      }
      continue;
    }
    if (status.done < status.step.total) continue;
    out.push({
      key: chainStepKey(status.def.id, status.step.id),
      xp: status.step.xp,
      label: status.step.name,
    });
  }
  return out;
}

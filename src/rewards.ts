import { useCallback, useEffect, useState } from 'react';
import type { BadgeDef } from './types';
import type { Standing } from './progress';

// ============================================================================
// The reward queue
//
// One ordered queue with one timer, replacing five states and five timeout effects.
//
// The consolidation is not only tidiness — it fixes two real behaviours:
//
//   MOMENTS NO LONGER OVERLAP. A level-up, a badge and a finished quest can all land on
//   one tick. Each used to own its own state and its own timer, so all three appeared at
//   once, stacked on top of each other, and the day's biggest moment was the hardest to
//   read. They now play in sequence.
//
//   MOMENTS NO LONGER GET SKIPPED. Each toast rendered `queue[0]` inside an
//   `AnimatePresence` whose `onExitComplete` dropped the head — while a timer in App
//   dropped the head as well. Two removal paths for one item: the timer advanced the
//   queue, the outgoing card's exit animation completed, and its callback advanced it
//   again. A day that tripped four badges showed roughly two. Here the timer is the only
//   thing that advances, and the components are told what to show rather than asked to
//   manage it.
//
// WHAT IS DELIBERATELY NOT IN HERE. Takeovers are dismissed by the user, not by a clock,
// so putting them on a timer would be wrong. The floating XP figure is tied to the click
// that caused it and must appear instantly even if a badge is mid-flight — queueing it
// would break the causal link that makes it feel earned. Both stay separate.
// ============================================================================

export type RewardMoment =
  | { kind: 'level'; standing: Standing }
  | { kind: 'badge'; def: BadgeDef }
  | { kind: 'quest'; name: string; xp: number }
  | { kind: 'codex'; name: string; glyph: string; xp: number }
  | { kind: 'runKept'; run: number; seed: number };

/**
 * How long each kind holds the screen.
 *
 * Carried over unchanged from the five separate timers, because the values were tuned:
 * a level-up says one word and is frequent, a codex card names something you have never
 * seen before and is rare.
 */
export const REWARD_MS: Record<RewardMoment['kind'], number> = {
  level: 2200,
  badge: 2800,
  quest: 2800,
  codex: 3200,
  runKept: 2600,
};

export interface RewardQueue {
  /** The moment on screen, or null when nothing is playing. */
  current: RewardMoment | null;
  /** How many are still waiting behind it, for the "· N MORE" label. */
  remaining: number;
  push: (...moments: RewardMoment[]) => void;
  /** Drop everything. Used by the reset control, which must leave nothing playing. */
  clear: () => void;
}

export function useRewardQueue(): RewardQueue {
  const [queue, setQueue] = useState<RewardMoment[]>([]);

  const push = useCallback((...moments: RewardMoment[]) => {
    if (moments.length === 0) return;
    setQueue((q) => [...q, ...moments]);
  }, []);

  const clear = useCallback(() => setQueue([]), []);

  const current = queue[0] ?? null;

  useEffect(() => {
    if (!current) return;
    // Keyed on the head object rather than on the array, so pushing more while one is
    // playing does not restart its clock — `slice` preserves the reference of everything
    // it keeps, so appending leaves `queue[0]` identical.
    const id = window.setTimeout(() => setQueue((q) => q.slice(1)), REWARD_MS[current.kind]);
    return () => window.clearTimeout(id);
  }, [current]);

  return { current, remaining: Math.max(0, queue.length - 1), push, clear };
}

/** Narrow the head to one kind, for a component that only renders that kind. */
export function momentOf<K extends RewardMoment['kind']>(
  moment: RewardMoment | null,
  kind: K
): Extract<RewardMoment, { kind: K }> | null {
  return moment && moment.kind === kind
    ? (moment as Extract<RewardMoment, { kind: K }>)
    : null;
}

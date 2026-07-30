import type {
  AwardLedger,
  AwardPayout,
  Block,
  CategoryDef,
  DailyStat,
  DayMarks,
  DisciplineId,
  StreakState,
  UserProgress,
} from '../types';
import { payoutXp } from '../types';
import {
  BRASS_PER_XP,
  isScored,
  levelsCrossed,
  pruneStats,
  reconcileDays,
  resetProgress,
  standingFor,
  withinRetention,
  type DayModifiers,
} from '../progress';
import {
  FREEZE_CAPACITY,
  STREAK_THRESHOLD,
  biggestStreakMilestone,
  deservesTakeover,
  grantAwards,
  resetStreak,
  resolveStreak,
  emptyAwards,
} from '../streaks';
import { emptyShop, freezeCapacity, purchase, type ShopState } from '../shop';
import { mergeDisciplines } from '../bonuses';
import type { RewardMoment } from '../rewards';

// ============================================================================
// The progression reducer
//
// One place where XP, brass, the award ledger, the run, the shop and the day stats
// change. Everything about the scoring layer that was previously a dozen effects reading
// four refs and writing four states is a single pure function of (state, event).
//
// WHAT THIS OWNS AND WHAT IT DOES NOT. It owns state TRANSITIONS. It does not decide what
// is due — `evaluateBadges`, `questPayout`, `unlocksDue`, `chainPayout` and the rest stay
// where they are, already pure and already tested, and hand their results in as payouts.
// Moving those in as well would have made this file the whole progression system rather
// than its sequencer, and there is nothing wrong with where they live.
//
// WHY IT IS PURE. No React, no Date.now(), no localStorage. Every time-dependent input
// arrives on the event. That is the property the rest of this codebase's confidence rests
// on, and it is what lets the sequencing below be tested without a renderer — which
// matters more here than anywhere, because three separate bugs have already been paid for
// in exactly this code:
//
//   THE LEDGER LOST UPDATE. Several effects granted in one commit, each building a whole
//   new ledger from a ref React only refreshes on render, so the last write won and the
//   others' keys vanished while their XP had already been paid. `grantOnce` solved that by
//   advancing a mutable ref mid-flush. Here it cannot happen: granting is one function,
//   applied to one state, in order. The ref disappears structurally rather than being
//   managed.
//
//   THE PAYOUT OVER-PAY. Producers returned a key list beside one summed figure, and the
//   caller paid the sum whenever ANY key was new. Every payment below is summed from what
//   the ledger actually accepted.
//
//   THE BRASS RE-MINT. Clamping the balance at zero forgave a spend, so one block could be
//   minted repeatedly. The balance is allowed to go negative, floored where lifetime
//   earnings would; that lives in `reconcileDay` and is not re-implemented here.
//
// MOMENTS CANNOT OUTRUN PAYMENTS. `AwardsOffered` carries its presentation keyed by award
// key, and the reducer emits only the moments whose key was granted. Celebrating something
// that was not paid for is then not expressible.
// ============================================================================

export interface ProgressionState {
  progress: UserProgress;
  awards: AwardLedger;
  streak: StreakState;
  shop: ShopState;
  dayStats: Record<string, DailyStat>;
}

export type ProgressionEvent =
  /** The loaded window changed, or a block was ticked. The only path that moves day XP. */
  | {
      type: 'DaysReconciled';
      days: { date: string; blocks: Block[] }[];
      categories: CategoryDef[];
      modifiers: Record<string, DayModifiers>;
      today: string;
    }
  /** Walk every settled day up to yesterday. Safe to send on every launch. */
  | { type: 'MidnightPassed'; today: string; marks: DayMarks }
  | { type: 'Purchased'; itemId: string; weekKey: string }
  /**
   * One-off awards, from any producer.
   *
   * `moments` is keyed by award key so presentation is chosen by the caller — which knows
   * about badges and glyphs — while the decision of what to SHOW stays welded to what was
   * paid.
   */
  | {
      type: 'AwardsOffered';
      payouts: AwardPayout[];
      moments?: Record<string, RewardMoment>;
      /** Disciplines to credit, when the producer knows them per key. */
      disciplines?: Partial<Record<DisciplineId, number>>;
      /**
       * Narrate what was paid, as "label · label · +N XP".
       *
       * Built here rather than by the caller for the same reason the streak narration is:
       * the caller does not know which keys the ledger accepted, so a line it wrote itself
       * could name an award that was not paid for. Callers that want context only they
       * have — a routine's name, say — enrich the payout LABELS before offering them.
       */
      note?: boolean;
    }
  /** Brass from somewhere that is not day scoring — a settled commission, say. */
  | { type: 'BrassCredited'; brass: number }
  /**
   * Brass leaving the balance for something that is not a shop purchase.
   *
   * Moves to `brassSpent` as well, so lifetime earnings stay derivable as
   * `brass + brassSpent` — and a forfeited stake is then simply a spend that bought
   * nothing, which the honest negative balance can already express.
   */
  | { type: 'BrassStaked'; stake: number }
  /** Shop state replaced wholesale: equip, unequip, a spent consumable. */
  | { type: 'ShopChanged'; shop: ShopState }
  /** Freezes returned to the run by a refill. */
  | { type: 'FreezesSet'; freezes: number }
  /** First run. Begin counting from today. */
  | { type: 'Started'; today: string }
  | { type: 'Reset'; today: string };

export interface ProgressionResult {
  state: ProgressionState;
  /** Reward moments to present, in the order they should be shown. */
  moments: RewardMoment[];
  changed: boolean;
  /** Set when something was refused, for the caller to surface. */
  message?: string;
  /**
   * Narration — what happened, in words, for the toast line.
   *
   * Produced here rather than by the caller because the facts behind it (which days froze,
   * which reset) come out of the streak walk, and having the caller re-walk to narrate
   * would mean two implementations of the same question.
   */
  notes?: string[];
}

const UNCHANGED = (state: ProgressionState): ProgressionResult => ({
  state,
  moments: [],
  changed: false,
});

/**
 * Grant award keys once, and pay only for what the ledger accepted.
 *
 * The single choke point every one-off award goes through. Returns the payouts actually
 * granted so the caller sums from those.
 */
function applyAwards(
  state: ProgressionState,
  payouts: AwardPayout[],
  disciplines?: Partial<Record<DisciplineId, number>>
): { state: ProgressionState; paid: AwardPayout[] } {
  const { ledger, granted } = grantAwards(
    state.awards,
    payouts.map((p) => p.key)
  );
  if (granted.length === 0) return { state, paid: [] };

  const fresh = new Set(granted);
  const paid = payouts.filter((p) => fresh.has(p.key));
  const xp = payoutXp(paid);

  // Per-key disciplines where the payout carries one; an explicit map overrides, for the
  // producers that compute it themselves.
  const credited: Partial<Record<DisciplineId, number>> = { ...(disciplines ?? {}) };
  if (!disciplines) {
    for (const p of paid) {
      if (!p.discipline) continue;
      credited[p.discipline] = (credited[p.discipline] ?? 0) + p.xp;
    }
  }

  return {
    state: {
      ...state,
      awards: ledger,
      progress: {
        ...state.progress,
        totalXp: state.progress.totalXp + xp,
        brass: state.progress.brass + Math.max(xp > 0 ? 1 : 0, Math.round(xp * BRASS_PER_XP)),
        disciplines: mergeDisciplines(state.progress.disciplines ?? {}, credited),
      },
    },
    paid,
  };
}

/**
 * Which crossing to celebrate when one change crossed several.
 *
 * Not simply the last. A day that prestiges may carry on into level 3 of the new cycle, and
 * celebrating level 3 would bury what actually happened — so a prestige crossing wins, then
 * the highest arc capstone, then the last ordinary level.
 */
function celebrationFor(before: number, after: number): RewardMoment | null {
  if (after <= before) return null;
  const crossed = levelsCrossed(before, after);
  if (crossed.length === 0) return null;

  const startPrestige = standingFor(before).prestige;
  const prestige = crossed.find((c) => c.prestige > startPrestige);
  if (prestige) return { kind: 'takeover', standing: prestige, prestige: true };

  const milestone = [...crossed].reverse().find((c) => c.milestone);
  if (milestone) return { kind: 'takeover', standing: milestone, prestige: false };

  return { kind: 'level', standing: crossed[crossed.length - 1] };
}

export function progressionReducer(
  state: ProgressionState,
  event: ProgressionEvent
): ProgressionResult {
  switch (event.type) {
    case 'Started': {
      if (state.progress.startedOn) return UNCHANGED(state);
      return {
        state: { ...state, progress: { ...state.progress, startedOn: event.today } },
        moments: [],
        changed: true,
      };
    }

    case 'DaysReconciled': {
      const { startedOn } = state.progress;
      if (!startedOn) return UNCHANGED(state);

      // Two guards, both load-bearing and both explained at length in progress.ts:
      // `withinRetention` stops a pruned day being counted twice, and `isScored` stops
      // anything before the start date counting at all.
      const eligible = event.days.filter(
        (d) => isScored(d.date, startedOn) && withinRetention(d.date, event.today)
      );
      if (eligible.length === 0) return UNCHANGED(state);

      const before = state.progress.totalXp;
      const result = reconcileDays(
        state.progress,
        state.dayStats,
        eligible,
        event.categories,
        event.modifiers
      );
      if (!result.changed) return UNCHANGED(state);

      const moment = celebrationFor(before, result.progress.totalXp);
      return {
        state: {
          ...state,
          progress: result.progress,
          dayStats: pruneStats(result.stats, event.today),
        },
        moments: moment ? [moment] : [],
        changed: true,
      };
    }

    case 'MidnightPassed': {
      const { startedOn } = state.progress;
      if (!startedOn) return UNCHANGED(state);

      const withCapacity = {
        ...state.streak,
        capacity: freezeCapacity(state.shop, FREEZE_CAPACITY),
      };
      const result = resolveStreak(
        withCapacity,
        state.dayStats,
        event.marks,
        event.today,
        STREAK_THRESHOLD,
        startedOn
      );
      if (!result.changed && result.state.capacity === state.streak.capacity) {
        return UNCHANGED(state);
      }

      let next: ProgressionState = { ...state, streak: result.state };
      const moments: RewardMoment[] = [];
      const notes: string[] = [];

      if (result.payouts.length > 0 || result.brass > 0) {
        const applied = applyAwards(next, result.payouts);
        next = applied.state;
        // Kept-day brass is guarded by `resolvedThrough` rather than by the ledger, since
        // it is paid per day walked rather than per award.
        if (result.brass > 0) {
          next = {
            ...next,
            progress: { ...next.progress, brass: next.progress.brass + result.brass },
          };
        }
        const milestone = biggestStreakMilestone(applied.paid.map((p) => p.key));
        if (milestone != null) {
          moments.push(
            deservesTakeover(milestone)
              ? { kind: 'runTakeover', days: milestone }
              : { kind: 'runKept', run: milestone }
          );
        }
      }

      // Say something only when the safety net actually did something, or when a run
      // ended. Both are framed as what they are: the net worked, or today starts over.
      const froze = result.days.filter((d) => d.outcome === 'frozen');
      if (froze.length === 1) {
        notes.push(`A freeze covered ${froze[0].date} \u2014 your run is intact.`);
      } else if (froze.length > 1) {
        notes.push(
          `${froze.length} freezes were used while you were away. Your run is intact.`
        );
      } else if (result.days.some((d) => d.outcome === 'reset')) {
        notes.push('Your run starts fresh today. The first day you finish is worth extra.');
      }

      return { state: next, moments, changed: true, notes };
    }

    case 'AwardsOffered': {
      if (event.payouts.length === 0) return UNCHANGED(state);
      const { state: next, paid } = applyAwards(state, event.payouts, event.disciplines);
      if (paid.length === 0) return UNCHANGED(state);

      const before = state.progress.totalXp;
      const moments: RewardMoment[] = [];
      for (const p of paid) {
        const moment = event.moments?.[p.key];
        if (moment) moments.push(moment);
      }
      // An award can cross a level too, and that crossing is the news.
      const crossing = celebrationFor(before, next.progress.totalXp);
      if (crossing) moments.push(crossing);

      const notes: string[] = [];
      if (event.note) {
        const labels = paid.map((p) => p.label).filter(Boolean);
        const xp = payoutXp(paid);
        if (labels.length > 0) notes.push(`${labels.join(' \u00b7 ')} \u00b7 +${xp} XP`);
      }

      return { state: next, moments, changed: true, notes };
    }

    case 'Purchased': {
      const result = purchase(state.shop, state.progress, event.weekKey, event.itemId);
      // `purchase` refuses rather than clamping, and reports why. The caller turns the
      // reason into words; the reducer only carries it out.
      if (!result.ok) return { ...UNCHANGED(state), message: result.reason ?? 'rotation' };

      // Spend moves to `brassSpent` as well as off the balance, so lifetime earnings stay
      // derivable as `brass + brassSpent`.
      return {
        state: {
          ...state,
          shop: result.shop,
          progress: {
            ...state.progress,
            brass: state.progress.brass - result.spend,
            brassSpent: state.progress.brassSpent + result.spend,
          },
        },
        moments: [],
        changed: true,
      };
    }

    case 'BrassStaked': {
      if (event.stake <= 0) return UNCHANGED(state);
      return {
        state: {
          ...state,
          progress: {
            ...state.progress,
            brass: state.progress.brass - event.stake,
            brassSpent: state.progress.brassSpent + event.stake,
          },
        },
        moments: [],
        changed: true,
      };
    }

    case 'BrassCredited': {
      if (event.brass === 0) return UNCHANGED(state);
      return {
        state: {
          ...state,
          progress: { ...state.progress, brass: state.progress.brass + event.brass },
        },
        moments: [],
        changed: true,
      };
    }

    case 'ShopChanged': {
      if (event.shop === state.shop) return UNCHANGED(state);
      return { state: { ...state, shop: event.shop }, moments: [], changed: true };
    }

    case 'FreezesSet': {
      const capacity = freezeCapacity(state.shop, FREEZE_CAPACITY);
      const freezes = Math.min(capacity, Math.max(0, event.freezes));
      if (freezes === state.streak.freezes) return UNCHANGED(state);
      return {
        state: { ...state, streak: { ...state.streak, freezes } },
        moments: [],
        changed: true,
      };
    }

    case 'Reset': {
      return {
        state: {
          progress: resetProgress(event.today),
          awards: emptyAwards(),
          streak: resetStreak(event.today),
          shop: emptyShop(),
          dayStats: {},
        },
        moments: [],
        changed: true,
      };
    }
  }
}


// ---------------------------------------------------------------------------
// The store
//
// `useReducer` returns state and nothing else, but the reducer above also produces reward
// moments and refusal notices. Rather than firing those from inside a state updater — which
// is a side effect in a pure position, and precisely the shape StrictMode double-invokes —
// they go into an outbox that the caller drains and acknowledges.
//
// IDENTITY STABILITY IS LOAD-BEARING. When nothing changed, this returns the SAME store
// object. Effects that compute what is due can then depend on the state directly and settle
// after one pass, instead of needing the latest-value refs that used to exist purely to keep
// those effects off the state they write to. That is what makes the refs deletable rather
// than merely relocated.
// ---------------------------------------------------------------------------

export interface ProgressionStore {
  state: ProgressionState;
  /** Moments produced and not yet handed to the reward queue. */
  outbox: RewardMoment[];
  /** A refusal to surface, as its raw reason. The caller turns it into words. */
  notice: string | null;
  /** Narration produced and not yet shown. */
  notes: string[];
}

export type StoreAction = ProgressionEvent | { type: 'Drained' };

export function initStore(state: ProgressionState): ProgressionStore {
  return { state, outbox: [], notice: null, notes: [] };
}

export function progressionStore(
  store: ProgressionStore,
  action: StoreAction
): ProgressionStore {
  if (action.type === 'Drained') {
    if (store.outbox.length === 0 && store.notice == null && store.notes.length === 0) {
      return store;
    }
    return { ...store, outbox: [], notice: null, notes: [] };
  }

  const result = progressionReducer(store.state, action);
  if (
    !result.changed &&
    result.moments.length === 0 &&
    result.message == null &&
    (result.notes?.length ?? 0) === 0
  ) {
    // Same object, so a dependent effect does not re-run and nothing loops.
    return store;
  }
  return {
    state: result.state,
    outbox: [...store.outbox, ...result.moments],
    notice: result.message ?? store.notice,
    notes: [...store.notes, ...(result.notes ?? [])],
  };
}

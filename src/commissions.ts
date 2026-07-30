import type { Block, DayPlan } from './types';
import { addDays } from './utils/time';

// ============================================================================
// Commissions — brass staked against a block you have not done yet
//
// The shop was the only place brass went, and everything in it is self-directed: you
// decide, you buy, nothing is at risk. A commission is the opposite shape. You stake brass
// against a specific block on a specific future day; finish it and the stake comes back
// doubled, miss it and it is gone.
//
// That makes the currency a commitment device rather than a decoration, which is what a
// planner should be selling. It is also the only item in the app that changes behaviour
// instead of appearance.
//
// Four rules, each there to stop this becoming something worse:
//
//   ONLY THE FUTURE. A commission must be placed on a day after today. Staking against work
//   already done is not a commitment, it is a withdrawal.
//
//   ONE PER BLOCK. Doubling down on the same block would turn a commitment device into a
//   martingale, and the point is to make a promise, not a bet.
//
//   SETTLED BY THE RECORD, NEVER BY A TIMER. A commission resolves when the day it names is
//   in the past, by reading whether that block is completed. So a machine left shut for a
//   week settles correctly on the next launch, exactly like the streak walk.
//
//   THE STAKE IS SPENT AT PLACEMENT. Brass leaves the balance the moment you commit, which
//   is what makes it feel like a stake. Winning pays twice it back; losing pays nothing. The
//   balance is allowed to be honest about a forfeit because the negative-balance work is
//   already in place.
// ============================================================================

export type CommissionOutcome = 'open' | 'kept' | 'forfeited';

export interface Commission {
  id: string;
  /** The day the block lives on. */
  date: string;
  /** The block being promised. */
  blockId: string;
  /** Copied at placement so the record still reads if the block is later renamed. */
  title: string;
  stake: number;
  /** Date the commission was placed, for the record. */
  placedOn: string;
  outcome: CommissionOutcome;
  /** Date it was settled, empty while open. */
  settledOn: string;
}

/** Stakes offered. Deliberately coarse — this is a promise, not a slider. */
export const STAKES = [25, 50, 100, 250] as const;

/** What a kept commission pays back, including the stake. */
export const PAYOUT_MULTIPLIER = 2;

/** How long a settled commission stays on the record before being trimmed. */
export const COMMISSION_RETENTION_DAYS = 120;

export function payoutFor(stake: number): number {
  return stake * PAYOUT_MULTIPLIER;
}

// ---------------------------------------------------------------------------
// Placing
// ---------------------------------------------------------------------------

export type RefuseReason =
  | 'past'
  | 'today'
  | 'exists'
  | 'brass'
  | 'completed'
  | 'auto'
  | 'missing';

export interface PlaceResult {
  ok: boolean;
  commission?: Commission;
  reason?: RefuseReason;
}

export function refusalMessage(reason: RefuseReason, stake = 0, brass = 0): string {
  switch (reason) {
    case 'past':
      return 'That day has already gone. A commission has to be about work you have not done yet.';
    case 'today':
      return 'Commissions start tomorrow. Promising something you are already part-way through is not a promise.';
    case 'exists':
      return 'There is already a commission on that entry.';
    case 'brass':
      return `That stake needs ${(stake - brass).toLocaleString()} more brass.`;
    case 'completed':
      return 'That entry is already finished, so there is nothing left to promise.';
    case 'auto':
      return 'Breaks and the shutdown block are the scheduler’s, not yours to stake against.';
    case 'missing':
      return 'That entry is no longer there.';
  }
}

/**
 * Can a commission be placed, and what would it be?
 *
 * Pure: takes the day's plan rather than reading storage, so the whole rule set is testable
 * and the caller owns the side effects.
 */
export function placeCommission(args: {
  existing: Commission[];
  plan: DayPlan | undefined;
  date: string;
  blockId: string;
  stake: number;
  brass: number;
  today: string;
  id: string;
}): PlaceResult {
  const { existing, plan, date, blockId, stake, brass, today, id } = args;

  if (date < today) return { ok: false, reason: 'past' };
  if (date === today) return { ok: false, reason: 'today' };

  const block: Block | undefined = plan?.blocks.find((b) => b.id === blockId);
  if (!block) return { ok: false, reason: 'missing' };
  if (block.auto) return { ok: false, reason: 'auto' };
  if (block.completed) return { ok: false, reason: 'completed' };

  if (existing.some((c) => c.outcome === 'open' && c.blockId === blockId)) {
    return { ok: false, reason: 'exists' };
  }
  if (brass < stake) return { ok: false, reason: 'brass' };

  return {
    ok: true,
    commission: {
      id,
      date,
      blockId,
      title: block.title,
      stake,
      placedOn: today,
      outcome: 'open',
      settledOn: '',
    },
  };
}

// ---------------------------------------------------------------------------
// Settling
// ---------------------------------------------------------------------------

export interface SettleResult {
  commissions: Commission[];
  /** Brass owed for commissions kept. Forfeits pay nothing; the stake is already gone. */
  brass: number;
  /** Just-settled entries, for saying what happened. */
  settled: Commission[];
  changed: boolean;
}

/**
 * Resolve every commission whose day is now in the past.
 *
 * Lazy and idempotent, the same shape as the streak walk and the week rollover: `outcome`
 * moving off `open` is what stops a commission being settled twice, so this is safe to run
 * on every render pass and correct after the app has been shut for a fortnight.
 *
 * Today is deliberately never settled. The day is still in play, and a commission resolved
 * at breakfast would forfeit work the afternoon was going to do — the same reasoning that
 * keeps today out of the streak walk.
 */
export function settleCommissions(
  commissions: Commission[],
  plans: Record<string, DayPlan | undefined>,
  today: string
): SettleResult {
  let brass = 0;
  const settled: Commission[] = [];
  let changed = false;

  const next = commissions.map((c) => {
    if (c.outcome !== 'open') return c;
    if (c.date >= today) return c;

    const plan = plans[c.date];
    // No record for that day at all means it cannot be judged. Left open rather than
    // forfeited: a missing plan is our uncertainty, not the user's failure.
    if (!plan) return c;

    const block = plan.blocks.find((b) => b.id === c.blockId);
    // The block was deleted. Treated as a forfeit, because deleting the thing you promised
    // is a way of not doing it — and the alternative is an escape hatch that makes every
    // stake meaningless.
    const kept = block?.completed === true;

    const resolved: Commission = {
      ...c,
      outcome: kept ? 'kept' : 'forfeited',
      settledOn: today,
    };
    if (kept) brass += payoutFor(c.stake);
    settled.push(resolved);
    changed = true;
    return resolved;
  });

  return { commissions: next, brass, settled, changed };
}

/** Drop settled commissions older than the retention window. */
export function pruneCommissions(
  commissions: Commission[],
  today: string,
  retentionDays = COMMISSION_RETENTION_DAYS
): Commission[] {
  const cutoffKey = addDays(today, -retentionDays);
  // Open commissions are never pruned however old, because an unsettled promise is still
  // owed — and its stake has already left the balance.
  return commissions.filter((c) => c.outcome === 'open' || c.date >= cutoffKey);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export function openCommissions(commissions: Commission[]): Commission[] {
  return commissions.filter((c) => c.outcome === 'open');
}

export function commissionFor(
  commissions: Commission[],
  blockId: string
): Commission | undefined {
  return commissions.find((c) => c.outcome === 'open' && c.blockId === blockId);
}

/** Brass currently at risk. Shown next to the balance, because it is not spendable. */
export function stakedTotal(commissions: Commission[]): number {
  return openCommissions(commissions).reduce((sum, c) => sum + c.stake, 0);
}

export interface CommissionRecord {
  kept: number;
  forfeited: number;
  /** Net brass across everything settled, stake included. */
  net: number;
}

export function commissionRecord(commissions: Commission[]): CommissionRecord {
  let kept = 0;
  let forfeited = 0;
  let net = 0;
  for (const c of commissions) {
    if (c.outcome === 'kept') {
      kept++;
      net += payoutFor(c.stake) - c.stake;
    } else if (c.outcome === 'forfeited') {
      forfeited++;
      net -= c.stake;
    }
  }
  return { kept, forfeited, net };
}

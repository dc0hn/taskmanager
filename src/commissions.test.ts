import { describe, it, expect } from 'vitest';
import {
  commissionFor,
  commissionRecord,
  openCommissions,
  payoutFor,
  placeCommission,
  pruneCommissions,
  settleCommissions,
  stakedTotal,
  STAKES,
  type Commission,
} from './commissions';
import type { Block, DayPlan } from './types';

const TODAY = '2026-07-30';
const TOMORROW = '2026-07-31';
const YESTERDAY = '2026-07-29';

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  title: 'Edit the gallery',
  start: 540,
  end: 660,
  category: 'deep',
  ...over,
});

const plan = (date: string, blocks: Block[]): DayPlan => ({ date, tasks: [], blocks });

const open = (over: Partial<Commission> = {}): Commission => ({
  id: 'c1',
  date: TOMORROW,
  blockId: 'b1',
  title: 'Edit the gallery',
  stake: 100,
  placedOn: TODAY,
  outcome: 'open',
  settledOn: '',
  ...over,
});

// ---------------------------------------------------------------------------

describe('placing a commission', () => {
  const base = {
    existing: [] as Commission[],
    plan: plan(TOMORROW, [block()]),
    date: TOMORROW,
    blockId: 'b1',
    stake: 100,
    brass: 500,
    today: TODAY,
    id: 'new',
  };

  it('places on a future block you can afford', () => {
    const r = placeCommission(base);
    expect(r.ok).toBe(true);
    expect(r.commission).toMatchObject({ stake: 100, outcome: 'open', blockId: 'b1' });
    // The title is copied, so the record still reads if the block is later renamed.
    expect(r.commission!.title).toBe('Edit the gallery');
  });

  it('refuses a day that has already gone', () => {
    const r = placeCommission({ ...base, date: YESTERDAY, plan: plan(YESTERDAY, [block()]) });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('past');
  });

  it('refuses today', () => {
    // Promising something you are already part-way through is not a promise.
    const r = placeCommission({ ...base, date: TODAY, plan: plan(TODAY, [block()]) });
    expect(r.reason).toBe('today');
  });

  it('refuses a second commission on the same block', () => {
    // Doubling down would make this a martingale rather than a commitment.
    const r = placeCommission({ ...base, existing: [open()] });
    expect(r.reason).toBe('exists');
  });

  it('allows a new commission once an old one on that block is settled', () => {
    const r = placeCommission({
      ...base,
      existing: [open({ outcome: 'forfeited', settledOn: TODAY })],
    });
    expect(r.ok).toBe(true);
  });

  it('refuses when the brass is not there', () => {
    const r = placeCommission({ ...base, brass: 99 });
    expect(r.reason).toBe('brass');
  });

  it('refuses the scheduler’s own blocks', () => {
    const r = placeCommission({
      ...base,
      plan: plan(TOMORROW, [block({ auto: true })]),
    });
    expect(r.reason).toBe('auto');
  });

  it('refuses work already finished', () => {
    const r = placeCommission({
      ...base,
      plan: plan(TOMORROW, [block({ completed: true })]),
    });
    expect(r.reason).toBe('completed');
  });

  it('refuses a block that is not there', () => {
    const r = placeCommission({ ...base, plan: plan(TOMORROW, []) });
    expect(r.reason).toBe('missing');
  });

  it('offers only whole, coarse stakes', () => {
    // A promise, not a slider.
    for (const s of STAKES) {
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThan(0);
    }
    expect(payoutFor(100)).toBe(200);
  });
});

describe('settling', () => {
  it('pays double for a block that was completed', () => {
    const r = settleCommissions(
      [open({ date: YESTERDAY })],
      { [YESTERDAY]: plan(YESTERDAY, [block({ completed: true })]) },
      TODAY
    );
    expect(r.changed).toBe(true);
    expect(r.commissions[0].outcome).toBe('kept');
    expect(r.brass).toBe(200);
  });

  it('pays nothing for a block that was not', () => {
    const r = settleCommissions(
      [open({ date: YESTERDAY })],
      { [YESTERDAY]: plan(YESTERDAY, [block()]) },
      TODAY
    );
    expect(r.commissions[0].outcome).toBe('forfeited');
    expect(r.brass).toBe(0);
  });

  it('never settles today', () => {
    // The day is still in play. Forfeiting at breakfast would take a stake for work the
    // afternoon was going to do.
    const r = settleCommissions(
      [open({ date: TODAY })],
      { [TODAY]: plan(TODAY, [block()]) },
      TODAY
    );
    expect(r.changed).toBe(false);
    expect(r.commissions[0].outcome).toBe('open');
  });

  it('never settles the future', () => {
    const r = settleCommissions([open()], {}, TODAY);
    expect(r.changed).toBe(false);
  });

  it('leaves a commission open when the day has no record at all', () => {
    // A missing plan is our uncertainty, not the user's failure.
    const r = settleCommissions([open({ date: YESTERDAY })], {}, TODAY);
    expect(r.changed).toBe(false);
    expect(r.commissions[0].outcome).toBe('open');
  });

  it('forfeits when the promised block was deleted', () => {
    // Deleting the thing you promised is a way of not doing it, and the alternative is an
    // escape hatch that makes every stake meaningless.
    const r = settleCommissions(
      [open({ date: YESTERDAY })],
      { [YESTERDAY]: plan(YESTERDAY, [block({ id: 'other' })]) },
      TODAY
    );
    expect(r.commissions[0].outcome).toBe('forfeited');
  });

  it('is idempotent — settling twice pays once', () => {
    const plans = { [YESTERDAY]: plan(YESTERDAY, [block({ completed: true })]) };
    const first = settleCommissions([open({ date: YESTERDAY })], plans, TODAY);
    const second = settleCommissions(first.commissions, plans, TODAY);
    expect(second.changed).toBe(false);
    expect(second.brass).toBe(0);
  });

  it('settles a fortnight of neglected commissions in one pass', () => {
    const cs = [1, 2, 3].map((i) =>
      open({ id: `c${i}`, date: `2026-07-1${i}`, blockId: `b${i}` })
    );
    const plans: Record<string, DayPlan> = {
      '2026-07-11': plan('2026-07-11', [block({ id: 'b1', completed: true })]),
      '2026-07-12': plan('2026-07-12', [block({ id: 'b2' })]),
      '2026-07-13': plan('2026-07-13', [block({ id: 'b3', completed: true })]),
    };
    const r = settleCommissions(cs, plans, TODAY);
    expect(r.settled).toHaveLength(3);
    expect(r.brass).toBe(400);
    expect(r.commissions.map((c) => c.outcome)).toEqual(['kept', 'forfeited', 'kept']);
  });
});

describe('reading the record', () => {
  it('counts what is at risk, which is not spendable', () => {
    expect(stakedTotal([open({ stake: 50 }), open({ id: 'c2', stake: 100 })])).toBe(150);
    expect(stakedTotal([open({ outcome: 'kept' })])).toBe(0);
  });

  it('finds the open commission on a block, ignoring settled ones', () => {
    const cs = [open({ id: 'old', outcome: 'kept' }), open({ id: 'live' })];
    expect(commissionFor(cs, 'b1')?.id).toBe('live');
    expect(commissionFor(cs, 'nope')).toBeUndefined();
  });

  it('reports the net across everything settled', () => {
    // Kept nets the stake; forfeited loses it.
    const cs = [
      open({ id: 'a', outcome: 'kept', stake: 100 }),
      open({ id: 'b', outcome: 'forfeited', stake: 50 }),
      open({ id: 'c' }),
    ];
    expect(commissionRecord(cs)).toEqual({ kept: 1, forfeited: 1, net: 50 });
    expect(openCommissions(cs)).toHaveLength(1);
  });
});

describe('pruning', () => {
  it('drops settled commissions past the window', () => {
    const old = open({ id: 'old', date: '2025-01-01', outcome: 'kept', settledOn: '2025-01-02' });
    expect(pruneCommissions([old], TODAY)).toEqual([]);
  });

  it('never drops an open one, however old', () => {
    // An unsettled promise is still owed, and its stake has already left the balance.
    const stale = open({ id: 'stale', date: '2025-01-01' });
    expect(pruneCommissions([stale], TODAY)).toHaveLength(1);
  });

  it('keeps recent settled ones', () => {
    const recent = open({ id: 'r', date: YESTERDAY, outcome: 'kept', settledOn: TODAY });
    expect(pruneCommissions([recent], TODAY)).toHaveLength(1);
  });
});

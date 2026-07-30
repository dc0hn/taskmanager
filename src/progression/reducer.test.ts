import { describe, it, expect } from 'vitest';
import {
  initStore,
  progressionReducer,
  progressionStore,
  type ProgressionEvent,
  type ProgressionState,
} from './reducer';
import { emptyProgress, xpToReachLevel, CYCLE_XP, NO_MODIFIERS } from '../progress';
import { emptyAwards, emptyStreak } from '../streaks';
import { emptyShop } from '../shop';
import { DEFAULT_CATEGORIES } from '../types';
import type { Block, DailyStat } from '../types';

// ============================================================================
// The reducer is the whole reason the extraction was worth doing: this file tests the
// sequencing that previously needed a renderer, four refs and a lucky commit order.
//
// Three bugs were paid for in this code before it was a reducer — the ledger lost update,
// the payout over-pay and the brass re-mint. Each has a test here that fails if the shape
// that caused it comes back.
// ============================================================================

const TODAY = '2026-07-30';
const CATS = DEFAULT_CATEGORIES;

function state(over: Partial<ProgressionState> = {}): ProgressionState {
  return {
    progress: { ...emptyProgress(), startedOn: TODAY },
    awards: emptyAwards(),
    streak: emptyStreak(),
    shop: emptyShop(),
    dayStats: {},
    ...over,
  };
}

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  title: 'Work',
  start: 540,
  end: 660,
  category: 'deep',
  completed: true,
  completedAt: 660,
  ...over,
});

const reconcile = (
  days: { date: string; blocks: Block[] }[],
  mods: Record<string, { boost: number }> = {}
): ProgressionEvent => ({
  type: 'DaysReconciled',
  days,
  categories: CATS,
  modifiers: mods,
  today: TODAY,
});

// ---------------------------------------------------------------------------

describe('starting', () => {
  it('sets the start date once and never again', () => {
    const fresh = state({ progress: emptyProgress() });
    const first = progressionReducer(fresh, { type: 'Started', today: TODAY });
    expect(first.changed).toBe(true);
    expect(first.state.progress.startedOn).toBe(TODAY);

    const second = progressionReducer(first.state, { type: 'Started', today: '2026-08-01' });
    expect(second.changed).toBe(false);
    expect(second.state.progress.startedOn).toBe(TODAY);
  });

  it('scores nothing at all before a start date exists', () => {
    const fresh = state({ progress: emptyProgress() });
    const r = progressionReducer(fresh, reconcile([{ date: TODAY, blocks: [block()] }]));
    expect(r.changed).toBe(false);
    expect(r.state.progress.totalXp).toBe(0);
  });
});

describe('reconciling days', () => {
  it('is idempotent — the same event twice changes nothing the second time', () => {
    // The property the whole scoring layer rests on.
    const event = reconcile([{ date: TODAY, blocks: [block()] }]);
    const first = progressionReducer(state(), event);
    expect(first.changed).toBe(true);
    expect(first.state.progress.totalXp).toBeGreaterThan(0);

    const second = progressionReducer(first.state, event);
    expect(second.changed).toBe(false);
    expect(second.state.progress.totalXp).toBe(first.state.progress.totalXp);
  });

  it('survives ten passes without drifting', () => {
    const event = reconcile([{ date: TODAY, blocks: [block()] }]);
    let s = state();
    for (let i = 0; i < 10; i++) s = progressionReducer(s, event).state;
    const once = progressionReducer(state(), event).state;
    expect(s.progress.totalXp).toBe(once.progress.totalXp);
  });

  it('ignores days before the start date', () => {
    const s = state({ progress: { ...emptyProgress(), startedOn: '2026-07-30' } });
    const r = progressionReducer(s, reconcile([{ date: '2026-07-01', blocks: [block()] }]));
    expect(r.changed).toBe(false);
  });

  it('ignores days outside the retention window', () => {
    // Reconciling a pruned day would read its delta as the whole amount and count it twice.
    const s = state({ progress: { ...emptyProgress(), startedOn: '2020-01-01' } });
    const r = progressionReducer(s, reconcile([{ date: '2021-01-01', blocks: [block()] }]));
    expect(r.changed).toBe(false);
  });

  it('gives XP back when a block is un-ticked, without celebrating', () => {
    const done = progressionReducer(state(), reconcile([{ date: TODAY, blocks: [block()] }]));
    const undone = progressionReducer(
      done.state,
      reconcile([{ date: TODAY, blocks: [block({ completed: false, completedAt: undefined })] }])
    );
    expect(undone.state.progress.totalXp).toBe(0);
    expect(undone.moments).toEqual([]);
  });

  it('applies a day modifier and reports the same total twice', () => {
    const days = [{ date: TODAY, blocks: [block()] }];
    const plain = progressionReducer(state(), reconcile(days));
    const boosted = progressionReducer(state(), reconcile(days, { [TODAY]: { boost: 2 } }));
    expect(boosted.state.progress.totalXp).toBeGreaterThan(plain.state.progress.totalXp);

    // And boosting is idempotent too — the modifier is part of the recomputation, not an
    // increment applied on top of it.
    const again = progressionReducer(
      boosted.state,
      reconcile(days, { [TODAY]: { boost: 2 } })
    );
    expect(again.changed).toBe(false);
  });
});

describe('celebrating', () => {
  it('celebrates the level reached, not every level on the way', () => {
    const big = Array.from({ length: 6 }, (_, i) =>
      block({ id: `b${i}`, start: 480 + i * 90, end: 480 + i * 90 + 80, completedAt: 480 + i * 90 + 80 })
    );
    const r = progressionReducer(state(), reconcile([{ date: TODAY, blocks: big }]));
    expect(r.moments).toHaveLength(1);
  });

  it('celebrates a prestige crossing over the levels that follow it', () => {
    // A day that prestiges may carry on into level 3 of the new cycle. Celebrating level 3
    // would bury what actually happened.
    const s = state({ progress: { ...emptyProgress(), startedOn: TODAY, totalXp: CYCLE_XP - 20 } });
    const r = progressionReducer(s, {
      type: 'AwardsOffered',
      payouts: [{ key: 'big', xp: 400 }],
    });
    const moment = r.moments.find((m) => m.kind === 'takeover');
    expect(moment).toBeDefined();
    expect(moment && 'prestige' in moment && moment.prestige).toBe(true);
  });

  it('says nothing when the total does not move', () => {
    const r = progressionReducer(state(), reconcile([{ date: TODAY, blocks: [] }]));
    expect(r.moments).toEqual([]);
  });
});

describe('one-off awards', () => {
  it('pays a key once', () => {
    const offer: ProgressionEvent = {
      type: 'AwardsOffered',
      payouts: [{ key: 'badge:first-block', xp: 40 }],
    };
    const first = progressionReducer(state(), offer);
    expect(first.state.progress.totalXp).toBe(40);

    const second = progressionReducer(first.state, offer);
    expect(second.changed).toBe(false);
    expect(second.state.progress.totalXp).toBe(40);
  });

  it('pays only for the keys the ledger accepted', () => {
    // The over-pay bug: a producer offering two keys where one is already held used to hand
    // over the sum of both.
    const held = state({ awards: { granted: ['comeback:2026-06-28'] } });
    const r = progressionReducer(held, {
      type: 'AwardsOffered',
      payouts: [
        { key: 'streak:2026-07-01:7', xp: 120 },
        { key: 'comeback:2026-06-28', xp: 30 },
      ],
    });
    expect(r.state.progress.totalXp).toBe(120);
  });

  it('cannot lose a grant when two offers land in a row', () => {
    // The lost-update bug: two producers each built a whole ledger from the same snapshot,
    // so the second overwrote the first while both had been paid. Sequencing through one
    // state makes it unexpressible.
    const a = progressionReducer(state(), {
      type: 'AwardsOffered',
      payouts: [{ key: 'badge:first-block', xp: 40 }],
    });
    const b = progressionReducer(a.state, {
      type: 'AwardsOffered',
      payouts: [{ key: 'quest:two-deep', xp: 60 }],
    });
    expect(b.state.awards.granted).toEqual(['badge:first-block', 'quest:two-deep']);
    expect(b.state.progress.totalXp).toBe(100);

    // And neither can be paid again.
    const again = progressionReducer(b.state, {
      type: 'AwardsOffered',
      payouts: [
        { key: 'badge:first-block', xp: 40 },
        { key: 'quest:two-deep', xp: 60 },
      ],
    });
    expect(again.changed).toBe(false);
  });

  it('shows only the moments whose key was actually paid', () => {
    // Celebrating something that was not paid for should not be expressible.
    const held = state({ awards: { granted: ['old'] } });
    const r = progressionReducer(held, {
      type: 'AwardsOffered',
      payouts: [
        { key: 'old', xp: 10 },
        { key: 'new', xp: 20, label: 'New thing' },
      ],
      moments: {
        old: { kind: 'quest', name: 'Old thing', xp: 10 },
        new: { kind: 'quest', name: 'New thing', xp: 20 },
      },
    });
    const quests = r.moments.filter((m) => m.kind === 'quest');
    expect(quests).toHaveLength(1);
    expect(quests[0]).toMatchObject({ name: 'New thing' });
  });

  it('credits the discipline a payout names', () => {
    const r = progressionReducer(state(), {
      type: 'AwardsOffered',
      payouts: [{ key: 'codex:peak-window', xp: 120, discipline: 'insight' }],
    });
    expect(r.state.progress.disciplines?.insight).toBe(120);
  });

  it('mints brass alongside, never instead', () => {
    const r = progressionReducer(state(), {
      type: 'AwardsOffered',
      payouts: [{ key: 'k', xp: 200 }],
    });
    expect(r.state.progress.totalXp).toBe(200);
    expect(r.state.progress.brass).toBeGreaterThan(0);
  });
});

describe('buying', () => {
  const rich = () =>
    state({ progress: { ...emptyProgress(), startedOn: TODAY, brass: 9999, totalXp: CYCLE_XP - 1 } });

  it('moves the spend to brassSpent so lifetime earnings stay derivable', () => {
    const r = progressionReducer(rich(), {
      type: 'Purchased',
      itemId: 'meter-brass',
      weekKey: '2026-07-27',
    });
    expect(r.changed).toBe(true);
    const before = 9999;
    expect(r.state.progress.brass + r.state.progress.brassSpent).toBe(before);
  });

  it('refuses rather than clamping, and says why', () => {
    const broke = state({ progress: { ...emptyProgress(), startedOn: TODAY, brass: 0 } });
    const r = progressionReducer(broke, {
      type: 'Purchased',
      itemId: 'meter-brass',
      weekKey: '2026-07-27',
    });
    expect(r.changed).toBe(false);
    expect(r.message).toBeTruthy();
    expect(r.state.progress.brass).toBe(0);
  });
});

describe('resetting', () => {
  it('wipes every earned figure and counts from today', () => {
    const lived = state({
      progress: { ...emptyProgress(), startedOn: '2026-01-01', totalXp: 5000, brass: 300 },
      awards: { granted: ['badge:x'] },
      dayStats: { [TODAY]: {} as DailyStat },
    });
    const r = progressionReducer(lived, { type: 'Reset', today: TODAY });
    expect(r.state.progress.totalXp).toBe(0);
    expect(r.state.progress.brass).toBe(0);
    expect(r.state.progress.startedOn).toBe(TODAY);
    expect(r.state.awards.granted).toEqual([]);
    expect(r.state.dayStats).toEqual({});
  });

  it('cannot be undone by reconciling an old day afterwards', () => {
    const r = progressionReducer(state(), { type: 'Reset', today: TODAY });
    const after = progressionReducer(r.state, reconcile([{ date: '2026-01-05', blocks: [block()] }]));
    expect(after.changed).toBe(false);
    expect(after.state.progress.totalXp).toBe(0);
  });
});

describe('brass credited from elsewhere', () => {
  it('adds without touching XP', () => {
    const r = progressionReducer(state(), { type: 'BrassCredited', brass: 200 });
    expect(r.state.progress.brass).toBe(200);
    expect(r.state.progress.totalXp).toBe(0);
  });

  it('ignores a credit of nothing', () => {
    expect(progressionReducer(state(), { type: 'BrassCredited', brass: 0 }).changed).toBe(false);
  });
});

describe('purity', () => {
  it('never mutates the state it was given', () => {
    const before = state();
    const snapshot = JSON.stringify(before);
    progressionReducer(before, reconcile([{ date: TODAY, blocks: [block()] }]));
    progressionReducer(before, { type: 'AwardsOffered', payouts: [{ key: 'k', xp: 10 }] });
    progressionReducer(before, { type: 'Reset', today: TODAY });
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('returns the same state object when nothing changed, so callers can skip a render', () => {
    const s = state();
    const r = progressionReducer(s, { type: 'BrassCredited', brass: 0 });
    expect(r.state).toBe(s);
  });

  it('takes every time-dependent input from the event', () => {
    // No Date.now() anywhere: the same event on the same state gives the same result
    // whenever it is run, which is what makes the rest of this file testable.
    const event = reconcile([{ date: TODAY, blocks: [block()] }]);
    const a = progressionReducer(state(), event);
    const b = progressionReducer(state(), event);
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state));
  });
});

describe('NO_MODIFIERS', () => {
  it('scores a day the same as an absent entry', () => {
    const days = [{ date: TODAY, blocks: [block()] }];
    const absent = progressionReducer(state(), reconcile(days));
    const explicit = progressionReducer(state(), reconcile(days, { [TODAY]: NO_MODIFIERS }));
    expect(explicit.state.progress.totalXp).toBe(absent.state.progress.totalXp);
  });
});

describe('level thresholds are respected exactly', () => {
  it('does not celebrate a level merely approached', () => {
    const s = state({ progress: { ...emptyProgress(), startedOn: TODAY, totalXp: 0 } });
    const r = progressionReducer(s, {
      type: 'AwardsOffered',
      payouts: [{ key: 'k', xp: xpToReachLevel(1) - 1 }],
    });
    expect(r.moments.filter((m) => m.kind === 'level' || m.kind === 'takeover')).toEqual([]);
  });
});

describe('the store', () => {
  it('returns the identical object when nothing changed', () => {
    // Load-bearing: effects depend on the state directly now, so a no-op dispatch has to be
    // referentially identical or they re-run forever.
    const store = initStore(state());
    const after = progressionStore(store, { type: 'BrassCredited', brass: 0 });
    expect(after).toBe(store);
  });

  it('settles after one pass when the same event is dispatched repeatedly', () => {
    const event = reconcile([{ date: TODAY, blocks: [block()] }]);
    let store = initStore(state());
    store = progressionStore(store, event);
    const settled = progressionStore(store, event);
    // Not merely equal — identical, so the dependent effect stops.
    expect(settled).toBe(store);
  });

  it('collects moments into the outbox instead of firing them', () => {
    const store = progressionStore(initStore(state()), {
      type: 'AwardsOffered',
      payouts: [{ key: 'k', xp: 40 }],
      moments: { k: { kind: 'quest', name: 'Thing', xp: 40 } },
    });
    expect(store.outbox).toHaveLength(1);
    expect(store.outbox[0]).toMatchObject({ kind: 'quest', name: 'Thing' });
  });

  it('accumulates across several dispatches before a drain', () => {
    let store = initStore(state());
    store = progressionStore(store, {
      type: 'AwardsOffered',
      payouts: [{ key: 'a', xp: 10 }],
      moments: { a: { kind: 'quest', name: 'A', xp: 10 } },
    });
    store = progressionStore(store, {
      type: 'AwardsOffered',
      payouts: [{ key: 'b', xp: 10 }],
      moments: { b: { kind: 'quest', name: 'B', xp: 10 } },
    });
    expect(store.outbox.map((m) => (m.kind === 'quest' ? m.name : ''))).toEqual(['A', 'B']);
  });

  it('empties on drain, and a second drain is a no-op', () => {
    let store = progressionStore(initStore(state()), {
      type: 'AwardsOffered',
      payouts: [{ key: 'k', xp: 40 }],
      moments: { k: { kind: 'quest', name: 'Thing', xp: 40 } },
    });
    store = progressionStore(store, { type: 'Drained' });
    expect(store.outbox).toEqual([]);
    expect(progressionStore(store, { type: 'Drained' })).toBe(store);
  });

  it('carries a refusal as a notice without changing state', () => {
    const broke = initStore(state({ progress: { ...emptyProgress(), startedOn: TODAY, brass: 0 } }));
    const after = progressionStore(broke, {
      type: 'Purchased',
      itemId: 'meter-brass',
      weekKey: '2026-07-27',
    });
    expect(after.notice).toBeTruthy();
    expect(after.state).toBe(broke.state);
  });
});

describe('staking brass', () => {
  it('moves the stake to brassSpent so lifetime earnings stay derivable', () => {
    const s = state({ progress: { ...emptyProgress(), startedOn: TODAY, brass: 500 } });
    const r = progressionReducer(s, { type: 'BrassStaked', stake: 100 });
    expect(r.state.progress.brass).toBe(400);
    expect(r.state.progress.brassSpent).toBe(100);
    expect(r.state.progress.brass + r.state.progress.brassSpent).toBe(500);
  });

  it('ignores a stake of nothing', () => {
    expect(progressionReducer(state(), { type: 'BrassStaked', stake: 0 }).changed).toBe(false);
  });
});

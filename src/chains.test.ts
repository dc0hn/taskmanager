import { describe, it, expect } from 'vitest';
import {
  CHAINS,
  chainById,
  chainPayout,
  chainStatuses,
  chainStepKey,
  mementoKey,
  mementosHeld,
  type ChainContext,
} from './chains';
import { emptyProgress, xpToReachLevel } from './progress';
import { emptyAwards, emptyStreak } from './streaks';
import { badgeKey } from './badges';
import { unlockKey } from './insights';
import type { AwardLedger, DailyStat } from './types';

const TODAY = '2026-07-30';

function ctx(over: Partial<ChainContext> = {}): ChainContext {
  return {
    progress: emptyProgress(),
    streak: emptyStreak(),
    stats: {},
    awards: emptyAwards(),
    today: TODAY,
    ...over,
  };
}

const stat = (date: string, p: Partial<DailyStat> = {}): DailyStat => ({
  date,
  plannedMinutes: 300,
  doneMinutes: 300,
  xpEarned: 165,
  brassEarned: 17,
  bestCombo: 1,
  cleared: true,
  completedCount: 3,
  focusMinutes: 0,
  ...p,
});

/** N days of stats, all identical. */
const days = (n: number, p: Partial<DailyStat> = {}) => {
  const out: Record<string, DailyStat> = {};
  for (let i = 0; i < n; i++) {
    const date = `2026-06-${String(i + 1).padStart(2, '0')}`;
    out[date] = stat(date, p);
  }
  return out;
};

// ---------------------------------------------------------------------------

describe('the chain definitions', () => {
  it('has unique ids, and unique step ids within each chain', () => {
    expect(new Set(CHAINS.map((c) => c.id)).size).toBe(CHAINS.length);
    for (const c of CHAINS) {
      const ids = c.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('gives every chain three steps, a memento and a glyph', () => {
    for (const c of CHAINS) {
      expect(c.steps).toHaveLength(3);
      expect(c.mementoXp).toBeGreaterThan(0);
      expect(c.mementoName.length).toBeGreaterThan(0);
      expect(c.glyph.length).toBeGreaterThan(0);
    }
  });

  it('makes each step harder than the one before it', () => {
    // A chain whose second step is easier than its first is a list, not a chain.
    for (const c of CHAINS) {
      for (let i = 1; i < c.steps.length; i++) {
        expect(c.steps[i].xp, `${c.id} step ${i}`).toBeGreaterThan(c.steps[i - 1].xp);
      }
    }
  });

  it('pays the memento more than any single step', () => {
    // The reason to finish rather than to start.
    for (const c of CHAINS) {
      const biggest = Math.max(...c.steps.map((s) => s.xp));
      expect(c.mementoXp, c.id).toBeGreaterThanOrEqual(biggest);
    }
  });

  it('looks a chain up by id', () => {
    expect(chainById('foundations')?.name).toBe('Foundations');
    expect(chainById('nope')).toBeUndefined();
  });
});

describe('chain status', () => {
  it('starts every chain on its first step', () => {
    const statuses = chainStatuses(emptyAwards(), ctx());
    for (const s of statuses) {
      expect(s.cleared).toBe(0);
      expect(s.stepIndex).toBe(0);
      expect(s.step).toBe(s.def.steps[0]);
      expect(s.finished).toBe(false);
    }
  });

  it('advances to the next step once one is in the ledger', () => {
    const held: AwardLedger = { granted: [chainStepKey('foundations', 'kept-3')] };
    const s = chainStatuses(held, ctx()).find((x) => x.def.id === 'foundations')!;
    expect(s.cleared).toBe(1);
    expect(s.step?.id).toBe('kept-10');
  });

  it('reports a chain finished when every step is held', () => {
    const held: AwardLedger = {
      granted: CHAINS[0].steps.map((st) => chainStepKey(CHAINS[0].id, st.id)),
    };
    const s = chainStatuses(held, ctx()).find((x) => x.def.id === CHAINS[0].id)!;
    expect(s.finished).toBe(true);
    expect(s.step).toBeNull();
    expect(s.progress).toBe(1);
  });

  it('does not reopen a cleared step when the counter behind it dips', () => {
    // The invariant that makes a fortnight's work safe: undoing a day must not retract a
    // step already paid.
    const held: AwardLedger = { granted: [chainStepKey('foundations', 'kept-3')] };
    // Streak is back to zero, which is below the step's target of three.
    const s = chainStatuses(held, ctx({ streak: { ...emptyStreak(), current: 0 } })).find(
      (x) => x.def.id === 'foundations'
    )!;
    expect(s.cleared).toBe(1);
  });

  it('caps reported progress at the step target', () => {
    const s = chainStatuses(emptyAwards(), ctx({ streak: { ...emptyStreak(), current: 99 } })).find(
      (x) => x.def.id === 'foundations'
    )!;
    expect(s.done).toBe(3);
    expect(s.progress).toBe(1);
  });
});

describe('chain payout', () => {
  it('pays nothing on a fresh profile', () => {
    expect(chainPayout(emptyAwards(), ctx())).toEqual([]);
  });

  it('pays a step the moment its target is met', () => {
    const due = chainPayout(emptyAwards(), ctx({ streak: { ...emptyStreak(), current: 3 } }));
    expect(due.map((d) => d.key)).toContain(chainStepKey('foundations', 'kept-3'));
  });

  it('pays one step per chain per pass, not the whole chain at once', () => {
    // A profile with a long history should walk its chains rather than clearing them in one
    // silent transaction.
    const rich = ctx({
      streak: { ...emptyStreak(), current: 40 },
      stats: days(30, { focusMinutes: 300 }),
      progress: { ...emptyProgress(), totalXp: xpToReachLevel(30) },
    });
    const due = chainPayout(emptyAwards(), rich);
    const perChain = new Map<string, number>();
    for (const d of due) {
      const chain = d.key.split(':')[1];
      perChain.set(chain, (perChain.get(chain) ?? 0) + 1);
    }
    for (const count of perChain.values()) expect(count).toBe(1);
  });

  it('pays the memento only once every step is held', () => {
    const chain = CHAINS[0];
    const almost: AwardLedger = {
      granted: chain.steps.slice(0, 2).map((st) => chainStepKey(chain.id, st.id)),
    };
    expect(chainPayout(almost, ctx()).map((d) => d.key)).not.toContain(mementoKey(chain.id));

    const all: AwardLedger = {
      granted: chain.steps.map((st) => chainStepKey(chain.id, st.id)),
    };
    const due = chainPayout(all, ctx());
    expect(due.map((d) => d.key)).toContain(mementoKey(chain.id));
    expect(due.find((d) => d.key === mementoKey(chain.id))!.xp).toBe(chain.mementoXp);
  });

  it('never pays a memento twice', () => {
    const chain = CHAINS[0];
    const done: AwardLedger = {
      granted: [
        ...chain.steps.map((st) => chainStepKey(chain.id, st.id)),
        mementoKey(chain.id),
      ],
    };
    expect(chainPayout(done, ctx()).map((d) => d.key)).not.toContain(mementoKey(chain.id));
  });

  it('reads the reckoning chain off the ledger and the level', () => {
    const level10 = ctx({ progress: { ...emptyProgress(), totalXp: xpToReachLevel(10) } });
    expect(chainPayout(emptyAwards(), level10).map((d) => d.key)).toContain(
      chainStepKey('reckoning', 'level-10')
    );

    const withCodex: AwardLedger = {
      granted: [
        chainStepKey('reckoning', 'level-10'),
        unlockKey('peak-window'),
        unlockKey('best-weekday'),
        unlockKey('avoidance'),
      ],
    };
    expect(chainPayout(withCodex, level10).map((d) => d.key)).toContain(
      chainStepKey('reckoning', 'codex-3')
    );
  });

  it('reads badges for the last reckoning step', () => {
    const earned = Array.from({ length: 12 }, (_, i) => badgeKey(`b${i}`));
    const held: AwardLedger = {
      granted: [
        chainStepKey('reckoning', 'level-10'),
        chainStepKey('reckoning', 'codex-3'),
        ...earned,
      ],
    };
    // `earnedCount` only counts real badge ids, so synthetic keys prove nothing here —
    // what this asserts is that the step reads the ledger at all and does not throw.
    expect(() => chainPayout(held, ctx())).not.toThrow();
  });
});

describe('mementos', () => {
  it('lists only the ones held', () => {
    expect(mementosHeld(emptyAwards())).toEqual([]);
    const held: AwardLedger = { granted: [mementoKey(CHAINS[1].id)] };
    expect(mementosHeld(held).map((c) => c.id)).toEqual([CHAINS[1].id]);
  });
});

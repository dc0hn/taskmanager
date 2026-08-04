import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadAwards,
  loadDayStats,
  loadPlan,
  loadProgress,
  loadStreak,
  saveAwards,
  saveDayStats,
  savePlan,
  saveProgress,
  saveStreak,
  loadWeek,
  loadShop,
  isPlanReadable,
  corruptPlanDates,
  setWriteFailureHandler,
  pruneDerivedRecords,
  pruneFoldState,
  storeUsage,
} from './storage';
import { emptyAwards, emptyStreak } from './streaks';
import { brassEarned, emptyProgress, reckonDay, wasOnTime } from './progress';
import { DEFAULT_CATEGORIES } from './types';
import type { AwardLedger, Block, DailyStat, StreakState, UserProgress } from './types';

// ============================================================================
// Progression persistence.
//
// Written first rather than last, because this codebase has already been bitten
// once by a normaliser that silently dropped a new field: everything looked
// correct and only a reload revealed the behaviour change. The three fields added
// to Block here are exactly that shape of risk — `completedAt` absent means "not
// punctual", `priority` absent means "normal", `moves` absent means "never moved",
// so losing any of them degrades quietly instead of failing loudly.
// ============================================================================

class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

const DAY = '2026-07-30';

function block(p: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    title: 'Edit gallery',
    start: 540,
    end: 630,
    category: 'deep',
    ...p,
  };
}

describe('block field round trip', () => {
  it('preserves completedAt', () => {
    savePlan({ date: DAY, tasks: [], blocks: [block({ completed: true, completedAt: 612 })] });
    expect(loadPlan(DAY).blocks[0].completedAt).toBe(612);
  });

  it('preserves a past-midnight completedAt above 1440', () => {
    // Ticking a Monday block at 00:30 on Tuesday stores 1470. Clamping it into a
    // single day would hand out the punctuality bonus for work hours late.
    savePlan({ date: DAY, tasks: [], blocks: [block({ completed: true, completedAt: 1470 })] });
    const back = loadPlan(DAY).blocks[0];
    expect(back.completedAt).toBe(1470);
    expect(wasOnTime(back)).toBe(false);
  });

  it('preserves priority', () => {
    savePlan({ date: DAY, tasks: [], blocks: [block({ priority: 'high' })] });
    expect(loadPlan(DAY).blocks[0].priority).toBe('high');
  });

  it('preserves the move count', () => {
    savePlan({ date: DAY, tasks: [], blocks: [block({ moves: 3 })] });
    expect(loadPlan(DAY).blocks[0].moves).toBe(3);
  });

  it('keeps the punctuality bonus across a reload', () => {
    // The regression stated as behaviour rather than as a field.
    const stamped = block({ completed: true, completedAt: 600 });
    savePlan({ date: DAY, tasks: [], blocks: [stamped] });
    const before = reckonDay(DAY, [stamped], DEFAULT_CATEGORIES);
    const after = reckonDay(DAY, loadPlan(DAY).blocks, DEFAULT_CATEGORIES);
    expect(after.stat.xpEarned).toBe(before.stat.xpEarned);
    expect(after.lines[0].notes).toContain('on time ×1.15');
  });

  it('leaves the new fields absent rather than inventing values', () => {
    // Every block completed before this feature existed. Absence must stay absence:
    // a default of 0 for completedAt would declare them all finished at midnight.
    savePlan({ date: DAY, tasks: [], blocks: [block({ completed: true })] });
    const back = loadPlan(DAY).blocks[0];
    expect(back.completedAt).toBeUndefined();
    expect(back.priority).toBeUndefined();
    expect(back.moves).toBeUndefined();
    expect(wasOnTime(back)).toBe(false);
  });

  it('drops nonsense rather than storing it', () => {
    localStorage.setItem(
      'dp:plan:' + DAY,
      JSON.stringify({
        date: DAY,
        tasks: [],
        blocks: [
          {
            id: 'b1', title: 'x', start: 540, end: 600, category: 'deep',
            completedAt: -5, priority: 'urgent', moves: -2,
          },
        ],
      })
    );
    const back = loadPlan(DAY).blocks[0];
    expect(back.completedAt).toBeUndefined();
    expect(back.priority).toBeUndefined();
    expect(back.moves).toBeUndefined();
  });

  it('does not disturb the fields that were already there', () => {
    savePlan({
      date: DAY,
      tasks: [],
      blocks: [block({ completed: true, pinned: true, auto: false, goalId: 'g1', templateId: 't1' })],
    });
    const back = loadPlan(DAY).blocks[0];
    expect(back.completed).toBe(true);
    expect(back.pinned).toBe(true);
    expect(back.goalId).toBe('g1');
    expect(back.templateId).toBe('t1');
  });
});

describe('UserProgress round trip', () => {
  it('preserves every field', () => {
    const p: UserProgress = {
      totalXp: 2240, brass: 214, brassSpent: 676, startedOn: '2026-07-30',
      disciplines: { planning: 120, insight: 50 },
    };
    saveProgress(p);
    expect(loadProgress()).toEqual(p);
  });

  it('banks only the disciplines that cannot be recomputed', () => {
    // Focus and Endurance come from blocks. A stored copy could disagree with the
    // blocks it came from, so it is dropped on read rather than trusted.
    localStorage.setItem(
      'dp:progress:v1',
      JSON.stringify({
        totalXp: 10, brass: 0, brassSpent: 0, startedOn: '',
        disciplines: { planning: 40, insight: 50, focus: 9999, consistency: 9999, bogus: 5 },
      })
    );
    expect(loadProgress().disciplines).toEqual({ planning: 40, insight: 50 });
  });

  it('drops a negative or non-numeric discipline total', () => {
    localStorage.setItem(
      'dp:progress:v1',
      JSON.stringify({
        totalXp: 10, brass: 0, brassSpent: 0, startedOn: '',
        disciplines: { planning: -40, insight: 'lots' },
      })
    );
    expect(loadProgress().disciplines).toEqual({});
  });

  it('migrates a legacy brassEarned into a spend', () => {
    // Earnings used to be stored. Whatever it exceeded the balance by is what had
    // been spent, so the migration is exact rather than a guess.
    localStorage.setItem(
      'dp:progress:v1',
      JSON.stringify({ totalXp: 100, brass: 214, brassEarned: 890, startedOn: '' })
    );
    const back = loadProgress();
    expect(back.brassSpent).toBe(676);
    expect(brassEarned(back)).toBe(890);
  });

  it('starts empty when nothing is stored', () => {
    expect(loadProgress()).toEqual(emptyProgress());
  });

  it('never reports holding more brass than was ever earned', () => {
    // Now true by construction: earned is balance plus spend.
    saveProgress({ totalXp: 100, brass: 500, brassSpent: 0, startedOn: '' });
    const back = loadProgress();
    expect(brassEarned(back)).toBeGreaterThanOrEqual(back.brass);
  });

  it('clamps negatives rather than trusting them', () => {
    localStorage.setItem(
      'dp:progress:v1',
      JSON.stringify({ totalXp: -900, brass: -5, brassSpent: -5, startedOn: '2026-07-30' })
    );
    const back = loadProgress();
    expect(back.totalXp).toBe(0);
    expect(back.brass).toBe(0);
  });

  it('migrates a legacy backfill marker into the start date', () => {
    // It meant the same thing — the day counting began — so it carries straight across.
    localStorage.setItem(
      'dp:progress:v1',
      JSON.stringify({ totalXp: 10, brass: 0, brassSpent: 0, backfilledOn: '2026-07-01' })
    );
    expect(loadProgress().startedOn).toBe('2026-07-01');
  });

  it('rejects a start date that names no real day', () => {
    // An invalid marker would be treated as "already backfilled" and silently skip
    // scoring the entire archive.
    localStorage.setItem(
      'dp:progress:v1',
      JSON.stringify({ totalXp: 10, brass: 1, brassSpent: 0, startedOn: '2026-02-30' })
    );
    expect(loadProgress().startedOn).toBe('');
  });

  it('survives a garbage record', () => {
    localStorage.setItem('dp:progress:v1', '{{{not json');
    expect(loadProgress()).toEqual(emptyProgress());
    localStorage.setItem('dp:progress:v1', JSON.stringify('a string'));
    expect(loadProgress()).toEqual(emptyProgress());
  });
});

describe('day stats round trip', () => {
  const stat: DailyStat = {
    date: DAY, plannedMinutes: 330, doneMinutes: 240,
    xpEarned: 186, brassEarned: 19, bestCombo: 3, cleared: false, completedCount: 1, focusMinutes: 0,
  };

  it('preserves every field', () => {
    saveDayStats({ [DAY]: stat });
    expect(loadDayStats()).toEqual({ [DAY]: stat });
  });

  it('is empty when nothing is stored', () => {
    expect(loadDayStats()).toEqual({});
  });

  it('drops a key that names no real day', () => {
    saveDayStats({ [DAY]: stat, '2026-02-30': { ...stat, date: '2026-02-30' } });
    expect(Object.keys(loadDayStats())).toEqual([DAY]);
  });

  it('repairs a stat whose numbers are missing or negative', () => {
    localStorage.setItem(
      'dp:daystats:v1',
      JSON.stringify({ [DAY]: { xpEarned: -50, cleared: 'yes' } })
    );
    const back = loadDayStats()[DAY];
    expect(back.xpEarned).toBe(0);
    expect(back.plannedMinutes).toBe(0);
    // Only a real boolean counts as cleared.
    expect(back.cleared).toBe(false);
  });

  it('keeps the date on the record matching its key', () => {
    localStorage.setItem(
      'dp:daystats:v1',
      JSON.stringify({ [DAY]: { ...stat, date: '1999-01-01' } })
    );
    expect(loadDayStats()[DAY].date).toBe(DAY);
  });
});

describe('StreakState round trip', () => {
  const full: StreakState = {
    current: 14,
    longest: 21,
    resolvedThrough: '2026-07-29',
    freezes: 1,
    capacity: 2,
    refilledOn: '2026-07-27',
    frozenDates: ['2026-07-18', '2026-07-25'],
    startedOn: '2026-07-16',
    lastResetOn: '2026-07-15',
    consistencyXp: 350,
    comebackOn: '2026-07-17',
  };

  it('preserves every field', () => {
    saveStreak(full);
    expect(loadStreak()).toEqual(full);
  });

  it('starts empty when nothing is stored', () => {
    expect(loadStreak()).toEqual(emptyStreak());
  });

  it('never reports a best run shorter than the current one', () => {
    saveStreak({ ...full, current: 30, longest: 5 });
    expect(loadStreak().longest).toBe(30);
  });

  it('caps freezes at the capacity', () => {
    // A corrupt record must not grant unlimited protection.
    saveStreak({ ...full, capacity: 1, freezes: 99 });
    expect(loadStreak().freezes).toBe(1);
  });

  it('keeps a capacity of at least one', () => {
    saveStreak({ ...full, capacity: 0 });
    expect(loadStreak().capacity).toBeGreaterThanOrEqual(1);
  });

  it('drops frozen dates that name no real day', () => {
    localStorage.setItem(
      'dp:streak:v1',
      JSON.stringify({ ...full, frozenDates: ['2026-07-18', '2026-02-30', 'nonsense'] })
    );
    expect(loadStreak().frozenDates).toEqual(['2026-07-18']);
  });

  it('bounds the frozen-date history', () => {
    const many = Array.from({ length: 200 }, (_, i) => shiftKey('2026-01-01', i));
    saveStreak({ ...full, frozenDates: many });
    expect(loadStreak().frozenDates.length).toBeLessThanOrEqual(60);
  });

  it('clamps negatives rather than trusting them', () => {
    localStorage.setItem(
      'dp:streak:v1',
      JSON.stringify({ ...full, current: -5, consistencyXp: -100 })
    );
    const back = loadStreak();
    expect(back.current).toBe(0);
    expect(back.consistencyXp).toBe(0);
  });

  it('survives a garbage record', () => {
    localStorage.setItem('dp:streak:v1', '{{{');
    expect(loadStreak()).toEqual(emptyStreak());
  });
});

describe('AwardLedger round trip', () => {
  it('preserves granted keys', () => {
    const ledger: AwardLedger = { granted: ['comeback:2026-07-25', 'routine:t1:7'] };
    saveAwards(ledger);
    expect(loadAwards()).toEqual(ledger);
  });

  it('starts empty', () => {
    expect(loadAwards()).toEqual(emptyAwards());
  });

  it('deduplicates on read, since the record is append-only', () => {
    localStorage.setItem('dp:awards:v1', JSON.stringify({ granted: ['a', 'a', 'b', 'a'] }));
    expect(loadAwards().granted).toEqual(['a', 'b']);
  });

  it('drops entries that are not usable keys', () => {
    localStorage.setItem(
      'dp:awards:v1',
      JSON.stringify({ granted: ['ok', '', 42, null, 'x'.repeat(500)] })
    );
    expect(loadAwards().granted).toEqual(['ok']);
  });

  it('survives a garbage record', () => {
    localStorage.setItem('dp:awards:v1', JSON.stringify({ granted: 'not an array' }));
    expect(loadAwards()).toEqual(emptyAwards());
  });
});

/** Local date shift, so this file needs nothing from the streak module. */
function shiftKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${out.getUTCFullYear()}-${mm}-${dd}`;
}

describe('blocks are bounded to the day on read', () => {
  it('drops a block that runs past midnight', () => {
    // The reflow ceiling stops one being created; this stops an imported or hand-edited
    // profile reintroducing it, which would put the grid back into drawing two
    // afternoons.
    savePlan({
      date: DAY,
      tasks: [],
      blocks: [
        { id: 'ok', title: 'Fine', start: 540, end: 600, category: 'deep' },
        { id: 'over', title: 'Past midnight', start: 1400, end: 1500, category: 'deep' },
      ],
    });
    const back = loadPlan(DAY);
    expect(back.blocks.map((b) => b.id)).toEqual(['ok']);
  });

  it('keeps a block ending exactly at midnight', () => {
    savePlan({
      date: DAY,
      tasks: [],
      blocks: [{ id: 'last', title: 'Last', start: 1380, end: 1440, category: 'deep' }],
    });
    expect(loadPlan(DAY).blocks).toHaveLength(1);
  });

  it('drops a block starting before midnight of its own day', () => {
    savePlan({
      date: DAY,
      tasks: [],
      blocks: [{ id: 'neg', title: 'Negative', start: -60, end: 60, category: 'deep' }],
    });
    expect(loadPlan(DAY).blocks).toEqual([]);
  });
});

describe('goal direction and run round trip', () => {
  const base = {
    id: 'g1',
    label: 'Deep work',
    category: 'deep',
    targetKind: 'minutes' as const,
    target: 300,
    sessionMinutes: 60,
    cadence: 'weekly' as const,
    active: true,
    deferrals: 0,
    originWeek: '2026-07-27',
  };
  const store = (goal: unknown) =>
    localStorage.setItem(
      'dp:week:2026-07-27',
      JSON.stringify({ week: '2026-07-27', goals: [goal], credits: [] })
    );

  it('keeps a ceiling', () => {
    store({ ...base, direction: 'atMost' });
    expect(loadWeek('2026-07-27').goals[0].direction).toBe('atMost');
  });

  it('reads anything else as a floor', () => {
    // Reading an unknown value as a ceiling would invert the goal, which is the one
    // direction this normaliser must never guess in.
    for (const direction of ['atleast', 'AT_MOST', 42, null, undefined, {}]) {
      store({ ...base, direction });
      expect(loadWeek('2026-07-27').goals[0].direction).toBe('atLeast');
    }
  });

  it('keeps a well-formed run', () => {
    store({ ...base, run: { target: 4, current: 2, best: 3 } });
    expect(loadWeek('2026-07-27').goals[0].run).toEqual({ target: 4, current: 2, best: 3 });
  });

  it('drops a run whose target is not a run', () => {
    // A run of one week is not a run, and a record claiming one would pay out immediately
    // for a week that had already happened.
    for (const target of [1, 0, -3, 'four', null]) {
      store({ ...base, run: { target, current: 0, best: 0 } });
      expect(loadWeek('2026-07-27').goals[0].run).toBeUndefined();
    }
  });

  it('drops a run that is not an object at all', () => {
    for (const run of ['yes', 7, [], null]) {
      store({ ...base, run });
      expect(loadWeek('2026-07-27').goals[0].run).toBeUndefined();
    }
  });

  it('repairs a corrupt run rather than trusting it', () => {
    store({ ...base, run: { target: 4, current: 99, best: -5 } });
    const run = loadWeek('2026-07-27').goals[0].run!;
    // Current cannot exceed the target, and best can never be below current — the same
    // invariant the day-streak record holds.
    expect(run.current).toBe(4);
    expect(run.best).toBeGreaterThanOrEqual(run.current);
  });

  it('leaves a goal with neither field usable', () => {
    store(base);
    const g = loadWeek('2026-07-27').goals[0];
    expect(g.direction).toBe('atLeast');
    expect(g.run).toBeUndefined();
    expect(g.label).toBe('Deep work');
  });
});

describe('the sealed week outcome round trip', () => {
  const store = (outcome: unknown) =>
    localStorage.setItem(
      'dp:week:2026-07-27',
      JSON.stringify({
        week: '2026-07-27',
        goals: [],
        credits: [],
        resolved: true,
        outcome,
      })
    );

  const full = { met: 2, slipped: 1, missed: 3, voided: 1, exceeded: 0, total: 7 };

  it('keeps a complete tally', () => {
    store(full);
    expect(loadWeek('2026-07-27').outcome).toEqual(full);
  });

  it('drops a tally missing any bucket rather than under-reporting the misses', () => {
    // The failure being prevented: a partial read that keeps `met` and loses `missed`
    // does not look broken, it looks like a good week. Absent is honest — the caller
    // falls back to counting the record — so anything incomplete is refused whole.
    for (const key of ['met', 'slipped', 'missed', 'voided', 'exceeded', 'total']) {
      const partial: Record<string, number> = { ...full };
      delete partial[key];
      store(partial);
      expect(loadWeek('2026-07-27').outcome, `dropped ${key}`).toBeUndefined();
    }
  });

  it('refuses counts that are not usable numbers', () => {
    for (const missed of ['3', -1, NaN, Infinity, null, {}]) {
      store({ ...full, missed });
      expect(loadWeek('2026-07-27').outcome).toBeUndefined();
    }
  });

  it('leaves a week with no seal unmarked', () => {
    for (const outcome of [undefined, null, 'sealed', 7, []]) {
      store(outcome);
      expect(loadWeek('2026-07-27').outcome).toBeUndefined();
    }
  });

  it('rounds a fractional count rather than storing a fraction of a goal', () => {
    store({ ...full, missed: 3.4 });
    expect(loadWeek('2026-07-27').outcome?.missed).toBe(3);
  });
});

describe('notes round trip', () => {
  const storeBlock = (notes: unknown) =>
    localStorage.setItem(
      `dp:plan:${DAY}`,
      JSON.stringify({
        date: DAY,
        tasks: [],
        blocks: [
          { id: 'b1', title: 'Standup', start: 540, end: 570, category: 'deep', notes },
        ],
      })
    );

  it('keeps a note through a save and a load', () => {
    storeBlock('Zoom: https://zoom.us/j/123\nAsk about the Q3 numbers');
    expect(loadPlan(DAY).blocks[0].notes).toBe(
      'Zoom: https://zoom.us/j/123\nAsk about the Q3 numbers'
    );
  });

  it('reads an empty or blank note as absent, never as an empty string', () => {
    // So `hasNotes` and every truthiness check around the app agree on what "no
    // note" means without each having to trim first.
    for (const blank of ['', '   ', '\n\n', '\t']) {
      storeBlock(blank);
      expect(loadPlan(DAY).blocks[0].notes).toBeUndefined();
    }
  });

  it('ignores a note that is not text', () => {
    for (const bad of [42, true, {}, [], null]) {
      storeBlock(bad);
      expect(loadPlan(DAY).blocks[0].notes).toBeUndefined();
    }
  });

  it('caps a note on READ, not only on write', () => {
    // The cap has to hold on the way in as well, or a hand-edited or imported
    // profile carries a field the app would never willingly create.
    storeBlock('x'.repeat(5000));
    expect(loadPlan(DAY).blocks[0].notes).toHaveLength(2000);
  });

  it('keeps a note on an unscheduled task too, so it survives being scheduled', () => {
    localStorage.setItem(
      `dp:plan:${DAY}`,
      JSON.stringify({
        date: DAY,
        tasks: [
          {
            id: 't1',
            title: 'Client call',
            duration: 60,
            category: 'deep',
            priority: 'normal',
            notes: 'https://meet.google.com/abc-defg-hij',
          },
        ],
        blocks: [],
      })
    );
    expect(loadPlan(DAY).tasks[0].notes).toBe('https://meet.google.com/abc-defg-hij');
  });
});

describe('keepWhole round trip', () => {
  const storeTask = (keepWhole: unknown) =>
    localStorage.setItem(
      `dp:plan:${DAY}`,
      JSON.stringify({
        date: DAY,
        tasks: [
          {
            id: 't1',
            title: 'Workshop',
            duration: 180,
            category: 'deep',
            priority: 'normal',
            keepWhole,
          },
        ],
        blocks: [],
      })
    );

  it('keeps the decision', () => {
    storeTask(true);
    expect(loadPlan(DAY).tasks[0].keepWhole).toBe(true);
  });

  it('reads anything but true as absent, never as false', () => {
    // Absent and false mean the same thing to the scheduler. Writing the false would
    // put a field on every task ever saved to record a decision nobody made.
    for (const v of [false, undefined, 'yes', 1, null, {}]) {
      storeTask(v);
      expect(loadPlan(DAY).tasks[0].keepWhole).toBeUndefined();
    }
  });

  it('survives on a block, which is what a rebuild reads', () => {
    localStorage.setItem(
      `dp:plan:${DAY}`,
      JSON.stringify({
        date: DAY,
        tasks: [],
        blocks: [
          {
            id: 'b1',
            title: 'Workshop',
            start: 540,
            end: 720,
            category: 'deep',
            keepWhole: true,
          },
        ],
      })
    );
    expect(loadPlan(DAY).blocks[0].keepWhole).toBe(true);
  });
});

describe('the active set round trip', () => {
  const storeShop = (record: Record<string, unknown>) =>
    localStorage.setItem('dp:shop:v1', JSON.stringify(record));

  it('keeps a switch that is on', () => {
    storeShop({ owned: ['quest-extra'], active: ['quest-extra'] });
    expect(loadShop('2026-07-30').active).toEqual(['quest-extra']);
  });

  it('drops an active item that is not owned', () => {
    // Read as an allowlist derived from `owned`, so a hand-edited record cannot
    // switch on something that was never bought.
    storeShop({ owned: [], active: ['quest-extra'] });
    expect(loadShop('2026-07-30').active).toEqual([]);
  });

  it('drops an active id that is a cosmetic or a consumable', () => {
    storeShop({ owned: ['finish-bronze'], active: ['finish-bronze'] });
    expect(loadShop('2026-07-30').active).toEqual([]);
    storeShop({ owned: ['boost-day'], active: ['boost-day'] });
    expect(loadShop('2026-07-30').active).toEqual([]);
  });

  it('drops an unknown id rather than carrying it', () => {
    storeShop({ owned: ['quest-extra'], active: ['nonsense', 'quest-extra'] });
    expect(loadShop('2026-07-30').active).toEqual(['quest-extra']);
  });

  it('never lists the same item twice', () => {
    storeShop({ owned: ['quest-extra'], active: ['quest-extra', 'quest-extra'] });
    expect(loadShop('2026-07-30').active).toEqual(['quest-extra']);
  });

  it('reads a profile written before switches existed as everything off', () => {
    // The deliberate consequence: an upgrade bought earlier stops applying until it
    // is switched on. That is the point of the change, not a migration failure — but
    // it has to be the reliable outcome rather than an accident of key order.
    storeShop({ owned: ['quest-extra', 'freeze-slot'], stock: {}, equipped: {} });
    expect(loadShop('2026-07-30').active).toEqual([]);
  });

  it('ignores an active field that is not a list', () => {
    for (const bad of ['quest-extra', 7, {}, null]) {
      storeShop({ owned: ['quest-extra'], active: bad });
      expect(loadShop('2026-07-30').active).toEqual([]);
    }
  });
});

describe('goal tick round trip', () => {
  const store = (credit: unknown) =>
    localStorage.setItem(
      'dp:week:2026-08-03',
      JSON.stringify({ week: '2026-08-03', goals: [], credits: [credit] })
    );

  it('keeps a tick, which carries no minutes', () => {
    // The trap that would have made this work until the first reload: the old guard
    // rejected minutes <= 0 outright.
    store({ goalId: 'walk', blockId: 'c1', date: '2026-08-04', minutes: 0, checked: true });
    expect(loadWeek('2026-08-03').credits).toEqual([
      { goalId: 'walk', blockId: 'c1', date: '2026-08-04', minutes: 0, checked: true },
    ]);
  });

  it('still refuses a block credit with no minutes', () => {
    store({ goalId: 'walk', blockId: 'b1', date: '2026-08-04', minutes: 0 });
    expect(loadWeek('2026-08-03').credits).toEqual([]);
  });

  it('keeps the checkmark flag on the goal', () => {
    localStorage.setItem(
      'dp:week:2026-08-03',
      JSON.stringify({
        week: '2026-08-03',
        credits: [],
        goals: [{
          id: 'walk', label: 'Walk', category: 'break', targetKind: 'sessions',
          target: 14, sessionMinutes: 30, cadence: 'weekly', active: true,
          deferrals: 0, originWeek: '2026-08-03', checkmark: true,
        }],
      })
    );
    expect(loadWeek('2026-08-03').goals[0].checkmark).toBe(true);
  });

  it('reads anything but true as absent, never as false', () => {
    for (const v of [false, 'yes', 1, null]) {
      localStorage.setItem(
        'dp:week:2026-08-03',
        JSON.stringify({
          week: '2026-08-03',
          credits: [],
          goals: [{
            id: 'walk', label: 'Walk', category: 'break', targetKind: 'sessions',
            target: 14, sessionMinutes: 30, cadence: 'weekly', active: true,
            deferrals: 0, originWeek: '2026-08-03', checkmark: v,
          }],
        })
      );
      expect(loadWeek('2026-08-03').goals[0].checkmark).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// A1/A2/A3 — the audit's storage findings
// ---------------------------------------------------------------------------

describe('a plan record that cannot be read', () => {
  const DAY2 = '2026-07-31';

  it('is reported as unreadable rather than as an empty day', () => {
    // The defect this closes: `read` collapsed absent and corrupt into null, so a
    // corrupt plan became an empty day, reconciled to zero, and its XP was DEDUCTED
    // from the lifetime total. Silently, and permanently.
    localStorage.setItem(`dp:plan:${DAY2}`, '{"blocks":[{"id":"a",');
    expect(isPlanReadable(DAY2)).toBe(false);
    expect(corruptPlanDates()).toContain(DAY2);
  });

  it('treats an absent record as readable, because absence is not corruption', () => {
    expect(isPlanReadable('2099-01-01')).toBe(true);
    expect(corruptPlanDates()).not.toContain('2099-01-01');
  });

  it('treats a well-formed record as readable', () => {
    localStorage.setItem(
      `dp:plan:${DAY2}`,
      JSON.stringify({ date: DAY2, tasks: [], blocks: [] })
    );
    expect(isPlanReadable(DAY2)).toBe(true);
  });

  it('still returns an empty plan, so no caller has to handle a new shape', () => {
    localStorage.setItem(`dp:plan:${DAY2}`, 'not json at all');
    expect(loadPlan(DAY2)).toEqual({ date: DAY2, tasks: [], blocks: [] });
  });
});

describe('write failures are reported', () => {
  it('calls the handler rather than only logging', () => {
    // Release builds register no log sink, so console.error went nowhere a user would
    // ever look — a full quota looked exactly like a successful save.
    const seen: string[] = [];
    setWriteFailureHandler((key) => seen.push(key));

    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new DOMException('quota', 'QuotaExceededError');
    };
    try {
      savePlan({ date: '2026-08-04', tasks: [], blocks: [] });
    } finally {
      localStorage.setItem = original;
      setWriteFailureHandler(null);
    }
    expect(seen).toEqual(['dp:plan:2026-08-04']);
  });

  it('survives a handler that throws, rather than becoming the failure it reports', () => {
    setWriteFailureHandler(() => {
      throw new Error('reporter exploded');
    });
    const original = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('nope');
    };
    try {
      expect(() => savePlan({ date: '2026-08-04', tasks: [], blocks: [] })).not.toThrow();
    } finally {
      localStorage.setItem = original;
      setWriteFailureHandler(null);
    }
  });
});

describe('pruning derived records', () => {
  it('drops sealed months past the horizon and keeps recent ones', () => {
    localStorage.setItem('dp:month:2015-01', JSON.stringify({ month: '2015-01' }));
    localStorage.setItem('dp:month:2026-07', JSON.stringify({ month: '2026-07' }));
    const removed = pruneDerivedRecords('2026-08-04');
    expect(removed).toContain('dp:month:2015-01');
    expect(removed).not.toContain('dp:month:2026-07');
    expect(localStorage.getItem('dp:month:2026-07')).not.toBeNull();
  });

  it('NEVER touches a day plan, however old', () => {
    // Plans are the primary record of what you actually did. Nothing prunes them.
    localStorage.setItem('dp:plan:2010-01-01', JSON.stringify({ date: '2010-01-01' }));
    pruneDerivedRecords('2026-08-04');
    expect(localStorage.getItem('dp:plan:2010-01-01')).not.toBeNull();
  });

  it('never touches a week record either', () => {
    localStorage.setItem('dp:week:2010-01-04', JSON.stringify({ week: '2010-01-04' }));
    pruneDerivedRecords('2026-08-04');
    expect(localStorage.getItem('dp:week:2010-01-04')).not.toBeNull();
  });

  it('is idempotent', () => {
    localStorage.setItem('dp:month:2015-01', JSON.stringify({ month: '2015-01' }));
    expect(pruneDerivedRecords('2026-08-04').length).toBeGreaterThan(0);
    expect(pruneDerivedRecords('2026-08-04')).toEqual([]);
  });
});

describe('fold-state sweep', () => {
  it('drops keys for panels that no longer exist', () => {
    localStorage.setItem('dp:fold:gone', '1');
    localStorage.setItem('dp:fold:alive', '1');
    expect(pruneFoldState(['alive'])).toBe(1);
    expect(localStorage.getItem('dp:fold:gone')).toBeNull();
    expect(localStorage.getItem('dp:fold:alive')).not.toBeNull();
  });
});

describe('store usage', () => {
  it('reports a size that grows with what is stored', () => {
    const before = storeUsage();
    localStorage.setItem('dp:plan:2026-09-09', 'x'.repeat(2000));
    const after = storeUsage();
    expect(after.bytes).toBeGreaterThan(before.bytes);
    expect(after.keys).toBeGreaterThan(before.keys);
  });
});

describe('the dismissed list round trip', () => {
  const store = (dismissed: unknown) =>
    localStorage.setItem(
      'dp:week:2026-08-03',
      JSON.stringify({ week: '2026-08-03', goals: [], credits: [], dismissed })
    );

  it('keeps a tombstone, so a deleted goal stays deleted across a reload', () => {
    store(['walk', 'pushups']);
    expect(loadWeek('2026-08-03').dismissed).toEqual(['walk', 'pushups']);
  });

  it('deduplicates on read', () => {
    store(['walk', 'walk']);
    expect(loadWeek('2026-08-03').dismissed).toEqual(['walk']);
  });

  it('is absent rather than empty when there is nothing to remember', () => {
    store([]);
    expect(loadWeek('2026-08-03').dismissed).toBeUndefined();
    store(undefined);
    expect(loadWeek('2026-08-03').dismissed).toBeUndefined();
  });

  it('drops entries that are not usable ids', () => {
    store(['walk', '', 7, null, {}]);
    expect(loadWeek('2026-08-03').dismissed).toEqual(['walk']);
  });

  it('ignores a field that is not a list', () => {
    for (const bad of ['walk', 7, {}]) {
      store(bad);
      expect(loadWeek('2026-08-03').dismissed).toBeUndefined();
    }
  });
});

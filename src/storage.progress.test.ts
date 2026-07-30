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

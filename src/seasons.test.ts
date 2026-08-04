import { describe, it, expect } from 'vitest';
import {
  currentSeason,
  isSeasonKey,
  quarterOf,
  reckonSeason,
  resolveElapsedSeasons,
  seasonKeyOf,
  seasonName,
  seasonProgress,
  seasonRange,
  seasonsBetween,
  type SeasonRecord,
} from './seasons';
import type { DailyStat } from './types';

const stat = (date: string, planned: number, done: number, focus = 0): DailyStat => ({
  date,
  plannedMinutes: planned,
  doneMinutes: done,
  xpEarned: 0,
  brassEarned: 0,
  bestCombo: 0,
  cleared: planned > 0 && done >= planned,
  completedCount: 0,
  focusMinutes: focus,
});

/**
 * The rollover takes inputs WITHOUT `xpAtStart` (it derives that per season), while
 * `reckonSeason` requires it. Two helpers rather than one loose object, so the type checker
 * keeps saying which is which.
 */
const rolloverInputs = (stats: Record<string, DailyStat>, totalXp = 0) => ({
  stats,
  marks: {} as Record<string, string>,
  totalXp,
  threshold: 0.6,
});

const inputs = (stats: Record<string, DailyStat>, totalXp = 0) => ({
  ...rolloverInputs(stats, totalXp),
  xpAtStart: 0,
});

// ---------------------------------------------------------------------------

describe('season keys', () => {
  it('maps a date to its quarter', () => {
    expect(quarterOf('2026-01-01')).toBe(1);
    expect(quarterOf('2026-03-31')).toBe(1);
    expect(quarterOf('2026-04-01')).toBe(2);
    expect(quarterOf('2026-07-30')).toBe(3);
    expect(quarterOf('2026-12-31')).toBe(4);
  });

  it('builds a sortable key', () => {
    expect(seasonKeyOf('2026-07-30')).toBe('2026-Q3');
    // Sortable as plain strings is the whole reason for this shape.
    expect(['2026-Q4', '2026-Q1', '2025-Q4'].sort()).toEqual([
      '2025-Q4',
      '2026-Q1',
      '2026-Q4',
    ]);
  });

  it('validates a key', () => {
    expect(isSeasonKey('2026-Q3')).toBe(true);
    expect(isSeasonKey('2026-Q5')).toBe(false);
    expect(isSeasonKey('2026-03')).toBe(false);
    expect(isSeasonKey(42)).toBe(false);
  });

  it('names a season readably', () => {
    expect(seasonName('2026-Q3')).toBe('The Third Quarter of 2026');
  });
});

describe('season ranges', () => {
  it('covers each quarter inclusively', () => {
    expect(seasonRange('2026-Q1')).toEqual({ from: '2026-01-01', to: '2026-03-31' });
    expect(seasonRange('2026-Q2')).toEqual({ from: '2026-04-01', to: '2026-06-30' });
    expect(seasonRange('2026-Q3')).toEqual({ from: '2026-07-01', to: '2026-09-30' });
    expect(seasonRange('2026-Q4')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
  });

  it('handles a leap year without special-casing it', () => {
    // Derived by stepping back from the next quarter's first day, so February looks after
    // itself.
    expect(seasonRange('2028-Q1').to).toBe('2028-03-31');
    expect(seasonRange('2027-Q1').to).toBe('2027-03-31');
  });

  it('walks seasons in order, across a year boundary', () => {
    expect(seasonsBetween('2025-Q4', '2026-Q2')).toEqual(['2025-Q4', '2026-Q1', '2026-Q2']);
    expect(seasonsBetween('2026-Q2', '2026-Q2')).toEqual(['2026-Q2']);
    expect(seasonsBetween('2026-Q3', '2026-Q1')).toEqual([]);
  });

  it('bounds an absurd range rather than spinning', () => {
    expect(seasonsBetween('1900-Q1', '2600-Q4').length).toBeLessThanOrEqual(400);
  });

  it('reports how far through the season a date is', () => {
    expect(seasonProgress('2026-07-01')).toBe(0);
    expect(seasonProgress('2026-09-30')).toBe(1);
    expect(seasonProgress('2026-08-15')).toBeGreaterThan(0.4);
    expect(seasonProgress('2026-08-15')).toBeLessThan(0.6);
  });
});

describe('reckoning a season', () => {
  it('counts only days inside the range', () => {
    const stats = {
      '2026-06-30': stat('2026-06-30', 300, 300), // Q2
      '2026-07-01': stat('2026-07-01', 300, 300),
      '2026-09-30': stat('2026-09-30', 300, 300),
      '2026-10-01': stat('2026-10-01', 300, 300), // Q4
    };
    const r = reckonSeason('2026-Q3', inputs(stats));
    expect(r.daysKept).toBe(2);
    expect(r.doneMinutes).toBe(600);
  });

  it('counts kept and cleared separately', () => {
    // 60% keeps the day; 100% clears it. A season should report both.
    const stats = {
      '2026-07-01': stat('2026-07-01', 300, 300),
      '2026-07-02': stat('2026-07-02', 300, 200),
      '2026-07-03': stat('2026-07-03', 300, 60),
    };
    const r = reckonSeason('2026-Q3', inputs(stats));
    expect(r.daysKept).toBe(2);
    expect(r.daysCleared).toBe(1);
  });

  it('finds the longest run inside the season', () => {
    const stats: Record<string, DailyStat> = {};
    // Three kept, one missed, four kept.
    [1, 1, 1, 0, 1, 1, 1, 1].forEach((k, i) => {
      const d = `2026-07-${String(i + 1).padStart(2, '0')}`;
      stats[d] = stat(d, 300, k ? 300 : 30);
    });
    expect(reckonSeason('2026-Q3', inputs(stats)).bestRun).toBe(4);
  });

  it('does not let a blank day break a run', () => {
    // Same rule the streak itself uses: nothing planned means nothing failed.
    const stats: Record<string, DailyStat> = {
      '2026-07-01': stat('2026-07-01', 300, 300),
      '2026-07-02': stat('2026-07-02', 0, 0),
      '2026-07-03': stat('2026-07-03', 300, 300),
    };
    expect(reckonSeason('2026-Q3', inputs(stats)).bestRun).toBe(2);
  });

  it('records the standing reached, derived from the XP given', () => {
    const r = reckonSeason('2026-Q3', inputs({}, 500));
    expect(r.xpEnd).toBe(500);
    expect(r.rank.length).toBeGreaterThan(0);
    expect(r.level).toBeGreaterThan(0);
  });

  it('counts marks inside the range only', () => {
    const r = reckonSeason('2026-Q3', {
      stats: {},
      marks: { '2026-07-04': 'travel', '2026-08-01': 'travel', '2026-11-01': 'gig' },
      totalXp: 0,
      threshold: 0.6,
      xpAtStart: 0,
    });
    expect(r.marks).toEqual({ travel: 2 });
  });
});

describe('sealing elapsed seasons', () => {
  const stats = {
    '2026-01-05': stat('2026-01-05', 300, 300),
    '2026-04-05': stat('2026-04-05', 300, 300),
    '2026-07-05': stat('2026-07-05', 300, 300),
  };

  it('seals everything finished and leaves the current one alone', () => {
    const r = resolveElapsedSeasons('2026-07-30', {}, rolloverInputs(stats), '2026-01-01');
    expect(r.sealed.map((s) => s.season)).toEqual(['2026-Q1', '2026-Q2']);
    expect(r.changed).toBe(true);
  });

  it('is idempotent — the presence of a record is the guard', () => {
    const first = resolveElapsedSeasons('2026-07-30', {}, rolloverInputs(stats), '2026-01-01');
    const existing: Record<string, SeasonRecord> = {};
    for (const s of first.sealed) existing[s.season] = s;
    const second = resolveElapsedSeasons('2026-07-30', existing, rolloverInputs(stats), '2026-01-01');
    expect(second.changed).toBe(false);
    expect(second.sealed).toEqual([]);
  });

  it('seals nothing before scoring began', () => {
    const r = resolveElapsedSeasons('2026-07-30', {}, rolloverInputs(stats), '2026-07-01');
    expect(r.sealed).toEqual([]);
  });

  it('does nothing at all without a start date', () => {
    expect(resolveElapsedSeasons('2026-07-30', {}, rolloverInputs(stats), '').changed).toBe(false);
  });

  it('chains each season start off the previous end', () => {
    const r = resolveElapsedSeasons('2026-07-30', {}, rolloverInputs(stats, 5000), '2026-01-01');
    expect(r.sealed[0].xpStart).toBe(0);
    expect(r.sealed[1].xpStart).toBe(r.sealed[0].xpEnd);
  });

  it('catches up after a year away', () => {
    const r = resolveElapsedSeasons('2027-02-01', {}, rolloverInputs(stats), '2026-01-01');
    expect(r.sealed.map((s) => s.season)).toEqual([
      '2026-Q1',
      '2026-Q2',
      '2026-Q3',
      '2026-Q4',
    ]);
  });
});

describe('the season in progress', () => {
  it('is reckoned live and never marked sealed', () => {
    const live = currentSeason('2026-07-30', {}, rolloverInputs({ '2026-07-05': stat('2026-07-05', 300, 300) }));
    expect(live.season).toBe('2026-Q3');
    expect(live.sealedOn).toBe('');
    expect(live.daysKept).toBe(1);
  });
});

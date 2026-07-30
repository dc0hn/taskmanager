import { describe, it, expect } from 'vitest';
import {
  classifyDay,
  COMEBACK_XP,
  CONSISTENCY_XP_PER_DAY,
  daysBetween,
  daysUntilFreeze,
  describeStreak,
  displayRun,
  biggestStreakMilestone,
  deservesTakeover,
  emptyAwards,
  emptyStreak,
  resetStreak,
  KEPT_DAY_BRASS,
  STREAK_MILESTONES,
  FREEZE_REFILL_DAYS,
  grantAwards,
  hasAward,
  minutesToThreshold,
  outcomeStrip,
  resolveStreak,
  ROUTINE_MILESTONES,
  routineAwardsDue,
  shiftDay,
  todayQualifies,
} from './streaks';
import type { AwardLedger, AwardPayout, DailyStat, DayMarks } from './types';
import { payoutXp } from './types';

function stat(date: string, planned: number, done: number): DailyStat {
  return {
    date,
    plannedMinutes: planned,
    doneMinutes: done,
    xpEarned: Math.round(done * 0.55),
    brassEarned: 1,
    bestCombo: 1,
    cleared: planned > 0 && done >= planned, completedCount: 1, focusMinutes: 0,
  };
}

/** A run of days, each described as [planned, done]. */
function history(from: string, days: [number, number][]): Record<string, DailyStat> {
  const out: Record<string, DailyStat> = {};
  days.forEach(([p, d], i) => {
    const date = shiftDay(from, i);
    out[date] = stat(date, p, d);
  });
  return out;
}

// ---------------------------------------------------------------------------

describe('date arithmetic', () => {
  it('shifts forward and back', () => {
    expect(shiftDay('2026-07-30', 1)).toBe('2026-07-31');
    expect(shiftDay('2026-07-30', -1)).toBe('2026-07-29');
  });

  it('crosses months and years', () => {
    expect(shiftDay('2026-07-31', 1)).toBe('2026-08-01');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('handles a leap day', () => {
    expect(shiftDay('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftDay('2027-02-28', 1)).toBe('2027-03-01');
  });

  it('counts whole days regardless of daylight saving', () => {
    // Late March in the UK crosses a DST boundary; local-time subtraction would be
    // an hour short here and floor to the wrong day.
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(daysBetween('2026-07-30', '2026-07-30')).toBe(0);
    expect(daysBetween('2026-07-30', '2026-07-29')).toBe(-1);
  });
});

// ---------------------------------------------------------------------------

describe('classifyDay', () => {
  it('advances when the threshold is met', () => {
    expect(classifyDay(stat('d', 300, 180), false)).toBe('advanced');
    expect(classifyDay(stat('d', 300, 300), false)).toBe('advanced');
  });

  it('advances exactly on the threshold', () => {
    expect(classifyDay(stat('d', 300, 180), false)).toBe('advanced'); // 60%
  });

  it('resets just below the threshold with no freeze', () => {
    expect(classifyDay(stat('d', 300, 179), false, 0.6, 0)).toBe('reset');
  });

  it('freezes just below the threshold when one is available', () => {
    expect(classifyDay(stat('d', 300, 179), false, 0.6, 1)).toBe('frozen');
  });

  it('is neutral when nothing was planned', () => {
    // There was nothing to fail, so there is nothing to forgive either.
    expect(classifyDay(stat('d', 0, 0), false, 0.6, 0)).toBe('neutral');
    expect(classifyDay(undefined, false, 0.6, 0)).toBe('neutral');
  });

  it('holds a marked day that fell short, without spending a freeze', () => {
    expect(classifyDay(stat('d', 300, 30), true, 0.6, 0)).toBe('held');
    expect(classifyDay(undefined, true, 0.6, 0)).toBe('held');
  });

  it('advances a marked day that was finished anyway', () => {
    // Doing the work is always worth more than being excused from it.
    expect(classifyDay(stat('d', 300, 300), true)).toBe('advanced');
  });

  it('never returns a failure state for an unplanned or marked day', () => {
    const cases: [number, number, boolean][] = [
      [0, 0, false],
      [0, 0, true],
      [300, 0, true],
    ];
    for (const [p, d, marked] of cases) {
      expect(classifyDay(stat('d', p, d), marked, 0.6, 0)).not.toBe('reset');
    }
  });
});

describe('minutesToThreshold', () => {
  it('counts what is still needed', () => {
    expect(minutesToThreshold(stat('d', 300, 100))).toBe(80); // needs 180
  });

  it('is zero once the threshold is met', () => {
    expect(minutesToThreshold(stat('d', 300, 180))).toBe(0);
    expect(minutesToThreshold(stat('d', 300, 400))).toBe(0);
  });

  it('is zero, not NaN, for a day with nothing planned', () => {
    expect(minutesToThreshold(undefined)).toBe(0);
    expect(minutesToThreshold(stat('d', 0, 0))).toBe(0);
  });
});

describe('todayQualifies', () => {
  it('counts a marked day as qualifying', () => {
    expect(todayQualifies(undefined, true)).toBe(true);
  });

  it('requires the threshold otherwise', () => {
    expect(todayQualifies(stat('d', 300, 180), false)).toBe(true);
    expect(todayQualifies(stat('d', 300, 179), false)).toBe(false);
  });

  it('does not qualify a day with nothing planned', () => {
    // Neutral keeps the run but does not extend it — a blank day is not an
    // achievement.
    expect(todayQualifies(stat('d', 0, 0), false)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('resolveStreak', () => {
  const NO_MARKS: DayMarks = {};

  it('settles yesterday but leaves today open', () => {
    // Today must stay in play: a morning with nothing done should never break a run
    // the afternoon was about to save.
    const stats = history('2026-07-28', [
      [300, 300],
      [300, 300],
      [300, 0],
    ]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-30');
    expect(r.state.resolvedThrough).toBe('2026-07-29');
    expect(r.days.map((d) => d.date)).toEqual(['2026-07-28', '2026-07-29']);
    expect(r.state.current).toBe(2);
  });

  it('is idempotent — resolving again does nothing', () => {
    const stats = history('2026-07-28', [[300, 300], [300, 300], [300, 0]]);
    const first = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-30');
    const second = resolveStreak(first.state, stats, NO_MARKS, '2026-07-30');
    expect(second.changed).toBe(false);
    expect(second.days).toEqual([]);
    expect(second.state.current).toBe(first.state.current);
    expect(second.state.consistencyXp).toBe(first.state.consistencyXp);
  });

  it('survives ten resolutions without drifting', () => {
    const stats = history('2026-07-20', Array.from({ length: 9 }, () => [300, 300] as [number, number]));
    let s = emptyStreak();
    for (let i = 0; i < 10; i++) s = resolveStreak(s, stats, NO_MARKS, '2026-07-29').state;
    expect(s.current).toBe(9);
    expect(s.consistencyXp).toBe(9 * CONSISTENCY_XP_PER_DAY);
  });

  it('walks a long closure day by day', () => {
    const stats = history('2026-07-01', Array.from({ length: 20 }, () => [300, 300] as [number, number]));
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-21');
    expect(r.days).toHaveLength(20);
    expect(r.state.current).toBe(20);
  });

  it('spends a freeze on a short day rather than breaking the run', () => {
    const stats = history('2026-07-27', [
      [300, 300],
      [300, 60], // well short
      [300, 300],
    ]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-30');
    expect(r.days.map((d) => d.outcome)).toEqual(['advanced', 'frozen', 'advanced']);
    expect(r.state.current).toBe(2);
    expect(r.state.freezes).toBe(0);
    expect(r.state.frozenDates).toEqual(['2026-07-28']);
  });

  it('resets once the freeze is gone', () => {
    const stats = history('2026-07-25', [
      [300, 300],
      [300, 0], // freeze
      [300, 0], // nothing left
      [300, 300],
      [300, 300],
    ]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-30');
    expect(r.days.map((d) => d.outcome)).toEqual([
      'advanced', 'frozen', 'reset', 'advanced', 'advanced',
    ]);
    expect(r.state.current).toBe(2);
    expect(r.state.lastResetOn).toBe('');  // cleared by the comeback
  });

  it('pays a comeback bonus once, on the first kept day after a reset', () => {
    const stats = history('2026-07-25', [
      [300, 0], // reset (no freeze in this state)
      [300, 300], // comeback
      [300, 300],
    ]);
    const start = { ...emptyStreak(), freezes: 0 };
    const r = resolveStreak(start, stats, NO_MARKS, '2026-07-28');
    expect(r.payouts.map((x) => x.key)).toEqual(['comeback:2026-07-25']);
    expect(payoutXp(r.payouts)).toBe(COMEBACK_XP);
    // And not again on the day after.
    expect(r.payouts).toHaveLength(1);
  });

  it('does not pay a comeback for a run that never lapsed', () => {
    const stats = history('2026-07-27', [[300, 300], [300, 300], [300, 300]]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-30');
    expect(r.payouts).toEqual([]);
    expect(payoutXp(r.payouts)).toBe(0);
  });

  it('holds the run across a marked travel day without spending a freeze', () => {
    const stats = history('2026-07-27', [
      [300, 300],
      [0, 0],
      [300, 300],
    ]);
    const marks: DayMarks = { '2026-07-28': 'travel' };
    const r = resolveStreak(emptyStreak(), stats, marks, '2026-07-30');
    expect(r.days.map((d) => d.outcome)).toEqual(['advanced', 'held', 'advanced']);
    expect(r.state.current).toBe(2);
    expect(r.state.freezes).toBe(1); // untouched
  });

  it('holds a gig day where work was planned and missed', () => {
    // The whole reason marks feed the streak: a tour must not cost the run.
    const stats = history('2026-07-27', [[300, 300], [300, 20], [300, 300]]);
    const marks: DayMarks = { '2026-07-28': 'gig' };
    const r = resolveStreak(emptyStreak(), stats, marks, '2026-07-30');
    expect(r.days[1].outcome).toBe('held');
    expect(r.state.freezes).toBe(1);
  });

  it('passes over days with nothing planned', () => {
    const stats = history('2026-07-27', [[300, 300], [0, 0], [300, 300]]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-30');
    expect(r.days.map((d) => d.outcome)).toEqual(['advanced', 'neutral', 'advanced']);
    expect(r.state.current).toBe(2);
  });

  it('refills a freeze on the seven-day cadence', () => {
    // Day 1 spends the freeze; by day 8 another has arrived.
    const days: [number, number][] = [[300, 0], ...Array.from({ length: 8 }, () => [300, 300] as [number, number])];
    const stats = history('2026-07-01', days);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-10');
    expect(r.state.frozenDates).toEqual(['2026-07-01']);
    expect(r.state.freezes).toBe(1);
  });

  it('does not stockpile freezes beyond capacity', () => {
    const stats = history('2026-06-01', Array.from({ length: 40 }, () => [300, 300] as [number, number]));
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-11');
    expect(r.state.freezes).toBe(1);
  });

  it('tracks the longest run even after a reset', () => {
    const stats = history('2026-07-01', [
      [300, 300], [300, 300], [300, 300], [300, 300],
      [300, 0], // freeze
      [300, 0], // reset
      [300, 300],
    ]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-08');
    expect(r.state.longest).toBe(4);
    expect(r.state.current).toBe(1);
  });

  it('records where the current run started', () => {
    const stats = history('2026-07-25', [
      [300, 0], // reset
      [300, 300],
      [300, 300],
    ]);
    const r = resolveStreak({ ...emptyStreak(), freezes: 0 }, stats, NO_MARKS, '2026-07-28');
    expect(r.state.startedOn).toBe('2026-07-26');
  });

  it('credits Consistency only for days that advanced', () => {
    const stats = history('2026-07-27', [[300, 300], [0, 0], [300, 300]]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-30');
    expect(r.state.consistencyXp).toBe(2 * CONSISTENCY_XP_PER_DAY);
  });

  it('starts from recorded history so a backfilled user is not at zero', () => {
    // Their XP was backfilled from the archive, so the streak has to be too or a
    // level 34 badge sits beside a run of nothing.
    const stats = history('2026-07-20', Array.from({ length: 9 }, () => [300, 300] as [number, number]));
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-29');
    expect(r.state.current).toBe(9);
  });

  it('settles quietly when nothing has ever been recorded', () => {
    const r = resolveStreak(emptyStreak(), {}, NO_MARKS, '2026-07-30');
    expect(r.state.current).toBe(0);
    expect(r.state.resolvedThrough).toBe('2026-07-29');
    expect(r.days).toEqual([]);
  });

  it('bounds an absurd gap instead of walking forever', () => {
    const state = { ...emptyStreak(), resolvedThrough: '1990-01-01' };
    const r = resolveStreak(state, {}, NO_MARKS, '2026-07-30');
    expect(r.days.length).toBeLessThanOrEqual(801);
  });
});

// ---------------------------------------------------------------------------

describe('the award ledger', () => {
  it('grants a key once and never again', () => {
    const first = grantAwards(emptyAwards(), ['comeback:2026-07-25']);
    expect(first.granted).toEqual(['comeback:2026-07-25']);
    const second = grantAwards(first.ledger, ['comeback:2026-07-25']);
    expect(second.granted).toEqual([]);
    expect(second.ledger).toBe(first.ledger);
  });

  it('grants only the new keys from a mixed offer', () => {
    const held = { granted: ['a'] };
    const r = grantAwards(held, ['a', 'b', 'c']);
    expect(r.granted).toEqual(['b', 'c']);
    expect(r.ledger.granted).toEqual(['a', 'b', 'c']);
  });

  it('reports what it holds', () => {
    expect(hasAward({ granted: ['x'] }, 'x')).toBe(true);
    expect(hasAward({ granted: ['x'] }, 'y')).toBe(false);
  });

  /**
   * Why the progression reducer sequences grants through one state rather than letting
   * several callers each build a ledger from the same snapshot.
   *
   * A single completion can finish a quest, unlock a badge and keep the run in one
   * commit, and each of those pays through a separate effect. Every ledger returned
   * here is built from the snapshot it was handed — so two grants from the SAME
   * snapshot each produce a complete ledger that knows nothing of the other, and
   * whichever is stored last silently drops the other's keys. The XP was already
   * paid, so the dropped keys come due again on the next launch and get paid twice.
   *
   * Grants must therefore chain: each one starts from the ledger the last produced. That is
   * now structural — `progressionReducer` applies them in order to one state — rather than
   * something a caller has to remember.
   */
  it('loses keys when two grants share one snapshot', () => {
    const base = emptyAwards();
    const badge = grantAwards(base, ['badge:first-block']);
    const quest = grantAwards(base, ['quest:two-deep']);

    // Both look successful, and both are paid.
    expect(badge.granted).toHaveLength(1);
    expect(quest.granted).toHaveLength(1);

    // But storing either one forgets the other.
    expect(hasAward(quest.ledger, 'badge:first-block')).toBe(false);
    expect(hasAward(badge.ledger, 'quest:two-deep')).toBe(false);

    // And the forgotten key is due — and payable — all over again.
    expect(grantAwards(quest.ledger, ['badge:first-block']).granted).toEqual([
      'badge:first-block',
    ]);
  });

  it('keeps both when the grants are chained', () => {
    const badge = grantAwards(emptyAwards(), ['badge:first-block']);
    const quest = grantAwards(badge.ledger, ['quest:two-deep']);

    expect(quest.ledger.granted).toEqual(['badge:first-block', 'quest:two-deep']);
    expect(grantAwards(quest.ledger, ['badge:first-block']).granted).toEqual([]);
    expect(grantAwards(quest.ledger, ['quest:two-deep']).granted).toEqual([]);
  });

  /**
   * Why awards carry their own XP instead of arriving as a list plus one total.
   *
   * `resolveStreak` is the only producer that never sees the ledger — it walks days and
   * reports what they earned. A single walk can raise several keys at once, and a summed
   * figure is only correct if every one of them turns out to be new. The caller cannot
   * tell, so with a summed figure it paid the lot the moment ANY key was fresh.
   */
  it('lets a caller pay only for the keys the ledger accepted', () => {
    const offered: AwardPayout[] = [
      { key: 'streak:2026-07-01:7', xp: 120 },
      { key: 'comeback:2026-06-28', xp: 30 },
    ];
    // The comeback has already been paid; only the milestone is new.
    const held: AwardLedger = { granted: ['comeback:2026-06-28'] };

    const { granted } = grantAwards(held, offered.map((p) => p.key));
    const paid = offered.filter((p) => granted.includes(p.key));

    expect(paid.map((p) => p.key)).toEqual(['streak:2026-07-01:7']);
    // The correct figure is the milestone alone...
    expect(payoutXp(paid)).toBe(120);
    // ...and NOT the sum of everything that was offered, which is what an all-or-nothing
    // guard on a pre-summed total would have handed over.
    expect(payoutXp(offered)).toBe(150);
  });
});

describe('routineAwardsDue', () => {
  it('pays each milestone as it is passed', () => {
    const r = routineAwardsDue(emptyAwards(), [{ templateId: 't1', current: 7 }]);
    expect(r.map((p) => p.key)).toEqual(['routine:t1:7']);
    expect(payoutXp(r)).toBe(ROUTINE_MILESTONES[0].xp);
  });

  it('pays every milestone already cleared by a long streak', () => {
    const r = routineAwardsDue(emptyAwards(), [{ templateId: 't1', current: 120 }]);
    expect(r.map((p) => p.key)).toEqual(['routine:t1:7', 'routine:t1:30', 'routine:t1:100']);
    expect(payoutXp(r)).toBe(600);
  });

  it('does not pay one already held', () => {
    const ledger = { granted: ['routine:t1:7'] };
    const r = routineAwardsDue(ledger, [{ templateId: 't1', current: 30 }]);
    expect(r.map((p) => p.key)).toEqual(['routine:t1:30']);
  });

  it('pays nothing below the first milestone', () => {
    expect(routineAwardsDue(emptyAwards(), [{ templateId: 't1', current: 6 }])).toEqual([]);
  });

  it('keeps separate routines separate', () => {
    const r = routineAwardsDue(emptyAwards(), [
      { templateId: 'a', current: 7 },
      { templateId: 'b', current: 7 },
    ]);
    expect(r.map((p) => p.key)).toEqual(['routine:a:7', 'routine:b:7']);
  });
});

// ---------------------------------------------------------------------------

describe('display helpers', () => {
  it('counts today into the run once it qualifies', () => {
    const s = { ...emptyStreak(), current: 14 };
    expect(displayRun(s, stat('d', 300, 180), false)).toBe(15);
    expect(displayRun(s, stat('d', 300, 60), false)).toBe(14);
    expect(displayRun(s, undefined, true)).toBe(15); // marked day
  });

  it('counts down to the next freeze', () => {
    const s = { ...emptyStreak(), freezes: 0, refilledOn: '2026-07-27' };
    expect(daysUntilFreeze(s, '2026-07-30')).toBe(FREEZE_REFILL_DAYS - 3);
    expect(daysUntilFreeze({ ...emptyStreak(), freezes: 1 }, '2026-07-30')).toBe(0);
  });

  it('never describes a reset as a failure', () => {
    const s = { ...emptyStreak(), current: 0, lastResetOn: '2026-07-28' };
    const text = describeStreak(s, 0, stat('d', 300, 0), false);
    expect(text).toMatch(/fresh start/i);
    expect(text).not.toMatch(/lost|broke|failed|missed/i);
  });

  it('says what today still needs', () => {
    const s = { ...emptyStreak(), current: 5 };
    expect(describeStreak(s, 5, stat('d', 300, 100), false)).toBe(
      '80 more minutes today keeps the run.'
    );
  });

  it('explains a marked day', () => {
    expect(describeStreak(emptyStreak(), 5, undefined, true)).toMatch(/without spending a freeze/);
  });

  it('explains a day with nothing planned', () => {
    expect(describeStreak(emptyStreak(), 5, stat('d', 0, 0), false)).toMatch(/nothing to keep up/i);
  });
});

describe('outcomeStrip', () => {
  const dates = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'];

  it('marks today as open and the future as blank', () => {
    const strip = outcomeStrip(dates, {}, {}, '2026-07-30', []);
    expect(strip[3].outcome).toBe('open');
    expect(strip[4].outcome).toBe('neutral');
  });

  it('remembers a frozen day even once the freeze is gone', () => {
    // Reclassifying it later would show a reset on a day the run actually survived.
    const stats = { '2026-07-28': stat('2026-07-28', 300, 0) };
    const strip = outcomeStrip(dates, stats, {}, '2026-07-30', ['2026-07-28']);
    expect(strip[1].outcome).toBe('frozen');
  });

  it('reads marks and stats for settled days', () => {
    const stats = {
      '2026-07-27': stat('2026-07-27', 300, 300),
      '2026-07-29': stat('2026-07-29', 300, 10),
    };
    const strip = outcomeStrip(dates, stats, { '2026-07-28': 'gig' }, '2026-07-30', []);
    expect(strip.slice(0, 3).map((d) => d.outcome)).toEqual(['advanced', 'held', 'reset']);
  });
});

describe('day-streak milestones', () => {
  const NO_MARKS: DayMarks = {};

  it('pays at seven days', () => {
    const stats = history('2026-07-01', Array.from({ length: 7 }, () => [300, 300] as [number, number]));
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-08');
    expect(r.payouts.map((x) => x.key)).toContain('streak:2026-07-01:7');
    expect(payoutXp(r.payouts)).toBe(STREAK_MILESTONES[0].xp);
  });

  it('pays more than the routine equivalent, because it is harder', () => {
    expect(STREAK_MILESTONES[0].xp).toBeGreaterThan(ROUTINE_MILESTONES[0].xp);
    expect(STREAK_MILESTONES[2].xp).toBeGreaterThan(ROUTINE_MILESTONES[1].xp);
  });

  it('keys milestones to the run, so a reset does not bar you from earning again', () => {
    // Keyed on length alone, anyone who ever reset could never earn streak XP again
    // — one bad week becoming a permanent penalty.
    const stats = history('2026-07-01', [
      ...Array.from({ length: 7 }, () => [300, 300] as [number, number]),
      [300, 0], // freeze
      [300, 0], // reset
      ...Array.from({ length: 7 }, () => [300, 300] as [number, number]),
    ]);
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-25');
    const sevens = r.payouts.map((x) => x.key).filter((k) => k.endsWith(':7'));
    expect(sevens).toHaveLength(2);
    expect(new Set(sevens).size).toBe(2); // distinct keys, so both can be paid
  });

  it('pays each milestone once within one run', () => {
    const stats = history('2026-07-01', Array.from({ length: 20 }, () => [300, 300] as [number, number]));
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-21');
    const keys = r.payouts.map((x) => x.key);
    expect(keys.filter((k) => k.endsWith(':7'))).toHaveLength(1);
    expect(keys.filter((k) => k.endsWith(':14'))).toHaveLength(1);
    expect(keys.filter((k) => k.endsWith(':30'))).toHaveLength(0);
  });

  it('mints brass for every kept day', () => {
    const stats = history('2026-07-01', Array.from({ length: 5 }, () => [300, 300] as [number, number]));
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-06');
    expect(r.brass).toBe(5 * KEPT_DAY_BRASS);
  });

  it('mints no brass for held, neutral or frozen days', () => {
    const stats = history('2026-07-01', [[0, 0], [300, 0]]);
    const r = resolveStreak(emptyStreak(), stats, { '2026-07-01': 'gig' }, '2026-07-03');
    expect(r.brass).toBe(0);
  });

  it('is still idempotent with milestones and brass in play', () => {
    const stats = history('2026-07-01', Array.from({ length: 8 }, () => [300, 300] as [number, number]));
    const first = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-09');
    const second = resolveStreak(first.state, stats, NO_MARKS, '2026-07-09');
    expect(second.changed).toBe(false);
    expect(second.brass).toBe(0);
    expect(second.payouts).toEqual([]);
  });
});

describe('which milestones stop the screen', () => {
  it('picks the largest granted', () => {
    expect(biggestStreakMilestone(['streak:2026-07-01:7', 'streak:2026-07-01:30'])).toBe(30);
  });

  it('ignores keys that are not streak milestones', () => {
    expect(biggestStreakMilestone(['comeback:2026-07-01', 'routine:t1:100'])).toBeNull();
  });

  it('is null for nothing granted', () => {
    expect(biggestStreakMilestone([])).toBeNull();
  });

  it('reserves the takeover for thirty and a hundred', () => {
    expect(deservesTakeover(30)).toBe(true);
    expect(deservesTakeover(100)).toBe(true);
    expect(deservesTakeover(7)).toBe(false);
    expect(deservesTakeover(14)).toBe(false);
    expect(deservesTakeover(60)).toBe(false);
    expect(deservesTakeover(null)).toBe(false);
  });
});

describe('resetStreak', () => {
  const NO_MARKS: DayMarks = {};

  it('settles yesterday so the walk starts clean', () => {
    const r = resetStreak('2026-07-30');
    expect(r.current).toBe(0);
    expect(r.longest).toBe(0);
    expect(r.resolvedThrough).toBe('2026-07-29');
    expect(r.consistencyXp).toBe(0);
  });

  it('does not re-earn history after a reset', () => {
    // A full archive of kept days, then a reset. Resolution must not walk back into it.
    const stats = history('2026-07-01', Array.from({ length: 25 }, () => [300, 300] as [number, number]));
    const fresh = resetStreak('2026-07-26');
    const r = resolveStreak(fresh, stats, NO_MARKS, '2026-07-30', 0.6, '2026-07-26');
    // Only the days from the start date onward can count.
    expect(r.state.current).toBeLessThanOrEqual(4);
    expect(r.days.every((d) => d.date >= '2026-07-26')).toBe(true);
  });

  it('ignores stats from before the start date entirely', () => {
    const stats = history('2026-06-01', Array.from({ length: 40 }, () => [300, 300] as [number, number]));
    const r = resolveStreak(emptyStreak(), stats, NO_MARKS, '2026-07-10', 0.6, '2026-07-05');
    expect(r.days.every((d) => d.date >= '2026-07-05')).toBe(true);
  });
});

import { describe, it, expect } from 'vitest';
import {
  BADGES,
  BADGE_TOTAL,
  badgeById,
  badgeContext,
  badgeIdFromKey,
  badgeKey,
  badgeStatuses,
  earnedCount,
  evaluateBadges,
  isBadgeKey,
  isPrior,
  LADDERS,
  laddersOf,
  nextUp,
  priorKey,
  standalone,
  sortForDisplay,
  weekdayRun,
  type BadgeContext,
} from './badges';
import { emptyProgress, CYCLE_XP, xpToReachLevel } from './progress';
import { emptyStreak } from './streaks';
import { DEFAULT_CATEGORIES } from './types';
import type { AwardLedger, Block, DailyStat, DayMarks } from './types';
import type { AwardPayout } from './types';
import { payoutXp } from './types';

/**
 * Test shim over `evaluateBadges`, which now returns payouts rather than three
 * parallel arrays.
 *
 * These tests are about which badges fire, so they read `.ids`. Production code
 * deliberately does not get this convenience: it sums XP from the payouts the ledger
 * actually accepted, which is the entire point of the payout shape.
 */
function evaluated(ledger: AwardLedger, ctx: BadgeContext) {
  const payouts: AwardPayout[] = evaluateBadges(ledger, ctx);
  return {
    payouts,
    keys: payouts.map((x) => x.key),
    ids: payouts.map((x) => badgeIdFromKey(x.key)),
    xp: payoutXp(payouts),
  };
}

const CATS = DEFAULT_CATEGORIES;
const TODAY = '2026-07-30';

function stat(date: string, p: Partial<DailyStat> = {}): DailyStat {
  return {
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
  };
}

let seq = 0;
function block(p: Partial<Block> = {}): Block {
  seq++;
  return {
    id: p.id ?? `b${seq}`,
    title: `Block ${seq}`,
    start: 540,
    end: 600,
    category: 'admin',
    ...p,
  };
}

function ctx(over: Partial<BadgeContext> = {}): BadgeContext {
  return {
    blocksCompleted: 0,
    daysKept: 0,
    level: 1,
    prestige: 0,
    streakCurrent: 0,
    streakLongest: 0,
    bestDayXp: 0,
    weekdayRun: 0,
    comebackToday: false,
    todayScore: 0,
    todayCleared: false,
    todayCompleted: 0,
    todayHighPriority: 0,
    todayFocusMinutes: 0,
    todayBestCombo: 0,
    todayDistinctCategories: 0,
    todayLongestBlock: 0,
    todayEarliest: null,
    todayLatest: null,
    todayClearedAt: null,
    todayMaxMoves: 0,
    ...over,
  };
}

const NONE: AwardLedger = { granted: [] };

// ---------------------------------------------------------------------------

describe('the library', () => {
  it('has no duplicate ids', () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGE_TOTAL);
  });

  it('gives every badge a name, description and XP', () => {
    for (const b of BADGES) {
      expect(b.name.length).toBeGreaterThan(0);
      expect(b.description.length).toBeGreaterThan(0);
      expect(b.xp).toBeGreaterThan(0);
      expect(b.glyph).toBeGreaterThanOrEqual(0);
      expect(b.glyph).toBeLessThan(8);
    }
  });

  it('mixes all three kinds, which is what makes it fun', () => {
    const groups = new Set(BADGES.map((b) => b.group));
    expect(groups).toEqual(new Set(['milestone', 'behaviour', 'effort']));
  });

  it('never hides a milestone — a hidden signpost is a missing one', () => {
    for (const b of BADGES.filter((x) => x.group === 'milestone')) {
      expect(b.hidden).toBeFalsy();
    }
  });

  it('hides the behavioural ones, because the surprise is the point', () => {
    const behaviour = BADGES.filter((b) => b.group === 'behaviour');
    expect(behaviour.length).toBeGreaterThan(4);
    for (const b of behaviour) expect(b.hidden).toBe(true);
  });

  it('gives every counting badge a way to show progress', () => {
    for (const b of BADGES) {
      if (b.target != null) {
        const rule = badgeById(b.id)!;
        expect(rule.progress).toBeDefined();
      }
    }
  });

  it('pays the hard ones more than the novelties', () => {
    expect(badgeById('streak-100')!.xp).toBeGreaterThan(badgeById('early-bird')!.xp);
    expect(badgeById('blocks-250')!.xp).toBeGreaterThan(badgeById('blocks-10')!.xp);
  });

  it('round-trips a key', () => {
    expect(isBadgeKey(badgeKey('flawless'))).toBe(true);
    expect(badgeIdFromKey(badgeKey('flawless'))).toBe('flawless');
    expect(isBadgeKey('comeback:2026-07-01')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('milestone conditions', () => {
  it('fires First Light on the first block', () => {
    expect(evaluated(NONE, ctx({ blocksCompleted: 1 })).ids).toContain('first-block');
    expect(evaluated(NONE, ctx({ blocksCompleted: 0 })).ids).not.toContain('first-block');
  });

  it('fires each count badge at its threshold', () => {
    const at = (n: number) => evaluated(NONE, ctx({ blocksCompleted: n })).ids;
    expect(at(9)).not.toContain('blocks-10');
    expect(at(10)).toContain('blocks-10');
    expect(at(250)).toContain('blocks-250');
  });

  it('fires level badges', () => {
    expect(evaluated(NONE, ctx({ level: 5 })).ids).toContain('level-5');
    expect(evaluated(NONE, ctx({ level: 4 })).ids).not.toContain('level-5');
  });

  it('fires Full Circle on a prestige', () => {
    expect(evaluated(NONE, ctx({ prestige: 1 })).ids).toContain('prestige-1');
  });

  it('reads streak badges from the best run, not the current one', () => {
    // Otherwise a reset would revoke the fact that you once kept thirty days.
    const ids = evaluated(NONE, ctx({ streakCurrent: 0, streakLongest: 30 })).ids;
    expect(ids).toContain('streak-7');
    expect(ids).toContain('streak-30');
  });
});

describe('behavioural conditions', () => {
  it('fires Before the Bell only for a genuinely early finish', () => {
    expect(evaluated(NONE, ctx({ todayEarliest: 8 * 60 })).ids).toContain('early-bird');
    expect(evaluated(NONE, ctx({ todayEarliest: 9 * 60 })).ids).not.toContain('early-bird');
  });

  it('fires Dawn Patrol and Before the Bell together before 7am', () => {
    const ids = evaluated(NONE, ctx({ todayEarliest: 6 * 60 + 30 })).ids;
    expect(ids).toContain('dawn-patrol');
    expect(ids).toContain('early-bird');
  });

  it('fires After Hours from 9pm', () => {
    expect(evaluated(NONE, ctx({ todayLatest: 21 * 60 })).ids).toContain('night-owl');
    expect(evaluated(NONE, ctx({ todayLatest: 20 * 60 + 59 })).ids).not.toContain('night-owl');
  });

  it('fires Clean Sweep only when the day is actually finished', () => {
    // Guarding on `todayClearedAt` rather than on the clock stops a half-done
    // morning claiming a swept day.
    expect(evaluated(NONE, ctx({ todayClearedAt: 11 * 60 })).ids).toContain('clean-sweep');
    expect(evaluated(NONE, ctx({ todayClearedAt: null, todayLatest: 11 * 60 })).ids)
      .not.toContain('clean-sweep');
  });

  it('fires Finally for something moved three times', () => {
    expect(evaluated(NONE, ctx({ todayMaxMoves: 3 })).ids).toContain('finally');
    expect(evaluated(NONE, ctx({ todayMaxMoves: 2 })).ids).not.toContain('finally');
  });

  it('fires Deep Diver on three high-priority blocks', () => {
    expect(evaluated(NONE, ctx({ todayHighPriority: 3 })).ids).toContain('deep-diver');
    expect(evaluated(NONE, ctx({ todayHighPriority: 2 })).ids).not.toContain('deep-diver');
  });

  it('fires Full Spread on three categories', () => {
    expect(evaluated(NONE, ctx({ todayDistinctCategories: 3 })).ids).toContain('full-spread');
  });

  it('fires the comeback badge only on the day it is paid', () => {
    expect(evaluated(NONE, ctx({ comebackToday: true })).ids).toContain('comeback');
    expect(evaluated(NONE, ctx({ comebackToday: false })).ids).not.toContain('comeback');
  });
});

describe('effort conditions', () => {
  it('fires Heavy Lifter above two hours, not at it', () => {
    expect(evaluated(NONE, ctx({ todayLongestBlock: 121 })).ids).toContain('heavy-lifter');
    expect(evaluated(NONE, ctx({ todayLongestBlock: 120 })).ids).not.toContain('heavy-lifter');
  });

  it('fires Focus Marathon at four hours of deep work', () => {
    expect(evaluated(NONE, ctx({ todayFocusMinutes: 240 })).ids).toContain('focus-marathon');
    expect(evaluated(NONE, ctx({ todayFocusMinutes: 239 })).ids).not.toContain('focus-marathon');
  });

  it('fires Big Day at 500 XP', () => {
    expect(evaluated(NONE, ctx({ bestDayXp: 500 })).ids).toContain('big-day');
  });
});

// ---------------------------------------------------------------------------

describe('evaluateBadges', () => {
  it('never re-awards one already held', () => {
    const held: AwardLedger = { granted: [badgeKey('first-block')] };
    const r = evaluated(held, ctx({ blocksCompleted: 5 }));
    expect(r.ids).not.toContain('first-block');
  });

  it('sums the XP of everything it grants', () => {
    const r = evaluated(NONE, ctx({ blocksCompleted: 10 }));
    const expected = r.ids.reduce((s, id) => s + badgeById(id)!.xp, 0);
    expect(r.xp).toBe(expected);
  });

  it('awards nothing for an empty day', () => {
    expect(evaluated(NONE, ctx()).ids).toEqual([]);
    expect(evaluated(NONE, ctx()).xp).toBe(0);
  });

  it('can award several at once', () => {
    const r = evaluated(NONE, ctx({ blocksCompleted: 250, level: 25 }));
    expect(r.ids.length).toBeGreaterThan(3);
  });
});

// ---------------------------------------------------------------------------

describe('badgeContext', () => {
  const base = {
    progress: emptyProgress(),
    streak: emptyStreak(),
    marks: {} as DayMarks,
    categories: CATS,
    today: TODAY,
    epoch: '',
    comebackToday: false,
  };

  it('counts nothing before the epoch, so the archive cannot pre-unlock badges', () => {
    // The whole reason the epoch exists: XP was backfilled from history, badges
    // deliberately were not.
    const stats = {
      '2026-07-01': stat('2026-07-01', { completedCount: 40 }),
      '2026-07-29': stat('2026-07-29', { completedCount: 3 }),
    };
    const withEpoch = badgeContext({ ...base, stats, todayBlocks: [], epoch: '2026-07-28' });
    expect(withEpoch.blocksCompleted).toBe(3);

    const withoutEpoch = badgeContext({ ...base, stats, todayBlocks: [], epoch: '' });
    expect(withoutEpoch.blocksCompleted).toBe(43);
  });

  it('reads the best single day for Big Day', () => {
    const stats = {
      '2026-07-28': stat('2026-07-28', { xpEarned: 200 }),
      '2026-07-29': stat('2026-07-29', { xpEarned: 610 }),
    };
    expect(badgeContext({ ...base, stats, todayBlocks: [] }).bestDayXp).toBe(610);
  });

  it('reads earliest and latest completion from the timestamps', () => {
    const blocks = [
      block({ start: 420, end: 480, completed: true, completedAt: 470 }),
      block({ start: 1200, end: 1260, completed: true, completedAt: 1305 }),
      block({ start: 600, end: 660 }), // open, so contributes no stamp
    ];
    const c = badgeContext({ ...base, stats: {}, todayBlocks: blocks });
    expect(c.todayEarliest).toBe(470);
    expect(c.todayLatest).toBe(1305);
  });

  it('leaves the stamps null when nothing carries one', () => {
    // Every block completed before timestamps existed. Absence must not read as
    // midnight, which would hand out Dawn Patrol for all of them.
    const blocks = [block({ completed: true })];
    const c = badgeContext({ ...base, stats: {}, todayBlocks: blocks });
    expect(c.todayEarliest).toBeNull();
    expect(c.todayLatest).toBeNull();
    expect(evaluated(NONE, c).ids).not.toContain('dawn-patrol');
  });

  it('sets clearedAt only for a finished day', () => {
    const half = [
      block({ start: 540, end: 600, completed: true, completedAt: 595 }),
      block({ start: 600, end: 660 }),
    ];
    expect(badgeContext({ ...base, stats: {}, todayBlocks: half }).todayClearedAt).toBeNull();

    const all = half.map((b) => ({ ...b, completed: true, completedAt: b.end - 5 }));
    expect(badgeContext({ ...base, stats: {}, todayBlocks: all }).todayClearedAt).toBe(655);
  });

  it('ignores auto blocks throughout', () => {
    const blocks = [
      block({ start: 540, end: 600, completed: true, completedAt: 595 }),
      block({ start: 600, end: 780, auto: true, completed: true, completedAt: 700 }),
    ];
    const c = badgeContext({ ...base, stats: {}, todayBlocks: blocks });
    expect(c.todayCompleted).toBe(1);
    // The auto block is three hours; it must not win Heavy Lifter.
    expect(c.todayLongestBlock).toBe(60);
  });

  it('counts focus minutes by category kind', () => {
    const blocks = [
      block({ start: 540, end: 780, category: 'deep', completed: true }),
      block({ start: 780, end: 840, category: 'admin', completed: true }),
    ];
    expect(badgeContext({ ...base, stats: {}, todayBlocks: blocks }).todayFocusMinutes).toBe(240);
  });

  it('counts distinct categories among completed blocks only', () => {
    const blocks = [
      block({ category: 'deep', start: 540, end: 600, completed: true }),
      block({ category: 'admin', start: 600, end: 660, completed: true }),
      block({ category: 'break', start: 660, end: 720 }), // open
    ];
    expect(badgeContext({ ...base, stats: {}, todayBlocks: blocks }).todayDistinctCategories).toBe(2);
  });

  it('reads level and prestige from lifetime XP', () => {
    const progress = { ...emptyProgress(), totalXp: CYCLE_XP + xpToReachLevel(5) };
    const c = badgeContext({ ...base, progress, stats: {}, todayBlocks: [] });
    expect(c.prestige).toBe(1);
    expect(c.level).toBe(5);
  });

  it('takes the largest move count among completed blocks', () => {
    const blocks = [
      block({ start: 540, end: 600, completed: true, moves: 1 }),
      block({ start: 600, end: 660, completed: true, moves: 4 }),
      block({ start: 660, end: 720, moves: 9 }), // still open, so does not count
    ];
    expect(badgeContext({ ...base, stats: {}, todayBlocks: blocks }).todayMaxMoves).toBe(4);
  });
});

describe('weekdayRun', () => {
  it('counts consecutive weekdays back from yesterday', () => {
    // 2026-07-30 is a Thursday, so it walks Wed, Tue, Mon, then Fri the week before.
    const stats: Record<string, DailyStat> = {};
    for (const d of ['2026-07-29', '2026-07-28', '2026-07-27', '2026-07-24']) {
      stats[d] = stat(d);
    }
    expect(weekdayRun(stats, {}, TODAY)).toBe(4);
  });

  it('skips the weekend rather than breaking on it', () => {
    // Penalising someone for not working Sunday would be absurd.
    const stats: Record<string, DailyStat> = {};
    for (const d of ['2026-07-29', '2026-07-28', '2026-07-27', '2026-07-24', '2026-07-23']) {
      stats[d] = stat(d);
    }
    expect(weekdayRun(stats, {}, TODAY)).toBe(5);
  });

  it('stops at the first weekday that fell short', () => {
    const stats: Record<string, DailyStat> = {
      '2026-07-29': stat('2026-07-29'),
      '2026-07-28': stat('2026-07-28', { doneMinutes: 30, cleared: false }),
      '2026-07-27': stat('2026-07-27'),
    };
    expect(weekdayRun(stats, {}, TODAY)).toBe(1);
  });

  it('counts a marked weekday as kept', () => {
    const stats: Record<string, DailyStat> = { '2026-07-29': stat('2026-07-29') };
    expect(weekdayRun(stats, { '2026-07-28': 'gig' }, TODAY)).toBe(2);
  });

  it('is zero with no history', () => {
    expect(weekdayRun({}, {}, TODAY)).toBe(0);
  });
});

// ---------------------------------------------------------------------------

describe('the library view', () => {
  it('reports progress for a locked counting badge', () => {
    const statuses = badgeStatuses(NONE, ctx({ blocksCompleted: 5 }));
    const ten = statuses.find((s) => s.def.id === 'blocks-10')!;
    expect(ten.earned).toBe(false);
    expect(ten.progress).toBeCloseTo(0.5);
    expect(ten.progressLabel).toBe('5 / 10');
  });

  it('reports no progress bar for an earned badge', () => {
    const held: AwardLedger = { granted: [badgeKey('blocks-10')] };
    const ten = badgeStatuses(held, ctx({ blocksCompleted: 50 }))
      .find((s) => s.def.id === 'blocks-10')!;
    expect(ten.earned).toBe(true);
    expect(ten.progress).toBeNull();
  });

  it('clamps progress past the target', () => {
    const statuses = badgeStatuses(NONE, ctx({ blocksCompleted: 900 }));
    const ten = statuses.find((s) => s.def.id === 'blocks-10')!;
    expect(ten.progress).toBe(1);
    expect(ten.progressLabel).toBe('10 / 10');
  });

  it('gives no progress to a badge with no target', () => {
    const early = badgeStatuses(NONE, ctx()).find((s) => s.def.id === 'early-bird')!;
    expect(early.progress).toBeNull();
  });

  it('counts what has been earned', () => {
    const held: AwardLedger = {
      granted: [badgeKey('first-block'), badgeKey('flawless'), 'comeback:2026-07-01'],
    };
    // The comeback key is a streak award, not a badge, and must not be counted.
    expect(earnedCount(held)).toBe(2);
  });

  it('sorts earned first, then closest, with sealed ones last', () => {
    const held: AwardLedger = { granted: [badgeKey('blocks-50')] };
    const sorted = sortForDisplay(badgeStatuses(held, ctx({ blocksCompleted: 9 })));
    expect(sorted[0].def.id).toBe('blocks-50');
    const hiddenIndexes = sorted
      .map((s, i) => (s.def.hidden && !s.earned ? i : -1))
      .filter((i) => i >= 0);
    const visibleIndexes = sorted
      .map((s, i) => (!s.def.hidden || s.earned ? i : -1))
      .filter((i) => i >= 0);
    expect(Math.min(...hiddenIndexes)).toBeGreaterThan(Math.max(...visibleIndexes) - hiddenIndexes.length - 1);
  });
});

describe('nothing is earned before scoring begins', () => {
  it('keeps the prior marker readable for records written under the old backfill', () => {
    // The seal mechanism is gone — nothing before `startedOn` is scored, so no badge
    // can be true on day one. But a ledger written while it existed still holds prior
    // markers, and relabelling those as freshly earned would be a small lie.
    const legacy: AwardLedger = { granted: [badgeKey('level-25'), priorKey('level-25')] };
    const status = badgeStatuses(legacy, ctx({ level: 25 })).find(
      (x) => x.def.id === 'level-25'
    )!;
    expect(status.earned).toBe(true);
    expect(status.prior).toBe(true);
  });

  it('treats a live unlock as not prior', () => {
    expect(isPrior({ granted: [badgeKey('flawless')] }, 'flawless')).toBe(false);
  });

  it('counts a prior badge as earned — it genuinely was', () => {
    const legacy: AwardLedger = { granted: [badgeKey('level-25'), priorKey('level-25')] };
    expect(earnedCount(legacy)).toBe(1);
  });
});

describe('ladders', () => {
  it('groups the count, level and run badges into three tiles', () => {
    const ladders = laddersOf(badgeStatuses(NONE, ctx()));
    expect(ladders.map((l) => l.id)).toEqual(LADDERS.map((l) => l.id));
    expect(ladders.find((l) => l.id === 'blocks')!.rungs).toHaveLength(4);
    expect(ladders.find((l) => l.id === 'levels')!.rungs).toHaveLength(3);
    expect(ladders.find((l) => l.id === 'runs')!.rungs).toHaveLength(3);
  });

  it('orders rungs ascending, whatever order the library is in', () => {
    const blocks = laddersOf(badgeStatuses(NONE, ctx())).find((l) => l.id === 'blocks')!;
    expect(blocks.rungs.map((r) => r.def.rung)).toEqual(['1', '10', '50', '250']);
  });

  it('names the first unearned rung as next', () => {
    const held = { granted: [badgeKey('first-block'), badgeKey('blocks-10')] };
    const blocks = laddersOf(badgeStatuses(held, ctx({ blocksCompleted: 20 })))
      .find((l) => l.id === 'blocks')!;
    expect(blocks.earned).toBe(2);
    expect(blocks.next!.def.rung).toBe('50');
  });

  it('reports no next rung once a ladder is finished', () => {
    const held = {
      granted: ['first-block', 'blocks-10', 'blocks-50', 'blocks-250'].map(badgeKey),
    };
    const blocks = laddersOf(badgeStatuses(held, ctx())).find((l) => l.id === 'blocks')!;
    expect(blocks.next).toBeNull();
    expect(blocks.earned).toBe(4);
  });

  it('counts only what was genuinely paid, not sealed rungs', () => {
    // A sealed rung was recorded without payment, so it must not appear in a total
    // labelled as XP earned.
    // Built by hand now that nothing seals automatically — a legacy ledger shape.
    const sealed = {
      granted: ['level-5', 'level-10', 'level-25'].flatMap((id) => [badgeKey(id), priorKey(id)]),
    };
    const levels = laddersOf(badgeStatuses(sealed, ctx({ level: 25 }))).find(
      (l) => l.id === 'levels'
    )!;
    expect(levels.earned).toBe(3);
    expect(levels.paid).toBe(0);
  });

  it('leaves every non-ladder badge standing alone', () => {
    const all = badgeStatuses(NONE, ctx());
    const loose = standalone(all);
    const laddered = all.length - loose.length;
    expect(laddered).toBe(10);
    expect(loose.every((s) => s.def.ladder == null)).toBe(true);
  });
});

describe('nextUp', () => {
  it('picks the locked badge closest to completion', () => {
    const next = nextUp(badgeStatuses(NONE, ctx({ blocksCompleted: 9 })));
    expect(next!.def.id).toBe('blocks-10');
  });

  it('never names a hidden badge, which would be a spoiler', () => {
    const next = nextUp(badgeStatuses(NONE, ctx({ todayEarliest: 8 * 60, blocksCompleted: 4 })));
    expect(next!.def.hidden).toBeFalsy();
  });

  it('always has something to aim at, because level 1 is already partway to 5', () => {
    // There is no state with nothing started: a new user is a fifth of the way to
    // level 5, so the line never goes blank.
    expect(nextUp(badgeStatuses(NONE, ctx()))!.def.id).toBe('level-5');
  });

  it('ignores a badge already at its target, which is about to be granted', () => {
    const next = nextUp(badgeStatuses(NONE, ctx({ blocksCompleted: 9 })));
    expect(next!.def.id).toBe('blocks-10');
    expect(next!.progress).toBeLessThan(1);
  });

  it('skips anything already earned', () => {
    const held = { granted: [badgeKey('blocks-10')] };
    const next = nextUp(badgeStatuses(held, ctx({ blocksCompleted: 10 })));
    expect(next?.def.id).not.toBe('blocks-10');
  });
});

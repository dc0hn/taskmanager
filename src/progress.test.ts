import { describe, it, expect } from 'vitest';
import {
  areaStandingFor,
  areaTotals,
  brassEarned,
  BRASS_PER_XP,
  comboMultiplier,
  comboRuns,
  CYCLE_XP,
  dayScore,
  emptyProgress,
  LEVELS_PER_CYCLE,
  levelsCrossed,
  prestigedBetween,
  pruneStats,
  withinRetention,
  isScored,
  resetProgress,
  RANKS,
  reckonDay,
  reconcileDay,
  reconcileDays,
  weekdayMedians,
  scorable,
  SIGIL_FORMS,
  standingFor,
  wasOnTime,
  xpForBlock,
  xpForLevel,
  xpToNextLevel,
  xpToReachLevel,
} from './progress';
import { DEFAULT_CATEGORIES } from './types';
import type { Block, DailyStat } from './types';

const CATS = DEFAULT_CATEGORIES;

let seq = 0;
function block(p: Partial<Block> = {}): Block {
  seq++;
  return {
    id: p.id ?? `b${seq}`,
    title: p.title ?? `Block ${seq}`,
    start: p.start ?? 540,
    end: p.end ?? 600,
    category: p.category ?? 'admin',
    ...p,
  };
}

// ---------------------------------------------------------------------------

describe('the level curve', () => {
  it('rises linearly across a cycle', () => {
    // Zero-indexed: level 0 is where a fresh account starts, and costs the least.
    expect(xpForLevel(0)).toBe(60);
    expect(xpForLevel(1)).toBe(63);
    expect(xpForLevel(29)).toBe(147);
    expect(xpForLevel(59)).toBe(237);
  });

  it('clamps outside the cycle rather than extrapolating', () => {
    expect(xpForLevel(60)).toBe(xpForLevel(59));
    expect(xpForLevel(-5)).toBe(xpForLevel(0));
  });

  it('costs 8,910 XP for a full 60-level cycle', () => {
    // The number the whole pace was calibrated against: ~37 days at ~240/day.
    expect(CYCLE_XP).toBe(8910);
  });

  it('is cheap enough at the start to level on the first day', () => {
    // A first day of real work should cross several levels, not almost one.
    expect(xpToReachLevel(3)).toBeLessThan(200);
  });

  it('has exactly one rank name per level', () => {
    expect(RANKS).toHaveLength(LEVELS_PER_CYCLE);
    expect(new Set(RANKS).size).toBe(LEVELS_PER_CYCLE);
  });

  it('names every tenth level as an arc capstone', () => {
    expect(RANKS[9]).toBe('Journeyman');
    expect(RANKS[19]).toBe('Surveyor');
    expect(RANKS[29]).toBe('Printer');
    expect(RANKS[39]).toBe('Recordkeeper');
    expect(RANKS[49]).toBe('Astronomer');
    expect(RANKS[59]).toBe('Grand Reckoner');
  });
});

describe('standingFor', () => {
  it('starts at level 0 with nothing earned', () => {
    // What "starting from scratch" should actually read as.
    const s = standingFor(0);
    expect(s.level).toBe(0);
    expect(s.rank).toBe('Apprentice');
    expect(s.prestige).toBe(0);
    expect(s.intoLevel).toBe(0);
    expect(s.levelProgress).toBe(0);
  });

  it('reports progress within a level', () => {
    const s = standingFor(30);
    expect(s.level).toBe(0);
    expect(s.intoLevel).toBe(30);
    expect(s.levelProgress).toBeCloseTo(0.5, 2);
  });

  it('advances a level exactly on the boundary', () => {
    expect(standingFor(59).level).toBe(0);
    expect(standingFor(60).level).toBe(1);
    expect(standingFor(60).intoLevel).toBe(0);
  });

  it('reaches the last level of the cycle', () => {
    expect(standingFor(CYCLE_XP - 1).level).toBe(59);
    expect(standingFor(CYCLE_XP - 1).rank).toBe('Grand Reckoner');
    expect(standingFor(CYCLE_XP - 1).prestige).toBe(0);
  });

  it('prestiges into level 0 of the next cycle', () => {
    const s = standingFor(CYCLE_XP);
    expect(s.prestige).toBe(1);
    expect(s.level).toBe(0);
    expect(s.rank).toBe('Apprentice');
    expect(s.intoLevel).toBe(0);
  });

  it('keeps going forever', () => {
    const far = standingFor(CYCLE_XP * 27 + 500);
    expect(far.prestige).toBe(27);
    expect(far.level).toBeGreaterThan(0);
    expect(far.rank).toBeTruthy();
  });

  it('cycles sigil forms and then accumulates pips', () => {
    expect(standingFor(0).sigilForm).toBe(0);
    expect(standingFor(0).sigilPips).toBe(0);
    expect(standingFor(CYCLE_XP * 3).sigilForm).toBe(3);
    expect(standingFor(CYCLE_XP * SIGIL_FORMS).sigilForm).toBe(0);
    expect(standingFor(CYCLE_XP * SIGIL_FORMS).sigilPips).toBe(1);
    expect(standingFor(CYCLE_XP * (SIGIL_FORMS * 2 + 1)).sigilPips).toBe(2);
  });

  it('flags every tenth RANK as a milestone, which is level 9, 19, 29 …', () => {
    // The arcs are what the sixty names were written to; keeping them intact matters
    // more than having round numbers on screen.
    const levels = [0, 8, 9, 10, 19, 29, 58, 59];
    const flags = levels.map((n) => standingFor(xpToReachLevel(n)).milestone);
    expect(flags).toEqual([false, false, true, false, true, true, false, true]);
  });

  it('treats a negative or fractional total as zero-ish rather than throwing', () => {
    expect(standingFor(-500).level).toBe(0);
    expect(standingFor(60.9).level).toBe(1);
  });

  it('never disagrees with itself — level and XP are one fact', () => {
    for (let xp = 0; xp < CYCLE_XP * 2; xp += 137) {
      const s = standingFor(xp);
      const floor = s.prestige * CYCLE_XP + xpToReachLevel(s.level);
      expect(xp - floor).toBe(s.intoLevel);
    }
  });
});

describe('xpToNextLevel', () => {
  it('counts down to the boundary', () => {
    expect(xpToNextLevel(0)).toBe(60);
    expect(xpToNextLevel(59)).toBe(1);
    expect(xpToNextLevel(60)).toBe(63);
  });
});

describe('levelsCrossed', () => {
  it('is empty when nothing was gained', () => {
    expect(levelsCrossed(500, 500)).toEqual([]);
    expect(levelsCrossed(500, 400)).toEqual([]);
  });

  it('reports a single crossing', () => {
    const crossed = levelsCrossed(50, 70);
    expect(crossed).toHaveLength(1);
    expect(crossed[0].level).toBe(1);
  });

  it('reports every level of a generous day, not just the last', () => {
    // The reason this returns a list: a good day can cross three, and a swallowed
    // level-up is a reward silently lost.
    const crossed = levelsCrossed(0, 200);
    expect(crossed.map((s) => s.level)).toEqual([1, 2, 3]);
  });

  it('includes the prestige crossing', () => {
    const crossed = levelsCrossed(CYCLE_XP - 10, CYCLE_XP + 10);
    expect(crossed).toHaveLength(1);
    expect(crossed[0].prestige).toBe(1);
    expect(crossed[0].level).toBe(0);
  });

  it('does not report a crossing when a level is merely approached', () => {
    expect(levelsCrossed(0, 59)).toEqual([]);
  });

  it('reports a crossing that lands exactly on a boundary', () => {
    expect(levelsCrossed(0, 60).map((s) => s.level)).toEqual([1]);
  });
});

describe('choosing which crossing to celebrate', () => {
  // A day can cross a prestige boundary and keep going. Celebrating the last level
  // reached would bury the cycle completion, so the selection rule matters.
  it('finds the prestige crossing even when later levels follow it', () => {
    const crossed = levelsCrossed(CYCLE_XP - 60, CYCLE_XP + 200);
    expect(crossed.length).toBeGreaterThan(1);
    const startPrestige = standingFor(CYCLE_XP - 60).prestige;
    const prestigeCrossing = crossed.find((c) => c.prestige > startPrestige);
    expect(prestigeCrossing).toBeDefined();
    expect(prestigeCrossing!.level).toBe(0);
    // The last crossing is NOT the one to show.
    expect(crossed[crossed.length - 1].level).toBeGreaterThan(0);
  });

  it('prefers the highest arc capstone when several levels are crossed', () => {
    // Levels 8, 9 and 10 in one go: 9 is the arc capstone (the tenth rank).
    const from = xpToReachLevel(8);
    const crossed = levelsCrossed(from, xpToReachLevel(11) - 1);
    const milestone = [...crossed].reverse().find((c) => c.milestone);
    expect(milestone?.level).toBe(9);
  });

  it('falls back to the last level when no capstone was crossed', () => {
    const crossed = levelsCrossed(xpToReachLevel(10), xpToReachLevel(12) - 1);
    expect(crossed.some((c) => c.milestone)).toBe(false);
    expect(crossed[crossed.length - 1].level).toBe(11);
  });
});

describe('prestigedBetween', () => {
  it('detects completing a cycle', () => {
    expect(prestigedBetween(CYCLE_XP - 1, CYCLE_XP)).toBe(true);
    expect(prestigedBetween(0, CYCLE_XP - 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('scorable', () => {
  it('excludes auto blocks — those are the scheduler\'s, not yours', () => {
    const blocks = [block({ id: 'real' }), block({ id: 'break', auto: true })];
    expect(scorable(blocks).map((b) => b.id)).toEqual(['real']);
  });

  it('excludes zero and negative length blocks', () => {
    expect(scorable([block({ start: 540, end: 540 })])).toHaveLength(0);
    expect(scorable([block({ start: 600, end: 540 })])).toHaveLength(0);
  });

  it('returns blocks in schedule order regardless of array order', () => {
    const blocks = [
      block({ id: 'late', start: 900, end: 960 }),
      block({ id: 'early', start: 540, end: 600 }),
    ];
    expect(scorable(blocks).map((b) => b.id)).toEqual(['early', 'late']);
  });
});

describe('wasOnTime', () => {
  it('is true when ticked before the scheduled end', () => {
    expect(wasOnTime(block({ start: 540, end: 630, completed: true, completedAt: 612 }))).toBe(true);
  });

  it('is true exactly on the end', () => {
    expect(wasOnTime(block({ start: 540, end: 630, completedAt: 630 }))).toBe(true);
  });

  it('is false when ticked afterwards', () => {
    expect(wasOnTime(block({ start: 540, end: 630, completedAt: 940 }))).toBe(false);
  });

  it('is false with no timestamp, never true', () => {
    // Every block completed before timestamps existed would otherwise be declared
    // retroactively punctual and inflate the backfill.
    expect(wasOnTime(block({ completed: true }))).toBe(false);
  });

  it('is false for something ticked after midnight, because the count continues', () => {
    // 00:30 the next day is stored as 1470, not 30.
    expect(wasOnTime(block({ start: 540, end: 630, completedAt: 1470 }))).toBe(false);
  });
});

describe('comboRuns', () => {
  it('counts consecutive completions in schedule order', () => {
    const blocks = [
      block({ id: 'a', start: 540, end: 600, completed: true }),
      block({ id: 'b', start: 600, end: 660, completed: true }),
      block({ id: 'c', start: 660, end: 720, completed: true }),
    ];
    const runs = comboRuns(blocks);
    expect(runs.get('a')).toBe(0);
    expect(runs.get('b')).toBe(1);
    expect(runs.get('c')).toBe(2);
  });

  it('resets after a skipped block', () => {
    const blocks = [
      block({ id: 'a', start: 540, end: 600, completed: true }),
      block({ id: 'b', start: 600, end: 660, completed: true }),
      block({ id: 'skip', start: 660, end: 720 }),
      block({ id: 'c', start: 720, end: 780, completed: true }),
    ];
    const runs = comboRuns(blocks);
    expect(runs.get('b')).toBe(1);
    expect(runs.get('c')).toBe(0);
  });

  it('repairs the run when the gap is filled later', () => {
    // Forgiving on purpose: computed from the plan, not from tick order, so going
    // back to finish what you skipped restores the combo.
    const skipped = [
      block({ id: 'a', start: 540, end: 600, completed: true }),
      block({ id: 'gap', start: 600, end: 660 }),
      block({ id: 'c', start: 660, end: 720, completed: true }),
    ];
    expect(comboRuns(skipped).get('c')).toBe(0);

    const filled = skipped.map((b) => ({ ...b, completed: true }));
    expect(comboRuns(filled).get('c')).toBe(2);
  });

  it('ignores auto blocks so a break cannot break the run', () => {
    const blocks = [
      block({ id: 'a', start: 540, end: 600, completed: true }),
      block({ id: 'lunch', start: 600, end: 660, auto: true }),
      block({ id: 'b', start: 660, end: 720, completed: true }),
    ];
    expect(comboRuns(blocks).get('b')).toBe(1);
  });
});

describe('comboMultiplier', () => {
  it('starts flat and climbs a tenth at a time', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(1)).toBeCloseTo(1.1);
    expect(comboMultiplier(3)).toBeCloseTo(1.3);
  });

  it('caps so a long day cannot run away with it', () => {
    expect(comboMultiplier(5)).toBeCloseTo(1.5);
    expect(comboMultiplier(40)).toBeCloseTo(1.5);
  });
});

// ---------------------------------------------------------------------------

describe('xpForBlock', () => {
  it('pays by the minute', () => {
    // 60 shallow minutes at 0.55, no weights.
    expect(xpForBlock(block({ start: 540, end: 600 }), CATS).xp).toBe(33);
  });

  it('pays more for deep work', () => {
    const deep = xpForBlock(block({ start: 540, end: 600, category: 'deep' }), CATS);
    expect(deep.xp).toBe(53); // 33 × 1.6
    expect(deep.notes).toContain('focus ×1.6');
  });

  it('does not pay rest any less', () => {
    // The scheduler protects rest; the score is not going to quietly disagree.
    const rest = xpForBlock(block({ start: 540, end: 600, category: 'break' }), CATS);
    const shallow = xpForBlock(block({ start: 540, end: 600, category: 'admin' }), CATS);
    expect(rest.xp).toBe(shallow.xp);
  });

  it('pays more for high priority', () => {
    const high = xpForBlock(block({ start: 540, end: 600, priority: 'high' }), CATS);
    expect(high.xp).toBe(46); // 33 × 1.4
  });

  it('pays a punctuality bonus', () => {
    const onTime = xpForBlock(
      block({ start: 540, end: 600, completed: true, completedAt: 590 }),
      CATS
    );
    expect(onTime.xp).toBe(38); // 33 × 1.15
  });

  it('compounds every weight', () => {
    const all = xpForBlock(
      block({ start: 540, end: 630, category: 'deep', priority: 'high', completedAt: 620 }),
      CATS,
      5
    );
    // 90 × 0.55 × 1.6 × 1.4 × 1.15 × 1.5
    expect(all.xp).toBe(191);
    expect(all.notes).toHaveLength(4);
  });

  it('scales with duration rather than paying per task', () => {
    // The reason XP is per-minute: slivering must never beat doing the work.
    const one = xpForBlock(block({ start: 540, end: 660 }), CATS).xp;
    const halves =
      xpForBlock(block({ start: 540, end: 600 }), CATS).xp +
      xpForBlock(block({ start: 600, end: 660 }), CATS).xp;
    expect(one).toBe(halves);
  });

  it('never pays nothing for a real block', () => {
    expect(xpForBlock(block({ start: 540, end: 541 }), CATS).xp).toBeGreaterThanOrEqual(5);
  });

  it('treats an unknown category as neutral instead of failing', () => {
    const orphan = xpForBlock(block({ start: 540, end: 600, category: 'deleted' }), CATS);
    expect(orphan.xp).toBe(33);
  });
});

// ---------------------------------------------------------------------------

describe('reckonDay', () => {
  const day = '2026-07-30';

  it('scores nothing for an empty day', () => {
    const r = reckonDay(day, [], CATS);
    expect(r.stat.xpEarned).toBe(0);
    expect(r.stat.plannedMinutes).toBe(0);
    expect(r.stat.cleared).toBe(false);
    expect(r.lines).toEqual([]);
  });

  it('counts planned minutes whether or not they were done', () => {
    const r = reckonDay(
      day,
      [
        block({ start: 540, end: 600, completed: true }),
        block({ start: 600, end: 720 }),
      ],
      CATS
    );
    expect(r.stat.plannedMinutes).toBe(180);
    expect(r.stat.doneMinutes).toBe(60);
  });

  it('pays a bonus for clearing the whole day', () => {
    const blocks = [
      block({ start: 540, end: 600, completed: true }),
      block({ start: 600, end: 660, completed: true }),
    ];
    const r = reckonDay(day, blocks, CATS);
    expect(r.stat.cleared).toBe(true);
    expect(r.lines.at(-1)!.label).toBe('Day cleared');
    // Bonus is on top of the blocks, so the total exceeds their sum.
    const blockXp = r.lines.slice(0, -1).reduce((s, l) => s + l.xp, 0);
    expect(r.stat.xpEarned).toBeGreaterThan(blockXp);
  });

  it('pays no clearing bonus for a day with nothing planned', () => {
    expect(reckonDay(day, [], CATS).stat.cleared).toBe(false);
    expect(reckonDay(day, [block({ auto: true, completed: true })], CATS).stat.cleared).toBe(
      false
    );
  });

  it('counts a day cleared even with an unfinished auto break', () => {
    // Auto blocks are not yours to complete, so they cannot hold the day open.
    const r = reckonDay(
      day,
      [block({ start: 540, end: 600, completed: true }), block({ start: 600, end: 615, auto: true })],
      CATS
    );
    expect(r.stat.cleared).toBe(true);
  });

  it('records the best combo reached', () => {
    const blocks = [
      block({ start: 540, end: 600, completed: true }),
      block({ start: 600, end: 660, completed: true }),
      block({ start: 660, end: 720, completed: true }),
    ];
    expect(reckonDay(day, blocks, CATS).stat.bestCombo).toBe(3);
  });

  it('mints brass alongside XP', () => {
    const r = reckonDay(day, [block({ start: 540, end: 600, completed: true })], CATS);
    expect(r.stat.brassEarned).toBe(Math.round(r.stat.xpEarned * BRASS_PER_XP));
    expect(r.stat.brassEarned).toBeGreaterThan(0);
  });

  it('splits XP across categories', () => {
    const r = reckonDay(
      day,
      [
        block({ start: 540, end: 600, category: 'deep', completed: true }),
        block({ start: 600, end: 660, category: 'admin', completed: true }),
      ],
      CATS
    );
    expect(Object.keys(r.byCategory).sort()).toEqual(['admin', 'deep']);
    expect(r.byCategory.deep).toBeGreaterThan(r.byCategory.admin);
  });

  it('credits Focus only for focus-kind work', () => {
    const r = reckonDay(
      day,
      [
        block({ start: 540, end: 600, category: 'deep', completed: true }),
        block({ start: 600, end: 660, category: 'admin', completed: true }),
      ],
      CATS
    );
    expect(r.byDiscipline.focus).toBe(r.byCategory.deep);
  });

  it('credits Endurance only for long blocks', () => {
    const short = reckonDay(day, [block({ start: 540, end: 600, completed: true })], CATS);
    expect(short.byDiscipline.endurance).toBeUndefined();

    const long = reckonDay(day, [block({ start: 540, end: 660, completed: true })], CATS);
    expect(long.byDiscipline.endurance).toBeGreaterThan(0);
  });

  it('is a pure function — same blocks, same numbers', () => {
    const blocks = [
      block({ start: 540, end: 630, category: 'deep', completed: true, completedAt: 620 }),
      block({ start: 630, end: 690, completed: true }),
    ];
    expect(reckonDay(day, blocks, CATS)).toEqual(reckonDay(day, blocks, CATS));
  });

  it('never returns a negative anything', () => {
    const r = reckonDay(day, [block({ start: 600, end: 540, completed: true })], CATS);
    expect(r.stat.xpEarned).toBe(0);
    expect(r.stat.plannedMinutes).toBe(0);
  });
});

describe('dayScore', () => {
  it('is the share of planned minutes done', () => {
    const stat: DailyStat = {
      date: '2026-07-30', plannedMinutes: 300, doneMinutes: 180,
      xpEarned: 0, brassEarned: 0, bestCombo: 0, cleared: false, completedCount: 1, focusMinutes: 0,
    };
    expect(dayScore(stat)).toBeCloseTo(0.6);
  });

  it('is zero, not NaN, for a day with nothing planned', () => {
    expect(dayScore(undefined)).toBe(0);
    expect(
      dayScore({
        date: 'x', plannedMinutes: 0, doneMinutes: 0,
        xpEarned: 0, brassEarned: 0, bestCombo: 0, cleared: false, completedCount: 1, focusMinutes: 0,
      })
    ).toBe(0);
  });

  it('caps at 1 even if more was done than planned', () => {
    expect(
      dayScore({
        date: 'x', plannedMinutes: 60, doneMinutes: 120,
        xpEarned: 0, brassEarned: 0, bestCombo: 0, cleared: false, completedCount: 1, focusMinutes: 0,
      })
    ).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('reconcileDay', () => {
  const day = '2026-07-30';
  // One done, one not — so the day is deliberately NOT cleared and the figures
  // are just the block's own XP, with no clearing bonus folded in.
  const done = [
    block({ id: 'a', start: 540, end: 600, completed: true }),
    block({ id: 'b', start: 600, end: 660 }),
  ];

  it('adds a new day\'s XP to the lifetime total', () => {
    const r = reconcileDay(emptyProgress(), {}, day, done, CATS);
    expect(r.changed).toBe(true);
    expect(r.progress.totalXp).toBe(33);
    expect(r.stats[day].xpEarned).toBe(33);
    expect(r.xpDelta).toBe(33);
  });

  it('folds the clearing bonus in when the day really is finished', () => {
    const cleared = [block({ id: 'a', start: 540, end: 600, completed: true })];
    const r = reconcileDay(emptyProgress(), {}, day, cleared, CATS);
    expect(r.stats[day].cleared).toBe(true);
    expect(r.progress.totalXp).toBe(53); // 33 + the 20 minimum bonus
  });

  // The bug class this codebase has already paid for once, with goal credits.
  it('is idempotent — running it again changes nothing', () => {
    const first = reconcileDay(emptyProgress(), {}, day, done, CATS);
    const second = reconcileDay(first.progress, first.stats, day, done, CATS);
    expect(second.changed).toBe(false);
    expect(second.xpDelta).toBe(0);
    expect(second.progress).toBe(first.progress);
    expect(second.progress.totalXp).toBe(33);
  });

  it('survives ten passes without drifting', () => {
    let p = emptyProgress();
    let s: Record<string, DailyStat> = {};
    for (let i = 0; i < 10; i++) {
      const r = reconcileDay(p, s, day, done, CATS);
      p = r.progress;
      s = r.stats;
    }
    expect(p.totalXp).toBe(33);
  });

  it('applies only the difference when a day grows', () => {
    const first = reconcileDay(emptyProgress(), {}, day, done, CATS);
    const more = done.map((b) => ({ ...b, completed: true }));
    const second = reconcileDay(first.progress, first.stats, day, more, CATS);
    expect(second.progress.totalXp).toBe(second.stats[day].xpEarned);
    expect(second.xpDelta).toBeGreaterThan(0);
  });

  it('takes XP back when a block is un-ticked', () => {
    const first = reconcileDay(emptyProgress(), {}, day, done, CATS);
    const undone = done.map((b) => ({ ...b, completed: false }));
    const second = reconcileDay(first.progress, first.stats, day, undone, CATS);
    expect(second.progress.totalXp).toBe(0);
    expect(second.xpDelta).toBe(-33);
  });

  it('never drives a lifetime total negative', () => {
    const stats: Record<string, DailyStat> = {
      [day]: {
        date: day, plannedMinutes: 60, doneMinutes: 60,
        xpEarned: 500, brassEarned: 50, bestCombo: 1, cleared: true, completedCount: 1, focusMinutes: 0,
      },
    };
    const r = reconcileDay(emptyProgress(), stats, day, [], CATS);
    expect(r.progress.totalXp).toBe(0);
    expect(r.progress.brass).toBe(0);
  });

  it('derives lifetime earnings from the balance and the spend', () => {
    // Earned is not stored. It used to be its own accumulator, and a transient
    // miscount inflated it by several hundred on every launch while the balance
    // stayed correct — impossible once it is derived.
    const first = reconcileDay(emptyProgress(), {}, day, done, CATS);
    expect(brassEarned(first.progress)).toBe(first.progress.brass);

    const spent = { ...first.progress, brass: 1, brassSpent: first.progress.brass - 1 };
    expect(brassEarned(spent)).toBe(first.progress.brass);
  });

  it('cannot inflate earnings by reconciling the same day repeatedly', () => {
    let p = emptyProgress();
    let st: Record<string, DailyStat> = {};
    for (let i = 0; i < 20; i++) {
      const r = reconcileDay(p, st, day, done, CATS);
      p = r.progress;
      st = r.stats;
    }
    expect(brassEarned(p)).toBe(p.brass);
  });

  it('does not inflate earnings when a day is scored empty and then rescored', () => {
    // The exact shape of the bug: a day is briefly seen as empty because its plan has
    // not loaded, then seen again with its blocks. The balance cancelled out, so only
    // an accumulated earnings figure showed the scar.
    const withBlocks = reconcileDay(emptyProgress(), {}, day, done, CATS);
    const asEmpty = reconcileDay(withBlocks.progress, withBlocks.stats, day, [], CATS);
    const restored = reconcileDay(asEmpty.progress, asEmpty.stats, day, done, CATS);
    expect(restored.progress.brass).toBe(withBlocks.progress.brass);
    expect(brassEarned(restored.progress)).toBe(brassEarned(withBlocks.progress));
  });

  it('leaves no record for a day that was never planned', () => {
    const r = reconcileDay(emptyProgress(), {}, day, [], CATS);
    expect(r.stats[day]).toBeUndefined();
  });

  it('drops the record when a day is emptied', () => {
    const first = reconcileDay(emptyProgress(), {}, day, done, CATS);
    const second = reconcileDay(first.progress, first.stats, day, [], CATS);
    expect(second.stats[day]).toBeUndefined();
  });

  it('touches only the day it was given', () => {
    const seeded = reconcileDay(emptyProgress(), {}, '2026-07-29', done, CATS);
    const next = reconcileDay(seeded.progress, seeded.stats, day, done, CATS);
    expect(next.stats['2026-07-29']).toEqual(seeded.stats['2026-07-29']);
  });
});

describe('reconcileDays', () => {
  it('backfills a run of history in one pass', () => {
    const days = [
      { date: '2026-07-27', blocks: [block({ start: 540, end: 600, completed: true })] },
      { date: '2026-07-28', blocks: [block({ start: 540, end: 660, completed: true })] },
      { date: '2026-07-29', blocks: [block({ start: 540, end: 600 })] },
    ];
    const r = reconcileDays(emptyProgress(), {}, days, CATS);
    expect(r.changed).toBe(true);
    expect(Object.keys(r.stats).sort()).toEqual(['2026-07-27', '2026-07-28', '2026-07-29']);
    const summed = Object.values(r.stats).reduce((s, d) => s + d.xpEarned, 0);
    expect(r.progress.totalXp).toBe(summed);
  });

  it('is idempotent across the whole backfill', () => {
    const days = [
      { date: '2026-07-27', blocks: [block({ start: 540, end: 600, completed: true })] },
      { date: '2026-07-28', blocks: [block({ start: 540, end: 660, completed: true })] },
    ];
    const once = reconcileDays(emptyProgress(), {}, days, CATS);
    const twice = reconcileDays(once.progress, once.stats, days, CATS);
    expect(twice.changed).toBe(false);
    expect(twice.progress.totalXp).toBe(once.progress.totalXp);
  });
});

describe('pruneStats', () => {
  it('keeps the trailing window and drops what fell out of it', () => {
    const stats: Record<string, DailyStat> = {};
    for (const d of ['2024-01-01', '2026-07-01', '2026-07-30']) {
      stats[d] = {
        date: d, plannedMinutes: 60, doneMinutes: 60,
        xpEarned: 10, brassEarned: 1, bestCombo: 1, cleared: true, completedCount: 1, focusMinutes: 0,
      };
    }
    const kept = pruneStats(stats, '2026-07-30', 400);
    expect(Object.keys(kept).sort()).toEqual(['2026-07-01', '2026-07-30']);
  });

  it('returns the same object when nothing needs dropping', () => {
    const stats: Record<string, DailyStat> = {
      '2026-07-30': {
        date: '2026-07-30', plannedMinutes: 60, doneMinutes: 60,
        xpEarned: 10, brassEarned: 1, bestCombo: 1, cleared: true, completedCount: 1, focusMinutes: 0,
      },
    };
    expect(pruneStats(stats, '2026-07-30')).toBe(stats);
  });

  it('handles an empty record', () => {
    expect(pruneStats({}, '2026-07-30')).toEqual({});
  });
});

// ---------------------------------------------------------------------------

describe('withinRetention', () => {
  // Guards a double-count: reconciling a day whose stat was pruned would read the
  // delta as the whole amount and add its XP a second time.
  it('accepts today and the recent past', () => {
    expect(withinRetention('2026-07-30', '2026-07-30')).toBe(true);
    expect(withinRetention('2026-07-01', '2026-07-30')).toBe(true);
  });

  it('rejects a day older than the window', () => {
    expect(withinRetention('2024-01-01', '2026-07-30')).toBe(false);
  });

  it('accepts a day exactly on the boundary and rejects one past it', () => {
    expect(withinRetention('2025-06-25', '2026-07-30', 400)).toBe(true);
    expect(withinRetention('2025-06-24', '2026-07-30', 400)).toBe(false);
  });

  it('accepts tomorrow, so a block ticked just past midnight still counts', () => {
    expect(withinRetention('2026-07-31', '2026-07-30')).toBe(true);
    expect(withinRetention('2026-08-05', '2026-07-30')).toBe(false);
  });

  it('agrees with pruneStats about what survives', () => {
    // If these two ever disagree, the gap between them is a double-count.
    const dates = ['2024-01-01', '2025-06-24', '2025-06-25', '2026-07-30'];
    const stats: Record<string, DailyStat> = {};
    for (const d of dates) {
      stats[d] = {
        date: d, plannedMinutes: 60, doneMinutes: 60,
        xpEarned: 10, brassEarned: 1, bestCombo: 1, cleared: true, completedCount: 1, focusMinutes: 0,
      };
    }
    const kept = new Set(Object.keys(pruneStats(stats, '2026-07-30', 400)));
    for (const d of dates) {
      expect(withinRetention(d, '2026-07-30', 400)).toBe(kept.has(d));
    }
  });
});

describe('area levels', () => {
  it('starts at level 1 and rises on a gentler curve than the overall one', () => {
    expect(areaStandingFor(0).level).toBe(1);
    expect(areaStandingFor(99).level).toBe(1);
    expect(areaStandingFor(100).level).toBe(2);
    expect(areaStandingFor(225).level).toBe(3);
  });

  it('has no ceiling', () => {
    expect(areaStandingFor(500_000).level).toBeGreaterThan(50);
  });

  it('reports progress through the current level', () => {
    const a = areaStandingFor(150);
    expect(a.level).toBe(2);
    expect(a.intoLevel).toBe(50);
    expect(a.progress).toBeCloseTo(50 / 125, 3);
  });
});

describe('areaTotals', () => {
  it('sums category and discipline XP across days', () => {
    const days = [
      { date: '2026-07-29', blocks: [block({ start: 540, end: 660, category: 'deep', completed: true })] },
      { date: '2026-07-30', blocks: [block({ start: 540, end: 600, category: 'admin', completed: true })] },
    ];
    const t = areaTotals(days, CATS);
    expect(t.byCategory.deep).toBeGreaterThan(0);
    expect(t.byCategory.admin).toBeGreaterThan(0);
    expect(t.byDiscipline.focus).toBe(t.byCategory.deep);
    // 120 minutes clears the endurance bar; 60 does not.
    expect(t.byDiscipline.endurance).toBeGreaterThan(0);
  });

  it('is empty for no days', () => {
    expect(areaTotals([], CATS)).toEqual({ byCategory: {}, byDiscipline: {} });
  });

  it('scales a boosted day so the areas track the total', () => {
    // Without this the meter read double and every category it came from read single,
    // which is the same work reported two different ways on one screen.
    const days = [
      {
        date: '2026-07-30',
        blocks: [block({ start: 540, end: 660, category: 'deep', completed: true })],
      },
    ];
    const plain = areaTotals(days, CATS);
    const boosted = areaTotals(days, CATS, { '2026-07-30': 2 });

    expect(boosted.byCategory.deep).toBe(plain.byCategory.deep * 2);
    expect(boosted.byDiscipline.focus).toBe((plain.byDiscipline.focus ?? 0) * 2);
    expect(boosted.byDiscipline.endurance).toBe((plain.byDiscipline.endurance ?? 0) * 2);
  });

  it('leaves unboosted days in a boosted map alone', () => {
    const days = [
      {
        date: '2026-07-29',
        blocks: [block({ start: 540, end: 660, category: 'deep', completed: true })],
      },
      {
        date: '2026-07-30',
        blocks: [block({ start: 540, end: 660, category: 'deep', completed: true })],
      },
    ];
    const one = areaTotals([days[0]], CATS);
    const mixed = areaTotals(days, CATS, { '2026-07-30': 2 });
    // One plain day plus one doubled day.
    expect(mixed.byCategory.deep).toBe(one.byCategory.deep * 3);
  });
});

describe('the scored era', () => {
  // The guard that makes "starting from today" mean it. Without it, zeroing the total
  // left every past day unscored-but-scoreable, so the next visit to the month view
  // earned the whole archive back.
  it('scores nothing at all before a start date is set', () => {
    expect(isScored('2026-07-30', '')).toBe(false);
    expect(isScored('2020-01-01', '')).toBe(false);
  });

  it('scores the start day itself and everything after', () => {
    expect(isScored('2026-07-30', '2026-07-30')).toBe(true);
    expect(isScored('2026-07-31', '2026-07-30')).toBe(true);
  });

  it('never scores a day before the start', () => {
    expect(isScored('2026-07-29', '2026-07-30')).toBe(false);
    expect(isScored('2019-01-01', '2026-07-30')).toBe(false);
  });
});

describe('resetProgress', () => {
  it('returns to nothing and stamps a new start', () => {
    const reset = resetProgress('2026-07-30');
    expect(reset.totalXp).toBe(0);
    expect(reset.brass).toBe(0);
    expect(reset.brassSpent).toBe(0);
    expect(reset.startedOn).toBe('2026-07-30');
    expect(reset.disciplines).toEqual({});
  });

  it('lands at level 0 with nothing banked', () => {
    const s = standingFor(resetProgress('2026-07-30').totalXp);
    expect(s.level).toBe(0);
    expect(s.prestige).toBe(0);
    expect(s.intoLevel).toBe(0);
    expect(s.rank).toBe(RANKS[0]);
  });

  it('cannot be undone by reconciliation finding old days', () => {
    // The failure this guards against, stated as a sequence: reset, then a past day
    // gets loaded and reconciled. It must contribute nothing.
    const reset = resetProgress('2026-07-30');
    const before = '2026-07-01';
    expect(isScored(before, reset.startedOn)).toBe(false);

    // And a day on or after the start still counts, so the reset is not a freeze.
    expect(isScored('2026-07-30', reset.startedOn)).toBe(true);
  });
});

describe('the brass balance across a spend', () => {
  const cats = DEFAULT_CATEGORIES;
  const CAT = DEFAULT_CATEGORIES[0].id;

  const one = (completed: boolean): Block =>
    ({
      id: 'b1',
      title: 'Work',
      start: 540,
      end: 660,
      category: CAT,
      completed,
      completedAt: completed ? 660 : undefined,
    }) as Block;

  it('cannot mint the same day twice by spending and un-ticking', () => {
    // The exploit this closes, as a sequence: earn brass from one block, spend it all,
    // un-tick the block, tick it again. While the balance clamped at zero the un-tick
    // was forgiven, so the re-tick minted a second time — one block, spendable
    // repeatedly, indefinitely.
    let stats: Record<string, DailyStat> = {};
    let p = { ...emptyProgress(), startedOn: '2026-07-30' };

    const tick = reconcileDay(p, stats, '2026-07-30', [one(true)], cats);
    p = tick.progress;
    stats = tick.stats;
    const minted = p.brass;
    expect(minted).toBeGreaterThan(0);

    // Spend the lot, as a purchase does.
    p = { ...p, brass: 0, brassSpent: minted };
    expect(brassEarned(p)).toBe(minted);

    // Un-tick. The balance goes into the red, because the spend outlived the work.
    const untick = reconcileDay(p, stats, '2026-07-30', [one(false)], cats);
    p = untick.progress;
    stats = untick.stats;
    expect(p.brass).toBe(-minted);
    // Lifetime earnings are back to nothing, which is the truth about the work done.
    expect(brassEarned(p)).toBe(0);

    // Re-tick. It pays off the hole rather than minting again.
    const again = reconcileDay(p, stats, '2026-07-30', [one(true)], cats);
    p = again.progress;
    expect(p.brass).toBe(0);
    expect(brassEarned(p)).toBe(minted);
  });

  it('never lets derived lifetime earnings go negative', () => {
    // Nothing spent, so there is no hole to fall into: the floor is zero.
    const p = { ...emptyProgress(), startedOn: '2026-07-30' };
    const tick = reconcileDay(p, {}, '2026-07-30', [one(true)], cats);
    const untick = reconcileDay(tick.progress, tick.stats, '2026-07-30', [one(false)], cats);
    expect(untick.progress.brass).toBe(0);
    expect(brassEarned(untick.progress)).toBe(0);
  });
});

describe('weekdayMedians — the trailing ghost', () => {
  const stat = (date: string, planned: number, done: number): DailyStat => ({
    date,
    plannedMinutes: planned,
    doneMinutes: done,
    xpEarned: 0,
    brassEarned: 0,
    bestCombo: 0,
    cleared: planned > 0 && done >= planned,
    completedCount: 0,
    focusMinutes: 0,
  });

  /** Same weekday, `weeks` back from `date`. */
  const back = (date: string, weeks: number) => {
    const [y, m, d] = date.split('-').map(Number);
    const t = Date.UTC(y, m - 1, d) - weeks * 7 * 86_400_000;
    const o = new Date(t);
    return `${o.getUTCFullYear()}-${String(o.getUTCMonth() + 1).padStart(2, '0')}-${String(o.getUTCDate()).padStart(2, '0')}`;
  };

  const TODAY = '2026-07-30';

  it('says nothing with too little history', () => {
    // One previous Tuesday is not a baseline, it is last Tuesday.
    const stats = { [back(TODAY, 1)]: stat(back(TODAY, 1), 300, 300) };
    expect(weekdayMedians(stats, [TODAY])).toEqual({});
  });

  it('takes the median of the trailing same-weekdays', () => {
    const stats: Record<string, DailyStat> = {};
    // Scores 1.0, 0.5, 0.25, 0.0 -> median of the middle two is 0.375.
    const scores = [1, 0.5, 0.25, 0];
    scores.forEach((sc, i) => {
      const d = back(TODAY, i + 1);
      stats[d] = stat(d, 400, 400 * sc);
    });
    expect(weekdayMedians(stats, [TODAY])[TODAY]).toBeCloseTo(0.375, 5);
  });

  it('is unmoved by one abandoned day, which a mean would not be', () => {
    // The reason for a median. Three good Tuesdays and one write-off should still read as
    // a good Tuesday.
    const stats: Record<string, DailyStat> = {};
    [1, 1, 1, 0].forEach((sc, i) => {
      const d = back(TODAY, i + 1);
      stats[d] = stat(d, 300, 300 * sc);
    });
    expect(weekdayMedians(stats, [TODAY])[TODAY]).toBe(1);
  });

  it('ignores days that had nothing planned', () => {
    // A blank day scored zero for reasons that have nothing to do with the weekday, so
    // counting it would drag every baseline toward zero over a holiday.
    const stats: Record<string, DailyStat> = {};
    stats[back(TODAY, 1)] = stat(back(TODAY, 1), 300, 300);
    stats[back(TODAY, 2)] = stat(back(TODAY, 2), 300, 300);
    stats[back(TODAY, 3)] = stat(back(TODAY, 3), 0, 0);
    stats[back(TODAY, 4)] = stat(back(TODAY, 4), 0, 0);
    expect(weekdayMedians(stats, [TODAY])[TODAY]).toBe(1);
  });

  it('never exceeds one, so the ghost cannot overrun its track', () => {
    const stats: Record<string, DailyStat> = {};
    for (let i = 1; i <= 4; i++) {
      const d = back(TODAY, i);
      stats[d] = stat(d, 100, 500); // wildly over
    }
    expect(weekdayMedians(stats, [TODAY])[TODAY]).toBe(1);
  });

  it('keeps weekdays independent', () => {
    const monday = '2026-07-27';
    const stats: Record<string, DailyStat> = {};
    for (let i = 1; i <= 4; i++) {
      const t = back(TODAY, i);
      const m = back(monday, i);
      stats[t] = stat(t, 300, 300);
      stats[m] = stat(m, 300, 60);
    }
    const found = weekdayMedians(stats, [monday, TODAY]);
    expect(found[TODAY]).toBe(1);
    expect(found[monday]).toBeCloseTo(0.2, 5);
  });
});

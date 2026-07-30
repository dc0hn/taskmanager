import { describe, it, expect } from 'vitest';
import {
  buildInsightContext,
  CODEX_TOTAL,
  INSIGHTS,
  insightById,
  insightStatuses,
  isRead,
  isUnlocked,
  readKey,
  sortCodex,
  unlockKey,
  unlockedCount,
  unlocksDue,
  insightIdFromKey,
  type InsightContext,
} from './insights';
import { payoutXp } from './types';
import type { AwardPayout } from './types';

/** Test shim: `unlocksDue` returns payouts now, not parallel id/key/xp arrays. */
function unlocks(ledger: Parameters<typeof unlocksDue>[0], ctx: Parameters<typeof unlocksDue>[1]) {
  const payouts: AwardPayout[] = unlocksDue(ledger, ctx);
  return {
    payouts,
    keys: payouts.map((a) => a.key),
    ids: payouts.map((a) => insightIdFromKey(a.key)),
    xp: payoutXp(payouts),
  };
}
import { DEFAULT_CATEGORIES } from './types';
import type { AwardLedger, Block, DailyStat, DayPlan } from './types';

const CATS = DEFAULT_CATEGORIES;
const NONE: AwardLedger = { granted: [] };

function shift(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth() + 1).padStart(2, '0')}-${String(out.getUTCDate()).padStart(2, '0')}`;
}

let seq = 0;
function block(p: Partial<Block> = {}): Block {
  seq++;
  return {
    id: p.id ?? `b${seq}`,
    title: p.title ?? `Block ${seq}`,
    start: 540,
    end: 630,
    category: 'deep',
    ...p,
  };
}

function stat(date: string, p: Partial<DailyStat> = {}): DailyStat {
  return {
    date,
    plannedMinutes: 300,
    doneMinutes: 240,
    xpEarned: 132,
    brassEarned: 13,
    bestCombo: 2,
    cleared: false,
    completedCount: 3,
    focusMinutes: 120,
    ...p,
  };
}

/** N days, each holding `per` completed blocks stamped at `at`. */
function history(
  n: number,
  per: number,
  at: (i: number, j: number) => number,
  extra: (i: number, j: number) => Partial<Block> = () => ({})
): InsightContext {
  const plans: Record<string, DayPlan> = {};
  const stats: Record<string, DailyStat> = {};
  const dates: string[] = [];
  for (let i = 0; i < n; i++) {
    const date = shift('2026-05-01', i);
    dates.push(date);
    const blocks: Block[] = [];
    for (let j = 0; j < per; j++) {
      blocks.push(
        block({
          id: `${date}-${j}`,
          start: 540 + j * 100,
          end: 630 + j * 100,
          completed: true,
          completedAt: at(i, j),
          ...extra(i, j),
        })
      );
    }
    plans[date] = { date, tasks: [], blocks };
    stats[date] = stat(date);
  }
  return buildInsightContext(plans, dates, stats, CATS);
}

const EMPTY: InsightContext = buildInsightContext({}, [], {}, CATS);

// ---------------------------------------------------------------------------

describe('the library', () => {
  it('has no duplicate ids', () => {
    expect(new Set(INSIGHTS.map((i) => i.id)).size).toBe(CODEX_TOTAL);
  });

  it('gives every card a name, promise, requirement and reward', () => {
    for (const i of INSIGHTS) {
      expect(i.name.length).toBeGreaterThan(0);
      expect(i.promise.length).toBeGreaterThan(0);
      expect(i.requirement.length).toBeGreaterThan(0);
      expect(i.target).toBeGreaterThan(0);
      expect(i.xpUnlock).toBeGreaterThan(0);
      expect(i.xpRead).toBeGreaterThan(0);
    }
  });

  it('pays more for unlocking than for reading', () => {
    // Unlocking is the achievement; reading is the nudge to actually look.
    for (const i of INSIGHTS) expect(i.xpUnlock).toBeGreaterThan(i.xpRead);
  });

  it('sets requirements high enough to mean something', () => {
    // An insight from four blocks is noise wearing a chart's clothing.
    for (const i of INSIGHTS) expect(i.target).toBeGreaterThanOrEqual(8);
  });

  it('states nothing at all from no data', () => {
    for (const i of INSIGHTS) {
      expect(i.progress(EMPTY)).toBe(0);
      expect(i.compute(EMPTY)).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------

describe('peak window', () => {
  const rule = insightById('peak-window')!;

  it('counts only completions carrying a timestamp', () => {
    // Blocks completed before timestamps existed cannot say anything about the hour.
    const untimed = history(10, 3, () => 0, () => ({ completedAt: undefined }));
    expect(rule.progress(untimed)).toBe(0);
  });

  it('names the window most work lands in', () => {
    // Everything finished before 9am.
    const ctx = history(10, 3, () => 480);
    const f = rule.compute(ctx)!;
    expect(f.headline).toContain('before 9am');
    expect(f.headline).toContain('100%');
  });

  it('splits into four windows, not twenty-four hours', () => {
    const f = rule.compute(history(10, 3, (_i, j) => 480 + j * 300))!;
    expect(f.bars).toHaveLength(4);
  });

  it('reports the share honestly when work is spread', () => {
    const ctx = history(12, 4, (_i, j) => [480, 600, 800, 1100][j]);
    const f = rule.compute(ctx)!;
    expect(f.headline).toMatch(/25%/);
  });
});

describe('what overruns its slot', () => {
  const rule = insightById('category-lateness')!;

  it('measures lateness against the booked end, and says so', () => {
    // The brief asked for estimate-versus-actual. Almanac records when you ticked,
    // not how long you took, so the card must not claim otherwise.
    const ctx = history(12, 3, (_i, j) => 630 + j * 100 + 30);
    const f = rule.compute(ctx)!;
    expect(f.detail.join(' ')).toContain('not as time spent');
    expect(f.headline).toContain('past its slot');
  });

  it('says so plainly when nothing overruns', () => {
    const ctx = history(12, 3, (_i, j) => 630 + j * 100 - 20);
    const f = rule.compute(ctx)!;
    expect(f.headline).toContain('Nothing overruns');
  });

  it('ignores a category with too few samples to judge', () => {
    const plans: Record<string, DayPlan> = {};
    const stats: Record<string, DailyStat> = {};
    const dates: string[] = [];
    for (let i = 0; i < 12; i++) {
      const date = shift('2026-05-01', i);
      dates.push(date);
      plans[date] = {
        date,
        tasks: [],
        blocks: [
          block({ id: `${date}-a`, category: 'deep', completed: true, completedAt: 700 }),
          block({ id: `${date}-b`, category: 'admin', completed: true, completedAt: 700 }),
          // 'other' appears twice in total, below the three-sample floor.
          ...(i < 2
            ? [block({ id: `${date}-c`, category: 'other', completed: true, completedAt: 700 })]
            : []),
        ],
      };
      stats[date] = stat(date);
    }
    const f = rule.compute(buildInsightContext(plans, dates, stats, CATS))!;
    expect(f.bars!.some((b) => b.label === 'Other')).toBe(false);
  });
});

describe('what you keep avoiding', () => {
  const rule = insightById('avoidance')!;

  it('counts only blocks that were actually moved', () => {
    expect(rule.progress(history(10, 3, () => 600))).toBe(0);
    const moved = history(10, 1, () => 600, () => ({ moves: 2 }));
    expect(rule.progress(moved)).toBe(10);
  });

  it('names the worst offender and how open it still is', () => {
    const plans: Record<string, DayPlan> = {};
    const dates: string[] = [];
    for (let i = 0; i < 10; i++) {
      const date = shift('2026-05-01', i);
      dates.push(date);
      plans[date] = {
        date,
        tasks: [],
        blocks: [
          block({ id: `${date}-a`, title: 'Colour grade', moves: i === 0 ? 6 : 1, completed: false }),
        ],
      };
    }
    const f = rule.compute(buildInsightContext(plans, dates, {}, CATS))!;
    expect(f.headline).toContain('Colour grade');
    expect(f.headline).toContain('6 times');
    expect(f.detail.join(' ')).toContain('still open');
  });

  it('shows at most six offenders', () => {
    const moved = history(20, 1, () => 600, (i) => ({ moves: i + 1 }));
    expect(rule.compute(moved)!.bars!.length).toBeLessThanOrEqual(6);
  });
});

describe('where your hours go', () => {
  const rule = insightById('hours-go')!;

  it('compares completed share against planned share', () => {
    const plans: Record<string, DayPlan> = {};
    const stats: Record<string, DailyStat> = {};
    const dates: string[] = [];
    for (let i = 0; i < 32; i++) {
      const date = shift('2026-05-01', i);
      dates.push(date);
      plans[date] = {
        date,
        tasks: [],
        blocks: [
          // Deep work is planned but rarely done; admin always is.
          block({ id: `${date}-a`, category: 'deep', start: 540, end: 720, completed: i % 4 === 0 }),
          block({ id: `${date}-b`, category: 'admin', start: 730, end: 790, completed: true }),
        ],
      };
      stats[date] = stat(date);
    }
    const f = rule.compute(buildInsightContext(plans, dates, stats, CATS))!;
    expect(f.headline).toMatch(/deep focus|admin/i);
    expect(f.detail.join(' ')).toContain('completed');
  });

  it('needs thirty recorded days', () => {
    expect(rule.target).toBe(30);
    expect(rule.progress(history(29, 2, () => 600))).toBe(29);
  });
});

describe('your strongest day', () => {
  const rule = insightById('best-weekday')!;

  it('needs several weekdays with data before judging', () => {
    const ctx = history(3, 1, () => 600);
    expect(rule.compute(ctx)).toBeNull();
  });

  it('names the strongest and weakest day', () => {
    const plans: Record<string, DayPlan> = {};
    const stats: Record<string, DailyStat> = {};
    const dates: string[] = [];
    for (let i = 0; i < 28; i++) {
      const date = shift('2026-05-04', i); // a Monday
      const dow = new Date(`${date}T00:00:00`).getDay();
      dates.push(date);
      plans[date] = { date, tasks: [], blocks: [] };
      // Wednesdays are excellent, Fridays poor.
      const done = dow === 3 ? 300 : dow === 5 ? 30 : 180;
      stats[date] = stat(date, { plannedMinutes: 300, doneMinutes: done });
    }
    const f = rule.compute(buildInsightContext(plans, dates, stats, CATS))!;
    expect(f.headline).toContain('Wednesday');
    expect(f.detail[0]).toContain('Friday');
  });
});

describe('how long you can hold focus', () => {
  const rule = insightById('session-length')!;

  it('buckets by duration and reports completion rate', () => {
    const plans: Record<string, DayPlan> = {};
    const dates: string[] = [];
    for (let i = 0; i < 12; i++) {
      const date = shift('2026-05-01', i);
      dates.push(date);
      plans[date] = {
        date,
        tasks: [],
        blocks: [
          block({ id: `${date}-a`, start: 540, end: 560, completed: true }), // 20m
          block({ id: `${date}-b`, start: 570, end: 615, completed: true }), // 45m
          block({ id: `${date}-c`, start: 620, end: 800, completed: false }), // 180m
          block({ id: `${date}-d`, start: 810, end: 990, completed: false }), // 180m
        ],
      };
    }
    const f = rule.compute(buildInsightContext(plans, dates, {}, CATS))!;
    expect(f.bars!.length).toBeGreaterThanOrEqual(2);
    // Short blocks finish; the long bracket does not.
    expect(f.headline).toMatch(/Up to 30m|30–60m/);
  });

  it('says nothing from a single bucket', () => {
    const uniform = history(12, 4, () => 600);
    const f = rule.compute(uniform);
    // Every block here is 90 minutes, so only one bracket has data.
    expect(f).toBeNull();
  });
});

describe('whether you finish on time', () => {
  const rule = insightById('punctuality')!;

  it('reports the share landing inside the slot', () => {
    const onTime = history(15, 3, (_i, j) => 630 + j * 100 - 5);
    const f = rule.compute(onTime)!;
    expect(f.headline).toContain('100%');
  });

  it('reports direction, not just an average', () => {
    // Late in the first half, punctual in the second.
    const plans: Record<string, DayPlan> = {};
    const dates: string[] = [];
    for (let i = 0; i < 20; i++) {
      const date = shift('2026-05-01', i);
      dates.push(date);
      const late = i < 10;
      plans[date] = {
        date,
        tasks: [],
        blocks: [
          block({ id: `${date}-a`, start: 540, end: 630, completed: true, completedAt: late ? 900 : 620 }),
          block({ id: `${date}-b`, start: 640, end: 730, completed: true, completedAt: late ? 950 : 720 }),
        ],
      };
    }
    const f = rule.compute(buildInsightContext(plans, dates, {}, CATS))!;
    expect(f.detail[0]).toMatch(/Improving/);
  });

  it('never blames the person for a wrong estimate', () => {
    const f = rule.compute(history(15, 3, (_i, j) => 630 + j * 100 + 60))!;
    expect(f.detail.join(' ')).toContain('wrong estimate, not a failure of will');
  });
});

describe('what an early start is worth', () => {
  const rule = insightById('early-start')!;

  it('needs both kinds of day before comparing', () => {
    const allEarly = history(30, 2, () => 480);
    expect(rule.compute(allEarly)).toBeNull();
  });

  it('compares early-start days against later ones', () => {
    const plans: Record<string, DayPlan> = {};
    const stats: Record<string, DailyStat> = {};
    const dates: string[] = [];
    for (let i = 0; i < 26; i++) {
      const date = shift('2026-05-01', i);
      dates.push(date);
      const early = i % 2 === 0;
      plans[date] = {
        date,
        tasks: [],
        blocks: [
          block({ id: `${date}-a`, completed: true, completedAt: early ? 500 : 900 }),
        ],
      };
      stats[date] = stat(date, {
        plannedMinutes: 300,
        doneMinutes: early ? 285 : 120,
      });
    }
    const f = rule.compute(buildInsightContext(plans, dates, stats, CATS))!;
    expect(f.headline).toContain('before 10am');
    expect(f.bars).toHaveLength(2);
  });

  it('is willing to report that the early start does not matter', () => {
    // An insight that can only confirm the flattering hypothesis is not an insight.
    const plans: Record<string, DayPlan> = {};
    const stats: Record<string, DailyStat> = {};
    const dates: string[] = [];
    for (let i = 0; i < 26; i++) {
      const date = shift('2026-05-01', i);
      dates.push(date);
      const early = i % 2 === 0;
      plans[date] = {
        date,
        tasks: [],
        blocks: [block({ id: `${date}-a`, completed: true, completedAt: early ? 500 : 900 })],
      };
      stats[date] = stat(date, { plannedMinutes: 300, doneMinutes: 200 });
    }
    const f = rule.compute(buildInsightContext(plans, dates, stats, CATS))!;
    expect(f.headline).toMatch(/almost no difference/);
  });
});

// ---------------------------------------------------------------------------

describe('unlocking', () => {
  it('unlocks nothing without the data', () => {
    expect(unlocks(NONE, EMPTY).keys).toEqual([]);
  });

  it('unlocks a card whose requirement is met', () => {
    const ctx = history(12, 3, () => 480);
    const due = unlocks(NONE, ctx);
    expect(due.ids).toContain('peak-window');
    expect(due.xp).toBeGreaterThan(0);
  });

  it('will not unlock a card that cannot state anything', () => {
    // The requirement can be met on paper while the data still supports no finding,
    // and an empty card is worse than a sealed one.
    const uniform = history(12, 4, () => 600);
    const due = unlocks(NONE, uniform);
    expect(due.ids).not.toContain('session-length');
  });

  it('never unlocks the same card twice', () => {
    const ctx = history(12, 3, () => 480);
    const held: AwardLedger = { granted: [unlockKey('peak-window')] };
    expect(unlocks(held, ctx).ids).not.toContain('peak-window');
  });

  it('reports what is unlocked', () => {
    const held: AwardLedger = { granted: [unlockKey('peak-window')] };
    expect(isUnlocked(held, 'peak-window')).toBe(true);
    expect(isUnlocked(held, 'avoidance')).toBe(false);
    expect(unlockedCount(held)).toBe(1);
  });

  it('tracks reading separately from unlocking', () => {
    const held: AwardLedger = { granted: [unlockKey('peak-window')] };
    expect(isRead(held, 'peak-window')).toBe(false);
    const read: AwardLedger = { granted: [...held.granted, readKey('peak-window')] };
    expect(isRead(read, 'peak-window')).toBe(true);
  });
});

describe('statuses', () => {
  it('withholds the finding until unlocked', () => {
    const ctx = history(12, 3, () => 480);
    const sealed = insightStatuses(NONE, ctx).find((s) => s.id === 'peak-window')!;
    expect(sealed.unlocked).toBe(false);
    expect(sealed.finding).toBeNull();

    const held: AwardLedger = { granted: [unlockKey('peak-window')] };
    const open = insightStatuses(held, ctx).find((s) => s.id === 'peak-window')!;
    expect(open.finding).not.toBeNull();
  });

  it('reports progress toward the requirement', () => {
    const ctx = history(3, 2, () => 480); // 6 timed completions of 20
    const s = insightStatuses(NONE, ctx).find((x) => x.id === 'peak-window')!;
    expect(s.progressLabel).toBe('6 / 20');
    expect(s.progress).toBeCloseTo(0.3);
  });

  it('clamps progress at the requirement', () => {
    const ctx = history(40, 3, () => 480);
    const s = insightStatuses(NONE, ctx).find((x) => x.id === 'peak-window')!;
    expect(s.progress).toBe(1);
    expect(s.progressLabel).toBe('20 / 20');
  });

  it('recomputes the finding rather than storing it', () => {
    // A stored finding would freeze the day it unlocked; this must track history.
    const held: AwardLedger = { granted: [unlockKey('peak-window')] };
    const early = insightStatuses(held, history(12, 3, () => 480))
      .find((s) => s.id === 'peak-window')!;
    const late = insightStatuses(held, history(12, 3, () => 1200))
      .find((s) => s.id === 'peak-window')!;
    expect(early.finding!.headline).not.toBe(late.finding!.headline);
  });
});

describe('sorting the codex', () => {
  it('puts unlocked-but-unread first, because they are owed to you', () => {
    const ctx = history(40, 3, () => 480);
    const ledger: AwardLedger = {
      granted: [
        unlockKey('peak-window'),
        unlockKey('punctuality'),
        readKey('punctuality'),
      ],
    };
    const sorted = sortCodex(insightStatuses(ledger, ctx));
    expect(sorted[0].id).toBe('peak-window');
    // Read ones come after, sealed ones last.
    const sealedFirstIndex = sorted.findIndex((s) => !s.unlocked);
    const readIndex = sorted.findIndex((s) => s.read);
    expect(readIndex).toBeLessThan(sealedFirstIndex);
  });

  it('orders sealed cards by how close they are', () => {
    const ctx = history(12, 3, () => 480);
    const sealed = sortCodex(insightStatuses(NONE, ctx)).filter((s) => !s.unlocked);
    for (let i = 1; i < sealed.length; i++) {
      expect(sealed[i - 1].progress).toBeGreaterThanOrEqual(sealed[i].progress);
    }
  });
});

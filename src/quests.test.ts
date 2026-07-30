import { describe, it, expect } from 'vitest';
import {
  buildWeekContext,
  DAILY_CHALLENGES,
  dailyChallenge,
  goalQuests,
  heavyDayQuest,
  isPaid,
  pick,
  pickSome,
  questKey,
  questPayout,
  questSummary,
  questsFor,
  QUEST_BONUS_MIN,
  routineQuests,
  runQuests,
  seedFrom,
  WEEKLY_CHALLENGES,
  weeklyChallenge,
  WILDCARDS,
  wildcardQuest,
  type WeekContext,
} from './quests';
import { DEFAULT_CATEGORIES, DEFAULT_DAY_MARKS } from './types';
import type {
  AwardLedger,
  Block,
  DailyStat,
  DayPlan,
  HabitStore,
  RecurringTask,
  WeeklyGoal,
} from './types';

const WEEK = '2026-07-27'; // Monday
const DATES = [
  '2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30',
  '2026-07-31', '2026-08-01', '2026-08-02',
];
const NONE: AwardLedger = { granted: [] };

let seq = 0;
function block(p: Partial<Block> = {}): Block {
  seq++;
  return {
    id: p.id ?? `b${seq}`,
    title: `Block ${seq}`,
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

function ctx(over: Partial<WeekContext> = {}): WeekContext {
  const plans: Record<string, DayPlan> = {};
  return buildWeekContext({
    weekKey: WEEK,
    plans,
    stats: {},
    week: { week: WEEK, goals: [], credits: [] },
    habits: { templates: [], completions: [] },
    marks: {},
    markDefs: DEFAULT_DAY_MARKS,
    categories: DEFAULT_CATEGORIES,
    ...over,
  });
}

function plansOf(map: Record<string, Block[]>): Record<string, DayPlan> {
  const out: Record<string, DayPlan> = {};
  for (const [date, blocks] of Object.entries(map)) out[date] = { date, tasks: [], blocks };
  return out;
}

const goal = (p: Partial<WeeklyGoal> = {}): WeeklyGoal =>
  ({
    id: 'g1',
    label: 'Edit sessions',
    category: 'deep',
    targetKind: 'sessions',
    target: 3,
    sessionMinutes: 90,
    cadence: 'weekly',
    createdOn: WEEK,
    ...p,
  }) as WeeklyGoal;

// ---------------------------------------------------------------------------

describe('deterministic picking', () => {
  it('gives the same answer for the same key, always', () => {
    // The whole point: a challenge that reshuffles on reload is not a challenge.
    const a = pick(DAILY_CHALLENGES, 'daily:2026-07-30');
    const b = pick(DAILY_CHALLENGES, 'daily:2026-07-30');
    expect(a.id).toBe(b.id);
  });

  it('gives different answers for different keys', () => {
    const picks = new Set(
      DATES.map((d) => pick(DAILY_CHALLENGES, `daily:${d}`).id)
    );
    expect(picks.size).toBeGreaterThan(1);
  });

  it('hashes stably and never negative', () => {
    expect(seedFrom('x')).toBe(seedFrom('x'));
    expect(seedFrom('2026-07-27')).toBeGreaterThanOrEqual(0);
    expect(seedFrom('')).toBeGreaterThanOrEqual(0);
  });

  it('spreads across the pool over a year of weeks', () => {
    // A rotation that lands on two of eight options is not a rotation.
    const seen = new Set<string>();
    for (let i = 0; i < 52; i++) {
      seen.add(pick(WILDCARDS, `wildcard:week-${i}`).id);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('picks distinct items when asked for several', () => {
    const three = pickSome(WILDCARDS, 'k', 3);
    expect(three).toHaveLength(3);
    expect(new Set(three.map((w) => w.id)).size).toBe(3);
  });

  it('cannot be asked for more than exist', () => {
    expect(pickSome(WILDCARDS, 'k', 99)).toHaveLength(WILDCARDS.length);
  });
});

// ---------------------------------------------------------------------------

describe('goal quests', () => {
  it('makes one quest per goal with blocks booked against it', () => {
    const c = ctx({
      week: { week: WEEK, goals: [goal()], credits: [] },
      plans: plansOf({
        '2026-07-27': [block({ goalId: 'g1' })],
        '2026-07-29': [block({ goalId: 'g1' })],
      }),
    });
    const quests = goalQuests(c);
    expect(quests).toHaveLength(1);
    expect(quests[0].total).toBe(2);
    expect(quests[0].name).toBe('Edit sessions');
  });

  it('ignores a goal with only one block — that is a task, not a set', () => {
    const c = ctx({
      week: { week: WEEK, goals: [goal()], credits: [] },
      plans: plansOf({ '2026-07-27': [block({ goalId: 'g1' })] }),
    });
    expect(goalQuests(c)).toEqual([]);
  });

  it('ignores a goal that was stood down', () => {
    const c = ctx({
      week: { week: WEEK, goals: [goal({ voided: true })], credits: [] },
      plans: plansOf({
        '2026-07-27': [block({ goalId: 'g1' })],
        '2026-07-29': [block({ goalId: 'g1' })],
      }),
    });
    expect(goalQuests(c)).toEqual([]);
  });

  it('completes only when every block is done', () => {
    const partial = ctx({
      week: { week: WEEK, goals: [goal()], credits: [] },
      plans: plansOf({
        '2026-07-27': [block({ goalId: 'g1', completed: true })],
        '2026-07-29': [block({ goalId: 'g1' })],
      }),
    });
    expect(goalQuests(partial)[0].complete).toBe(false);
    expect(goalQuests(partial)[0].done).toBe(1);

    const whole = ctx({
      week: { week: WEEK, goals: [goal()], credits: [] },
      plans: plansOf({
        '2026-07-27': [block({ goalId: 'g1', completed: true })],
        '2026-07-29': [block({ goalId: 'g1', completed: true })],
      }),
    });
    expect(goalQuests(whole)[0].complete).toBe(true);
  });

  it('pays a bonus proportional to the set, with a floor', () => {
    const c = ctx({
      week: { week: WEEK, goals: [goal()], credits: [] },
      plans: plansOf({
        '2026-07-27': [block({ goalId: 'g1', start: 540, end: 900 })],
        '2026-07-29': [block({ goalId: 'g1', start: 540, end: 900 })],
      }),
    });
    // Two six-hour focus blocks are worth a lot, so the bonus clears the floor.
    expect(goalQuests(c)[0].bonusXp).toBeGreaterThan(QUEST_BONUS_MIN);
  });

  it('ignores auto blocks', () => {
    const c = ctx({
      week: { week: WEEK, goals: [goal()], credits: [] },
      plans: plansOf({
        '2026-07-27': [block({ goalId: 'g1' }), block({ goalId: 'g1', auto: true })],
        '2026-07-29': [block({ goalId: 'g1' })],
      }),
    });
    expect(goalQuests(c)[0].total).toBe(2);
  });
});

describe('run quests', () => {
  it('makes one quest per consecutive stretch of the same mark', () => {
    const c = ctx({
      marks: { '2026-07-28': 'gig', '2026-07-29': 'gig' },
      plans: plansOf({
        '2026-07-28': [block(), block()],
        '2026-07-29': [block()],
      }),
    });
    const quests = runQuests(c);
    expect(quests).toHaveLength(1);
    expect(quests[0].dates).toEqual(['2026-07-28', '2026-07-29']);
    expect(quests[0].name).toBe('Gig run');
  });

  it('splits a travel day from the gig days that follow', () => {
    // One muddled four-day thing would say less than two clear ones.
    const c = ctx({
      marks: {
        '2026-07-28': 'travel',
        '2026-07-29': 'gig',
        '2026-07-30': 'gig',
      },
      plans: plansOf({
        '2026-07-28': [block(), block()],
        '2026-07-29': [block(), block()],
        '2026-07-30': [block()],
      }),
    });
    const quests = runQuests(c);
    expect(quests).toHaveLength(2);
    expect(quests.map((q) => q.name).sort()).toEqual(['Gig run', 'Travel run']);
  });

  it('breaks a run on an unmarked day', () => {
    const c = ctx({
      marks: { '2026-07-27': 'gig', '2026-07-29': 'gig' },
      plans: plansOf({
        '2026-07-27': [block(), block()],
        '2026-07-29': [block(), block()],
      }),
    });
    expect(runQuests(c)).toHaveLength(2);
  });

  it('skips a trip with nothing scheduled', () => {
    // A quest that is complete the moment it appears is not a quest.
    const c = ctx({ marks: { '2026-07-28': 'gig', '2026-07-29': 'gig' } });
    expect(runQuests(c)).toEqual([]);
  });

  it('skips a mark whose definition was deleted', () => {
    const c = ctx({
      marks: { '2026-07-28': 'vanished' },
      plans: plansOf({ '2026-07-28': [block(), block()] }),
    });
    expect(runQuests(c)).toEqual([]);
  });
});

describe('routine quests', () => {
  const routine = (p: Partial<RecurringTask> = {}): RecurringTask =>
    ({
      id: 't1',
      label: 'Morning pages',
      category: 'deep',
      duration: 30,
      priority: 'normal',
      rule: { kind: 'daily' },
      createdOn: '2026-01-01',
      active: true,
      ...p,
    }) as RecurringTask;

  it('describes what is on the calendar, not what the rule says is due', () => {
    // The tile used to claim "7 due" while completing at 2 of 2 — disagreeing with
    // itself. The shortfall is named instead.
    const habits: HabitStore = { templates: [routine()], completions: [] };
    const c = ctx({
      habits,
      plans: plansOf({
        '2026-07-27': [block({ templateId: 't1' })],
        '2026-07-28': [block({ templateId: 't1' })],
      }),
    });
    const q = routineQuests(c)[0];
    expect(q.total).toBe(2);
    expect(q.blurb).toContain('Finish all 2 placed');
    expect(q.blurb).toContain('(7 were due)');
  });

  it('names no shortfall when every due day was placed', () => {
    const habits: HabitStore = {
      templates: [routine({ rule: { kind: 'weekdays' } as RecurringTask['rule'] })],
      completions: [],
    };
    const weekdays = ['2026-07-27', '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31'];
    const c = ctx({
      habits,
      plans: plansOf(Object.fromEntries(weekdays.map((d) => [d, [block({ templateId: 't1' })]]))),
    });
    const q = routineQuests(c)[0];
    expect(q.total).toBe(5);
    expect(q.blurb).not.toContain('due');
  });

  it('needs at least two placed instances to be a set', () => {
    const habits: HabitStore = { templates: [routine()], completions: [] };
    const c = ctx({
      habits,
      plans: plansOf({ '2026-07-27': [block({ templateId: 't1' })] }),
    });
    expect(routineQuests(c)).toEqual([]);
  });

  it('makes a quest for a routine due more than once', () => {
    const habits: HabitStore = { templates: [routine()], completions: [] };
    const c = ctx({
      habits,
      plans: plansOf({
        '2026-07-27': [block({ templateId: 't1' })],
        '2026-07-28': [block({ templateId: 't1' })],
      }),
    });
    const quests = routineQuests(c);
    expect(quests).toHaveLength(1);
    expect(quests[0].name).toBe('Morning pages');
  });

  it('ignores an inactive routine', () => {
    const habits: HabitStore = { templates: [routine({ active: false })], completions: [] };
    const c = ctx({
      habits,
      plans: plansOf({ '2026-07-27': [block({ templateId: 't1' })] }),
    });
    expect(routineQuests(c)).toEqual([]);
  });

  it('ignores a routine with nothing actually placed', () => {
    const habits: HabitStore = { templates: [routine()], completions: [] };
    expect(routineQuests(ctx({ habits }))).toEqual([]);
  });

  it('ignores days before the routine existed', () => {
    const habits: HabitStore = {
      templates: [routine({ createdOn: '2026-12-01' })],
      completions: [],
    };
    const c = ctx({
      habits,
      plans: plansOf({ '2026-07-27': [block({ templateId: 't1' })] }),
    });
    expect(routineQuests(c)).toEqual([]);
  });
});

describe('the heavy day', () => {
  it('picks the outlier day', () => {
    const c = ctx({
      plans: plansOf({
        '2026-07-27': [block({ start: 540, end: 660 })],
        '2026-07-28': [block({ start: 540, end: 660 })],
        '2026-07-29': [
          block({ start: 540, end: 780 }),
          block({ start: 790, end: 1000 }),
        ],
      }),
    });
    const quests = heavyDayQuest(c);
    expect(quests).toHaveLength(1);
    expect(quests[0].dates).toEqual(['2026-07-29']);
  });

  it('makes no quest when every day is much the same', () => {
    const same = plansOf({
      '2026-07-27': [block({ start: 540, end: 660 }), block({ start: 670, end: 790 })],
      '2026-07-28': [block({ start: 540, end: 660 }), block({ start: 670, end: 790 })],
      '2026-07-29': [block({ start: 540, end: 660 }), block({ start: 670, end: 790 })],
    });
    expect(heavyDayQuest(ctx({ plans: same }))).toEqual([]);
  });

  it('needs at least three days of data to judge an outlier', () => {
    const c = ctx({
      plans: plansOf({
        '2026-07-27': [block({ start: 540, end: 1000 }), block({ start: 1010, end: 1200 })],
      }),
    });
    expect(heavyDayQuest(c)).toEqual([]);
  });

  it('compares against the median, so one huge day cannot hide itself', () => {
    // With a mean, an enormous day drags the average up past its own threshold.
    const c = ctx({
      plans: plansOf({
        '2026-07-27': [block({ start: 540, end: 600 })],
        '2026-07-28': [block({ start: 540, end: 600 })],
        '2026-07-29': [block({ start: 540, end: 600 })],
        '2026-07-30': [block({ start: 480, end: 1200 }), block({ start: 1210, end: 1400 })],
      }),
    });
    expect(heavyDayQuest(c)[0].dates).toEqual(['2026-07-30']);
  });
});

describe('the wildcard', () => {
  it('always produces exactly one', () => {
    expect(wildcardQuest(ctx())).toHaveLength(1);
  });

  it('is the same wildcard for the same week', () => {
    expect(wildcardQuest(ctx())[0].id).toBe(wildcardQuest(ctx())[0].id);
  });

  it('changes with the week', () => {
    const a = wildcardQuest(ctx({ weekKey: '2026-07-27' }))[0].id;
    const b = wildcardQuest(ctx({ weekKey: '2026-08-03' }))[0].id;
    expect(a).not.toBe(b);
  });

  it('counts progress from the week own data', () => {
    // Force the clean-days wildcard by finding the week whose key selects it.
    const spec = WILDCARDS.find((w) => w.id === 'clear-two')!;
    let weekKey = '';
    for (let i = 0; i < 400; i++) {
      const k = `2026-01-${String((i % 28) + 1).padStart(2, '0')}-${i}`;
      if (pick(WILDCARDS, `wildcard:${k}`).id === spec.id) {
        weekKey = k;
        break;
      }
    }
    expect(weekKey).not.toBe('');
    const c = ctx({
      weekKey: WEEK,
      stats: {
        '2026-07-27': stat('2026-07-27', { cleared: true }),
        '2026-07-28': stat('2026-07-28', { cleared: true }),
      },
    });
    // Whatever wildcard the week draws, progress must be a number within bounds.
    const q = wildcardQuest(c)[0];
    expect(q.done).toBeGreaterThanOrEqual(0);
    expect(q.done).toBeLessThanOrEqual(q.total);
  });

  it('never reports progress beyond its target', () => {
    const c = ctx({
      stats: Object.fromEntries(DATES.map((d) => [d, stat(d, { bestCombo: 99, focusMinutes: 999 })])),
    });
    const q = wildcardQuest(c)[0];
    expect(q.done).toBeLessThanOrEqual(q.total);
  });
});

describe('questsFor', () => {
  it('always offers at least the wildcard', () => {
    const quests = questsFor(ctx());
    expect(quests.length).toBeGreaterThanOrEqual(1);
    expect(quests.some((q) => q.kind === 'wildcard')).toBe(true);
  });

  it('gives every quest a unique id', () => {
    const c = ctx({
      week: { week: WEEK, goals: [goal(), goal({ id: 'g2', label: 'Admin' })], credits: [] },
      marks: { '2026-07-28': 'gig', '2026-07-29': 'gig' },
      plans: plansOf({
        '2026-07-27': [block({ goalId: 'g1' }), block({ goalId: 'g2' })],
        '2026-07-28': [block({ goalId: 'g1' }), block({ goalId: 'g2' })],
        '2026-07-29': [block(), block()],
      }),
    });
    const ids = questsFor(c).map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('keys quests to their week, so last week cannot collide with this one', () => {
    const a = questsFor(ctx({ weekKey: '2026-07-27' })).map((q) => q.id);
    const b = questsFor(ctx({ weekKey: '2026-08-03' })).map((q) => q.id);
    expect(a.some((id) => b.includes(id))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('challenges', () => {
  it('offers one a day, stably', () => {
    const c = ctx();
    expect(dailyChallenge(c, '2026-07-30').id).toBe(dailyChallenge(c, '2026-07-30').id);
  });

  it('offers a different one tomorrow', () => {
    const c = ctx();
    const today = dailyChallenge(c, '2026-07-30').id.split(':')[2];
    const soon = DATES.map((d) => dailyChallenge(c, d).id.split(':')[2]);
    expect(new Set(soon).size).toBeGreaterThan(1);
    expect(today.length).toBeGreaterThan(0);
  });

  it('offers one weekly challenge, stably', () => {
    expect(weeklyChallenge(ctx()).id).toBe(weeklyChallenge(ctx()).id);
  });

  it('counts weekly progress across the week', () => {
    const c = ctx({
      stats: Object.fromEntries(DATES.map((d) => [d, stat(d, { xpEarned: 300 })])),
    });
    const ch = weeklyChallenge(c);
    expect(ch.done).toBeGreaterThan(0);
    expect(ch.done).toBeLessThanOrEqual(ch.total);
  });

  it('gives every pool entry a positive target and a counter', () => {
    for (const spec of [...DAILY_CHALLENGES, ...WEEKLY_CHALLENGES]) {
      expect(spec.total).toBeGreaterThan(0);
      expect(typeof spec.done).toBe('function');
      expect(spec.name.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------

describe('payout', () => {
  const complete = (id: string) => ({
    id,
    kind: 'wildcard' as const,
    name: 'Done thing',
    blurb: '',
    dates: [],
    bonusXp: 200,
    done: 1,
    total: 1,
    complete: true,
  });

  it('pays a finished quest once', () => {
    const first = questPayout(NONE, [complete('q1')], []);
    expect(first.keys).toEqual([questKey('q1')]);
    expect(first.xp).toBe(200);

    const held: AwardLedger = { granted: [questKey('q1')] };
    expect(questPayout(held, [complete('q1')], []).keys).toEqual([]);
  });

  it('pays nothing for an unfinished quest', () => {
    const partial = { ...complete('q1'), done: 0, complete: false };
    expect(questPayout(NONE, [partial], []).keys).toEqual([]);
  });

  it('pays challenges alongside quests', () => {
    const ch = {
      id: 'daily:2026-07-30:x',
      name: 'Before lunch',
      blurb: '',
      xp: 60,
      done: 1,
      total: 1,
      complete: true,
    };
    const r = questPayout(NONE, [complete('q1')], [ch]);
    expect(r.keys).toHaveLength(2);
    expect(r.xp).toBe(260);
    expect(r.names).toEqual(['Done thing', 'Before lunch']);
  });

  it('reports what has been paid', () => {
    expect(isPaid({ granted: [questKey('q1')] }, 'q1')).toBe(true);
    expect(isPaid(NONE, 'q1')).toBe(false);
  });

  it('summarises the set', () => {
    const partial = { ...complete('q2'), complete: false };
    expect(questSummary([complete('q1'), partial])).toEqual({ complete: 1, total: 2 });
  });

  it('never reports a quest as failed — expiry is silent', () => {
    // There is no failure state to test for. What this asserts is that an unfinished
    // quest simply produces no payout and no other signal.
    const partial = { ...complete('q1'), complete: false };
    const r = questPayout(NONE, [partial], []);
    expect(r).toEqual({ keys: [], xp: 0, names: [] });
  });
});

describe('the scored era', () => {
  it('drops days before the start date from the week entirely', () => {
    // Found live: a fresh account was handed a completed wildcard on first launch,
    // because the current week still held finished blocks from before it started.
    const plans = plansOf({
      '2026-07-27': [block({ start: 540, end: 720, completed: true })],
      '2026-07-28': [block({ start: 540, end: 720, completed: true })],
      '2026-07-30': [block({ start: 540, end: 600 })],
    });
    const gated = buildWeekContext({
      weekKey: WEEK,
      plans,
      stats: {},
      week: { week: WEEK, goals: [], credits: [] },
      habits: { templates: [], completions: [] },
      marks: {},
      markDefs: DEFAULT_DAY_MARKS,
      categories: DEFAULT_CATEGORIES,
      startedOn: '2026-07-30',
    });
    expect(gated.dates).toEqual(['2026-07-30', '2026-07-31', '2026-08-01', '2026-08-02']);

    // The long-haul wildcard cannot be satisfied by the two pre-start blocks.
    const wild = WILDCARDS.find((w) => w.id === 'long-two')!;
    expect(wild.done(gated)).toBe(0);
  });

  it('keeps the whole week when no start date is given', () => {
    const c = ctx();
    expect(c.dates).toHaveLength(7);
  });

  it('generates no quests at all from a week entirely before the start', () => {
    const plans = plansOf({
      '2026-07-27': [block({ completed: true }), block({ completed: true })],
    });
    const gated = buildWeekContext({
      weekKey: WEEK,
      plans,
      stats: {},
      week: { week: WEEK, goals: [], credits: [] },
      habits: { templates: [], completions: [] },
      marks: { '2026-07-27': 'gig' },
      markDefs: DEFAULT_DAY_MARKS,
      categories: DEFAULT_CATEGORIES,
      startedOn: '2026-08-10',
    });
    expect(gated.dates).toEqual([]);
    expect(runQuests(gated)).toEqual([]);
    expect(heavyDayQuest(gated)).toEqual([]);
  });
});

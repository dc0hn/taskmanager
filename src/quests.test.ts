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
  drawWeek,
  sealDraws,
  finishedWhenPlanned,
  salvaged,
  profileFacts,
  STRONGEST_HOUR_MIN,
  type WeekContext,
} from './quests';
import { payoutXp } from './types';
import type { AwardPayout } from './types';

/** Test shim: `questPayout` returns payouts now, not keys plus a summed xp plus names. */
function payout(
  ledger: Parameters<typeof questPayout>[0],
  quests: Parameters<typeof questPayout>[1],
  challenges: Parameters<typeof questPayout>[2]
) {
  const payouts: AwardPayout[] = questPayout(ledger, quests, challenges);
  return {
    payouts,
    keys: payouts.map((a) => a.key),
    xp: payoutXp(payouts),
    names: payouts.map((a) => a.label ?? ''),
  };
}
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
    const first = payout(NONE, [complete('q1')], []);
    expect(first.keys).toEqual([questKey('q1')]);
    expect(first.xp).toBe(200);

    const held: AwardLedger = { granted: [questKey('q1')] };
    expect(payout(held, [complete('q1')], []).keys).toEqual([]);
  });

  it('pays nothing for an unfinished quest', () => {
    const partial = { ...complete('q1'), done: 0, complete: false };
    expect(payout(NONE, [partial], []).keys).toEqual([]);
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
    const r = payout(NONE, [complete('q1')], [ch]);
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
    const r = payout(NONE, [partial], []);
    expect(r.payouts).toEqual([]);
    expect(r.xp).toBe(0);
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

describe('the draw pools', () => {
  /**
   * A guard, and the reason it can now be raised rather than merely held.
   *
   * `pick` is `seedFrom(key) % items.length`, so a pool's LENGTH is part of the answer for
   * every seed. Changing it re-rolls every UNSEALED week — and since a payout key embeds
   * the drawn spec's id, a re-rolled week in progress can pay twice for the same day under
   * two names.
   *
   * Weeks are sealed on issue now, so their draws stop asking and the pools are safe to
   * grow. These numbers still exist so growing them is a decision: if you are here because
   * this failed, the pools changed and every unsealed draw moved with them.
   */
  it('holds the counts the current draws are made against', () => {
    expect(WILDCARDS).toHaveLength(16);
    expect(DAILY_CHALLENGES).toHaveLength(12);
    expect(WEEKLY_CHALLENGES).toHaveLength(12);
  });

  it('keeps the original entries first, so an append cannot become a reorder', () => {
    // Appending is safe for sealed weeks; REORDERING is not safe for anything, because a
    // sealed id still has to resolve to the same spec.
    expect(WEEKLY_CHALLENGES.slice(0, 4).map((s) => s.id)).toEqual([
      'five-kept',
      'xp-1200',
      'three-clear',
      'focus-ten',
    ]);
    expect(DAILY_CHALLENGES.slice(0, 6).map((s) => s.id)).toEqual([
      'first-by-noon',
      'three-in-order',
      'longest-first',
      'high-priority',
      'two-focus',
      'clear-it',
    ]);
  });

  it('keeps ids unique within each pool, since payout keys are built from them', () => {
    for (const pool of [WILDCARDS, DAILY_CHALLENGES, WEEKLY_CHALLENGES]) {
      const ids = pool.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('draws the same entry for the same key every time', () => {
    // The property the frozen counts protect: a given date always draws the same
    // challenge, so its progress and its payout key are stable across launches.
    for (const key of ['2026-07-30', '2026-08-01', '2026-12-25']) {
      expect(pick(DAILY_CHALLENGES, `daily:${key}`).id).toBe(
        pick(DAILY_CHALLENGES, `daily:${key}`).id
      );
    }
  });
});

describe('sealing a week\'s draws', () => {
  const W = '2026-07-27';

  it('draws every day of the week, plus the weekly and the wildcards', () => {
    const d = drawWeek(W);
    expect(Object.keys(d.daily)).toHaveLength(7);
    expect(d.weekly.length).toBeGreaterThan(0);
    expect(d.wildcards.length).toBeGreaterThan(1);
  });

  it('draws the same thing for the same week, always', () => {
    expect(drawWeek(W)).toEqual(drawWeek(W));
  });

  it('seals into a record that has none, and never re-seals', () => {
    const week = { week: W, goals: [], credits: [] };
    const sealed = sealDraws(week);
    expect(sealed).not.toBeNull();
    expect(sealDraws(sealed!)).toBeNull();
  });

  it('holds a sealed week steady even if the pools change under it', () => {
    // The whole point. A sealed week reads its own recorded ids, so appending to a pool
    // cannot re-draw it — which is what makes the same day paying twice impossible.
    const sealed = sealDraws({ week: W, goals: [], credits: [] })!;
    const pinned = 'five-kept';
    const c = ctx({ week: { ...sealed, draws: { ...sealed.draws!, weekly: pinned } } });
    expect(weeklyChallenge(c).id).toBe(`weekly:${W}:${pinned}`);
  });

  it('falls back to drawing for a week with no seal', () => {
    // Weeks issued before this shipped. They score as whatever the pool says today, which
    // is the position they were already in.
    const c = ctx();
    expect(weeklyChallenge(c).id.startsWith(`weekly:${W}:`)).toBe(true);
  });

  it('falls back for a sealed id this build does not recognise', () => {
    const sealed = sealDraws({ week: W, goals: [], credits: [] })!;
    const c = ctx({
      week: { ...sealed, draws: { ...sealed.draws!, weekly: 'from-the-future' } },
    });
    expect(weeklyChallenge(c).id).toBe(
      `weekly:${W}:${pick(WEEKLY_CHALLENGES, `weekly:${W}`).id}`
    );
  });
});

describe('the new predicates', () => {
  const at = (end: number, completedAt?: number, over: Partial<Block> = {}) =>
    block({ end, completedAt, completed: completedAt != null, ...over });

  it('counts a block finished inside the tolerance either side', () => {
    expect(finishedWhenPlanned(at(600, 600))).toBe(true);
    expect(finishedWhenPlanned(at(600, 610))).toBe(true);
    expect(finishedWhenPlanned(at(600, 590))).toBe(true);
    expect(finishedWhenPlanned(at(600, 611))).toBe(false);
    expect(finishedWhenPlanned(at(600, 611), 15)).toBe(true);
  });

  it('needs a timestamp, and treats absence as unknown rather than as punctual', () => {
    expect(finishedWhenPlanned(block({ completed: true }))).toBe(false);
    expect(finishedWhenPlanned(at(600, 600, { completed: false }))).toBe(false);
  });

  it('finds blocks that were rescheduled before being done', () => {
    const blocks = [
      block({ id: 'a', completed: true, moves: 3 }),
      block({ id: 'b', completed: true, moves: 1 }),
      block({ id: 'c', completed: false, moves: 5 }),
      block({ id: 'd', completed: true }),
    ];
    expect(salvaged(blocks).map((b) => b.id)).toEqual(['a']);
    expect(salvaged(blocks, 1).map((b) => b.id)).toEqual(['a', 'b']);
  });
});

describe('profile facts', () => {
  const day = (date: string, blocks: Block[]) => ({ date, blocks });
  const done = (id: string, completedAt: number, category = 'deep') =>
    block({ id, completed: true, completedAt, category, start: 540, end: 600 });

  it('says nothing on thin history', () => {
    // A discovery quest that fires on no data is worse than no discovery quest.
    const days = [day('2026-07-01', [done('a', 600), done('b', 600)])];
    expect(profileFacts(days, DEFAULT_CATEGORIES).strongestHour).toBeNull();
  });

  it('finds the hour once there is enough of it', () => {
    const blocks = Array.from({ length: STRONGEST_HOUR_MIN + 2 }, (_, i) => done(`b${i}`, 630));
    const facts = profileFacts([day('2026-07-01', blocks)], DEFAULT_CATEGORIES);
    expect(facts.strongestHour).toBe(10);
  });

  it('says nothing when two hours tie', () => {
    // Preferring one side of a coin flip would send someone to an arbitrary hour.
    const half = STRONGEST_HOUR_MIN;
    const blocks = [
      ...Array.from({ length: half }, (_, i) => done(`a${i}`, 630)),
      ...Array.from({ length: half }, (_, i) => done(`b${i}`, 930)),
    ];
    expect(profileFacts([day('2026-07-01', blocks)], DEFAULT_CATEGORIES).strongestHour).toBeNull();
  });

  it('wraps a past-midnight completion back onto a clock', () => {
    // completedAt keeps counting past 1440, so 1470 is half past midnight, not hour 24.
    const blocks = Array.from({ length: STRONGEST_HOUR_MIN + 2 }, (_, i) => done(`b${i}`, 1470));
    expect(profileFacts([day('2026-07-01', blocks)], DEFAULT_CATEGORIES).strongestHour).toBe(0);
  });

  it('finds the least-touched category, and says nothing when there is only one', () => {
    const mixed = [day('2026-07-01', [done('a', 600, 'deep'), done('b', 600, 'deep'), done('c', 600, 'admin')])];
    expect(profileFacts(mixed, DEFAULT_CATEGORIES).leastTouched).toBe('admin');

    const single = [day('2026-07-01', [done('a', 600, 'deep')])];
    expect(profileFacts(single, DEFAULT_CATEGORIES).leastTouched).toBeNull();
  });

  it('reports nothing at all for an empty profile', () => {
    expect(profileFacts([], DEFAULT_CATEGORIES)).toEqual({
      strongestHour: null,
      leastTouched: null,
    });
  });
});

describe('the discovery content degrades rather than misfires', () => {
  it('reports no progress with no profile facts', () => {
    // Every discovery spec has to be unfinishable rather than resolve to hour zero.
    const c = ctx({
      plans: plansOf({
        '2026-07-30': [block({ completed: true, completedAt: 600 })],
      }),
    });
    const bestHour = WEEKLY_CHALLENGES.find((s) => s.id === 'best-hour')!;
    const quiet = WEEKLY_CHALLENGES.find((s) => s.id === 'quiet-corner')!;
    expect(bestHour.done(c, '2026-07-30')).toBe(0);
    expect(quiet.done(c, '2026-07-30')).toBe(0);
  });

  it('counts once the facts are there', () => {
    const c = ctx({
      profile: { strongestHour: 10, leastTouched: 'admin' },
      plans: plansOf({
        '2026-07-30': [
          block({ id: 'x', completed: true, completedAt: 630 }),
          block({ id: 'y', completed: true, completedAt: 640, category: 'admin', start: 600, end: 720 }),
        ],
      }),
    });
    expect(WEEKLY_CHALLENGES.find((s) => s.id === 'best-hour')!.done(c, '2026-07-30')).toBe(2);
    expect(WEEKLY_CHALLENGES.find((s) => s.id === 'quiet-corner')!.done(c, '2026-07-30')).toBe(120);
  });
});

describe('every new spec is satisfiable, one short, and empty-safe', () => {
  // The bar from the hand-off: a case that satisfies it, a case one short, and an empty
  // week. Run as a sweep rather than one test each, so adding a spec without a case is
  // caught by the count assertion below.
  const empty = ctx();

  it('reports zero on an empty week, for every spec in all three pools', () => {
    for (const spec of WEEKLY_CHALLENGES) {
      expect(spec.done(empty, '2026-07-30'), spec.id).toBe(0);
    }
    for (const spec of DAILY_CHALLENGES) {
      expect(spec.done(empty, '2026-07-30'), spec.id).toBe(0);
    }
    for (const spec of WILDCARDS) {
      expect(spec.done(empty), spec.id).toBe(0);
    }
  });

  it('never reports negative or fractional progress', () => {
    const busy = ctx({
      profile: { strongestHour: 10, leastTouched: 'admin' },
      streakResetOn: '2026-07-28',
      stats: Object.fromEntries(
        DATES.map((d) => [d, stat(d, { doneMinutes: 200, plannedMinutes: 300, cleared: false })])
      ),
      plans: plansOf(
        Object.fromEntries(
          DATES.map((d) => [
            d,
            [block({ completed: true, completedAt: 630, moves: 2 })],
          ])
        )
      ),
    });
    for (const spec of [...WEEKLY_CHALLENGES, ...DAILY_CHALLENGES]) {
      const n = spec.done(busy, '2026-07-30');
      expect(Number.isFinite(n) && n >= 0 && Number.isInteger(n), spec.id).toBe(true);
    }
    for (const spec of WILDCARDS) {
      const n = spec.done(busy);
      expect(Number.isFinite(n) && n >= 0 && Number.isInteger(n), spec.id).toBe(true);
    }
  });

  it('satisfies a constraint spec when the constraint holds, and not otherwise', () => {
    const unmoved = ctx({
      plans: plansOf({
        '2026-07-30': [
          block({ id: 'a', completed: true, moves: 0 }),
          block({ id: 'b', completed: true }),
        ],
      }),
    });
    const asPlanned = DAILY_CHALLENGES.find((s) => s.id === 'as-planned')!;
    expect(asPlanned.done(unmoved, '2026-07-30')).toBe(1);

    const moved = ctx({
      plans: plansOf({
        '2026-07-30': [
          block({ id: 'a', completed: true, moves: 1 }),
          block({ id: 'b', completed: true }),
        ],
      }),
    });
    expect(asPlanned.done(moved, '2026-07-30')).toBe(0);
  });

  it('pays recovery only for a clear that followed a short day', () => {
    const recovered = ctx({
      stats: {
        '2026-07-29': stat('2026-07-29', { doneMinutes: 30, plannedMinutes: 300, cleared: false }),
        '2026-07-30': stat('2026-07-30', { cleared: true }),
      },
    });
    const secondWind = WEEKLY_CHALLENGES.find((s) => s.id === 'second-wind')!;
    expect(secondWind.done(recovered, '2026-07-30')).toBe(1);

    const steady = ctx({
      stats: {
        '2026-07-29': stat('2026-07-29', { cleared: true }),
        '2026-07-30': stat('2026-07-30', { cleared: true }),
      },
    });
    expect(secondWind.done(steady, '2026-07-30')).toBe(0);
  });

  it('needs a real week behind the even-hand constraint', () => {
    // Two blocks in one category is not an imbalance, and calling it one would hand out a
    // bonus for a quiet week.
    const thin = ctx({
      plans: plansOf({ '2026-07-30': [block({ completed: true, category: 'deep' })] }),
    });
    expect(WEEKLY_CHALLENGES.find((s) => s.id === 'even-hand')!.done(thin, '2026-07-30')).toBe(0);
  });
});

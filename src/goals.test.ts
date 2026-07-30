import { describe, it, expect } from 'vitest';
import {
  addCredit,
  buildWeekReview,
  carryoverByCategory,
  creditFor,
  dropFromCarryover,
  emptyWeek,
  goalProgress,
  isSealed,
  issueRecurringGoals,
  openGoals,
  pruneCredits,
  pullFromCarryover,
  reconcileCredits,
  removeCredit,
  resizeCarryover,
  resolveElapsedWeeks,
  setVoided,
  staleCarryover,
  advanceRun,
  goalRunKey,
  goalRunPayouts,
  goalRunXp,
} from './goals';
import { DEFAULT_CATEGORIES } from './types';
import type { Block, CarryoverItem, GoalCredit, WeeklyGoal, WeekRecord } from './types';

const W1 = '2026-07-06';
const W2 = '2026-07-13';
const W3 = '2026-07-20';
const NOW_WEEK = '2026-07-27';

const goal = (over: Partial<WeeklyGoal> = {}): WeeklyGoal => ({
  id: 'g1',
  label: 'Practice guitar',
  category: 'deep',
  targetKind: 'sessions',
  target: 3,
  sessionMinutes: 45,
  cadence: 'oneOff',
  active: true,
  deferrals: 0,
  originWeek: W1,
  ...over,
});

const weekly = (over: Partial<WeeklyGoal> = {}): WeeklyGoal =>
  goal({ cadence: 'weekly', ...over });

const credit = (over: Partial<GoalCredit> = {}): GoalCredit => ({
  goalId: 'g1',
  blockId: 'b1',
  date: '2026-07-06',
  minutes: 45,
  ...over,
});

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  title: 'Practice guitar',
  start: 540,
  end: 585,
  category: 'deep',
  ...over,
});

const week = (over: Partial<WeekRecord> = {}): WeekRecord => ({
  week: W1,
  goals: [],
  credits: [],
  ...over,
});

// ---------------------------------------------------------------------------

describe('goalProgress', () => {
  it('reports a missed goal with no credits', () => {
    const p = goalProgress(goal(), []);
    expect(p).toMatchObject({ sessions: 0, minutes: 0, done: 0, target: 3, outcome: 'missed' });
  });

  it('reports a partial goal', () => {
    const p = goalProgress(goal(), [credit()]);
    expect(p).toMatchObject({ sessions: 1, minutes: 45, done: 1, outcome: 'partial' });
  });

  it('reports a met goal when the target is reached', () => {
    const p = goalProgress(goal({ target: 2 }), [
      credit({ blockId: 'b1', date: '2026-07-06' }),
      credit({ blockId: 'b2', date: '2026-07-07' }),
    ]);
    expect(p.outcome).toBe('met');
  });

  it('counts overshoot as met, not partial', () => {
    const p = goalProgress(goal({ target: 1 }), [
      credit({ blockId: 'b1', date: '2026-07-06' }),
      credit({ blockId: 'b2', date: '2026-07-07' }),
    ]);
    expect(p.sessions).toBe(2);
    expect(p.outcome).toBe('met');
  });

  it('ignores credits belonging to other goals', () => {
    const p = goalProgress(goal(), [credit({ goalId: 'other', blockId: 'x' })]);
    expect(p.done).toBe(0);
  });

  // The chunking case: the scheduler splits focus work over 120 min into
  // ~90-min chunks that share a goalId. Counting blocks would double-credit.
  it('counts one session per day even when work was split into chunks', () => {
    const p = goalProgress(goal(), [
      credit({ blockId: 'b1-c1', date: '2026-07-06', minutes: 60 }),
      credit({ blockId: 'b1-c2', date: '2026-07-06', minutes: 60 }),
    ]);
    expect(p.sessions).toBe(1);
    expect(p.minutes).toBe(120); // minutes still sum in full
    expect(p.outcome).toBe('partial');
  });

  it('sums minutes across days for a minutes-target goal', () => {
    const p = goalProgress(goal({ targetKind: 'minutes', target: 180 }), [
      credit({ blockId: 'b1', date: '2026-07-06', minutes: 90 }),
      credit({ blockId: 'b2', date: '2026-07-08', minutes: 90 }),
    ]);
    expect(p.done).toBe(180);
    expect(p.outcome).toBe('met');
  });

  it('treats a zero or negative target as 1 rather than dividing by nothing', () => {
    expect(goalProgress(goal({ target: 0 }), [credit()]).outcome).toBe('met');
  });
});

describe('openGoals', () => {
  it('excludes goals that are already met', () => {
    const w = week({
      goals: [goal({ id: 'a', target: 1 }), goal({ id: 'b', target: 5 })],
      credits: [credit({ goalId: 'a', blockId: 'b1' })],
    });
    expect(openGoals(w).map((p) => p.goal.id)).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------

describe('crediting', () => {
  it('builds a credit from a completed goal block', () => {
    expect(creditFor(block({ goalId: 'g1' }), '2026-07-06')).toEqual({
      goalId: 'g1',
      blockId: 'b1',
      date: '2026-07-06',
      minutes: 45,
    });
  });

  it('produces nothing for a block with no goal', () => {
    expect(creditFor(block(), '2026-07-06')).toBeNull();
  });

  it('refuses a zero-length block', () => {
    expect(creditFor(block({ goalId: 'g1', start: 540, end: 540 }), '2026-07-06')).toBeNull();
  });

  it('is idempotent — adding the same block twice credits once', () => {
    let credits: GoalCredit[] = [];
    credits = addCredit(credits, credit());
    credits = addCredit(credits, credit());
    expect(credits).toHaveLength(1);
  });

  it('replaces a credit when the block is resized', () => {
    let credits = addCredit([], credit({ minutes: 45 }));
    credits = addCredit(credits, credit({ minutes: 90 }));
    expect(credits).toHaveLength(1);
    expect(credits[0].minutes).toBe(90);
  });

  it('un-ticking removes the credit with no drift', () => {
    const credits = removeCredit([credit()], 'b1');
    expect(credits).toEqual([]);
    expect(goalProgress(goal(), credits).outcome).toBe('missed');
  });

  it('round-trips tick/untick back to the starting state', () => {
    const start: GoalCredit[] = [];
    const ticked = addCredit(start, credit());
    const unticked = removeCredit(ticked, 'b1');
    expect(unticked).toEqual(start);
  });
});

describe('reconcileCredits', () => {
  it('credits only completed goal blocks', () => {
    const blocks = [
      block({ id: 'b1', goalId: 'g1', completed: true }),
      block({ id: 'b2', goalId: 'g1', completed: false }),
      block({ id: 'b3', completed: true }), // no goal
    ];
    const credits = reconcileCredits([], '2026-07-06', blocks);
    expect(credits.map((c) => c.blockId)).toEqual(['b1']);
  });

  it('drops credits for blocks that were deleted', () => {
    const stale = [credit({ blockId: 'gone', date: '2026-07-06' })];
    const credits = reconcileCredits(stale, '2026-07-06', []);
    expect(credits).toEqual([]);
  });

  it('leaves other days untouched', () => {
    const other = credit({ blockId: 'x', date: '2026-07-08' });
    const credits = reconcileCredits([other], '2026-07-06', []);
    expect(credits).toEqual([other]);
  });

  it('picks up a resize', () => {
    const before = reconcileCredits([], '2026-07-06', [
      block({ goalId: 'g1', completed: true, start: 540, end: 585 }),
    ]);
    expect(before[0].minutes).toBe(45);
    const after = reconcileCredits(before, '2026-07-06', [
      block({ goalId: 'g1', completed: true, start: 540, end: 660 }),
    ]);
    expect(after).toHaveLength(1);
    expect(after[0].minutes).toBe(120);
  });
});

// ---------------------------------------------------------------------------

describe('resolveElapsedWeeks', () => {
  it('does nothing when there are no elapsed weeks', () => {
    const result = resolveElapsedWeeks(NOW_WEEK, [], []);
    expect(result.changed).toBe(false);
    expect(result.resolved).toEqual([]);
  });

  it('leaves the current week alone', () => {
    const w = week({ week: NOW_WEEK, goals: [goal()] });
    const result = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(result.changed).toBe(false);
    expect(result.carryover).toEqual([]);
  });

  it('defers a missed goal into carryover with one deferral', () => {
    const w = week({ week: W3, goals: [goal()] });
    const { carryover, resolved } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover).toHaveLength(1);
    expect(carryover[0].goal.deferrals).toBe(1);
    expect(carryover[0].lastWeek).toBe(W3);
    expect(carryover[0].lastProgress).toEqual({ done: 0, target: 3 });
    expect(resolved[0].resolved).toBe(true);
  });

  it('defers a partially met goal and records how close it got', () => {
    const w = week({
      week: W3,
      goals: [goal()],
      credits: [credit({ date: '2026-07-20' })],
    });
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover[0].lastProgress).toEqual({ done: 1, target: 3 });
    expect(carryover[0].goal.deferrals).toBe(1);
  });

  it('carries the residual, not the original target', () => {
    const w = week({
      week: W3,
      goals: [goal({ target: 3 })],
      credits: [credit({ date: '2026-07-20' })], // 1 of 3 done
    });
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover[0].residual).toBe(2);
    expect(carryover[0].lastProgress).toEqual({ done: 1, target: 3 });
  });

  it('carries the full target when nothing was done', () => {
    const w = week({ week: W3, goals: [goal({ target: 3 })] });
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover[0].residual).toBe(3);
  });

  it('carries the residual in minutes for a minutes-target goal', () => {
    const w = week({
      week: W3,
      goals: [goal({ targetKind: 'minutes', target: 120 })],
      credits: [credit({ date: '2026-07-20', minutes: 40 })],
    });
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover[0].residual).toBe(80);
  });

  // The rule most likely to be "simplified" into summation by a future change.
  it('consolidates a repeat slip with max(), never a sum', () => {
    const first = resolveElapsedWeeks(
      W2,
      [week({ week: W1, goals: [goal({ target: 3 })] })],
      []
    );
    expect(first.carryover[0].residual).toBe(3);

    // Slips again, this time having done one session — residual 2.
    const second = resolveElapsedWeeks(
      NOW_WEEK,
      [
        week({
          week: W3,
          goals: [goal({ target: 3, deferrals: 1 })],
          credits: [credit({ date: '2026-07-20' })],
        }),
      ],
      first.carryover
    );
    expect(second.carryover).toHaveLength(1);
    expect(second.carryover[0].residual).toBe(3); // max(3, 2) — not 5
    expect(second.carryover[0].goal.deferrals).toBe(2);
  });

  it('records how long an item has been sitting in the pile', () => {
    const first = resolveElapsedWeeks(
      W2,
      [week({ week: W1, goals: [goal()] })],
      []
    );
    const second = resolveElapsedWeeks(
      NOW_WEEK,
      [week({ week: W3, goals: [goal({ deferrals: 1 })] })],
      first.carryover
    );
    expect(second.carryover[0].firstDeferredWeek).toBe(W1);
    expect(second.carryover[0].lastWeek).toBe(W3);
  });

  it('does not defer a met goal', () => {
    const w = week({
      week: W3,
      goals: [goal({ target: 1 })],
      credits: [credit({ date: '2026-07-20' })],
    });
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover).toEqual([]);
  });

  // The test that protects the whole design.
  it('is idempotent — running three times changes nothing after the first', () => {
    const w = week({ week: W3, goals: [goal()] });
    const first = resolveElapsedWeeks(NOW_WEEK, [w], []);
    const second = resolveElapsedWeeks(NOW_WEEK, first.resolved, first.carryover);
    const third = resolveElapsedWeeks(NOW_WEEK, first.resolved, second.carryover);

    expect(second.changed).toBe(false);
    expect(third.changed).toBe(false);
    expect(JSON.stringify(second.carryover)).toBe(JSON.stringify(first.carryover));
    expect(JSON.stringify(third.carryover)).toBe(JSON.stringify(first.carryover));
    expect(third.carryover[0].goal.deferrals).toBe(1);
  });

  // A long absence must not fabricate records for weeks that hold no data.
  it('resolves only the weeks that actually exist across a nine-week gap', () => {
    const weeks = [
      week({ week: '2026-05-25', goals: [goal({ id: 'a' })] }),
      week({ week: '2026-07-13', goals: [goal({ id: 'b' })] }),
    ];
    const { resolved, carryover } = resolveElapsedWeeks(NOW_WEEK, weeks, []);
    expect(resolved).toHaveLength(2);
    expect(resolved.map((w) => w.week)).toEqual(['2026-05-25', '2026-07-13']);
    expect(carryover.map((c) => c.goal.id).sort()).toEqual(['a', 'b']);
  });

  // The reason weeks must be processed in ascending order.
  it('accumulates one deferral per slipped week across a multi-week absence', () => {
    const weeks = [
      week({ week: W1, goals: [goal()] }),
      week({ week: W2, goals: [goal()] }),
      week({ week: W3, goals: [goal()] }),
    ];
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, weeks, []);
    expect(carryover).toHaveLength(1);
    expect(carryover[0].goal.deferrals).toBe(3);
    expect(carryover[0].lastWeek).toBe(W3);
  });

  it('accumulates in order even when the input array is shuffled', () => {
    const weeks = [
      week({ week: W3, goals: [goal()] }),
      week({ week: W1, goals: [goal()] }),
      week({ week: W2, goals: [goal()] }),
    ];
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, weeks, []);
    expect(carryover[0].goal.deferrals).toBe(3);
    expect(carryover[0].lastWeek).toBe(W3);
  });

  it('resolves several weeks in one pass', () => {
    const weeks = [
      week({ week: W1, goals: [goal({ id: 'a' })] }),
      week({ week: W2, goals: [goal({ id: 'b' })] }),
    ];
    const { resolved, carryover } = resolveElapsedWeeks(NOW_WEEK, weeks, []);
    expect(resolved).toHaveLength(2);
    expect(resolved.every((w) => w.resolved)).toBe(true);
    expect(carryover.map((c) => c.goal.id).sort()).toEqual(['a', 'b']);
  });

  it('skips weeks already resolved', () => {
    const weeks = [
      week({ week: W1, goals: [goal()], resolved: true }),
      week({ week: W3, goals: [goal({ id: 'g2' })] }),
    ];
    const { resolved } = resolveElapsedWeeks(NOW_WEEK, weeks, []);
    expect(resolved.map((w) => w.week)).toEqual([W3]);
  });

  it('preserves a deferral count inherited by the week record', () => {
    const w = week({ week: W3, goals: [goal({ deferrals: 5 })] });
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover[0].goal.deferrals).toBe(6);
  });

  it('resolves a week with no goals without touching carryover', () => {
    const { resolved, carryover } = resolveElapsedWeeks(NOW_WEEK, [week({ week: W3 })], []);
    expect(resolved).toHaveLength(1);
    expect(carryover).toEqual([]);
  });

  // Rollover across a year boundary — the case most likely to be wrong.
  it('rolls over across the year boundary', () => {
    // Week of Mon 2025-12-29 (contains New Year's Day 2026) into Mon 2026-01-05.
    const weeks = [week({ week: '2025-12-29', goals: [goal({ originWeek: '2025-12-29' })] })];
    const { carryover, resolved } = resolveElapsedWeeks('2026-01-05', weeks, []);
    expect(resolved).toHaveLength(1);
    expect(carryover[0].goal.deferrals).toBe(1);
    expect(carryover[0].lastWeek).toBe('2025-12-29');
  });

  it('accumulates deferrals across a year boundary in the right order', () => {
    const weeks = [
      week({ week: '2026-12-14', goals: [goal()] }),
      week({ week: '2026-12-21', goals: [goal()] }),
      week({ week: '2026-12-28', goals: [goal()] }), // ISO 2026-W53
    ];
    const { carryover } = resolveElapsedWeeks('2027-01-04', weeks, []);
    expect(carryover[0].goal.deferrals).toBe(3);
    expect(carryover[0].lastWeek).toBe('2026-12-28');
  });

  it('sorts week keys correctly across the year edge', () => {
    // Lexicographic sort must put December 2026 before January 2027.
    const weeks = [
      week({ week: '2027-01-04', goals: [goal()] }),
      week({ week: '2026-12-28', goals: [goal()] }),
    ];
    const { carryover } = resolveElapsedWeeks('2027-01-11', weeks, []);
    expect(carryover[0].lastWeek).toBe('2027-01-04');
    expect(carryover[0].goal.deferrals).toBe(2);
  });
});

// ---------------------------------------------------------------------------

describe('weekly cadence', () => {
  it('does not put a slipped weekly goal in the pile', () => {
    // It is reissued at full target instead, so a pile entry would duplicate it.
    const w = week({ week: W3, goals: [weekly()] });
    const { carryover, resolved } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover).toEqual([]);
    expect(resolved[0].resolved).toBe(true);
  });

  it('reissues a weekly goal into the current week at full target', () => {
    const prior = week({
      week: W3,
      goals: [weekly({ target: 3 })],
      credits: [credit({ date: '2026-07-20' })],
    });
    const issued = issueRecurringGoals(NOW_WEEK, [prior]);
    expect(issued).not.toBeNull();
    expect(issued!.goals).toHaveLength(1);
    expect(issued!.goals[0].target).toBe(3); // full target, not the remainder
  });

  it('increments deferrals when the previous week slipped', () => {
    const prior = week({ week: W3, goals: [weekly({ deferrals: 2 })] });
    const issued = issueRecurringGoals(NOW_WEEK, [prior]);
    expect(issued!.goals[0].deferrals).toBe(3);
  });

  it('resets deferrals when the previous week was met', () => {
    const prior = week({
      week: W3,
      goals: [weekly({ target: 1, deferrals: 4 })],
      credits: [credit({ date: '2026-07-20' })],
    });
    const issued = issueRecurringGoals(NOW_WEEK, [prior]);
    expect(issued!.goals[0].deferrals).toBe(0);
  });

  it('is idempotent on (goalId, weekKey)', () => {
    const prior = week({ week: W3, goals: [weekly()] });
    const first = issueRecurringGoals(NOW_WEEK, [prior])!;
    const second = issueRecurringGoals(NOW_WEEK, [prior, first]);
    expect(second).toBeNull();
  });

  it('ignores one-off goals', () => {
    const prior = week({ week: W3, goals: [goal({ cadence: 'oneOff' })] });
    expect(issueRecurringGoals(NOW_WEEK, [prior])).toBeNull();
  });

  it('ignores a paused weekly goal', () => {
    const prior = week({ week: W3, goals: [weekly({ active: false })] });
    expect(issueRecurringGoals(NOW_WEEK, [prior])).toBeNull();
  });

  it('reads only the latest prior week, so a removed goal stays removed', () => {
    const weeks = [
      week({ week: W1, goals: [weekly({ id: 'old' })] }),
      week({ week: W3, goals: [weekly({ id: 'kept' })] }), // 'old' deliberately gone
    ];
    const issued = issueRecurringGoals(NOW_WEEK, weeks);
    expect(issued!.goals.map((g) => g.id)).toEqual(['kept']);
  });

  it('does nothing when there is no prior week', () => {
    expect(issueRecurringGoals(NOW_WEEK, [])).toBeNull();
  });

  it('carries a weekly goal across a year boundary', () => {
    const prior = week({ week: '2026-12-28', goals: [weekly()] });
    const issued = issueRecurringGoals('2027-01-04', [prior]);
    expect(issued!.week).toBe('2027-01-04');
    expect(issued!.goals).toHaveLength(1);
  });
});

describe('void', () => {
  it('reports a stood-down goal as void, not missed', () => {
    expect(goalProgress(goal({ voided: true }), []).outcome).toBe('void');
  });

  it('is void even when partly done', () => {
    expect(goalProgress(goal({ voided: true }), [credit()]).outcome).toBe('void');
  });

  it('does not carry over and takes no deferral penalty', () => {
    const w = week({ week: W3, goals: [goal({ voided: true })] });
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [w], []);
    expect(carryover).toEqual([]);
  });

  it('is excluded from the intake chips', () => {
    const w = week({ week: NOW_WEEK, goals: [goal({ voided: true })] });
    expect(openGoals(w)).toEqual([]);
  });

  it('is reported separately in the review', () => {
    const w = week({ week: W3, goals: [goal({ voided: true })] });
    const review = buildWeekReview(w, {});
    expect(review.voided).toHaveLength(1);
    expect(review.missed).toEqual([]);
  });

  it('can be set and unset', () => {
    const w = week({ week: NOW_WEEK, goals: [goal()] });
    const off = setVoided(w, 'g1', true);
    expect(off.goals[0].voided).toBe(true);
    expect(setVoided(off, 'g1', false).goals[0].voided).toBe(false);
  });
});

describe('sealed weeks', () => {
  it('reports whether a week is settled history', () => {
    expect(isSealed(week({ resolved: true }))).toBe(true);
    expect(isSealed(week())).toBe(false);
  });

  it('marks every resolved week as sealed', () => {
    const { resolved } = resolveElapsedWeeks(
      NOW_WEEK,
      [week({ week: W1, goals: [goal()] }), week({ week: W3, goals: [goal({ id: 'x' })] })],
      []
    );
    expect(resolved.every(isSealed)).toBe(true);
  });
});

describe('pruneCredits', () => {
  it('drops credits older than the retention window', () => {
    const old = credit({ blockId: 'old', date: '2025-01-01' });
    const recent = credit({ blockId: 'new', date: '2026-07-27' });
    const kept = pruneCredits([old, recent], NOW_WEEK, 12);
    expect(kept.map((c) => c.blockId)).toEqual(['new']);
  });

  it('keeps everything inside the window', () => {
    const inside = credit({ date: '2026-06-01' });
    expect(pruneCredits([inside], NOW_WEEK, 12)).toHaveLength(1);
  });
});

describe('carryover pile', () => {
  const item = (over: Partial<CarryoverItem> = {}): CarryoverItem => ({
    goal: goal({ deferrals: 2 }),
    residual: 2,
    firstDeferredWeek: W1,
    lastWeek: W3,
    lastProgress: { done: 1, target: 3 },
    ...over,
  });

  it('pulls a goal into a week and removes it from the pile', () => {
    const result = pullFromCarryover(week({ week: NOW_WEEK }), [item()], 'g1');
    expect(result.week.goals).toHaveLength(1);
    expect(result.carryover).toEqual([]);
  });

  it('keeps the deferral count when pulled forward', () => {
    const result = pullFromCarryover(week({ week: NOW_WEEK }), [item()], 'g1');
    expect(result.week.goals[0].deferrals).toBe(2);
  });

  it('keeps the goal id so history stays connected', () => {
    const result = pullFromCarryover(week({ week: NOW_WEEK }), [item()], 'g1');
    expect(result.week.goals[0].id).toBe('g1');
  });

  it('ignores an unknown id', () => {
    const pile = [item()];
    const result = pullFromCarryover(week(), pile, 'nope');
    expect(result.carryover).toEqual(pile);
    expect(result.week.goals).toEqual([]);
  });

  it('does not duplicate a goal already in the week', () => {
    const w = week({ week: NOW_WEEK, goals: [goal()] });
    const result = pullFromCarryover(w, [item()], 'g1');
    expect(result.week.goals).toHaveLength(1);
    expect(result.carryover).toEqual([]);
  });

  it('increments again when a pulled goal slips a second time', () => {
    const pulled = pullFromCarryover(week({ week: W3 }), [item()], 'g1');
    const { carryover } = resolveElapsedWeeks(NOW_WEEK, [pulled.week], pulled.carryover);
    expect(carryover[0].goal.deferrals).toBe(3);
  });

  it('targets the pulled goal at the residual, not its original size', () => {
    const result = pullFromCarryover(
      week({ week: NOW_WEEK }),
      [item({ residual: 2, goal: goal({ target: 3, deferrals: 2 }) })],
      'g1'
    );
    expect(result.week.goals[0].target).toBe(2);
  });

  it('drops an abandoned goal', () => {
    expect(dropFromCarryover([item()], 'g1')).toEqual([]);
  });

  it('resizes what is owed', () => {
    expect(resizeCarryover([item()], 'g1', 5)[0].residual).toBe(5);
  });

  it('refuses to resize below one', () => {
    expect(resizeCarryover([item()], 'g1', 0)[0].residual).toBe(1);
  });

  it('surfaces items that have waited too long', () => {
    const pile = [
      item({ goal: goal({ id: 'fresh', deferrals: 1 }) }),
      item({ goal: goal({ id: 'stale', deferrals: 6 }) }),
    ];
    expect(staleCarryover(pile).map((c) => c.goal.id)).toEqual(['stale']);
  });

  it('groups by category, most deferred first', () => {
    const pile = [
      item({ goal: goal({ id: 'a', category: 'deep', deferrals: 1 }) }),
      item({ goal: goal({ id: 'b', category: 'deep', deferrals: 6 }) }),
      item({ goal: goal({ id: 'c', category: 'admin', deferrals: 2 }) }),
    ];
    const groups = carryoverByCategory(pile, DEFAULT_CATEGORIES);
    expect(groups.map((g) => g.category.id)).toEqual(['deep', 'admin']);
    expect(groups[0].items.map((i) => i.goal.id)).toEqual(['b', 'a']);
  });

  it('keeps items whose category was deleted', () => {
    const pile = [item({ goal: goal({ id: 'z', category: 'vanished' }) })];
    const groups = carryoverByCategory(pile, DEFAULT_CATEGORIES);
    expect(groups).toHaveLength(1);
    expect(groups[0].items[0].goal.id).toBe('z');
  });
});

// ---------------------------------------------------------------------------

describe('buildWeekReview', () => {
  it('measures by time, not by block count', () => {
    // One three-hour focus block completed, one fifteen-minute block not.
    const review = buildWeekReview(week({ week: W3 }), {
      '2026-07-20': [
        block({ id: 'a', start: 540, end: 720, completed: true }),
        block({ id: 'b', start: 720, end: 735, completed: false }),
      ],
    });
    expect(review.doneMinutes).toBe(180);
    expect(review.plannedMinutes).toBe(195);
  });

  it('excludes auto blocks from both figures', () => {
    const review = buildWeekReview(week({ week: W3 }), {
      '2026-07-20': [
        block({ id: 'a', start: 540, end: 600, completed: true }),
        block({ id: 'brk', start: 600, end: 615, auto: true, completed: false }),
      ],
    });
    expect(review.plannedMinutes).toBe(60);
    expect(review.doneMinutes).toBe(60);
  });

  it('ignores days outside the week', () => {
    const review = buildWeekReview(week({ week: W3 }), {
      '2026-07-20': [block({ id: 'in', start: 540, end: 600, completed: true })],
      '2026-07-27': [block({ id: 'out', start: 540, end: 600, completed: true })],
    });
    expect(review.doneMinutes).toBe(60);
  });

  it('breaks totals down per category', () => {
    const review = buildWeekReview(week({ week: W3 }), {
      '2026-07-20': [
        block({ id: 'a', category: 'deep', start: 540, end: 600, completed: true }),
        block({ id: 'b', category: 'admin', start: 600, end: 660, completed: false }),
      ],
    });
    const deep = review.byCategory.find((c) => c.categoryId === 'deep')!;
    const admin = review.byCategory.find((c) => c.categoryId === 'admin')!;
    expect(deep).toMatchObject({ done: 60, planned: 60 });
    expect(admin).toMatchObject({ done: 0, planned: 60 });
  });

  it('sorts goals into met, slipped and missed', () => {
    const w = week({
      week: W3,
      goals: [
        goal({ id: 'met', target: 1 }),
        goal({ id: 'slip', target: 3 }),
        goal({ id: 'miss', target: 3 }),
      ],
      credits: [
        credit({ goalId: 'met', blockId: 'b1', date: '2026-07-20' }),
        credit({ goalId: 'slip', blockId: 'b2', date: '2026-07-21' }),
      ],
    });
    const review = buildWeekReview(w, {});
    expect(review.met.map((g) => g.goal.id)).toEqual(['met']);
    expect(review.slipped.map((g) => g.goal.id)).toEqual(['slip']);
    expect(review.missed.map((g) => g.goal.id)).toEqual(['miss']);
  });

  it('handles an empty week', () => {
    const review = buildWeekReview(emptyWeek(W3), {});
    expect(review).toMatchObject({ doneMinutes: 0, plannedMinutes: 0 });
    expect(review.byCategory).toEqual([]);
  });
});

describe('ceiling goals', () => {
  const ceiling = (over: Partial<WeeklyGoal> = {}) =>
    goal({ direction: 'atMost', targetKind: 'minutes', target: 300, cadence: 'weekly', ...over });

  const creditsFor = (minutes: number) => [
    { goalId: 'g1', blockId: 'b1', date: '2026-07-27', minutes },
  ];

  it('starts met, which is the one bar in this app that starts full', () => {
    expect(goalProgress(ceiling(), []).outcome).toBe('met');
  });

  it('stays met right up to the limit', () => {
    expect(goalProgress(ceiling(), creditsFor(299)).outcome).toBe('met');
    expect(goalProgress(ceiling(), creditsFor(300)).outcome).toBe('met');
  });

  it('is exceeded past it, and never reports partial', () => {
    // Being half way to a limit is not partial progress; it is simply inside the limit.
    const over = goalProgress(ceiling(), creditsFor(340));
    expect(over.outcome).toBe('exceeded');
    expect(goalProgress(ceiling(), creditsFor(150)).outcome).not.toBe('partial');
  });

  it('is still stood down when voided, whatever the minutes say', () => {
    expect(goalProgress(ceiling({ voided: true }), creditsFor(999)).outcome).toBe('void');
  });

  it('never appears as work to do', () => {
    // An intake chip for a ceiling would invite more of the thing you are holding down.
    const week: WeekRecord = { week: NOW_WEEK, goals: [ceiling()], credits: [] };
    expect(openGoals(week)).toEqual([]);
  });

  it('cannot be carried over', () => {
    // There is no residual to owe: going over last week does not mean you owe yourself a
    // smaller limit this week.
    const week: WeekRecord = {
      week: W3,
      goals: [ceiling({ cadence: 'oneOff' })],
      credits: creditsFor(500),
    };
    const r = resolveElapsedWeeks(NOW_WEEK, [week], []);
    expect(r.carryover).toEqual([]);
  });

  it('never accrues a deferral', () => {
    // Stacking friction for exceeding a limit would turn it into a punishment.
    const prior: WeekRecord = {
      week: W3,
      goals: [ceiling({ deferrals: 2 })],
      credits: creditsFor(500),
    };
    const issued = issueRecurringGoals(NOW_WEEK, [prior]);
    expect(issued!.goals[0].deferrals).toBe(0);
  });

  it('lands in its own review bucket, not in missed', () => {
    const week: WeekRecord = { week: W3, goals: [ceiling()], credits: creditsFor(400) };
    const review = buildWeekReview(week, {});
    expect(review.exceeded.map((g) => g.goal.id)).toEqual(['g1']);
    expect(review.missed).toEqual([]);
    expect(review.met).toEqual([]);
  });
});

describe('run goals', () => {
  const runGoal = (over: Partial<WeeklyGoal> = {}) =>
    goal({ cadence: 'weekly', run: { target: 4, current: 0, best: 0 }, ...over });

  it('advances on a met week and remembers the best', () => {
    const g = runGoal({ run: { target: 4, current: 2, best: 2 } });
    expect(advanceRun(g, 'met')).toEqual({ target: 4, current: 3, best: 3 });
  });

  it('resets on a missed week but keeps the best', () => {
    // Same vocabulary as the day-streak: a reset costs the current run and nothing else.
    const g = runGoal({ run: { target: 4, current: 3, best: 3 } });
    expect(advanceRun(g, 'missed')).toEqual({ target: 4, current: 0, best: 3 });
    expect(advanceRun(g, 'partial')).toEqual({ target: 4, current: 0, best: 3 });
  });

  it('neither advances nor resets on a week stood down', () => {
    // Standing something down deliberately is a decision, not a lapse — and a run broken by
    // a week you consciously took off would make the whole feature discouraging.
    const run = { target: 4, current: 3, best: 3 };
    expect(advanceRun(runGoal({ run }), 'void')).toEqual(run);
  });

  it('does nothing at all for a goal with no run', () => {
    expect(advanceRun(goal(), 'met')).toBeUndefined();
  });

  it('advances through the weekly reissue', () => {
    const prior: WeekRecord = {
      week: W3,
      goals: [runGoal({ run: { target: 4, current: 1, best: 1 } })],
      credits: [
        { goalId: 'g1', blockId: 'b1', date: W3, minutes: 45 },
        { goalId: 'g1', blockId: 'b2', date: '2026-07-21', minutes: 45 },
        { goalId: 'g1', blockId: 'b3', date: '2026-07-22', minutes: 45 },
      ],
    };
    const issued = issueRecurringGoals(NOW_WEEK, [prior]);
    expect(issued!.goals[0].run).toEqual({ target: 4, current: 2, best: 2 });
  });

  it('pays once on reaching the target, keyed so a longer run still pays', () => {
    const done = [runGoal({ run: { target: 4, current: 4, best: 4 } })];
    const due = goalRunPayouts(done, []);
    expect(due).toHaveLength(1);
    expect(due[0].key).toBe(goalRunKey('g1', 4));
    expect(due[0].xp).toBe(goalRunXp(4));

    // Already granted: nothing owed.
    expect(goalRunPayouts(done, [goalRunKey('g1', 4)])).toEqual([]);

    // A longer target later is a different key, so it can still pay.
    const longer = [runGoal({ run: { target: 8, current: 8, best: 8 } })];
    expect(goalRunPayouts(longer, [goalRunKey('g1', 4)])).toHaveLength(1);
  });

  it('pays nothing short of the target', () => {
    expect(goalRunPayouts([runGoal({ run: { target: 4, current: 3, best: 3 } })], [])).toEqual([]);
  });

  it('scales the payout with the target', () => {
    expect(goalRunXp(2)).toBeLessThan(goalRunXp(6));
  });
});

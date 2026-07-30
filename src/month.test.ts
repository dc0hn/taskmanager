import { describe, it, expect } from 'vitest';
import {
  addMonthKeys,
  currentMonthKey,
  daysInMonth,
  formatMonthKey,
  isDayInMonth,
  monthInProgress,
  monthlyTargetFor,
  resolveElapsedMonths,
  ringFill,
  summariseMonth,
  toMonthKey,
  weeksTouchingMonth,
} from './month';
import type { CarryoverItem, GoalCredit, WeeklyGoal, WeekRecord } from './types';

const goal = (over: Partial<WeeklyGoal> = {}): WeeklyGoal => ({
  id: 'g1',
  label: 'Practise scales',
  category: 'music',
  targetKind: 'sessions',
  target: 5,
  sessionMinutes: 45,
  cadence: 'weekly',
  active: true,
  deferrals: 0,
  originWeek: '2026-07-06',
  ...over,
});

const credit = (date: string, over: Partial<GoalCredit> = {}): GoalCredit => ({
  goalId: 'g1',
  blockId: 'b-' + date,
  date,
  minutes: 45,
  ...over,
});

const week = (w: string, goals: WeeklyGoal[], credits: GoalCredit[] = []): WeekRecord => ({
  week: w,
  goals,
  credits,
});

// ---------------------------------------------------------------------------

describe('month keys', () => {
  it('derives a month from a day', () => {
    expect(toMonthKey('2026-07-29')).toBe('2026-07');
    expect(toMonthKey('2026-01-01')).toBe('2026-01');
  });

  it('derives the current month from an injected date', () => {
    expect(currentMonthKey(new Date(2026, 6, 29))).toBe('2026-07');
  });

  it('shifts months across a year boundary', () => {
    expect(addMonthKeys('2026-12', 1)).toBe('2027-01');
    expect(addMonthKeys('2026-01', -1)).toBe('2025-12');
    expect(addMonthKeys('2026-07', 0)).toBe('2026-07');
    expect(addMonthKeys('2026-07', -7)).toBe('2025-12');
  });

  it('knows how long each month is', () => {
    expect(daysInMonth('2026-02')).toBe(28);
    expect(daysInMonth('2028-02')).toBe(29); // leap
    expect(daysInMonth('2026-04')).toBe(30);
    expect(daysInMonth('2026-07')).toBe(31);
    expect(daysInMonth('2026-12')).toBe(31);
  });

  it('tests day membership', () => {
    expect(isDayInMonth('2026-07-31', '2026-07')).toBe(true);
    expect(isDayInMonth('2026-08-01', '2026-07')).toBe(false);
  });

  it('formats for display', () => {
    expect(formatMonthKey('2026-07')).toBe('July 2026');
  });
});

// The heart of the model: the denominator tracks the length of the month.
describe('monthlyTargetFor — pro-rated by days, not whole weeks', () => {
  it('asks exactly four weeks of a 28-day February', () => {
    expect(monthlyTargetFor(5, '2026-02')).toBeCloseTo(20, 5);
  });

  it('asks more of a longer month', () => {
    expect(monthlyTargetFor(5, '2026-04')).toBeCloseTo(5 * 30 / 7, 5); // ≈21.43
    expect(monthlyTargetFor(5, '2026-07')).toBeCloseTo(5 * 31 / 7, 5); // ≈22.14
  });

  it('accounts for a single extra day', () => {
    const april = monthlyTargetFor(5, '2026-04'); // 30 days
    const july = monthlyTargetFor(5, '2026-07'); // 31 days
    expect(july - april).toBeCloseTo(5 / 7, 5);
  });

  it('accounts for a leap day', () => {
    expect(monthlyTargetFor(7, '2028-02') - monthlyTargetFor(7, '2026-02')).toBeCloseTo(1, 5);
  });

  it('never divides by a zero target', () => {
    expect(monthlyTargetFor(0, '2026-07')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------

describe('weeksTouchingMonth', () => {
  it('includes a week that straddles two months', () => {
    // The week of Mon 2025-12-29 runs to Sun 2026-01-04.
    const weeks = [week('2025-12-29', [goal()])];
    expect(weeksTouchingMonth('2025-12', weeks)).toHaveLength(1);
    expect(weeksTouchingMonth('2026-01', weeks)).toHaveLength(1);
  });

  it('excludes unrelated weeks', () => {
    expect(weeksTouchingMonth('2026-03', [week('2026-07-27', [goal()])])).toEqual([]);
  });
});

describe('summariseMonth', () => {
  it('counts sessions as distinct days within the calendar month', () => {
    const weeks = [
      week('2026-06-29', [goal()], [
        credit('2026-06-30'), // June — must NOT count toward July
        credit('2026-07-01'),
        credit('2026-07-02'),
      ]),
    ];
    const july = summariseMonth('2026-07', weeks);
    expect(july.goals[0].done).toBe(2);
    const june = summariseMonth('2026-06', weeks);
    expect(june.goals[0].done).toBe(1);
  });

  it('attributes credits by their own date, not by the week they belong to', () => {
    // One week record spanning the year boundary.
    const weeks = [
      week('2025-12-29', [goal()], [
        credit('2025-12-30'),
        credit('2025-12-31'),
        credit('2026-01-02'),
      ]),
    ];
    expect(summariseMonth('2025-12', weeks).goals[0].done).toBe(2);
    expect(summariseMonth('2026-01', weeks).goals[0].done).toBe(1);
  });

  it('counts one session per day even when work was chunked', () => {
    const weeks = [
      week('2026-06-29', [goal()], [
        credit('2026-07-01', { blockId: 'a-c1' }),
        credit('2026-07-01', { blockId: 'a-c2' }),
      ]),
    ];
    expect(summariseMonth('2026-07', weeks).goals[0].done).toBe(1);
  });

  it('sums minutes for a minutes-target goal', () => {
    const g = goal({ targetKind: 'minutes', target: 180 });
    const weeks = [
      week('2026-06-29', [g], [
        credit('2026-07-01', { minutes: 90 }),
        credit('2026-07-02', { minutes: 30 }),
      ]),
    ];
    expect(summariseMonth('2026-07', weeks).goals[0].done).toBe(120);
  });

  it('computes the ratio against the pro-rated target', () => {
    const weeks = [
      week('2026-06-29', [goal({ target: 5 })],
        Array.from({ length: 11 }, (_, i) =>
          credit(`2026-07-${String(i + 1).padStart(2, '0')}`)
        )),
    ];
    const m = summariseMonth('2026-07', weeks);
    // 11 of (5 × 31/7 ≈ 22.14)
    expect(m.goals[0].ratio).toBeCloseTo(11 / (5 * 31 / 7), 4);
  });

  it('allows a ratio above 1 for genuine overachievement', () => {
    const weeks = [
      week('2026-06-29', [goal({ target: 1 })],
        Array.from({ length: 10 }, (_, i) =>
          credit(`2026-07-${String(i + 1).padStart(2, '0')}`)
        )),
    ];
    expect(summariseMonth('2026-07', weeks).goals[0].ratio).toBeGreaterThan(1);
  });

  it('excludes one-off goals, which have no weekly total', () => {
    const weeks = [
      week('2026-06-29', [goal({ id: 'w', cadence: 'weekly' }), goal({ id: 'o', cadence: 'oneOff' })]),
    ];
    expect(summariseMonth('2026-07', weeks).goals.map((g) => g.goalId)).toEqual(['w']);
  });

  it('counts how many weeks a goal was issued', () => {
    const weeks = [
      week('2026-06-29', [goal()]),
      week('2026-07-06', [goal()]),
      week('2026-07-13', [goal()]),
    ];
    expect(summariseMonth('2026-07', weeks).goals[0].weeksIssued).toBe(3);
  });

  it('measures against the most recent target when it changed mid-month', () => {
    const weeks = [
      week('2026-07-06', [goal({ target: 3 })]),
      week('2026-07-13', [goal({ target: 6 })]),
    ];
    expect(summariseMonth('2026-07', weeks).goals[0].weeklyTarget).toBe(6);
  });

  it('snapshots the label and category so history survives a rename', () => {
    const weeks = [week('2026-07-06', [goal({ label: 'Scales', category: 'music' })])];
    const m = summariseMonth('2026-07', weeks);
    expect(m.goals[0]).toMatchObject({ label: 'Scales', category: 'music' });
  });

  it('averages the per-goal ratios for the overall figure', () => {
    const weeks = [
      week('2026-07-06', [
        goal({ id: 'a', target: 1 }),
        goal({ id: 'b', target: 1 }),
      ], [credit('2026-07-07', { goalId: 'a' })]),
    ];
    const m = summariseMonth('2026-07', weeks);
    const a = m.goals.find((g) => g.goalId === 'a')!.ratio;
    const b = m.goals.find((g) => g.goalId === 'b')!.ratio;
    expect(b).toBe(0);
    expect(m.overall).toBeCloseTo((a + b) / 2, 6);
  });

  it('reports zero overall for a month with no weekly goals', () => {
    expect(summariseMonth('2026-07', []).overall).toBe(0);
  });

  it('records the length of the month', () => {
    expect(summariseMonth('2026-02', []).daysInMonth).toBe(28);
  });
});

describe('monthInProgress', () => {
  it('uses the same maths without sealing', () => {
    const weeks = [week('2026-07-06', [goal()], [credit('2026-07-07')])];
    const live = monthInProgress('2026-07', weeks);
    expect(live.sealedOn).toBe('');
    expect(live.goals[0].done).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe('resolveElapsedMonths', () => {
  const item = (over: Partial<CarryoverItem> = {}): CarryoverItem => ({
    goal: goal({ id: 'c1', cadence: 'oneOff', deferrals: 2 }),
    residual: 2,
    firstDeferredWeek: '2026-06-01',
    lastWeek: '2026-06-22',
    lastProgress: { done: 1, target: 3 },
    ...over,
  });

  it('does nothing when there is no elapsed month with data', () => {
    const r = resolveElapsedMonths('2026-07', [], [], [], '2026-07-29');
    expect(r.changed).toBe(false);
  });

  it('leaves the current month unsealed', () => {
    const weeks = [week('2026-07-06', [goal()])];
    const r = resolveElapsedMonths('2026-07', [], weeks, [], '2026-07-29');
    expect(r.sealed.map((m) => m.month)).not.toContain('2026-07');
  });

  it('seals an elapsed month', () => {
    const weeks = [week('2026-06-01', [goal()], [credit('2026-06-02')])];
    const r = resolveElapsedMonths('2026-07', [], weeks, [], '2026-07-01');
    expect(r.changed).toBe(true);
    expect(r.sealed.map((m) => m.month)).toContain('2026-06');
    expect(r.sealed[0].sealedOn).toBe('2026-07-01');
  });

  it('empties the carryover pile into the month it slipped in', () => {
    const weeks = [week('2026-06-01', [goal()])];
    const r = resolveElapsedMonths('2026-07', [], weeks, [item()], '2026-07-01');
    const june = r.sealed.find((m) => m.month === '2026-06')!;
    expect(june.cleared).toHaveLength(1);
    expect(june.cleared[0]).toMatchObject({ goalId: 'c1', residual: 2, deferrals: 2 });
    expect(r.carryover).toEqual([]);
  });

  it('keeps nothing in the pile — the reset is total', () => {
    const weeks = [week('2026-06-01', [goal()])];
    const r = resolveElapsedMonths('2026-07', [], weeks, [item(), item({ goal: goal({ id: 'c2' }) })], '2026-07-01');
    expect(r.carryover).toEqual([]);
  });

  it('is idempotent — a sealed month is not sealed again', () => {
    const weeks = [week('2026-06-01', [goal()], [credit('2026-06-02')])];
    const first = resolveElapsedMonths('2026-07', [], weeks, [item()], '2026-07-01');
    const second = resolveElapsedMonths('2026-07', first.sealed, weeks, first.carryover, '2026-07-02');
    expect(second.changed).toBe(false);
    expect(second.sealed).toEqual([]);
  });

  it('is idempotent across three runs', () => {
    const weeks = [week('2026-06-01', [goal()])];
    const a = resolveElapsedMonths('2026-07', [], weeks, [], '2026-07-01');
    const b = resolveElapsedMonths('2026-07', a.sealed, weeks, a.carryover, '2026-07-01');
    const c = resolveElapsedMonths('2026-07', a.sealed, weeks, b.carryover, '2026-07-01');
    expect(b.changed).toBe(false);
    expect(c.changed).toBe(false);
  });

  it('seals several months in order after a long absence, without fabricating empties', () => {
    const weeks = [
      week('2026-03-02', [goal()], [credit('2026-03-03')]),
      week('2026-06-01', [goal()], [credit('2026-06-02')]),
    ];
    const r = resolveElapsedMonths('2026-07', [], weeks, [], '2026-07-01');
    // March and June hold data; April and May must not be invented.
    expect(r.sealed.map((m) => m.month)).toEqual(['2026-03', '2026-06']);
  });

  it('files each pile item under the month it last slipped in', () => {
    const weeks = [
      week('2026-05-04', [goal()]),
      week('2026-06-01', [goal()]),
    ];
    const may = item({ goal: goal({ id: 'may' }), lastWeek: '2026-05-04' });
    const june = item({ goal: goal({ id: 'june' }), lastWeek: '2026-06-01' });
    const r = resolveElapsedMonths('2026-07', [], weeks, [may, june], '2026-07-01');
    const m5 = r.sealed.find((m) => m.month === '2026-05')!;
    const m6 = r.sealed.find((m) => m.month === '2026-06')!;
    expect(m5.cleared.map((c) => c.goalId)).toEqual(['may']);
    expect(m6.cleared.map((c) => c.goalId)).toEqual(['june']);
  });

  it('crosses the year boundary', () => {
    const weeks = [week('2025-12-29', [goal()], [credit('2025-12-30')])];
    const r = resolveElapsedMonths('2026-01', [], weeks, [], '2026-01-01');
    expect(r.sealed.map((m) => m.month)).toContain('2025-12');
  });
});

describe('ringFill', () => {
  it('clamps the drawn arc but the figure stays honest', () => {
    expect(ringFill(0)).toBe(0);
    expect(ringFill(0.5)).toBe(0.5);
    expect(ringFill(1.4)).toBe(1);
    expect(ringFill(-1)).toBe(0);
  });
});

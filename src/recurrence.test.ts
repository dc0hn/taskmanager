import { describe, it, expect } from 'vitest';
import {
  allStatuses,
  describeRule,
  dueStatuses,
  isCompletedOn,
  matchesRule,
  pruneCompletions,
  reconcileCompletions,
  streakFor,
  taskFromTemplate,
  templatesDueOn,
} from './recurrence';
import type { RecurrenceRule, RecurringCompletion, RecurringTask } from './types';

// Reference week: 2026-07-27 is a Monday.
//   Mon 27 · Tue 28 · Wed 29 · Thu 30 · Fri 31 · Sat 08-01 · Sun 08-02
const MON = '2026-07-27';
const TUE = '2026-07-28';
const WED = '2026-07-29';
const THU = '2026-07-30';
const FRI = '2026-07-31';
const SAT = '2026-08-01';
const SUN = '2026-08-02';
const NEXT_MON = '2026-08-03';

const asDate = (key: string) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const tpl = (over: Partial<RecurringTask> = {}): RecurringTask => ({
  id: 'h1',
  label: 'Stretch',
  category: 'break',
  duration: 15,
  priority: 'normal',
  rule: { kind: 'daily' },
  createdOn: MON,
  active: true,
  ...over,
});

const done = (dates: string[], templateId = 'h1'): RecurringCompletion[] =>
  dates.map((date) => ({ templateId, date, minutes: 15 }));

// ---------------------------------------------------------------------------

describe('matchesRule', () => {
  it('daily matches every day', () => {
    for (const d of [MON, SAT, SUN]) {
      expect(matchesRule({ kind: 'daily' }, d)).toBe(true);
    }
  });

  it('weekdays matches Monday to Friday only', () => {
    for (const d of [MON, TUE, WED, THU, FRI]) {
      expect(matchesRule({ kind: 'weekdays' }, d)).toBe(true);
    }
    expect(matchesRule({ kind: 'weekdays' }, SAT)).toBe(false);
    expect(matchesRule({ kind: 'weekdays' }, SUN)).toBe(false);
  });

  it('days matches the listed weekdays', () => {
    const rule: RecurrenceRule = { kind: 'days', days: [1, 3, 5] }; // Mon, Wed, Fri
    expect(matchesRule(rule, MON)).toBe(true);
    expect(matchesRule(rule, WED)).toBe(true);
    expect(matchesRule(rule, FRI)).toBe(true);
    expect(matchesRule(rule, TUE)).toBe(false);
    expect(matchesRule(rule, SUN)).toBe(false);
  });

  it('an empty days list never matches', () => {
    expect(matchesRule({ kind: 'days', days: [] }, MON)).toBe(false);
  });

  it('matches Sunday as day 0', () => {
    expect(matchesRule({ kind: 'days', days: [0] }, SUN)).toBe(true);
    expect(matchesRule({ kind: 'days', days: [0] }, MON)).toBe(false);
  });
});

describe('describeRule', () => {
  it('describes each rule kind', () => {
    expect(describeRule({ kind: 'daily' })).toBe('Every day');
    expect(describeRule({ kind: 'weekdays' })).toBe('Weekdays');
    expect(describeRule({ kind: 'days', days: [1, 3, 5] })).toBe('Mon · Wed · Fri');
    expect(describeRule({ kind: 'days', days: [] })).toBe('Never');
  });

  it('collapses all seven days to "Every day"', () => {
    expect(describeRule({ kind: 'days', days: [0, 1, 2, 3, 4, 5, 6] })).toBe('Every day');
  });

  it('normalises day order', () => {
    expect(describeRule({ kind: 'days', days: [5, 1, 3] })).toBe('Mon · Wed · Fri');
  });
});

describe('templatesDueOn', () => {
  it('excludes inactive templates', () => {
    expect(templatesDueOn([tpl({ active: false })], WED)).toEqual([]);
  });

  it('excludes days before the template existed', () => {
    expect(templatesDueOn([tpl({ createdOn: WED })], MON)).toEqual([]);
    expect(templatesDueOn([tpl({ createdOn: WED })], WED)).toHaveLength(1);
  });

  it('excludes templates whose rule does not fire', () => {
    expect(templatesDueOn([tpl({ rule: { kind: 'weekdays' } })], SAT)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe('streakFor — current run', () => {
  it('is zero for a brand new template', () => {
    const s = streakFor(tpl(), [], asDate(MON));
    expect(s.current).toBe(0);
    expect(s.dueToday).toBe(true);
    expect(s.doneToday).toBe(false);
  });

  it('counts consecutive daily completions', () => {
    const s = streakFor(tpl(), done([MON, TUE, WED]), asDate(WED));
    expect(s.current).toBe(3);
    expect(s.doneToday).toBe(true);
    expect(s.dueToday).toBe(false);
  });

  // At 9am your twelve-day run should still read twelve.
  it('does not zero the streak just because today is still open', () => {
    const s = streakFor(tpl(), done([MON, TUE, WED]), asDate(THU));
    expect(s.current).toBe(3);
    expect(s.dueToday).toBe(true);
    expect(s.doneToday).toBe(false);
  });

  it('breaks on a missed matching day', () => {
    // Wednesday skipped, so only Thursday counts.
    const s = streakFor(tpl(), done([MON, TUE, THU]), asDate(THU));
    expect(s.current).toBe(1);
  });

  it('breaks when the gap is before an open today', () => {
    const s = streakFor(tpl(), done([MON, TUE]), asDate(THU));
    expect(s.current).toBe(0); // Wednesday was missed
  });

  // The important one: a weekdays habit must survive the weekend.
  it('skips the weekend for a weekdays rule instead of breaking', () => {
    const s = streakFor(
      tpl({ rule: { kind: 'weekdays' } }),
      done([MON, TUE, WED, THU, FRI]),
      asDate(NEXT_MON)
    );
    expect(s.current).toBe(5);
    expect(s.dueToday).toBe(true);
  });

  it('does not require weekend completions for a weekdays rule', () => {
    const s = streakFor(
      tpl({ rule: { kind: 'weekdays' } }),
      done([MON, TUE, WED, THU, FRI]),
      asDate(SUN)
    );
    expect(s.current).toBe(5);
    expect(s.dueToday).toBe(false); // Sunday is not a matching day
    expect(s.doneToday).toBe(false);
  });

  it('skips non-matching days for a specific-days rule', () => {
    // Mon/Wed/Fri habit, all three done — Tue and Thu are irrelevant.
    const s = streakFor(
      tpl({ rule: { kind: 'days', days: [1, 3, 5] } }),
      done([MON, WED, FRI]),
      asDate(FRI)
    );
    expect(s.current).toBe(3);
  });

  it('breaks a specific-days streak on a missed matching day', () => {
    const s = streakFor(
      tpl({ rule: { kind: 'days', days: [1, 3, 5] } }),
      done([MON, FRI]), // Wednesday missed
      asDate(FRI)
    );
    expect(s.current).toBe(1);
  });

  it('stops counting at the creation date', () => {
    const s = streakFor(tpl({ createdOn: WED }), done([MON, TUE, WED]), asDate(WED));
    expect(s.current).toBe(1);
  });

  it('crosses a month boundary', () => {
    const s = streakFor(
      tpl({ createdOn: '2026-07-30' }),
      done([THU, FRI, SAT, SUN, NEXT_MON]),
      asDate(NEXT_MON)
    );
    expect(s.current).toBe(5);
  });

  it('crosses a year boundary', () => {
    const s = streakFor(
      tpl({ createdOn: '2025-12-30' }),
      done(['2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02']),
      asDate('2026-01-02')
    );
    expect(s.current).toBe(4);
  });
});

describe('streakFor — best, total and rate', () => {
  it('reports the best run even after the current one breaks', () => {
    const s = streakFor(
      tpl({ createdOn: MON }),
      done([MON, TUE, WED, FRI]), // 3 then a gap then 1
      asDate(FRI)
    );
    expect(s.current).toBe(1);
    expect(s.best).toBe(3);
  });

  it('best is never below current', () => {
    const s = streakFor(tpl(), done([MON, TUE, WED]), asDate(WED));
    expect(s.best).toBeGreaterThanOrEqual(s.current);
  });

  it('counts total completions', () => {
    const s = streakFor(tpl(), done([MON, WED, FRI]), asDate(FRI));
    expect(s.total).toBe(3);
  });

  it('computes a completion rate over elapsed matching days', () => {
    // Today is Friday and still open, so the denominator is Mon–Thu: four
    // elapsed days, of which Mon/Tue/Wed were done and Thursday was missed.
    const s = streakFor(tpl(), done([MON, TUE, WED]), asDate(FRI));
    expect(s.rate).toBeCloseTo(3 / 4, 5);
  });

  it('counts today in the rate once it is completed', () => {
    // Same history, but Thursday done too and Friday completed -> 5/5.
    const s = streakFor(tpl(), done([MON, TUE, WED, THU, FRI]), asDate(FRI));
    expect(s.rate).toBe(1);
  });

  it('excludes an open today from the rate denominator', () => {
    // Mon and Tue done; today is Wednesday and still open, so 2/2 not 2/3.
    const s = streakFor(tpl(), done([MON, TUE]), asDate(WED));
    expect(s.rate).toBe(1);
  });

  it('rates a weekdays habit against weekdays only', () => {
    const s = streakFor(
      tpl({ rule: { kind: 'weekdays' } }),
      done([MON, TUE, WED, THU, FRI]),
      asDate(SUN)
    );
    expect(s.rate).toBe(1); // the weekend does not count against it
  });

  it('reports a zero rate with no matching days yet', () => {
    const s = streakFor(tpl({ createdOn: NEXT_MON }), [], asDate(MON));
    expect(s.rate).toBe(0);
  });

  it('ignores completions belonging to other templates', () => {
    const s = streakFor(tpl(), done([MON, TUE], 'other'), asDate(TUE));
    expect(s.current).toBe(0);
    expect(s.total).toBe(0);
  });
});

describe('streakFor — due flags', () => {
  it('is not due on a non-matching day', () => {
    const s = streakFor(tpl({ rule: { kind: 'weekdays' } }), [], asDate(SAT));
    expect(s.dueToday).toBe(false);
    expect(s.doneToday).toBe(false);
  });

  it('is not due when inactive', () => {
    expect(streakFor(tpl({ active: false }), [], asDate(MON)).dueToday).toBe(false);
  });

  it('is not due before it was created', () => {
    expect(streakFor(tpl({ createdOn: WED }), [], asDate(MON)).dueToday).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('completion log', () => {
  it('detects a completion on a date', () => {
    expect(isCompletedOn(done([MON]), 'h1', MON)).toBe(true);
    expect(isCompletedOn(done([MON]), 'h1', TUE)).toBe(false);
    expect(isCompletedOn(done([MON]), 'other', MON)).toBe(false);
  });

  it('reconciles from completed blocks', () => {
    const log = reconcileCompletions([], MON, [
      { templateId: 'h1', completed: true, start: 540, end: 555 },
      { templateId: 'h2', completed: false, start: 600, end: 615 },
      { completed: true, start: 700, end: 715 },
    ]);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ templateId: 'h1', date: MON, minutes: 15 });
  });

  it('records one completion per template per day, summing split work', () => {
    const log = reconcileCompletions([], MON, [
      { templateId: 'h1', completed: true, start: 540, end: 600 },
      { templateId: 'h1', completed: true, start: 700, end: 760 },
    ]);
    expect(log).toHaveLength(1);
    expect(log[0].minutes).toBe(120);
  });

  it('removes a completion when the block is un-ticked', () => {
    const before = reconcileCompletions([], MON, [
      { templateId: 'h1', completed: true, start: 540, end: 555 },
    ]);
    const after = reconcileCompletions(before, MON, [
      { templateId: 'h1', completed: false, start: 540, end: 555 },
    ]);
    expect(after).toEqual([]);
  });

  it('leaves other days untouched', () => {
    const existing = done([TUE]);
    const log = reconcileCompletions(existing, MON, []);
    expect(log).toEqual(existing);
  });

  it('ignores zero-length blocks', () => {
    const log = reconcileCompletions([], MON, [
      { templateId: 'h1', completed: true, start: 540, end: 540 },
    ]);
    expect(log).toEqual([]);
  });

  it('prunes rows older than the retention window', () => {
    const log = [...done(['2024-01-01']), ...done([MON])];
    const pruned = pruneCompletions(log, MON, 30);
    expect(pruned.map((c) => c.date)).toEqual([MON]);
  });

  it('keeps everything inside the window', () => {
    const log = done([MON, TUE, WED]);
    expect(pruneCompletions(log, WED, 30)).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------

describe('dueStatuses / allStatuses', () => {
  const store = {
    templates: [
      tpl({ id: 'a', label: 'Stretch', rule: { kind: 'daily' } }),
      tpl({ id: 'b', label: 'Inbox', rule: { kind: 'weekdays' } }),
      tpl({ id: 'c', label: 'Long run', rule: { kind: 'days', days: [6] } }),
    ],
    completions: done([MON], 'a'),
  };

  it('returns only what fires today', () => {
    const statuses = dueStatuses(store, MON, new Set(), asDate(MON));
    expect(statuses.map((s) => s.template.id).sort()).toEqual(['a', 'b']);
  });

  it('marks templates already placed on the day', () => {
    const statuses = dueStatuses(store, MON, new Set(['a']), asDate(MON));
    expect(statuses.find((s) => s.template.id === 'a')!.placed).toBe(true);
    expect(statuses.find((s) => s.template.id === 'b')!.placed).toBe(false);
  });

  it('carries streak state through', () => {
    const statuses = dueStatuses(store, MON, new Set(), asDate(MON));
    expect(statuses.find((s) => s.template.id === 'a')!.streak.current).toBe(1);
  });

  it('lists every template regardless of the day', () => {
    expect(allStatuses(store, asDate(MON))).toHaveLength(3);
  });
});

describe('taskFromTemplate', () => {
  it('carries the template id so completing it credits the streak', () => {
    const task = taskFromTemplate(tpl({ id: 'h9' }));
    expect(task.templateId).toBe('h9');
  });

  it('copies the schedulable fields', () => {
    const task = taskFromTemplate(
      tpl({ label: 'Stretch', category: 'break', duration: 20, priority: 'high', fixedTime: 420 })
    );
    expect(task).toMatchObject({
      title: 'Stretch',
      category: 'break',
      duration: 20,
      priority: 'high',
      fixedTime: 420,
    });
  });

  it('gives each instance a fresh id', () => {
    const a = taskFromTemplate(tpl());
    const b = taskFromTemplate(tpl());
    expect(a.id).not.toBe(b.id);
  });
});

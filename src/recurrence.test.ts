import { describe, it, expect } from 'vitest';
import {
  allStatuses,
  checkDateFor,
  checkmarksDueOn,
  checksOn,
  describeRule,
  dueStatuses,
  inGraceWindow,
  isChecked,
  setChecked,
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

// ---------------------------------------------------------------------------
// Checkmarks — recurring things with no slot
// ---------------------------------------------------------------------------

describe('checkmarks', () => {
  const water = (over: Partial<RecurringTask> = {}): RecurringTask => ({
    id: 'water',
    label: 'Gallon of water',
    category: 'break',
    duration: 15,
    priority: 'normal',
    rule: { kind: 'daily' },
    createdOn: '2026-01-01',
    active: true,
    checkmark: true,
    ...over,
  });

  const DAY = '2026-08-04';

  it('never reaches the scheduler', () => {
    // The single most important property. `dueStatuses` is the one place routines are
    // offered to a day, so filtering here keeps a checkmark out of the intake, the
    // suggestion chips and the build at once.
    const store = {
      templates: [water(), water({ id: 'timed', label: 'Stretch', checkmark: undefined })],
      completions: [],
    };
    const due = dueStatuses(store, DAY, new Set());
    expect(due.map((d) => d.template.id)).toEqual(['timed']);
  });

  it('lists as a checkmark instead', () => {
    const templates = [water(), water({ id: 'timed', checkmark: undefined })];
    expect(checkmarksDueOn(templates, DAY).map((t) => t.id)).toEqual(['water']);
  });

  it('respects the recurrence rule', () => {
    // 2026-08-04 is a Tuesday.
    const monday = water({ rule: { kind: 'days', days: [1] } });
    expect(checkmarksDueOn([monday], DAY)).toEqual([]);
    expect(checkmarksDueOn([monday], '2026-08-03')).toHaveLength(1);
  });

  it('ticks and unticks idempotently', () => {
    let c: RecurringCompletion[] = [];
    c = setChecked(c, 'water', DAY, true);
    c = setChecked(c, 'water', DAY, true);
    expect(c).toHaveLength(1);
    expect(isChecked(c, 'water', DAY)).toBe(true);

    c = setChecked(c, 'water', DAY, false);
    c = setChecked(c, 'water', DAY, false);
    expect(c).toEqual([]);
  });

  it('records no minutes, so every hours figure stays honest', () => {
    const c = setChecked([], 'water', DAY, true);
    expect(c[0]).toEqual({ templateId: 'water', date: DAY, minutes: 0, checked: true });
  });

  it('SURVIVES the block reconcile that runs on every change to the day', () => {
    // The bug this prevents: `reconcileCompletions` rebuilds a day from its blocks and
    // drops everything else for that date. A checkmark has no block, so without the
    // `checked` guard every tick would vanish the next time anything touched the day.
    const withCheck = setChecked([], 'water', DAY, true);
    const after = reconcileCompletions(withCheck, DAY, []);
    expect(isChecked(after, 'water', DAY)).toBe(true);
  });

  it('still lets block-derived completions be rebuilt', () => {
    const stale = [{ templateId: 'timed', date: DAY, minutes: 30 }];
    const after = reconcileCompletions(stale, DAY, []);
    expect(after).toEqual([]);
  });

  it('counts checks for a day without counting block completions', () => {
    const mixed = [
      { templateId: 'water', date: DAY, minutes: 0, checked: true },
      { templateId: 'vitamins', date: DAY, minutes: 0, checked: true },
      { templateId: 'timed', date: DAY, minutes: 30 },
      { templateId: 'water', date: '2026-08-03', minutes: 0, checked: true },
    ];
    expect(checksOn(mixed, DAY)).toBe(2);
  });

  it('feeds the routine’s own streak like any other completion', () => {
    const completions = [
      setChecked([], 'water', '2026-08-02', true),
      setChecked([], 'water', '2026-08-03', true),
      setChecked([], 'water', DAY, true),
    ].flat();
    const streak = streakFor(water(), completions, new Date('2026-08-04T12:00:00'));
    expect(streak.current).toBe(3);
    expect(streak.doneToday).toBe(true);
  });
});

describe('the grace window', () => {
  const at = (iso: string) => new Date(iso);

  it('credits the previous day before 4am', () => {
    expect(checkDateFor(at('2026-08-05T00:30:00'))).toBe('2026-08-04');
    expect(checkDateFor(at('2026-08-05T03:59:00'))).toBe('2026-08-04');
    expect(inGraceWindow(at('2026-08-05T00:30:00'))).toBe(true);
  });

  it('credits today from 4am onward', () => {
    expect(checkDateFor(at('2026-08-05T04:00:00'))).toBe('2026-08-05');
    expect(checkDateFor(at('2026-08-05T13:00:00'))).toBe('2026-08-05');
    expect(inGraceWindow(at('2026-08-05T04:00:00'))).toBe(false);
  });

  it('crosses a month boundary correctly', () => {
    expect(checkDateFor(at('2026-09-01T01:00:00'))).toBe('2026-08-31');
  });

  it('crosses a year boundary correctly', () => {
    expect(checkDateFor(at('2027-01-01T02:00:00'))).toBe('2026-12-31');
  });
});

describe('the grace window and a routine created today', () => {
  // The bug this pins, found live at 00:21: inside the grace window the strip credited
  // yesterday, and `templatesDueOn` gates on `createdOn <= date` — so a routine created
  // TODAY was not due yesterday and vanished from the list entirely. The strip went
  // empty at exactly the moment someone had finished setting one up.
  const madeToday = (): RecurringTask => ({
    id: 'water',
    label: 'Gallon Of Water',
    category: 'health',
    duration: 15,
    priority: 'normal',
    rule: { kind: 'daily' },
    createdOn: '2026-08-04',
    active: true,
    checkmark: true,
  });

  it('is not due on the grace day, which is the trap', () => {
    expect(checkmarksDueOn([madeToday()], '2026-08-03')).toEqual([]);
  });

  it('IS due on the real day, which is what must be offered instead', () => {
    expect(checkmarksDueOn([madeToday()], '2026-08-04')).toHaveLength(1);
  });

  it('a routine that existed yesterday is due on both, so it can credit either', () => {
    const older = { ...madeToday(), createdOn: '2026-07-01' };
    expect(checkmarksDueOn([older], '2026-08-03')).toHaveLength(1);
    expect(checkmarksDueOn([older], '2026-08-04')).toHaveLength(1);
  });

  it('the union of both days is never empty when either has it', () => {
    // The property the strip relies on: an item is offered if it was due on the day
    // being credited OR on the real day.
    const templates = [madeToday(), { ...madeToday(), id: 'old', createdOn: '2026-07-01' }];
    const union = new Set([
      ...checkmarksDueOn(templates, '2026-08-03').map((t) => t.id),
      ...checkmarksDueOn(templates, '2026-08-04').map((t) => t.id),
    ]);
    expect([...union].sort()).toEqual(['old', 'water']);
  });
});

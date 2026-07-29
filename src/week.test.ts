import { describe, it, expect } from 'vitest';
import {
  addMonths,
  addWeeks,
  currentWeekKey,
  formatWeekRange,
  isInWeek,
  isSameMonth,
  monthGridDates,
  monthStart,
  toWeekKey,
  weekDates,
  weekRange,
  weekdayOf,
  weeksBetween,
} from './week';

describe('weekdayOf', () => {
  it('maps date keys to JS weekday indices', () => {
    expect(weekdayOf('2026-07-26')).toBe(0); // Sunday
    expect(weekdayOf('2026-07-27')).toBe(1); // Monday
    expect(weekdayOf('2026-07-29')).toBe(3); // Wednesday
    expect(weekdayOf('2026-08-01')).toBe(6); // Saturday
  });
});

describe('toWeekKey', () => {
  it('returns the Monday of the containing week for every weekday', () => {
    // 2026-07-27 is a Monday; the whole week should collapse onto it.
    for (const [date, expected] of [
      ['2026-07-27', '2026-07-27'], // Mon
      ['2026-07-28', '2026-07-27'], // Tue
      ['2026-07-29', '2026-07-27'], // Wed
      ['2026-07-30', '2026-07-27'], // Thu
      ['2026-07-31', '2026-07-27'], // Fri
      ['2026-08-01', '2026-07-27'], // Sat
      ['2026-08-02', '2026-07-27'], // Sun — belongs to the week that began Monday
    ] as const) {
      expect(toWeekKey(date)).toBe(expected);
    }
  });

  it('treats Sunday as the end of the week, not the start', () => {
    expect(toWeekKey('2026-07-26')).toBe('2026-07-20');
    expect(toWeekKey('2026-07-27')).toBe('2026-07-27');
  });

  it('is idempotent', () => {
    const k = toWeekKey('2026-07-29');
    expect(toWeekKey(k)).toBe(k);
  });

  // The whole reason for Monday-date keys instead of ISO week numbers.
  it('handles the year boundary without special cases', () => {
    // Jan 1 2026 is a Thursday; its week began in December 2025.
    expect(toWeekKey('2026-01-01')).toBe('2025-12-29');
    expect(toWeekKey('2025-12-31')).toBe('2025-12-29');
    expect(toWeekKey('2026-01-04')).toBe('2025-12-29'); // Sunday
    expect(toWeekKey('2026-01-05')).toBe('2026-01-05'); // next Monday
  });

  it('handles a year with 53 ISO weeks', () => {
    // 2026-12-28 is ISO 2026-W53 — a week number that does not exist in most
    // years. As a Monday date key it is unremarkable.
    expect(toWeekKey('2026-12-28')).toBe('2026-12-28');
    expect(toWeekKey('2027-01-03')).toBe('2026-12-28'); // Sunday of that week
    expect(toWeekKey('2027-01-04')).toBe('2027-01-04');
  });

  it('handles a leap day', () => {
    // 2028-02-29 is a Tuesday.
    expect(toWeekKey('2028-02-29')).toBe('2028-02-28');
    expect(toWeekKey('2028-03-01')).toBe('2028-02-28');
  });
});

describe('addWeeks', () => {
  it('shifts forward and back', () => {
    expect(addWeeks('2026-07-27', 1)).toBe('2026-08-03');
    expect(addWeeks('2026-07-27', -1)).toBe('2026-07-20');
    expect(addWeeks('2026-07-27', 0)).toBe('2026-07-27');
    expect(addWeeks('2026-07-27', 4)).toBe('2026-08-24');
  });

  it('crosses the year boundary in both directions', () => {
    expect(addWeeks('2026-12-28', 1)).toBe('2027-01-04');
    expect(addWeeks('2027-01-04', -1)).toBe('2026-12-28');
    expect(addWeeks('2025-12-29', 1)).toBe('2026-01-05');
  });

  it('crosses a leap day', () => {
    expect(addWeeks('2028-02-28', 1)).toBe('2028-03-06'); // Feb has 29 days
    expect(addWeeks('2027-02-22', 1)).toBe('2027-03-01'); // Feb has 28 days
  });

  it('always lands on a Monday', () => {
    let k = '2025-12-29';
    for (let i = 0; i < 60; i++) {
      expect(weekdayOf(k)).toBe(1);
      k = addWeeks(k, 1);
    }
  });

  it('survives a DST transition', () => {
    // US DST springs forward on Sunday 2026-03-08. Naive 7*24h arithmetic would
    // drift by an hour and could roll the date; addDays uses setDate, which does
    // not.
    expect(addWeeks('2026-03-02', 1)).toBe('2026-03-09');
    expect(addWeeks('2026-03-09', -1)).toBe('2026-03-02');
    // And back in the autumn (2026-11-01).
    expect(addWeeks('2026-10-26', 1)).toBe('2026-11-02');
  });
});

describe('weekDates / weekRange', () => {
  it('lists seven consecutive days, Monday first', () => {
    expect(weekDates('2026-07-27')).toEqual([
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ]);
  });

  it('reports first and last day', () => {
    expect(weekRange('2026-07-27')).toEqual({
      start: '2026-07-27',
      end: '2026-08-02',
    });
  });

  it('spans the year boundary cleanly', () => {
    const dates = weekDates('2025-12-29');
    expect(dates[0]).toBe('2025-12-29');
    expect(dates[6]).toBe('2026-01-04');
    expect(dates).toHaveLength(7);
  });
});

describe('isInWeek', () => {
  it('accepts every day of the week and rejects neighbours', () => {
    for (const d of weekDates('2026-07-27')) {
      expect(isInWeek(d, '2026-07-27')).toBe(true);
    }
    expect(isInWeek('2026-07-26', '2026-07-27')).toBe(false);
    expect(isInWeek('2026-08-03', '2026-07-27')).toBe(false);
  });
});

describe('weeksBetween', () => {
  it('counts whole weeks, signed', () => {
    expect(weeksBetween('2026-07-27', '2026-08-03')).toBe(1);
    expect(weeksBetween('2026-08-03', '2026-07-27')).toBe(-1);
    expect(weeksBetween('2026-07-27', '2026-07-27')).toBe(0);
    expect(weeksBetween('2026-07-27', '2026-08-24')).toBe(4);
  });

  it('is unaffected by DST inside the span', () => {
    expect(weeksBetween('2026-03-02', '2026-03-09')).toBe(1);
    expect(weeksBetween('2026-02-23', '2026-03-16')).toBe(3);
  });
});

describe('formatWeekRange', () => {
  it('omits the repeated month inside one month', () => {
    expect(formatWeekRange('2026-03-02')).toBe('Mar 2 – 8');
  });

  it('names both months when the week straddles them', () => {
    expect(formatWeekRange('2026-07-27')).toBe('Jul 27 – Aug 2');
    expect(formatWeekRange('2025-12-29')).toBe('Dec 29 – Jan 4');
  });
});

describe('currentWeekKey', () => {
  it('derives the week from an injected date', () => {
    expect(currentWeekKey(new Date(2026, 6, 29))).toBe('2026-07-27');
    expect(currentWeekKey(new Date(2026, 0, 1))).toBe('2025-12-29');
  });
});

describe('month helpers', () => {
  it('finds the first of the month', () => {
    expect(monthStart('2026-07-29')).toBe('2026-07-01');
    expect(monthStart('2026-07-01')).toBe('2026-07-01');
  });

  it('clamps the day when shifting months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'); // leap year
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15');
  });

  it('crosses the year boundary', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-15');
  });

  it('builds a whole-week month grid', () => {
    const grid = monthGridDates('2026-07-15');
    expect(grid.length % 7).toBe(0);
    expect(weekdayOf(grid[0])).toBe(1); // starts Monday
    expect(weekdayOf(grid[grid.length - 1])).toBe(0); // ends Sunday
    // July 2026 starts on a Wednesday, so the grid opens on Mon Jun 29.
    expect(grid[0]).toBe('2026-06-29');
    expect(grid).toContain('2026-07-01');
    expect(grid).toContain('2026-07-31');
  });

  it('builds a grid for a month that starts on a Monday', () => {
    // 2026-06-01 is a Monday — no leading spill.
    const grid = monthGridDates('2026-06-10');
    expect(grid[0]).toBe('2026-06-01');
    expect(grid.length % 7).toBe(0);
  });

  it('compares months', () => {
    expect(isSameMonth('2026-07-01', '2026-07-31')).toBe(true);
    expect(isSameMonth('2026-07-31', '2026-08-01')).toBe(false);
    expect(isSameMonth('2025-07-01', '2026-07-01')).toBe(false);
  });
});

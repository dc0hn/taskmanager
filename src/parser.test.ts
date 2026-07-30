import { describe, it, expect } from 'vitest';
import { parseTaskLine } from './parser';
import { format12h, formatHourLabel } from './utils/time';

// These tests LOCK current parser behavior (they document, not redesign it).
describe('parseTaskLine', () => {
  it('parses duration + priority + category and strips the tokens from the title', () => {
    expect(parseTaskLine('Deep work on proposal 90m !high #deep')).toEqual({
      title: 'Deep work on proposal',
      duration: 90,
      priority: 'high',
      category: 'deep',
    });
  });

  it('parses an @-prefixed fixed time with duration and category', () => {
    expect(parseTaskLine('Client call @2pm 30m #admin')).toEqual({
      title: 'Client call',
      fixedTime: 14 * 60,
      duration: 30,
      category: 'admin',
    });
  });

  it('parses a time range into fixedTime + duration', () => {
    expect(parseTaskLine('2pm-4pm Strategy sync')).toEqual({
      title: 'Strategy sync',
      fixedTime: 14 * 60,
      duration: 120,
    });
  });

  it('parses a shared-period range (2-4pm)', () => {
    expect(parseTaskLine('2-4pm review')).toEqual({
      title: 'review',
      fixedTime: 14 * 60,
      duration: 120,
    });
  });

  it('parses "to" ranges (2pm to 4pm)', () => {
    expect(parseTaskLine('2pm to 4pm planning')).toEqual({
      title: 'planning',
      fixedTime: 14 * 60,
      duration: 120,
    });
  });

  it('accepts a bare 24h time only when it has a colon', () => {
    expect(parseTaskLine('14:00 standup')).toEqual({
      title: 'standup',
      fixedTime: 14 * 60,
    });
  });

  it('does NOT treat a bare 4-digit number as a time (no colon / am-pm / @)', () => {
    expect(parseTaskLine('Backup 1430 files')).toEqual({
      title: 'Backup 1430 files',
    });
  });

  it('parses 12h with minutes and meridiem (@2:30pm, 12:30pm)', () => {
    expect(parseTaskLine('@2:30pm dentist')).toEqual({
      title: 'dentist',
      fixedTime: 14 * 60 + 30,
    });
    expect(parseTaskLine('12:30pm lunch')).toEqual({
      title: 'lunch',
      fixedTime: 12 * 60 + 30,
    });
  });

  it('parses compound and hour durations', () => {
    expect(parseTaskLine('1h30m planning')).toMatchObject({ duration: 90 });
    expect(parseTaskLine('2h workshop')).toMatchObject({ duration: 120 });
    expect(parseTaskLine('45m email')).toMatchObject({ duration: 45 });
  });

  it('recognizes priority aliases', () => {
    expect(parseTaskLine('p1 urgent thing')).toMatchObject({ priority: 'high', title: 'urgent thing' });
    expect(parseTaskLine('!normal routine')).toMatchObject({ priority: 'normal', title: 'routine' });
  });

  it('recognizes category aliases (#focus -> deep, #lunch -> break)', () => {
    expect(parseTaskLine('#focus session')).toMatchObject({ category: 'deep' });
    expect(parseTaskLine('#lunch with Sam')).toMatchObject({ category: 'break' });
  });

  it('leaves a plain line as just a title with no inferred fields', () => {
    expect(parseTaskLine('just a plain title')).toEqual({ title: 'just a plain title' });
  });
});

describe('clock labels wrap at midnight', () => {
  it('never shows the afternoon twice', () => {
    // The visible symptom of the missing reflow ceiling: with no `% 24`, values at or
    // past 1440 read as noon onward, and the grid drew "10 PM, 11 PM, 12 PM, 1 PM".
    expect(formatHourLabel(1440)).toBe('12 AM');
    expect(formatHourLabel(1500)).toBe('1 AM');
    expect(formatHourLabel(1560)).toBe('2 AM');
    expect(format12h(1470)).toBe('12:30 am');
    expect(format12h(1530)).toBe('1:30 am');
  });

  it('still reads the ordinary day correctly', () => {
    expect(formatHourLabel(0)).toBe('12 AM');
    expect(formatHourLabel(540)).toBe('9 AM');
    expect(formatHourLabel(720)).toBe('12 PM');
    expect(formatHourLabel(780)).toBe('1 PM');
    expect(formatHourLabel(1380)).toBe('11 PM');
    expect(format12h(0)).toBe('12:00 am');
    expect(format12h(720)).toBe('12:00 pm');
    expect(format12h(1425)).toBe('11:45 pm');
  });

  it('wraps a whole extra day rather than accumulating', () => {
    expect(formatHourLabel(2880)).toBe('12 AM');
    expect(formatHourLabel(2880 + 540)).toBe('9 AM');
  });
});

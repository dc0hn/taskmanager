import { describe, it, expect } from 'vitest';
import { parseTaskLine } from './parser';

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

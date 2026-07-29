import { describe, it, expect } from 'vitest';
import { buildSchedule } from './scheduler';
import type { Block, Task } from './types';

const DAY_START = 8 * 60; // 480
const DAY_END = 19 * 60; // 1140

let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${n++}`,
  title: 'Task',
  duration: 60,
  category: 'admin',
  priority: 'normal',
  ...over,
});

const real = (blocks: Block[]) => blocks.filter((b) => !b.auto);
const autos = (blocks: Block[]) => blocks.filter((b) => b.auto);

// These tests LOCK current scheduler behavior.
describe('buildSchedule', () => {
  it('returns only a shutdown block for an empty day', () => {
    const { blocks, overflow } = buildSchedule([], DAY_START, DAY_END);
    expect(overflow).toEqual([]);
    expect(real(blocks)).toHaveLength(0);
    const shutdown = autos(blocks).find((b) => b.title === 'Shutdown');
    expect(shutdown).toMatchObject({ start: DAY_END - 15, end: DAY_END, auto: true });
  });

  it('overflows everything when the window is empty/invalid', () => {
    const t = task();
    const { blocks, overflow } = buildSchedule([t], 600, 600);
    expect(blocks).toEqual([]);
    expect(overflow).toEqual([t]);
  });

  it('places a flexible task at the start of the window', () => {
    const { blocks } = buildSchedule([task({ duration: 60, category: 'deep' })], DAY_START, DAY_END);
    const placed = real(blocks);
    expect(placed).toHaveLength(1);
    expect(placed[0]).toMatchObject({ start: DAY_START, end: DAY_START + 60, category: 'deep' });
  });

  it('honors a fixed-time task as an anchor', () => {
    const { blocks } = buildSchedule(
      [task({ duration: 30, category: 'admin', fixedTime: 600 })],
      DAY_START,
      DAY_END
    );
    const anchor = real(blocks).find((b) => b.start === 600);
    expect(anchor).toMatchObject({ start: 600, end: 630, category: 'admin' });
  });

  it('overflows a task that cannot fit the remaining window', () => {
    const big = task({ duration: 700, category: 'admin' }); // > window minus shutdown
    const { overflow } = buildSchedule([big], DAY_START, DAY_END);
    expect(overflow).toContainEqual(big);
  });

  it('inserts a recovery break after ~90 min of sustained work', () => {
    const { blocks } = buildSchedule(
      [task({ duration: 90, category: 'deep' }), task({ duration: 60, category: 'admin' })],
      DAY_START,
      DAY_END
    );
    const brk = blocks.find((b) => b.auto && b.title === 'Break');
    expect(brk).toBeDefined();
    // deep is front-loaded, break follows it, admin comes after the break
    const deep = blocks.find((b) => b.category === 'deep')!;
    const admin = real(blocks).find((b) => b.category === 'admin')!;
    expect(brk!.start).toBeGreaterThanOrEqual(deep.end);
    expect(admin.start).toBeGreaterThanOrEqual(brk!.end);
  });

  it('splits a long deep task into <=90-min chunks', () => {
    const { blocks } = buildSchedule(
      [task({ duration: 180, category: 'deep', title: 'Write spec' })],
      DAY_START,
      DAY_END
    );
    const chunks = real(blocks).filter((b) => b.title.startsWith('Write spec'));
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    chunks.forEach((c) => expect(c.end - c.start).toBeLessThanOrEqual(90));
    expect(chunks.some((c) => c.title.includes('(1/'))).toBe(true);
  });

  it('keeps preserved blocks in place and schedules around them', () => {
    const preserved: Block = {
      id: 'p1',
      title: 'Existing meeting',
      start: DAY_START,
      end: DAY_START + 60,
      category: 'admin',
    };
    const { blocks } = buildSchedule(
      [task({ duration: 60, category: 'deep' })],
      DAY_START,
      DAY_END,
      [preserved]
    );
    expect(blocks.find((b) => b.id === 'p1')).toMatchObject({ start: DAY_START, end: DAY_START + 60 });
    const deep = real(blocks).find((b) => b.category === 'deep')!;
    // does not overlap the preserved block
    expect(deep.start >= preserved.end || deep.end <= preserved.start).toBe(true);
  });
});

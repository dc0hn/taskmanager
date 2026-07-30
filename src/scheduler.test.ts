import { describe, it, expect } from 'vitest';
import { buildSchedule, rulesFor } from './scheduler';
import { DEFAULT_CATEGORIES } from './types';
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

describe('the frog gets first claim on the day (S1)', () => {
  it('does not let smaller work eat the only interval it fits in', () => {
    // The reported failure. A 90-minute high-priority focus task, a morning gap too small
    // for it, and enough small work to consume the afternoon. First-fit placed the small
    // work everywhere and then reported "the largest gap left is 45m" — true, and the
    // exact opposite of what the eat-the-frog sort was expressing.
    const frog = task({
      id: 'frog',
      title: 'The frog',
      duration: 90,
      category: 'deep',
      priority: 'high',
    });
    const filler = Array.from({ length: 8 }, (_, i) =>
      task({ id: `small${i}`, title: `Small ${i}`, duration: 45, category: 'admin' })
    );

    const { blocks, overflow } = buildSchedule(
      [...filler, frog],
      DAY_START,
      DAY_START + 420, // seven hours, enough for the frog plus most of the filler
      [],
      rulesFor(DEFAULT_CATEGORIES)
    );

    expect(overflow.map((t) => t.id)).not.toContain('frog');
    const placed = real(blocks).find((b) => b.id === 'frog')!;
    expect(placed).toBeDefined();
    // And it goes FIRST, which is what eat-the-frog means.
    expect(placed.start).toBe(DAY_START);
  });

  it('claims for several frogs in queue order, so they stay chronological', () => {
    const a = task({ id: 'frogA', duration: 90, category: 'deep', priority: 'high' });
    const b = task({ id: 'frogB', duration: 90, category: 'deep', priority: 'high' });
    const { blocks } = buildSchedule(
      [task({ duration: 30, category: 'admin' }), a, b],
      DAY_START,
      DAY_END,
      [],
      rulesFor(DEFAULT_CATEGORIES)
    );
    const placedA = real(blocks).find((x) => x.id === 'frogA')!;
    const placedB = real(blocks).find((x) => x.id === 'frogB')!;
    expect(placedA.start).toBeLessThan(placedB.start);
  });

  it('keeps the recovery break after a claimed long block', () => {
    // Carving the frog out splits the free interval, and the fill loop resets its fatigue
    // counter per interval — so the reservation has to emit the break itself or the
    // ritual silently disappears for exactly the longest block of the day.
    const frog = task({ id: 'frog', duration: 90, category: 'deep', priority: 'high' });
    const { blocks } = buildSchedule(
      [frog, task({ duration: 60, category: 'admin' })],
      DAY_START,
      DAY_END,
      [],
      rulesFor(DEFAULT_CATEGORIES)
    );
    const placed = real(blocks).find((b) => b.id === 'frog')!;
    const breakAfter = autos(blocks).find(
      (b) => b.title === 'Break' && b.start === placed.end
    );
    expect(breakAfter).toBeDefined();
  });

  it('still overflows a frog that fits nowhere, with a reason', () => {
    // Deliberately under the 120-minute split threshold, so this stays one task and the
    // reservation pass has a single indivisible thing that cannot be placed. A longer
    // focus task would be chunked first and the chunks are what overflow, which is
    // correct but tests something else.
    const frog = task({ id: 'frog', duration: 110, category: 'deep', priority: 'high' });
    const { overflow, reasons } = buildSchedule(
      [frog],
      DAY_START,
      DAY_START + 60,
      [],
      rulesFor(DEFAULT_CATEGORIES)
    );
    expect(overflow.map((t) => t.id)).toContain('frog');
    expect(reasons['frog']).toBeTruthy();
  });
});

describe('splitting long focus work loses no minutes (S2)', () => {
  const totalOf = (blocks: Block[], prefix: string) =>
    real(blocks)
      .filter((b) => b.id.startsWith(prefix))
      .reduce((sum, b) => sum + (b.end - b.start), 0);

  it('keeps every minute of a duration that does not divide evenly', () => {
    // 200 minutes over three chunks snaps to 70 + 70 + 60. The old code hit a sub-15
    // remainder on some durations and `break`ed, so those minutes appeared in no block and
    // in no overflow reason — the task quietly became shorter than asked for.
    for (const duration of [125, 130, 155, 185, 200, 215, 245, 275, 305]) {
      const t = task({ id: 'long', duration, category: 'deep' });
      const { blocks, overflow } = buildSchedule([t], DAY_START, DAY_START + 600, [], rulesFor(DEFAULT_CATEGORIES));
      if (overflow.length > 0) continue; // couldn't fit at all; not what this asserts
      expect(totalOf(blocks, 'long'), `duration ${duration}`).toBe(duration);
    }
  });

  it('never emits a chunk shorter than the minimum', () => {
    for (const duration of [125, 155, 185, 215, 305]) {
      const t = task({ id: 'long', duration, category: 'deep' });
      const { blocks } = buildSchedule([t], DAY_START, DAY_START + 600, [], rulesFor(DEFAULT_CATEGORIES));
      for (const b of real(blocks).filter((x) => x.id.startsWith('long'))) {
        expect(b.end - b.start, `duration ${duration}`).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it('numbers the chunks it actually produced', () => {
    // A folded remainder means one fewer chunk than the original estimate, so the titles
    // have to be written after the fold rather than during it.
    const t = task({ id: 'long', title: 'Write', duration: 185, category: 'deep' });
    const { blocks } = buildSchedule([t], DAY_START, DAY_START + 600, [], rulesFor(DEFAULT_CATEGORIES));
    const chunks = real(blocks).filter((b) => b.id.startsWith('long'));
    for (const c of chunks) {
      expect(c.title).toMatch(new RegExp(`\\(\\d+/${chunks.length}\\)$`));
    }
  });
});

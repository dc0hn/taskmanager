import { describe, it, expect } from 'vitest';
import { clearToIntake, hasClearableBlocks } from './unschedule';
import type { Block } from './types';

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  title: 'Write the report',
  start: 540,
  end: 600,
  category: 'deep',
  ...over,
});

describe('clearToIntake', () => {
  it('returns an ordinary block to the queue', () => {
    const { kept, returned } = clearToIntake([block()]);
    expect(kept).toEqual([]);
    expect(returned).toHaveLength(1);
    expect(returned[0]).toMatchObject({ id: 'b1', title: 'Write the report', duration: 60 });
  });

  it('NEVER moves a pinned entry', () => {
    // The whole point of the button, and the one thing it must not do. A pinned block
    // is a commitment to a time and leaves only through its own editor.
    const pinned = block({ id: 'p1', pinned: true });
    const { kept, returned, pinnedKept } = clearToIntake([pinned, block({ id: 'b2' })]);
    expect(kept).toEqual([pinned]);
    expect(returned.map((t) => t.id)).toEqual(['b2']);
    expect(pinnedKept).toBe(1);
  });

  it('keeps a pinned entry even when it is also completed or automatic', () => {
    const cases = [
      block({ id: 'p1', pinned: true, completed: true }),
      block({ id: 'p2', pinned: true, auto: true }),
    ];
    for (const b of cases) {
      expect(clearToIntake([b]).kept, b.id).toEqual([b]);
    }
  });

  it('keeps completed work, because returning it would unearn the day', () => {
    // Reconciliation scores a day from its blocks and applies the DIFFERENCE, so a
    // completed block sent back to the intake takes its XP, its brass and its goal
    // credits with it. A button for redoing this afternoon must not unearn this
    // morning.
    const done = block({ id: 'd1', completed: true });
    const { kept, returned } = clearToIntake([done, block({ id: 'b2' })]);
    expect(kept).toEqual([done]);
    expect(returned.map((t) => t.id)).toEqual(['b2']);
  });

  it('drops auto blocks rather than returning them', () => {
    // They are the scheduler's bookkeeping and it writes fresh ones on the next build.
    // Returning them would put "Break" in the intake as though it were work, and every
    // clear-and-rebuild would breed another one.
    const { kept, returned } = clearToIntake([
      block({ id: 'a1', title: 'Break', auto: true }),
      block({ id: 'a2', title: 'Shutdown', auto: true }),
      block({ id: 'b2' }),
    ]);
    expect(kept).toEqual([]);
    expect(returned.map((t) => t.id)).toEqual(['b2']);
  });

  it('carries every field the block held', () => {
    const { returned } = clearToIntake([
      block({
        priority: 'high',
        goalId: 'g1',
        templateId: 'tpl1',
        notes: 'https://meet.google.com/abc-defg-hij',
        keepWhole: true,
      }),
    ]);
    expect(returned[0]).toMatchObject({
      priority: 'high',
      goalId: 'g1',
      templateId: 'tpl1',
      notes: 'https://meet.google.com/abc-defg-hij',
      keepWhole: true,
    });
  });

  it('takes the duration from the block as it now stands, not as it was scheduled', () => {
    // A block dragged longer keeps the length you gave it.
    const { returned } = clearToIntake([block({ start: 600, end: 780 })]);
    expect(returned[0].duration).toBe(180);
  });

  it('defaults a block with no priority to normal rather than undefined', () => {
    expect(clearToIntake([block()]).returned[0].priority).toBe('normal');
  });

  it('preserves the order of what stays', () => {
    const a = block({ id: 'a', pinned: true, start: 540, end: 600 });
    const b = block({ id: 'b', completed: true, start: 600, end: 660 });
    const c = block({ id: 'c', pinned: true, start: 660, end: 720 });
    expect(clearToIntake([a, b, c]).kept.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('does nothing to a day that is entirely pinned and finished', () => {
    const blocks = [block({ id: 'p', pinned: true }), block({ id: 'd', completed: true })];
    const { kept, returned } = clearToIntake(blocks);
    expect(kept).toEqual(blocks);
    expect(returned).toEqual([]);
  });

  it('is idempotent — clearing twice changes nothing the second time', () => {
    const first = clearToIntake([block({ id: 'p', pinned: true }), block({ id: 'b' })]);
    const second = clearToIntake(first.kept);
    expect(second.returned).toEqual([]);
    expect(second.kept).toEqual(first.kept);
  });

  it('handles an empty day', () => {
    expect(clearToIntake([])).toEqual({ kept: [], returned: [], pinnedKept: 0 });
  });

  it('counts only outstanding pinned work, not pinned work already done', () => {
    const blocks = [
      block({ id: 'p1', pinned: true }),
      block({ id: 'p2', pinned: true, completed: true }),
    ];
    expect(clearToIntake(blocks).pinnedKept).toBe(1);
  });
});

describe('hasClearableBlocks', () => {
  it('is false when there is nothing the button would move', () => {
    expect(hasClearableBlocks([])).toBe(false);
    expect(hasClearableBlocks([block({ pinned: true })])).toBe(false);
    expect(hasClearableBlocks([block({ completed: true })])).toBe(false);
    expect(hasClearableBlocks([block({ auto: true })])).toBe(false);
  });

  it('is true as soon as one ordinary block exists', () => {
    expect(hasClearableBlocks([block({ pinned: true }), block({ id: 'b2' })])).toBe(true);
  });

  it('agrees with what clearToIntake would actually do', () => {
    // The control must not offer an action that turns out to be a no-op, and must not
    // hide one that would work.
    const days: Block[][] = [
      [],
      [block()],
      [block({ pinned: true })],
      [block({ completed: true })],
      [block({ auto: true })],
      [block({ pinned: true }), block({ id: 'x' })],
      [block({ auto: true }), block({ completed: true })],
    ];
    for (const blocks of days) {
      expect(hasClearableBlocks(blocks)).toBe(clearToIntake(blocks).returned.length > 0);
    }
  });
});

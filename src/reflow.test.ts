import { describe, it, expect } from 'vitest';
import {
  ADJACENCY_TOLERANCE,
  isImmovable,
  reflowInsert,
  reflowPlace,
  reflowRemove,
} from './reflow';
import type { Block } from './types';

const DAY_END = 19 * 60; // 1140

const b = (
  id: string,
  start: number,
  end: number,
  over: Partial<Block> = {}
): Block => ({ id, title: id, start, end, category: 'other', ...over });

/** Compact readable snapshot: "id:start-end" in schedule order. */
const shape = (blocks: Block[]) =>
  [...blocks].sort((x, y) => x.start - y.start).map((x) => `${x.id}:${x.start}-${x.end}`);

const at = (blocks: Block[], id: string) => blocks.find((x) => x.id === id)!;

// ---------------------------------------------------------------------------

describe('isImmovable', () => {
  it('protects completed and pinned work, nothing else', () => {
    expect(isImmovable(b('a', 0, 60))).toBe(false);
    expect(isImmovable(b('a', 0, 60, { completed: true }))).toBe(true);
    expect(isImmovable(b('a', 0, 60, { pinned: true }))).toBe(true);
    // Auto blocks deliberately DO reflow — you cannot grab a break, but
    // inserting work above one should carry it along.
    expect(isImmovable(b('a', 0, 60, { auto: true }))).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('reflowPlace — making room', () => {
  it('pushes a colliding block down by the minimum that clears it', () => {
    const day = [b('move', 480, 540), b('x', 600, 660)];
    // Drop `move` onto `x`.
    const r = reflowPlace(day, 'move', 600, 660, DAY_END);
    expect(r.ok).toBe(true);
    expect(shape(r.blocks)).toEqual(['move:600-660', 'x:660-720']);
    expect(r.movedIds).toEqual(['x']);
  });

  it('moves nothing when the destination already has room', () => {
    // A 45-minute block into a 60-minute gap: existing breathing room survives.
    const day = [b('move', 480, 525), b('x', 600, 660), b('y', 720, 780)];
    const r = reflowPlace(day, 'move', 660, 705, DAY_END);
    expect(r.ok).toBe(true);
    expect(r.movedIds).toEqual([]);
    expect(shape(r.blocks)).toEqual(['x:600-660', 'move:660-705', 'y:720-780']);
  });

  it('cascades down a back-to-back chain', () => {
    const day = [b('move', 900, 960), b('x', 600, 660), b('y', 660, 720)];
    const r = reflowPlace(day, 'move', 600, 660, DAY_END);
    expect(r.ok).toBe(true);
    expect(shape(r.blocks)).toEqual(['move:600-660', 'x:660-720', 'y:720-780']);
    expect(r.movedIds.sort()).toEqual(['x', 'y']);
  });

  it('stops cascading as soon as there is room', () => {
    // x gets pushed 30 min into the gap before y; y never needs to move.
    const day = [b('move', 900, 960), b('x', 600, 660), b('y', 780, 840)];
    const r = reflowPlace(day, 'move', 630, 690, DAY_END);
    expect(r.ok).toBe(true);
    expect(at(r.blocks, 'x')).toMatchObject({ start: 690, end: 750 });
    expect(at(r.blocks, 'y')).toMatchObject({ start: 780, end: 840 });
    expect(r.movedIds).toEqual(['x']);
  });

  it('pushes a partial overlap only as far as the overlap', () => {
    const day = [b('move', 900, 960), b('x', 600, 660)];
    // Overlaps x's first 30 minutes.
    const r = reflowPlace(day, 'move', 570, 630, DAY_END);
    expect(at(r.blocks, 'x')).toMatchObject({ start: 630, end: 690 });
  });
});

describe('reflowPlace — closing the vacated slot', () => {
  it('slides an adjacent run up to fill the hole', () => {
    const day = [b('move', 480, 540), b('x', 540, 600), b('y', 600, 660)];
    // Move the first block far away; the run behind it compacts by 60.
    const r = reflowPlace(day, 'move', 900, 960, DAY_END);
    expect(r.ok).toBe(true);
    expect(shape(r.blocks)).toEqual(['x:480-540', 'y:540-600', 'move:900-960']);
  });

  // The rule that matters most. A naive "pull everything after it upward" would
  // drag an afternoon meeting into the morning.
  it('does NOT pull up a block separated by real empty time', () => {
    const day = [b('move', 480, 540), b('meeting', 840, 900)];
    const r = reflowPlace(day, 'move', 1000, 1060, DAY_END);
    expect(r.ok).toBe(true);
    expect(at(r.blocks, 'meeting')).toMatchObject({ start: 840, end: 900 });
  });

  it('closes only up to the end of the run', () => {
    const day = [
      b('move', 480, 540),
      b('x', 540, 600), // adjacent — slides up
      b('far', 800, 860), // real gap — stays
    ];
    const r = reflowPlace(day, 'move', 1000, 1040, DAY_END);
    expect(shape(r.blocks)).toEqual(['x:480-540', 'far:800-860', 'move:1000-1040']);
  });

  it('treats a gap within the snap tolerance as part of the run', () => {
    const day = [b('move', 480, 540), b('x', 540 + ADJACENCY_TOLERANCE, 600)];
    const r = reflowPlace(day, 'move', 1000, 1060, DAY_END);
    expect(at(r.blocks, 'x').start).toBeLessThan(545);
  });

  it('does not slide a completed block up into the hole', () => {
    const day = [b('move', 480, 540), b('done', 540, 600, { completed: true })];
    const r = reflowPlace(day, 'move', 900, 960, DAY_END);
    expect(at(r.blocks, 'done')).toMatchObject({ start: 540, end: 600 });
  });

  it('leaves the day alone when the block did not actually move', () => {
    const day = [b('a', 480, 540), b('x', 540, 600)];
    const r = reflowPlace(day, 'a', 480, 540, DAY_END);
    expect(shape(r.blocks)).toEqual(['a:480-540', 'x:540-600']);
    expect(r.movedIds).toEqual([]);
  });

  it('compacts behind a shrink', () => {
    const day = [b('a', 480, 600), b('x', 600, 660)];
    // Resize `a` from 120 to 60 minutes; the run closes up behind it.
    const r = reflowPlace(day, 'a', 480, 540, DAY_END);
    expect(shape(r.blocks)).toEqual(['a:480-540', 'x:540-600']);
  });

  it('pushes down when a block is extended', () => {
    const day = [b('a', 480, 540), b('x', 540, 600)];
    const r = reflowPlace(day, 'a', 480, 600, DAY_END);
    expect(shape(r.blocks)).toEqual(['a:480-600', 'x:600-660']);
  });
});

describe('reflowPlace — immovable work', () => {
  it('refuses when a completed block holds the destination', () => {
    const day = [b('move', 900, 960), b('done', 600, 660, { completed: true })];
    const r = reflowPlace(day, 'move', 600, 660, DAY_END);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('done');
    expect(r.message).toContain('“done”');
    expect(shape(r.blocks)).toEqual(shape(day)); // unchanged
  });

  it('refuses when a pinned block holds the destination, and names it', () => {
    const day = [b('move', 900, 960), b('Client call', 600, 660, { pinned: true })];
    const r = reflowPlace(day, 'move', 620, 680, DAY_END);
    expect(r.ok).toBe(false);
    expect(r.message).toBe('Can’t make room there — “Client call” is pinned.');
  });

  it('steps over an immovable further down the chain instead of refusing', () => {
    const day = [
      b('move', 900, 960),
      b('x', 600, 660),
      b('pinned', 660, 720, { pinned: true }),
    ];
    // Inserting at 600 pushes x down, but x cannot displace the pinned block —
    // so x lands after it and the move still succeeds.
    const r = reflowPlace(day, 'move', 600, 660, DAY_END);
    expect(r.ok).toBe(true);
    expect(at(r.blocks, 'pinned')).toMatchObject({ start: 660, end: 720 });
    expect(at(r.blocks, 'x').start).toBeGreaterThanOrEqual(720);
  });

  it('lets you deliberately drag a pinned block yourself', () => {
    // Pinning resists being *pushed*; it does not lock the block against an
    // explicit drag.
    const day = [b('p', 480, 540, { pinned: true })];
    const r = reflowPlace(day, 'p', 900, 960, DAY_END);
    expect(r.ok).toBe(true);
    expect(at(r.blocks, 'p')).toMatchObject({ start: 900, end: 960 });
  });
});

describe('reflowPlace — spilling past the working day', () => {
  it('allows the spill and reports how far', () => {
    const day = [b('move', 480, 540), b('x', DAY_END - 60, DAY_END)];
    const r = reflowPlace(day, 'move', DAY_END - 60, DAY_END, DAY_END);
    expect(r.ok).toBe(true);
    expect(r.spillMinutes).toBe(60);
    expect(at(r.blocks, 'x').end).toBe(DAY_END + 60);
  });

  it('reports no spill when everything still fits', () => {
    const day = [b('move', 480, 540), b('x', 600, 660)];
    const r = reflowPlace(day, 'move', 600, 660, DAY_END);
    expect(r.spillMinutes).toBe(0);
  });
});

describe('reflowPlace — validation', () => {
  it('refuses a zero-length or inverted placement', () => {
    const day = [b('a', 480, 540)];
    expect(reflowPlace(day, 'a', 500, 500, DAY_END).ok).toBe(false);
    expect(reflowPlace(day, 'a', 540, 480, DAY_END).ok).toBe(false);
  });

  it('is a no-op for an unknown id', () => {
    const day = [b('a', 480, 540)];
    const r = reflowPlace(day, 'nope', 600, 660, DAY_END);
    expect(r.ok).toBe(false);
    expect(r.blocks).toBe(day);
  });
});

// ---------------------------------------------------------------------------

describe('reflowInsert — a block arriving from another day', () => {
  it('makes room without compacting anything', () => {
    const day = [b('x', 600, 660)];
    const r = reflowInsert(day, b('in', 600, 690), DAY_END);
    expect(r.ok).toBe(true);
    expect(shape(r.blocks)).toEqual(['in:600-690', 'x:690-750']);
  });

  it('lands cleanly in a free slot', () => {
    const day = [b('x', 600, 660)];
    const r = reflowInsert(day, b('in', 700, 760), DAY_END);
    expect(r.movedIds).toEqual([]);
    expect(shape(r.blocks)).toEqual(['x:600-660', 'in:700-760']);
  });

  it('refuses when an immovable holds the landing slot', () => {
    const day = [b('done', 600, 660, { completed: true })];
    const r = reflowInsert(day, b('in', 610, 670), DAY_END);
    expect(r.ok).toBe(false);
    expect(r.blocks).toBe(day);
  });
});

describe('reflowRemove — the day a block left', () => {
  it('closes the hole for the run behind it', () => {
    const day = [b('gone', 480, 540), b('x', 540, 600), b('y', 600, 660)];
    const r = reflowRemove(day, 'gone', DAY_END);
    expect(shape(r.blocks)).toEqual(['x:480-540', 'y:540-600']);
  });

  it('leaves distant blocks where they were', () => {
    const day = [b('gone', 480, 540), b('meeting', 840, 900)];
    const r = reflowRemove(day, 'gone', DAY_END);
    expect(shape(r.blocks)).toEqual(['meeting:840-900']);
  });

  it('is a no-op for an unknown id', () => {
    const day = [b('a', 480, 540)];
    expect(reflowRemove(day, 'nope', DAY_END).blocks).toBe(day);
  });
});

// ---------------------------------------------------------------------------

describe('reflow — invariants', () => {
  const overlapping = (blocks: Block[]) => {
    const s = [...blocks].sort((x, y) => x.start - y.start);
    for (let i = 1; i < s.length; i++) {
      if (s[i].start < s[i - 1].end) return `${s[i - 1].id} / ${s[i].id}`;
    }
    return null;
  };

  it('never produces overlapping blocks across a spread of placements', () => {
    const day = [
      b('a', 480, 540),
      b('bb', 540, 600),
      b('c', 600, 690),
      b('d', 780, 840),
      b('done', 900, 960, { completed: true }),
      b('pin', 1000, 1040, { pinned: true }),
    ];
    for (let start = 460; start <= 1080; start += 5) {
      const r = reflowPlace(day, 'c', start, start + 90, DAY_END);
      if (!r.ok) continue;
      expect(overlapping(r.blocks)).toBeNull();
      expect(r.blocks).toHaveLength(day.length);
    }
  });

  it('preserves every block and its duration', () => {
    const day = [b('a', 480, 540), b('bb', 540, 660), b('c', 700, 760)];
    const r = reflowPlace(day, 'a', 700, 760, DAY_END);
    expect(r.blocks.map((x) => x.id).sort()).toEqual(['a', 'bb', 'c']);
    for (const original of day) {
      const now = at(r.blocks, original.id);
      expect(now.end - now.start).toBe(original.end - original.start);
    }
  });

  it('is idempotent — placing a block where it already is changes nothing', () => {
    const day = [b('a', 480, 540), b('bb', 540, 600)];
    const once = reflowPlace(day, 'a', 600, 660, DAY_END);
    const twice = reflowPlace(once.blocks, 'a', 600, 660, DAY_END);
    expect(shape(twice.blocks)).toEqual(shape(once.blocks));
  });
});

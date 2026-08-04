import { describe, it, expect } from 'vitest';
import { MARK, RINGS } from './components/pixel/bootMark';

// ============================================================================
// The opening mark, asserted rather than eyeballed — which matters here more than usual,
// because the whole thing is a visual and the geometry is the only part that can be checked
// without looking at it.
//
// Derived from the component's own arrays rather than a copy of them. A second copy of a
// shape is the same hazard as a second copy of a threshold: it agrees until someone edits
// one of the two.
// ============================================================================

const GRID = MARK.length;

describe('the opening mark', () => {
  it('is square, and every row is as wide as the grid', () => {
    for (const row of MARK) expect(row).toHaveLength(GRID);
  });

  it('is symmetric about both axes', () => {
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        expect(MARK[y][x], `horizontal at ${x},${y}`).toBe(MARK[y][GRID - 1 - x]);
        expect(MARK[y][x], `vertical at ${x},${y}`).toBe(MARK[GRID - 1 - y][x]);
      }
    }
  });

  it('has no stroke thinner than two cells', () => {
    // The same rule the rank sigil follows: a one-cell line is sub-pixel at small sizes and
    // mushes into nothing. Checked as "no filled cell stands alone on both axes".
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        if (MARK[y][x] !== '#') continue;
        const horizontal = MARK[y][x - 1] === '#' || MARK[y][x + 1] === '#';
        const vertical = MARK[y - 1]?.[x] === '#' || MARK[y + 1]?.[x] === '#';
        expect(horizontal || vertical, `lone cell at ${x},${y}`).toBe(true);
      }
    }
  });
});

describe('how it is struck', () => {
  it('grows in four concentric rings', () => {
    expect(RINGS).toHaveLength(4);
    expect(RINGS.map((r) => r.length)).toEqual([4, 8, 8, 8]);
  });

  it('covers every filled cell exactly once', () => {
    const filled = MARK.join('').split('').filter((c) => c === '#').length;
    const struck = RINGS.flat();
    expect(struck).toHaveLength(filled);
    expect(new Set(struck.map((c) => `${c.x},${c.y}`)).size).toBe(filled);
  });

  it('strikes outward, never back toward the middle', () => {
    const centre = (GRID - 1) / 2;
    const distances = RINGS.map((ring) => Math.hypot(ring[0].x - centre, ring[0].y - centre));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThan(distances[i - 1]);
    }
  });

  it('keeps every cell in a ring at one distance from the centre', () => {
    // The rounding is what makes this hold: these are irrational lengths, and floating-point
    // equality would split a ring in two over the last bit of a mantissa.
    const centre = (GRID - 1) / 2;
    for (const ring of RINGS) {
      const ds = ring.map((c) => Math.round(Math.hypot(c.x - centre, c.y - centre) * 1000));
      expect(new Set(ds).size).toBe(1);
    }
  });

  it('is symmetric at EVERY frame, not only when finished', () => {
    // The bug this guards, which shipped once: sorting cells by distance and giving each its
    // own step looks radial written down, but equidistant cells then fire one after another
    // in whatever order the sort settled them — so the mark assembles one cell at a time and
    // reads as a lopsided spiral rather than a shape growing.
    let struck: { x: number; y: number }[] = [];
    for (const ring of RINGS) {
      struck = [...struck, ...ring];
      const on = new Set(struck.map((c) => `${c.x},${c.y}`));
      for (const { x, y } of struck) {
        expect(on.has(`${GRID - 1 - x},${y}`), `horizontal at ${x},${y}`).toBe(true);
        expect(on.has(`${x},${GRID - 1 - y}`), `vertical at ${x},${y}`).toBe(true);
      }
    }
  });
});

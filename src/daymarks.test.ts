import { describe, it, expect } from 'vitest';
import {
  applyProposal,
  cellRect,
  countMarksInMonth,
  cycleMark,
  describeMarks,
  dominantMarkColor,
  frameIsUsable,
  hueCollisions,
  hueDistance,
  isNeutral,
  markForDate,
  matchMark,
  orphanedMarks,
  rgbToHsl,
  rowsNeeded,
  setMark,
  gridCells,
  defaultFirstCell,
  monthsCovered,
} from './daymarks';
import type { DayMarkDef, DayMarks } from './types';

const DEFS: DayMarkDef[] = [
  { id: 'travel', label: 'Travel', color: '#4a9eff', order: 0 }, // blue, hue ~212
  { id: 'gig', label: 'Gig', color: '#f472b6', order: 1 }, // pink, hue ~330
  { id: 'off', label: 'Off', color: '#6fbf8b', order: 2 }, // green, hue ~140
];

const rgb = (r: number, g: number, b: number) => ({ r, g, b });

/** Build an RGBA buffer of a solid colour, optionally with a text-like blot. */
function buffer(
  w: number,
  h: number,
  fill: { r: number; g: number; b: number },
  blot?: { x: number; y: number; w: number; h: number; r: number; g: number; b: number }
): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    d[i * 4] = fill.r;
    d[i * 4 + 1] = fill.g;
    d[i * 4 + 2] = fill.b;
    d[i * 4 + 3] = 255;
  }
  if (blot) {
    for (let y = blot.y; y < blot.y + blot.h; y++) {
      for (let x = blot.x; x < blot.x + blot.w; x++) {
        const i = (y * w + x) * 4;
        d[i] = blot.r;
        d[i + 1] = blot.g;
        d[i + 2] = blot.b;
        d[i + 3] = 255;
      }
    }
  }
  return d;
}

// ---------------------------------------------------------------------------

describe('rgbToHsl', () => {
  it('reads primaries', () => {
    expect(rgbToHsl(rgb(255, 0, 0)).h).toBeCloseTo(0, 0);
    expect(rgbToHsl(rgb(0, 255, 0)).h).toBeCloseTo(120, 0);
    expect(rgbToHsl(rgb(0, 0, 255)).h).toBeCloseTo(240, 0);
  });

  it('reports greys as unsaturated', () => {
    expect(rgbToHsl(rgb(128, 128, 128)).s).toBe(0);
    expect(rgbToHsl(rgb(255, 255, 255)).l).toBe(1);
  });
});

describe('hueDistance', () => {
  it('takes the short way round the wheel', () => {
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(90, 90)).toBe(0);
  });
});

describe('isNeutral — the blank-cell gate', () => {
  it('treats white, near-white and pale grey as blank', () => {
    expect(isNeutral(rgb(255, 255, 255))).toBe(true);
    expect(isNeutral(rgb(248, 248, 246))).toBe(true);
    expect(isNeutral(rgb(200, 200, 205))).toBe(true);
  });

  it('treats near-black as blank, for a dark-themed source', () => {
    expect(isNeutral(rgb(10, 10, 12))).toBe(true);
  });

  it('does not treat a saturated colour as blank', () => {
    expect(isNeutral(rgb(74, 158, 255))).toBe(false);
    expect(isNeutral(rgb(244, 114, 182))).toBe(false);
  });
});

describe('matchMark', () => {
  it('matches each mark to its own colour', () => {
    expect(matchMark(rgb(74, 158, 255), DEFS)).toBe('travel');
    expect(matchMark(rgb(244, 114, 182), DEFS)).toBe('gig');
    expect(matchMark(rgb(111, 191, 139), DEFS)).toBe('off');
  });

  // The reason hue is used rather than RGB distance.
  it('matches the same hue across very different lightness', () => {
    // A pale blue wash and a deep blue block are both Travel.
    expect(matchMark(rgb(180, 214, 255), DEFS)).toBe('travel');
    expect(matchMark(rgb(20, 70, 130), DEFS)).toBe('travel');
  });

  it('returns null for a blank cell rather than guessing', () => {
    expect(matchMark(rgb(255, 255, 255), DEFS)).toBeNull();
    expect(matchMark(rgb(240, 240, 240), DEFS)).toBeNull();
  });

  it('returns null when nothing is within tolerance', () => {
    // Yellow: ~55°, more than 34° from blue, pink or green.
    expect(matchMark(rgb(250, 204, 21), DEFS)).toBeNull();
  });

  it('respects a widened tolerance, matching the genuinely nearest hue', () => {
    // Yellow sits at ~48°. It is 79° from pink (328°, going backwards through
    // red) and 93° from green (141°) — so pink wins, which is not the intuitive
    // answer and is exactly why the default tolerance rejects it outright.
    expect(matchMark(rgb(250, 204, 21), DEFS, 90)).toBe('gig');
    expect(matchMark(rgb(250, 204, 21), DEFS, 70)).toBeNull();
  });

  it('returns null with no definitions', () => {
    expect(matchMark(rgb(74, 158, 255), [])).toBeNull();
  });

  it('picks the nearer of two similar hues', () => {
    const twoBlues: DayMarkDef[] = [
      { id: 'a', label: 'A', color: '#2060ff', order: 0 }, // ~226
      { id: 'b', label: 'B', color: '#20c0ff', order: 1 }, // ~195
    ];
    expect(matchMark(rgb(32, 190, 255), twoBlues)).toBe('b');
    expect(matchMark(rgb(32, 100, 255), twoBlues)).toBe('a');
  });
});

// ---------------------------------------------------------------------------

describe('cellRect', () => {
  const frame = { x: 0, y: 0, w: 700, h: 500 };

  it('divides the frame into seven columns and the given rows', () => {
    const a = cellRect(frame, 5, 0, 0, 0);
    expect(a).toMatchObject({ x: 0, y: 0, w: 100, h: 100 });
    const b = cellRect(frame, 5, 4, 6, 0);
    expect(b).toMatchObject({ x: 600, y: 400 });
  });

  it('insets to avoid gridlines and the day number', () => {
    const r = cellRect(frame, 5, 0, 0, 0.2);
    expect(r.x).toBe(20);
    expect(r.y).toBe(20);
    expect(r.w).toBe(60);
    expect(r.h).toBe(60);
  });

  it('honours a frame offset', () => {
    const r = cellRect({ x: 40, y: 90, w: 700, h: 500 }, 5, 0, 0, 0);
    expect(r).toMatchObject({ x: 40, y: 90 });
  });

  it('never produces a zero-size region', () => {
    const r = cellRect({ x: 0, y: 0, w: 7, h: 5 }, 5, 0, 0, 0.49);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });
});

describe('dominantMarkColor', () => {
  const WHOLE = { x: 0, y: 0, w: 20, h: 20 };

  it('reads a solid region', () => {
    const d = buffer(20, 20, { r: 74, g: 158, b: 255 });
    expect(dominantMarkColor(d, 20, WHOLE)!.rgb).toMatchObject({ r: 74, g: 158, b: 255 });
  });

  // The reason the modal colour is used rather than the mean.
  it('ignores dark day-number text instead of averaging into mud', () => {
    const d = buffer(20, 20, { r: 74, g: 158, b: 255 }, {
      x: 0, y: 0, w: 6, h: 6, r: 0, g: 0, b: 0,
    });
    const got = dominantMarkColor(d, 20, WHOLE)!;
    expect(got.rgb).toMatchObject({ r: 74, g: 158, b: 255 });
    // A mean would have dragged this well below the true blue.
    expect(matchMark(got.rgb, DEFS)).toBe('travel');
  });

  it('collapses near-identical compression artefacts into one bucket', () => {
    const d = buffer(10, 10, { r: 74, g: 158, b: 255 });
    // Nudge a few pixels by 1-2 units, as JPEG would.
    for (const i of [0, 4, 8, 12]) {
      d[i] = 75;
      d[i + 1] = 157;
      d[i + 2] = 254;
    }
    const got = dominantMarkColor(d, 10, { x: 0, y: 0, w: 10, h: 10 })!;
    expect(Math.abs(got.rgb.r - 74)).toBeLessThanOrEqual(2);
    expect(matchMark(got.rgb, DEFS)).toBe('travel');
  });

  it('skips transparent pixels', () => {
    const d = buffer(10, 10, { r: 74, g: 158, b: 255 });
    for (let i = 0; i < 50; i++) d[i * 4 + 3] = 0;
    const got = dominantMarkColor(d, 10, { x: 0, y: 0, w: 10, h: 10 })!;
    expect(matchMark(got.rgb, DEFS)).toBe('travel');
  });

  it('returns null for a fully transparent region', () => {
    const d = new Uint8ClampedArray(10 * 10 * 4);
    expect(dominantMarkColor(d, 10, { x: 0, y: 0, w: 10, h: 10 })).toBeNull();
  });

  // The correction that made this work on a real screenshot.
  it('finds a thin top bar that the mode of the whole cell would miss', () => {
    // A dark cell with a coloured bar across a tenth of its height, which is the
    // proportion measured in Apple Calendar. Most of the cell is background.
    const d = buffer(40, 40, { r: 42, g: 43, b: 42 }, {
      x: 0, y: 8, w: 40, h: 4, r: 31, g: 96, b: 88,
    });
    const got = dominantMarkColor(d, 40, { x: 0, y: 0, w: 40, h: 40 })!;
    expect(got.rgb).toMatchObject({ r: 31, g: 96, b: 88 });
    expect(got.fraction).toBeCloseTo(0.1, 1);
  });

  it('returns null for a cell that is only background', () => {
    const d = buffer(40, 40, { r: 42, g: 43, b: 42 });
    expect(dominantMarkColor(d, 40, { x: 0, y: 0, w: 40, h: 40 })).toBeNull();
  });

  it('returns null for a dark-theme empty cell', () => {
    // Measured background of the real screenshot: neutral, but nowhere near black.
    const d = buffer(40, 40, { r: 42, g: 43, b: 42 }, {
      x: 0, y: 0, w: 40, h: 1, r: 50, g: 50, b: 50, // a gridline
    });
    expect(dominantMarkColor(d, 40, { x: 0, y: 0, w: 40, h: 40 })).toBeNull();
  });

  it('rejects a smear too small to be an event', () => {
    // Four coloured pixels in 1600 is 0.25%, below the 2% floor.
    const d = buffer(40, 40, { r: 255, g: 255, b: 255 }, {
      x: 0, y: 0, w: 2, h: 2, r: 244, g: 114, b: 182,
    });
    expect(dominantMarkColor(d, 40, { x: 0, y: 0, w: 40, h: 40 })).toBeNull();
  });

  // Found by running the sampler over a real, bottom-cropped screenshot: it marked
  // the entire last row.
  it('ignores pixels outside the image instead of counting them as colour', () => {
    // A 40x40 white image, sampled with a region running well past its bottom edge.
    const d = buffer(40, 40, { r: 255, g: 255, b: 255 });
    expect(dominantMarkColor(d, 40, { x: 0, y: 20, w: 40, h: 60 })).toBeNull();
    // And past the right edge.
    expect(dominantMarkColor(d, 40, { x: 20, y: 0, w: 60, h: 40 })).toBeNull();
    // Negative origins are clamped too, not wrapped to the previous row.
    expect(dominantMarkColor(d, 40, { x: -10, y: -10, w: 60, h: 60 })).toBeNull();
  });

  it('still finds a real bar in a region that overruns the image', () => {
    const d = buffer(40, 40, { r: 42, g: 43, b: 42 }, {
      x: 0, y: 8, w: 40, h: 4, r: 31, g: 96, b: 88,
    });
    const got = dominantMarkColor(d, 40, { x: 0, y: 0, w: 40, h: 80 })!;
    expect(got.rgb).toMatchObject({ r: 31, g: 96, b: 88 });
    // Fraction is measured against pixels that exist, not the region asked for.
    expect(got.fraction).toBeCloseTo(0.1, 1);
  });

  it('treats a full wash and a thin bar alike, differing only in fraction', () => {
    const wash = buffer(40, 40, { r: 31, g: 96, b: 88 });
    const bar = buffer(40, 40, { r: 42, g: 43, b: 42 }, {
      x: 0, y: 8, w: 40, h: 4, r: 31, g: 96, b: 88,
    });
    const a = dominantMarkColor(wash, 40, { x: 0, y: 0, w: 40, h: 40 })!;
    const bb = dominantMarkColor(bar, 40, { x: 0, y: 0, w: 40, h: 40 })!;
    expect(a.rgb).toEqual(bb.rgb);
    expect(a.fraction).toBeGreaterThan(bb.fraction);
  });
});

describe('gridCells — position to date', () => {
  it('produces rows × 7 cells walking forward from the first', () => {
    expect(gridCells('2026-07-01', 6)).toHaveLength(42);
    expect(gridCells('2026-07-01', 5)).toHaveLength(35);
  });

  it('lays dates out left to right, top to bottom', () => {
    const cells = gridCells('2026-06-29', 2);
    expect(cells[0]).toMatchObject({ row: 0, col: 0, date: '2026-06-29' });
    expect(cells[6]).toMatchObject({ row: 0, col: 6, date: '2026-07-05' });
    expect(cells[7]).toMatchObject({ row: 1, col: 0, date: '2026-07-06' });
  });

  it('crosses a month boundary without comment', () => {
    const cells = gridCells('2026-06-29', 1);
    expect(cells.map((c) => c.date)).toEqual([
      '2026-06-29', '2026-06-30', '2026-07-01', '2026-07-02',
      '2026-07-03', '2026-07-04', '2026-07-05',
    ]);
  });

  it('crosses a year boundary', () => {
    const cells = gridCells('2026-12-28', 1);
    expect(cells[0].date).toBe('2026-12-28');
    expect(cells[6].date).toBe('2027-01-03');
  });

  it('spans a leap day', () => {
    expect(gridCells('2028-02-27', 1).map((c) => c.date)).toContain('2028-02-29');
  });

  // The real screenshot: a scrolling month view titled "December 2026" whose grid
  // actually begins on 15 November and runs six weeks across two months.
  it('describes a scrolling view that no month-plus-week-start pair could', () => {
    const cells = gridCells('2026-11-15', 6);
    expect(cells).toHaveLength(42);
    expect(cells[0].date).toBe('2026-11-15');
    expect(cells[41].date).toBe('2026-12-26');
    // Row starts, as read off the screenshot.
    expect(cells.filter((c) => c.col === 0).map((c) => c.date)).toEqual([
      '2026-11-15', '2026-11-22', '2026-11-29',
      '2026-12-06', '2026-12-13', '2026-12-20',
    ]);
  });
});

describe('defaultFirstCell', () => {
  // July 2026: the 1st is a Wednesday.
  it('leads a Monday-first month grid back to the previous Monday', () => {
    expect(defaultFirstCell('2026-07', 1)).toBe('2026-06-29');
  });

  it('leads a Sunday-first month grid back one day further', () => {
    expect(defaultFirstCell('2026-07', 0)).toBe('2026-06-28');
  });

  it('needs no lead when the month starts on the week-start day', () => {
    // 2026-06-01 is a Monday.
    expect(defaultFirstCell('2026-06', 1)).toBe('2026-06-01');
  });

  it('leads a full week back when the month starts the day before', () => {
    // 2026-02-01 is a Sunday, so Monday-first needs six leading cells.
    expect(defaultFirstCell('2026-02', 1)).toBe('2026-01-26');
    expect(defaultFirstCell('2026-02', 0)).toBe('2026-02-01');
  });

  it('lands on a grid that covers the whole month', () => {
    for (const [m, ws] of [['2026-07', 1], ['2026-02', 1], ['2028-02', 0]] as const) {
      const dates = gridCells(defaultFirstCell(m, ws), rowsNeeded(m, ws)).map((c) => c.date);
      const expected = new Date(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0).getDate();
      expect(dates.filter((d) => d.startsWith(m))).toHaveLength(expected);
    }
  });
});

describe('monthsCovered', () => {
  it('names one month for a grid inside it', () => {
    expect(monthsCovered('2026-07-06', 2)).toEqual(['2026-07']);
  });

  it('names both months a grid straddles, in order', () => {
    expect(monthsCovered('2026-11-15', 6)).toEqual(['2026-11', '2026-12']);
  });

  it('names three when a short month sits in the middle', () => {
    expect(monthsCovered('2026-01-25', 6)).toEqual(['2026-01', '2026-02', '2026-03']);
  });
});

describe('rowsNeeded', () => {
  it('is 5 for a typical month', () => {
    expect(rowsNeeded('2026-07', 1)).toBe(5);
  });

  it('is 6 when the month spills', () => {
    // 2026-08-01 is a Saturday: Monday-first needs six rows.
    expect(rowsNeeded('2026-08', 1)).toBe(6);
  });

  it('depends on the week start', () => {
    expect(rowsNeeded('2026-08', 0)).toBe(6);
    expect(rowsNeeded('2026-02', 1)).toBe(5);
  });

  it('is 4 for a February starting on the week-start day', () => {
    // 2027-02-01 is a Monday, 28 days: exactly four rows.
    expect(rowsNeeded('2027-02', 1)).toBe(4);
  });
});

// ---------------------------------------------------------------------------

describe('marks', () => {
  const marks: DayMarks = {
    '2026-07-03': 'gig',
    '2026-07-04': 'travel',
    '2026-07-20': 'gig',
    '2026-08-01': 'gig',
  };

  it('sets and clears', () => {
    expect(setMark({}, '2026-07-05', 'travel')['2026-07-05']).toBe('travel');
    expect(setMark(marks, '2026-07-03', null)['2026-07-03']).toBeUndefined();
  });

  it('does not mutate the input', () => {
    const before = { ...marks };
    setMark(marks, '2026-07-09', 'off');
    expect(marks).toEqual(before);
  });

  it('applies a proposal, including clears', () => {
    const next = applyProposal(marks, {
      '2026-07-03': null,
      '2026-07-10': 'travel',
    });
    expect(next['2026-07-03']).toBeUndefined();
    expect(next['2026-07-10']).toBe('travel');
    // Dates the proposal did not mention are untouched.
    expect(next['2026-07-20']).toBe('gig');
  });

  it('counts per mark within a month only', () => {
    expect(countMarksInMonth(marks, '2026-07')).toEqual({ gig: 2, travel: 1 });
    expect(countMarksInMonth(marks, '2026-08')).toEqual({ gig: 1 });
  });

  it('returns nothing for an empty month', () => {
    expect(countMarksInMonth(marks, '2026-01')).toEqual({});
  });

  it('resolves a mark for a date', () => {
    expect(markForDate(marks, DEFS, '2026-07-04')?.label).toBe('Travel');
    expect(markForDate(marks, DEFS, '2026-07-05')).toBeNull();
  });

  it('describes a month for the record', () => {
    expect(describeMarks({ travel: 4, gig: 6 }, DEFS)).toBe('4 travel · 6 gig');
    expect(describeMarks({}, DEFS)).toBe('');
  });

  it('finds marks whose definition was deleted', () => {
    const stale: DayMarks = { '2026-07-01': 'vanished', '2026-07-02': 'gig' };
    expect(orphanedMarks(stale, DEFS)).toEqual(['2026-07-01']);
  });
});

describe('cycleMark', () => {
  it('walks the list then returns to unmarked', () => {
    expect(cycleMark(null, DEFS)).toBe('travel');
    expect(cycleMark('travel', DEFS)).toBe('gig');
    expect(cycleMark('gig', DEFS)).toBe('off');
    expect(cycleMark('off', DEFS)).toBeNull();
  });

  it('treats an unknown id as the end of the cycle', () => {
    expect(cycleMark('nope', DEFS)).toBeNull();
  });

  it('is a no-op with no definitions', () => {
    expect(cycleMark(null, [])).toBeNull();
  });

  it('respects order rather than array position', () => {
    const shuffled = [DEFS[2], DEFS[0], DEFS[1]];
    expect(cycleMark(null, shuffled)).toBe('travel');
  });
});

describe('frameIsUsable', () => {
  it('rejects a frame dragged to nothing', () => {
    expect(frameIsUsable({ x: 0, y: 0, w: 4, h: 400 })).toBe(false);
    expect(frameIsUsable({ x: 0, y: 0, w: 400, h: 400 })).toBe(true);
  });
});

describe('hueCollisions', () => {
  it('passes the default set — the shipped colours must be separable', () => {
    expect(hueCollisions(DEFS)).toEqual([]);
  });

  it('flags the palette blue against the palette cyan — 24 apart is a coin flip', () => {
    const close: DayMarkDef[] = [
      { id: 'a', label: 'Travel', color: '#4a9eff', order: 0 }, // hue 212
      { id: 'b', label: 'Flight', color: '#22d3ee', order: 1 }, // hue 188
    ];
    const pairs = hueCollisions(close);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('reports every colliding pair, not just the first', () => {
    const three: DayMarkDef[] = [
      { id: 'a', label: 'A', color: '#4a9eff', order: 0 },
      { id: 'b', label: 'B', color: '#3f96f2', order: 1 },
      { id: 'c', label: 'C', color: '#5aa8ff', order: 2 },
    ];
    expect(hueCollisions(three)).toHaveLength(3);
  });

  it('reports pairs in list order, so the message reads predictably', () => {
    const shuffled: DayMarkDef[] = [
      { id: 'b', label: 'B', color: '#4a9eff', order: 1 },
      { id: 'a', label: 'A', color: '#3f96f2', order: 0 },
    ];
    expect(hueCollisions(shuffled)[0].map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('has nothing to say about a single mark', () => {
    expect(hueCollisions([DEFS[0]])).toEqual([]);
    expect(hueCollisions([])).toEqual([]);
  });
});

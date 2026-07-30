import { describe, it, expect } from 'vitest';
import {
  applyProposal,
  CELL_INSET,
  cellRect,
  dominantMarkColor,
  gridCells,
  matchMark,
} from './daymarks';
import { DEFAULT_DAY_MARKS, type DayMarks } from './types';

// ============================================================================
// End-to-end sampler test.
//
// The unit tests cover each piece; this one paints a whole fake screenshot into an
// RGBA buffer and runs the real pipeline over it. That is the only way to catch a
// geometry error — an off-by-one row, a column offset, an inset eating the wrong
// pixels — where every individual function is still correct.
//
// The painted grid reproduces what was measured off an actual Apple Calendar
// screenshot rather than an imagined calendar, because the imagined one was wrong
// in three ways:
//
//   - dark theme, so the background is neutral-but-not-black (42,43,42)
//   - all-day events are BARS at 20–31% of cell height, not cell washes
//   - the grid scrolls, so six rows span two months and start mid-November
//
// Colours are the measured ones: teal (31,96,88) for travel, amber (101,70,33) for
// a gig.
// ============================================================================

const W = 2000;
const H = 1600;
const FRAME = { x: 0, y: 137, w: 2023, h: 1434 }; // 289 × 239 cells, 6 rows
const ROWS = 6;

const BG = { r: 42, g: 43, b: 42 };
const GRIDLINE = { r: 50, g: 50, b: 50 };
const DAYNUM = { r: 96, g: 97, b: 96 };
const TRAVEL = { r: 31, g: 96, b: 88 };
const GIG = { r: 101, g: 70, b: 33 };

/** Where the event bar sits inside a cell, as measured: 20.9%–31.4% of height. */
const BAR_TOP = 0.209;
const BAR_BOTTOM = 0.314;

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function blank(fill: Rgb): Uint8ClampedArray {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = fill.r;
    data[i * 4 + 1] = fill.g;
    data[i * 4 + 2] = fill.b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

function paint(
  data: Uint8ClampedArray,
  rect: { x: number; y: number; w: number; h: number },
  c: Rgb
): void {
  for (let y = Math.max(0, rect.y); y < Math.min(H, rect.y + rect.h); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(W, rect.x + rect.w); x++) {
      const i = (y * W + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = 255;
    }
  }
}

/** The whole cell at a grid position — what a screenshot shows, no inset. */
function wholeCell(row: number, col: number) {
  const cw = FRAME.w / 7;
  const ch = FRAME.h / ROWS;
  return {
    x: Math.round(FRAME.x + col * cw),
    y: Math.round(FRAME.y + row * ch),
    w: Math.round(cw),
    h: Math.round(ch),
  };
}

/**
 * Paint a scrolling month grid in a dark theme.
 *
 * `marked` maps a date key to the bar colour. Every cell also gets a grey day
 * number and grey gridlines, so the sampler has to discard both.
 */
function paintGrid(
  firstCell: string,
  marked: Record<string, Rgb>
): Uint8ClampedArray {
  const data = blank(BG);
  for (const cell of gridCells(firstCell, ROWS)) {
    const box = wholeCell(cell.row, cell.col);

    const bar = marked[cell.date];
    if (bar) {
      paint(
        data,
        {
          x: box.x + 2,
          y: Math.round(box.y + box.h * BAR_TOP),
          w: box.w - 4,
          h: Math.round(box.h * (BAR_BOTTOM - BAR_TOP)),
        },
        bar
      );
    }

    // Day number: grey, top-right, as Apple draws it.
    paint(data, { x: box.x + box.w - 40, y: box.y + 8, w: 28, h: 22 }, DAYNUM);

    // Gridlines on the right and bottom edges.
    paint(data, { x: box.x + box.w - 1, y: box.y, w: 1, h: box.h }, GRIDLINE);
    paint(data, { x: box.x, y: box.y + box.h - 1, w: box.w, h: 1 }, GRIDLINE);
  }
  return data;
}

/** Shift a date key by whole days, via UTC so no DST boundary can round it. */
function shiftDay(dateKey: string, delta: number): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + delta * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * Run the importer's exact sampling loop.
 *
 * Only recognised days get an entry — an unrecognised day is ABSENT, not null. That
 * is the only-add contract: `applyProposal` deletes on null, so proposing null for
 * every blank cell would make one screenshot wipe marks it never covered.
 */
function sample(data: Uint8ClampedArray, firstCell: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const cell of gridCells(firstCell, ROWS)) {
    const rect = cellRect(FRAME, ROWS, cell.row, cell.col, CELL_INSET);
    const found = dominantMarkColor(data, W, rect);
    const id = found ? matchMark(found.rgb, DEFAULT_DAY_MARKS) : null;
    if (id) out[cell.date] = id;
  }
  return out;
}

/** The schedule actually visible in the reference screenshot. */
const REFERENCE: Record<string, Rgb> = {
  '2026-11-19': TRAVEL,
  '2026-11-20': GIG,
  '2026-11-21': GIG,
  '2026-11-22': TRAVEL,
  '2026-12-02': TRAVEL,
  '2026-12-03': GIG,
  '2026-12-04': GIG,
  '2026-12-05': GIG,
  '2026-12-06': TRAVEL,
  '2026-12-09': TRAVEL,
  '2026-12-10': GIG,
  '2026-12-11': GIG,
  '2026-12-12': GIG,
  '2026-12-13': TRAVEL,
  '2026-12-16': TRAVEL,
  '2026-12-17': GIG,
  '2026-12-18': GIG,
  '2026-12-19': GIG,
  '2026-12-20': TRAVEL,
};

describe('sampler end to end, against the reference screenshot', () => {
  const FIRST = '2026-11-15';

  it('reads the whole touring schedule off a dark-theme scrolling grid', () => {
    const got = sample(paintGrid(FIRST, REFERENCE), FIRST);
    const expected: Record<string, string> = {};
    for (const [date, c] of Object.entries(REFERENCE)) {
      expected[date] = c === TRAVEL ? 'travel' : 'gig';
    }
    expect(got).toEqual(expected);
  });

  it('proposes nothing at all for an unrecognised day', () => {
    const got = sample(paintGrid(FIRST, REFERENCE), FIRST);
    // Absent, not null: a null would delete whatever is already there.
    expect('2026-11-16' in got).toBe(false);
    expect('2026-11-25' in got).toBe(false);
    expect('2026-12-24' in got).toBe(false);
    expect(Object.keys(got)).toHaveLength(19);
  });

  it('spans both months the grid touches', () => {
    const got = sample(paintGrid(FIRST, REFERENCE), FIRST);
    const dates = Object.keys(got).sort();
    expect(dates.some((d) => d.startsWith('2026-11'))).toBe(true);
    expect(dates.some((d) => d.startsWith('2026-12'))).toBe(true);
  });

  it('leaves a hand-made mark the screenshot does not cover alone', () => {
    // The behaviour asked for: importing adds, it does not replace. A day marked by
    // hand inside the framed range, which the sampler reads as blank, must survive.
    const existing: DayMarks = {
      '2026-11-16': 'gig', // inside the frame, blank in the image
      '2026-12-24': 'travel', // ditto
      '2027-03-01': 'gig', // outside the frame entirely
    };
    const proposal = sample(paintGrid(FIRST, REFERENCE), FIRST);
    const after = applyProposal(existing, proposal);

    expect(after['2026-11-16']).toBe('gig');
    expect(after['2026-12-24']).toBe('travel');
    expect(after['2027-03-01']).toBe('gig');
    // And the import still landed.
    expect(after['2026-12-03']).toBe('gig');
    expect(Object.keys(after)).toHaveLength(3 + 19);
  });

  it('overwrites a day the screenshot disagrees with', () => {
    // Only-add is about blanks, not about deferring to stale data: where the source
    // does say something, it wins.
    const existing: DayMarks = { '2026-12-03': 'travel' };
    const after = applyProposal(existing, sample(paintGrid(FIRST, REFERENCE), FIRST));
    expect(after['2026-12-03']).toBe('gig');
  });

  it('changes nothing when no colour matches', () => {
    const existing: DayMarks = { '2026-11-16': 'gig' };
    const violet: Record<string, Rgb> = { '2026-11-19': { r: 139, g: 124, b: 246 } };
    const proposal = sample(paintGrid(FIRST, violet), FIRST);
    expect(proposal).toEqual({});
    expect(applyProposal(existing, proposal)).toEqual(existing);
  });

  it('keeps a multi-day gig bar intact across its whole run', () => {
    const got = sample(paintGrid(FIRST, REFERENCE), FIRST);
    // The label only appears in the first cell of a spanning event, but the colour
    // is in all of them — which is why sampling colour beats reading text.
    expect(['2026-12-03', '2026-12-04', '2026-12-05'].map((d) => got[d])).toEqual([
      'gig',
      'gig',
      'gig',
    ]);
  });

  it('slides the whole schedule by a day when the first cell is off by one', () => {
    // The failure the first-cell date exists to prevent. Reading the same pixels
    // against an anchor one day earlier relabels every cell one day earlier — the
    // schedule stays intact and lands entirely on the wrong dates, which is the
    // worst kind of wrong because nothing about it looks broken.
    const data = paintGrid(FIRST, REFERENCE);
    const misread = sample(data, '2026-11-14');
    for (const [date, colour] of Object.entries(REFERENCE)) {
      const shifted = shiftDay(date, -1);
      expect(misread[shifted]).toBe(colour === TRAVEL ? 'travel' : 'gig');
    }
    // Nov 19 was travel; it now reads as Nov 20's gig.
    expect(misread['2026-11-19']).toBe('gig');
  });

  it('ignores the day number and gridlines rather than matching them', () => {
    // An empty cell here contains a grey numeral and two gridlines and nothing else.
    expect(sample(paintGrid(FIRST, {}), FIRST)).toEqual({});
  });

  it('still matches when the source renders its bars washed out', () => {
    // Same hues at much lower saturation, as a translucent bar over a dark cell.
    const faint: Record<string, Rgb> = {
      '2026-11-19': { r: 44, g: 74, b: 71 },
      '2026-11-20': { r: 74, g: 60, b: 42 },
    };
    const got = sample(paintGrid(FIRST, faint), FIRST);
    expect(got['2026-11-19']).toBe('travel');
    expect(got['2026-11-20']).toBe('gig');
  });

  it('declines a colour that is no mark rather than picking the nearest', () => {
    const violet: Record<string, Rgb> = { '2026-11-19': { r: 139, g: 124, b: 246 } };
    expect('2026-11-19' in sample(paintGrid(FIRST, violet), FIRST)).toBe(false);
  });
});

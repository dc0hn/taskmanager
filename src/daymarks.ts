import type { DayMarkDef, DayMarks } from './types';
import { addDays, fromDateKey, toDateKey } from './utils/time';
import { hexToRgb } from './utils/color';
import { daysInMonth, isDayInMonth, monthYear } from './month';

// ============================================================================
// Day marks — reading a month off a screenshot
//
// The problem: import a screenshot of another calendar and mark Almanac's days
// from it. Fully offline, so no cloud vision; and no OCR either, because reading
// the date numbers reliably would mean bundling megabytes of WASM for a result
// that fails on anti-aliased text. Dates therefore come from GRID POSITION, not
// from reading the image.
//
// That makes the whole thing a colour-sampling problem with a human in the loop:
// the user frames the grid, says which date sits in its top-left cell, and confirms
// the result on that same grid before anything is written.
//
// Four decisions in here are load-bearing, and three of them were corrected after
// measuring a real Apple Calendar screenshot rather than an imagined one:
//
//   HUE, NOT RGB DISTANCE. Screenshots are compressed, anti-aliased and often
//   rendered on a tinted background, so the same "blue" varies wildly in
//   lightness between cells. Hue survives that; Euclidean RGB distance does not.
//   Saturation and lightness are used only as a gate for "this pixel is chrome".
//
//   IGNORE NEUTRALS, THEN TAKE THE MODE. Real calendars draw an all-day event as a
//   BAR near the top of the cell, not as a wash across it — about 10% of the cell's
//   area. So the mode of the whole cell is the background, and the mode of the
//   cell's middle is also the background. Discarding neutral pixels first leaves
//   only the event, and works the same whether the source washes or bars.
//
//   ANCHOR ON THE FIRST CELL, NOT ON A MONTH. Apple's month view scrolls
//   continuously: a view titled "December 2026" can start on November 15th and
//   cover two months. No month-plus-week-start pair describes that grid.
//
//   THE SOURCE'S PALETTE IS NOT OURS. A mark carries an optional `sourceColor` for
//   matching, separate from the colour it wears here.
// ============================================================================

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export function rgbToHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
  else if (max === gn) h = ((bn - rn) / d + 2) * 60;
  else h = ((rn - gn) / d + 4) * 60;
  return { h, s, l };
}

/** Shortest distance between two hues on the colour wheel, 0..180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Is this cell effectively blank?
 *
 * An unmarked calendar cell is white, near-white, a pale grey, or (in a dark
 * theme) near-black. All of those are low-saturation or extreme-lightness, and
 * none of them should be matched to a coloured mark.
 */
export function isNeutral(rgb: Rgb): boolean {
  const { s, l } = rgbToHsl(rgb);
  return s < 0.18 || l > 0.93 || l < 0.07;
}

export const DEFAULT_HUE_TOLERANCE = 34;

/**
 * The mark whose colour best matches a sampled cell, or null for no match.
 *
 * Returns null rather than a best-effort guess when nothing is within tolerance:
 * a wrong mark on a real date is worse than no mark, and the confirm step exists
 * precisely so the user can fill in what the sampler declined to.
 */
export function matchMark(
  rgb: Rgb,
  defs: DayMarkDef[],
  tolerance = DEFAULT_HUE_TOLERANCE
): string | null {
  if (isNeutral(rgb)) return null;
  const { h } = rgbToHsl(rgb);
  let best: { id: string; dist: number } | null = null;
  for (const def of defs) {
    const target = rgbToHsl(hexToRgb(matchColorOf(def)));
    const dist = hueDistance(h, target.h);
    if (!best || dist < best.dist) best = { id: def.id, dist };
  }
  if (!best || best.dist > tolerance) return null;
  return best.id;
}

/** The colour to look for in a screenshot — the source's, falling back to Almanac's. */
export function matchColorOf(def: DayMarkDef): string {
  return def.sourceColor ?? def.color;
}

// ---------------------------------------------------------------------------
// Grid geometry
// ---------------------------------------------------------------------------

export interface GridFrame {
  /** Pixel coordinates of the calendar area inside the image. */
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A thin border inset, only enough to clear gridlines and a neighbour's rounded
 * corner bleeding in.
 *
 * It used to be 0.24, to dodge the day number by sampling only the middle of the
 * cell. That was wrong for the common case: real calendars draw all-day events as
 * a BAR near the top of the cell — measured at 20–31% of cell height in Apple
 * Calendar — so a centred box saw nothing but background. Ignoring neutral pixels
 * (below) handles the day number far better than avoiding it geometrically, which
 * frees the sample region to cover the whole cell.
 */
export const CELL_INSET = 0.05;

/** The region of a cell to sample, inset from its edges. */
export function cellRect(
  frame: GridFrame,
  rows: number,
  row: number,
  col: number,
  inset = CELL_INSET
): { x: number; y: number; w: number; h: number } {
  const cw = frame.w / 7;
  const ch = frame.h / rows;
  const ix = cw * inset;
  const iy = ch * inset;
  return {
    x: Math.round(frame.x + col * cw + ix),
    y: Math.round(frame.y + row * ch + iy),
    w: Math.max(1, Math.round(cw - ix * 2)),
    h: Math.max(1, Math.round(ch - iy * 2)),
  };
}

/**
 * How much of a cell must carry colour before it counts as marked.
 *
 * Measured against a real screenshot: a cell holding an all-day bar is 10.6%
 * non-neutral, and an empty cell is *exactly* 0%. There is no ambiguous middle to
 * split, so this sits low enough to catch a slimmer bar than Apple's while still
 * rejecting a stray coloured pixel or a compression artefact.
 */
export const MIN_MARK_FRACTION = 0.02;

/**
 * Ceiling on the pixels read from a pasted image.
 *
 * `getImageData` materialises four bytes per pixel in one allocation, and the canvas was
 * created at the image's natural size — so the cost of a paste was set by whatever
 * happened to be on the clipboard. A 20000 × 20000 image asks for 1.6 GB in a single
 * request, which is a hang or a dead webview rather than an error message.
 *
 * 16 million pixels is 64 MB, and leaves a 5K retina screenshot (14.7 Mpx) untouched, so
 * in practice nothing real is ever scaled. Downscaling is harmless here even when it does
 * happen: the sampler wants the dominant hue of a cell, which survives resampling far
 * better than it survives a crash.
 */
export const MAX_SAMPLE_PIXELS = 16_000_000;

/** Canvas dimension limits vary by engine; well under all of them. */
export const MAX_SAMPLE_EDGE = 8192;

/**
 * The size to sample a `w × h` image at, bounded on both area and longest edge.
 *
 * The frame is stored normalised 0..1, so scaling the sampling surface needs no
 * conversion anywhere else — cell rectangles are computed against whatever size comes
 * back from here.
 */
export function sampleSize(
  w: number,
  h: number
): { w: number; h: number; scale: number } {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    return { w: 0, h: 0, scale: 1 };
  }
  const byEdge = Math.min(1, MAX_SAMPLE_EDGE / Math.max(w, h));
  const byArea = Math.min(1, Math.sqrt(MAX_SAMPLE_PIXELS / (w * h)));
  const scale = Math.min(byEdge, byArea);
  return {
    w: Math.max(1, Math.floor(w * scale)),
    h: Math.max(1, Math.floor(h * scale)),
    scale,
  };
}

export interface MarkSample {
  rgb: Rgb;
  /** Share of sampled pixels that carried colour at all. */
  fraction: number;
}

/**
 * The dominant COLOURED colour in a region, ignoring everything neutral.
 *
 * The neutral skip is what makes this work on real calendars. A cell is mostly
 * background — white in a light theme, near-black in a dark one — with grey
 * gridlines and a grey day number, and all of that is neutral. Discarding it leaves
 * only the event bar, however small a share of the cell it occupies. A plain modal
 * colour would return the background every time.
 *
 * That also means this handles both idioms with one code path: a full-cell wash and
 * a thin top bar differ only in `fraction`.
 *
 * Quantised to 4 bits per channel before counting, so near-identical shades from
 * compression and anti-aliasing collapse into one bucket rather than each being
 * unique. Returns the average of the winning bucket, recovering precision the
 * quantisation threw away.
 */
export function dominantMarkColor(
  data: Uint8ClampedArray,
  imageWidth: number,
  rect: { x: number; y: number; w: number; h: number },
  minFraction = MIN_MARK_FRACTION
): MarkSample | null {
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  let considered = 0;
  let coloured = 0;

  // Clamp to the image. A frame dragged to the very edge of a cropped screenshot
  // puts part of the last row past the bottom, and an out-of-range read on a
  // Uint8ClampedArray yields `undefined` — which every comparison in `isNeutral`
  // answers false to, so the missing pixels would all count as coloured and mark
  // the entire final row. Found by running this over a real screenshot.
  const imageHeight = Math.floor(data.length / 4 / imageWidth);
  const x0 = Math.max(0, rect.x);
  const y0 = Math.max(0, rect.y);
  const x1 = Math.min(imageWidth, rect.x + rect.w);
  const y1 = Math.min(imageHeight, rect.y + rect.h);

  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * imageWidth + x) * 4;
      if (data[i + 3] < 128) continue; // transparent pixels carry no colour
      considered++;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      if (isNeutral({ r, g, b })) continue;
      coloured++;
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const cur = buckets.get(key);
      if (cur) {
        cur.n++;
        cur.r += r;
        cur.g += g;
        cur.b += b;
      } else {
        buckets.set(key, { n: 1, r, g, b });
      }
    }
  }

  if (considered === 0) return null;
  const fraction = coloured / considered;
  if (fraction < minFraction) return null;

  let win: { n: number; r: number; g: number; b: number } | null = null;
  for (const v of buckets.values()) if (!win || v.n > win.n) win = v;
  if (!win) return null;
  return {
    rgb: {
      r: Math.round(win.r / win.n),
      g: Math.round(win.g / win.n),
      b: Math.round(win.b / win.n),
    },
    fraction,
  };
}

// ---------------------------------------------------------------------------
// Position -> date
// ---------------------------------------------------------------------------

export interface SourceCell {
  row: number;
  col: number;
  date: string;
}

/**
 * Lay out the source grid and say which date each cell holds.
 *
 * Anchored on the date in the TOP-LEFT cell, not on a month.
 *
 * The obvious design was "which month is this, and does its week start on Sunday
 * or Monday" — derive the leading blanks from there. That cannot express a real
 * screenshot: Apple Calendar's month view scrolls continuously, so a view titled
 * "December 2026" can begin on November 15th and run six weeks across two months.
 * There is no month whose grid that is.
 *
 * Anchoring on the first cell handles both. A conventional month grid is just the
 * case where the first cell happens to be the month's leading blank — see
 * `defaultFirstCell` — and it needs no week-start question either, because the
 * first cell's own weekday fixes the column order.
 */
export function gridCells(firstCellDate: string, rows: number): SourceCell[] {
  const cells: SourceCell[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < 7; col++) {
      cells.push({ row, col, date: addDays(firstCellDate, row * 7 + col) });
    }
  }
  return cells;
}

/**
 * Where a conventional month grid would start — the default offered in the UI.
 *
 * `weekStartsOn` describes the SOURCE image (0 = Sunday, 1 = Monday). Only used to
 * seed the guess; once seeded, the first-cell date carries the information.
 */
export function defaultFirstCell(monthKey: string, weekStartsOn: 0 | 1): string {
  const { year, month } = monthYear(monthKey);
  const first = new Date(year, month - 1, 1);
  const firstDow = first.getDay(); // 0 = Sunday
  const lead = weekStartsOn === 1 ? (firstDow === 0 ? 6 : firstDow - 1) : firstDow;
  return addDays(toDateKey(first), -lead);
}

/** How many rows a conventional month grid needs — the default row count. */
export function rowsNeeded(monthKey: string, weekStartsOn: 0 | 1): number {
  const { year, month } = monthYear(monthKey);
  const firstDow = new Date(year, month - 1, 1).getDay();
  const lead = weekStartsOn === 1 ? (firstDow === 0 ? 6 : firstDow - 1) : firstDow;
  return Math.ceil((lead + daysInMonth(monthKey)) / 7);
}

/** Which months a framed grid touches, so the UI can say what it will change. */
export function monthsCovered(firstCellDate: string, rows: number): string[] {
  const set = new Set<string>();
  for (const cell of gridCells(firstCellDate, rows)) set.add(cell.date.slice(0, 7));
  return [...set].sort();
}

// ---------------------------------------------------------------------------
// Marks
// ---------------------------------------------------------------------------

export function setMark(marks: DayMarks, date: string, markId: string | null): DayMarks {
  const next = { ...marks };
  if (markId === null) delete next[date];
  else next[date] = markId;
  return next;
}

/** Apply a proposal, replacing only the dates it covers. */
export function applyProposal(
  marks: DayMarks,
  proposal: Record<string, string | null>
): DayMarks {
  const next = { ...marks };
  for (const [date, markId] of Object.entries(proposal)) {
    if (markId === null) delete next[date];
    else next[date] = markId;
  }
  return next;
}

/** How many days in a month carry each mark. */
export function countMarksInMonth(
  marks: DayMarks,
  monthKey: string
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [date, markId] of Object.entries(marks)) {
    if (!isDayInMonth(date, monthKey)) continue;
    out[markId] = (out[markId] ?? 0) + 1;
  }
  return out;
}

/** Cycle a date through the mark list, then back to unmarked. */
export function cycleMark(
  current: string | null,
  defs: DayMarkDef[]
): string | null {
  const ordered = [...defs].sort((a, b) => a.order - b.order);
  if (ordered.length === 0) return null;
  if (current === null) return ordered[0].id;
  const i = ordered.findIndex((d) => d.id === current);
  if (i === -1 || i === ordered.length - 1) return null;
  return ordered[i + 1].id;
}

export function markById(
  defs: DayMarkDef[],
  id: string | undefined
): DayMarkDef | null {
  if (!id) return null;
  return defs.find((d) => d.id === id) ?? null;
}

/** A human summary of a month's marks, for the record. */
export function describeMarks(
  counts: Record<string, number>,
  defs: DayMarkDef[]
): string {
  const parts = [...defs]
    .sort((a, b) => a.order - b.order)
    .filter((d) => (counts[d.id] ?? 0) > 0)
    .map((d) => `${counts[d.id]} ${d.label.toLowerCase()}`);
  return parts.join(' · ');
}

/** Marks whose definition has since been deleted, so the UI can offer a cleanup. */
export function orphanedMarks(marks: DayMarks, defs: DayMarkDef[]): string[] {
  const known = new Set(defs.map((d) => d.id));
  return Object.entries(marks)
    .filter(([, id]) => !known.has(id))
    .map(([date]) => date)
    .sort();
}

/** Used by the day/week header ribbon. */
export function markForDate(
  marks: DayMarks,
  defs: DayMarkDef[],
  date: string
): DayMarkDef | null {
  return markById(defs, marks[date]);
}

/** Every month key that holds at least one mark, ascending. */
export function monthsWithMarks(marks: DayMarks): string[] {
  const set = new Set<string>();
  for (const date of Object.keys(marks)) set.add(date.slice(0, 7));
  return [...set].sort();
}

/** Guard against a frame dragged to nothing. */
export function frameIsUsable(frame: GridFrame): boolean {
  return frame.w >= 28 && frame.h >= 28;
}

/**
 * Below this hue separation the sampler cannot reliably tell two marks apart.
 *
 * Two marks N degrees apart split the difference, so each owns only N/2 before a
 * cell flips to the other. 30 gives each mark ±15 — comfortably more than the few
 * degrees a flat fill drifts under JPEG compression, and enough that a calendar
 * rendering its fills slightly warm or cool doesn't reassign a whole month.
 *
 * This is tighter than DEFAULT_HUE_TOLERANCE on purpose. Tolerance asks "is this
 * cell near ANY mark", which can be generous; this asks "can two marks be
 * confused", which cannot.
 *
 * It flags the palette's blue against its cyan, which are 24 apart. That is the
 * intended behaviour, not a false positive — those two really are a coin flip.
 */
export const HUE_COLLISION = 30;

/**
 * Pairs of marks too close in hue for the importer to separate.
 *
 * Reported so the UI can say so up front. Hand-marking still works — this only
 * affects reading colours off a screenshot — so it is a warning, not an error.
 */
export function hueCollisions(defs: DayMarkDef[]): [DayMarkDef, DayMarkDef][] {
  const sorted = [...defs].sort((a, b) => a.order - b.order);
  const out: [DayMarkDef, DayMarkDef][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = rgbToHsl(hexToRgb(matchColorOf(sorted[i])));
      const b = rgbToHsl(hexToRgb(matchColorOf(sorted[j])));
      // Two greys have no meaningful hue, so comparing theirs would fire
      // spuriously; they collide because neither can be matched at all.
      if (hueDistance(a.h, b.h) < HUE_COLLISION) out.push([sorted[i], sorted[j]]);
    }
  }
  return out;
}

export { fromDateKey };

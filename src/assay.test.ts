import { describe, it, expect } from 'vitest';
import {
  assay,
  assayKey,
  weekScore,
  ASSAY_CEILING,
  ASSAY_FLOOR,
  ASSAY_MIN_WEEKS,
} from './assay';
import { weekDates } from './week';
import type { DailyStat } from './types';

const W = '2026-07-27';

const stat = (date: string, planned: number, done: number): DailyStat => ({
  date,
  plannedMinutes: planned,
  doneMinutes: done,
  xpEarned: 0,
  brassEarned: 0,
  bestCombo: 0,
  cleared: planned > 0 && done >= planned,
  completedCount: 0,
  focusMinutes: 0,
});

/** A whole week at one completion ratio. */
function weekAt(weekKey: string, ratio: number): Record<string, DailyStat> {
  const out: Record<string, DailyStat> = {};
  for (const d of weekDates(weekKey)) out[d] = stat(d, 300, 300 * ratio);
  return out;
}

function weeksBack(weekKey: string, n: number): string {
  const [y, m, d] = weekKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - n * 7 * 86_400_000;
  const o = new Date(t);
  return `${o.getUTCFullYear()}-${String(o.getUTCMonth() + 1).padStart(2, '0')}-${String(
    o.getUTCDate()
  ).padStart(2, '0')}`;
}

/** `weeks` prior weeks all at `ratio`, plus the week itself at `current`. */
function history(current: number, prior: number, weeks = 4) {
  let stats: Record<string, DailyStat> = weekAt(W, current);
  for (let i = 1; i <= weeks; i++) {
    stats = { ...stats, ...weekAt(weeksBack(W, i), prior) };
  }
  return stats;
}

// ---------------------------------------------------------------------------

describe('weekScore', () => {
  it('averages the completion ratio across days that had a plan', () => {
    expect(weekScore(weekAt(W, 0.5), W)).toBeCloseTo(0.5, 5);
  });

  it('ignores days with nothing planned rather than scoring them zero', () => {
    // A blank day says nothing about how the week went, and counting it would drag every
    // holiday week toward the floor.
    const stats = weekAt(W, 1);
    const dates = weekDates(W);
    stats[dates[0]] = stat(dates[0], 0, 0);
    expect(weekScore(stats, W)).toBe(1);
  });

  it('reports nothing at all for a week with no plans', () => {
    expect(weekScore({}, W)).toBeNull();
  });

  it('never exceeds one, so an overrun cannot inflate a comparison', () => {
    expect(weekScore(weekAt(W, 3), W)).toBe(1);
  });
});

describe('the assay', () => {
  it('pays the floor and says why on thin history', () => {
    // Inventing a comparison and dressing it as a finding would be worse than admitting
    // there is nothing to compare against.
    const thin = history(1, 1, ASSAY_MIN_WEEKS - 1);
    const r = assay(thin, W);
    expect(r.brass).toBe(ASSAY_FLOOR);
    expect(r.median).toBeNull();
    expect(r.note).toMatch(/not enough weeks/i);
  });

  it('pays the middle for a week at the median', () => {
    const r = assay(history(0.6, 0.6), W);
    expect(r.median).toBeCloseTo(0.6, 5);
    expect(r.brass).toBe(Math.round((ASSAY_FLOOR + ASSAY_CEILING) / 2));
    expect(r.note).toMatch(/exactly your usual/);
  });

  it('pays more for a week above it, and less below', () => {
    const better = assay(history(0.9, 0.45), W).brass;
    const usual = assay(history(0.45, 0.45), W).brass;
    const worse = assay(history(0.2, 0.45), W).brass;
    expect(better).toBeGreaterThan(usual);
    expect(worse).toBeLessThan(usual);
  });

  it('stays inside the band however good or bad the week', () => {
    // Against a very low median, a normal week is a huge ratio; the band is what stops one
    // recovered week paying a fortune.
    expect(assay(history(1, 0.02), W).brass).toBe(ASSAY_CEILING);
    expect(assay(history(0, 1), W).brass).toBe(ASSAY_FLOOR);
  });

  it('measures against you, not against a bar', () => {
    // The same week pays differently depending on the profile it belongs to. A heavy user
    // is not rewarded for turning up, and a light one is not punished for being light.
    const light = assay(history(0.5, 0.25), W).brass;
    const heavy = assay(history(0.5, 0.95), W).brass;
    expect(light).toBeGreaterThan(heavy);
  });

  it('takes a median rather than a mean, so one bad week does not move it', () => {
    let stats = weekAt(W, 0.8);
    // Three weeks at 0.8 and one write-off. A mean would read 0.6; the median reads 0.8.
    [0.8, 0.8, 0.8, 0].forEach((r, i) => {
      stats = { ...stats, ...weekAt(weeksBack(W, i + 1), r) };
    });
    expect(assay(stats, W).median).toBeCloseTo(0.8, 5);
  });

  it('handles a week with nothing in it without throwing', () => {
    const r = assay(history(0, 0.5), W);
    expect(r.score).toBe(0);
    expect(r.brass).toBe(ASSAY_FLOOR);
    expect(r.note.length).toBeGreaterThan(0);
  });

  it('keys once per week', () => {
    expect(assayKey(W)).toBe(`assay:${W}`);
    expect(assayKey(W)).not.toBe(assayKey(weeksBack(W, 1)));
  });

  it('is deterministic — the same stats give the same appraisal', () => {
    const stats = history(0.7, 0.5);
    expect(assay(stats, W)).toEqual(assay(stats, W));
  });
});

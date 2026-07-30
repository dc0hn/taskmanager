import { describe, it, expect } from 'vitest';
import { reconcileDays, emptyProgress } from './progress';
import { DEFAULT_CATEGORIES } from './types';
import type { Block, DailyStat, DayPlan } from './types';
import { buildInsightContext, insightStatuses } from './insights';
import { emptyAwards } from './streaks';

// Throwaway measurement harness for the technical audit. Not a behavioural test —
// it exists to put real numbers against the "recompute janks the UI" findings.

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const out = new Date(t);
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth() + 1).padStart(2, '0')}-${String(
    out.getUTCDate()
  ).padStart(2, '0')}`;
}

function makeDay(date: string, n: number): Block[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `${date}-${i}`,
    title: `Block ${i}`,
    start: 480 + i * 60,
    end: 480 + i * 60 + 50,
    category: DEFAULT_CATEGORIES[i % DEFAULT_CATEGORIES.length].id,
    completed: i % 3 !== 0,
    completedAt: i % 3 !== 0 ? 480 + i * 60 + 50 : undefined,
    priority: i % 4 === 0 ? 'high' : undefined,
  })) as Block[];
}

describe('audit: hot-path cost', () => {
  it('reconciles a full loaded window well inside a frame', () => {
    // The real effect reconciles `authoritativeDates`, which is bounded by the
    // month grid plus two weeks plus the visible day — 60 days is the ceiling.
    const days = Array.from({ length: 60 }, (_, i) => {
      const date = shiftKey('2026-07-30', i - 59);
      return { date, blocks: makeDay(date, 8) };
    });
    const stats: Record<string, DailyStat> = {};

    // Cold: nothing stored, every day is a change.
    const t0 = performance.now();
    const cold = reconcileDays(emptyProgress(), stats, days, DEFAULT_CATEGORIES);
    const coldMs = performance.now() - t0;

    // Warm: the steady state — every day already has a stored figure, so the pass
    // should short-circuit on the `same` check.
    const t1 = performance.now();
    for (let i = 0; i < 20; i++) {
      reconcileDays(cold.progress, cold.stats, days, DEFAULT_CATEGORIES);
    }
    const warmMs = (performance.now() - t1) / 20;

    console.log(
      `reconcile 60d/480 blocks — cold ${coldMs.toFixed(2)}ms, warm ${warmMs.toFixed(3)}ms`
    );
    expect(coldMs).toBeLessThan(16);
    expect(warmMs).toBeLessThan(16);
  });

  it('computes the 90-day codex inside a frame', () => {
    const plans: Record<string, DayPlan> = {};
    const dates: string[] = [];
    const stats: Record<string, DailyStat> = {};
    for (let i = 0; i < 90; i++) {
      const date = shiftKey('2026-07-30', i - 89);
      dates.push(date);
      plans[date] = { date, tasks: [], blocks: makeDay(date, 8) };
      stats[date] = {
        date,
        plannedMinutes: 400,
        doneMinutes: 300,
        xpEarned: 200,
        brassEarned: 20,
        bestCombo: 3,
        cleared: false,
        completedCount: 5,
        focusMinutes: 120,
      };
    }

    const t0 = performance.now();
    const ctx = buildInsightContext(plans, dates, stats, DEFAULT_CATEGORIES);
    const buildMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 10; i++) insightStatuses(emptyAwards(), ctx);
    const statusMs = (performance.now() - t1) / 10;

    console.log(
      `codex 90d/720 blocks — build ${buildMs.toFixed(2)}ms, 8 cards ${statusMs.toFixed(2)}ms`
    );
    expect(buildMs).toBeLessThan(16);
    expect(statusMs).toBeLessThan(16);
  });
});

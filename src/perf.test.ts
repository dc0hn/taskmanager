import { describe, it, expect } from 'vitest';
import { reconcileDays, emptyProgress } from './progress';
import { DEFAULT_CATEGORIES } from './types';
import type { Block, DailyStat, DayPlan } from './types';
import { buildInsightContext, insightStatuses } from './insights';
import { emptyAwards } from './streaks';
import { characterById } from './characters';
import { invalidatePlanDates, listPlanDates, loadPlans, savePlan } from './storage';

// ============================================================================
// Performance guards.
//
// Not behavioural tests. Each one puts a real number against a claim that would otherwise
// be an assumption, and fails if a change makes the app slow rather than wrong — which is
// the failure mode a test suite otherwise never catches.
//
// Two of these started as one-off measurements answering an audit's "this must be janking
// the UI" findings. They were kept because the measurements dropped the findings, and a
// number that dropped a finding is worth holding on to.
// ============================================================================

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

    // And again with a character applied to every day, since that adds a per-block call
    // inside the hottest loop in the app.
    const mods = Object.fromEntries(
      days.map((d) => [d.date, { boost: 1, character: characterById('the-long-haul') }])
    );
    const t2 = performance.now();
    reconcileDays(emptyProgress(), {}, days, DEFAULT_CATEGORIES, mods);
    const characterMs = performance.now() - t2;

    console.log(
      `reconcile 60d/480 blocks — cold ${coldMs.toFixed(2)}ms, warm ${warmMs.toFixed(3)}ms, with character ${characterMs.toFixed(2)}ms`
    );
    expect(coldMs).toBeLessThan(16);
    expect(warmMs).toBeLessThan(16);
    expect(characterMs).toBeLessThan(16);
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

// ---------------------------------------------------------------------------

/** In-memory stand-in, same shape the storage suites use. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

describe('audit: load-path cost', () => {
  it('reads and parses the codex window inside a frame', () => {
    // The gap the other two tests leave: they build blocks in memory, so the storage
    // path — getItem plus JSON.parse per day, plus a full key enumeration — was never
    // measured. This is the one place the app does ninety of those at once.
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    invalidatePlanDates();

    // Three years of history, so the key enumeration has something to walk.
    const ALL_DAYS = 1095;
    for (let i = 0; i < ALL_DAYS; i++) {
      const date = shiftKey('2026-07-30', i - (ALL_DAYS - 1));
      savePlan({ date, tasks: [], blocks: makeDay(date, 8) });
    }

    const window90 = Array.from({ length: 90 }, (_, i) => shiftKey('2026-07-30', i - 89));

    // Cold: the enumeration is unavoidable once.
    invalidatePlanDates();
    const t0 = performance.now();
    const stored = new Set(listPlanDates());
    const wanted = window90.filter((d) => stored.has(d));
    const plans = loadPlans(wanted);
    const coldMs = performance.now() - t0;
    expect(Object.keys(plans)).toHaveLength(90);

    // Warm: what it costs on a repeat, with the date list cached.
    const t1 = performance.now();
    for (let i = 0; i < 5; i++) {
      const s2 = new Set(listPlanDates());
      loadPlans(window90.filter((d) => s2.has(d)));
    }
    const warmMs = (performance.now() - t1) / 5;

    console.log(
      `load 90d of 1095 stored — cold ${coldMs.toFixed(2)}ms, warm ${warmMs.toFixed(2)}ms`
    );
    expect(coldMs).toBeLessThan(100);
    expect(warmMs).toBeLessThan(100);
  });

  it('does not re-enumerate the store once the date list is cached', () => {
    // The cache is the fix for listPlanDates being an O(all keys) walk behind a memo that
    // recomputed on every plans change. Measured rather than asserted structurally.
    (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
    invalidatePlanDates();
    for (let i = 0; i < 1095; i++) {
      const date = shiftKey('2026-07-30', i - 1094);
      savePlan({ date, tasks: [], blocks: [] });
    }

    invalidatePlanDates();
    const t0 = performance.now();
    listPlanDates();
    const firstMs = performance.now() - t0;

    const t1 = performance.now();
    for (let i = 0; i < 200; i++) listPlanDates();
    const cachedMs = (performance.now() - t1) / 200;

    console.log(
      `listPlanDates over 1095 keys — first ${firstMs.toFixed(3)}ms, cached ${cachedMs.toFixed(4)}ms`
    );
    expect(cachedMs).toBeLessThan(firstMs);
  });
});

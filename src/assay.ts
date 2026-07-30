import type { DailyStat } from './types';
import { dayScore } from './progress';
import { weekDates } from './week';

// ============================================================================
// The assay — a weekly appraisal, paid in brass
//
// Brass was strictly proportional to XP plus a flat five per kept day, which meant there
// was no skill in earning it: more work, more brass, and nothing else to do about it. The
// assay makes some of it a reward for how a week went rather than how big it was.
//
// MEASURED AGAINST YOU, NOT AGAINST A BAR. The comparison is the profile's own trailing
// four-week median, so a good week is good relative to your own recent weeks. An absolute
// threshold would pay a heavy user for turning up and pay a light one nothing for their
// best week in a month.
//
// THIN HISTORY PAYS THE FLOOR AND SAYS SO. Fewer than two comparable weeks and there is no
// median worth the name, so it pays the minimum and states plainly that it has nothing to
// compare against — rather than inventing a comparison and dressing it as a finding.
//
// Paid once per week, keyed `assay:<weekKey>`, through the same ledger as everything else.
// ============================================================================

export const ASSAY_FLOOR = 20;
export const ASSAY_CEILING = 120;

/** Weeks of history the comparison looks back over. */
export const ASSAY_WINDOW_WEEKS = 4;

/** Comparable weeks needed before a median is worth trusting. */
export const ASSAY_MIN_WEEKS = 2;

export const ASSAY_PREFIX = 'assay:';

export function assayKey(weekKey: string): string {
  return ASSAY_PREFIX + weekKey;
}

export interface Assay {
  weekKey: string;
  brass: number;
  /** What the week scored, 0..1. */
  score: number;
  /** The median it was measured against, or null when there was nothing to compare. */
  median: number | null;
  /** One sentence, shown as the finding. */
  note: string;
}

/** A week's score: completed minutes against planned, across days that had a plan. */
export function weekScore(
  stats: Record<string, DailyStat>,
  weekKey: string
): number | null {
  const days = weekDates(weekKey)
    .map((d) => stats[d])
    .filter((s): s is DailyStat => s != null && s.plannedMinutes > 0);
  if (days.length === 0) return null;
  const total = days.reduce((sum, s) => sum + dayScore(s), 0);
  return total / days.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The Monday `n` weeks before `weekKey`. */
function weeksBack(weekKey: string, n: number): string {
  const [y, m, d] = weekKey.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) - n * 7 * 86_400_000;
  const o = new Date(t);
  return `${o.getUTCFullYear()}-${String(o.getUTCMonth() + 1).padStart(2, '0')}-${String(
    o.getUTCDate()
  ).padStart(2, '0')}`;
}

/**
 * Appraise a finished week.
 *
 * Returns the brass owed and a sentence saying why. Never null: a week with nothing in it
 * still gets an honest answer, which is the floor and a plain statement of the fact.
 */
export function assay(
  stats: Record<string, DailyStat>,
  weekKey: string
): Assay {
  const score = weekScore(stats, weekKey) ?? 0;

  const priors: number[] = [];
  for (let i = 1; i <= ASSAY_WINDOW_WEEKS; i++) {
    const s = weekScore(stats, weeksBack(weekKey, i));
    if (s != null) priors.push(s);
  }

  if (priors.length < ASSAY_MIN_WEEKS) {
    return {
      weekKey,
      brass: ASSAY_FLOOR,
      score,
      median: null,
      note: 'Not enough weeks behind this one to compare against yet.',
    };
  }

  const med = median(priors);
  // Ratio against the median, clamped into the payout band. A week at the median pays the
  // middle; twice the median pays the ceiling; half pays the floor.
  const ratio = med > 0 ? score / med : score > 0 ? 2 : 0;
  const t = Math.max(0, Math.min(1, ratio / 2));
  const brass = Math.round(ASSAY_FLOOR + (ASSAY_CEILING - ASSAY_FLOOR) * t);

  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const note =
    score > med
      ? `You finished ${pct(score)} of what you planned, against ${pct(med)} in your recent weeks.`
      : score < med
        ? `You finished ${pct(score)} of what you planned. Your recent weeks run at ${pct(med)}.`
        : `You finished ${pct(score)} of what you planned, which is exactly your usual.`;

  return { weekKey, brass, score, median: med, note };
}

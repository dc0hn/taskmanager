import type { DayDigest } from './digest';
import { DEEP_BLOCK_MIN } from './digest';

// ============================================================================
// The metric battery
//
// Every metric here declares what it needs and REFUSES TO ANSWER without it. That
// refusal is the feature: §XII requires that when the data does not support a
// conclusion, the finding is "insufficient evidence, continuing to observe", and a
// battery that quietly divides by three days of data produces exactly the confident
// nonsense the method exists to prevent.
//
// So a Metric is never a bare number. It is a value, a sample size, a confidence, and
// — where it matters — an explicit note about what the figure does NOT mean.
//
// DEFINITIONS ARE VERSIONED, NEVER SILENTLY CHANGED. §VI. If a definition must change,
// bump `version` on that metric and the report says the series was re-baselined rather
// than pretending the old and new numbers are comparable.
// ============================================================================

export type Confidence = 'none' | 'weak' | 'fair' | 'good';

export interface Metric {
  id: string;
  label: string;
  /** The measured value, or null when there is not enough evidence. */
  value: number | null;
  /** Rendered form — '3.2 h', '41%', '2.4×'. Empty when value is null. */
  display: string;
  unit: string;
  /** Days of data behind it. */
  n: number;
  /** Days needed before it is worth reading at all. */
  needs: number;
  confidence: Confidence;
  /** What this measures, in one line. */
  definition: string;
  /**
   * What it does NOT measure. Present only where the distinction has already caused,
   * or would obviously cause, a wrong reading.
   */
  caveat?: string;
  /** Bumped when the definition changes. The series is re-baselined, not continued. */
  version: number;
}

function confidenceFor(n: number, needs: number): Confidence {
  if (n < needs) return 'none';
  if (n < needs * 2) return 'weak';
  if (n < needs * 4) return 'fair';
  return 'good';
}

function metric(
  spec: Omit<Metric, 'value' | 'display' | 'confidence' | 'n'> & {
    n: number;
    compute: () => number | null;
    format: (v: number) => string;
  }
): Metric {
  const enough = spec.n >= spec.needs;
  const value = enough ? spec.compute() : null;
  return {
    id: spec.id,
    label: spec.label,
    unit: spec.unit,
    n: spec.n,
    needs: spec.needs,
    definition: spec.definition,
    caveat: spec.caveat,
    version: spec.version,
    value,
    display: value == null ? '' : spec.format(value),
    confidence: value == null ? 'none' : confidenceFor(spec.n, spec.needs),
  };
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);

const pct = (v: number) => `${Math.round(v * 100)}%`;
const hours = (v: number) => `${(v / 60).toFixed(1)} h`;
const count = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const mins = (v: number) => `${Math.round(v)} min`;

/**
 * Compute the whole battery over a set of finished days.
 *
 * Takes digests rather than raw events on purpose: the battery must give the same
 * answer for a day whose film has been discarded as for one still inside the raw
 * window, or every trend would have a step in it fourteen days back.
 */
export function battery(days: DayDigest[]): Metric[] {
  const n = days.length;
  const active = days.filter((d) => d.blocksPlanned > 0);
  const nActive = active.length;

  return [
    // ---------------------------------------------------------------- adherence
    metric({
      id: 'completion',
      label: 'Completion rate',
      unit: '',
      n: nActive,
      needs: 5,
      version: 1,
      definition: 'Blocks ticked as a share of blocks planned, across days with a plan.',
      caveat: 'A block can be done without being ticked. This measures ticking.',
      compute: () => {
        const planned = sum(active.map((d) => d.blocksPlanned));
        return planned ? sum(active.map((d) => d.blocksDone)) / planned : null;
      },
      format: pct,
    }),
    metric({
      id: 'tick-drift',
      label: 'Tick drift',
      unit: 'min',
      n: active.filter((d) => d.tickDrift != null).length,
      needs: 5,
      version: 1,
      definition:
        'Median minutes between the end of a booked slot and the block being ticked. Positive is late.',
      caveat:
        'NOT how long work took. Almanac records when a block was ticked, never when it was started. Actual duration is not recorded at all.',
      compute: () => {
        const xs = active.map((d) => d.tickDrift).filter((x): x is number => x != null);
        return xs.length ? median(xs) : null;
      },
      format: (v) => `${v > 0 ? '+' : ''}${Math.round(v)} min`,
    }),

    // ------------------------------------------------------------------- churn
    metric({
      id: 'moves-per-day',
      label: 'Reschedules per day',
      unit: '',
      n: nActive,
      needs: 7,
      version: 1,
      definition: 'Blocks moved to a different time or day, per day with a plan.',
      compute: () => mean(active.map((d) => d.moves)),
      format: count,
    }),
    metric({
      id: 'rebuild-rate',
      label: 'Whole-day rebuilds',
      unit: '',
      n: nActive,
      needs: 7,
      version: 1,
      definition: 'Times a day was built, replanned or cleared, per day with a plan.',
      caveat:
        'A high figure is not necessarily waste. Rebuilding may be cheaper than moving six blocks by hand — that is what the flow chart is for.',
      compute: () => mean(active.map((d) => d.builds + d.clears)),
      format: count,
    }),

    // ----------------------------------------------------------- fragmentation
    metric({
      id: 'deep-ratio',
      label: 'Deep-work ratio',
      unit: '',
      n: nActive,
      needs: 7,
      version: 1,
      definition: `Planned minutes in blocks of ${DEEP_BLOCK_MIN} minutes or more, as a share of all planned minutes.`,
      caveat:
        'Measures the SHAPE of the plan, not whether the time was uninterrupted in practice. The app cannot see interruptions.',
      compute: () => {
        const planned = sum(active.map((d) => d.minutesPlanned));
        return planned ? sum(active.map((d) => d.deepMinutes)) / planned : null;
      },
      format: pct,
    }),
    metric({
      id: 'longest-block',
      label: 'Longest block',
      unit: 'min',
      n: nActive,
      needs: 5,
      version: 1,
      definition: 'Mean of each day’s single longest planned block.',
      compute: () => mean(active.map((d) => d.longestBlock)),
      format: mins,
    }),
    metric({
      id: 'contexts',
      label: 'Contexts per day',
      unit: '',
      n: nActive,
      needs: 7,
      version: 1,
      definition: 'Distinct categories carrying at least one block, per day.',
      caveat:
        'A crude proxy for context switching. Two blocks in one category may still be two different jobs, and the app has no way to tell.',
      compute: () => mean(active.map((d) => d.contexts)),
      format: count,
    }),

    // --------------------------------------------------------------- attention
    metric({
      id: 'opens',
      label: 'App opens per day',
      unit: '',
      n,
      needs: 7,
      version: 1,
      definition: 'Times Almanac was opened or returned to, per day observed.',
      caveat:
        'Counts consulting the calendar, which is an Inspect motion. Whether that is enabling or avoidance depends on what followed it.',
      compute: () => mean(days.map((d) => d.opens)),
      format: count,
    }),
    metric({
      id: 'navigation',
      label: 'Navigations per day',
      unit: '',
      n,
      needs: 7,
      version: 1,
      definition: 'View switches and day-to-day movements, per day observed.',
      caveat: 'Transport. Produces nothing by itself — a primary waste target.',
      compute: () => mean(days.map((d) => d.viewSwitches + d.dayNavigations)),
      format: count,
    }),
    metric({
      id: 'touch-without-change',
      label: 'Consult-to-change ratio',
      unit: '×',
      n,
      needs: 7,
      version: 1,
      definition:
        'Opens and navigations for every one edit, move or completion. High means the calendar is being read far more than it is being acted on.',
      caveat:
        'Reading the plan is legitimate. This is a signal to investigate, never a verdict on its own.',
      compute: () => {
        const looks = sum(days.map((d) => d.opens + d.viewSwitches + d.dayNavigations));
        const acts = sum(
          days.map((d) => d.creates + d.moves + d.resizes + d.deletes + d.blocksDone)
        );
        return acts ? looks / acts : null;
      },
      format: (v) => `${v.toFixed(1)}×`,
    }),

    // -------------------------------------------------------------------- load
    metric({
      id: 'committed',
      label: 'Committed hours per day',
      unit: 'h',
      n: nActive,
      needs: 5,
      version: 1,
      definition: 'Planned minutes per day with a plan, as hours.',
      compute: () => mean(active.map((d) => d.minutesPlanned)),
      format: hours,
    }),
    metric({
      id: 'done-hours',
      label: 'Completed hours per day',
      unit: 'h',
      n: nActive,
      needs: 5,
      version: 1,
      definition: 'Minutes in ticked blocks per day with a plan, as hours.',
      compute: () => mean(active.map((d) => d.minutesDone)),
      format: hours,
    }),

    // ------------------------------------------------------------------ rhythm
    metric({
      id: 'first-tick',
      label: 'First completion',
      unit: '',
      n: active.filter((d) => d.firstTick != null).length,
      needs: 5,
      version: 1,
      definition: 'Median time of the first block ticked on a day.',
      compute: () => {
        const xs = active.map((d) => d.firstTick).filter((x): x is number => x != null);
        return xs.length ? median(xs) : null;
      },
      format: clock,
    }),
    metric({
      id: 'last-tick',
      label: 'Last completion',
      unit: '',
      n: active.filter((d) => d.lastTick != null).length,
      needs: 5,
      version: 1,
      definition: 'Median time of the last block ticked on a day.',
      caveat: 'A late figure may be late work, or work ticked late. These are different.',
      compute: () => {
        const xs = active.map((d) => d.lastTick).filter((x): x is number => x != null);
        return xs.length ? median(xs) : null;
      },
      format: clock,
    }),
  ];
}

function clock(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Weekday profile — the shape of the week, which is where rhythm findings come from. */
export function byWeekday(days: DayDigest[]): {
  weekday: number;
  n: number;
  completion: number | null;
  moves: number | null;
}[] {
  const out: { weekday: number; n: number; completion: number | null; moves: number | null }[] =
    [];
  for (let wd = 0; wd < 7; wd++) {
    const on = days.filter((x) => weekdayOf(x.date) === wd && x.blocksPlanned > 0);
    const planned = sum(on.map((x) => x.blocksPlanned));
    out.push({
      weekday: wd,
      n: on.length,
      completion: planned ? sum(on.map((x) => x.blocksDone)) / planned : null,
      moves: on.length ? mean(on.map((x) => x.moves)) : null,
    });
  }
  return out;
}

/** 0 = Sunday. UTC, so the label of a date never depends on the reader's timezone. */
function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

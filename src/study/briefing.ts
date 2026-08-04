import type { DayDigest } from './digest';
import type { Metric } from './metrics';
import { battery } from './metrics';
import { LIMITS } from './limits';
import type { Individuality } from './profile';
import { daysBetween } from '../utils/time';

// ============================================================================
// The round trip
//
// Almanac is offline and has no model in it, so analysis happens outside. This is the
// loop that makes that work without the app becoming a dumb terminal:
//
//   the app decides an export is WORTH doing        →  shouldExport()
//   the app writes a briefing pack                  →  buildBriefing()
//   analysis happens elsewhere
//   findings come back in, validated and sealed     →  parseFindings()
//   the app charts them against what happened next  →  scoreFinding()
//
// The last step is the point. A finding that cannot be checked against subsequent
// behaviour is an opinion; one that can is a prediction. So an imported finding may
// carry a `watch` — a metric, a direction and a threshold — and the app then reports,
// every week, whether the thing that was claimed actually held.
//
// IMPORTED FINDINGS ARE SEALED. They record what was believed on a date, and are never
// rewritten when later data disagrees. The disagreement IS the finding — §XII requires
// negative results be published, and a register that quietly edits its own past
// predictions cannot produce one.
// ============================================================================

export const BRIEFING_FORMAT = 'almanac.study.briefing.v1';
export const FINDINGS_FORMAT = 'almanac.study.findings.v1';

/** Days of new data before another export is worth the trouble. */
export const EXPORT_INTERVAL_DAYS = 7;
/** Days of data before the first export is worth anything at all. */
export const BASELINE_DAYS = 14;

export interface ExportPrompt {
  ready: boolean;
  /** Why, in one line — shown as the reason to act, or the reason to wait. */
  reason: string;
  /** Days of digested observation available. */
  observed: number;
  /** Days since the last export, or null if there has never been one. */
  since: number | null;
}

/**
 * Whether to suggest an export, and what to say about it.
 *
 * Suggests rather than nags, and refuses to suggest before the baseline is complete —
 * §II is explicit that a bad baseline poisons every comparison afterwards, and an
 * export at day four would produce a confident first report built on nothing.
 */
export function shouldExport(
  digests: DayDigest[],
  lastExport: string | null,
  today: string
): ExportPrompt {
  const observed = digests.length;
  const since = lastExport ? daysBetween(lastExport, today) : null;

  if (observed < BASELINE_DAYS) {
    const left = BASELINE_DAYS - observed;
    return {
      ready: false,
      observed,
      since,
      reason: `Baseline incomplete — ${left} more ${left === 1 ? 'day' : 'days'} of observation before the first export is worth reading.`,
    };
  }

  if (since == null) {
    return {
      ready: true,
      observed,
      since,
      reason: `Baseline complete. ${observed} days observed — ready for a first analysis.`,
    };
  }

  if (since >= EXPORT_INTERVAL_DAYS) {
    return {
      ready: true,
      observed,
      since,
      reason: `${since} days since the last analysis. Enough has happened to be worth another look.`,
    };
  }

  return {
    ready: false,
    observed,
    since,
    reason: `Last analysed ${since} ${since === 1 ? 'day' : 'days'} ago. A week is one observation — wait for more.`,
  };
}

export interface Briefing {
  format: string;
  generated: string;
  observedDays: number;
  /** Every digested day, so the analysis can see the series rather than a summary. */
  days: DayDigest[];
  /** The battery as the app computes it, so both sides quote the same figures. */
  battery: Metric[];
  /** What the instrument cannot see, carried WITH the data it qualifies. */
  limits: typeof LIMITS;
  /** The user's own account of their work. */
  profile: Individuality;
  /** Findings already imported, so the analysis knows what it previously claimed. */
  priorFindings: Finding[];
}

export function buildBriefing(
  today: string,
  digests: DayDigest[],
  profile: Individuality,
  priorFindings: Finding[]
): Briefing {
  return {
    format: BRIEFING_FORMAT,
    generated: today,
    observedDays: digests.length,
    days: [...digests].sort((a, b) => a.date.localeCompare(b.date)),
    battery: battery(digests),
    limits: LIMITS,
    profile,
    priorFindings,
  };
}

/**
 * A claim, with the evidence class it was made under.
 *
 * `kind` is §XII's requirement that observed, inferred and hypothesised never blur
 * together. It is a required field precisely because an optional one would be omitted
 * exactly when the distinction mattered most.
 */
export interface Finding {
  id: string;
  /** When it was made. Sealed — never updated. */
  dated: string;
  kind: 'observed' | 'inferred' | 'hypothesis';
  headline: string;
  detail: string;
  /** Which of the three minds is speaking, where they disagree. */
  voice?: 'taylor' | 'frank' | 'lillian';
  /**
   * A testable prediction, if the finding makes one.
   *
   * This is what turns the section from a scrapbook into a study: the app can check
   * every week whether what was claimed has held, without anyone remembering to.
   */
  watch?: {
    metric: string;
    direction: 'up' | 'down' | 'steady';
    /** The value at the time of the claim, for comparison. */
    from: number;
    /** What would count as the prediction holding. */
    target?: number;
  };
}

export interface FindingsPack {
  format: string;
  dated: string;
  period: string;
  findings: Finding[];
}

/**
 * Read a findings pack, keeping only what is fully well-formed.
 *
 * Strict rather than forgiving, and unusually so for this codebase. Everywhere else a
 * malformed record is repaired to a sensible default, because the cost of losing a
 * block is higher than the cost of a slightly wrong one. Here it inverts: a finding is
 * evidence about the user's own working life, and a half-read one — a headline whose
 * `kind` fell off and defaulted to 'observed' — is worse than no finding at all,
 * because it launders a hypothesis into a fact.
 */
export function parseFindings(raw: unknown): { pack: FindingsPack | null; error: string } {
  if (!raw || typeof raw !== 'object') {
    return { pack: null, error: 'That is not a findings pack.' };
  }
  const p = raw as Record<string, unknown>;
  if (p.format !== FINDINGS_FORMAT) {
    return {
      pack: null,
      error: `Expected format ${FINDINGS_FORMAT}, found ${
        typeof p.format === 'string' ? p.format : 'nothing'
      }.`,
    };
  }
  if (!Array.isArray(p.findings)) {
    return { pack: null, error: 'The pack has no findings list.' };
  }

  const findings: Finding[] = [];
  for (const item of p.findings) {
    const f = readFinding(item);
    if (f) findings.push(f);
  }
  if (findings.length === 0) {
    return { pack: null, error: 'No readable findings in that pack.' };
  }

  return {
    pack: {
      format: FINDINGS_FORMAT,
      dated: typeof p.dated === 'string' ? p.dated : '',
      period: typeof p.period === 'string' ? p.period : '',
      findings,
    },
    error: '',
  };
}

const KINDS = new Set(['observed', 'inferred', 'hypothesis']);
const VOICES = new Set(['taylor', 'frank', 'lillian']);
const DIRECTIONS = new Set(['up', 'down', 'steady']);

function readFinding(raw: unknown): Finding | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  if (typeof f.id !== 'string' || !f.id) return null;
  if (typeof f.headline !== 'string' || !f.headline.trim()) return null;
  // Required, and never defaulted. See the note on `parseFindings`.
  if (typeof f.kind !== 'string' || !KINDS.has(f.kind)) return null;

  const out: Finding = {
    id: f.id,
    dated: typeof f.dated === 'string' ? f.dated : '',
    kind: f.kind as Finding['kind'],
    headline: f.headline.trim().slice(0, 300),
    detail: typeof f.detail === 'string' ? f.detail.trim().slice(0, 4000) : '',
  };
  if (typeof f.voice === 'string' && VOICES.has(f.voice)) {
    out.voice = f.voice as Finding['voice'];
  }

  const w = f.watch;
  if (w && typeof w === 'object') {
    const watch = w as Record<string, unknown>;
    const from = watch.from;
    if (
      typeof watch.metric === 'string' &&
      watch.metric &&
      typeof watch.direction === 'string' &&
      DIRECTIONS.has(watch.direction) &&
      typeof from === 'number' &&
      Number.isFinite(from)
    ) {
      out.watch = {
        metric: watch.metric,
        direction: watch.direction as 'up' | 'down' | 'steady',
        from,
        target:
          typeof watch.target === 'number' && Number.isFinite(watch.target)
            ? watch.target
            : undefined,
      };
    }
  }

  return out;
}

export type Verdict = 'held' | 'contradicted' | 'flat' | 'unmeasurable';

export interface FindingCheck {
  finding: Finding;
  verdict: Verdict;
  /** The metric's value now, or null if it cannot currently be computed. */
  now: number | null;
  /** Change since the claim, as a signed fraction of the original. */
  change: number | null;
  note: string;
}

/**
 * Has a finding's prediction held?
 *
 * `flat` exists so a real move and statistical noise are not reported as the same
 * thing. §XII: "a 4% change in a noisy metric over one week is nothing, and calling it
 * a win is how this practice degrades into astrology." The threshold is deliberately
 * generous — a tenth of the original value — and a change under it reports as flat
 * whichever direction it went.
 */
export const FLAT_THRESHOLD = 0.1;

export function scoreFinding(finding: Finding, current: Metric[]): FindingCheck {
  const base: Omit<FindingCheck, 'verdict' | 'note'> = {
    finding,
    now: null,
    change: null,
  };

  if (!finding.watch) {
    return { ...base, verdict: 'unmeasurable', note: 'No prediction attached.' };
  }
  const metric = current.find((m) => m.id === finding.watch!.metric);
  if (!metric || metric.value == null) {
    return {
      ...base,
      verdict: 'unmeasurable',
      note: metric
        ? `${metric.label} does not have enough data yet (${metric.n}/${metric.needs} days).`
        : `No metric called "${finding.watch.metric}".`,
    };
  }

  const { from, direction } = finding.watch;
  const now = metric.value;
  // Guard the divide: a metric that was zero has no meaningful proportional change,
  // and reporting an infinite improvement is worse than reporting none.
  const change = from === 0 ? null : (now - from) / Math.abs(from);

  if (change == null) {
    return { ...base, now, verdict: 'unmeasurable', note: 'Started at zero — no ratio to take.' };
  }
  if (Math.abs(change) < FLAT_THRESHOLD) {
    return {
      ...base,
      now,
      change,
      verdict: 'flat',
      note: `${metric.label} moved ${(change * 100).toFixed(0)}% — inside the noise floor.`,
    };
  }

  const moved = change > 0 ? 'up' : 'down';
  if (direction === 'steady') {
    return {
      ...base,
      now,
      change,
      verdict: 'contradicted',
      note: `Predicted steady; ${metric.label} moved ${moved} ${Math.abs(change * 100).toFixed(0)}%.`,
    };
  }

  const held = moved === direction;
  return {
    ...base,
    now,
    change,
    verdict: held ? 'held' : 'contradicted',
    note: `Predicted ${direction}; ${metric.label} went ${moved} ${Math.abs(change * 100).toFixed(0)}%.`,
  };
}

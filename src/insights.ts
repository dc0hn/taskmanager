import type { AwardLedger, Block, CategoryDef, DailyStat, DayPlan } from './types';
import { UNKNOWN_CATEGORY } from './types';
import { scorable, wasOnTime } from './progress';

// ============================================================================
// The codex — what the calendar has learned about you
//
// The layer that closes the loop. Everything else in the progression system tells
// you how you did; this tells you something you did not already know, derived from
// blocks you have already completed.
//
// Three rules, and the first is the one that makes it honest:
//
//   AN INSIGHT HAS A DATA REQUIREMENT, AND IT IS REAL. "You finish 78% of focus work
//   before noon" is worthless from four blocks. Each card names how much it needs and
//   stays sealed until it has it — so the requirement doubles as the collection
//   mechanic and as the reason to trust the answer.
//
//   WE ONLY CLAIM WHAT WE RECORD. The brief asked for estimate-versus-actual, but
//   Almanac records when you TICKED a block, not how long you actually spent. So the
//   card measures lateness against the slot you booked, and says that is what it
//   measures. Inventing an "actual duration" from a completion timestamp would be a
//   fabrication dressed as an insight.
//
//   FINDINGS ARE DERIVED, NEVER STORED. Only the unlock and the first read are
//   recorded, in the same award ledger the badges use. So an insight always reflects
//   your current history rather than a snapshot of the day it happened to unlock.
// ============================================================================

export interface InsightContext {
  /** Trailing window of days, oldest first. */
  days: { date: string; blocks: Block[] }[];
  stats: Record<string, DailyStat>;
  categories: CategoryDef[];
}

export interface InsightFinding {
  headline: string;
  detail: string[];
  /** Optional bars, drawn as pixel columns. */
  bars?: { label: string; value: number; max: number; note?: string }[];
}

interface InsightRule {
  id: string;
  name: string;
  /** What the card will tell you, shown while sealed. */
  promise: string;
  requirement: string;
  target: number;
  progress: (c: InsightContext) => number;
  compute: (c: InsightContext) => InsightFinding | null;
  glyph: string;
  xpUnlock: number;
  xpRead: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function kindOf(categoryId: string, categories: CategoryDef[]): string {
  return (categories.find((c) => c.id === categoryId) ?? UNKNOWN_CATEGORY).kind;
}

function labelOf(categoryId: string, categories: CategoryDef[]): string {
  return (categories.find((c) => c.id === categoryId) ?? UNKNOWN_CATEGORY).label;
}

interface Entry {
  date: string;
  block: Block;
}

function allBlocks(c: InsightContext): Entry[] {
  return c.days.flatMap((d) => scorable(d.blocks).map((block) => ({ date: d.date, block })));
}

function completed(c: InsightContext): Entry[] {
  return allBlocks(c).filter((e) => e.block.completed);
}

/** Completions carrying a usable timestamp. Everything time-of-day depends on these. */
function stamped(c: InsightContext): Entry[] {
  return completed(c).filter((e) => e.block.completedAt != null);
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}

function hoursMins(minutes: number): string {
  const h = Math.floor(Math.abs(minutes) / 60);
  const m = Math.abs(minutes) % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------------------------------------------------------------------------
// The library
// ---------------------------------------------------------------------------

export const INSIGHTS: InsightRule[] = [
  {
    id: 'peak-window',
    name: 'Your real peak window',
    promise: 'Which part of the day you actually finish things in',
    requirement: '20 timed completions',
    target: 20,
    glyph: 'early-bird',
    xpUnlock: 120,
    xpRead: 60,
    progress: (c) => stamped(c).length,
    compute: (c) => {
      const entries = stamped(c);
      if (entries.length === 0) return null;
      // Four windows rather than 24 hours: an hourly breakdown from a few hundred
      // blocks is noise wearing a chart's clothing.
      const windows = [
        { label: 'Before 9am', from: 0, to: 540 },
        { label: '9am – noon', from: 540, to: 720 },
        { label: 'Noon – 5pm', from: 720, to: 1020 },
        { label: 'After 5pm', from: 1020, to: 2880 },
      ];
      const counts = windows.map((w) => ({
        ...w,
        n: entries.filter((e) => e.block.completedAt! >= w.from && e.block.completedAt! < w.to)
          .length,
      }));
      const best = counts.reduce((m, w) => (w.n > m.n ? w : m));
      const max = Math.max(...counts.map((w) => w.n));
      return {
        headline: `${pct(best.n, entries.length)}% of what you finish, you finish ${best.label.toLowerCase()}`,
        detail: [
          `Across ${entries.length} timed completions.`,
          'Book the work that matters most into that window and the rest around it.',
        ],
        bars: counts.map((w) => ({ label: w.label, value: w.n, max, note: `${w.n}` })),
      };
    },
  },

  {
    id: 'category-lateness',
    name: 'What overruns its slot',
    promise: 'Which kinds of work you consistently book too little time for',
    requirement: '25 timed completions',
    target: 25,
    glyph: 'focus-marathon',
    xpUnlock: 140,
    xpRead: 60,
    progress: (c) => stamped(c).length,
    compute: (c) => {
      const entries = stamped(c);
      const byCat = new Map<string, number[]>();
      for (const e of entries) {
        // Minutes past the end of the booked slot. Negative means finished early.
        const over = e.block.completedAt! - e.block.end;
        const list = byCat.get(e.block.category) ?? [];
        list.push(over);
        byCat.set(e.block.category, list);
      }
      const rows = [...byCat.entries()]
        .filter(([, l]) => l.length >= 3)
        .map(([id, l]) => ({
          id,
          label: labelOf(id, c.categories),
          mean: Math.round(l.reduce((s, n) => s + n, 0) / l.length),
          n: l.length,
        }))
        .sort((a, b) => b.mean - a.mean);
      if (rows.length === 0) return null;

      const worst = rows[0];
      const max = Math.max(1, ...rows.map((r) => Math.abs(r.mean)));
      return {
        headline:
          worst.mean > 0
            ? `${worst.label} finishes ${hoursMins(worst.mean)} past its slot on average`
            : `Nothing overruns — even ${worst.label} lands inside its slot`,
        detail: [
          'Measured as how far past the booked end you tick something, not as time spent — Almanac records when you finish, not how long you took.',
          worst.mean > 0
            ? `Booking ${worst.label.toLowerCase()} ${hoursMins(worst.mean)} longer would make the rest of those days honest.`
            : 'Your estimates are running ahead of reality, which is the good direction.',
        ],
        bars: rows.map((r) => ({
          label: r.label,
          value: Math.abs(r.mean),
          max,
          note: `${r.mean > 0 ? '+' : ''}${r.mean}m`,
        })),
      };
    },
  },

  {
    id: 'avoidance',
    name: 'What you keep avoiding',
    promise: 'The work you move rather than do',
    requirement: '8 blocks moved at least once',
    target: 8,
    glyph: 'finally',
    xpUnlock: 140,
    xpRead: 60,
    progress: (c) => allBlocks(c).filter((e) => (e.block.moves ?? 0) > 0).length,
    compute: (c) => {
      const moved = allBlocks(c)
        .filter((e) => (e.block.moves ?? 0) > 0)
        .sort((a, b) => (b.block.moves ?? 0) - (a.block.moves ?? 0));
      if (moved.length === 0) return null;

      const worst = moved[0];
      const stillOpen = moved.filter((e) => !e.block.completed).length;
      const max = Math.max(...moved.map((e) => e.block.moves ?? 0));
      return {
        headline: `"${worst.block.title}" has been moved ${worst.block.moves} times`,
        detail: [
          `${moved.length} blocks have been moved at least once; ${stillOpen} of them are still open.`,
          'Something moved repeatedly is usually mis-sized, mis-timed, or not actually wanted. All three are worth knowing.',
        ],
        bars: moved.slice(0, 6).map((e) => ({
          label: e.block.title,
          value: e.block.moves ?? 0,
          max,
          note: `${e.block.moves}×`,
        })),
      };
    },
  },

  {
    id: 'hours-go',
    name: 'Where your hours actually go',
    promise: 'The gap between what you intend and what you do',
    requirement: '30 recorded days',
    target: 30,
    glyph: 'big-day',
    xpUnlock: 160,
    xpRead: 60,
    progress: (c) => Object.keys(c.stats).length,
    compute: (c) => {
      const planned = new Map<string, number>();
      const done = new Map<string, number>();
      for (const e of allBlocks(c)) {
        const m = e.block.end - e.block.start;
        planned.set(e.block.category, (planned.get(e.block.category) ?? 0) + m);
        if (e.block.completed) {
          done.set(e.block.category, (done.get(e.block.category) ?? 0) + m);
        }
      }
      const totalPlanned = [...planned.values()].reduce((s, n) => s + n, 0);
      const totalDone = [...done.values()].reduce((s, n) => s + n, 0);
      if (totalPlanned === 0) return null;

      const rows = [...planned.entries()]
        .map(([id, p]) => ({
          label: labelOf(id, c.categories),
          intended: pct(p, totalPlanned),
          actual: pct(done.get(id) ?? 0, Math.max(1, totalDone)),
        }))
        .sort((a, b) => b.intended - a.intended);

      const biggestGap = rows.reduce((m, r) =>
        Math.abs(r.intended - r.actual) > Math.abs(m.intended - m.actual) ? r : m
      );
      const drift = biggestGap.actual - biggestGap.intended;
      return {
        headline:
          drift < 0
            ? `You intend ${biggestGap.intended}% ${biggestGap.label.toLowerCase()} and manage ${biggestGap.actual}%`
            : `${biggestGap.label} takes ${biggestGap.actual}% of your finished time against ${biggestGap.intended}% planned`,
        detail: [
          `${hoursMins(totalDone)} completed of ${hoursMins(totalPlanned)} planned across the window.`,
          'Shares of completed time, not of the calendar — so this is where the hours land rather than where you meant to put them.',
        ],
        bars: rows.map((r) => ({
          label: r.label,
          value: r.actual,
          max: Math.max(...rows.map((x) => Math.max(x.actual, x.intended))),
          note: `${r.actual}% / ${r.intended}% planned`,
        })),
      };
    },
  },

  {
    id: 'best-weekday',
    name: 'Your strongest day',
    promise: 'Which day of the week you actually deliver on',
    requirement: '21 recorded days',
    target: 21,
    glyph: 'weekday-five',
    xpUnlock: 100,
    xpRead: 60,
    progress: (c) => Object.keys(c.stats).length,
    compute: (c) => {
      const byDow = Array.from({ length: 7 }, () => ({ planned: 0, done: 0, days: 0 }));
      for (const [date, stat] of Object.entries(c.stats)) {
        if (stat.plannedMinutes <= 0) continue;
        const dow = new Date(`${date}T00:00:00`).getDay();
        byDow[dow].planned += stat.plannedMinutes;
        byDow[dow].done += stat.doneMinutes;
        byDow[dow].days += 1;
      }
      const rows = byDow
        .map((v, dow) => ({ dow, ...v, rate: pct(v.done, v.planned) }))
        .filter((r) => r.days >= 2);
      if (rows.length < 3) return null;

      const best = rows.reduce((m, r) => (r.rate > m.rate ? r : m));
      const worst = rows.reduce((m, r) => (r.rate < m.rate ? r : m));
      return {
        headline: `${WEEKDAY[best.dow]} is your strongest day at ${best.rate}%`,
        detail: [
          `${WEEKDAY[worst.dow]} is the weakest at ${worst.rate}%.`,
          'Put the work you cannot afford to slip on the strong day, and keep the weak one light.',
        ],
        bars: rows.map((r) => ({
          label: WEEKDAY[r.dow].slice(0, 3),
          value: r.rate,
          max: 100,
          note: `${r.rate}%`,
        })),
      };
    },
  },

  {
    id: 'session-length',
    name: 'How long you can hold focus',
    promise: 'Whether long blocks actually get finished',
    requirement: '40 blocks planned',
    target: 40,
    glyph: 'heavy-lifter',
    xpUnlock: 140,
    xpRead: 60,
    progress: (c) => allBlocks(c).length,
    compute: (c) => {
      const buckets = [
        { label: 'Up to 30m', from: 0, to: 31 },
        { label: '30–60m', from: 31, to: 61 },
        { label: '60–90m', from: 61, to: 91 },
        { label: 'Over 90m', from: 91, to: 100000 },
      ];
      const rows = buckets
        .map((b) => {
          const inBucket = allBlocks(c).filter((e) => {
            const m = e.block.end - e.block.start;
            return m >= b.from && m < b.to;
          });
          return {
            label: b.label,
            n: inBucket.length,
            rate: pct(inBucket.filter((e) => e.block.completed).length, inBucket.length),
          };
        })
        .filter((r) => r.n >= 4);
      if (rows.length < 2) return null;

      const best = rows.reduce((m, r) => (r.rate > m.rate ? r : m));
      const longest = rows[rows.length - 1];
      return {
        headline: `${best.label} blocks get finished most — ${best.rate}% of them`,
        detail: [
          `Your longest bracket, ${longest.label.toLowerCase()}, lands at ${longest.rate}%.`,
          best.label === longest.label
            ? 'Long sessions suit you. Book them without hedging.'
            : 'Splitting the long ones at that length would raise the odds they happen at all.',
        ],
        bars: rows.map((r) => ({
          label: r.label,
          value: r.rate,
          max: 100,
          note: `${r.rate}% of ${r.n}`,
        })),
      };
    },
  },

  {
    id: 'punctuality',
    name: 'Whether you finish on time',
    promise: 'How often work lands inside the slot you gave it',
    requirement: '30 timed completions',
    target: 30,
    glyph: 'flawless',
    xpUnlock: 120,
    xpRead: 60,
    progress: (c) => stamped(c).length,
    compute: (c) => {
      const entries = stamped(c);
      if (entries.length === 0) return null;
      const onTime = entries.filter((e) => wasOnTime(e.block)).length;

      // Split the window in half to show direction rather than a bare average.
      const mid = Math.floor(entries.length / 2);
      const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
      const early = sorted.slice(0, mid);
      const late = sorted.slice(mid);
      const earlyRate = pct(early.filter((e) => wasOnTime(e.block)).length, early.length);
      const lateRate = pct(late.filter((e) => wasOnTime(e.block)).length, late.length);
      const trend = lateRate - earlyRate;

      return {
        headline: `${pct(onTime, entries.length)}% of your work lands inside its slot`,
        detail: [
          trend > 4
            ? `Improving — ${earlyRate}% in the earlier half against ${lateRate}% lately.`
            : trend < -4
              ? `Slipping — ${earlyRate}% earlier against ${lateRate}% lately, which usually means the plan has got tighter than the days.`
              : `Steady across the window, ${earlyRate}% then ${lateRate}%.`,
          'A slot you routinely overrun is a wrong estimate, not a failure of will.',
        ],
        bars: [
          { label: 'Earlier half', value: earlyRate, max: 100, note: `${earlyRate}%` },
          { label: 'Recent half', value: lateRate, max: 100, note: `${lateRate}%` },
        ],
      };
    },
  },

  {
    id: 'early-start',
    name: 'What an early start is worth',
    promise: 'Whether starting early actually changes the day',
    requirement: '25 recorded days',
    target: 25,
    glyph: 'dawn-patrol',
    xpUnlock: 160,
    xpRead: 60,
    progress: (c) => Object.keys(c.stats).length,
    compute: (c) => {
      const rows = c.days
        .map((d) => {
          const stat = c.stats[d.date];
          if (!stat || stat.plannedMinutes <= 0) return null;
          const stamps = scorable(d.blocks)
            .filter((b) => b.completed && b.completedAt != null)
            .map((b) => b.completedAt!);
          if (stamps.length === 0) return null;
          return { early: Math.min(...stamps) < 600, rate: pct(stat.doneMinutes, stat.plannedMinutes) };
        })
        .filter((r): r is { early: boolean; rate: number } => r != null);

      const earlyDays = rows.filter((r) => r.early);
      const lateDays = rows.filter((r) => !r.early);
      if (earlyDays.length < 4 || lateDays.length < 4) return null;

      const mean = (l: { rate: number }[]) => Math.round(l.reduce((s, r) => s + r.rate, 0) / l.length);
      const a = mean(earlyDays);
      const b = mean(lateDays);
      const gap = a - b;
      return {
        headline:
          gap >= 5
            ? `Days that start before 10am finish ${gap} points more of their plan`
            : gap <= -5
              ? `Early starts make no difference — late starters finish ${-gap} points more`
              : 'Starting early makes almost no difference to how much you finish',
        detail: [
          `${a}% on ${earlyDays.length} early-start days against ${b}% on ${lateDays.length} later ones.`,
          gap >= 5
            ? 'Worth protecting the first hour, on this evidence.'
            : 'On this evidence the first hour is not the lever — which is itself useful to know.',
        ],
        bars: [
          { label: 'Early start', value: a, max: 100, note: `${a}%` },
          { label: 'Later start', value: b, max: 100, note: `${b}%` },
        ],
      };
    },
  },
];

export const CODEX_TOTAL = INSIGHTS.length;

export function insightById(id: string): InsightRule | undefined {
  return INSIGHTS.find((i) => i.id === id);
}

// ---------------------------------------------------------------------------
// Ledger keys
// ---------------------------------------------------------------------------

export const UNLOCK_PREFIX = 'codex:';
export const READ_PREFIX = 'codexread:';

export function unlockKey(id: string): string {
  return UNLOCK_PREFIX + id;
}

export function readKey(id: string): string {
  return READ_PREFIX + id;
}

export function isUnlocked(ledger: AwardLedger, id: string): boolean {
  return ledger.granted.includes(unlockKey(id));
}

export function isRead(ledger: AwardLedger, id: string): boolean {
  return ledger.granted.includes(readKey(id));
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export interface InsightStatus {
  id: string;
  name: string;
  promise: string;
  requirement: string;
  glyph: string;
  unlocked: boolean;
  read: boolean;
  /** 0..1 toward the data requirement. */
  progress: number;
  progressLabel: string;
  xpUnlock: number;
  xpRead: number;
  /** Present only once unlocked, and recomputed every time. */
  finding: InsightFinding | null;
}

export function insightStatuses(
  ledger: AwardLedger,
  ctx: InsightContext
): InsightStatus[] {
  return INSIGHTS.map((rule) => {
    const have = Math.min(rule.progress(ctx), rule.target);
    const unlocked = isUnlocked(ledger, rule.id);
    return {
      id: rule.id,
      name: rule.name,
      promise: rule.promise,
      requirement: rule.requirement,
      glyph: rule.glyph,
      unlocked,
      read: isRead(ledger, rule.id),
      progress: rule.target > 0 ? have / rule.target : 0,
      progressLabel: `${have} / ${rule.target}`,
      xpUnlock: rule.xpUnlock,
      xpRead: rule.xpRead,
      finding: unlocked ? rule.compute(ctx) : null,
    };
  });
}

/**
 * Insights whose requirement is met but which have not been unlocked yet.
 *
 * An insight only unlocks if it can actually state something — `compute` returning
 * null means the requirement is satisfied on paper but the data will not support a
 * finding, and unlocking an empty card would be worse than leaving it sealed.
 */
export function unlocksDue(
  ledger: AwardLedger,
  ctx: InsightContext
): { keys: string[]; ids: string[]; xp: number } {
  const keys: string[] = [];
  const ids: string[] = [];
  let xp = 0;
  for (const rule of INSIGHTS) {
    if (isUnlocked(ledger, rule.id)) continue;
    if (rule.progress(ctx) < rule.target) continue;
    if (rule.compute(ctx) == null) continue;
    keys.push(unlockKey(rule.id));
    ids.push(rule.id);
    xp += rule.xpUnlock;
  }
  return { keys, ids, xp };
}

export function unlockedCount(ledger: AwardLedger): number {
  return INSIGHTS.filter((i) => isUnlocked(ledger, i.id)).length;
}

/** Sealed cards sink; unread unlocked ones rise, because they are owed to you. */
export function sortCodex(statuses: InsightStatus[]): InsightStatus[] {
  return [...statuses].sort((a, b) => {
    const rank = (s: InsightStatus) => (s.unlocked && !s.read ? 0 : s.unlocked ? 1 : 2);
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    return b.progress - a.progress;
  });
}

export function buildInsightContext(
  plans: Record<string, DayPlan>,
  dates: string[],
  stats: Record<string, DailyStat>,
  categories: CategoryDef[]
): InsightContext {
  return {
    days: dates
      .filter((d) => plans[d] != null)
      .map((d) => ({ date: d, blocks: plans[d].blocks })),
    stats,
    categories,
  };
}

export { kindOf };

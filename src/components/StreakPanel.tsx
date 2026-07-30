import { memo } from 'react';
import { motion } from 'framer-motion';
import { Snowflake } from 'lucide-react';
import type { DailyStat, DayMarkDef, DayMarks, DayOutcome, StreakState } from '../types';
import {
  daysUntilFreeze,
  describeStreak,
  displayRun,
  minutesToThreshold,
  outcomeStrip,
  STREAK_THRESHOLD,
} from '../streaks';
import { markById } from '../daymarks';
import { weekdayLabel } from '../week';
import { staggerDelay } from '../utils/motion';

// ============================================================================
// StreakPanel
//
// The run, its safety net, and what feeds it.
//
// Every visual decision here is about not making a lapse feel like a wound. There
// is no red anywhere. A reset draws as a *gap* in the strip rather than a cross —
// the run simply starts again to its right — and a frozen day gets the same amber
// as a kept one, because the run genuinely survived it.
//
// Routine streaks appear underneath as contributors rather than as a separate
// scoreboard. That is the unification: one run for the day, with the per-habit
// detail feeding it.
// ============================================================================

/**
 * Colour per outcome, plus the height used when a day earned no XP at all.
 *
 * There is no red in this table and no outcome draws taller than a kept day. A reset
 * is transparent — drawn as absence, not as damage, so the run visibly starts again
 * to its right rather than being marked with a wound.
 */
const OUTCOME_STYLE: Record<
  DayOutcome,
  { emptyCells: number; color: string; label: string }
> = {
  advanced: { emptyCells: 1, color: 'var(--signal)', label: 'kept' },
  held: { emptyCells: 2, color: 'var(--bone-2)', label: 'held — marked day' },
  frozen: { emptyCells: 2, color: 'var(--signal-line)', label: 'a freeze covered this' },
  neutral: { emptyCells: 1, color: 'var(--chassis-5)', label: 'nothing planned' },
  reset: { emptyCells: 0, color: 'transparent', label: 'fresh start' },
  open: { emptyCells: 1, color: 'var(--bone-3)', label: 'today, still in play' },
};

const STRIP_CELLS = 6;

interface Props {
  streak: StreakState;
  today: string;
  todayStat: DailyStat | undefined;
  stats: Record<string, DailyStat>;
  marks: DayMarks;
  markDefs: DayMarkDef[];
  /** Dates to draw, oldest first. */
  dates: string[];
  /** Routine streaks feeding the run. */
  routines: { id: string; label: string; current: number; dueToday: boolean; doneToday: boolean }[];
}

function StreakPanel({
  streak,
  today,
  todayStat,
  stats,
  marks,
  markDefs,
  dates,
  routines,
}: Props) {
  const todayMark = markById(markDefs, marks[today]);
  const run = displayRun(streak, todayStat, todayMark != null);
  const strip = outcomeStrip(dates, stats, marks, today, streak.frozenDates);
  const needed = minutesToThreshold(todayStat);
  const untilFreeze = daysUntilFreeze(streak, today);
  // Scale the strip against its own busiest day, so it stays readable whether a
  // typical day earns 90 XP or 400.
  const peakXp = Math.max(1, ...dates.map((d) => stats[d]?.xpEarned ?? 0));

  return (
    <div>
      <div className="flex items-start gap-6 flex-wrap">
        <div>
          <div className="flex items-baseline gap-2">
            <span
              className="font-mono tnum"
              style={{
                fontSize: 44,
                fontWeight: 700,
                lineHeight: 1,
                color: run > 0 ? 'var(--signal)' : 'var(--bone-2)',
              }}
            >
              {run}
            </span>
            <span className="text-body-sm text-bone-2">
              day{run === 1 ? '' : 's'}
            </span>
          </div>

          {/* The safety net, stated plainly. Hiding it is how people lose runs. */}
          <div className="flex items-center gap-1.5 mt-2">
            {Array.from({ length: streak.capacity }, (_, i) => (
              <Snowflake
                key={i}
                size={13}
                strokeWidth={2}
                style={{
                  color: i < streak.freezes ? 'var(--signal)' : 'var(--bone-5)',
                }}
              />
            ))}
            <span className="font-mono text-nano tnum text-bone-3 ml-1">
              {streak.freezes > 0
                ? `${streak.freezes} freeze${streak.freezes === 1 ? '' : 's'} in hand`
                : untilFreeze > 0
                  ? `next freeze in ${untilFreeze}d`
                  : 'freeze arriving'}
            </span>
          </div>
        </div>

        <div className="flex-1 min-w-[240px]">
          {todayMark ? (
            <div
              className="inline-flex items-center gap-2 px-2 py-1 mb-2"
              style={{
                background: `color-mix(in srgb, ${todayMark.color} 16%, transparent)`,
              }}
            >
              <span
                className="rounded-full shrink-0"
                style={{ width: 6, height: 6, background: todayMark.color }}
              />
              <span
                className="font-mono"
                style={{ fontSize: 10, letterSpacing: '0.1em', color: todayMark.color }}
              >
                {todayMark.label.toUpperCase()} — HELD
              </span>
            </div>
          ) : (
            <div className="font-mono text-nano tnum text-bone-3">
              {needed > 0
                ? `${needed} min to keep · threshold is ${Math.round(STREAK_THRESHOLD * 100)}% of today's plan`
                : `today is kept · ${Math.round(STREAK_THRESHOLD * 100)}% threshold cleared`}
            </div>
          )}
          <p className="text-body-sm text-bone-2 mt-2 leading-relaxed max-w-[46ch]">
            {describeStreak(streak, run, todayStat, todayMark != null)}
          </p>
        </div>
      </div>

      {/* ---------------- the fortnight ----------------
          One strip, not two. There used to be an outcome strip here and an XP strip
          a hundred pixels below it, both fourteen pixel columns with weekday letters
          — they read as the same object twice. Merged, height carries how much you
          did and colour carries what it meant, which is the pair of questions the two
          strips were separately failing to answer together. */}
      <div className="mt-5">
        {/* Columns flex to fill, so the strip spans the same measure as the meters
            above it. Fixed-width columns left it occupying a fifth of the panel and
            reading as a small chart tucked in a corner rather than part of the
            instrument. */}
        <div className="flex items-end gap-1.5 w-full">
          {strip.map(({ date, outcome }) => {
            const style = OUTCOME_STYLE[outcome];
            const isToday = date === today;
            const xp = stats[date]?.xpEarned ?? 0;
            // Height from XP, floored at one cell for any day that earned anything,
            // so a small real day is never indistinguishable from a blank one.
            const lit =
              outcome === 'reset'
                ? 0
                : xp > 0
                  ? Math.max(1, Math.round((xp / peakXp) * STRIP_CELLS))
                  : style.emptyCells;
            return (
              <div
                key={date}
                className="flex flex-col items-center gap-1 flex-1 min-w-0"
                title={`${date} · ${style.label}${xp > 0 ? ` · ${xp} XP` : ''}`}
              >
                <div className="flex flex-col-reverse gap-[2px] w-full">
                  {Array.from({ length: STRIP_CELLS }, (_, c) => (
                    <span
                      key={c}
                      style={{
                        width: '100%',
                        // Tall enough that a full-width column is roughly square
                        // overall. At 7px the columns were wider than they were tall
                        // and stopped reading as columns at all.
                        height: 9,
                        background: c < lit ? style.color : 'var(--chassis-3)',
                        outline:
                          isToday && c === 0 ? '1px solid var(--signal-line)' : undefined,
                      }}
                    />
                  ))}
                </div>
                <span className="font-mono text-bone-4" style={{ fontSize: 8.5 }}>
                  {weekdayLabel(date, 'narrow')}
                </span>
              </div>
            );
          })}
        </div>

        {/* A legend, because a strip encoding two variables needs one. */}
        <div className="flex items-center gap-3 mt-2.5 flex-wrap">
          {[
            { c: 'var(--signal)', t: 'kept' },
            { c: 'var(--bone-2)', t: 'held' },
            { c: 'var(--signal-line)', t: 'frozen' },
            { c: 'var(--chassis-5)', t: 'nothing planned' },
          ].map(({ c, t }) => (
            <span key={t} className="flex items-center gap-1.5">
              <span style={{ width: 8, height: 6, background: c }} aria-hidden />
              <span className="font-mono text-nano text-bone-3">{t}</span>
            </span>
          ))}
          <span className="font-mono text-nano text-bone-4">
            gap = fresh start · height = XP
          </span>
        </div>
      </div>

      {routines.length > 0 && (
        <div className="mt-5">
          <div className="legend mb-2">Routines feeding it</div>
          {routines.map((r, i) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, x: -3 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: staggerDelay(i), duration: 0.18 }}
              className="flex items-center gap-2 py-1.5 border-b border-rule-1"
            >
              <span
                className="shrink-0"
                style={{
                  width: 5,
                  height: 5,
                  background: r.doneToday
                    ? 'var(--good)'
                    : r.dueToday
                      ? 'var(--signal)'
                      : 'var(--bone-5)',
                }}
                aria-hidden
              />
              <span className="text-body-sm text-bone-1 truncate flex-1 min-w-0">
                {r.label}
              </span>
              {r.dueToday && !r.doneToday && (
                <span
                  className="font-mono text-nano"
                  style={{ letterSpacing: '0.08em', color: 'var(--signal)' }}
                >
                  DUE
                </span>
              )}
              <span className="font-mono text-nano tnum text-bone-2 shrink-0">
                {r.current}
              </span>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}

export default memo(StreakPanel);

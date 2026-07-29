import { memo, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import type { Block } from '../types';
import { formatDuration } from '../utils/time';
import { EASE_OUT, staggerDelay } from '../utils/motion';

// ============================================================================
// ProgressWheel
//
// Measured by TIME, not by block count.
//
// The previous version divided completed blocks by total blocks, which meant a
// ticked fifteen-minute break scored exactly as much as a three-hour focus
// session — so a day of deep work could read lower than a day of errands.
//
// Auto blocks (the scheduler's breaks and shutdown) are excluded from both the
// numerator and the denominator. They are bookkeeping rather than work you set
// out to do, and counting them would mean a day where you did everything but
// never ticked lunch could not reach 100%.
// ============================================================================

interface Props {
  blocks: Block[];
}

interface Level {
  name: string;
  hint: string;
  glyph: string;
}

function levelFor(pct: number, doneMinutes: number): Level {
  if (doneMinutes === 0) return { name: 'Day ahead', hint: 'Begin with something small.', glyph: '○' };
  if (pct < 25) return { name: 'Warming up', hint: 'Steady — keep going.', glyph: '◔' };
  if (pct < 50) return { name: 'Picking up speed', hint: "You're on a roll.", glyph: '◑' };
  if (pct < 75) return { name: 'In the zone', hint: 'More than halfway there.', glyph: '◕' };
  if (pct < 100) return { name: 'Almost there', hint: 'One more push.', glyph: '◕' };
  return { name: 'Day cleared', hint: 'Everything ticked off.', glyph: '●' };
}

function useCountUp(target: number, enabled = true) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    if (!enabled) {
      setValue(target);
      return;
    }
    const start = value;
    const delta = target - start;
    if (delta === 0) return;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - startedAt) / 600);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(start + delta * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, enabled]);
  return value;
}

function ProgressWheel({ blocks }: Props) {
  const { doneMinutes, totalMinutes, real } = useMemo(() => {
    const real = blocks.filter((b) => !b.auto);
    let doneMinutes = 0;
    let totalMinutes = 0;
    for (const b of real) {
      const m = b.end - b.start;
      if (!Number.isFinite(m) || m <= 0) continue;
      totalMinutes += m;
      if (b.completed) doneMinutes += m;
    }
    return { doneMinutes, totalMinutes, real };
  }, [blocks]);

  const reduced = useReducedMotion() ?? false;
  const pct = totalMinutes > 0 ? doneMinutes / totalMinutes : 0;
  const pctInt = Math.round(pct * 100);
  const displayPct = useCountUp(pctInt, !reduced);
  const level = levelFor(pctInt, doneMinutes);
  const complete = totalMinutes > 0 && doneMinutes >= totalMinutes;

  const size = 104;
  const cx = size / 2;
  const cy = size / 2;
  const rArc = 43;
  const circumference = 2 * Math.PI * rArc;

  return (
    <div className="panel py-6">
      <div className="flex items-baseline justify-between mb-4">
        <span className="legend">Progress</span>
        {/* Time, not counts. */}
        <span className="font-mono text-micro text-bone-3 tnum">
          {formatDuration(doneMinutes)} / {formatDuration(totalMinutes)}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
            {/* Engraved bezel — 24 ticks, one per hour of the day. No gradient
                anywhere on this dial: the arc is the single signal colour, which
                is what makes it read as an instrument rather than a chart. */}
            {Array.from({ length: 24 }, (_, i) => {
              const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
              const major = i % 6 === 0;
              const r1 = 50 - (major ? 5 : 2.5);
              const r2 = 50;
              return (
                <line
                  key={i}
                  x1={cx + Math.cos(angle) * r1}
                  y1={cy + Math.sin(angle) * r1}
                  x2={cx + Math.cos(angle) * r2}
                  y2={cy + Math.sin(angle) * r2}
                  stroke={
                    major ? 'rgba(245,242,236,0.26)' : 'rgba(245,242,236,0.10)'
                  }
                  strokeWidth={major ? 1.1 : 0.7}
                />
              );
            })}

            <circle
              cx={cx}
              cy={cy}
              r={rArc}
              fill="none"
              stroke="rgba(245,242,236,0.06)"
              strokeWidth={4}
            />
            <motion.circle
              cx={cx}
              cy={cy}
              r={rArc}
              fill="none"
              stroke={complete ? 'var(--good)' : 'var(--signal)'}
              strokeWidth={4}
              strokeLinecap="butt"
              strokeDasharray={circumference}
              transform={`rotate(-90 ${cx} ${cy})`}
              initial={false}
              animate={{ strokeDashoffset: circumference * (1 - pct) }}
              transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 26 }}
            />
          </svg>

          {/* The read-out. Serif numeral, so the dial has a face rather than a
              label — and the unit sits small and low, like an engraved suffix. */}
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="relative">
              <div className="font-display tnum text-bone-0 text-[30px] leading-none">
                {displayPct}
              </div>
              <span
                className="absolute font-mono text-nano text-bone-3"
                style={{ left: 'calc(100% + 2px)', top: '4px' }}
              >
                %
              </span>
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-0.5">
            <AnimatePresence mode="wait">
              <motion.span
                key={level.glyph}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.22 }}
                className="text-body-sm leading-none"
                style={{ color: complete ? 'var(--good)' : 'var(--signal)' }}
              >
                {level.glyph}
              </motion.span>
            </AnimatePresence>
            <AnimatePresence mode="wait">
              <motion.span
                key={level.name}
                initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, y: -3 }}
                transition={{ duration: 0.18, ease: EASE_OUT }}
                className="font-display-italic text-bone-0 text-[19px] leading-none"
              >
                {level.name}
              </motion.span>
            </AnimatePresence>
          </div>
          <AnimatePresence mode="wait">
            <motion.p
              key={level.hint}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="text-body-sm text-bone-3 leading-snug mb-4 mt-1"
            >
              {level.hint}
            </motion.p>
          </AnimatePresence>

          {/* Pips stay one-per-entry — a discrete, honest count of entries,
              alongside the time-weighted dial rather than instead of it. */}
          {/* Tally marks, not pills — one stroke per entry, struck when done. */}
          <div className="flex items-end gap-[3px] h-4">
            {real.length === 0 ? (
              <span className="font-mono text-nano text-bone-3 uppercase tracking-legend">
                nothing scheduled
              </span>
            ) : (
              real.map((b, i) => (
                <motion.span
                  key={b.id}
                  title={`${b.title}${b.completed ? ' — done' : ''}`}
                  initial={reduced ? { opacity: 0 } : { opacity: 0, scaleY: 0.4 }}
                  animate={{ opacity: 1, scaleY: 1 }}
                  transition={{
                    duration: 0.22,
                    ease: EASE_OUT,
                    delay: staggerDelay(i),
                  }}
                  style={{
                    width: 2,
                    height: b.completed ? 16 : 10,
                    transformOrigin: 'bottom',
                    background: b.completed ? 'var(--signal)' : 'var(--bone-5)',
                  }}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default memo(ProgressWheel);

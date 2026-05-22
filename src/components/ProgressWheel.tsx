import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { Block } from '../types';

interface Props {
  blocks: Block[];
}

interface Level {
  name: string;
  hint: string;
  glyph: string;
}

function levelFor(pct: number, done: number): Level {
  if (done === 0) return { name: 'Day ahead', hint: 'Begin with something small.', glyph: '☼' };
  if (pct < 25) return { name: 'Warming up', hint: 'Steady — keep going.', glyph: '⌖' };
  if (pct < 50) return { name: 'Picking up speed', hint: "You're on a roll.", glyph: '↗' };
  if (pct < 75) return { name: 'In the zone', hint: 'More than halfway there.', glyph: '✦' };
  if (pct < 100) return { name: 'Almost there', hint: 'One more push.', glyph: '✧' };
  return { name: 'Day cleared', hint: 'Everything ticked off.', glyph: '✺' };
}

function useCountUp(target: number) {
  const [value, setValue] = useState(target);
  useEffect(() => {
    const start = value;
    const delta = target - start;
    if (delta === 0) return;
    const duration = 600;
    const startedAt = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - startedAt) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(Math.round(start + delta * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return value;
}

export default function ProgressWheel({ blocks }: Props) {
  const total = blocks.length;
  const done = blocks.filter((b) => b.completed).length;
  const pct = total > 0 ? done / total : 0;
  const pctInt = Math.round(pct * 100);
  const displayPct = useCountUp(pctInt);
  const level = levelFor(pctInt, done);
  const complete = total > 0 && done === total;

  // Dial geometry
  const size = 132;
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = 60;
  const rInner = 48;
  const rArc = 53;
  const circumference = 2 * Math.PI * rArc;

  // Tick marks every 10%
  const ticks = Array.from({ length: 24 }, (_, i) => i);

  return (
    <motion.div layout className="relative paper-card rounded-xl5 p-5 overflow-hidden">
      <div className="relative flex items-baseline justify-between mb-3">
        <h2 className="font-display text-[18px] leading-none text-ink-1" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50', fontWeight: 500 }}>
          Progress
        </h2>
        <span className="font-mono text-[11px] text-ink-3 tnum tracking-wider">
          {String(done).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      </div>
      <div className="rule-h mb-3" />

      <div className="relative flex items-center gap-5">
        <div className="relative shrink-0">
          <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
            <defs>
              <radialGradient id="dialFace" cx="50%" cy="40%" r="60%">
                <stop offset="0%" stopColor="#fffaec" />
                <stop offset="100%" stopColor="#f1e7d0" />
              </radialGradient>
            </defs>

            {/* Dial face */}
            <circle cx={cx} cy={cy} r={rOuter} fill="url(#dialFace)" stroke="rgba(28,20,11,0.42)" strokeWidth={0.8} />

            {/* Tick marks */}
            {ticks.map((i) => {
              const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
              const isMajor = i % 6 === 0;
              const r1 = rOuter - (isMajor ? 6 : 3);
              const r2 = rOuter - 1;
              const x1 = cx + Math.cos(angle) * r1;
              const y1 = cy + Math.sin(angle) * r1;
              const x2 = cx + Math.cos(angle) * r2;
              const y2 = cy + Math.sin(angle) * r2;
              return (
                <line
                  key={i}
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="rgba(28,20,11,0.55)"
                  strokeWidth={isMajor ? 1.2 : 0.7}
                />
              );
            })}

            {/* Progress arc track */}
            <circle
              cx={cx}
              cy={cy}
              r={rArc}
              fill="none"
              stroke="rgba(28,20,11,0.10)"
              strokeWidth={4}
            />

            {/* Progress arc (ink) */}
            <motion.circle
              cx={cx}
              cy={cy}
              r={rArc}
              fill="none"
              stroke="#9e3a26"
              strokeWidth={4}
              strokeLinecap="butt"
              strokeDasharray={circumference}
              transform={`rotate(-90 ${cx} ${cy})`}
              initial={false}
              animate={{
                strokeDashoffset: circumference * (1 - pct),
              }}
              transition={{ type: 'spring', stiffness: 90, damping: 24 }}
            />

            {/* Inner hairline */}
            <circle cx={cx} cy={cy} r={rInner} fill="none" stroke="rgba(28,20,11,0.22)" strokeWidth={0.6} />

            {/* Cardinal labels */}
            <text x={cx} y={cy - rOuter - 4} textAnchor="middle" fontSize="8" fill="rgba(28,20,11,0.6)" fontFamily="JetBrains Mono, monospace" letterSpacing="0.12em">
              100
            </text>
            <text x={cx + rOuter + 6} y={cy + 3} textAnchor="start" fontSize="8" fill="rgba(28,20,11,0.6)" fontFamily="JetBrains Mono, monospace" letterSpacing="0.12em">
              25
            </text>
            <text x={cx} y={cy + rOuter + 10} textAnchor="middle" fontSize="8" fill="rgba(28,20,11,0.6)" fontFamily="JetBrains Mono, monospace" letterSpacing="0.12em">
              50
            </text>
            <text x={cx - rOuter - 6} y={cy + 3} textAnchor="end" fontSize="8" fill="rgba(28,20,11,0.6)" fontFamily="JetBrains Mono, monospace" letterSpacing="0.12em">
              75
            </text>
          </svg>

          {/* Digit block sits dead-center. The "%" hangs to its right; the
              "completed" caption is tucked tight under the digit so the
              whole stack lives well inside the rInner hairline (r = 48). */}
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="relative">
              <motion.div
                key={complete ? 'done' : 'pct'}
                initial={{ scale: 0.94, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
                className="font-display tnum text-ink-0"
                style={{
                  fontSize: '30px',
                  fontWeight: 500,
                  lineHeight: 1,
                  fontVariationSettings: '"opsz" 144, "SOFT" 40',
                }}
              >
                {displayPct}
              </motion.div>
              <span
                className="absolute font-display text-ink-3 font-light"
                style={{
                  fontSize: '13px',
                  lineHeight: 1,
                  left: 'calc(100% + 2px)',
                  top: '4px',
                }}
              >
                %
              </span>
              <div
                className="absolute left-1/2 -translate-x-1/2 smallcaps text-ink-3 whitespace-nowrap"
                style={{
                  top: 'calc(100% + 1px)',
                  fontSize: '9px',
                  letterSpacing: '0.14em',
                }}
              >
                completed
              </div>
            </div>
          </div>

          {/* Asterisks on 100% — like little ink stars */}
          <AnimatePresence>
            {complete && (
              <>
                {[...Array(8)].map((_, i) => {
                  const angle = (i / 8) * Math.PI * 2;
                  const dx = Math.cos(angle) * 78;
                  const dy = Math.sin(angle) * 78;
                  return (
                    <motion.span
                      key={i}
                      className="absolute top-1/2 left-1/2 font-display text-seal"
                      style={{ fontSize: '14px' }}
                      initial={{ x: 0, y: 0, opacity: 0, scale: 0, rotate: 0 }}
                      animate={{
                        x: dx,
                        y: dy,
                        opacity: [0, 1, 0],
                        scale: [0, 1, 0.6],
                        rotate: 180,
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.6, delay: i * 0.06, repeat: Infinity, repeatDelay: 1.6 }}
                    >
                      ✦
                    </motion.span>
                  );
                })}
              </>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <AnimatePresence mode="wait">
              <motion.span
                key={level.glyph}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ duration: 0.25 }}
                className="font-display text-[20px] text-seal leading-none"
              >
                {level.glyph}
              </motion.span>
            </AnimatePresence>
            <AnimatePresence mode="wait">
              <motion.span
                key={level.name}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.22 }}
                className="font-display italic text-[16px] text-ink-1 leading-tight"
                style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
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
              transition={{ duration: 0.22 }}
              className="text-[12.5px] text-ink-2 leading-relaxed mb-3"
            >
              {level.hint}
            </motion.p>
          </AnimatePresence>
          <div className="flex items-center gap-1 font-mono text-[11px] text-ink-3 tnum">
            {[...Array(Math.max(total, 1))].map((_, i) => {
              const filled = i < done;
              return (
                <span
                  key={i}
                  className="h-2.5 flex-1 transition-all rounded-sm"
                  style={{
                    maxWidth: 16,
                    background: filled ? '#9e3a26' : 'rgba(28,20,11,0.10)',
                    border: filled ? '1px solid rgba(158,58,38,0.55)' : '1px solid rgba(28,20,11,0.20)',
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Flame, Trophy, Crown } from 'lucide-react';
import type { Block } from '../types';

interface Props {
  blocks: Block[];
}

interface Level {
  name: string;
  hint: string;
  Icon: typeof Sparkles;
  color: string;
}

function levelFor(pct: number, done: number): Level {
  if (done === 0) {
    return { name: 'Day ahead', hint: 'Pick something easy to start.', Icon: Sparkles, color: '#a78bfa' };
  }
  if (pct < 25) {
    return { name: 'Warming up', hint: 'Nice — keep going.', Icon: Sparkles, color: '#a78bfa' };
  }
  if (pct < 50) {
    return { name: 'Picking up speed', hint: "You're on a roll.", Icon: Flame, color: '#f59e0b' };
  }
  if (pct < 75) {
    return { name: 'In the zone', hint: 'More than halfway there.', Icon: Flame, color: '#f59e0b' };
  }
  if (pct < 100) {
    return { name: 'Almost there', hint: 'One more push.', Icon: Trophy, color: '#22d3ee' };
  }
  return { name: 'Day cleared', hint: 'Everything ticked off.', Icon: Crown, color: '#fde68a' };
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

  const r = 50;
  const circumference = 2 * Math.PI * r;

  return (
    <motion.div
      layout
      className="relative bg-bg-1/80 glass border border-line-1 rounded-xl5 shadow-soft p-5 overflow-hidden"
    >
      <div className="absolute -top-20 -left-12 w-44 h-44 rounded-full bg-cat-deep/15 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-16 -right-12 w-44 h-44 rounded-full bg-cat-admin/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-4 font-medium">
          Progress
        </h2>
        <span className="text-[10px] text-fg-5 tnum">
          {done} / {total}
        </span>
      </div>

      <div className="relative flex items-center gap-4">
        <div className="relative shrink-0">
          <svg width={124} height={124} viewBox="0 0 124 124" className="block">
            <defs>
              <linearGradient id="wheelGradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="55%" stopColor="#6366f1" />
                <stop offset="100%" stopColor="#22d3ee" />
              </linearGradient>
              <filter id="wheelGlow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="2.2" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>
            <circle
              cx={62}
              cy={62}
              r={r}
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth={9}
            />
            <motion.circle
              cx={62}
              cy={62}
              r={r}
              fill="none"
              stroke="url(#wheelGradient)"
              strokeWidth={9}
              strokeLinecap="round"
              strokeDasharray={circumference}
              transform="rotate(-90 62 62)"
              filter="url(#wheelGlow)"
              initial={false}
              animate={{
                strokeDashoffset: circumference * (1 - pct),
              }}
              transition={{ type: 'spring', stiffness: 80, damping: 22 }}
            />
          </svg>

          {/* Centered % */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <motion.div
              key={complete ? 'done' : 'pct'}
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              className="text-2xl font-semibold tracking-tight text-fg-0 tnum leading-none"
            >
              {displayPct}
              <span className="text-fg-3 text-base font-medium ml-0.5">%</span>
            </motion.div>
            <div className="text-[10px] uppercase tracking-wider text-fg-4 mt-1">
              done
            </div>
          </div>

          {/* Sparkles on 100% */}
          <AnimatePresence>
            {complete && (
              <>
                {[...Array(8)].map((_, i) => {
                  const angle = (i / 8) * Math.PI * 2;
                  const dx = Math.cos(angle) * 70;
                  const dy = Math.sin(angle) * 70;
                  return (
                    <motion.span
                      key={i}
                      className="absolute top-1/2 left-1/2 w-1 h-1 rounded-full bg-amber-300"
                      style={{ boxShadow: '0 0 8px #fcd34d' }}
                      initial={{ x: 0, y: 0, opacity: 0, scale: 0 }}
                      animate={{
                        x: dx,
                        y: dy,
                        opacity: [0, 1, 0],
                        scale: [0, 1.2, 0.6],
                      }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.4, delay: i * 0.04, repeat: Infinity, repeatDelay: 1.6 }}
                    />
                  );
                })}
              </>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className="inline-flex items-center justify-center w-6 h-6 rounded-xl"
              style={{
                background: `${level.color}22`,
                boxShadow: `0 0 12px ${level.color}55, inset 0 0 0 1px ${level.color}55`,
              }}
            >
              <level.Icon size={13} style={{ color: level.color }} />
            </span>
            <AnimatePresence mode="wait">
              <motion.span
                key={level.name}
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                transition={{ duration: 0.22 }}
                className="text-sm font-semibold tracking-tight text-fg-0"
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
              className="text-[11px] text-fg-3 leading-relaxed mb-2"
            >
              {level.hint}
            </motion.p>
          </AnimatePresence>
          <div className="flex items-center gap-1 text-[10px] text-fg-4 tnum">
            {[...Array(Math.max(total, 1))].map((_, i) => {
              const filled = i < done;
              return (
                <span
                  key={i}
                  className="h-1.5 flex-1 rounded-full transition-all"
                  style={{
                    background: filled
                      ? 'linear-gradient(90deg, #a78bfa, #22d3ee)'
                      : 'rgba(255,255,255,0.05)',
                    boxShadow: filled ? '0 0 8px rgba(139,92,246,0.4)' : undefined,
                    maxWidth: 18,
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

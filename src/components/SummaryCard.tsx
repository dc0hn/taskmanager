import { motion, AnimatePresence } from 'framer-motion';
import { CATEGORIES } from '../types';
import type { Block } from '../types';
import { formatDuration } from '../utils/time';

interface Props {
  blocks: Block[];
}

export default function SummaryCard({ blocks }: Props) {
  const totals: Record<string, number> = {};
  let grand = 0;
  for (const b of blocks) {
    const d = b.end - b.start;
    totals[b.category] = (totals[b.category] ?? 0) + d;
    grand += d;
  }

  return (
    <motion.div layout className="relative paper-card rounded-xl5 p-5">
      <div className="relative flex items-baseline justify-between mb-3">
        <h2 className="font-display text-[18px] leading-none text-ink-1" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50', fontWeight: 500 }}>
          Time allotted
        </h2>
        <AnimatePresence mode="wait">
          <motion.span
            key={grand}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -3 }}
            transition={{ duration: 0.2 }}
            className="smallcaps text-[11px] text-ink-3 tnum"
          >
            {formatDuration(grand)} total
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="rule-h mb-2" />

      <ul className="relative">
        {CATEGORIES.map((c, i) => {
          const v = totals[c.id] ?? 0;
          const pct = grand > 0 ? (v / grand) * 100 : 0;
          return (
            <li
              key={c.id}
              className="py-2.5"
              style={{
                borderBottom: i < CATEGORIES.length - 1 ? '1px dotted rgba(28,20,11,0.18)' : undefined,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-2 h-2 shrink-0"
                  style={{ background: c.accent, border: `1px solid ${c.accent}` }}
                />
                <span
                  className="font-display text-[13.5px] text-ink-1 flex-1 truncate"
                  style={{ fontVariationSettings: '"opsz" 24, "SOFT" 40' }}
                >
                  {c.label}
                </span>
                <span className="font-mono text-[11.5px] text-ink-2 tnum w-14 text-right tracking-wider">
                  {formatDuration(v)}
                </span>
                <span className="font-mono text-[11px] text-ink-3 tnum w-10 text-right tracking-wider">
                  {Math.round(pct)}%
                </span>
              </div>
              <div
                className="h-1.5 overflow-hidden"
                style={{
                  background: 'rgba(28,20,11,0.06)',
                  border: '1px solid rgba(28,20,11,0.10)',
                }}
              >
                <motion.div
                  className="h-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ type: 'spring', stiffness: 110, damping: 24 }}
                  style={{ background: c.accent }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

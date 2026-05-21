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
    <motion.div
      layout
      className="relative bg-bg-1/80 glass border border-line-1 rounded-xl3 shadow-soft p-4 overflow-hidden"
    >
      <div className="absolute -bottom-20 -right-12 w-40 h-40 rounded-full bg-cat-admin/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center justify-between mb-3">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-4 font-medium">
          Summary
        </h2>
        <AnimatePresence mode="wait">
          <motion.span
            key={grand}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="text-xs text-fg-2 tnum"
          >
            {formatDuration(grand)} total
          </motion.span>
        </AnimatePresence>
      </div>
      <ul className="relative space-y-2.5">
        {CATEGORIES.map((c) => {
          const v = totals[c.id] ?? 0;
          const pct = grand > 0 ? (v / grand) * 100 : 0;
          return (
            <li key={c.id}>
              <div className="flex items-center gap-2 mb-1">
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: c.accent, boxShadow: `0 0 8px ${c.accent}` }}
                />
                <span className="text-xs text-fg-2 flex-1 truncate">{c.label}</span>
                <span className="text-[11px] text-fg-3 tnum w-12 text-right">
                  {formatDuration(v)}
                </span>
                <span className="text-[10px] text-fg-5 tnum w-8 text-right">
                  {Math.round(pct)}%
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-white/[0.04] overflow-hidden">
                <motion.div
                  className="h-full rounded-full"
                  initial={{ width: 0 }}
                  animate={{ width: `${pct}%` }}
                  transition={{ type: 'spring', stiffness: 110, damping: 22 }}
                  style={{
                    background: `linear-gradient(90deg, ${c.accent}, ${c.accent}aa)`,
                    boxShadow: `0 0 10px ${c.accent}66`,
                  }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

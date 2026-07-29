import { memo, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Block, CategoryDef } from '../types';
import { colorsFor } from '../utils/color';
import { formatDuration } from '../utils/time';

// ============================================================================
// SummaryCard — where the time went, per category.
//
// Shows completed against planned for each category, so the card answers "did I
// actually do four hours of deep work" rather than only "did I intend to".
//
// Auto blocks (the scheduler's breaks and shutdown) are excluded, matching
// ProgressWheel. The two cards sit next to each other and both present a total
// for the day, so counting different things in each made one of them look wrong.
// ============================================================================

interface Props {
  blocks: Block[];
  categories: CategoryDef[];
}

function SummaryCard({ blocks, categories }: Props) {
  const { rows, grandPlanned, grandDone } = useMemo(() => {
    const planned = new Map<string, number>();
    const done = new Map<string, number>();
    let grandPlanned = 0;
    let grandDone = 0;

    for (const b of blocks) {
      if (b.auto) continue;
      const m = b.end - b.start;
      if (!Number.isFinite(m) || m <= 0) continue;
      planned.set(b.category, (planned.get(b.category) ?? 0) + m);
      grandPlanned += m;
      if (b.completed) {
        done.set(b.category, (done.get(b.category) ?? 0) + m);
        grandDone += m;
      }
    }

    const known = [...categories].sort((a, b) => a.order - b.order);
    const rows = known.map((cat) => ({
      cat,
      planned: planned.get(cat.id) ?? 0,
      done: done.get(cat.id) ?? 0,
    }));

    // A block whose category was deleted still has to appear somewhere, or the
    // totals silently stop adding up.
    const knownIds = new Set(known.map((c) => c.id));
    for (const [id, mins] of planned) {
      if (knownIds.has(id)) continue;
      rows.push({
        cat: {
          id,
          label: 'Uncategorised',
          short: '—',
          kind: 'neutral',
          accent: '#6b7488',
          order: 9999,
        },
        planned: mins,
        done: done.get(id) ?? 0,
      });
    }

    return { rows, grandPlanned, grandDone };
  }, [blocks, categories]);

  return (
    <div className="panel py-6">
      <div className="flex items-baseline justify-between mb-2.5">
        <span className="legend">Time allotted</span>
        <span className="font-mono text-nano text-ink-3 tnum tracking-wide">
          {formatDuration(grandDone)} / {formatDuration(grandPlanned)}
        </span>
      </div>
      <div className="rule-h mb-1" />

      <ul>
        {rows.map(({ cat, planned, done }, i) => {
          const c = colorsFor(cat.accent);
          const sharePct = grandPlanned > 0 ? (planned / grandPlanned) * 100 : 0;
          const donePct = planned > 0 ? (done / planned) * 100 : 0;
          return (
            <li
              key={cat.id}
              className="py-2"
              style={{
                borderBottom:
                  i < rows.length - 1 ? '1px solid rgba(245, 242, 236,0.05)' : undefined,
              }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <span
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ background: cat.accent }}
                />
                <span className="text-body-sm text-ink-1 flex-1 truncate">
                  {cat.label}
                </span>
                <span className="font-mono text-micro text-ink-2 tnum w-12 text-right tracking-wide">
                  {planned > 0 ? formatDuration(planned) : '—'}
                </span>
                <span className="font-mono text-nano text-bone-3 tnum w-9 text-right tracking-wide">
                  {Math.round(sharePct)}%
                </span>
              </div>
              {/* Outer bar = share of the day. Inner fill = completed. */}
              <div
                className="h-[5px] rounded-full overflow-hidden ml-4"
                style={{ background: 'rgba(245, 242, 236,0.055)' }}
              >
                <motion.div
                  className="h-full rounded-full relative overflow-hidden"
                  initial={{ width: 0 }}
                  animate={{ width: `${sharePct}%` }}
                  transition={{ type: 'spring', stiffness: 120, damping: 26 }}
                  style={{ background: c.fillStrong }}
                >
                  <motion.div
                    className="absolute inset-y-0 left-0 rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${donePct}%` }}
                    transition={{ type: 'spring', stiffness: 120, damping: 26 }}
                    style={{ background: cat.accent }}
                  />
                </motion.div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default memo(SummaryCard);

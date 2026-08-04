import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, TriangleAlert } from 'lucide-react';
import type {
  CategoryDef,
  DayMarkDef,
  DayMarks,
  MonthlyGoalSummary,
  MonthRecord,
} from '../types';
import { countMarksInMonth, describeMarks } from '../daymarks';
import { formatMonthKey, formatRatio } from '../month';
import { colorsFor, resolveCategory } from '../utils/color';
import { formatDuration } from '../utils/time';
import { COLLAPSE, COLLAPSE_TRANSITION, usePanelMotion } from '../utils/motion';
import Ring from './Ring';

// ============================================================================
// MonthsView — the record.
//
// One overall ring per month, expandable to the per-goal breakdown. The overall
// figure is the MEAN of the per-goal ratios, because sessions and minutes cannot
// be added together and so no weighted total exists.
//
// The month in progress is shown first and marked provisional: its ring is drawn
// lighter and it carries a note, because a partial month compared against a full
// month's target is not yet a meaningful number.
// ============================================================================

interface Props {
  /** Sealed months, plus the current one in progress, newest first. */
  months: MonthRecord[];
  /** Which key is the month currently running. */
  currentMonth: string;
  categories: CategoryDef[];
  /**
   * Day marks are counted live rather than stored in the record. They live in one
   * store that is never pruned, so deriving them keeps a correction made today
   * from disagreeing with a month sealed last year.
   */
  marks: DayMarks;
  markDefs: DayMarkDef[];
}

export default function MonthsView({
  months,
  currentMonth,
  categories,
  marks,
  markDefs,
}: Props) {
  const [open, setOpen] = useState<string | null>(currentMonth);
  const panel = usePanelMotion();

  const ordered = useMemo(
    () => [...months].sort((a, b) => b.month.localeCompare(a.month)),
    [months]
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-6 pb-8">
      <motion.div {...panel} className="max-w-[900px]">
        <div className="py-4">
          <h2 className="font-display text-title text-bone-0">The record</h2>
          <p className="text-body-sm text-bone-3 mt-1 max-w-[62ch] leading-relaxed">
            How much of each standing weekly goal actually happened, month by month.
            A month asks for its weekly total pro-rated by its own length — so
            February wants four weeks' worth and July wants a little over four and a
            half. 100% means you kept pace.
          </p>
        </div>

        {ordered.length === 0 ? (
          <p className="text-body-sm text-bone-3 py-4 max-w-[56ch] leading-relaxed">
            Nothing recorded yet. A month is written up when it ends, so the first
            entry appears on the 1st. Weekly goals set to <em>Start again</em> are
            what gets measured here.
          </p>
        ) : (
          <div>
            {ordered.map((m, i) => (
              <MonthRow
                key={m.month}
                record={m}
                index={i}
                inProgress={m.month === currentMonth}
                categories={categories}
                markCounts={countMarksInMonth(marks, m.month)}
                markDefs={markDefs}
                expanded={open === m.month}
                onToggle={() => setOpen(open === m.month ? null : m.month)}
              />
            ))}
          </div>
        )}
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MonthRow({
  record,
  index,
  inProgress,
  categories,
  markCounts,
  markDefs,
  expanded,
  onToggle,
}: {
  record: MonthRecord;
  index: number;
  inProgress: boolean;
  categories: CategoryDef[];
  markCounts: Record<string, number>;
  markDefs: DayMarkDef[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const kept = record.goals.filter((g) => g.ratio >= 1).length;
  const markSummary = describeMarks(markCounts, markDefs);
  const marked = [...markDefs]
    .sort((a, b) => a.order - b.order)
    .filter((d) => (markCounts[d.id] ?? 0) > 0);

  return (
    <div className="border-b border-rule-1">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        title={markSummary || undefined}
        className="w-full flex items-center gap-4 py-4 text-left group"
      >
        <Ring
          ratio={record.overall}
          size={62}
          label={formatRatio(record.overall)}
          provisional={inProgress}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-display text-heading text-bone-0">
              {formatMonthKey(record.month)}
            </span>
            {inProgress && (
              <span
                className="legend px-1.5 py-[1px] rounded-xs"
                style={{ background: 'var(--signal-dim)', color: 'var(--signal)' }}
              >
                In progress
              </span>
            )}
          </div>
          <div className="font-mono text-nano text-bone-3 tnum mt-1 tracking-wide">
            {record.goals.length === 0
              ? 'no standing goals'
              : `${record.goals.length} goal${record.goals.length === 1 ? '' : 's'} · ${kept} kept pace · ${record.daysInMonth} days`}
            {record.cleared.length > 0 && ` · ${record.cleared.length} let go`}
          </div>

          {marked.length > 0 && (
            <div className="flex items-center gap-2.5 flex-wrap mt-1.5">
              {marked.map((d) => (
                <span key={d.id} className="flex items-center gap-1.5">
                  <span
                    className="rounded-full shrink-0"
                    style={{ width: 7, height: 7, background: d.color }}
                  />
                  <span className="font-mono text-nano text-bone-2 tnum tracking-wide">
                    {markCounts[d.id]} {d.label.toLowerCase()}
                  </span>
                </span>
              ))}
            </div>
          )}
        </div>

        <ChevronRight
          size={16}
          strokeWidth={2}
          className="text-bone-3 shrink-0 transition-transform duration-200 ease-out group-hover:text-bone-1"
          style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
        />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            variants={COLLAPSE}
            initial="closed"
            animate="open"
            exit="closed"
            transition={COLLAPSE_TRANSITION}
            className="overflow-hidden"
          >
            <div className="pb-5 pl-1">
              {inProgress && (
                <p className="text-nano text-bone-3 mb-3 leading-snug max-w-[60ch]">
                  This month is still running, so it is being compared against the
                  whole month's target. Expect it to read low until the end.
                </p>
              )}

              {record.goals.length === 0 ? (
                <p className="text-body-sm text-bone-3">
                  No weekly-cadence goals were active.
                </p>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {[...record.goals]
                    .sort((a, b) => b.ratio - a.ratio)
                    .map((g) => (
                      <GoalRow
                        key={g.goalId}
                        summary={g}
                        categories={categories}
                        provisional={inProgress}
                      />
                    ))}
                </div>
              )}

              {record.cleared.length > 0 && (
                <div className="mt-4">
                  <div className="flex items-center gap-2 mb-2">
                    <TriangleAlert size={12} strokeWidth={2.2} className="text-signal" />
                    <span className="legend" style={{ color: 'var(--signal)' }}>
                      Carried and let go
                    </span>
                    <div className="flex-1 rule-h" />
                  </div>
                  {/* The pile is month-scoped: whatever was still waiting on the
                      1st was cleared, and recorded here rather than vanishing. */}
                  <ul className="space-y-1">
                    {record.cleared.map((c) => (
                      <li
                        key={c.goalId}
                        className="flex items-baseline gap-2 text-body-sm text-bone-2"
                      >
                        <span className="truncate">{c.label}</span>
                        <span className="font-mono text-nano text-bone-3 tnum shrink-0">
                          {c.targetKind === 'sessions'
                            ? `${c.residual} left`
                            : `${formatDuration(c.residual)} left`}
                          {c.deferrals > 0 && ` · deferred ${c.deferrals}×`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <span className="hidden" data-row={index} />
    </div>
  );
}

function GoalRow({
  summary: g,
  categories,
  provisional,
}: {
  summary: MonthlyGoalSummary;
  categories: CategoryDef[];
  provisional: boolean;
}) {
  const cat = resolveCategory(g.category, categories);
  const c = colorsFor(cat.accent);
  const target = Math.round(g.monthlyTarget * 10) / 10;

  return (
    <div
      className="flex items-center gap-3 py-2 pl-3"
      style={{ borderLeft: `2px solid ${c.accent}` }}
    >
      <Ring ratio={g.ratio} size={38} accent={c.accent} provisional={provisional} />
      <div className="min-w-0 flex-1">
        <div className="text-body-sm font-semibold text-bone-1 truncate">
          {g.label}
        </div>
        <div className="font-mono text-nano text-bone-3 tnum mt-0.5">
          {g.targetKind === 'sessions'
            ? `${g.done} of ${target} sessions`
            : `${formatDuration(g.done)} of ${formatDuration(Math.round(g.monthlyTarget))}`}
          {' · '}
          {g.weeklyTarget}/wk
        </div>
      </div>
      <span
        className="font-mono text-body-sm tnum shrink-0"
        style={{ color: g.ratio >= 1 ? 'var(--good)' : c.text }}
      >
        {formatRatio(g.ratio)}
      </span>
    </div>
  );
}

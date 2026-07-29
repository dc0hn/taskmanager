import { memo } from 'react';
import { ArrowLeft, ArrowRight, Plus, RotateCcw } from 'lucide-react';
import type { ViewMode } from '../types';
import { fromDateKey, toDateKey } from '../utils/time';
import { formatMonthLong, formatWeekRangeLong } from '../week';

// ============================================================================
// Toolbar — title, date range, period navigation, view switcher.
// ============================================================================

interface Props {
  view: ViewMode;
  onView: (v: ViewMode) => void;
  date: string;
  weekKey: string;
  onStep: (direction: -1 | 1) => void;
  onToday: () => void;
  onAdd: () => void;
  /** Shown only when there is something incomplete to reflow. */
  canReplan: boolean;
  onRebuildFromNow: () => void;
}

const VIEWS: { key: ViewMode; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
];

function Toolbar({
  view,
  onView,
  date,
  weekKey,
  onStep,
  onToday,
  onAdd,
  canReplan,
  onRebuildFromNow,
}: Props) {
  const d = fromDateKey(date);
  const isToday = date === toDateKey(new Date());

  const title =
    view === 'day'
      ? d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
      : view === 'week'
        ? formatWeekRangeLong(weekKey)
        : formatMonthLong(date);

  // Copy earns its place: each line says something the title doesn't.
  const subtitle =
    view === 'day'
      ? `${d.getFullYear()} — day ${String(dayOfYear(d)).padStart(3, '0')} of ${daysInYear(d)}`
      : view === 'week'
        ? 'Drag a block sideways to move it to another day'
        : 'Pick a day to open its sheet';

  return (
    <header className="shrink-0">
      <div className="titlebar-drag" />
      {/* Running head — the almanac's page furniture. Sits above the masthead in
          engraved micro-type, the way a printed annual states its own volume. */}
      <div className="flex items-baseline gap-3 px-6 pt-1 pb-2">
        <span className="legend text-signal">The&nbsp;Almanac</span>
        <span className="legend">
          {view === 'day' ? 'Daily sheet' : view === 'week' ? 'Weekly table' : 'Monthly index'}
        </span>
        <span className="flex-1 rule-h" />
        <span className="legend tnum">
          {view === 'day' ? `No.${String(dayOfYear(d)).padStart(3, '0')}` : ''}
        </span>
      </div>

      <div className="flex items-end justify-between gap-6 px-6 pb-4 flex-wrap">
        <div className="min-w-0">
          {/* Dramatic serif against the engraved legend above — the whole point of
              the type pairing. 44px at -0.025em tracking. */}
          <h1 className="font-display text-bone-0 text-display-sm sm:text-display truncate">
            {title}
          </h1>
          <p className="mt-2 font-mono text-nano text-bone-3 tracking-legend uppercase tnum">
            {subtitle}
          </p>
        </div>

        <div className="flex items-center gap-2 no-drag flex-wrap">
          {canReplan && (
            <button
              onClick={onRebuildFromNow}
              title="Reschedule everything not yet done, starting from the current time. Completed entries stay where they are."
              className="btn-quiet inline-flex items-center gap-2 text-body-sm px-3 h-8"
            >
              <RotateCcw size={13} strokeWidth={2} />
              Replan from now
            </button>
          )}

          <div className="segmented" role="tablist" aria-label="Calendar view">
            {VIEWS.map((v) => (
              <button
                key={v.key}
                role="tab"
                aria-selected={view === v.key}
                data-active={view === v.key}
                onClick={() => onView(v.key)}
                className="segmented-item"
              >
                {v.label}
              </button>
            ))}
          </div>

          {/* One machined control group rather than three floating buttons —
              divided by hairlines, like a switch bank. */}
          <div className="inline-flex items-stretch rounded border border-rule-2 overflow-hidden">
            <button
              onClick={() => onStep(-1)}
              aria-label="Previous"
              className="grid place-items-center w-8 h-8 text-bone-3 hover:text-bone-0 hover:bg-chassis-3 transition-colors duration-150 ease-snap"
            >
              <ArrowLeft size={14} strokeWidth={2} />
            </button>
            <button
              onClick={onToday}
              className="px-3 h-8 text-body-sm font-medium border-x border-rule-2 transition-colors duration-150 ease-snap"
              style={{
                color: isToday ? 'var(--signal)' : 'var(--bone-2)',
                background: isToday ? 'var(--signal-dim)' : 'transparent',
              }}
            >
              Today
            </button>
            <button
              onClick={() => onStep(1)}
              aria-label="Next"
              className="grid place-items-center w-8 h-8 text-bone-3 hover:text-bone-0 hover:bg-chassis-3 transition-colors duration-150 ease-snap"
            >
              <ArrowRight size={14} strokeWidth={2} />
            </button>
          </div>

          <button
            onClick={onAdd}
            className="btn-primary inline-flex items-center gap-2 text-body-sm px-3 h-8"
          >
            <Plus size={14} strokeWidth={2.6} />
            New entry
          </button>
        </div>
      </div>
      <div className="rule-h" />
    </header>
  );
}

/**
 * Counted in whole calendar days via UTC, not by subtracting local timestamps.
 * A local-time millisecond difference is an hour short once the year has crossed
 * a daylight-saving boundary, which floors to the previous day — July 29th 2026
 * came out as day 209 instead of 210.
 */
function dayOfYear(d: Date): number {
  const startOfYear = Date.UTC(d.getFullYear(), 0, 1);
  const thisDay = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return Math.round((thisDay - startOfYear) / 86_400_000) + 1;
}

/** 366 in a leap year — the old header hardcoded 365. */
function daysInYear(d: Date): number {
  const y = d.getFullYear();
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
}

export default memo(Toolbar);

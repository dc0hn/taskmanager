import { memo } from 'react';
import type { DayMarkDef, DayMarks, DayPlan } from '../types';
import { markById } from '../daymarks';
import { formatDuration, fromDateKey, toDateKey } from '../utils/time';
import { weekDates } from '../week';

// ============================================================================
// WeekStrip — the day-header row above the week grid.
//
// Each column header carries the weekday, the date, and a load figure, so you
// can see which day is overcommitted before scrolling the grid. Clicking a
// header jumps to that day in day view.
// ============================================================================

interface Props {
  weekKey: string;
  plans: Record<string, DayPlan>;
  /**
   * The trailing median completion ratio for each date's weekday, where enough history
   * exists. Drawn as a ghost behind the live bar.
   */
  medians?: Record<string, number>;
  selected: string;
  onSelectDay: (date: string) => void;
  /** Matches TimeGrid's axis gutter so headers line up with their columns. */
  axisWidth: number;
  marks: DayMarks;
  markDefs: DayMarkDef[];
}

function WeekStrip({
  weekKey,
  plans,
  medians = {},
  selected,
  onSelectDay,
  axisWidth,
  marks,
  markDefs,
}: Props) {
  const today = toDateKey(new Date());
  const dates = weekDates(weekKey);

  return (
    <div className="flex shrink-0 border-b border-rule-2">
      <div style={{ width: axisWidth }} className="shrink-0" />
      {dates.map((date, i) => {
        const d = fromDateKey(date);
        const isToday = date === today;
        const isSelected = date === selected;
        const weekend = [0, 6].includes(d.getDay());
        const blocks = (plans[date]?.blocks ?? []).filter((b) => !b.auto);
        const minutes = blocks.reduce((sum, b) => sum + (b.end - b.start), 0);
        const doneMinutes = blocks
          .filter((b) => b.completed)
          .reduce((sum, b) => sum + (b.end - b.start), 0);
        const pct = minutes > 0 ? (doneMinutes / minutes) * 100 : 0;
        const mark = markById(markDefs, marks[date]);
        const ghost = medians[date] ?? null;

        return (
          <button
            key={date}
            onClick={() => onSelectDay(date)}
            className="flex-1 min-w-0 px-2 py-2.5 text-left transition-colors relative group"
            style={{
              borderLeft: i > 0 ? '1px solid rgba(245, 242, 236,0.055)' : undefined,
              background: isSelected
                ? 'rgba(74,158,255,0.07)'
                : weekend
                  ? 'rgba(245, 242, 236,0.012)'
                  : undefined,
            }}
          >
            {/* A cap rather than a wash: the column below belongs to the grid, so
                the mark claims only the header. */}
            {mark && (
              <span
                aria-hidden
                className="absolute left-0 right-0 top-0 pointer-events-none"
                style={{ height: 2, background: mark.color }}
              />
            )}

            <div className="flex items-baseline gap-1.5">
              <span
                className="font-mono text-nano tracking-widest uppercase"
                style={{ color: isToday ? 'var(--signal)' : 'var(--bone-3)' }}
              >
                {d.toLocaleDateString(undefined, { weekday: 'short' })}
              </span>
              {mark && (
                <span
                  className="font-mono text-nano tracking-widest uppercase truncate"
                  style={{ color: mark.color }}
                  title={mark.label}
                >
                  {mark.label}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span
                className="font-mono text-[17px] tnum leading-none"
                style={{
                  color: isToday ? 'var(--signal)' : isSelected ? 'var(--bone-0)' : 'var(--bone-1)',
                  fontWeight: isToday || isSelected ? 700 : 500,
                }}
              >
                {d.getDate()}
              </span>
              {isToday && (
                <span
                  className="w-[5px] h-[5px] rounded-full shrink-0"
                  style={{ background: 'var(--signal)' }}
                />
              )}
            </div>

            <div className="mt-1.5 flex items-center gap-1.5">
              <span className="font-mono text-nano text-bone-3 tnum truncate">
                {minutes > 0 ? formatDuration(minutes) : '—'}
              </span>
            </div>
            {/*
              Two bars on one axis: the live one, and a ghost of how this weekday usually
              goes.
              
              This is the only thing in the app that answers "am I actually improving?".
              Everything else in the progression layer reports today against nothing. The
              ghost is the trailing four-week median for this weekday — a median rather than
              a mean because one abandoned day ruins a four-sample average, and a ratio
              rather than minutes so it shares the live bar's scale and needs no legend.
              
              Absent for a weekday with under two days of history, because a baseline drawn
              from one previous Tuesday is not a baseline, it is last Tuesday.
            */}
            <div
              className="mt-1 h-[3px] rounded-full overflow-hidden relative"
              style={{ background: minutes > 0 ? 'rgba(245, 242, 236,0.07)' : 'transparent' }}
              title={
                ghost == null
                  ? undefined
                  : `${Math.round(pct)}% done \u2014 usually ${Math.round(ghost * 100)}% on a ${d.toLocaleDateString(undefined, { weekday: 'long' })}`
              }
            >
              {ghost != null && (
                <span
                  aria-hidden
                  className="absolute inset-y-0 left-0 rounded-full"
                  style={{
                    width: `${Math.min(100, ghost * 100)}%`,
                    background: 'rgba(245, 242, 236,0.22)',
                  }}
                />
              )}
              <div
                className="h-full rounded-full transition-all duration-500 relative"
                style={{ width: `${pct}%`, background: 'var(--good)' }}
              />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default memo(WeekStrip);

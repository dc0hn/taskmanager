import { memo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { addMonths, formatMonthLong, isSameMonth, monthGridDates } from '../week';
import { fromDateKey, toDateKey } from '../utils/time';

// ============================================================================
// MiniMonth — the compact month calendar in the nav rail.
//
// Density markers rather than counts: a dot under a date means something is
// scheduled there. At this size a number would be unreadable, and the useful
// question at a glance is "is that day busy", not "how busy".
// ============================================================================

const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

interface Props {
  /** The month being displayed. */
  cursor: string;
  /** The currently selected date. */
  selected: string;
  /** Dates that have any scheduled block. */
  busyDates: Set<string>;
  onSelect: (date: string) => void;
  onCursorChange: (date: string) => void;
}

function MiniMonth({ cursor, selected, busyDates, onSelect, onCursorChange }: Props) {
  const today = toDateKey(new Date());
  const cells = monthGridDates(cursor);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-body-sm font-semibold text-ink-1">
          {formatMonthLong(cursor)}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => onCursorChange(addMonths(cursor, -1))}
            aria-label="Previous month"
            className="grid place-items-center w-6 h-6 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-3 transition-colors"
          >
            <ChevronLeft size={14} strokeWidth={1.9} />
          </button>
          <button
            onClick={() => onCursorChange(addMonths(cursor, 1))}
            aria-label="Next month"
            className="grid place-items-center w-6 h-6 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-3 transition-colors"
          >
            <ChevronRight size={14} strokeWidth={1.9} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-y-0.5">
        {WEEKDAY_INITIALS.map((d, i) => (
          <div
            key={i}
            className="font-mono text-nano text-bone-3 text-center pb-1 tracking-wider"
          >
            {d}
          </div>
        ))}

        {cells.map((date) => {
          const inMonth = isSameMonth(date, cursor);
          const isSelected = date === selected;
          const isToday = date === today;
          const busy = busyDates.has(date);

          return (
            <button
              key={date}
              onClick={() => onSelect(date)}
              className="relative grid place-items-center h-[26px] rounded-md transition-colors"
              style={{
                background: isSelected ? 'var(--signal)' : undefined,
                color: isSelected
                  // Dark ink on amber, not white. Amber is a light colour — white
                  // on it measures 1.8:1, which is unreadable.
                  ? 'var(--action-ink)'
                  : isToday
                    ? 'var(--signal)'
                    : inMonth
                      ? 'var(--bone-1)'
                      : 'var(--bone-3)',
                fontWeight: isSelected || isToday ? 650 : 450,
              }}
              onMouseEnter={(e) => {
                if (!isSelected) e.currentTarget.style.background = 'var(--chassis-3)';
              }}
              onMouseLeave={(e) => {
                if (!isSelected) e.currentTarget.style.background = '';
              }}
            >
              <span className="font-mono text-micro tnum leading-none">
                {fromDateKey(date).getDate()}
              </span>
              {busy && (
                <span
                  className="absolute bottom-[3px] w-[3px] h-[3px] rounded-full"
                  style={{
                    background: isSelected ? 'rgba(245, 242, 236,0.85)' : 'var(--signal)',
                  }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default memo(MiniMonth);

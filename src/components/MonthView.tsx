import { memo } from 'react';
import type { Block, CategoryDef, DayPlan } from '../types';
import { categoryColors } from '../utils/color';
import { format12h, formatDuration, fromDateKey, toDateKey } from '../utils/time';
import { isSameMonth, monthGridDates } from '../week';

// ============================================================================
// MonthView
//
// Not a variant of the time grid — there is no time axis here. Blocks collapse
// to coloured pills in date order, and anything that doesn't fit the cell is
// summarised as "+N more" rather than being silently dropped.
// ============================================================================

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MAX_PILLS = 3;

interface Props {
  cursor: string;
  plans: Record<string, DayPlan>;
  categories: CategoryDef[];
  onOpenDay: (date: string) => void;
  onEditBlock: (date: string, id: string) => void;
}

function MonthView({ cursor, plans, categories, onOpenDay, onEditBlock }: Props) {
  const today = toDateKey(new Date());
  const cells = monthGridDates(cursor);
  const weeks = Math.ceil(cells.length / 7);

  return (
    <div className="flex-1 min-h-0 flex flex-col px-6 pb-5">
      <div className="grid grid-cols-7 shrink-0">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="font-mono text-nano tracking-widest uppercase text-bone-3 px-2 py-2"
          >
            {d}
          </div>
        ))}
      </div>

      <div
        className="flex-1 min-h-0 grid gap-px rounded-xl4 overflow-hidden"
        style={{
          gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
          gridTemplateRows: `repeat(${weeks}, minmax(0, 1fr))`,
          background: 'rgba(245, 242, 236,0.055)',
          border: '1px solid var(--rule-2)',
        }}
      >
        {cells.map((date) => {
          const d = fromDateKey(date);
          const inMonth = isSameMonth(date, cursor);
          const isToday = date === today;
          const weekend = [0, 6].includes(d.getDay());
          const blocks = [...(plans[date]?.blocks ?? [])]
            .filter((b) => !b.auto)
            .sort((a, b) => a.start - b.start);
          const overflowCount = Math.max(0, blocks.length - MAX_PILLS);
          const minutes = blocks.reduce((s, b) => s + (b.end - b.start), 0);

          return (
            <div
              key={date}
              className="relative min-h-0 flex flex-col p-1.5 overflow-hidden group"
              style={{
                background: inMonth
                  ? weekend
                    ? 'rgba(245, 242, 236,0.014)'
                    : 'var(--chassis-1)'
                  : 'rgba(6, 6, 5, 0.55)',
              }}
            >
              <button
                onClick={() => onOpenDay(date)}
                className="flex items-center gap-1.5 shrink-0 mb-1 w-full text-left"
                title={
                  minutes > 0 ? `${formatDuration(minutes)} scheduled` : 'Nothing scheduled'
                }
              >
                <span
                  className="grid place-items-center font-mono text-micro tnum leading-none rounded-md transition-colors"
                  style={{
                    minWidth: 20,
                    height: 20,
                    // Dark ink on the amber "today" mark — white on amber is 1.8:1.
                    color: isToday
                      ? 'var(--action-ink)'
                      : inMonth
                        ? 'var(--bone-1)'
                        : 'var(--bone-3)',
                    background: isToday ? 'var(--signal)' : undefined,
                    fontWeight: isToday ? 700 : 500,
                  }}
                >
                  {d.getDate()}
                </span>
                {minutes > 0 && (
                  <span className="font-mono text-nano text-bone-3 tnum opacity-0 group-hover:opacity-100 transition-opacity">
                    {formatDuration(minutes)}
                  </span>
                )}
              </button>

              <div className="flex-1 min-h-0 space-y-[3px] overflow-hidden">
                {blocks.slice(0, MAX_PILLS).map((b) => (
                  <MonthPill
                    key={b.id}
                    block={b}
                    categories={categories}
                    onClick={() => onEditBlock(date, b.id)}
                  />
                ))}
                {overflowCount > 0 && (
                  <button
                    onClick={() => onOpenDay(date)}
                    className="w-full text-left px-1.5 py-[1px] rounded text-nano text-ink-3 hover:text-ink-0 transition-colors"
                  >
                    +{overflowCount} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MonthPill({
  block,
  categories,
  onClick,
}: {
  block: Block;
  categories: CategoryDef[];
  onClick: () => void;
}) {
  const c = categoryColors(block.category, categories);
  const done = !!block.completed;
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1 px-1.5 py-[2px] rounded text-left transition-opacity hover:opacity-80"
      style={{
        background: done ? 'rgba(245, 242, 236,0.035)' : c.fill,
        borderLeft: `2px solid ${done ? 'rgba(245, 242, 236,0.16)' : c.accent}`,
        opacity: done ? 0.6 : 1,
      }}
      title={`${block.title} · ${format12h(block.start)}`}
    >
      <span
        className="font-mono text-nano tnum shrink-0"
        style={{ color: done ? 'var(--bone-3)' : c.textDim }}
      >
        {format12h(block.start).replace(':00', '')}
      </span>
      <span
        className="text-nano truncate font-medium"
        style={{
          color: done ? 'var(--bone-3)' : c.text,
          textDecoration: done ? 'line-through' : undefined,
        }}
      >
        {block.title}
      </span>
    </button>
  );
}

export default memo(MonthView);

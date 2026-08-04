import { memo } from 'react';
import { Check, Moon } from 'lucide-react';
import type { RecurringTask } from '../types';
import { colorsFor } from '../utils/color';
import type { CategoryDef } from '../types';

// ============================================================================
// CheckmarkStrip — the things with no time
//
// A gallon of water is finished whenever it is finished. Putting it on the grid at 3pm
// makes the calendar say something false, and then the app compounds the error: it
// marks the block late, or drops it into overflow, or leaves it unticked because the
// day was never rebuilt and so the block it needed never existed.
//
// So these live outside the schedule entirely. No start, no end, no slot to be late
// for, and nothing the scheduler can displace. They can be ticked at any hour.
//
// Deliberately SMALL and above the grid rather than in it. A checkmark is not an
// appointment and must not look like one — giving it a row on the timeline would put
// it back in the schedule visually while claiming it is not in the schedule.
// ============================================================================

interface Props {
  items: RecurringTask[];
  categories: CategoryDef[];
  /** Template ids already ticked for the crediting day. */
  checked: Set<string>;
  /**
   * The day a tick will actually land on. Differs from the day on screen inside the
   * grace window, and is stated for exactly that reason.
   */
  creditDate: string;
  creditLabel: string;
  inGrace: boolean;
  onToggle: (templateId: string, on: boolean) => void;
}

function CheckmarkStrip({
  items,
  categories,
  checked,
  creditLabel,
  inGrace,
  onToggle,
}: Props) {
  if (items.length === 0) return null;

  const done = items.filter((t) => checked.has(t.id)).length;

  return (
    // Sits in the gap between the toolbar and the sheet, so it carries no panel
    // background and no rule — a second framed surface stacked above the framed grid
    // would read as a card inside a card, which is the one thing the day view's
    // single-hairline layout avoids everywhere else. `px-6` matches the measure of
    // the grid below it, so the chips line up with the sheet's left edge.
    <div className="px-6 pb-2.5 shrink-0">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="legend shrink-0">Anytime</span>
        <span className="font-mono text-nano text-bone-3 tnum shrink-0">
          {done}/{items.length}
        </span>

        {/* The grace window, stated rather than applied silently. */}
        {inGrace && (
          <span
            className="inline-flex items-center gap-1 font-mono text-nano px-1.5 py-[1px] rounded-sm shrink-0"
            style={{ color: 'var(--signal)', border: '1px solid var(--signal-line)' }}
            title="Before 4am, a check still counts toward the day that just ended."
          >
            <Moon size={9} strokeWidth={2} />
            counting for {creditLabel}
          </span>
        )}

        <div className="flex items-center gap-1.5 flex-wrap">
          {items.map((item) => {
            const on = checked.has(item.id);
            const cat = categories.find((c) => c.id === item.category);
            const accent = cat?.accent ?? '#6b7488';
            const c = colorsFor(accent);
            return (
              <button
                key={item.id}
                onClick={() => onToggle(item.id, !on)}
                aria-pressed={on}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium transition-all"
                style={{
                  background: on ? c.fillStrong : 'rgba(245, 242, 236,0.035)',
                  border: `1px solid ${on ? c.line : 'var(--rule-2)'}`,
                  color: on ? c.text : 'var(--bone-2)',
                }}
              >
                <span
                  className="grid place-items-center rounded-xs shrink-0"
                  style={{
                    width: 12,
                    height: 12,
                    background: on ? accent : 'transparent',
                    boxShadow: on
                      ? 'none'
                      : 'inset 0 0 0 1.5px rgba(245, 242, 236,0.28)',
                  }}
                >
                  {on && <Check size={9} strokeWidth={3.4} className="text-chassis-0" />}
                </span>
                {item.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default memo(CheckmarkStrip);

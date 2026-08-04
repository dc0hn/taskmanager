import { memo } from 'react';
import { Check, Moon } from 'lucide-react';
import { colorsFor } from '../utils/color';
import type { CategoryDef } from '../types';

/**
 * One tickable thing, whichever kind it came from.
 *
 * Routines and weekly goals are separate systems that happen to want the same control,
 * so the strip is given a flat shape rather than a union of both records. It does not
 * need to know which is which — only what to draw, how many are done, and what to call
 * when one is clicked.
 */
export interface CheckItem {
  id: string;
  label: string;
  category: string;
  /** Ticks recorded for the crediting day. */
  done: number;
  /**
   * Ticks wanted per day, derived from a weekly target. Fourteen walks a week is two a
   * day, so the chip reads 1/2 rather than pretending one is the whole of it.
   */
  perDay: number;
  /**
   * The day THIS item's tick lands on.
   *
   * Per item, not per strip, and that distinction is the whole of a bug: inside the
   * grace window the strip credits yesterday, but a routine created today was not due
   * yesterday and so vanished from the list entirely. Listing and crediting are
   * different questions and each item answers them for itself.
   */
  creditDate: string;
  /** "Mon 3 Aug", shown on the chip when it is not the current day. */
  creditLabel: string;
  /** True when this item credits a day other than the real one. */
  offDay: boolean;
}

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
  items: CheckItem[];
  categories: CategoryDef[];
  /**
   * The day a tick will actually land on. Differs from the day on screen inside the
   * grace window, and is stated for exactly that reason.
   */
  onToggle: (id: string, on: boolean) => void;
}

function CheckmarkStrip({ items, categories, onToggle }: Props) {
  if (items.length === 0) return null;

  const done = items.filter((t) => t.done >= t.perDay).length;

  return (
    // Sits in the gap between the toolbar and the sheet, so it carries no panel
    // background and no rule — a second framed surface stacked above the framed grid
    // would read as a card inside a card, which is the one thing the day view's
    // single-hairline layout avoids everywhere else. `px-6` matches the measure of
    // the grid below it, so the chips line up with the sheet's left edge.
    //
    // Vertical padding is SYMMETRIC. It was bottom-only, which pinned the chips against
    // the toolbar's rule above and pooled all the space beneath them — they read as
    // hanging off the toolbar rather than sitting in the gap. Equal padding centres the
    // row between the two rules and keeps it clear of both.
    <div className="px-6 py-3 shrink-0">
      <div className="flex items-center gap-2 gap-y-1.5 flex-wrap">
        <span className="legend shrink-0">Anytime</span>
        <span className="font-mono text-nano text-bone-3 tnum shrink-0">
          {done}/{items.length}
        </span>

        <div className="flex items-center gap-1.5 flex-wrap">
          {items.map((item) => {
            const full = item.done >= item.perDay;
            const on = item.done > 0;
            const cat = categories.find((c) => c.id === item.category);
            const accent = cat?.accent ?? '#6b7488';
            const c = colorsFor(accent);
            return (
              <button
                key={item.id}
                // Clicking adds a tick until the day's quota is met, then clears it.
                // Two walks a day needs a second click to mean something, and a third
                // to undo — a plain toggle would make the fourteenth walk unrecordable.
                onClick={() => onToggle(item.id, !full)}
                aria-pressed={full}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11.5px] font-medium transition-all"
                style={{
                  background: on ? c.fillStrong : 'rgba(245, 242, 236,0.035)',
                  border: `1px solid ${full ? c.line : 'var(--rule-2)'}`,
                  color: on ? c.text : 'var(--bone-2)',
                }}
                title={
                  item.perDay > 1
                    ? `${item.done} of ${item.perDay} today — click to add one`
                    : undefined
                }
              >
                <span
                  className="grid place-items-center rounded-xs shrink-0"
                  style={{
                    width: 12,
                    height: 12,
                    background: full ? accent : 'transparent',
                    boxShadow: full
                      ? 'none'
                      : 'inset 0 0 0 1.5px rgba(245, 242, 236,0.28)',
                  }}
                >
                  {full && <Check size={9} strokeWidth={3.4} className="text-chassis-0" />}
                </span>
                {item.label}
                {/* Shown only where more than one is wanted, so a once-a-day thing
                    stays a plain checkbox rather than reading "1/1". */}
                {item.perDay > 1 && (
                  <span className="font-mono text-nano tnum opacity-70">
                    {item.done}/{item.perDay}
                  </span>
                )}
                {/* Per chip, because inside the grace window some items credit
                    yesterday and some — the ones that did not exist yesterday —
                    credit today. A single banner would be wrong for half of them. */}
                {item.offDay && (
                  <span
                    className="inline-flex items-center gap-0.5 font-mono text-nano opacity-80"
                    title={`Counts toward ${item.creditLabel}`}
                  >
                    <Moon size={8} strokeWidth={2} />
                    {item.creditLabel}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default memo(CheckmarkStrip);

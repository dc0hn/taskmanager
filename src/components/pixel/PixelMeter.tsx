import { memo, useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';

// ============================================================================
// PixelMeter — a segmented progress bar
//
// Discrete cells rather than a smooth fill. That is the whole point: a continuous
// bar is a modern UI convention, and a bar that advances one lit cell at a time is
// unmistakably a game readout. It also happens to be more honest — you can count
// the segments and see exactly how far along you are.
//
// The fill animates by lighting cells in sequence, which is why the component owns
// a little state instead of just rendering a width. Under reduced motion it snaps,
// because a cell-by-cell reveal is precisely the sort of thing that setting exists
// to switch off.
// ============================================================================

interface Props {
  /** 0..1. Values outside are clamped. */
  value: number;
  /** How many cells the bar is divided into. */
  segments?: number;
  /** Cell height in CSS pixels. */
  height?: number;
  /** Gap between cells in CSS pixels. */
  gap?: number;
  color?: string;
  /** Track colour behind unlit cells. */
  trackColor?: string;
  /** Light the leading cell brighter, as a cursor. */
  cursor?: boolean;
  /**
   * Draw a divider at this fraction, 0..1.
   *
   * Used to put the streak threshold on the day meter so one bar can answer both
   * "how far through today am I" and "where does the run become safe" — two numbers
   * that previously sat side by side and invited being confused.
   */
  notchAt?: number;
  notchColor?: string;
  className?: string;
  title?: string;
}

function PixelMeter({
  value,
  segments = 20,
  height = 10,
  gap = 2,
  color = 'var(--signal)',
  trackColor = 'var(--chassis-4)',
  cursor = true,
  notchAt,
  notchColor = 'var(--bone-0)',
  className,
  title,
}: Props) {
  const reduced = useReducedMotion();
  const target = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  const lit = Math.round(target * segments);

  // Animate the count, not a width, so cells light one after another.
  const [shown, setShown] = useState(lit);
  const shownRef = useRef(lit);
  shownRef.current = shown;

  useEffect(() => {
    if (reduced) {
      setShown(lit);
      return;
    }
    if (shownRef.current === lit) return;
    const step = shownRef.current < lit ? 1 : -1;
    // ~26ms per cell: fast enough to feel mechanical, slow enough to read.
    const id = setInterval(() => {
      setShown((s) => {
        const next = s + step;
        if ((step > 0 && next >= lit) || (step < 0 && next <= lit)) {
          clearInterval(id);
          return lit;
        }
        return next;
      });
    }, 26);
    return () => clearInterval(id);
  }, [lit, reduced]);

  // Which cell boundary the notch falls on, so it lands between cells rather than
  // slicing one in half — a pixel meter with a half-lit cell reads as a glitch.
  const notchIndex =
    notchAt != null && notchAt > 0 && notchAt < 1
      ? Math.round(Math.max(0, Math.min(1, notchAt)) * segments)
      : null;

  return (
    <div
      className={className}
      style={{ display: 'flex', gap, alignItems: 'stretch', height, position: 'relative' }}
      role="progressbar"
      aria-valuenow={Math.round(target * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={title}
      title={title}
    >
      {Array.from({ length: segments }, (_, i) => {
        const on = i < shown;
        const isCursor = cursor && on && i === shown - 1 && shown < segments;
        return (
          <span
            key={i}
            style={{
              flex: 1,
              minWidth: 2,
              background: on ? (isCursor ? 'var(--signal-bright)' : color) : trackColor,
              // Square corners: rounding a pixel meter defeats it.
              borderRadius: 0,
              transition: reduced ? 'none' : 'background-color 90ms steps(2, end)',
              // The notch is a border on the cell that starts the safe zone, so it
              // scales with the meter instead of needing absolute positioning.
              boxShadow:
                notchIndex === i ? `inset 2px 0 0 0 ${notchColor}` : undefined,
            }}
          />
        );
      })}
    </div>
  );
}

export default memo(PixelMeter);

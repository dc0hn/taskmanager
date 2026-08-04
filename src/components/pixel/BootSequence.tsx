import { memo, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { GRID, RINGS } from './bootMark';

// ============================================================================
// BootSequence — the mark being struck, once, when the app opens
//
// An almanac was a printed thing, so the opening reads as a press: the sigil is stamped
// into the page cell by cell, the wordmark is set beside it, and a rule is drawn under
// both. Nothing floats or bounces — 8-bit means integer cells and stepped time, not eased
// motion at small scale.
//
// Four rules, and three of them are about not being in the way:
//
//   IT NEVER BLOCKS. The app mounts and renders underneath from the first frame. This is an
//   overlay that leaves, not a splash that gates — so a slow boot animation can cost you a
//   moment of looking at it, never a moment of using the calendar.
//
//   ANY KEY OR CLICK ENDS IT. A startup animation you have to sit through is a tax you pay
//   every single launch. This one is skippable before it has really begun.
//
//   ONCE PER LAUNCH. It owns its own lifecycle rather than reporting to a parent flag, so
//   there is no state anywhere for a re-render, a navigation or a midnight rollover to
//   flip back — once it has closed, it renders nothing for the rest of the session.
//
//   REDUCED MOTION SKIPS IT ENTIRELY. Not a shortened version: someone who has asked for
//   less motion has not asked for a faster stamp, they have asked for none. They get the
//   app, immediately.
//
// Drawn as SVG rects on an integer grid for the same three reasons Sigil is: the CSP
// forbids external assets, a pixel grid stays crisp at any size a bitmap would not, and the
// amber comes from the live token so it can never drift from the rest of the app.
// ============================================================================

const CELLS: { x: number; y: number; step: number }[] = RINGS.flatMap((cells, ring) =>
  cells.map((c) => ({ ...c, step: ring }))
);

const WORD = 'ALMANAC';

/**
 * Ring interval, and how long the whole thing runs before leaving on its own.
 *
 * Four rings rather than 28 cells, so the interval is per PULSE — a longer beat covering
 * the same ground. The mark takes about 0.7s to reach its full width, the wordmark another
 * 0.3s, and the sequence lands near 1.4s before the exit. Long enough to read as a title
 * card, short enough not to be a toll, and any key or click cuts it short.
 */
const RING_MS = 170;
const MARK_MS = RINGS.length * RING_MS;
const LETTER_MS = 45;
const HOLD_MS = 420;
const TOTAL_MS = MARK_MS + WORD.length * LETTER_MS + HOLD_MS;

function BootSequence() {
  const reduced = useReducedMotion();
  // Never open for reduced motion, decided at mount rather than corrected by an effect —
  // which would both flash a frame of the stamp and set state synchronously during one.
  const [open, setOpen] = useState(!reduced);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => setOpen(false), TOTAL_MS);
    return () => window.clearTimeout(id);
  }, [open]);

  // Any key, any click. A startup animation you have to sit through is a tax on every
  // launch, so the escape is deliberately as wide as possible.
  useEffect(() => {
    if (!open) return;
    const skip = () => setOpen(false);
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [open]);

  // A second guard, for the case where the media query resolves after mount.
  if (reduced) return null;

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center"
          style={{ background: 'var(--chassis-0)' }}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          // Leaves quickly and without moving. The app is already behind it, so anything
          // slower here is time spent watching a curtain rather than a calendar.
          exit={{ opacity: 0, transition: { duration: 0.22, ease: [0.4, 0, 1, 1] } }}
        >
          <div className="flex flex-col items-center gap-6 select-none">
            <svg
              viewBox={`0 0 ${GRID} ${GRID}`}
              width={224}
              height={224}
              shapeRendering="crispEdges"
              aria-hidden
            >
              {CELLS.map((c) => (
                <rect
                  key={`${c.x}-${c.y}`}
                  x={c.x}
                  y={c.y}
                  width={1}
                  height={1}
                  fill="var(--signal)"
                  className="animate-bootCell"
                  // One CSS animation per cell with a staggered delay, rather than a timer
                  // per cell or a state update per frame. Sixty-four inline delays cost one
                  // render; sixty-four timers would cost sixty-four.
                  style={{ animationDelay: `${c.step * RING_MS}ms` }}
                />
              ))}
            </svg>

            <div className="flex items-center" style={{ gap: 5 }}>
              {WORD.split('').map((ch, i) => (
                <span
                  key={i}
                  className="font-mono animate-bootCell"
                  // Set after the mark is struck, one character at a time. `steps(1)`
                  // rather than a fade: type either exists or it does not.
                  style={{
                    fontSize: 22,
                    letterSpacing: '0.4em',
                    color: 'var(--bone-0)',
                    animationDelay: `${MARK_MS + i * LETTER_MS}ms`,
                  }}
                >
                  {ch}
                </span>
              ))}
            </div>

            {/* The rule under the wordmark, drawn left to right once the type is set. */}
            <span
              aria-hidden
              className="animate-bootRule"
              style={{
                display: 'block',
                height: 3,
                width: 268,
                background: 'var(--signal)',
                transformOrigin: 'left center',
                animationDelay: `${MARK_MS + WORD.length * LETTER_MS}ms`,
              }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default memo(BootSequence);

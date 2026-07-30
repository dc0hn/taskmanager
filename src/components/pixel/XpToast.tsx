import { memo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import Sigil from './Sigil';
import PixelBurst from './PixelBurst';
import PixelMeter from './PixelMeter';
import type { Standing } from '../../progress';

// ============================================================================
// Feedback on completion
//
// Three sizes of reward, deliberately unequal:
//
//   XpFloat      a number that drifts up and fades. Fires many times a day, so it
//                is small, silent and never in the way.
//   LevelToast   a corner card for an ordinary level. ~54 of the 60 levels in a
//                cycle land here.
//   LevelTakeover  the full-screen moment, reserved for arc capstones and prestige.
//
// The unevenness is the design. At this pace you level roughly 1.6 times a day, and
// a full-screen event twice daily stops being a reward and becomes an interruption
// — so the big one is rationed to seven moments per cycle.
// ============================================================================

// ---------------------------------------------------------------------------

export interface FloatingXp {
  /** New for each award, so repeats re-trigger the animation. */
  key: number;
  xp: number;
  /** Combo run at the time, 0 when there was none. */
  combo: number;
}

export const XpFloat = memo(function XpFloat({ award }: { award: FloatingXp | null }) {
  const reduced = useReducedMotion();
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-24 z-[60] pointer-events-none">
      <AnimatePresence>
        {award && (
          <motion.div
            key={award.key}
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: reduced ? 0 : -22, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -40 }}
            transition={{ duration: reduced ? 0 : 0.9, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex items-center gap-2 font-mono tnum"
            style={{ fontSize: 15, fontWeight: 700, color: 'var(--signal)' }}
          >
            <span>+{award.xp} XP</span>
            {award.combo > 0 && (
              <span
                className="px-1.5 py-[1px] font-mono"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.08em',
                  color: 'var(--action-ink)',
                  background: 'var(--signal)',
                }}
              >
                COMBO ×{(1 + 0.1 * Math.min(award.combo, 5)).toFixed(1)}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ---------------------------------------------------------------------------

export const LevelToast = memo(function LevelToast({
  standing,
  onDone,
}: {
  standing: Standing | null;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="fixed right-6 bottom-6 z-[60] pointer-events-none">
      <AnimatePresence onExitComplete={onDone}>
        {standing && (
          <motion.div
            key={`${standing.prestige}:${standing.level}`}
            initial={{ opacity: 0, x: reduced ? 0 : 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: reduced ? 0 : 24 }}
            transition={{ duration: reduced ? 0 : 0.26, ease: [0.2, 0.8, 0.2, 1] }}
            className="flex items-center gap-3 px-3 py-2.5"
            style={{
              background: 'var(--chassis-2)',
              // Square, with a hard amber edge — a readout, not a notification.
              border: '1px solid var(--signal-line)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <Sigil form={standing.sigilForm} pips={standing.sigilPips} size={26} />
            <div>
              <div
                className="font-mono"
                style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--signal)' }}
              >
                LEVEL {standing.level}
              </div>
              <div
                className="font-display"
                style={{ fontSize: 16, color: 'var(--bone-0)', lineHeight: 1.15 }}
              >
                {standing.rank}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ---------------------------------------------------------------------------

/**
 * Banner geometry.
 *
 * The first attempt used five 6px bars up to 150px wide, which read as a stack of
 * rules rather than a banner. Chunkier and much wider fixes it: at 10px tall and
 * 300px across, the taper is legible as a shape instead of as line spacing.
 */
const BANNER_ROWS = 7;
const BANNER_BAR_H = 10;
const BANNER_MAX_W = 300;
const BANNER_STEP = 34;

/**
 * The shared full-screen moment: dim, banner, burst, then whatever it is about.
 *
 * Extracted rather than copied, because there are now two things that deserve this
 * treatment — an arc capstone and a thirty-day run — and a second hand-rolled copy
 * would be two banners that drift apart.
 */
export const TakeoverShell = memo(function TakeoverShell({
  open,
  big,
  seed,
  label,
  onDismiss,
  children,
}: {
  open: boolean;
  /** Larger banner, wider burst. Reserved for prestige and the 100-day run. */
  big: boolean;
  /** Varies the burst so two takeovers never look stamped from one frame. */
  seed: number;
  /** The engraved word above the subject. */
  label: string;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const mid = Math.floor(BANNER_ROWS / 2);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          // Dismissible by anything at all — it must never stand between you and
          // the next thing you meant to do.
          onClick={onDismiss}
          style={{ background: 'rgba(8, 8, 7, 0.88)', backdropFilter: 'blur(3px)' }}
        >
          <motion.div
            className="relative flex flex-col items-center text-center px-8"
            initial={{ scale: reduced ? 1 : 0.94 }}
            animate={{ scale: 1 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.2, 0.9, 0.2, 1] }}
          >
            <div className="flex flex-col items-center gap-[3px] mb-7">
              {Array.from({ length: BANNER_ROWS }, (_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scaleX: reduced ? 1 : 0.15 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{
                    duration: reduced ? 0 : 0.16,
                    delay: reduced ? 0 : i * 0.045,
                    ease: [0.2, 0.9, 0.2, 1],
                  }}
                  style={{
                    height: BANNER_BAR_H,
                    width: BANNER_MAX_W - Math.abs(i - mid) * BANNER_STEP,
                    background: i === mid ? 'var(--signal-bright)' : 'var(--signal)',
                  }}
                />
              ))}
            </div>

            <div className="relative">
              <PixelBurst
                seed={seed}
                count={big ? 44 : 28}
                spread={big ? 190 : 140}
                size={big ? 8 : 6}
                duration={big ? 1.3 : 0.9}
              />
              {children}
            </div>

            <div
              className="font-mono mt-7"
              style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--bone-3)' }}
            >
              CLICK ANYWHERE TO CONTINUE
            </div>
            <span className="sr-only">{label}</span>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

// ---------------------------------------------------------------------------

/**
 * A run kept today. Fires once, the moment the threshold is crossed.
 *
 * The most frequently earned moment in the app after the XP float, so it is small
 * and quick — but it exists because the single most meaningful daily event was
 * previously silent, with only a number quietly changing.
 */
export const RunKeptToast = memo(function RunKeptToast({
  run,
  seed,
  onDone,
}: {
  run: number | null;
  seed: number;
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-32 z-[62] pointer-events-none">
      <AnimatePresence onExitComplete={onDone}>
        {run != null && (
          <motion.div
            key={seed}
            initial={{ opacity: 0, scale: reduced ? 1 : 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduced ? 1 : 1.1 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.15, 1.3, 0.4, 1] }}
            className="relative flex items-center gap-2.5 px-3 py-2"
            style={{
              background: 'var(--chassis-2)',
              border: '1px solid var(--signal-line)',
            }}
          >
            <PixelBurst seed={seed} count={16} spread={70} size={4} duration={0.7} />
            {/* The chevron stack from the sidebar, larger. */}
            <span className="flex flex-col gap-[2px] shrink-0" aria-hidden>
              {[4, 7, 10].map((w) => (
                <span key={w} style={{ display: 'block', width: w, height: 2, background: 'var(--signal)' }} />
              ))}
            </span>
            <div className="text-left">
              <div
                className="font-mono"
                style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--signal)' }}
              >
                RUN KEPT
              </div>
              <div className="font-mono tnum" style={{ fontSize: 17, fontWeight: 700, color: 'var(--bone-0)', lineHeight: 1.1 }}>
                {run} day{run === 1 ? '' : 's'}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

// ---------------------------------------------------------------------------

/** A day-streak milestone worth stopping for: thirty days, or a hundred. */
export const RunTakeover = memo(function RunTakeover({
  days,
  onDismiss,
}: {
  days: number | null;
  onDismiss: () => void;
}) {
  const reduced = useReducedMotion();
  const big = (days ?? 0) >= 100;
  return (
    <TakeoverShell
      open={days != null}
      big={big}
      seed={(days ?? 0) + 900}
      label={`${days} day run`}
      onDismiss={onDismiss}
    >
      <motion.div
        initial={{ scale: reduced ? 1 : 0.4, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ delay: reduced ? 0 : 0.3, duration: reduced ? 0 : 0.34, ease: [0.15, 1.4, 0.4, 1] }}
        className="flex flex-col items-center"
      >
        <div
          className="font-mono tnum"
          style={{
            fontSize: big ? 108 : 84,
            fontWeight: 700,
            lineHeight: 0.95,
            color: 'var(--signal)',
          }}
        >
          {days}
        </div>
        <div
          className="font-mono mt-1"
          style={{ fontSize: 11, letterSpacing: '0.34em', color: 'var(--signal)' }}
        >
          DAY RUN
        </div>
        <div
          className="font-display mt-4"
          style={{ fontSize: big ? 40 : 32, color: 'var(--bone-0)', letterSpacing: '-0.02em' }}
        >
          {big ? 'A hundred days' : 'A month unbroken'}
        </div>
        <p
          className="text-body-sm mt-3 max-w-[42ch] leading-relaxed"
          style={{ color: 'var(--bone-2)' }}
        >
          {big
            ? 'Kept through travel, gigs and everything else. This is the rarest thing the app records.'
            : 'Thirty days of showing up. The freezes are still there when you need them.'}
        </p>
      </motion.div>
    </TakeoverShell>
  );
});

// ---------------------------------------------------------------------------

export const LevelTakeover = memo(function LevelTakeover({
  standing,
  current,
  prestige,
  nextRank,
  onDismiss,
}: {
  /** The crossing being celebrated — supplies the rank, level and sigil. */
  standing: Standing | null;
  /**
   * Standing as it is NOW, which supplies the XP figure and the meter.
   *
   * Two objects rather than one because a crossing is a *boundary*: the standing
   * captured at the moment level 60 was reached says 8,673 XP, while the day that
   * reached it actually banked 8,806. Showing the boundary would quietly understate
   * the total on the one screen dedicated to celebrating it.
   */
  current: Standing | null;
  /** True when this crossing completed a whole 60-level cycle. */
  prestige: boolean;
  /** Who you become next, or null at the end of a cycle. */
  nextRank: string | null;
  onDismiss: () => void;
}) {
  const reduced = useReducedMotion();
  const mid = Math.floor(BANNER_ROWS / 2);

  return (
    <AnimatePresence>
      {standing && (
        <motion.div
          className="fixed inset-0 z-[70] grid place-items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduced ? 0 : 0.18 }}
          // Dismissible by anything at all — it must never stand between you and
          // the next thing you meant to do.
          onClick={onDismiss}
          style={{ background: 'rgba(8, 8, 7, 0.88)', backdropFilter: 'blur(3px)' }}
        >
          <motion.div
            // Everything stacks on one axis. Previously the sigil and the name were
            // centred as a pair, which pushed the name visibly off-centre.
            className="relative flex flex-col items-center text-center px-8"
            initial={{ scale: reduced ? 1 : 0.94 }}
            animate={{ scale: 1 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.2, 0.9, 0.2, 1] }}
          >
            {/* The banner assembles row by row, like a sprite being drawn in. */}
            <div className="flex flex-col items-center gap-[3px] mb-7">
              {Array.from({ length: BANNER_ROWS }, (_, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, scaleX: reduced ? 1 : 0.15 }}
                  animate={{ opacity: 1, scaleX: 1 }}
                  transition={{
                    duration: reduced ? 0 : 0.16,
                    delay: reduced ? 0 : i * 0.045,
                    ease: [0.2, 0.9, 0.2, 1],
                  }}
                  style={{
                    height: BANNER_BAR_H,
                    width: BANNER_MAX_W - Math.abs(i - mid) * BANNER_STEP,
                    background: i === mid ? 'var(--signal-bright)' : 'var(--signal)',
                  }}
                />
              ))}
            </div>

            {/* Burst behind the sigil, keyed so each level fires its own. */}
            <div className="relative">
              <PixelBurst
                seed={standing.prestige * 100 + standing.level}
                count={prestige ? 44 : 28}
                spread={prestige ? 190 : 140}
                size={prestige ? 8 : 6}
                duration={prestige ? 1.3 : 0.9}
              />
              <motion.div
                initial={{ scale: reduced ? 1 : 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{
                  delay: reduced ? 0 : 0.3,
                  duration: reduced ? 0 : 0.34,
                  ease: [0.15, 1.4, 0.4, 1],
                }}
              >
                <Sigil
                  form={standing.sigilForm}
                  pips={standing.sigilPips}
                  size={prestige ? 84 : 68}
                />
              </motion.div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: reduced ? 0 : 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: reduced ? 0 : 0.42, duration: reduced ? 0 : 0.22 }}
              className="flex flex-col items-center"
            >
              <div
                className="font-mono mt-5 mb-2"
                style={{ fontSize: 11, letterSpacing: '0.34em', color: 'var(--signal)' }}
              >
                {prestige ? 'PRESTIGE' : 'LEVEL UP'}
              </div>

              <div
                className="font-display"
                style={{
                  fontSize: prestige ? 52 : 44,
                  color: 'var(--bone-0)',
                  lineHeight: 1.02,
                  letterSpacing: '-0.025em',
                }}
              >
                {standing.rank}
              </div>

              <div
                className="font-mono tnum mt-2"
                style={{ fontSize: 12, letterSpacing: '0.12em', color: 'var(--bone-2)' }}
              >
                LEVEL {standing.level}
                {standing.prestige > 0 && ` · CYCLE ${standing.prestige + 1}`}
              </div>

              {prestige && (
                <p
                  className="text-body-sm mx-auto max-w-[44ch] leading-relaxed mt-4"
                  style={{ color: 'var(--bone-2)' }}
                >
                  Sixty levels done. The badge changes and the ranks begin again — your
                  lifetime total keeps climbing.
                </p>
              )}

              {/* Where you are and where you're headed. A moment that only shouts
                  tells you nothing you didn't already know. */}
              <div className="mt-6 w-[300px]">
                <PixelMeter
                  value={(current ?? standing).levelProgress}
                  segments={30}
                  height={9}
                  title={`${(current ?? standing).intoLevel} of ${(current ?? standing).levelCost} XP into level ${(current ?? standing).level}`}
                />
                <div className="flex items-baseline justify-between mt-2">
                  <span
                    className="font-mono tnum"
                    style={{ fontSize: 11, color: 'var(--bone-1)', fontWeight: 700 }}
                  >
                    {(current ?? standing).totalXp.toLocaleString()} XP
                  </span>
                  <span className="font-mono tnum" style={{ fontSize: 10, color: 'var(--bone-3)' }}>
                    {nextRank
                      ? `NEXT · ${nextRank.toUpperCase()}`
                      : 'NEXT · PRESTIGE'}
                  </span>
                </div>
              </div>

              <div
                className="font-mono mt-7"
                style={{ fontSize: 10, letterSpacing: '0.16em', color: 'var(--bone-3)' }}
              >
                CLICK ANYWHERE TO CONTINUE
              </div>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

import { useReducedMotion } from 'framer-motion';
import type { Transition, Variants } from 'framer-motion';

// ============================================================================
// Motion vocabulary
//
// One shared set of curves and variants so the whole app moves the same way.
// Three principles, applied everywhere:
//
//   1. ENTRANCES EASE OUT, EXITS GO FAST. Something arriving should decelerate
//      into place; something leaving should get out of the way. Symmetric
//      timing makes dismissal feel sluggish.
//
//   2. PHYSICAL, NOT TIMED, WHERE THINGS ARE DRAGGED OR SETTLE. Blocks, dials
//      and toggles use springs — they have mass. Fades and slides use duration.
//
//   3. SHORT. Nothing structural runs past ~320ms. If a transition is
//      noticeable as a duration rather than as a response, it is too slow.
//
// IMPORTANT: prefers-reduced-motion is handled here in JS. The CSS media query
// in index.css cannot touch Framer Motion's inline transforms — that was a real
// gap, not a theoretical one. Every hook below collapses to an instant, opacity-
// only change when the user has asked for reduced motion.
// ============================================================================

/** Fast-out-settle. The house entrance curve. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];
/** Symmetric, for things that move between two known states. */
export const EASE_INOUT: [number, number, number, number] = [0.65, 0, 0.35, 1];
/** Tight and responsive, for hover/press feedback. */
export const EASE_SNAP: [number, number, number, number] = [0.2, 0.7, 0.2, 1];
/** Accelerating — only for exits, which should get out of the way. */
export const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];

/** Things with mass: blocks being dragged, dial needles, toggles. */
export const SPRING_SETTLE: Transition = {
  type: 'spring',
  stiffness: 320,
  damping: 30,
  mass: 0.9,
};

/** Snappier spring for small controls. */
export const SPRING_TAP: Transition = {
  type: 'spring',
  stiffness: 460,
  damping: 26,
};

export const DUR = {
  instant: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.32,
} as const;

/**
 * The stagger interval for lists. Deliberately small: at 60ms a twelve-item list
 * takes almost a second to finish arriving, which reads as slow. 22ms reads as
 * one gesture with texture.
 */
export const STAGGER = 0.022;

/** Cap total stagger so a long list never crawls. */
export function staggerDelay(index: number, max = 0.26): number {
  return Math.min(index * STAGGER, max);
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Entrance for a panel or section: rises a few pixels and fades.
 * Reduced motion: fades only, no transform.
 */
export function usePanelMotion(delay = 0) {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: DUR.fast, delay: 0 },
    };
  }
  return {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: DUR.slow, ease: EASE_OUT, delay },
  };
}

/**
 * A view swapping in. Direction is the sign of travel — +1 for "later",
 * -1 for "earlier" — so stepping through days moves the content the way the
 * date is moving. That directionality is what makes navigation feel spatial
 * rather than like a slideshow.
 *
 * ENTRANCE ONLY, deliberately. Two other approaches were tried and both are
 * worse for full-height views:
 *
 *   • Cross-fade (AnimatePresence default): the outgoing dial and intake stay
 *     painted underneath the incoming grid, so you see a double exposure.
 *   • mode="wait": no ghosting, but it holds an empty region while the old view
 *     leaves and the new one mounts and loads its days — a visible blank gap on
 *     every switch.
 *
 * Letting the old view unmount immediately and animating only the arrival gives
 * neither problem, and is what the result actually needs to feel snappy: the new
 * content is on screen in one frame and settles over 240ms.
 */
export function useViewMotion(direction: number) {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      transition: { duration: DUR.instant },
    };
  }
  const offset = 14 * (direction === 0 ? 0 : direction);
  return {
    initial: { opacity: 0, x: offset },
    animate: { opacity: 1, x: 0 },
    transition: { duration: DUR.base, ease: EASE_OUT },
  };
}

/** Row/chip entrance inside a list, staggered by index. */
export function useRowMotion(index: number) {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: DUR.fast },
    };
  }
  return {
    initial: { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, x: 10 },
    transition: { ...SPRING_SETTLE, delay: staggerDelay(index) },
  };
}

/** Modal card: scales up a hair as it fades in, drops away quickly. */
export function useModalMotion() {
  const reduced = useReducedMotion();
  if (reduced) {
    return {
      overlay: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: DUR.instant },
      },
      card: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: { duration: DUR.instant },
      },
    };
  }
  return {
    overlay: {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: DUR.fast, ease: EASE_OUT },
    },
    card: {
      initial: { opacity: 0, y: 10, scale: 0.985 },
      animate: { opacity: 1, y: 0, scale: 1 },
      // Springs in, but accelerates out — a dismissal should feel like it's
      // getting out of your way, not easing politely.
      exit: {
        opacity: 0,
        y: 6,
        scale: 0.99,
        transition: { duration: DUR.instant, ease: EASE_IN },
      },
      transition: SPRING_SETTLE,
    },
  };
}

/** Whether to run decorative/ambient animation at all. */
export function useAmbient(): boolean {
  return !useReducedMotion();
}

/**
 * Collapsible region. Height animation is the one place a longer duration is
 * warranted — the eye tracks the edge, and snapping it looks broken.
 */
export const COLLAPSE: Variants = {
  closed: { height: 0, opacity: 0 },
  open: { height: 'auto', opacity: 1 },
};

export const COLLAPSE_TRANSITION: Transition = {
  duration: DUR.base,
  ease: EASE_OUT,
};

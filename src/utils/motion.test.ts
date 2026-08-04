import { describe, it, expect } from 'vitest';
import { DUR, EASE_OUT, STAGGER, staggerDelay } from './motion';

// The hooks themselves need a renderer and a rAF loop, neither of which this suite has.
// What is testable here is the vocabulary they share — and the two numeric invariants the
// house style actually rests on, both of which have been stated in prose until now.

describe('the motion vocabulary', () => {
  it('keeps every structural duration under the stated ceiling', () => {
    // Principle 3 in motion.ts: "Nothing structural runs past ~320ms. If a transition is
    // noticeable as a duration rather than as a response, it is too slow."
    for (const [name, value] of Object.entries(DUR)) {
      expect(value, name).toBeGreaterThan(0);
      expect(value, name).toBeLessThanOrEqual(0.32);
    }
  });

  it('orders the durations, so the names mean something', () => {
    expect(DUR.instant).toBeLessThan(DUR.fast);
    expect(DUR.fast).toBeLessThan(DUR.base);
    expect(DUR.base).toBeLessThan(DUR.slow);
  });

  it('caps the total stagger so a long list never crawls', () => {
    // A twelve-item list at 60ms takes almost a second to finish arriving, which reads as
    // slow rather than as texture. The cap is what stops that at any length.
    expect(staggerDelay(0)).toBe(0);
    expect(staggerDelay(1)).toBeCloseTo(STAGGER, 5);
    expect(staggerDelay(500)).toBeLessThanOrEqual(0.26);
    expect(staggerDelay(500)).toBe(staggerDelay(1000));
  });

  it('uses an easing curve that does not overshoot', () => {
    // Load-bearing for the meters. A spring overshoots, and an overshooting meter
    // misreports the figure for ~150ms — this codebase is careful that a displayed number
    // never disagrees with the stored one, so the fill curve has to settle, not bounce.
    const [, y1, , y2] = EASE_OUT;
    expect(y1).toBeLessThanOrEqual(1);
    expect(y2).toBeLessThanOrEqual(1);
  });
});

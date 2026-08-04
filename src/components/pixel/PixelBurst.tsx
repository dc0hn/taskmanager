import { memo, useMemo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

// ============================================================================
// PixelBurst — square particles thrown outward from a point
//
// The most straightforwardly arcade thing in the app, and it costs nothing: a few
// dozen absolutely-positioned divs with no border radius, animated by transform
// and opacity only. No canvas, no sprite sheet, no asset.
//
// Deterministic rather than random. Same level-up, same burst — which means it can
// be looked at twice while tuning it, and it never produces an unlucky frame where
// every particle happens to go the same way. The scatter comes from stepping the
// angle by a value coprime with the count, so the ring fills evenly at any size.
// ============================================================================

interface Props {
  /** Particle count. */
  count?: number;
  /** How far the furthest particle travels, in CSS pixels. */
  spread?: number;
  /** Particle edge length. */
  size?: number;
  /** Seconds. */
  duration?: number;
  colors?: string[];
  /** Changes to this restart the burst. */
  seed?: number;
}

function PixelBurst({
  count = 28,
  spread = 130,
  size = 6,
  duration = 0.9,
  colors = ['var(--signal)', 'var(--signal-bright)', 'var(--bone-0)'],
  seed = 0,
}: Props) {
  const reduced = useReducedMotion();

  const particles = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        // 7 and 13 are coprime with typical counts, so successive particles land on
        // opposite sides of the ring instead of marching round it in order.
        const angle = ((i * 137.508) % 360) * (Math.PI / 180);
        const reach = spread * (0.55 + ((i * 7) % 10) / 22);
        return {
          x: Math.cos(angle) * reach,
          y: Math.sin(angle) * reach,
          color: colors[(i + seed) % colors.length],
          // Vary the size a little so the burst has grain rather than looking
          // stamped from one shape.
          px: size - ((i * 13) % 3),
          delay: ((i * 3) % 7) * 0.012,
        };
      }),
    [count, spread, size, colors, seed]
  );

  // A burst is pure motion. With motion switched off there is nothing left to show,
  // and flashing a static ring of squares would be worse than nothing.
  if (reduced) return null;

  return (
    <div className="absolute inset-0 grid place-items-center pointer-events-none" aria-hidden>
      <div className="relative">
        {particles.map((p, i) => (
          <motion.span
            key={`${seed}-${i}`}
            className="absolute"
            style={{
              width: p.px,
              height: p.px,
              background: p.color,
              left: 0,
              top: 0,
              borderRadius: 0,
            }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.4 }}
            transition={{
              duration,
              delay: p.delay,
              // Fast out, long tail — the shape of something thrown.
              ease: [0.15, 0.75, 0.3, 1],
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default memo(PixelBurst);

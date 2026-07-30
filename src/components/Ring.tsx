import { memo } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { ringFill } from '../month';

// ============================================================================
// Ring — a completion gauge.
//
// One instrument face, three sizes. The arc clamps at full but the figure beside
// it tells the truth: a month at 118% draws a complete ring and says 118%, since
// hiding overachievement would make two very different months read identically.
// ============================================================================

interface Props {
  /** done ÷ target. May exceed 1. */
  ratio: number;
  size?: number;
  /** Ring colour. Defaults to the amber signal. */
  accent?: string;
  /** Centre label. Omit for a bare gauge. */
  label?: string;
  /** Drawn with a lighter arc, for a month still in progress. */
  provisional?: boolean;
}

function Ring({ ratio, size = 64, accent, label, provisional = false }: Props) {
  const reduced = useReducedMotion() ?? false;
  const fill = ringFill(ratio);
  const complete = ratio >= 1;
  const stroke = accent ?? (complete ? 'var(--good)' : 'var(--signal)');

  const cx = size / 2;
  const cy = size / 2;
  const width = Math.max(3, size * 0.075);
  const r = cx - width / 2 - 1;
  const circumference = 2 * Math.PI * r;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="block">
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="rgba(245,242,236,0.07)"
          strokeWidth={width}
        />
        <motion.circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth={width}
          strokeLinecap="butt"
          strokeDasharray={circumference}
          transform={`rotate(-90 ${cx} ${cy})`}
          initial={false}
          animate={{ strokeDashoffset: circumference * (1 - fill) }}
          transition={
            reduced ? { duration: 0 } : { type: 'spring', stiffness: 90, damping: 26 }
          }
          style={provisional ? { opacity: 0.55 } : undefined}
        />
      </svg>
      {label != null && (
        <div className="absolute inset-0 grid place-items-center pointer-events-none">
          <span
            className="font-display tnum leading-none"
            style={{
              fontSize: Math.max(10, size * 0.28),
              color: complete ? 'var(--good)' : 'var(--bone-0)',
            }}
          >
            {label}
          </span>
        </div>
      )}
    </div>
  );
}

export default memo(Ring);

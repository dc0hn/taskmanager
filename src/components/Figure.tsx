import { memo } from 'react';
import { useCountUp } from '../utils/motion';

// ============================================================================
// Figure — a number that counts to its new value
//
// One component so every figure in the app moves the same way, rather than each screen
// deciding for itself. Renders an empty span whose text is written by `useCountUp`, which
// is why there are no children here: the hook owns the content.
//
// `tnum` is not optional. Proportional digits change width as they roll, so a counter
// without tabular figures shoves whatever sits next to it back and forth for the whole
// tween — most visibly on the shop's balance, which has a label to its right.
// ============================================================================

interface Props {
  value: number;
  /** Override the tween length. Defaults to the house `DUR.slow`. */
  duration?: number;
  className?: string;
}

function Figure({ value, duration, className }: Props) {
  const ref = useCountUp(value, duration);
  return (
    <span
      ref={ref}
      className={className ? `tnum ${className}` : 'tnum'}
      // The settled value is the accessible one. A screen reader announcing every frame
      // of a count-up would be unusable, and the intermediate numbers are decoration.
      aria-label={value.toLocaleString()}
      role="text"
    />
  );
}

export default memo(Figure);

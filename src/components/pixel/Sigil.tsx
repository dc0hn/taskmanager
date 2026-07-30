import { memo } from 'react';

// ============================================================================
// Sigil — the rank badge, drawn on an 8×8 pixel grid
//
// Eight forms, cycled by prestige, with a pip added each time all eight have been
// worn. That is what makes the badge infinite without inventing new artwork
// forever: form = prestige % 8, pips = prestige / 8.
//
// Drawn as SVG rects on an integer grid rather than as a font glyph or an image.
// Three reasons: the CSP forbids external assets, a pixel grid stays crisp at any
// size where a bitmap would not, and the amber can come from the live CSS token so
// the badge is never a hardcoded colour drifting from the rest of the app.
// ============================================================================

/**
 * Each form is 8 rows of 8 characters. `#` is filled, `.` is empty.
 *
 * Two rules govern every one of them, learned by drawing a worse set first:
 *
 *   NO STROKE THINNER THAN TWO CELLS. The badge renders at 11px in the sidebar,
 *   which is 1.4 real pixels per cell — a one-cell line is sub-pixel and mushes
 *   into nothing. Everything here is at least two cells thick.
 *
 *   NEGATIVE SPACE IS THE SUBJECT. A filled shape at this size is a blob. What
 *   makes each mark identifiable is the hole in it, so every form has one.
 *
 * The order matters too: form 0 is what a new user wears, so the clearest mark
 * leads and the more elaborate ones arrive as prestige accrues. Distinct
 * silhouettes throughout — pointed, waisted, spiked, flat-topped, open-sided —
 * so two cycles are never confused even when the detail is lost.
 */
const FORMS: string[][] = [
  // 0 — diamond. Pointed silhouette, clean centre. The first badge anyone sees.
  [
    '...##...',
    '..####..',
    '.##..##.',
    '##....##',
    '##....##',
    '.##..##.',
    '..####..',
    '...##...',
  ],
  // 1 — sandglass. Waisted, and the most on-theme mark in an almanac.
  [
    '########',
    '##....##',
    '.##..##.',
    '..####..',
    '..####..',
    '.##..##.',
    '##....##',
    '########',
  ],
  // 2 — star. A ring with four cardinal spurs.
  [
    '...##...',
    '...##...',
    '.######.',
    '##....##',
    '##....##',
    '.######.',
    '...##...',
    '...##...',
  ],
  // 3 — seal. Square ring, the blockiest of the set.
  [
    '########',
    '########',
    '##....##',
    '##....##',
    '##....##',
    '##....##',
    '########',
    '########',
  ],
  // 4 — arc. Open on one side, so it reads even in silhouette.
  [
    '.######.',
    '##....##',
    '##......',
    '##......',
    '##......',
    '##......',
    '##....##',
    '.######.',
  ],
  // 5 — tower. Crenellated top, solid base.
  [
    '##.##.##',
    '##.##.##',
    '########',
    '##....##',
    '##....##',
    '##....##',
    '########',
    '########',
  ],
  // 6 — shield. Flat shoulders tapering to a point.
  [
    '########',
    '########',
    '##....##',
    '##....##',
    '.##..##.',
    '..####..',
    '...##...',
    '...##...',
  ],
  // 7 — orb. Round, with a core inside the ring.
  [
    '..####..',
    '.######.',
    '##....##',
    '##.##.##',
    '##.##.##',
    '##....##',
    '.######.',
    '..####..',
  ],
];

interface Props {
  /** 0..7. Values outside wrap, so a caller can pass a raw prestige count. */
  form: number;
  /** Marks beside the badge, one per completed pass through all eight forms. */
  pips?: number;
  /** Rendered edge length in CSS pixels. */
  size?: number;
  color?: string;
  /** Dimmer secondary fill behind the shape, for depth. */
  shadow?: boolean;
  className?: string;
  title?: string;
}

function Sigil({
  form,
  pips = 0,
  size = 32,
  color = 'var(--signal)',
  shadow = true,
  className,
  title,
}: Props) {
  const grid = FORMS[((form % FORMS.length) + FORMS.length) % FORMS.length];
  const cells: { x: number; y: number }[] = [];
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') cells.push({ x, y });
    });
  });

  // Pips sit in a column to the right, so the badge box grows predictably rather
  // than the sigil shrinking as prestige accrues.
  const pipCount = Math.max(0, Math.min(pips, 6));
  const width = 8 + (pipCount > 0 ? 3 : 0);

  return (
    <svg
      width={(size * width) / 8}
      height={size}
      viewBox={`0 0 ${width} 8`}
      // Integer grid: never smooth it.
      shapeRendering="crispEdges"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      {shadow &&
        cells.map(({ x, y }) => (
          <rect key={`s${x}-${y}`} x={x} y={y + 0.5} width={1} height={1} fill={color} opacity={0.22} />
        ))}
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
      {Array.from({ length: pipCount }, (_, i) => (
        <rect key={`p${i}`} x={9} y={i * 1.5} width={1} height={1} fill={color} opacity={0.85} />
      ))}
    </svg>
  );
}

export default memo(Sigil);

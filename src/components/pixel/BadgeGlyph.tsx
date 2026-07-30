import { memo } from 'react';

// ============================================================================
// BadgeGlyph — one 8×8 pixel mark per badge
//
// The shelf previously reused the eight rank sigils across twenty-six badges, so
// several tiles wore the same mark and the eye stopped distinguishing them. These
// are drawn per badge instead: a sunrise for Dawn Patrol, a dumbbell for Heavy
// Lifter, a crescent for After Hours.
//
// They can carry finer detail than a rank sigil can. A sigil has to survive at 11px
// in the sidebar, which is 1.4 real pixels per cell; a badge glyph is only ever
// drawn at 22px or larger, where one cell is nearly three pixels and a single-cell
// line still reads.
//
// SVG rects on an integer grid, no external asset, colour from the live token.
// ============================================================================

const GLYPHS: Record<string, string[]> = {
  // ---- milestones ----
  'first-block': [
    '...##...',
    '...##...',
    '.#.##.#.',
    '..####..',
    '..####..',
    '.#.##.#.',
    '...##...',
    '...##...',
  ],
  'blocks-10': [
    '........',
    '########',
    '########',
    '........',
    '########',
    '########',
    '........',
    '........',
  ],
  'blocks-50': [
    '########',
    '########',
    '........',
    '########',
    '########',
    '........',
    '########',
    '########',
  ],
  'blocks-250': [
    '##.##.##',
    '##.##.##',
    '........',
    '##.##.##',
    '##.##.##',
    '........',
    '##.##.##',
    '##.##.##',
  ],
  'level-5': [
    '........',
    '........',
    '...##...',
    '..####..',
    '.##..##.',
    '##....##',
    '........',
    '........',
  ],
  'level-10': [
    '...##...',
    '..####..',
    '.##..##.',
    '##....##',
    '...##...',
    '..####..',
    '.##..##.',
    '##....##',
  ],
  'level-25': [
    '..####..',
    '.##..##.',
    '........',
    '..####..',
    '.##..##.',
    '........',
    '..####..',
    '.##..##.',
  ],
  // A ring left open at the bottom: a cycle closing.
  'prestige-1': [
    '..####..',
    '.##..##.',
    '##....##',
    '##....##',
    '##....##',
    '##....##',
    '.##..##.',
    '..#..#..',
  ],
  // Ascending staircases for the three run lengths.
  'streak-7': [
    '........',
    '........',
    '.....##.',
    '.....##.',
    '..##.##.',
    '..##.##.',
    '##.##.##',
    '##.##.##',
  ],
  'streak-30': [
    '......##',
    '......##',
    '....####',
    '....####',
    '..######',
    '..######',
    '########',
    '########',
  ],
  'streak-100': [
    '#.#..#.#',
    '.######.',
    '########',
    '########',
    '########',
    '########',
    '########',
    '########',
  ],

  // ---- discoveries ----
  // Sun above a horizon.
  'early-bird': [
    '...##...',
    '..####..',
    '.######.',
    '..####..',
    '...##...',
    '........',
    '########',
    '########',
  ],
  // Lower sun with rays: earlier still.
  'dawn-patrol': [
    '#..##..#',
    '.#.##.#.',
    '...##...',
    '..####..',
    '.######.',
    '........',
    '########',
    '########',
  ],
  // Crescent.
  'night-owl': [
    '..####..',
    '.##...#.',
    '##......',
    '##......',
    '##......',
    '##......',
    '.##...#.',
    '..####..',
  ],
  'flawless': [
    '........',
    '......##',
    '.....##.',
    '....##..',
    '##.##...',
    '.####...',
    '..##....',
    '........',
  ],
  // A broom.
  'clean-sweep': [
    '.....##.',
    '....##..',
    '...##...',
    '..##....',
    '.######.',
    '########',
    '##.##.##',
    '#..##..#',
  ],
  // A pin, for the thing that kept moving until it didn't.
  finally: [
    '..####..',
    '.##..##.',
    '##....##',
    '##....##',
    '.##..##.',
    '..####..',
    '...##...',
    '...##...',
  ],
  'deep-diver': [
    '...##...',
    '...##...',
    '...##...',
    '...##...',
    '##.##.##',
    '.######.',
    '..####..',
    '...##...',
  ],
  'on-a-roll': [
    '........',
    '##...##.',
    '.##...##',
    '..##...#',
    '..##...#',
    '.##...##',
    '##...##.',
    '........',
  ],
  // Three columns in one frame: three categories in one day.
  'full-spread': [
    '########',
    '##.##.##',
    '##.##.##',
    '##.##.##',
    '##.##.##',
    '##.##.##',
    '##.##.##',
    '########',
  ],
  // Rising again from a base.
  comeback: [
    '...##...',
    '..####..',
    '.##..##.',
    '##....##',
    '...##...',
    '...##...',
    '########',
    '########',
  ],

  // ---- feats ----
  'heavy-lifter': [
    '........',
    '##....##',
    '##....##',
    '########',
    '########',
    '##....##',
    '##....##',
    '........',
  ],
  'focus-marathon': [
    '########',
    '.##..##.',
    '..####..',
    '...##...',
    '...##...',
    '..####..',
    '.##..##.',
    '########',
  ],
  // A struck tally.
  'weekday-five': [
    '........',
    '#.#.#.#.',
    '#.#.#.#.',
    '########',
    '#.#.#.#.',
    '#.#.#.#.',
    '........',
    '........',
  ],
  'big-day': [
    '...##...',
    '#..##..#',
    '.#####..',
    '.######.',
    '.######.',
    '.#####..',
    '#..##..#',
    '...##...',
  ],
  // A mountain on solid ground.
  'hundred-days-kept': [
    '........',
    '........',
    '...##...',
    '..####..',
    '.##..##.',
    '##....##',
    '########',
    '########',
  ],
};

/** Drawn when a badge has no glyph of its own — should never appear. */
const FALLBACK = [
  '########',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '##....##',
  '########',
];

interface Props {
  badgeId: string;
  size?: number;
  color?: string;
  className?: string;
  title?: string;
}

function BadgeGlyph({ badgeId, size = 22, color = 'var(--signal)', className, title }: Props) {
  const grid = GLYPHS[badgeId] ?? FALLBACK;
  const cells: { x: number; y: number }[] = [];
  grid.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#') cells.push({ x, y });
    });
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 8 8"
      shapeRendering="crispEdges"
      className={className}
      role={title ? 'img' : 'presentation'}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      {cells.map(({ x, y }) => (
        <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={color} />
      ))}
    </svg>
  );
}

export default memo(BadgeGlyph);

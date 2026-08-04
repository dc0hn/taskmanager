// ============================================================================
// The opening mark, and the order it is struck in.
//
// A data module rather than part of the component, for two reasons. Fast refresh only works
// when a file exports components alone, and the geometry wants testing without rendering
// anything — the shape is the one part of a visual that can be checked without looking at
// it.
// ============================================================================

/**
 * The mark. Eight rows of eight, `#` filled.
 *
 * The same diamond the rank sigil wears at level zero. Four concentric rings — the grid is
 * kept small and the SVG drawn large, so each cell is a chunky 28px rather than a fine one:
 * an 8-bit mark should read as few big cells, not many small ones.
 *
 * Strokes stay two cells thick, so nothing is sub-pixel at any size this is drawn at.
 *
 * Exported because the test derives its rings from THIS array rather than keeping a copy.
 * A second copy of a shape is the same hazard as a second copy of a threshold: it agrees
 * until someone edits one of them.
 */
export const MARK: string[] = [
  '...##...',
  '..####..',
  '.##..##.',
  '##....##',
  '##....##',
  '.##..##.',
  '..####..',
  '...##...',
];

/** Grid edge, so the geometry below never has to be told the size twice. */
export const GRID = MARK.length;

/**
 * Cells grouped into rings by distance from the centre, and struck a RING at a time.
 *
 * This is what makes the mark grow symmetrically, and getting it wrong is easy. Sorting the
 * 28 cells by distance and giving each its own step looks radial on paper, but equidistant
 * cells then fire one after another in whatever order the sort settled them — so the
 * diamond assembles lopsidedly, one cell at a time, and reads as a spiral rather than a
 * shape. Every cell the same distance out has to land on the same frame.
 *
 * The diamond falls into exactly six rings — 4 cells then five of 8 — so it grows as six
 * concentric pulses, each one symmetric about both axes.
 *
 * Distance is rounded before grouping: these are irrational lengths, and floating-point
 * equality would split a ring in two over the last bit of a mantissa.
 */
export const RINGS: { x: number; y: number }[][] = (() => {
  const centre = (GRID - 1) / 2;
  const byDistance = new Map<number, { x: number; y: number }[]>();
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) {
      if (MARK[y][x] !== '#') continue;
      const d = Math.round(Math.hypot(x - centre, y - centre) * 1000) / 1000;
      const ring = byDistance.get(d) ?? [];
      ring.push({ x, y });
      byDistance.set(d, ring);
    }
  }
  return [...byDistance.entries()].sort((a, b) => a[0] - b[0]).map(([, cells]) => cells);
})();

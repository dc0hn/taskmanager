import type { Block } from './types';

// ============================================================================
// Reflow — manual rearrangement that makes room instead of refusing
//
// Dropping a block on top of another used to be rejected outright. Now the day
// behaves like an ordered list: the destination opens up, and the slot you
// vacated closes behind you.
//
// Three rules, each chosen deliberately:
//
//   MINIMUM DISPLACEMENT. A pushed block moves only as far as it must to clear
//   the one being inserted, and the push cascades down the chain until there is
//   already room. Dropping a 45-minute block into an hour-long gap therefore
//   moves nothing at all — existing breathing room survives.
//
//   THE SOURCE GAP CLOSES, BUT ONLY WITHIN A RUN. Blocks that were back-to-back
//   with the one you picked up slide up to fill the hole. Blocks separated from
//   it by real empty time do NOT. This distinction is the whole ballgame: a
//   naive "pull everything after it upward" would yank a 2pm meeting to 9am the
//   moment you moved your morning work to the afternoon, which is obviously
//   wrong. Adjacency is what makes a run, and only runs compact.
//
//   COMPLETED AND PINNED BLOCKS ARE NEVER PUSHED. Completed work is history — it
//   happened then. Pinned work is a commitment you marked as fixed. A cascade
//   steps over both rather than displacing them; if the destination *itself* is
//   held by one, the move is refused and says which block held it.
//
// Auto blocks (the scheduler's breaks and shutdown) DO reflow. You cannot pick
// one up, but inserting work above one should carry it along, and the next build
// regenerates them where they belong.
//
// Everything here is pure and works on minutes-since-midnight, so it is testable
// without a DOM and cannot drift from the geometry the grid draws.
// ============================================================================

/**
 * How close two blocks must be to count as part of the same run.
 *
 * Equal to the grid's snap increment: the scheduler emits blocks exactly
 * back-to-back, but a hand-dragged block lands on a 5-minute boundary, and a
 * 5-minute sliver between two entries is not a deliberate gap.
 */
export const ADJACENCY_TOLERANCE = 5;

/**
 * The end of the day, in minutes since midnight. A hard ceiling on every cascade.
 *
 * There was no upper bound at all, and the consequence was worse than an off-by-one: a
 * cascade could push a block past 1440, and because the grid's visible window stretches
 * to cover the latest block end, the time axis grew past 24 hours. The hour labels then
 * read "… 10 PM, 11 PM, 12 PM, 1 PM …" — the afternoon appearing twice — because
 * `((h24 + 11) % 12) + 1` has no `% 24` in it.
 *
 * It also opened the door wider each time. Direct dragging clamps to the visible window,
 * but the window is derived from block ends, so one over-midnight block raised the clamp
 * and let the next drag go further still.
 *
 * A block ending exactly at 1440 is fine; that is midnight, and the day is over.
 */
export const DAY_END = 24 * 60;

export interface ReflowOutcome {
  /** False when nothing could be done; `blocks` is then the original array. */
  ok: boolean;
  blocks: Block[];
  /** Why it was refused, or a note about what the move disturbed. */
  message?: string;
  /** Ids of blocks the cascade displaced, excluding the one you moved. */
  movedIds: string[];
  /** How far past the end of the working day the schedule now runs. */
  spillMinutes: number;
}

/** Work that a cascade must route around rather than displace. */
export function isImmovable(b: Block): boolean {
  return b.completed === true || b.pinned === true;
}

const byStart = (a: { start: number }, b: { start: number }) => a.start - b.start;
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
  !(aEnd <= bStart || aStart >= bEnd);

/**
 * The earliest time at or after `from` where a span of `duration` fits without
 * touching any obstacle. Advances past each obstacle it runs into and rechecks,
 * because clearing one can land it on the next.
 */
function firstFreeFrom(
  from: number,
  duration: number,
  obstacles: { start: number; end: number }[]
): number {
  let at = from;
  // Bounded: each pass either settles or steps past one more obstacle.
  for (let guard = 0; guard <= obstacles.length; guard++) {
    const hit = obstacles.find((o) => overlaps(at, at + duration, o.start, o.end));
    if (!hit) return at;
    at = hit.end;
  }
  return at;
}

/**
 * Re-place everything around a slot being occupied at [start, end).
 *
 * Deliberately NOT a running push-chain. An earlier version walked the day in
 * order carrying a cursor, and it would shove a block straight into a pinned one
 * further down because it had no knowledge of what lay below at the moment it
 * decided the shift. Treating immovable work — and the inserted slot itself — as
 * fixed obstacles, then placing each movable block into the first free space at
 * or after where it already was, is order-independent and cannot overlap.
 *
 * Minimum displacement falls out of it: a block whose own position is already
 * free simply stays there.
 */
function placeAround(
  others: Block[],
  start: number,
  end: number
): {
  blocks: Block[];
  movedIds: string[];
  blockedBy: Block | null;
  /** Set when the cascade could not fit this block before midnight. */
  overflowed: Block | null;
} {
  const immovables = others.filter(isImmovable);

  // The destination is unusable if fixed work already holds it.
  const blockedBy =
    immovables.find((o) => overlaps(start, end, o.start, o.end)) ?? null;
  if (blockedBy) return { blocks: others, movedIds: [], blockedBy, overflowed: null };

  const obstacles = [
    { start, end },
    ...immovables.map((o) => ({ start: o.start, end: o.end })),
  ].sort(byStart);

  const out: Block[] = [...immovables];
  const movedIds: string[] = [];
  let cursor = Number.NEGATIVE_INFINITY;

  for (const b of [...others].filter((x) => !isImmovable(x)).sort(byStart)) {
    const duration = b.end - b.start;
    // `cursor` keeps the movable blocks in their existing order relative to one
    // another; obstacles handle everything fixed.
    const desired = Math.max(b.start, cursor);
    const at = firstFreeFrom(desired, duration, obstacles);
    // Refuse the whole move rather than let one block spill into tomorrow. Partially
    // applying a cascade would leave the day in a state the user never asked for and
    // cannot see the shape of.
    if (at + duration > DAY_END) {
      return { blocks: others, movedIds: [], blockedBy: null, overflowed: b };
    }
    if (at !== b.start) movedIds.push(b.id);
    out.push({ ...b, start: at, end: at + duration });
    cursor = at + duration;
  }

  return { blocks: out, movedIds, blockedBy: null, overflowed: null };
}

/**
 * Slide the run that followed a vacated slot upward to fill it.
 *
 * Walks forward from the hole while each block was adjacent to the previous
 * one's ORIGINAL position — that test is what keeps distant, deliberately
 * separated blocks where the user put them. Stops at the first real gap, at any
 * immovable block, or once the hole is fully absorbed.
 */
function closeGap(
  blocks: Block[],
  holeStart: number,
  holeEnd: number
): { blocks: Block[]; movedIds: string[] } {
  const hole = holeEnd - holeStart;
  if (hole <= 0) return { blocks, movedIds: [] };

  const sorted = [...blocks].sort(byStart);
  const out: Block[] = [];
  const movedIds: string[] = [];

  let prevOriginalEnd = holeEnd;
  let prevNewEnd = holeStart;
  let runLive = true;

  for (const b of sorted) {
    if (b.start < holeEnd) {
      // Above the hole — untouched.
      out.push(b);
      continue;
    }
    if (!runLive) {
      out.push(b);
      continue;
    }
    // A real gap before this block means the run ended; everything from here
    // down was deliberately placed apart and stays.
    if (b.start - prevOriginalEnd > ADJACENCY_TOLERANCE || isImmovable(b)) {
      out.push(b);
      runLive = false;
      continue;
    }

    const shift = Math.min(hole, b.start - prevNewEnd);
    if (shift <= 0) {
      out.push(b);
      runLive = false;
      continue;
    }

    const originalEnd = b.end;
    out.push({ ...b, start: b.start - shift, end: b.end - shift });
    movedIds.push(b.id);
    prevOriginalEnd = originalEnd;
    prevNewEnd = b.end - shift;
  }

  return { blocks: out, movedIds };
}

function spillPast(blocks: Block[], workingEnd: number): number {
  let latest = workingEnd;
  for (const b of blocks) if (b.end > latest) latest = b.end;
  return latest - workingEnd;
}

/** Says which block the day ran out of room for, rather than just that it did. */
function overflowMessage(b: Block): string {
  return `Can\u2019t make room there \u2014 \u201c${b.title}\u201d would be pushed past midnight.`;
}

/** The inserted block itself does not fit before midnight. */
function pastMidnightMessage(): string {
  return 'That would run past midnight. Shorten it or move it earlier.';
}

/** Names the fixed block that prevented a move, and why it is fixed. */
function blockedMessage(b: Block): string {
  const why = b.completed ? 'already done' : 'pinned';
  return `Can\u2019t make room there \u2014 \u201c${b.title}\u201d is ${why}.`;
}

/**
 * Which part of the old slot is genuinely free once the block sits at its new
 * position.
 *
 * Getting this wrong produced an overlap: a shrink kept the block's start, so
 * treating the whole old slot as vacated let the run behind it slide up into
 * space the block still occupied. Only the tail below the new end is free.
 */
function freedInterval(
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number
): { start: number; end: number } | null {
  const stillOverlapping = !(newEnd <= oldStart || newStart >= oldEnd);
  if (!stillOverlapping) {
    // Moved clear of its old slot: all of it is free.
    return { start: oldStart, end: oldEnd };
  }
  // Grew or moved down within its own slot: nothing downstream frees up.
  if (newEnd >= oldEnd) return null;
  return { start: newEnd, end: oldEnd };
}

/**
 * Move or resize a block already on this day, making room and closing up behind.
 */
export function reflowPlace(
  blocks: Block[],
  id: string,
  start: number,
  end: number,
  workingEnd: number
): ReflowOutcome {
  const target = blocks.find((b) => b.id === id);
  if (!target) {
    return { ok: false, blocks, movedIds: [], spillMinutes: 0 };
  }
  if (end <= start) {
    return {
      ok: false,
      blocks,
      message: 'A block needs to end after it starts.',
      movedIds: [],
      spillMinutes: 0,
    };
  }

  if (start < 0 || end > DAY_END) {
    return {
      ok: false,
      blocks,
      message: pastMidnightMessage(),
      movedIds: [],
      spillMinutes: 0,
    };
  }

  const others = blocks.filter((b) => b.id !== id);

  // 1) Make room at the destination.
  const pushed = placeAround(others, start, end);
  if (pushed.blockedBy) {
    return {
      ok: false,
      blocks,
      message: blockedMessage(pushed.blockedBy),
      movedIds: [],
      spillMinutes: 0,
    };
  }
  if (pushed.overflowed) {
    return {
      ok: false,
      blocks,
      message: overflowMessage(pushed.overflowed),
      movedIds: [],
      spillMinutes: 0,
    };
  }

  // 2) Close whatever the block actually vacated — which is not always the whole
  //    old slot; see freedInterval.
  const freed = freedInterval(target.start, target.end, start, end);
  const closed = freed
    ? closeGap(pushed.blocks, freed.start, freed.end)
    : { blocks: pushed.blocks, movedIds: [] as string[] };

  const placed = [...closed.blocks, { ...target, start, end }].sort(byStart);
  const movedIds = [...new Set([...pushed.movedIds, ...closed.movedIds])];

  return {
    ok: true,
    blocks: placed,
    movedIds,
    spillMinutes: Math.max(0, spillPast(placed, workingEnd)),
  };
}

/**
 * Land a block arriving from another day. Nothing is vacated here, so this only
 * makes room.
 */
export function reflowInsert(
  blocks: Block[],
  incoming: Block,
  workingEnd: number
): ReflowOutcome {
  if (incoming.start < 0 || incoming.end > DAY_END) {
    return {
      ok: false,
      blocks,
      message: pastMidnightMessage(),
      movedIds: [],
      spillMinutes: 0,
    };
  }

  const pushed = placeAround(blocks, incoming.start, incoming.end);
  if (pushed.overflowed) {
    return {
      ok: false,
      blocks,
      message: overflowMessage(pushed.overflowed),
      movedIds: [],
      spillMinutes: 0,
    };
  }
  if (pushed.blockedBy) {
    return {
      ok: false,
      blocks,
      message: blockedMessage(pushed.blockedBy),
      movedIds: [],
      spillMinutes: 0,
    };
  }
  const placed = [...pushed.blocks, incoming].sort(byStart);
  return {
    ok: true,
    blocks: placed,
    movedIds: pushed.movedIds,
    spillMinutes: Math.max(0, spillPast(placed, workingEnd)),
  };
}

/**
 * Close the hole left on the day a block departed from.
 */
export function reflowRemove(
  blocks: Block[],
  id: string,
  workingEnd: number
): ReflowOutcome {
  const target = blocks.find((b) => b.id === id);
  if (!target) return { ok: true, blocks, movedIds: [], spillMinutes: 0 };
  const rest = blocks.filter((b) => b.id !== id);
  const closed = closeGap(rest, target.start, target.end);
  return {
    ok: true,
    blocks: closed.blocks.sort(byStart),
    movedIds: closed.movedIds,
    spillMinutes: Math.max(0, spillPast(closed.blocks, workingEnd)),
  };
}

/** Human-readable note about what a successful reflow disturbed. */
export function describeReflow(
  outcome: ReflowOutcome,
  formatDuration: (m: number) => string
): string | null {
  if (!outcome.ok) return outcome.message ?? null;
  if (outcome.spillMinutes > 0) {
    const n = outcome.movedIds.length;
    return `Moved ${n} ${n === 1 ? 'entry' : 'entries'} to make room — the day now runs ${formatDuration(
      outcome.spillMinutes
    )} past your working hours.`;
  }
  return null;
}

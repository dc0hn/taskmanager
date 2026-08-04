import type { Block, Task } from './types';

// ============================================================================
// Clearing a day back to the intake
//
// For the moment the plan is wrong and rearranging it one block at a time is slower
// than starting again.
//
// Pure, and separated from the component for the usual reason: what this keeps is the
// entire safety of the operation, and a rule that lives inside a click handler is a
// rule nothing can assert.
// ============================================================================

export interface ClearResult {
  /** Blocks that stay on the day, in their original order. */
  kept: Block[];
  /** Blocks returned to the intake queue, as tasks. */
  returned: Task[];
  /** Pinned entries still outstanding — what the confirmation reports. */
  pinnedKept: number;
}

/**
 * Split a day's blocks into what stays and what goes back to the queue.
 *
 * THREE THINGS STAY, and only the first is obvious:
 *
 *   PINNED entries, which is the point. A pinned block is a commitment to a TIME — a
 *   meeting, a collection, a booking — and it is the one thing that must survive a
 *   button whose whole job is to move everything else. It leaves only through its own
 *   editor.
 *
 *   COMPLETED entries, because they are no longer plan, they are record. Returning one
 *   would not merely lose its position: reconciliation scores a day from its blocks and
 *   applies the DIFFERENCE, so the day's XP, its brass, its goal credits and any streak
 *   resting on it would all be taken back out. A button for redoing this afternoon must
 *   not be able to unearn this morning.
 *
 *   AUTO entries — breaks, the shutdown ritual — are DROPPED rather than returned. They
 *   are the scheduler's own bookkeeping and it writes fresh ones on the next build.
 *   Returning them would put "Break" in the intake as though it were work you had asked
 *   for, and every clear-and-rebuild would breed another one.
 */
export function clearToIntake(blocks: Block[]): ClearResult {
  const kept: Block[] = [];
  const returned: Task[] = [];
  let pinnedKept = 0;

  for (const block of blocks) {
    if (block.completed || block.pinned) {
      kept.push(block);
      if (block.pinned && !block.completed) pinnedKept++;
      continue;
    }
    if (block.auto) continue;
    returned.push(toTask(block));
  }

  return { kept, returned, pinnedKept };
}

/**
 * A scheduled block, back to being a thing with a length and no time.
 *
 * Every field the block was carrying comes with it. This is the same round trip the
 * rebuild does — and the same one that was silently dropping `notes`: a note that
 * survives rescheduling but not a clear would be a difference nobody could predict,
 * and it would only be noticed once the meeting link had already gone.
 */
function toTask(block: Block): Task {
  return {
    id: block.id,
    title: block.title,
    duration: block.end - block.start,
    category: block.category,
    priority: block.priority ?? 'normal',
    goalId: block.goalId,
    templateId: block.templateId,
    notes: block.notes,
    keepWhole: block.keepWhole,
  };
}

/** Whether a clear would move anything at all, for enabling the control. */
export function hasClearableBlocks(blocks: Block[]): boolean {
  return blocks.some((b) => !b.completed && !b.pinned && !b.auto);
}

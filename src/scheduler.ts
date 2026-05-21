import type { Block, Category, Task } from './types';

interface Interval {
  start: number;
  end: number;
}

const BREAK_AFTER_MIN = 90;
const BREAK_LEN = 15;

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function categoryRank(c: Category): number {
  // Lower = scheduled earlier when priority ties
  return { deep: 0, admin: 1, other: 2, break: 3 }[c];
}

function sortForFill(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const pa = a.priority === 'high' ? 0 : 1;
    const pb = b.priority === 'high' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    return b.duration - a.duration;
  });
}

function subtractInterval(intervals: Interval[], start: number, end: number): Interval[] {
  const out: Interval[] = [];
  for (const iv of intervals) {
    if (end <= iv.start || start >= iv.end) {
      out.push(iv);
      continue;
    }
    if (start > iv.start) out.push({ start: iv.start, end: Math.min(start, iv.end) });
    if (end < iv.end) out.push({ start: Math.max(end, iv.start), end: iv.end });
  }
  return out.filter((i) => i.end > i.start);
}

export interface ScheduleResult {
  blocks: Block[];
  overflow: Task[];
}

// Places only the tasks the caller supplies. Fixed-time tasks become anchors
// at their exact time; flexible tasks pack back-to-back into the gaps in
// chronological order. After ~90 minutes of cumulative work the scheduler
// will slot a 15-minute auto-break between two flex tasks, but ONLY if:
//   - the break fits inside the current free interval (no overlap with any
//     fixed-time task — those override the auto-break), AND
//   - there is still at least one more flex task waiting that fits after the
//     break (so breaks never trail at the end and never sit beside nothing).
export function buildSchedule(
  tasks: Task[],
  workingStart: number,
  workingEnd: number
): ScheduleResult {
  if (workingEnd <= workingStart) {
    return { blocks: [], overflow: tasks };
  }

  let free: Interval[] = [{ start: workingStart, end: workingEnd }];
  const anchors: Block[] = [];
  const overflow: Task[] = [];

  const fixed = tasks
    .filter((t) => t.fixedTime != null)
    .sort((a, b) => a.fixedTime! - b.fixedTime!);
  const flexible = tasks.filter((t) => t.fixedTime == null);

  for (const t of fixed) {
    const s = t.fixedTime!;
    const e = s + t.duration;
    const conflicts = anchors.some((a) => !(e <= a.start || s >= a.end));
    if (conflicts) {
      overflow.push(t);
      continue;
    }
    anchors.push({ id: t.id, title: t.title, start: s, end: e, category: t.category });
    free = subtractInterval(free, s, e);
  }

  const queue = sortForFill(flexible);
  const placed: Block[] = [];
  free.sort((a, b) => a.start - b.start);

  for (const iv of free) {
    let cursor = iv.start;
    let workSinceBreak = 0;

    while (cursor < iv.end && queue.length > 0) {
      // Time for an auto-break?
      if (workSinceBreak >= BREAK_AFTER_MIN) {
        const breakEnd = cursor + BREAK_LEN;
        const followUpFits =
          breakEnd <= iv.end &&
          queue.some((t) => t.duration <= iv.end - breakEnd);
        if (followUpFits) {
          placed.push({
            id: uid(),
            title: 'Break',
            start: cursor,
            end: breakEnd,
            category: 'break',
            auto: true,
          });
          cursor = breakEnd;
          workSinceBreak = 0;
          continue;
        }
        // No room for break+follow-up before the next fixed-time anchor —
        // the fixed-time task overrides. Skip the break and keep working.
        workSinceBreak = 0;
      }

      const remain = iv.end - cursor;
      const idx = queue.findIndex((t) => t.duration <= remain);
      if (idx === -1) break;
      const t = queue.splice(idx, 1)[0];
      placed.push({
        id: t.id,
        title: t.title,
        start: cursor,
        end: cursor + t.duration,
        category: t.category,
      });
      cursor += t.duration;
      if (t.category === 'break') {
        workSinceBreak = 0;
      } else {
        workSinceBreak += t.duration;
      }
    }
  }

  for (const t of queue) overflow.push(t);

  const allBlocks = [...anchors, ...placed].sort((a, b) => a.start - b.start);
  return { blocks: allBlocks, overflow };
}

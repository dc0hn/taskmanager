import type { Block, Category, Task } from './types';

interface Interval {
  start: number;
  end: number;
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

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export interface ScheduleResult {
  blocks: Block[];
  overflow: Task[];
}

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

  // 1) Fixed-time tasks become anchors
  const fixed = tasks.filter((t) => t.fixedTime != null);
  const flexible = tasks.filter((t) => t.fixedTime == null);
  const overflow: Task[] = [];

  // Sort fixed by start
  fixed.sort((a, b) => (a.fixedTime! - b.fixedTime!));

  for (const t of fixed) {
    const s = t.fixedTime!;
    const e = s + t.duration;
    // If completely outside working window, still place it (user asked) — extend visible.
    // Track overlap with existing anchors: if overlaps, push later to avoid double-booking? Spec says never double-book.
    const conflicts = anchors.some((a) => !(e <= a.start || s >= a.end));
    if (conflicts) {
      overflow.push(t);
      continue;
    }
    anchors.push({ id: uid(), title: t.title, start: s, end: e, category: t.category });
    free = subtractInterval(free, s, e);
  }

  // 2) Try to place a lunch anchor at noon if no break already there and it fits.
  const hasLunchAlready = anchors.some(
    (a) => a.category === 'break' && a.start <= 12 * 60 && a.end >= 12 * 60
  );
  if (!hasLunchAlready) {
    const lunchStart = 12 * 60;
    const lunchEnd = 13 * 60;
    if (lunchStart >= workingStart && lunchEnd <= workingEnd) {
      const fits = free.some((iv) => iv.start <= lunchStart && iv.end >= lunchEnd);
      if (fits) {
        anchors.push({
          id: uid(),
          title: 'Lunch',
          start: lunchStart,
          end: lunchEnd,
          category: 'break',
        });
        free = subtractInterval(free, lunchStart, lunchEnd);
      }
    }
  }

  // 3) Fill flexible tasks into free intervals
  const queue = sortForFill(flexible);
  const placed: Block[] = [];
  // Sort free intervals chronologically
  free.sort((a, b) => a.start - b.start);

  // Place across intervals in order
  for (const iv of free) {
    let cursor = iv.start;
    let workSinceBreak = 0;

    while (cursor < iv.end && queue.length > 0) {
      // Insert auto break if needed before next work task
      if (workSinceBreak >= 90) {
        const breakLen = Math.min(15, iv.end - cursor);
        if (breakLen >= 5) {
          placed.push({
            id: uid(),
            title: 'Short break',
            start: cursor,
            end: cursor + breakLen,
            category: 'break',
          });
          cursor += breakLen;
          workSinceBreak = 0;
          continue;
        } else {
          break;
        }
      }

      // Find first task that fits
      let idx = -1;
      for (let i = 0; i < queue.length; i++) {
        const remain = iv.end - cursor;
        if (queue[i].duration <= remain) {
          idx = i;
          break;
        }
      }
      if (idx === -1) {
        // No remaining task fits in this slot — move on
        break;
      }
      const t = queue.splice(idx, 1)[0];
      placed.push({
        id: uid(),
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

  // Anything left in queue is overflow
  for (const t of queue) overflow.push(t);

  const allBlocks = [...anchors, ...placed].sort((a, b) => a.start - b.start);
  return { blocks: allBlocks, overflow };
}

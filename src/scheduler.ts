import type { Block, Category, Task } from './types';

interface Interval {
  start: number;
  end: number;
}

// Tunables, derived from the practices in the README/research:
//   - Newport / ultradian research: cap focused blocks at ~90 min and recover.
//   - Mark & Gonzalez context-switch research: keep transitions cheap (buffers).
//   - GTD shutdown ritual: end the day with a planned close.
const BREAK_AFTER_MIN = 90; // auto-break trigger
const BREAK_LEN = 15;
const DEEP_SPLIT_THRESHOLD = 120; // longer deep tasks get chunked
const DEEP_CHUNK_MAX = 90; // each chunk no longer than this
const BUFFER_PRE = 10; // minutes reserved before a fixed-time anchor
const BUFFER_POST = 5; // minutes reserved after a fixed-time anchor
const SHUTDOWN_LEN = 15; // synthetic close-of-day admin block

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

// Lower = scheduled earlier when other keys tie. Deep first, then admin,
// then misc, then break — keeps same-category work batched together so the
// scheduler doesn't whipsaw between contexts (Mark & Gonzalez: each switch
// costs ~23 min of recovery cost).
function categoryRank(c: Category): number {
  return { deep: 0, admin: 1, other: 2, break: 3 }[c];
}

// Eat-the-frog + category batching + Parkinson's tight duration:
//   1. high-priority deep tasks lead the queue (Mark Twain / Eisenhower Q2)
//   2. then by category group, so same-category tasks cluster
//   3. then priority within category
//   4. then longer first — substantial work shouldn't be displaced by trivia
function sortFlexible(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    const aFrog = a.priority === 'high' && a.category === 'deep' ? 0 : 1;
    const bFrog = b.priority === 'high' && b.category === 'deep' ? 0 : 1;
    if (aFrog !== bFrog) return aFrog - bFrog;
    const ca = categoryRank(a.category);
    const cb = categoryRank(b.category);
    if (ca !== cb) return ca - cb;
    const pa = a.priority === 'high' ? 0 : 1;
    const pb = b.priority === 'high' ? 0 : 1;
    if (pa !== pb) return pa - pb;
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

// Split long deep tasks into chunks ≤ 90 min so each block stays within the
// ultradian focus envelope. The chunks fall back into the queue as separate
// flex tasks; the 90-min auto-break logic will naturally space them.
function splitLongDeep(tasks: Task[]): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (
      t.category === 'deep' &&
      t.fixedTime == null &&
      t.duration >= DEEP_SPLIT_THRESHOLD
    ) {
      const n = Math.ceil(t.duration / DEEP_CHUNK_MAX);
      const baseChunk = Math.ceil(t.duration / n / 5) * 5; // snap to 5
      let remaining = t.duration;
      for (let i = 0; i < n && remaining > 0; i++) {
        const dur = Math.min(baseChunk, remaining);
        if (dur < 15) break;
        out.push({
          ...t,
          id: `${t.id}-c${i + 1}`,
          title: `${t.title} (${i + 1}/${n})`,
          duration: dur,
        });
        remaining -= dur;
      }
    } else {
      out.push(t);
    }
  }
  return out;
}

export interface ScheduleResult {
  blocks: Block[];
  overflow: Task[];
}

// Build a one-day schedule out of the supplied tasks. Implements the practices
// laid out at the top of the file:
//   - eat-the-frog ordering for the morning queue
//   - frontloaded deep work (handled by sort)
//   - split long deep tasks at the 90-min ultradian boundary
//   - 15-min recovery break after every 90 min of sustained work
//   - transition buffer (10 min pre, 5 min post) around every fixed-time anchor
//   - synthetic shutdown ritual block in the last 15 min of the day
//   - Parkinson's: each task's duration is a hard ceiling
//   - fixed-time tasks always win their slot; conflicts overflow
export function buildSchedule(
  tasks: Task[],
  workingStart: number,
  workingEnd: number,
  preserved: Block[] = []
): ScheduleResult {
  if (workingEnd <= workingStart) {
    return { blocks: [], overflow: tasks };
  }

  let free: Interval[] = [{ start: workingStart, end: workingEnd }];
  const anchors: Block[] = [];
  const overflow: Task[] = [];

  // 0) Pre-existing blocks (kept from the prior schedule). These get no
  //    transition buffer — they were already laid out cleanly and we just
  //    need to schedule around them.
  for (const b of preserved) {
    anchors.push(b);
    free = subtractInterval(free, b.start, b.end);
  }

  // 1) Pre-process — split deep work that overshoots the focus envelope.
  const expanded = splitLongDeep(tasks);

  // 2) Place fixed-time anchors with transition buffers carved out of the
  //    surrounding free intervals so nothing schedules right against a
  //    meeting. Buffers are gaps, not blocks — invisible breathing room.
  const fixed = expanded
    .filter((t) => t.fixedTime != null)
    .sort((a, b) => a.fixedTime! - b.fixedTime!);
  const flexible = expanded.filter((t) => t.fixedTime == null);

  for (const t of fixed) {
    const s = t.fixedTime!;
    const e = s + t.duration;
    const conflicts = anchors.some((a) => !(e <= a.start || s >= a.end));
    if (conflicts) {
      overflow.push(t);
      continue;
    }
    anchors.push({ id: t.id, title: t.title, start: s, end: e, category: t.category });
    const bufStart = Math.max(workingStart, s - BUFFER_PRE);
    const bufEnd = Math.min(workingEnd, e + BUFFER_POST);
    free = subtractInterval(free, bufStart, bufEnd);
  }

  // 3) Shutdown ritual — reserve the last 15 min of the day so work doesn't
  //    bleed into evening. Skip on very short windows or when something is
  //    already scheduled there.
  const dayLen = workingEnd - workingStart;
  const shutdownStart = workingEnd - SHUTDOWN_LEN;
  const shutdownEnd = workingEnd;
  if (dayLen >= 90) {
    const shutdownConflict = anchors.some(
      (a) => !(shutdownEnd <= a.start || shutdownStart >= a.end)
    );
    if (!shutdownConflict) {
      anchors.push({
        id: uid(),
        title: 'Shutdown',
        start: shutdownStart,
        end: shutdownEnd,
        category: 'admin',
        auto: true,
      });
      free = subtractInterval(free, shutdownStart, shutdownEnd);
    }
  }

  // 4) Sort flexible tasks per the rules at the top, then fill chronologically.
  const queue = sortFlexible(flexible);
  const placed: Block[] = [];
  free.sort((a, b) => a.start - b.start);

  for (const iv of free) {
    let cursor = iv.start;
    let workSinceBreak = 0;

    while (cursor < iv.end && queue.length > 0) {
      // 5) Auto-break: after 90 min of work, slot a 15-min recovery break,
      //    but only if (a) it fits before the next anchor/end, and (b) there
      //    is still a task waiting that fits after the break. Otherwise the
      //    fixed-time task or end-of-window overrides the break — the user
      //    explicitly asked for fixed times to take priority.
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
        workSinceBreak = 0; // skip break, keep working
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

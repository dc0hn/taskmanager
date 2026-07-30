import type { Block, CategoryDef, CategoryKind, Task } from './types';
import { uid } from './utils/id';

interface Interval {
  start: number;
  end: number;
}

// ---------------------------------------------------------------------------
// Category rules
//
// Categories are user-definable, so the scheduler can no longer reason about
// them by id. What it needs is each category's *kind*, which is the stable
// contract: a brand new "Music practice" category declared as `focus` inherits
// morning priority and 90-minute chunking without this file knowing it exists.
//
// The algorithm below is otherwise unchanged — every previous `=== 'deep'` test
// is now `kindOf(...) === 'focus'`, and the two synthetic blocks look up a
// category to wear instead of hardcoding one.
// ---------------------------------------------------------------------------

export interface CategoryRules {
  kindOf: (categoryId: string) => CategoryKind;
  /** Category the auto-break blocks wear. */
  restCategoryId: string;
  /** Category the shutdown block wears. */
  shallowCategoryId: string;
  /**
   * The window a category has historically done best in, if anything is known.
   *
   * Derived from completion history by `strongestWindows` in insights.ts and threaded in
   * here rather than imported, so the scheduler stays a pure function of its arguments and
   * this file keeps no dependency on the codex.
   *
   * Absent means no preference, which is the default: nothing in the schedule changes
   * unless the setting is on AND there is enough history for a finding.
   */
  preferredWindow?: (categoryId: string) => { from: number; to: number } | null;
}

export function rulesFor(categories: CategoryDef[]): CategoryRules {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const firstOfKind = (kind: CategoryKind) =>
    [...categories].sort((a, b) => a.order - b.order).find((c) => c.kind === kind);

  return {
    kindOf: (id) => byId.get(id)?.kind ?? 'neutral',
    restCategoryId: firstOfKind('rest')?.id ?? categories[0]?.id ?? 'other',
    shallowCategoryId: firstOfKind('shallow')?.id ?? categories[0]?.id ?? 'other',
  };
}

/** Used when no category list is supplied (tests, and any legacy call site). */
const LEGACY_RULES: CategoryRules = {
  kindOf: (id) =>
    id === 'deep'
      ? 'focus'
      : id === 'admin'
        ? 'shallow'
        : id === 'break'
          ? 'rest'
          : 'neutral',
  restCategoryId: 'break',
  shallowCategoryId: 'admin',
};

// Tunables, derived from the practices in the README/research:
//   - Newport / ultradian research: cap focused blocks at ~90 min and recover.
//   - Mark & Gonzalez context-switch research: keep transitions cheap (buffers).
//   - GTD shutdown ritual: end the day with a planned close.
const BREAK_AFTER_MIN = 90; // auto-break trigger
const BREAK_LEN = 15;
const DEEP_SPLIT_THRESHOLD = 120; // longer deep tasks get chunked
const DEEP_CHUNK_MAX = 90; // each chunk no longer than this
/**
 * The shortest a chunk may be on its own.
 *
 * A tail below this is folded into the previous chunk rather than becoming a block or
 * being discarded — which means a chunk can reach DEEP_CHUNK_MAX + DEEP_CHUNK_MIN. That
 * is deliberate: fifteen minutes over the focus envelope is a better outcome than either
 * a five-minute orphan block or minutes the user asked for going missing.
 */
const DEEP_CHUNK_MIN = 15;
const BUFFER_PRE = 10; // minutes reserved before a fixed-time anchor
const BUFFER_POST = 5; // minutes reserved after a fixed-time anchor
const SHUTDOWN_LEN = 15; // synthetic close-of-day admin block

// Lower = scheduled earlier when other keys tie. Focus first, then shallow,
// then neutral, then rest — keeps same-kind work batched together so the
// scheduler doesn't whipsaw between contexts (Mark & Gonzalez: each switch
// costs ~23 min of recovery cost).
const KIND_RANK: Record<CategoryKind, number> = {
  focus: 0,
  shallow: 1,
  neutral: 2,
  rest: 3,
};

// Eat-the-frog + category batching + Parkinson's tight duration:
//   1. high-priority focus tasks lead the queue (Mark Twain / Eisenhower Q2)
//   2. then by kind group, so same-kind tasks cluster
//   3. then by category id, so distinct categories of the same kind still batch
//   4. then priority within category
//   5. then longer first — substantial work shouldn't be displaced by trivia
function sortFlexible(tasks: Task[], rules: CategoryRules): Task[] {
  return [...tasks].sort((a, b) => {
    const aFrog = a.priority === 'high' && rules.kindOf(a.category) === 'focus' ? 0 : 1;
    const bFrog = b.priority === 'high' && rules.kindOf(b.category) === 'focus' ? 0 : 1;
    if (aFrog !== bFrog) return aFrog - bFrog;
    const ca = KIND_RANK[rules.kindOf(a.category)];
    const cb = KIND_RANK[rules.kindOf(b.category)];
    if (ca !== cb) return ca - cb;
    // Two different focus categories should still cluster with themselves rather
    // than interleaving, so category id is a tiebreaker below kind.
    if (a.category !== b.category) return a.category < b.category ? -1 : 1;
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

// Split long focus tasks into chunks ≤ 90 min so each block stays within the
// ultradian focus envelope. The chunks fall back into the queue as separate
// flex tasks; the 90-min auto-break logic will naturally space them.
function splitLongDeep(tasks: Task[], rules: CategoryRules): Task[] {
  const out: Task[] = [];
  for (const t of tasks) {
    if (
      rules.kindOf(t.category) === 'focus' &&
      t.fixedTime == null &&
      t.duration >= DEEP_SPLIT_THRESHOLD
    ) {
      const n = Math.ceil(t.duration / DEEP_CHUNK_MAX);
      const baseChunk = Math.ceil(t.duration / n / 5) * 5; // snap to 5
      let remaining = t.duration;
      const chunks: Task[] = [];
      for (let i = 0; i < n && remaining > 0; i++) {
        const dur = Math.min(baseChunk, remaining);
        // A remainder too small to be its own block is FOLDED INTO THE LAST ONE, not
        // dropped. This used to `break`, which abandoned those minutes silently: they
        // appeared in no block and in no overflow reason, so a 200-minute task quietly
        // became 180 and nothing anywhere said so. The snap-to-5 rounding makes a short
        // tail the common case, not a rare one.
        if (dur < DEEP_CHUNK_MIN) {
          const last = chunks[chunks.length - 1];
          if (last) last.duration = Math.min(DEEP_CHUNK_MAX + DEEP_CHUNK_MIN, last.duration + dur);
          break;
        }
        chunks.push({
          ...t,
          id: `${t.id}-c${i + 1}`,
          title: `${t.title} (${i + 1}/${n})`,
          duration: dur,
        });
        remaining -= dur;
      }
      // Retitle once the count is settled, so "1/3" is never shown beside two chunks.
      const total = chunks.length;
      chunks.forEach((c, i) => {
        c.title = total > 1 ? `${t.title} (${i + 1}/${total})` : t.title;
      });
      out.push(...chunks);
    } else {
      out.push(t);
    }
  }
  return out;
}

export interface ScheduleResult {
  blocks: Block[];
  overflow: Task[];
  /**
   * Why each overflowed task didn't fit, keyed by task id.
   *
   * This exists so the UI never has to say "didn't fit" without saying why. It
   * is computed from state the algorithm already has — the free intervals and
   * the anchor list — rather than being re-derived by the caller, which would
   * duplicate the fitting logic and drift from it.
   */
  reasons: Record<string, string>;
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
  preserved: Block[] = [],
  rules: CategoryRules = LEGACY_RULES
): ScheduleResult {
  if (workingEnd <= workingStart) {
    const reasons: Record<string, string> = {};
    for (const t of tasks) {
      reasons[t.id] = 'Your working hours are empty — set a start and end time.';
    }
    return { blocks: [], overflow: tasks, reasons };
  }

  let free: Interval[] = [{ start: workingStart, end: workingEnd }];
  const anchors: Block[] = [];
  const overflow: Task[] = [];
  const reasons: Record<string, string> = {};

  // 0) Pre-existing blocks (kept from the prior schedule). These get no
  //    transition buffer — they were already laid out cleanly and we just
  //    need to schedule around them.
  for (const b of preserved) {
    anchors.push(b);
    free = subtractInterval(free, b.start, b.end);
  }

  // 1) Pre-process — split focus work that overshoots the focus envelope.
  const expanded = splitLongDeep(tasks, rules);

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
    const clash = anchors.find((a) => !(e <= a.start || s >= a.end));
    if (clash) {
      overflow.push(t);
      reasons[t.id] = `Its fixed time overlaps “${clash.title}”.`;
      continue;
    }
    anchors.push({
      id: t.id,
      title: t.title,
      start: s,
      end: e,
      category: t.category,
      goalId: t.goalId,
      templateId: t.templateId,
    });
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
        category: rules.shallowCategoryId,
        auto: true,
      });
      free = subtractInterval(free, shutdownStart, shutdownEnd);
    }
  }

  // 4) Sort flexible tasks per the rules at the top, then fill chronologically.
  const queue = sortFlexible(flexible, rules);
  const placed: Block[] = [];
  free.sort((a, b) => a.start - b.start);

  /*
   * 4a) RESERVATION PASS — claim space for the frogs before anything else can eat it.
   *
   * The sort already puts high-priority focus work first, but the fill that followed was
   * chronological first-fit: `queue.findIndex((t) => t.duration <= remain)`. A task that
   * did not fit the gap in front of the cursor was skipped and something smaller took the
   * space. Over a day that compounds — trivia consumes the one interval long enough for
   * the ninety-minute frog, and the frog lands after lunch or overflows outright, with the
   * reason "the largest gap left is 45m". True, and the exact opposite of what the sort
   * was expressing. The sort stated a priority the placement could not honour.
   *
   * So each frog, in queue order, claims the earliest interval that genuinely fits it,
   * before the general fill runs around those claims. Frog order stays chronological
   * order, which is what eat-the-frog means.
   *
   * The break after a long claim is emitted here too. Carving the frog out splits the free
   * interval, and the fill loop's `workSinceBreak` resets per interval — so without this,
   * reserving a ninety-minute block would silently drop the recovery break that the
   * unreserved path would have given it.
   */
  const isFrog = (t: Task) =>
    t.priority === 'high' && rules.kindOf(t.category) === 'focus';

  for (const t of queue.filter(isFrog)) {
    free.sort((a, b) => a.start - b.start);
    const iv = free.find((i) => i.end - i.start >= t.duration);
    // No interval fits it. Left in the queue so the overflow pass explains it in terms of
    // the largest gap actually available, same as any other task.
    if (!iv) continue;

    const start = iv.start;
    const end = start + t.duration;
    placed.push({
      id: t.id,
      title: t.title,
      start,
      end,
      category: t.category,
      goalId: t.goalId,
      templateId: t.templateId,
    });
    queue.splice(queue.indexOf(t), 1);

    let carveEnd = end;
    if (t.duration >= BREAK_AFTER_MIN && end + BREAK_LEN <= iv.end) {
      placed.push({
        id: uid(),
        title: 'Break',
        start: end,
        end: end + BREAK_LEN,
        category: rules.restCategoryId,
        auto: true,
      });
      carveEnd = end + BREAK_LEN;
    }
    free = subtractInterval(free, start, carveEnd);
  }

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
            category: rules.restCategoryId,
            auto: true,
          });
          cursor = breakEnd;
          workSinceBreak = 0;
          continue;
        }
        workSinceBreak = 0; // skip break, keep working
      }

      const remain = iv.end - cursor;
      /*
       * First-fit in queue order, with one soft preference layered on top.
       *
       * When the history says a category does its best work at this time of day, a task of
       * that category is chosen ahead of an equally-fitting one that has no such claim on
       * the slot. It can only ever reorder tasks that ALL fit the space anyway, so it
       * cannot displace a frog or leave a gap — and it is inert unless the setting is on
       * and the codex has enough history to have found anything.
       */
      const fits = (t: Task) => t.duration <= remain;
      let idx = -1;
      if (rules.preferredWindow) {
        idx = queue.findIndex((t) => {
          if (!fits(t)) return false;
          const w = rules.preferredWindow!(t.category);
          return w != null && cursor >= w.from && cursor < w.to;
        });
      }
      if (idx === -1) idx = queue.findIndex(fits);
      if (idx === -1) break;
      const t = queue.splice(idx, 1)[0];
      placed.push({
        id: t.id,
        title: t.title,
        start: cursor,
        end: cursor + t.duration,
        category: t.category,
        goalId: t.goalId,
        templateId: t.templateId,
      });
      cursor += t.duration;
      if (rules.kindOf(t.category) === 'rest') {
        workSinceBreak = 0;
      } else {
        workSinceBreak += t.duration;
      }
    }
  }

  // 6) Anything left could not be placed. Explain each one in terms of the
  //    largest gap that was actually available, so "didn't fit" is never mute.
  const allBlocks = [...anchors, ...placed].sort((a, b) => a.start - b.start);
  if (queue.length > 0) {
    const remaining = free.map((iv) => {
      const taken = placed
        .filter((b) => b.start >= iv.start && b.end <= iv.end)
        .reduce((sum, b) => sum + (b.end - b.start), 0);
      return iv.end - iv.start - taken;
    });
    const largestGap = remaining.length > 0 ? Math.max(...remaining, 0) : 0;

    for (const t of queue) {
      overflow.push(t);
      reasons[t.id] =
        largestGap <= 0
          ? 'The day is already full.'
          : `Needs ${fmt(t.duration)} but the largest gap left is ${fmt(largestGap)}.`;
    }
  }

  return { blocks: allBlocks, overflow, reasons };
}

/** Compact duration for overflow messages: "45m", "1h", "2h 15m". */
function fmt(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

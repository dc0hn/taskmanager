import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Check, Pencil, Pin, PinOff } from 'lucide-react';
import type { Block, CategoryDef, DayPlan } from '../types';
import { categoryColors, resolveCategory } from '../utils/color';
import { format12h, formatHourLabel, toDateKey } from '../utils/time';
import { DUR, SPRING_SETTLE } from '../utils/motion';
import { reflowInsert, reflowPlace } from '../reflow';
import { fromDateKey } from '../utils/time';

// ============================================================================
// TimeGrid
//
// One component renders both the day and week views: the day view passes a
// single date, the week view passes seven. Keeping them on one implementation
// means the time-axis geometry, the drag/resize maths, the conflict rules and
// the now-line all exist exactly once.
//
// Dragging horizontally between columns moves a block to another *day*, which is
// why the callbacks below are all keyed by date as well as block id.
// ============================================================================

const PX_PER_MIN = 1.35;
const SNAP = 5;
const PAD_TOP = 12;
const AXIS_W = 62; // width of the hour-label gutter
// 3px, not 9px. A block is an entry in a ruled table, not a card — the radius is
// just enough to soften the corner, not enough to read as a pill.
const BLOCK_RADIUS = 3;
const MIN_BLOCK = 15;

export interface TimeGridProps {
  dates: string[];
  plans: Record<string, DayPlan>;
  categories: CategoryDef[];
  workingStart: number;
  workingEnd: number;
  /** Bumped by the caller after a rebuild, to re-run the entry animation. */
  buildPulse: number;
  onChangeBlock: (date: string, id: string, patch: Partial<Block>) => void;
  onMoveBlock: (from: string, id: string, to: string, patch: Partial<Block>) => void;
  onEditBlock: (date: string, id: string) => void;
  onCreateBlock: (date: string, start: number) => void;
  onToggleComplete: (date: string, id: string) => void;
  onTogglePin: (date: string, id: string) => void;
  /** Called with a human-readable reason whenever an interaction is refused. */
  onRefuse: (message: string) => void;
  /** Day view gets richer blocks; week view compresses them. */
  density: 'comfortable' | 'compact';
}

interface DragState {
  date: string;
  id: string;
  mode: 'move' | 'resize-top' | 'resize-bottom';
  pointerStartY: number;
  origStart: number;
  origEnd: number;
  ghost: { start: number; end: number };
  /** Which column the pointer is currently over — the prospective new date. */
  ghostDate: string;
}

function snap(min: number): number {
  return Math.round(min / SNAP) * SNAP;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function useNowMinutes(active: boolean) {
  const [now, setNow] = useState(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      const d = new Date();
      setNow(d.getHours() * 60 + d.getMinutes());
    }, 30 * 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function TimeGrid({
  dates,
  plans,
  categories,
  workingStart,
  workingEnd,
  buildPulse,
  onChangeBlock,
  onMoveBlock,
  onEditBlock,
  onCreateBlock,
  onToggleComplete,
  onTogglePin,
  onRefuse,
  density,
}: TimeGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const today = toDateKey(new Date());
  const showsToday = dates.includes(today);
  const nowMin = useNowMinutes(showsToday);

  // The visible window stretches to cover the working hours *and* anything
  // scheduled outside them, so a 6am block is never unreachable.
  const { visibleStart, visibleEnd, hours, totalPx } = useMemo(() => {
    let minStart = workingStart;
    let maxEnd = workingEnd;
    for (const d of dates) {
      for (const b of plans[d]?.blocks ?? []) {
        if (b.start < minStart) minStart = b.start;
        if (b.end > maxEnd) maxEnd = b.end;
      }
    }
    const vs = Math.floor(minStart / 60) * 60;
    const ve = Math.ceil(maxEnd / 60) * 60;
    const hrs: number[] = [];
    for (let h = vs; h <= ve; h += 60) hrs.push(h);
    return {
      visibleStart: vs,
      visibleEnd: ve,
      hours: hrs,
      totalPx: (ve - vs) * PX_PER_MIN + PAD_TOP + 8,
    };
  }, [dates, plans, workingStart, workingEnd]);

  /**
   * Live reflow preview.
   *
   * Previously the other entries did not move until the pointer was released, so
   * a rearrangement arrived as a sudden jump *after* the decision had been made —
   * which is most of why the shift felt broken. Now the day opens up underneath
   * the cursor as you drag, and dropping simply commits what is already on screen.
   *
   * The preview calls the exact same pure functions App calls on drop, so what you
   * see and what you get cannot disagree.
   */
  const preview = useMemo(() => {
    if (!drag) return null;
    const destination = plans[drag.ghostDate]?.blocks ?? [];

    const outcome =
      drag.ghostDate === drag.date
        ? reflowPlace(destination, drag.id, drag.ghost.start, drag.ghost.end, workingEnd)
        : (() => {
            const block = plans[drag.date]?.blocks.find((b) => b.id === drag.id);
            if (!block) return null;
            return reflowInsert(
              destination,
              { ...block, start: drag.ghost.start, end: drag.ghost.end },
              workingEnd
            );
          })();

    if (!outcome) return null;
    const positions = new Map<string, { start: number; end: number }>();
    if (outcome.ok) {
      for (const b of outcome.blocks) positions.set(b.id, { start: b.start, end: b.end });
    }
    return { date: drag.ghostDate, ok: outcome.ok, positions };
  }, [drag, plans, workingEnd]);

  const yToMinutes = (clientY: number): number => {
    const rect = gridRef.current!.getBoundingClientRect();
    return (clientY - rect.top - PAD_TOP) / PX_PER_MIN + visibleStart;
  };

  /** Which date column a client X coordinate falls in. */
  const xToDate = (clientX: number): string => {
    const rect = gridRef.current!.getBoundingClientRect();
    const colsLeft = rect.left + AXIS_W;
    const colWidth = (rect.width - AXIS_W) / dates.length;
    if (colWidth <= 0) return dates[0];
    const idx = clamp(Math.floor((clientX - colsLeft) / colWidth), 0, dates.length - 1);
    return dates[idx];
  };

  /**
   * The live drag, mirrored into a ref.
   *
   * The pointer handlers below need the current ghost, but reading it from state
   * would put `drag` in the effect's dependency list — and since every
   * `pointermove` calls `setDrag`, the effect would tear down and re-attach the
   * window listeners on every frame of the drag. That churn drops events and is
   * its own source of stutter. The effect now keys only on the identity of the
   * drag, which is fixed for its whole duration.
   */
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;

  const dragId = drag ? `${drag.date}:${drag.id}:${drag.mode}` : null;

  useEffect(() => {
    if (!dragId) return;

    function onMove(e: PointerEvent) {
      const d = dragRef.current;
      if (!d || !gridRef.current) return;
      const dyMin = yToMinutes(e.clientY) - d.pointerStartY;
      let nextStart = d.origStart;
      let nextEnd = d.origEnd;

      if (d.mode === 'move') {
        const len = d.origEnd - d.origStart;
        const s = clamp(snap(d.origStart + dyMin), visibleStart, visibleEnd - len);
        nextStart = s;
        nextEnd = s + len;
      } else if (d.mode === 'resize-top') {
        const s = clamp(snap(d.origStart + dyMin), visibleStart, d.origEnd - MIN_BLOCK);
        nextStart = s;
        nextEnd = d.origEnd;
      } else {
        const e2 = clamp(snap(d.origEnd + dyMin), d.origStart + MIN_BLOCK, visibleEnd);
        nextStart = d.origStart;
        nextEnd = e2;
      }

      // Only a whole-block move may change the day; resizing stays put.
      const ghostDate = d.mode === 'move' ? xToDate(e.clientX) : d.date;
      setDrag({ ...d, ghost: { start: nextStart, end: nextEnd }, ghostDate });
    }

    function onUp() {
      const d = dragRef.current;
      if (!d) return;
      const { start, end } = d.ghost;
      const targetDate = d.ghostDate;
      const movedDay = targetDate !== d.date;
      const unchanged = !movedDay && start === d.origStart && end === d.origEnd;

      if (unchanged) {
        setDrag(null);
        return;
      }

      // No overlap check here any more. The day makes room: App runs the reflow,
      // which pushes what it must, closes the slot behind, and reports back if it
      // was refused by pinned or completed work.
      if (movedDay) {
        onMoveBlock(d.date, d.id, targetDate, { start, end });
      } else {
        onChangeBlock(d.date, d.id, { start, end });
      }
      setDrag(null);
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId, visibleStart, visibleEnd, dates.length]);

  function startDrag(
    e: React.PointerEvent,
    date: string,
    block: Block,
    mode: DragState['mode']
  ) {
    if (!gridRef.current) return;
    if (block.auto) {
      onRefuse(
        `“${block.title}” is placed by the scheduler — rebuild the day to move it.`
      );
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    setDrag({
      date,
      id: block.id,
      mode,
      pointerStartY: yToMinutes(e.clientY),
      origStart: block.start,
      origEnd: block.end,
      ghost: { start: block.start, end: block.end },
      ghostDate: date,
    });
  }

  function handleBackgroundClick(e: React.MouseEvent, date: string) {
    if (drag) return;
    if (!(e.target instanceof Element)) return;
    if (!e.target.classList.contains('col-bg')) return;
    if (!gridRef.current) return;
    // Creating also makes room, so there is nothing to refuse here.
    onCreateBlock(date, snap(yToMinutes(e.clientY)));
  }

  const colWidthPct = 100 / dates.length;

  return (
    <div className="relative flex-1 min-h-0 overflow-y-auto thin-scroll">
      <div
        ref={gridRef}
        className="relative select-none"
        style={{ height: totalPx + 'px' }}
      >
        {/* ---------------- hour rules + axis labels ---------------- */}
        {hours.map((h) => {
          const top = (h - visibleStart) * PX_PER_MIN + PAD_TOP;
          const inWorking = h >= workingStart && h < workingEnd;
          return (
            <div
              key={h}
              className="absolute left-0 right-0 pointer-events-none flex items-start"
              style={{ top: top + 'px' }}
            >
              <span
                className={`font-mono text-[10.5px] tracking-wider tnum shrink-0 pr-3 -mt-[7px] text-right ${
                  inWorking ? 'text-ink-3' : 'text-bone-3'
                }`}
                style={{ width: AXIS_W }}
              >
                {formatHourLabel(h)}
              </span>
              <div
                className="flex-1"
                style={{
                  borderTop: inWorking
                    ? '1px solid rgba(245, 242, 236,0.07)'
                    : '1px dashed rgba(245, 242, 236,0.04)',
                }}
              />
            </div>
          );
        })}

        {/* ---------------- day columns ----------------
            Columns live inside a container that already starts after the axis
            gutter, so each one is a plain percentage of the remaining width. */}
        <div
          className="absolute top-0 bottom-0 right-0"
          style={{ left: AXIS_W }}
        >
        {dates.map((date, colIdx) => {
          const plan = plans[date];
          const blocks = plan?.blocks ?? [];
          const isToday = date === today;
          const isDropTarget = drag?.mode === 'move' && drag.ghostDate === date;
          const weekend = [0, 6].includes(fromDateKey(date).getDay());

          return (
            <div
              key={date}
              className="absolute top-0 bottom-0 col-bg"
              onClick={(e) => handleBackgroundClick(e, date)}
              style={{
                left: `${colIdx * colWidthPct}%`,
                width: `${colWidthPct}%`,
                borderLeft:
                  dates.length > 1 && colIdx > 0
                    ? '1px solid rgba(245, 242, 236,0.055)'
                    : undefined,
                background: isDropTarget
                  ? 'rgba(74,158,255,0.05)'
                  : weekend && dates.length > 1
                    ? 'rgba(245, 242, 236,0.012)'
                    : undefined,
              }}
            >
              {/* working-window wash */}
              <div
                className="absolute left-0 right-0 pointer-events-none col-bg"
                style={{
                  top: (workingStart - visibleStart) * PX_PER_MIN + PAD_TOP + 'px',
                  height: (workingEnd - workingStart) * PX_PER_MIN + 'px',
                  background: isToday
                    ? 'linear-gradient(180deg, rgba(74,158,255,0.055), rgba(74,158,255,0.015))'
                    : 'rgba(245, 242, 236,0.016)',
                }}
              />

              {/* blocks */}
              <AnimatePresence initial={false}>
                {blocks.map((b) => {
                  const dragging = drag?.id === b.id && drag.date === date;
                  const hidden = drag?.id === b.id && drag.ghostDate !== date;
                  if (hidden) return null;

                  // While dragging, everything on the destination column sits where
                  // the reflow says it will land — so the day visibly makes room
                  // rather than snapping into place after the drop.
                  const shown =
                    preview?.date === date && !dragging
                      ? preview.positions.get(b.id)
                      : undefined;

                  const start = dragging ? drag!.ghost.start : (shown?.start ?? b.start);
                  const end = dragging ? drag!.ghost.end : (shown?.end ?? b.end);
                  return (
                    <BlockCard
                      key={b.id}
                      block={b}
                      start={start}
                      end={end}
                      top={(start - visibleStart) * PX_PER_MIN + PAD_TOP}
                      height={(end - start) * PX_PER_MIN}
                      dragging={dragging}
                      refused={dragging && preview?.ok === false}
                      density={density}
                      categories={categories}
                      onPointerDown={(e, mode) => startDrag(e, date, b, mode)}
                      onEdit={() => onEditBlock(date, b.id)}
                      onToggle={() => onToggleComplete(date, b.id)}
                      onTogglePin={() => onTogglePin(date, b.id)}
                    />
                  );
                })}
              </AnimatePresence>

              {/* ghost of a block being dragged in from another column */}
              {drag?.mode === 'move' && drag.ghostDate === date && drag.date !== date && (
                <GhostBlock
                  top={(drag.ghost.start - visibleStart) * PX_PER_MIN + PAD_TOP}
                  height={(drag.ghost.end - drag.ghost.start) * PX_PER_MIN}
                  label={plans[drag.date]?.blocks.find((b) => b.id === drag.id)?.title ?? ''}
                />
              )}

              {/* now-line, only on today's column */}
              {isToday && nowMin >= visibleStart && nowMin <= visibleEnd && (
                <div
                  className="absolute left-0 right-0 pointer-events-none z-20 flex items-center"
                  style={{ top: (nowMin - visibleStart) * PX_PER_MIN + PAD_TOP + 'px' }}
                >
                  <span className="relative flex items-center justify-center w-2 h-2 -ml-1">
                    <span className="absolute inset-0 rounded-full bg-now animate-nowPulse" />
                    <span
                      className="relative w-[5px] h-[5px] rounded-full"
                      style={{
                        background: 'var(--signal)',
                        boxShadow: '0 0 8px rgba(255,107,74,0.8)',
                      }}
                    />
                  </span>
                  <span
                    className="flex-1 h-px"
                    style={{
                      backgroundImage:
                        'linear-gradient(to right, var(--signal) 0 3px, transparent 3px 6px)',
                      backgroundSize: '6px 1px',
                    }}
                  />
                </div>
              )}
            </div>
          );
        })}
        </div>

        {/* now-time label, pinned in the axis gutter */}
        {showsToday && nowMin >= visibleStart && nowMin <= visibleEnd && (
          <span
            className="absolute font-mono text-[10px] tnum tracking-wider z-30 px-1 rounded"
            style={{
              top: (nowMin - visibleStart) * PX_PER_MIN + PAD_TOP - 7 + 'px',
              left: 0,
              width: AXIS_W - 8,
              textAlign: 'right',
              color: 'var(--signal)',
              background: 'var(--chassis-0)',
            }}
          >
            {format12h(nowMin)}
          </span>
        )}

        {/* re-mount key so a rebuild replays the entry stagger */}
        <span className="hidden" data-pulse={buildPulse} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function GhostBlock({
  top,
  height,
  label,
}: {
  top: number;
  height: number;
  label: string;
}) {
  return (
    <div
      className="absolute left-1 right-1 pointer-events-none z-10 rounded-lg flex items-center px-2"
      style={{
        top: top + 'px',
        height: height + 'px',
        border: '1.5px dashed var(--signal-line)',
        background: 'rgba(74,158,255,0.10)',
      }}
    >
      <span className="text-[11px] text-accent-bright truncate font-medium">{label}</span>
    </div>
  );
}

interface BlockCardProps {
  block: Block;
  start: number;
  end: number;
  top: number;
  height: number;
  dragging: boolean;
  /** True when the current drop target is blocked by pinned or completed work. */
  refused: boolean;
  density: 'comfortable' | 'compact';
  categories: CategoryDef[];
  onPointerDown: (e: React.PointerEvent, mode: DragState['mode']) => void;
  onEdit: () => void;
  onToggle: () => void;
  onTogglePin: () => void;
}

function BlockCard({
  block,
  start,
  end,
  top,
  height,
  dragging,
  refused,
  density,
  categories,
  onPointerDown,
  onEdit,
  onToggle,
  onTogglePin,
}: BlockCardProps) {
  const cat = resolveCategory(block.category, categories);
  const c = categoryColors(block.category, categories);
  const done = !!block.completed;
  const pinned = !!block.pinned;
  const [hovered, setHovered] = useState(false);
  const reduced = useReducedMotion() ?? false;

  /*
   * Content tiers by rendered height, in px. At 1.35px per minute a five-minute
   * entry is under 7px tall — there is no font size at which a title is legible
   * in that, so below `micro` nothing is drawn inside at all and the label moves
   * to a hover chip instead. Cramming clipped text into a 7px box was the
   * illegibility.
   *
   *   micro    < 13px  (≲9 min)   bar only; label on hover
   *   tiny     < 30px  (≲22 min)  title only, no time
   *   compact  < 54px  (≲40 min)  title + start
   *   full               legend + title + time range
   *
   * The micro cut-off is deliberately low. A first pass put it at 22px, which
   * silently stripped the label off ten- and fifteen-minute entries — common
   * durations that can carry a small one perfectly well — and left a stack of
   * anonymous bars. Only a five-minute entry is genuinely too short for type.
   */
  const tier: 'micro' | 'tiny' | 'compact' | 'full' =
    height < 13
      ? 'micro'
      : height < 30
        ? 'tiny'
        : height < 54 || density === 'compact'
          ? 'compact'
          : 'full';

  /** 15 min is 20px: a 10px face fits, an 11.5px one does not. */
  const tinyFontPx = height < 18 ? 9.5 : 10.5;

  /*
   * Controls are sized to the block and never allowed to exceed it. The cluster
   * lives outside the surface's clip so short blocks don't slice their own
   * checkbox in half — but that also means a fixed 20px cluster on a 7px block
   * overhangs the entries above and below it, which is the overlap. Clamping the
   * box to the available height fixes it at the source.
   */
  const controlBox = Math.max(11, Math.min(20, height - 4));
  const controlIcon = controlBox <= 14 ? 8 : 11;
  // Progressive disclosure: a short entry earns only its checkbox. Pin and edit
  // appear once there is genuinely room for them.
  const showPin = !block.auto && height >= 34;
  const showEdit = !block.auto && height >= 46;

  const fullLabel = `${block.title} · ${format12h(start)} – ${format12h(end)}`;

  return (
    <motion.div
      /*
       * `top`/`height` stay in `style`; `layout` animates the change.
       *
       * The stutter came from ONE thing: `layout` was paired with
       * `animate={{ y: 0 }}`. Framer's layout projection moves an element by
       * writing a transform, and `y` drives that same transform, so the two fought
       * on every rearrangement. Removing `y` is the whole fix.
       *
       * An earlier attempt at this pulled `top`/`height` out of `style` and put
       * them in `animate` instead. That was worse: with no CSS `top`, the element
       * resolves to `top: auto` and framer animated every new target from zero, so
       * blocks flew up to the top of the grid. Measured, caught, reverted.
       *
       * `layout` is off for the block under the cursor, which must track the
       * pointer exactly rather than chase it through a spring.
       */
      layout={!dragging && !reduced}
      initial={{ opacity: 0 }}
      animate={{ opacity: done ? 0.55 : 1 }}
      exit={{ opacity: 0 }}
      transition={{
        // No per-index delay. A stagger is right for a list arriving; on a
        // rearrangement it made the cascade settle raggedly, one block at a time.
        layout: reduced ? { duration: 0 } : SPRING_SETTLE,
        opacity: { duration: DUR.fast },
      }}
      className="absolute left-1 right-1 cursor-grab active:cursor-grabbing group"
      style={{
        top: top + 'px',
        height: height + 'px',
        // Every block shared z-index 2, so paint order fell to DOM order and a
        // later entry could cover an earlier one's controls. Hovering lifts a
        // block above its neighbours, which is what guarantees its own checkbox
        // is reachable and never sits behind the section before or after it.
        zIndex: dragging ? 40 : hovered ? 20 : 2,
      }}
      title={fullLabel}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onPointerDown={(e) => onPointerDown(e, 'move')}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onEdit();
      }}
    >
      {/* The block: a tinted field with a coloured margin rule. The category
          lives in that 2px stripe and in the small-caps legend — it never fills
          the surface hard enough to compete with the amber now-line.
          Stays clipped, so the fill respects the radius and long titles truncate;
          the action cluster is a sibling below, outside this clip, so a 15-minute
          entry's controls are never cut off. */}
      <div
        className="relative h-full overflow-hidden"
        style={{
          background: refused
            ? 'var(--bad-soft, rgba(224,104,95,0.13))'
            : done
              ? 'rgba(245, 242, 236, 0.025)'
              : c.fill,
          borderRadius: BLOCK_RADIUS,
          // `refused` outlines the block while it is still under the cursor, so a
          // drop that pinned or completed work will reject is visible before you
          // let go rather than only afterwards on the toast.
          borderTop: `1px solid ${refused ? 'var(--bad)' : done ? 'rgba(245, 242, 236,0.06)' : c.line}`,
          borderRight: `1px solid ${refused ? 'var(--bad)' : done ? 'rgba(245, 242, 236,0.06)' : c.line}`,
          borderBottom: `1px solid ${refused ? 'var(--bad)' : done ? 'rgba(245, 242, 236,0.06)' : c.line}`,
          borderLeft: `2px solid ${refused ? 'var(--bad)' : done ? 'rgba(245, 242, 236,0.14)' : c.accent}`,
          boxShadow: dragging ? '0 18px 40px -14px rgba(0,0,0,0.85)' : undefined,
        }}
      >
        {/* resize handles — only on real blocks, and only when tall enough */}
        {!block.auto && height >= 26 && (
          <>
            <div
              className="absolute top-0 left-0 right-0 h-2 cursor-ns-resize z-10"
              onPointerDown={(e) => onPointerDown(e, 'resize-top')}
            />
            <div
              className="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize z-10"
              onPointerDown={(e) => onPointerDown(e, 'resize-bottom')}
            />
          </>
        )}

        {/* micro — no type. A title in 7px of height is a sliver of a glyph, not
            information, and cramming one in was the illegibility. Instead the bar
            gets a marker dot at its head so it reads as a deliberate mark rather
            than a broken entry, and the label arrives on hover. */}
        {tier === 'micro' ? (
          <div className="absolute inset-0 flex items-center pl-1.5">
            <span
              className="rounded-full shrink-0"
              style={{
                width: 3,
                height: 3,
                background: done ? 'var(--bone-4)' : c.accent,
              }}
            />
          </div>
        ) : tier === 'tiny' ? (
          <div
            className="absolute inset-0 flex items-center px-2"
            style={{ paddingRight: controlBox + 6 }}
          >
            <span
              className="font-semibold truncate leading-none"
              style={{
                fontSize: tinyFontPx,
                // --bone-3 rather than --bone-4: a completed block should recede,
                // but its title still has to be readable at a glance.
                color: done ? 'var(--bone-3)' : c.text,
                textDecoration: done ? 'line-through' : undefined,
              }}
            >
              {block.title}
            </span>
          </div>
        ) : (
          <div
            className="h-full px-2.5 pt-1.5 pb-1 flex flex-col overflow-hidden"
            style={{ paddingRight: controlBox + 8 }}
          >
            {tier === 'full' && (
              <span
                className="smallcaps text-[9.5px] mb-0.5 shrink-0"
                style={{ color: done ? 'var(--bone-3)' : c.accent }}
              >
                {cat.short}
              </span>
            )}
            <div
              className="text-[12.5px] font-semibold leading-tight truncate"
              style={{
                // --fg-3 rather than --fg-4: a completed block should recede,
                // but its title still has to be readable at a glance.
                color: done ? 'var(--bone-3)' : c.text,
                textDecoration: done ? 'line-through' : undefined,
                textDecorationThickness: '1px',
              }}
            >
              {block.title}
            </div>
            <div
              className="font-mono text-[10px] mt-0.5 tnum tracking-wide truncate"
              style={{ color: done ? 'var(--bone-3)' : c.textDim }}
            >
              {density === 'compact'
                ? format12h(start)
                : `${format12h(start)} – ${format12h(end)}`}
            </div>
          </div>
        )}
      </div>

      {/* A micro entry's label, on hover. Raised above its neighbours and allowed
          to be taller than the entry itself, because it behaves as a tooltip
          rather than as part of the grid. This is how a five-minute entry stays
          identifiable without pretending text fits inside it. */}
      {tier === 'micro' && hovered && !dragging && (
        <div
          className="absolute left-0 flex items-center gap-1.5 px-2 h-[20px] rounded-xs pointer-events-none whitespace-nowrap"
          style={{
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 30,
            background: 'var(--chassis-4)',
            border: `1px solid ${c.line}`,
            boxShadow: '0 6px 18px -8px rgba(0,0,0,0.85)',
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: c.accent }}
          />
          <span className="text-nano font-semibold" style={{ color: c.text }}>
            {block.title}
          </span>
          <span className="font-mono text-nano tnum" style={{ color: 'var(--bone-3)' }}>
            {format12h(start)} – {format12h(end)}
          </span>
        </div>
      )}

      {/* Action cluster — a SIBLING of the clipped surface, not a child.
          Centred on the block's own vertical midpoint rather than pinned to its
          top edge, so the controls always sit in the middle of the section they
          belong to. Pinning them to the top put them hard against the boundary
          with the entry above, and now that reflow packs entries back to back
          that boundary is where most blocks meet their neighbour.
          Living outside the surface's overflow-hidden is what stops a 15-minute
          entry clipping its own checkbox in half — but it also means a fixed-size
          cluster would overhang a very short entry onto its neighbours, so every
          control is sized from `controlBox`, which is clamped to the block. */}
      <div
        className="absolute top-1/2 -translate-y-1/2 right-1 flex items-center gap-0.5 z-20"
        style={{ maxHeight: height }}
      >
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-label={done ? 'Mark as not done' : 'Mark as done'}
            className="grid place-items-center rounded-xs transition-transform active:scale-90"
            style={{ width: controlBox, height: controlBox }}
          >
            <span
              className="grid place-items-center rounded-xs"
              style={{
                width: controlBox - 4,
                height: controlBox - 4,
                background: done ? c.accent : 'rgba(245, 242, 236,0.06)',
                boxShadow: done
                  ? `inset 0 0 0 1px ${c.accent}`
                  : 'inset 0 0 0 1.5px rgba(245, 242, 236,0.28)',
              }}
            >
              {done && (
                <Check
                  size={controlIcon}
                  strokeWidth={3.2}
                  className="text-chassis-0"
                />
              )}
            </span>
          </button>
          {/* Pin. Stays visible while pinned, since it changes how every later
              rearrangement behaves and that shouldn't be hidden behind a hover.
              Only offered once the entry is tall enough to hold it. */}
          {showPin && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePin();
              }}
              aria-label={pinned ? 'Unpin — allow this to be moved' : 'Pin in place'}
              aria-pressed={pinned}
              title={
                pinned
                  ? 'Pinned — rearranging other entries will not move this'
                  : 'Pin in place'
              }
              className={`grid place-items-center rounded-xs transition-opacity ${
                pinned
                  ? 'opacity-100'
                  : 'text-bone-3 hover:text-bone-0 opacity-0 group-hover:opacity-100'
              }`}
              style={{
                width: controlBox,
                height: controlBox,
                ...(pinned ? { color: 'var(--signal)' } : {}),
              }}
            >
              {pinned ? (
                <Pin size={controlIcon} strokeWidth={2.4} />
              ) : (
                <PinOff size={controlIcon} strokeWidth={1.8} />
              )}
            </button>
          )}
          {showEdit && (
            <button
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onEdit();
              }}
              aria-label="Edit block"
              style={{ width: controlBox, height: controlBox }}
              className="grid place-items-center rounded-xs text-bone-3 hover:text-bone-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <Pencil size={controlIcon} strokeWidth={1.8} />
            </button>
          )}
      </div>
    </motion.div>
  );
}

export default memo(TimeGrid);

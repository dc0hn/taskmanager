import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Pencil } from 'lucide-react';
import type { Block, Category } from '../types';
import { format12h, formatHourLabel, toDateKey } from '../utils/time';

interface Props {
  blocks: Block[];
  workingStart: number;
  workingEnd: number;
  date: string;
  buildPulse: number;
  onChangeBlock: (id: string, patch: Partial<Block>) => void;
  onEditBlock: (id: string) => void;
  onCreateBlock: (start: number) => void;
  onToggleComplete: (id: string) => void;
}

const PX_PER_MIN = 1.35;
const SNAP = 5;
const PAD_TOP = 14;
const BLOCK_RADIUS = 8;

// Editorial ink-on-paper category styling
const CAT_STYLE: Record<
  Category,
  { bar: string; tint: string; ink: string; label: string }
> = {
  deep: {
    bar: '#7a2530',
    tint: 'rgba(122,37,48,0.10)',
    ink: '#4a131c',
    label: 'Deep',
  },
  admin: {
    bar: '#1f3b5d',
    tint: 'rgba(31,59,93,0.10)',
    ink: '#15263e',
    label: 'Admin',
  },
  break: {
    bar: '#b07720',
    tint: 'rgba(176,119,32,0.13)',
    ink: '#6e4810',
    label: 'Break',
  },
  other: {
    bar: '#4a3d2e',
    tint: 'rgba(74,61,46,0.08)',
    ink: '#3a2e22',
    label: 'Other',
  },
};

function snap(min: number): number {
  return Math.round(min / SNAP) * SNAP;
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

interface DragState {
  id: string;
  mode: 'move' | 'resize-top' | 'resize-bottom';
  pointerStart: number;
  origStart: number;
  origEnd: number;
  ghost: { start: number; end: number };
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

export default function Timeline({
  blocks,
  workingStart,
  workingEnd,
  date,
  buildPulse,
  onChangeBlock,
  onEditBlock,
  onCreateBlock,
  onToggleComplete,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const isToday = date === toDateKey(new Date());
  const nowMin = useNowMinutes(isToday);

  const minStart = Math.min(workingStart, ...blocks.map((b) => b.start));
  const maxEnd = Math.max(workingEnd, ...blocks.map((b) => b.end));
  const visibleStart = Math.floor(minStart / 60) * 60;
  const visibleEnd = Math.ceil(maxEnd / 60) * 60;
  const totalMin = visibleEnd - visibleStart;
  const totalPx = totalMin * PX_PER_MIN + PAD_TOP + 6;
  const hours: number[] = [];
  for (let h = visibleStart; h <= visibleEnd; h += 60) hours.push(h);

  useEffect(() => {
    if (!drag) return;
    const d = drag;
    function onMove(e: PointerEvent) {
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      const y = e.clientY - rect.top - PAD_TOP;
      const dyMin = (y - d.pointerStart) / PX_PER_MIN;
      let nextStart = d.origStart;
      let nextEnd = d.origEnd;
      if (d.mode === 'move') {
        const len = d.origEnd - d.origStart;
        let s = snap(d.origStart + dyMin);
        s = clamp(s, visibleStart, visibleEnd - len);
        nextStart = s;
        nextEnd = s + len;
      } else if (d.mode === 'resize-top') {
        let s = snap(d.origStart + dyMin);
        s = clamp(s, visibleStart, d.origEnd - SNAP);
        nextStart = s;
        nextEnd = d.origEnd;
      } else if (d.mode === 'resize-bottom') {
        let e2 = snap(d.origEnd + dyMin);
        e2 = clamp(e2, d.origStart + SNAP, visibleEnd);
        nextStart = d.origStart;
        nextEnd = e2;
      }
      setDrag({ ...d, ghost: { start: nextStart, end: nextEnd } });
    }
    function onUp() {
      const { start, end } = d.ghost;
      const conflicts = blocks.some(
        (b) => b.id !== d.id && !(end <= b.start || start >= b.end)
      );
      if (!conflicts) {
        onChangeBlock(d.id, { start, end });
      }
      setDrag(null);
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [drag, blocks, onChangeBlock, visibleStart, visibleEnd]);

  function startDrag(e: React.PointerEvent, block: Block, mode: DragState['mode']) {
    if (!ref.current) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = ref.current.getBoundingClientRect();
    const y = e.clientY - rect.top - PAD_TOP;
    setDrag({
      id: block.id,
      mode,
      pointerStart: y,
      origStart: block.start,
      origEnd: block.end,
      ghost: { start: block.start, end: block.end },
    });
  }

  function handleTimelineClick(e: React.MouseEvent) {
    if (drag) return;
    if (!(e.target instanceof Element)) return;
    if (!e.target.classList.contains('timeline-bg')) return;
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const y = e.clientY - rect.top - PAD_TOP;
    const min = snap(y / PX_PER_MIN + visibleStart);
    onCreateBlock(min);
  }

  const showNow = isToday && nowMin >= visibleStart && nowMin <= visibleEnd;
  const isEmpty = blocks.length === 0;

  return (
    <div className="relative paper-card rounded-xl5 p-5 h-full min-h-[480px] md:min-h-[640px] overflow-hidden flex flex-col">
      <div className="relative flex items-end justify-between mb-3 px-1">
        <div className="flex items-baseline gap-3">
          <h2 className="font-display text-[20px] leading-none text-ink-1" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50', fontWeight: 500 }}>
            The Schedule
          </h2>
          <span className="font-mono text-[11px] tracking-wider text-ink-3 tnum">
            {String(blocks.length).padStart(2, '0')} entries
          </span>
        </div>
        <p className="text-[11px] text-ink-3">
          drag · resize · click to add
        </p>
      </div>
      <div className="rule-h mb-1" />

      <div className="relative flex-1 overflow-y-auto no-scrollbar -mx-1 px-1">
        <motion.div
          key={`timeline-${buildPulse}`}
          ref={ref}
          onClick={handleTimelineClick}
          className="relative select-none timeline-bg"
          style={{ height: totalPx + 'px' }}
          initial={false}
        >
          {/* Working window highlight */}
          <motion.div
            layout
            className="absolute left-14 right-0 pointer-events-none timeline-bg"
            style={{
              top: (workingStart - visibleStart) * PX_PER_MIN + PAD_TOP + 'px',
              height: (workingEnd - workingStart) * PX_PER_MIN + 'px',
              background:
                'linear-gradient(180deg, rgba(255,250,237,0.55), rgba(255,250,237,0.20))',
              borderLeft: '1.5px solid rgba(28,20,11,0.32)',
            }}
            transition={{ type: 'spring', stiffness: 200, damping: 28 }}
          />

          {/* Hour rules */}
          {hours.map((h) => {
            const top = (h - visibleStart) * PX_PER_MIN + PAD_TOP;
            const isWorking = h >= workingStart && h < workingEnd;
            return (
              <div
                key={h}
                className="absolute left-0 right-0 flex items-start pointer-events-none timeline-bg"
                style={{ top: top + 'px', height: 60 * PX_PER_MIN + 'px' }}
              >
                <span
                  className={`font-mono text-[11px] tracking-wider tnum w-14 shrink-0 pr-2 -mt-1.5 text-right ${
                    isWorking ? 'text-ink-2' : 'text-ink-4'
                  }`}
                >
                  {formatHourLabel(h)}
                </span>
                <div
                  className="flex-1 timeline-bg"
                  style={{
                    borderTop: isWorking
                      ? '1px solid rgba(28,20,11,0.18)'
                      : '1px dashed rgba(28,20,11,0.10)',
                  }}
                />
              </div>
            );
          })}

          {/* Half-hour ticks */}
          {hours.map((h) => {
            const top = (h - visibleStart + 30) * PX_PER_MIN + PAD_TOP;
            if (h + 30 > visibleEnd) return null;
            return (
              <div
                key={`half-${h}`}
                className="absolute left-14 w-2 pointer-events-none"
                style={{
                  top: top + 'px',
                  borderTop: '1px dotted rgba(28,20,11,0.18)',
                }}
              />
            );
          })}

          {/* Now indicator */}
          {showNow && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
              className="absolute left-12 right-0 pointer-events-none z-20 flex items-center"
              style={{ top: (nowMin - visibleStart) * PX_PER_MIN + PAD_TOP + 'px' }}
            >
              <span className="relative ml-1.5 flex items-center justify-center w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-seal animate-sealPulse" />
                <span
                  className="relative w-1.5 h-1.5 rounded-full"
                  style={{ background: '#9e3a26', boxShadow: '0 0 6px rgba(158,58,38,0.45)' }}
                />
              </span>
              <span
                className="flex-1 h-px"
                style={{
                  background:
                    'linear-gradient(to right, rgba(158,58,38,0.7), rgba(158,58,38,0.0) 85%)',
                }}
              />
              <span className="smallcaps text-[11px] text-seal mr-1 tnum">
                Now
              </span>
            </motion.div>
          )}

          {/* Empty state */}
          {isEmpty && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
              className="absolute left-16 right-2 pointer-events-none flex flex-col items-center justify-center text-center px-6"
              style={{
                top: (workingStart - visibleStart) * PX_PER_MIN + PAD_TOP + 'px',
                height: (workingEnd - workingStart) * PX_PER_MIN + 'px',
              }}
            >
              <p
                className="font-display italic text-[18px] text-ink-3 mb-1"
                style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
              >
                A blank page.
              </p>
              <p className="text-[12.5px] text-ink-3 max-w-[28ch] leading-relaxed">
                Type tasks in <span className="font-medium text-ink-1">Morning intake</span>,
                then press <span className="font-medium text-ink-1">Build my day</span> —
                or click an hour to add a block by hand.
              </p>
            </motion.div>
          )}

          {/* Blocks */}
          <AnimatePresence initial={false}>
            {blocks.map((b, i) => {
              const isDragging = drag?.id === b.id;
              const start = isDragging ? drag!.ghost.start : b.start;
              const end = isDragging ? drag!.ghost.end : b.end;
              const top = (start - visibleStart) * PX_PER_MIN + PAD_TOP;
              const height = (end - start) * PX_PER_MIN;
              const style = CAT_STYLE[b.category];
              const done = !!b.completed;

              // Adaptive content tiers based on rendered block height:
              //   tiny:    title only, time inline
              //   compact: title + time, no category badge
              //   full:    category badge + title + time
              const tier: 'tiny' | 'compact' | 'full' =
                height < 32 ? 'tiny' : height < 54 ? 'compact' : 'full';

              return (
                <motion.div
                  key={b.id}
                  layout={!isDragging}
                  initial={{ opacity: 0, y: -4 }}
                  animate={{
                    opacity: done ? 0.6 : 1,
                    y: 0,
                  }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{
                    type: 'spring',
                    stiffness: 300,
                    damping: 30,
                    delay: isDragging ? 0 : Math.min(i * 0.02, 0.3),
                  }}
                  className="absolute left-16 right-2 cursor-grab active:cursor-grabbing group"
                  style={{
                    top: top + 'px',
                    height: height + 'px',
                    zIndex: isDragging ? 10 : 2,
                  }}
                  whileHover={!isDragging ? { y: -1 } : undefined}
                  onPointerDown={(e) => startDrag(e, b, 'move')}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEditBlock(b.id);
                  }}
                >
                  <div
                    className="relative h-full overflow-hidden"
                    style={{
                      background: done
                        ? 'linear-gradient(180deg, rgba(28,20,11,0.04), rgba(28,20,11,0.02))'
                        : `linear-gradient(180deg, ${style.tint}, ${style.tint} 70%, rgba(255,250,237,0.5))`,
                      border: `1px solid ${
                        done ? 'rgba(28,20,11,0.16)' : 'rgba(28,20,11,0.22)'
                      }`,
                      borderRadius: BLOCK_RADIUS + 'px',
                      boxShadow: isDragging
                        ? `0 14px 30px -10px rgba(28,20,11,0.35)`
                        : '0 1px 0 rgba(255,250,237,0.5) inset, 0 2px 6px -2px rgba(28,20,11,0.10)',
                    }}
                  >
                    {/* Resize handles — bigger hit area */}
                    <div
                      className="absolute top-0 left-0 right-0 cursor-ns-resize z-10"
                      style={{ height: '8px' }}
                      onPointerDown={(e) => startDrag(e, b, 'resize-top')}
                    />
                    <div
                      className="absolute bottom-0 left-0 right-0 cursor-ns-resize z-10"
                      style={{ height: '8px' }}
                      onPointerDown={(e) => startDrag(e, b, 'resize-bottom')}
                    />
                    {/* Category accent bar — rounded to match block radius */}
                    <div
                      className="absolute left-0 top-0 bottom-0"
                      style={{
                        width: '3px',
                        background: done ? 'rgba(28,20,11,0.28)' : style.bar,
                        borderTopLeftRadius: BLOCK_RADIUS + 'px',
                        borderBottomLeftRadius: BLOCK_RADIUS + 'px',
                      }}
                    />

                    {/* Content — adaptive layout */}
                    {tier === 'tiny' ? (
                      <div className="absolute inset-0 flex items-center pl-3 pr-14 gap-2">
                        <span
                          className="font-display text-[12.5px] leading-none truncate"
                          style={{
                            color: done ? '#867253' : style.ink,
                            fontWeight: 500,
                            fontVariationSettings: '"opsz" 24, "SOFT" 40',
                            textDecoration: done ? 'line-through' : undefined,
                            textDecorationColor: done ? 'rgba(28,20,11,0.4)' : undefined,
                          }}
                        >
                          {b.title}
                        </span>
                        <span
                          className="font-mono text-[10px] tnum tracking-wider shrink-0"
                          style={{ color: done ? '#867253' : '#6b5739' }}
                        >
                          {format12h(start).toUpperCase()}
                        </span>
                      </div>
                    ) : (
                      <div className="px-3 pl-3.5 pt-2 pb-1.5 h-full flex flex-col overflow-hidden">
                        {tier === 'full' && (
                          <span
                            className="smallcaps text-[10.5px] mb-0.5"
                            style={{
                              color: done ? '#867253' : style.bar,
                              opacity: 0.9,
                            }}
                          >
                            {style.label}
                          </span>
                        )}
                        <div
                          className="font-display text-[14px] leading-tight truncate pr-12"
                          style={{
                            color: done ? '#867253' : style.ink,
                            fontWeight: 500,
                            fontVariationSettings: '"opsz" 24, "SOFT" 40',
                            textDecoration: done ? 'line-through' : undefined,
                            textDecorationColor: done ? 'rgba(28,20,11,0.4)' : undefined,
                            textDecorationThickness: '1px',
                          }}
                        >
                          {b.title}
                        </div>
                        <div
                          className="font-mono text-[10.5px] mt-0.5 tnum tracking-wider"
                          style={{ color: done ? '#867253' : '#6b5739' }}
                        >
                          {format12h(start).toUpperCase()} – {format12h(end).toUpperCase()}
                        </div>
                      </div>
                    )}

                    {/* Always-visible action cluster (top-right) */}
                    <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 z-20">
                      <CompleteToggle
                        done={done}
                        accent={style.bar}
                        onToggle={() => onToggleComplete(b.id)}
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditBlock(b.id);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        aria-label="Edit block"
                        className="grid place-items-center w-7 h-7 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-4/80 opacity-50 group-hover:opacity-100 transition-opacity"
                      >
                        <Pencil size={12} strokeWidth={1.7} />
                      </button>
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  );
}

function CompleteToggle({
  done,
  accent,
  onToggle,
}: {
  done: boolean;
  accent: string;
  onToggle: () => void;
}) {
  return (
    <motion.button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      whileTap={{ scale: 0.88 }}
      whileHover={{ scale: 1.06 }}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      className="grid place-items-center"
      style={{
        width: '28px',
        height: '28px',
        borderRadius: '6px',
      }}
    >
      <span
        className="grid place-items-center"
        style={{
          width: '18px',
          height: '18px',
          borderRadius: '5px',
          background: done ? accent : 'rgba(255,250,237,0.85)',
          boxShadow: done
            ? `inset 0 0 0 1px ${accent}`
            : `inset 0 0 0 1.5px rgba(28,20,11,0.36)`,
        }}
      >
        <AnimatePresence initial={false} mode="wait">
          {done && (
            <motion.span
              key="check"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0, rotate: 90 }}
              transition={{ type: 'spring', stiffness: 500, damping: 22 }}
            >
              <Check size={11} className="text-paper-4" strokeWidth={3} />
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

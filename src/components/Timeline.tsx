import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import type { Block, Category } from '../types';
import { format12h, toDateKey } from '../utils/time';

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

const PX_PER_MIN = 1.3; // 78 px / hour
const SNAP = 5;
const PAD_TOP = 14; // breathing room so the first hour label isn't clipped

const CAT_STYLE: Record<
  Category,
  { gradient: string; border: string; text: string; accent: string; glow: string }
> = {
  deep: {
    gradient: 'linear-gradient(135deg, rgba(139,92,246,0.28), rgba(99,102,241,0.18))',
    border: 'rgba(167,139,250,0.45)',
    text: '#ddd6fe',
    accent: '#a78bfa',
    glow: 'rgba(139,92,246,0.35)',
  },
  admin: {
    gradient: 'linear-gradient(135deg, rgba(34,211,238,0.26), rgba(14,165,164,0.16))',
    border: 'rgba(103,232,249,0.45)',
    text: '#cffafe',
    accent: '#22d3ee',
    glow: 'rgba(34,211,238,0.30)',
  },
  break: {
    gradient: 'linear-gradient(135deg, rgba(245,158,11,0.26), rgba(217,119,6,0.16))',
    border: 'rgba(252,211,77,0.45)',
    text: '#fef3c7',
    accent: '#f59e0b',
    glow: 'rgba(245,158,11,0.28)',
  },
  other: {
    gradient: 'linear-gradient(135deg, rgba(148,163,184,0.22), rgba(100,116,139,0.14))',
    border: 'rgba(203,213,225,0.30)',
    text: '#e2e8f0',
    accent: '#94a3b8',
    glow: 'rgba(148,163,184,0.22)',
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

  return (
    <div className="relative bg-bg-1/80 glass border border-line-1 rounded-xl3 shadow-soft p-4 h-full overflow-hidden flex flex-col min-h-0">
      <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full bg-cat-deep/10 blur-3xl pointer-events-none" />
      <div className="relative flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-4 font-medium">
            Today's plan
          </h2>
          <span className="text-[10px] text-fg-5 tnum">· {blocks.length} blocks</span>
        </div>
        <p className="text-[10px] text-fg-5">
          Drag · resize edges · click empty to add
        </p>
      </div>
      <div className="relative flex-1 overflow-y-auto no-scrollbar -mx-1 px-1">
        <motion.div
          key={`timeline-${buildPulse}`}
          ref={ref}
          onClick={handleTimelineClick}
          className="relative select-none timeline-bg surface-grid"
          style={{ height: totalPx + 'px' }}
          initial={false}
        >
          {/* Working window highlight */}
          <motion.div
            layout
            className="absolute left-14 right-0 pointer-events-none rounded-xl2 timeline-bg"
            style={{
              top: (workingStart - visibleStart) * PX_PER_MIN + PAD_TOP + 'px',
              height: (workingEnd - workingStart) * PX_PER_MIN + 'px',
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.012))',
              borderLeft: '1px solid rgba(255,255,255,0.10)',
            }}
            transition={{ type: 'spring', stiffness: 200, damping: 28 }}
          />

          {/* Hour rows */}
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
                  className={`text-[10px] tnum w-14 shrink-0 pr-2 -mt-1.5 ${
                    isWorking ? 'text-fg-3' : 'text-fg-5'
                  }`}
                >
                  {format12h(h)}
                </span>
                <div
                  className={`flex-1 border-t timeline-bg ${
                    isWorking ? 'border-white/[0.06]' : 'border-white/[0.03]'
                  }`}
                />
              </div>
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
                <span className="absolute inset-0 rounded-full bg-rose-400 animate-pulseSoft" />
                <span className="relative w-1.5 h-1.5 rounded-full bg-rose-400 shadow-[0_0_10px_#fb7185]" />
              </span>
              <span
                className="flex-1 h-px"
                style={{
                  background:
                    'linear-gradient(to right, rgba(251,113,133,0.85), rgba(251,113,133,0.0))',
                }}
              />
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
              return (
                <motion.div
                  key={b.id}
                  layout={!isDragging}
                  initial={{ opacity: 0, y: -8, scale: 0.97 }}
                  animate={{
                    opacity: done ? 0.55 : 1,
                    y: 0,
                    scale: 1,
                  }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{
                    type: 'spring',
                    stiffness: 320,
                    damping: 28,
                    delay: isDragging ? 0 : Math.min(i * 0.025, 0.4),
                  }}
                  className="absolute left-16 right-2 rounded-xl3 overflow-hidden cursor-grab active:cursor-grabbing group"
                  style={{
                    top: top + 'px',
                    height: height + 'px',
                    background: done
                      ? 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015))'
                      : style.gradient,
                    border: `1px solid ${done ? 'rgba(255,255,255,0.10)' : style.border}`,
                    boxShadow: isDragging
                      ? `0 18px 44px ${style.glow}, 0 0 0 1px ${style.border}`
                      : done
                        ? '0 2px 10px rgba(0,0,0,0.25)'
                        : `0 6px 18px ${style.glow}`,
                    zIndex: isDragging ? 10 : 2,
                    backdropFilter: 'blur(6px)',
                  }}
                  whileHover={!isDragging ? { y: -1 } : undefined}
                  onPointerDown={(e) => startDrag(e, b, 'move')}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    onEditBlock(b.id);
                  }}
                >
                  <div
                    className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize z-10"
                    onPointerDown={(e) => startDrag(e, b, 'resize-top')}
                  />
                  <div
                    className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize z-10"
                    onPointerDown={(e) => startDrag(e, b, 'resize-bottom')}
                  />
                  <div
                    className="absolute left-0 top-0 bottom-0 w-[3px]"
                    style={{
                      background: done ? 'rgba(255,255,255,0.18)' : style.accent,
                      boxShadow: done ? undefined : `0 0 12px ${style.glow}`,
                    }}
                  />
                  <div className="px-3 py-2 pl-9 h-full flex flex-col overflow-hidden">
                    <div
                      className="text-[13px] font-medium leading-tight truncate"
                      style={{
                        color: done ? '#94a3b8' : style.text,
                        textDecoration: done ? 'line-through' : undefined,
                        textDecorationColor: done ? 'rgba(255,255,255,0.35)' : undefined,
                      }}
                    >
                      {b.title}
                    </div>
                    <div
                      className="text-[10.5px] mt-0.5 tnum tracking-wide opacity-80"
                      style={{ color: done ? '#64748b' : style.text }}
                    >
                      {format12h(start)} – {format12h(end)}
                    </div>
                  </div>
                  <CompleteToggle
                    done={done}
                    accent={style.accent}
                    glow={style.glow}
                    onToggle={() => onToggleComplete(b.id)}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onEditBlock(b.id);
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute top-1.5 right-1.5 px-2 py-0.5 text-[10px] rounded-full bg-white/10 hover:bg-white/20 text-white/90 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur"
                  >
                    Edit
                  </button>
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
  glow,
  onToggle,
}: {
  done: boolean;
  accent: string;
  glow: string;
  onToggle: () => void;
}) {
  return (
    <motion.button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      whileTap={{ scale: 0.85 }}
      whileHover={{ scale: 1.1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      className="absolute top-2 left-2 w-5 h-5 rounded-full grid place-items-center z-20 transition-colors"
      style={{
        background: done ? accent : 'rgba(255,255,255,0.08)',
        boxShadow: done
          ? `0 0 14px ${glow}, inset 0 0 0 1px ${accent}`
          : 'inset 0 0 0 1px rgba(255,255,255,0.18)',
      }}
    >
      <AnimatePresence initial={false} mode="wait">
        {done ? (
          <motion.span
            key="check"
            initial={{ scale: 0, rotate: -90 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0, rotate: 90 }}
            transition={{ type: 'spring', stiffness: 500, damping: 22 }}
          >
            <Check size={12} className="text-white" strokeWidth={3} />
          </motion.span>
        ) : (
          <motion.span
            key="empty"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            exit={{ scale: 0 }}
            transition={{ duration: 0.12 }}
            className="block w-1.5 h-1.5 rounded-full bg-white/30"
          />
        )}
      </AnimatePresence>
    </motion.button>
  );
}

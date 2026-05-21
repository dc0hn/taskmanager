import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, Sparkles, X, Trash2, Clock, Flag, Pencil } from 'lucide-react';
import { CATEGORIES } from '../types';
import type { Category, Task } from '../types';
import { DURATION_PRESETS, parseTaskLine } from '../parser';
import { format12h, formatDuration } from '../utils/time';

interface Props {
  tasks: Task[];
  overflow: Task[];
  onAddTasks: (tasks: Task[]) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onRemoveTask: (id: string) => void;
  onBuildDay: () => void;
  onClearOverflow: () => void;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function makeTask(parsed: ReturnType<typeof parseTaskLine>): Task | null {
  if (!parsed.title) return null;
  return {
    id: uid(),
    title: parsed.title,
    duration: parsed.duration ?? 60,
    category: parsed.category ?? 'other',
    fixedTime: parsed.fixedTime,
    priority: parsed.priority ?? 'normal',
  };
}

const CAT_TINT: Record<Category, { bg: string; ring: string; dot: string; text: string }> = {
  deep: {
    bg: 'rgba(139,92,246,0.10)',
    ring: 'rgba(139,92,246,0.30)',
    dot: '#a78bfa',
    text: '#c4b5fd',
  },
  admin: {
    bg: 'rgba(34,211,238,0.10)',
    ring: 'rgba(34,211,238,0.30)',
    dot: '#22d3ee',
    text: '#67e8f9',
  },
  break: {
    bg: 'rgba(245,158,11,0.10)',
    ring: 'rgba(245,158,11,0.30)',
    dot: '#f59e0b',
    text: '#fbbf24',
  },
  other: {
    bg: 'rgba(148,163,184,0.10)',
    ring: 'rgba(148,163,184,0.25)',
    dot: '#94a3b8',
    text: '#cbd5e1',
  },
};

export default function IntakePanel({
  tasks,
  overflow,
  onAddTasks,
  onUpdateTask,
  onRemoveTask,
  onBuildDay,
  onClearOverflow,
}: Props) {
  const [value, setValue] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  function submit() {
    const lines = value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;
    const newTasks: Task[] = [];
    for (const line of lines) {
      const parsed = parseTaskLine(line);
      const t = makeTask(parsed);
      if (t) newTasks.push(t);
    }
    if (newTasks.length === 0) return;
    onAddTasks(newTasks);
    setValue('');
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex flex-col gap-5 flex-1 min-h-0">
      <motion.div
        layout
        className="relative bg-bg-1/80 glass border border-line-1 rounded-xl5 shadow-soft p-5 overflow-hidden shrink-0"
      >
        <div className="absolute -top-12 -right-12 w-40 h-40 rounded-full bg-cat-deep/15 blur-3xl pointer-events-none" />
        <div className="relative flex items-center justify-between mb-3">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-4 font-medium">
            Morning intake
          </h2>
          <span className="text-[10px] text-fg-5">
            Try <code className="bg-white/5 px-1.5 py-0.5 rounded text-fg-3">@2pm 30m !high</code>
          </span>
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to get done today?&#10;One task per line. Press Enter to add."
          className="relative w-full min-h-[92px] resize-y rounded-xl2 border border-line-1 bg-bg-2/60 text-fg-1 placeholder:text-fg-5 focus:outline-none focus:focus-ring px-3 py-2.5 text-sm leading-relaxed transition-all"
        />
        <div className="relative flex items-center justify-between gap-2 mt-3">
          <button
            onClick={submit}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-fg-2 hover:text-fg-0 px-2.5 py-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <Plus size={13} />
            Add task
          </button>
          <BuildButton onClick={onBuildDay} disabled={tasks.length === 0} />
        </div>
      </motion.div>

      <div className="bg-bg-1/80 glass border border-line-1 rounded-xl5 shadow-soft p-5 flex flex-col flex-1 min-h-[160px]">
        <div className="flex items-center justify-between mb-3 shrink-0">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-fg-4 font-medium">
            Unscheduled <span className="text-fg-5 font-normal normal-case tracking-normal">· {tasks.length}</span>
          </h2>
        </div>
        <div className="overflow-y-auto no-scrollbar -mx-1 px-1 flex-1 min-h-0">
          {tasks.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-fg-4 py-8 text-center"
            >
              No tasks yet — add what you want to get done today.
            </motion.p>
          ) : (
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {tasks.map((t) => {
                  const tint = CAT_TINT[t.category];
                  return (
                    <motion.li
                      key={t.id}
                      layout
                      initial={{ opacity: 0, y: -6, scale: 0.98 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, x: 20, scale: 0.97 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                      className="group rounded-xl2 px-2.5 py-2 border"
                      style={{ background: tint.bg, borderColor: tint.ring }}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="mt-1.5 inline-block w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ background: tint.dot, boxShadow: `0 0 8px ${tint.dot}` }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-sm text-fg-0">
                            <span className="truncate">{t.title}</span>
                            {t.priority === 'high' && (
                              <Flag size={12} className="text-rose shrink-0" />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[11px] text-fg-3 tnum">
                            <span className="inline-flex items-center gap-0.5">
                              <Clock size={11} />
                              {formatDuration(t.duration)}
                            </span>
                            {t.fixedTime != null && (
                              <span className="text-fg-4">· at {format12h(t.fixedTime)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setOpenId(openId === t.id ? null : t.id)}
                            className="p-1 rounded hover:bg-white/10 text-fg-3 hover:text-fg-0"
                            aria-label="Edit task"
                          >
                            <Pencil size={12} />
                          </button>
                          <button
                            onClick={() => onRemoveTask(t.id)}
                            className="p-1 rounded hover:bg-white/10 text-fg-3 hover:text-rose"
                            aria-label="Remove task"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>
                      <AnimatePresence>
                        {openId === t.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
                            className="overflow-hidden"
                          >
                            <TaskEditor
                              task={t}
                              onChange={(patch) => onUpdateTask(t.id, patch)}
                              onClose={() => setOpenId(null)}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>

      <AnimatePresence>
        {overflow.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="bg-rose-500/10 border border-rose-500/30 rounded-xl3 p-3.5"
          >
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-xs font-medium text-rose-300">
                Didn't fit ({overflow.length})
              </h3>
              <button
                onClick={onClearOverflow}
                className="text-rose-300/80 hover:text-rose-200"
                aria-label="Dismiss overflow"
              >
                <X size={14} />
              </button>
            </div>
            <ul className="text-[11px] text-rose-200/90 space-y-0.5">
              {overflow.map((t) => (
                <li key={t.id} className="tnum">
                  · {t.title}{' '}
                  <span className="opacity-70">({formatDuration(t.duration)})</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BuildButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      whileHover={!disabled ? { scale: 1.02 } : undefined}
      whileTap={!disabled ? { scale: 0.97 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 22 }}
      className={`relative inline-flex items-center gap-1.5 text-xs font-semibold px-3.5 py-2 rounded-xl2 overflow-hidden ${
        disabled
          ? 'bg-white/5 text-fg-5 cursor-not-allowed'
          : 'text-white shadow-glow'
      }`}
      style={
        disabled
          ? undefined
          : {
              backgroundImage:
                'linear-gradient(135deg, #7c3aed 0%, #6366f1 45%, #22d3ee 100%)',
            }
      }
    >
      {!disabled && (
        <span className="absolute inset-0 shimmer animate-shimmer pointer-events-none" />
      )}
      <Sparkles size={13} className="relative" />
      <span className="relative">Build my day</span>
    </motion.button>
  );
}

function TaskEditor({
  task,
  onChange,
  onClose,
}: {
  task: Task;
  onChange: (patch: Partial<Task>) => void;
  onClose: () => void;
}) {
  return (
    <div className="mt-2 pt-2 border-t border-white/10 space-y-2.5">
      <div>
        <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1">
          Title
        </label>
        <input
          value={task.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="w-full text-sm rounded-lg border border-line-2 bg-bg-1 px-2 py-1.5 text-fg-1 focus:outline-none focus:focus-ring"
        />
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1">
          Duration
        </label>
        <div className="flex flex-wrap gap-1">
          {DURATION_PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => onChange({ duration: d })}
              className={`text-[11px] px-2.5 py-1 rounded-full tnum transition-all ${
                task.duration === d
                  ? 'bg-white text-bg-0 shadow'
                  : 'bg-white/5 text-fg-2 hover:bg-white/10'
              }`}
            >
              {d}m
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1">
          Category
        </label>
        <div className="flex flex-wrap gap-1">
          {CATEGORIES.map((c) => {
            const active = task.category === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onChange({ category: c.id })}
                className={`text-[11px] px-2.5 py-1 rounded-full inline-flex items-center gap-1 transition-all border`}
                style={{
                  background: active ? c.bg : 'rgba(255,255,255,0.03)',
                  borderColor: active ? c.accent : 'rgba(255,255,255,0.08)',
                  color: active ? c.accent : '#cbd5e1',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: c.accent, boxShadow: `0 0 6px ${c.accent}` }}
                />
                {c.label.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1">
            Fixed time
          </label>
          <input
            type="time"
            value={
              task.fixedTime != null
                ? `${String(Math.floor(task.fixedTime / 60)).padStart(2, '0')}:${String(task.fixedTime % 60).padStart(2, '0')}`
                : ''
            }
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return onChange({ fixedTime: undefined });
              const [h, m] = v.split(':').map(Number);
              onChange({ fixedTime: h * 60 + m });
            }}
            className="w-full text-sm rounded-lg border border-line-2 bg-bg-1 px-2 py-1.5 tnum text-fg-1 focus:outline-none focus:focus-ring"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1">
            Priority
          </label>
          <button
            onClick={() =>
              onChange({ priority: task.priority === 'high' ? 'normal' : 'high' })
            }
            className={`text-[11px] px-2 py-1.5 rounded-lg inline-flex items-center gap-1 transition-all ${
              task.priority === 'high'
                ? 'bg-rose-500/20 text-rose-200 border border-rose-500/30'
                : 'bg-white/5 text-fg-2 hover:bg-white/10 border border-line-1'
            }`}
          >
            <Flag size={11} />
            {task.priority === 'high' ? 'High' : 'Normal'}
          </button>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="text-[11px] text-fg-3 hover:text-fg-0 px-2 py-1 rounded"
        >
          Done
        </button>
      </div>
    </div>
  );
}

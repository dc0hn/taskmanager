import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Plus, X, Trash2, Clock, Flag, Pencil } from 'lucide-react';
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

// Editorial chip palette
const CAT_TINT: Record<Category, { tint: string; bar: string; ink: string; label: string }> = {
  deep: { tint: 'rgba(122,37,48,0.08)', bar: '#7a2530', ink: '#4a131c', label: 'Deep' },
  admin: { tint: 'rgba(31,59,93,0.08)', bar: '#1f3b5d', ink: '#15263e', label: 'Admin' },
  break: { tint: 'rgba(176,119,32,0.11)', bar: '#b07720', ink: '#6e4810', label: 'Break' },
  other: { tint: 'rgba(74,61,46,0.06)', bar: '#4a3d2e', ink: '#3a2e22', label: 'Other' },
};

const CHIP_RADIUS = 8;

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
      {/* Intake notepad */}
      <motion.div
        layout
        className="relative paper-card rounded-xl5 p-5 shrink-0"
      >
        <div className="relative flex items-baseline justify-between mb-3">
          <h2 className="font-display text-[18px] leading-none text-ink-1" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50', fontWeight: 500 }}>
            Morning intake
          </h2>
          <span className="font-mono text-[11px] text-ink-3 tracking-wider">
            <span>@2pm</span> · <span>30m</span> · <span>!high</span>
          </span>
        </div>
        <div className="rule-h mb-3" />
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="What do you want to get done today?&#10;One task per line. Press Enter to add."
          className="ledger-lines relative w-full min-h-[112px] resize-y bg-paper-4/40 text-ink-1 placeholder:text-ink-3 placeholder:italic focus:outline-none focus:focus-ring px-3 py-1 text-[15px] leading-7 transition-all font-display rounded-md border border-rule-3"
          style={{ fontVariationSettings: '"opsz" 12, "SOFT" 0' }}
        />
        <div className="relative flex items-center justify-between gap-2 mt-3">
          <button
            onClick={submit}
            className="inline-flex items-center gap-1.5 smallcaps text-[11px] text-ink-2 hover:text-ink-0 hover:bg-paper-3 px-3 py-2 rounded-md transition-colors min-h-[36px]"
          >
            <Plus size={14} strokeWidth={1.8} />
            Add task
          </button>
          <BuildButton onClick={onBuildDay} disabled={tasks.length === 0} />
        </div>
      </motion.div>

      {/* Unscheduled queue */}
      <div className="paper-card rounded-xl5 p-5 flex flex-col flex-1 min-h-[180px]">
        <div className="flex items-baseline justify-between mb-3 shrink-0">
          <h2 className="font-display text-[18px] leading-none text-ink-1" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50', fontWeight: 500 }}>
            Unscheduled
          </h2>
          <span className="font-mono text-[11px] text-ink-3 tracking-wider tnum">
            {String(tasks.length).padStart(2, '0')} {tasks.length === 1 ? 'item' : 'items'}
          </span>
        </div>
        <div className="rule-h mb-2" />
        <div className="overflow-y-auto no-scrollbar -mx-1 px-1 flex-1 min-h-0">
          {tasks.length === 0 ? (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="font-display italic text-[14px] text-ink-3 py-8 text-center"
              style={{ fontVariationSettings: '"opsz" 24, "SOFT" 80' }}
            >
              The page is blank — write the day above.
            </motion.p>
          ) : (
            <ul className="space-y-2">
              <AnimatePresence initial={false}>
                {tasks.map((t) => {
                  const tint = CAT_TINT[t.category];
                  return (
                    <motion.li
                      key={t.id}
                      layout
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 16 }}
                      transition={{ type: 'spring', stiffness: 360, damping: 30 }}
                      className="group relative overflow-hidden"
                      style={{
                        background: tint.tint,
                        border: '1px solid rgba(28,20,11,0.18)',
                        borderRadius: CHIP_RADIUS + 'px',
                        boxShadow: '0 1px 0 rgba(255,250,237,0.5) inset',
                      }}
                    >
                      {/* Left accent bar — rounded corners match chip */}
                      <span
                        className="absolute left-0 top-0 bottom-0"
                        style={{
                          width: '3px',
                          background: tint.bar,
                          borderTopLeftRadius: CHIP_RADIUS + 'px',
                          borderBottomLeftRadius: CHIP_RADIUS + 'px',
                        }}
                      />
                      <div className="pl-3.5 pr-2 py-2 flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="smallcaps text-[10.5px] shrink-0"
                              style={{ color: tint.bar, opacity: 0.95 }}
                            >
                              {tint.label}
                            </span>
                            {t.priority === 'high' && (
                              <span
                                className="smallcaps text-[10.5px] shrink-0 px-1.5 py-0.5 rounded-sm"
                                style={{
                                  color: '#9e3a26',
                                  border: '1px solid rgba(158,58,38,0.45)',
                                }}
                              >
                                High
                              </span>
                            )}
                          </div>
                          <div
                            className="font-display text-[14.5px] text-ink-1 truncate mt-0.5"
                            style={{ fontVariationSettings: '"opsz" 24, "SOFT" 40', fontWeight: 500 }}
                          >
                            {t.title}
                          </div>
                          <div className="flex items-center gap-2 mt-1 font-mono text-[11px] text-ink-3 tnum tracking-wider">
                            <span className="inline-flex items-center gap-1">
                              <Clock size={11} strokeWidth={1.7} />
                              {formatDuration(t.duration)}
                            </span>
                            {t.fixedTime != null && (
                              <span className="text-ink-3">· {format12h(t.fixedTime).toUpperCase()}</span>
                            )}
                          </div>
                        </div>
                        {/* Always-visible action cluster (40% by default, 100% on hover) */}
                        <div className="flex items-center gap-0.5 opacity-50 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setOpenId(openId === t.id ? null : t.id)}
                            className="grid place-items-center w-7 h-7 rounded-md hover:bg-paper-4 text-ink-3 hover:text-ink-0 transition-colors"
                            aria-label="Edit task"
                          >
                            <Pencil size={13} strokeWidth={1.7} />
                          </button>
                          <button
                            onClick={() => onRemoveTask(t.id)}
                            className="grid place-items-center w-7 h-7 rounded-md hover:bg-paper-4 text-ink-3 hover:text-seal transition-colors"
                            aria-label="Remove task"
                          >
                            <Trash2 size={13} strokeWidth={1.7} />
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
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="relative paper-card rounded-xl4 p-4"
            style={{
              borderColor: 'rgba(158,58,38,0.36)',
              background:
                'linear-gradient(180deg, rgba(158,58,38,0.07), rgba(158,58,38,0.02))',
            }}
          >
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="font-display text-[15px] text-seal" style={{ fontVariationSettings: '"opsz" 24, "SOFT" 40', fontWeight: 500 }}>
                Didn't fit · {overflow.length}
              </h3>
              <button
                onClick={onClearOverflow}
                className="grid place-items-center w-7 h-7 rounded-md text-seal/70 hover:text-seal hover:bg-paper-4/60"
                aria-label="Dismiss overflow"
              >
                <X size={14} strokeWidth={1.8} />
              </button>
            </div>
            <ul className="font-mono text-[11.5px] text-ink-2 space-y-0.5 tnum">
              {overflow.map((t) => (
                <li key={t.id}>
                  · {t.title}{' '}
                  <span className="text-ink-3">({formatDuration(t.duration)})</span>
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
      whileHover={!disabled ? { scale: 1.02, rotate: -0.4 } : undefined}
      whileTap={!disabled ? { scale: 0.97, rotate: 0.4 } : undefined}
      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
      className={`relative inline-flex items-center gap-2 smallcaps text-[12px] px-4 py-2.5 rounded-md transition-colors min-h-[40px] ${
        disabled
          ? 'bg-paper-2 text-ink-4 border border-rule-1 cursor-not-allowed'
          : 'text-paper-4 stamp-shadow'
      }`}
      style={
        disabled
          ? undefined
          : {
              background:
                'linear-gradient(180deg, #b14935 0%, #9e3a26 55%, #832c1b 100%)',
            }
      }
    >
      <span
        className="relative inline-block w-1.5 h-1.5 rounded-full"
        style={{ background: disabled ? '#9a8460' : '#fcd9a8' }}
      />
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
    <div className="mx-3 mb-3 pt-2.5 border-t border-rule-3 space-y-3">
      <div>
        <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1">
          Title
        </label>
        <input
          value={task.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="w-full font-display text-[13.5px] rounded border border-rule-3 bg-paper-4 px-2.5 py-1.5 text-ink-1 focus:outline-none focus:focus-ring"
        />
      </div>
      <div>
        <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1">
          Duration
        </label>
        <div className="flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((d) => (
            <button
              key={d}
              onClick={() => onChange({ duration: d })}
              className={`font-mono text-[11.5px] px-2.5 py-1.5 rounded tnum tracking-wider transition-all border ${
                task.duration === d
                  ? 'bg-ink-1 text-paper-4 border-ink-1'
                  : 'bg-paper-4 text-ink-2 hover:bg-paper-3 border-rule-3'
              }`}
            >
              {d}m
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1">
          Category
        </label>
        <div className="flex flex-wrap gap-1.5">
          {CATEGORIES.map((c) => {
            const active = task.category === c.id;
            return (
              <button
                key={c.id}
                onClick={() => onChange({ category: c.id })}
                className="text-[11.5px] font-medium px-2.5 py-1.5 rounded inline-flex items-center gap-1.5 tracking-wide uppercase transition-all border"
                style={{
                  background: active ? c.bg : 'rgba(255,250,237,0.45)',
                  borderColor: active ? c.accent : 'rgba(28,20,11,0.18)',
                  color: active ? c.accent : '#3a2c1c',
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.accent }} />
                {c.label.split(' ')[0]}
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1">
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
            className="w-full font-mono text-[13px] rounded border border-rule-3 bg-paper-4 px-2.5 py-1.5 tnum text-ink-1 focus:outline-none focus:focus-ring"
          />
        </div>
        <div>
          <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1">
            Priority
          </label>
          <button
            onClick={() =>
              onChange({ priority: task.priority === 'high' ? 'normal' : 'high' })
            }
            className={`text-[11.5px] font-medium px-2.5 py-2 rounded inline-flex items-center gap-1 transition-all tracking-wide uppercase border ${
              task.priority === 'high'
                ? 'text-seal'
                : 'text-ink-2 hover:bg-paper-3'
            }`}
            style={{
              background: task.priority === 'high' ? 'rgba(158,58,38,0.08)' : 'rgba(255,250,237,0.45)',
              borderColor: task.priority === 'high' ? 'rgba(158,58,38,0.45)' : 'rgba(28,20,11,0.18)',
            }}
          >
            <Flag size={11} strokeWidth={1.7} />
            {task.priority === 'high' ? 'High' : 'Normal'}
          </button>
        </div>
      </div>
      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="smallcaps text-[11px] text-ink-3 hover:text-ink-0 hover:bg-paper-3 px-2.5 py-1.5 rounded transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

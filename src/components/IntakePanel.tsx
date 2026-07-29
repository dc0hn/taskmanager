import { memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Clock, Flag, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import type {
  CategoryDef,
  GoalProgress,
  RecurringTask,
  Task,
  WeeklyGoal,
} from '../types';
import type { TemplateStatus } from '../recurrence';
import { buildCategoryTokens, DURATION_PRESETS, parseTaskLine } from '../parser';
import { categoryColors, colorsFor } from '../utils/color';
import { format12h, formatDuration } from '../utils/time';
import { uid } from '../utils/id';
import SuggestionChips from './SuggestionChips';

// ============================================================================
// IntakePanel — the morning ritual.
//
// Type what you want to get done, one line per task, then press Build my day.
// Inline shorthand is parsed here (see src/parser.ts) against the *live* category
// list, so a custom "Music practice" category is addressable as #music-practice
// without anything being registered.
// ============================================================================

interface Props {
  tasks: Task[];
  overflow: Task[];
  /** Why each overflowed task didn't fit, keyed by task id. */
  overflowReasons: Record<string, string>;
  categories: CategoryDef[];
  openGoals: GoalProgress[];
  dueRoutines: TemplateStatus[];
  onAddTasks: (tasks: Task[]) => void;
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onRemoveTask: (id: string) => void;
  onBuildDay: () => void;
  onClearOverflow: () => void;
  onAddGoal: (goal: WeeklyGoal) => void;
  onAddRoutine: (template: RecurringTask) => void;
  onAddPaired: (goal: WeeklyGoal, template: RecurringTask) => void;
}

function IntakePanel({
  tasks,
  overflow,
  overflowReasons,
  categories,
  openGoals,
  dueRoutines,
  onAddTasks,
  onUpdateTask,
  onRemoveTask,
  onBuildDay,
  onClearOverflow,
  onAddGoal,
  onAddRoutine,
  onAddPaired,
}: Props) {
  const [value, setValue] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = useMemo(
    () => [...categories].sort((a, b) => a.order - b.order),
    [categories]
  );
  const [intakeCat, setIntakeCat] = useState<string>(sorted[0]?.id ?? 'other');
  const tokens = useMemo(() => buildCategoryTokens(categories), [categories]);

  // A category can be deleted while it is still selected here.
  const activeCat = sorted.some((c) => c.id === intakeCat)
    ? intakeCat
    : (sorted[0]?.id ?? 'other');

  function submit() {
    const lines = value
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return;

    const newTasks: Task[] = [];
    for (const line of lines) {
      const parsed = parseTaskLine(line, tokens);
      if (!parsed.title) continue;
      newTasks.push({
        id: uid(),
        title: parsed.title,
        duration: parsed.duration ?? 60,
        // An inline #token wins; otherwise the selected chip.
        category: parsed.category ?? activeCat,
        fixedTime: parsed.fixedTime,
        priority: parsed.priority ?? 'normal',
      });
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
    // ⌘/Ctrl+Enter builds straight from the box.
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
      onBuildDay();
    }
  }

  return (
    // Auto height, not flex-1: this panel lives inside a sidebar that scrolls as
    // a single column, so a percentage-height child would collapse and let its
    // contents spill over the card below it.
    <div className="flex flex-col gap-3">
      {/* ---------------- intake ---------------- */}
      <div className="panel py-6">
        <div className="flex items-baseline justify-between mb-4">
          <span className="legend">Intake</span>
          <span className="font-mono text-nano text-bone-3 tracking-wide">
            @2pm · 30m · !high · #deep
          </span>
        </div>

        <SuggestionChips
          openGoals={openGoals}
          dueRoutines={dueRoutines}
          categories={categories}
          onAddGoal={onAddGoal}
          onAddRoutine={onAddRoutine}
          onAddPaired={onAddPaired}
        />

        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={'What needs doing?\nOne per line — Enter to add, ⌘Enter to build.'}
          className="ledger-lines input w-full min-h-[92px] resize-y px-2.5 py-1 text-body-sm leading-7 focus:outline-none"
        />

        <div className="mt-2.5 flex items-center gap-1 flex-wrap">
          {sorted.map((cat) => {
            const active = activeCat === cat.id;
            const c = colorsFor(cat.accent);
            return (
              <button
                key={cat.id}
                onClick={() => setIntakeCat(cat.id)}
                aria-pressed={active}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm text-micro font-medium transition-all"
                style={{
                  background: active ? c.fillStrong : 'rgba(245, 242, 236,0.035)',
                  border: `1px solid ${active ? c.line : 'var(--rule-2)'}`,
                  color: active ? c.text : 'var(--bone-3)',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: cat.accent }}
                />
                {cat.short}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-2 mt-3">
          <button
            onClick={submit}
            className="btn-quiet inline-flex items-center gap-1.5 text-body-sm font-medium px-2.5 py-2 rounded"
          >
            <Plus size={13} strokeWidth={2.2} />
            Add
          </button>
          <motion.button
            onClick={onBuildDay}
            disabled={tasks.length === 0}
            whileHover={tasks.length > 0 ? { scale: 1.02 } : undefined}
            whileTap={tasks.length > 0 ? { scale: 0.97 } : undefined}
            transition={{ type: 'spring', stiffness: 420, damping: 24 }}
            className="btn-primary inline-flex items-center gap-1.5 text-body-sm font-semibold px-3.5 py-2 rounded"
          >
            <Sparkles size={13} strokeWidth={2.2} />
            Build my day
          </motion.button>
        </div>
      </div>

      {/* ---------------- unscheduled queue ---------------- */}
      <div className="panel py-6 flex flex-col">
        <div className="flex items-baseline justify-between mb-2 shrink-0">
          <span className="legend">Unscheduled</span>
          <span className="font-mono text-nano text-bone-3 tnum tracking-wide">
            {String(tasks.length).padStart(2, '0')}
          </span>
        </div>
        <div className="rule-h mb-2" />

        {/* Capped rather than flex-filled, so a long queue scrolls itself
            instead of stretching the sidebar. */}
        <div className="max-h-[340px] overflow-y-auto thin-scroll -mx-1 px-1">
          {tasks.length === 0 ? (
            <p className="text-body-sm text-bone-3 py-6 text-center leading-relaxed">
              Nothing queued.
              <br />
              Write the day above.
            </p>
          ) : (
            <ul className="space-y-1.5">
              <AnimatePresence initial={false}>
                {tasks.map((t) => {
                  const c = categoryColors(t.category, categories);
                  const cat = sorted.find((x) => x.id === t.category);
                  return (
                    <motion.li
                      key={t.id}
                      layout
                      initial={{ opacity: 0, y: -3 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: 14 }}
                      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                      className="group relative overflow-hidden rounded"
                      style={{
                        background: c.fill,
                        border: '1px solid var(--rule-2)',
                        borderLeft: `2.5px solid ${c.accent}`,
                      }}
                    >
                      <div className="px-2.5 py-2 flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className="smallcaps text-nano"
                              style={{ color: c.accent }}
                            >
                              {cat?.short ?? '—'}
                            </span>
                            {t.priority === 'high' && (
                              <span
                                className="smallcaps text-nano px-1 py-[1px] rounded"
                                style={{
                                  color: 'var(--flag)',
                                  border: '1px solid rgba(232, 148, 74,0.45)',
                                }}
                              >
                                High
                              </span>
                            )}
                            {t.goalId && (
                              <span
                                className="smallcaps text-nano"
                                style={{ color: 'var(--bone-0)' }}
                                title="From a weekly goal"
                              >
                                Goal
                              </span>
                            )}
                            {t.templateId && (
                              <span
                                className="smallcaps text-nano"
                                style={{ color: 'var(--good)' }}
                                title="From a routine"
                              >
                                Routine
                              </span>
                            )}
                          </div>
                          <div className="text-body-sm font-medium text-ink-1 truncate mt-0.5">
                            {t.title}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 font-mono text-nano text-ink-3 tnum tracking-wide">
                            <span className="inline-flex items-center gap-1">
                              <Clock size={10} strokeWidth={2} />
                              {formatDuration(t.duration)}
                            </span>
                            {t.fixedTime != null && (
                              <span>· {format12h(t.fixedTime)}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-0.5 opacity-40 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setOpenId(openId === t.id ? null : t.id)}
                            aria-label="Edit task"
                            className="grid place-items-center w-6 h-6 rounded-sm text-ink-3 hover:text-ink-0 hover:bg-paper-4 transition-colors"
                          >
                            <Pencil size={12} strokeWidth={1.9} />
                          </button>
                          <button
                            onClick={() => onRemoveTask(t.id)}
                            aria-label="Remove task"
                            className="grid place-items-center w-6 h-6 rounded-sm text-ink-3 hover:text-bad hover:bg-paper-4 transition-colors"
                          >
                            <Trash2 size={12} strokeWidth={1.9} />
                          </button>
                        </div>
                      </div>

                      <AnimatePresence>
                        {openId === t.id && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                            className="overflow-hidden"
                          >
                            <TaskEditor
                              task={t}
                              categories={sorted}
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

      {/* ---------------- overflow, with reasons ---------------- */}
      <AnimatePresence>
        {overflow.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="rounded-xl4 p-3"
            style={{
              border: '1px solid rgba(255, 176, 31,0.42)',
              background: 'rgba(255, 176, 31,0.07)',
            }}
          >
            <div className="flex items-baseline justify-between mb-1.5">
              <h3 className="smallcaps text-nano text-warn">
                Didn't fit · {overflow.length}
              </h3>
              <button
                onClick={onClearOverflow}
                aria-label="Dismiss"
                className="grid place-items-center w-6 h-6 rounded-sm text-warn/70 hover:text-warn hover:bg-paper-4 transition-colors"
              >
                <X size={12} strokeWidth={2.2} />
              </button>
            </div>
            <ul className="space-y-1.5">
              {overflow.map((t) => (
                <li key={t.id}>
                  <div className="text-body-sm text-ink-1 font-medium">
                    {t.title}{' '}
                    <span className="font-mono text-nano text-ink-3 tnum">
                      ({formatDuration(t.duration)})
                    </span>
                  </div>
                  {/* Never say "didn't fit" without saying why. */}
                  {overflowReasons[t.id] && (
                    <div className="text-micro text-ink-3 leading-snug mt-0.5">
                      {overflowReasons[t.id]}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TaskEditor({
  task,
  categories,
  onChange,
  onClose,
}: {
  task: Task;
  categories: CategoryDef[];
  onChange: (patch: Partial<Task>) => void;
  onClose: () => void;
}) {
  return (
    <div className="mx-2.5 mb-2.5 pt-2 border-t border-rule-2 space-y-2.5">
      <div>
        <Label>Title</Label>
        <input
          value={task.title}
          onChange={(e) => onChange({ title: e.target.value })}
          className="input w-full text-body-sm px-2 py-1.5 focus:outline-none"
        />
      </div>

      <div>
        <Label>Duration</Label>
        <div className="flex flex-wrap gap-1">
          {DURATION_PRESETS.map((d) => {
            const active = task.duration === d;
            return (
              <button
                key={d}
                onClick={() => onChange({ duration: d })}
                className="font-mono text-micro px-2 py-1 rounded tnum tracking-wide transition-all"
                style={{
                  background: active ? 'var(--signal-dim)' : 'rgba(245, 242, 236,0.035)',
                  border: `1px solid ${active ? 'var(--signal-line)' : 'var(--rule-2)'}`,
                  color: active ? 'var(--bone-0)' : 'var(--bone-2)',
                }}
              >
                {d}m
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <Label>Category</Label>
        <div className="flex flex-wrap gap-1">
          {categories.map((cat) => {
            const active = task.category === cat.id;
            const c = colorsFor(cat.accent);
            return (
              <button
                key={cat.id}
                onClick={() => onChange({ category: cat.id })}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-micro font-medium transition-all"
                style={{
                  background: active ? c.fillStrong : 'rgba(245, 242, 236,0.035)',
                  border: `1px solid ${active ? c.line : 'var(--rule-2)'}`,
                  color: active ? c.text : 'var(--bone-3)',
                }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full"
                  style={{ background: cat.accent }}
                />
                {cat.short}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <Label>Fixed time</Label>
          <input
            type="time"
            value={
              task.fixedTime != null
                ? `${String(Math.floor(task.fixedTime / 60)).padStart(2, '0')}:${String(
                    task.fixedTime % 60
                  ).padStart(2, '0')}`
                : ''
            }
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return onChange({ fixedTime: undefined });
              const [h, m] = v.split(':').map(Number);
              onChange({ fixedTime: h * 60 + m });
            }}
            className="input w-full font-mono text-body-sm px-2 py-1.5 tnum focus:outline-none"
          />
        </div>
        <div>
          <Label>Priority</Label>
          <button
            onClick={() =>
              onChange({ priority: task.priority === 'high' ? 'normal' : 'high' })
            }
            className="inline-flex items-center gap-1 px-2 py-[7px] rounded text-micro font-medium transition-all"
            style={{
              background:
                task.priority === 'high'
                  ? 'rgba(232, 148, 74,0.16)'
                  : 'rgba(245, 242, 236,0.035)',
              border: `1px solid ${
                task.priority === 'high' ? 'rgba(232, 148, 74,0.45)' : 'var(--rule-2)'
              }`,
              color: task.priority === 'high' ? 'var(--flag)' : 'var(--bone-2)',
            }}
          >
            <Flag size={10} strokeWidth={2} />
            {task.priority === 'high' ? 'High' : 'Normal'}
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          onClick={onClose}
          className="text-micro text-ink-3 hover:text-ink-0 px-2 py-1 rounded transition-colors"
        >
          Done
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="smallcaps text-nano text-bone-3 block mb-1">{children}</label>
  );
}

export default memo(IntakePanel);

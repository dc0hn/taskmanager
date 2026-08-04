import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckSquare,
  Clock3,
  Flame,
  Pause,
  Play,
  Plus,
  Repeat,
  Trash2,
} from 'lucide-react';
import type { CategoryDef, HabitStore, RecurrenceRule, RecurringTask } from '../types';
import { allStatuses, describeRule } from '../recurrence';
import { colorsFor } from '../utils/color';
import { formatDuration, toDateKey } from '../utils/time';
import { uid } from '../utils/id';

// ============================================================================
// RoutinesView — recurring tasks and their streaks.
//
// Streaks are derived from the completion log, never stored as a counter, so
// un-ticking yesterday corrects the streak instead of leaving it inflated.
// Only days matching the rule count: a weekdays routine is not broken by the
// weekend.
// ============================================================================

const WEEKDAYS = [
  { i: 1, label: 'M' },
  { i: 2, label: 'T' },
  { i: 3, label: 'W' },
  { i: 4, label: 'T' },
  { i: 5, label: 'F' },
  { i: 6, label: 'S' },
  { i: 0, label: 'S' },
];

interface Props {
  store: HabitStore;
  categories: CategoryDef[];
  onAdd: (t: RecurringTask) => void;
  onUpdate: (id: string, patch: Partial<RecurringTask>) => void;
  onRemove: (id: string) => void;
}

export default function RoutinesView({
  store,
  categories,
  onAdd,
  onUpdate,
  onRemove,
}: Props) {
  const [adding, setAdding] = useState(false);
  const statuses = useMemo(() => allStatuses(store), [store]);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-6 pb-8">
      <div className="max-w-[900px]">
        <div className="flex items-center gap-2 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-0">Routines</h2>
            <p className="text-[12px] text-ink-3 mt-0.5">
              Things that come back. They appear as chips in the day's intake — nothing
              is added to a day until you put it there.
            </p>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setAdding((v) => !v)}
            className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 h-[30px] rounded-lg shrink-0"
          >
            <Plus size={14} strokeWidth={2.4} />
            New routine
          </button>
        </div>

        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <RoutineForm
                categories={categories}
                onSubmit={(t) => {
                  onAdd(t);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {statuses.length === 0 ? (
          <p className="text-[12.5px] text-bone-3 py-4 max-w-[52ch] leading-relaxed">
            No routines yet. These are for the things you want to do repeatedly —
            stretch every morning, clear the inbox on weekdays, a long run on Saturdays.
          </p>
        ) : (
          <div className="space-y-2">
            {statuses.map(({ template, streak }) => {
              const cat = categories.find((c) => c.id === template.category);
              const c = colorsFor(cat?.accent ?? '#8b93a7');
              const inactive = !template.active;

              return (
                <div
                  key={template.id}
                  className="ruled-row group"
                  style={{
                    borderLeft: `2.5px solid ${inactive ? 'var(--rule-3)' : c.accent}`,
                    opacity: inactive ? 0.55 : 1,
                  }}
                >
                  <div className="flex items-start gap-3 flex-wrap">
                    <div className="flex-1 min-w-[180px]">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        <span
                          className="smallcaps text-[9px]"
                          style={{ color: inactive ? 'var(--bone-3)' : c.accent }}
                        >
                          {cat?.short ?? '—'}
                        </span>
                        <span className="font-mono text-[10px] text-bone-3">
                          {describeRule(template.rule)}
                        </span>
                        {streak.dueToday && (
                          <span
                            className="smallcaps text-[9px] px-1.5 py-[1px] rounded"
                            style={{
                              background: 'var(--signal-dim)',
                              color: 'var(--bone-0)',
                            }}
                          >
                            Due today
                          </span>
                        )}
                        {streak.doneToday && (
                          <span
                            className="smallcaps text-[9px] px-1.5 py-[1px] rounded"
                            style={{
                              background: 'rgba(111, 191, 139,0.16)',
                              color: 'var(--good)',
                            }}
                          >
                            Done today
                          </span>
                        )}
                      </div>
                      <div className="text-[13.5px] font-semibold text-ink-0 truncate">
                        {template.label}
                      </div>
                      <div className="font-mono text-[10.5px] text-ink-3 tnum mt-0.5">
                        {/* A checkmark has no duration and no anchor, so quoting either
                            would describe a schedule it is deliberately not in. */}
                        {template.checkmark ? (
                          'anytime · not scheduled'
                        ) : (
                          <>
                            {formatDuration(template.duration)}
                            {template.fixedTime != null &&
                              ` · at ${String(
                                Math.floor(template.fixedTime / 60)
                              ).padStart(2, '0')}:${String(
                                template.fixedTime % 60
                              ).padStart(2, '0')}`}
                            {template.priority === 'high' && ' · high'}
                          </>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-4 shrink-0">
                      <Stat
                        icon={<Flame size={11} strokeWidth={2.4} />}
                        value={String(streak.current)}
                        label="streak"
                        color={streak.current > 0 ? 'var(--flag)' : 'var(--bone-3)'}
                      />
                      <Stat value={String(streak.best)} label="best" />
                      <Stat
                        value={`${Math.round(streak.rate * 100)}%`}
                        label="rate"
                        color={
                          streak.rate >= 0.8
                            ? 'var(--good)'
                            : streak.rate >= 0.5
                              ? 'var(--signal)'
                              : 'var(--bone-3)'
                        }
                      />
                      <Stat value={String(streak.total)} label="total" />
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      {/* Timed block or checkmark. `duration` is kept either way, so
                          switching back restores what the routine was rather than
                          resetting it to a default. */}
                      <button
                        onClick={() =>
                          onUpdate(template.id, {
                            checkmark: template.checkmark ? undefined : true,
                          })
                        }
                        aria-pressed={template.checkmark === true}
                        title={
                          template.checkmark
                            ? 'A checkmark — ticked any time, never scheduled. Click to put it back on the grid.'
                            : 'A timed block. Click to make it a checkmark instead.'
                        }
                        className="inline-flex items-center gap-1.5 px-2 h-7 rounded-md text-[11px] font-medium transition-all"
                        style={{
                          background: template.checkmark
                            ? 'var(--signal-dim)'
                            : 'rgba(245, 242, 236,0.035)',
                          border: `1px solid ${
                            template.checkmark ? 'var(--signal-line)' : 'var(--rule-2)'
                          }`,
                          color: template.checkmark ? 'var(--signal)' : 'var(--bone-2)',
                        }}
                      >
                        {/* Labelled, not a bare icon. Two glyphs that differ only in
                            shape are indistinguishable in a row of other icon buttons,
                            and this one changes whether the routine is scheduled at
                            all — which is too large a consequence to hide in a tooltip. */}
                        {template.checkmark ? (
                          <CheckSquare size={11} strokeWidth={2.2} />
                        ) : (
                          <Clock3 size={11} strokeWidth={2} />
                        )}
                        {template.checkmark ? 'Checkmark' : 'Timed'}
                      </button>
                      <button
                        onClick={() => onUpdate(template.id, { active: !template.active })}
                        aria-label={template.active ? 'Pause routine' : 'Resume routine'}
                        title={template.active ? 'Pause' : 'Resume'}
                        className="grid place-items-center w-7 h-7 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-4 transition-colors"
                      >
                        {template.active ? (
                          <Pause size={12} strokeWidth={2} />
                        ) : (
                          <Play size={12} strokeWidth={2} />
                        )}
                      </button>
                      <button
                        onClick={() => onRemove(template.id)}
                        aria-label="Delete routine"
                        className="grid place-items-center w-7 h-7 rounded-md text-bone-3 hover:text-bad hover:bg-paper-4 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 size={12} strokeWidth={1.9} />
                      </button>
                    </div>
                  </div>

                  {/* Completion rate bar */}
                  <div
                    className="mt-2.5 h-[4px] rounded-full overflow-hidden"
                    style={{ background: 'rgba(245, 242, 236,0.06)' }}
                  >
                    <motion.div
                      className="h-full rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${streak.rate * 100}%` }}
                      transition={{ type: 'spring', stiffness: 120, damping: 26 }}
                      style={{ background: inactive ? 'var(--bone-3)' : c.accent }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Stat({
  icon,
  value,
  label,
  color,
}: {
  icon?: React.ReactNode;
  value: string;
  label: string;
  color?: string;
}) {
  return (
    <div className="text-center">
      <div
        className="font-mono text-[14px] tnum leading-none inline-flex items-center gap-1"
        style={{ color: color ?? 'var(--bone-1)' }}
      >
        {icon}
        {value}
      </div>
      <div className="smallcaps text-[8.5px] text-bone-3 mt-1">{label}</div>
    </div>
  );
}

function RoutineForm({
  categories,
  onSubmit,
  onCancel,
}: {
  categories: CategoryDef[];
  onSubmit: (t: RecurringTask) => void;
  onCancel: () => void;
}) {
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState(sorted[0]?.id ?? 'other');
  const [duration, setDuration] = useState('30');
  const [ruleKind, setRuleKind] = useState<RecurrenceRule['kind']>('daily');
  const [days, setDays] = useState<number[]>([1, 3, 5]);
  const [fixedTime, setFixedTime] = useState('');
  const [priority, setPriority] = useState<'high' | 'normal'>('normal');
  const [checkmark, setCheckmark] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const d = Number(duration);
    if (!label.trim()) {
      setError('Give the routine a name.');
      return;
    }
    // A checkmark has no duration, so it is not asked for one and not validated for
    // one. Requiring a number here would be the form insisting on a fact about the
    // thing that the whole point of a checkmark is that it does not have.
    if (!checkmark && (!Number.isFinite(d) || d <= 0)) {
      setError('How long does it take? Enter a number of minutes above zero.');
      return;
    }
    if (ruleKind === 'days' && days.length === 0) {
      setError('Pick at least one day, otherwise this routine would never come up.');
      return;
    }
    const rule: RecurrenceRule =
      ruleKind === 'daily'
        ? { kind: 'daily' }
        : ruleKind === 'weekdays'
          ? { kind: 'weekdays' }
          : { kind: 'days', days: [...days].sort() };

    let ft: number | undefined;
    if (fixedTime) {
      const [h, m] = fixedTime.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) ft = h * 60 + m;
    }

    onSubmit({
      id: uid(),
      label: label.trim(),
      category,
      // Kept even for a checkmark, so switching it to a timed block later has a
      // sensible length to start from rather than a zero.
      duration: checkmark ? 15 : Math.round(d),
      priority: checkmark ? 'normal' : priority,
      fixedTime: checkmark ? undefined : ft,
      rule,
      createdOn: toDateKey(new Date()),
      active: true,
      checkmark: checkmark ? true : undefined,
    });
  }

  return (
    <div className="form-well mb-6">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>Name</Label>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Stretch"
            className="input w-full text-[13.5px] px-2.5 py-2 focus:outline-none"
          />
        </div>

        {/* Asked BEFORE the fields it governs, because choosing Checkmark removes
            three of them. Putting it lower would have you fill in a duration and a
            time and then watch them disappear. */}
        <div className="md:col-span-2">
          <Label>How it appears</Label>
          <div className="segmented">
            <button
              data-active={!checkmark}
              onClick={() => setCheckmark(false)}
              className="segmented-item"
            >
              Timed block
            </button>
            <button
              data-active={checkmark}
              onClick={() => setCheckmark(true)}
              className="segmented-item"
            >
              Checkmark
            </button>
          </div>
          <p className="text-[11.5px] text-ink-3 mt-1.5 leading-snug max-w-[52ch]">
            {checkmark
              ? 'Never scheduled. It appears in the Anytime strip above the day and can be ticked at any hour — including after your shutdown time, or before 4am for the day that just ended.'
              : 'Placed on the grid by the scheduler, with a duration and a slot.'}
          </p>
        </div>

        <div className="md:col-span-2">
          <Label>Category</Label>
          <div className="flex flex-wrap gap-1.5">
            {sorted.map((cat) => {
              const active = category === cat.id;
              const c = colorsFor(cat.accent);
              return (
                <button
                  key={cat.id}
                  onClick={() => setCategory(cat.id)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium transition-all"
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
                  {cat.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-2">
          <Label>Repeats</Label>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="segmented">
              {(['daily', 'weekdays', 'days'] as const).map((k) => (
                <button
                  key={k}
                  data-active={ruleKind === k}
                  onClick={() => setRuleKind(k)}
                  className="segmented-item"
                >
                  {k === 'daily' ? 'Every day' : k === 'weekdays' ? 'Weekdays' : 'Pick days'}
                </button>
              ))}
            </div>
            {ruleKind === 'days' && (
              <div className="flex gap-1">
                {WEEKDAYS.map(({ i, label: dl }) => {
                  const on = days.includes(i);
                  return (
                    <button
                      key={i}
                      onClick={() =>
                        setDays((prev) =>
                          prev.includes(i) ? prev.filter((x) => x !== i) : [...prev, i]
                        )
                      }
                      aria-pressed={on}
                      className="w-7 h-7 rounded-md font-mono text-[11px] transition-all"
                      style={{
                        background: on ? 'var(--signal-dim)' : 'rgba(245, 242, 236,0.035)',
                        border: `1px solid ${on ? 'var(--signal-line)' : 'var(--rule-2)'}`,
                        color: on ? 'var(--bone-0)' : 'var(--bone-3)',
                      }}
                    >
                      {dl}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {!checkmark && (
        <div>
          <Label>Takes</Label>
          <div className="flex items-center gap-1.5">
            <input
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
              inputMode="numeric"
              className="input w-16 font-mono text-[12.5px] px-2 py-2 tnum focus:outline-none"
            />
            <span className="text-[12px] text-ink-3">minutes</span>
          </div>
        </div>
        )}

        {!checkmark && (
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <Label>At a set time (optional)</Label>
            <input
              type="time"
              value={fixedTime}
              onChange={(e) => setFixedTime(e.target.value)}
              className="input w-full font-mono text-[12.5px] px-2 py-2 tnum focus:outline-none"
            />
          </div>
          <button
            onClick={() => setPriority((p) => (p === 'high' ? 'normal' : 'high'))}
            className="px-2.5 py-2 rounded-md text-[11.5px] font-medium transition-all"
            style={{
              background:
                priority === 'high' ? 'rgba(232, 148, 74,0.16)' : 'rgba(245, 242, 236,0.035)',
              border: `1px solid ${
                priority === 'high' ? 'rgba(232, 148, 74,0.45)' : 'var(--rule-2)'
              }`,
              color: priority === 'high' ? 'var(--flag)' : 'var(--bone-2)',
            }}
          >
            {priority === 'high' ? 'High' : 'Normal'}
          </button>
        </div>
        )}
      </div>

      {error && <p className="text-[12.5px] text-bad mt-2.5">{error}</p>}

      <div className="flex justify-end gap-2 mt-3.5">
        <button
          onClick={onCancel}
          className="text-[12px] font-medium text-ink-3 hover:text-ink-0 px-3 py-2 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg"
        >
          <Repeat size={13} strokeWidth={2.2} />
          Add routine
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="smallcaps text-[9px] text-bone-3 block mb-1.5">{children}</label>
  );
}

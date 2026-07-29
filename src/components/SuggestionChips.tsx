import { memo, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Flame, Plus, Target } from 'lucide-react';
import type { CategoryDef, GoalProgress, RecurringTask, WeeklyGoal } from '../types';
import type { TemplateStatus } from '../recurrence';
import { categoryColors } from '../utils/color';
import { formatDuration } from '../utils/time';

// ============================================================================
// SuggestionChips
//
// The daily touchpoint for the two layers above a single day: this week's open
// goals, and the routines that fire today. Tapping a chip drops a pre-tagged
// task into the intake queue — that is *all* it does. From there the ordinary
// parser and scheduler handle it, so neither of those needs any knowledge of
// goals or recurrence.
//
// Nothing is auto-added. A routine you deleted this morning would otherwise
// reappear every time the day was reopened, which would require tracking
// dismissals; offering instead of injecting avoids that state entirely.
//
// PAIRING: a weekly goal and a routine with the same name are the same piece of
// work described at two altitudes ("practise scales, 5× this week" and "practise
// scales, weekdays"). Offering both separately read as a duplicate and invited
// you to schedule the thing twice. They now collapse into one chip whose task
// carries BOTH ids — so completing it credits the goal session and the streak in
// one gesture. That works without any special-casing because Task already holds
// goalId and templateId independently, and the two ledgers reconcile off their
// own field.
// ============================================================================

/** Same work, described at two altitudes. */
interface Pair {
  progress: GoalProgress;
  status: TemplateStatus;
}

const norm = (s: string) => s.trim().toLowerCase();

interface Props {
  openGoals: GoalProgress[];
  dueRoutines: TemplateStatus[];
  categories: CategoryDef[];
  onAddGoal: (goal: WeeklyGoal) => void;
  onAddRoutine: (template: RecurringTask) => void;
  /** Adds one task carrying both ids, crediting the goal and the streak. */
  onAddPaired: (goal: WeeklyGoal, template: RecurringTask) => void;
}

function SuggestionChips({
  openGoals,
  dueRoutines,
  categories,
  onAddGoal,
  onAddRoutine,
  onAddPaired,
}: Props) {
  const { pairs, soloGoals, soloRoutines } = useMemo(() => {
    const byName = new Map(dueRoutines.map((s) => [norm(s.template.label), s]));
    const pairs: Pair[] = [];
    const soloGoals: GoalProgress[] = [];
    const claimed = new Set<string>();

    for (const progress of openGoals) {
      const status = byName.get(norm(progress.goal.label));
      if (status) {
        pairs.push({ progress, status });
        claimed.add(status.template.id);
      } else {
        soloGoals.push(progress);
      }
    }
    return {
      pairs,
      soloGoals,
      soloRoutines: dueRoutines.filter((s) => !claimed.has(s.template.id)),
    };
  }, [openGoals, dueRoutines]);

  const hasAny = pairs.length > 0 || soloGoals.length > 0 || soloRoutines.length > 0;
  if (!hasAny) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="legend">Draw from</span>
        <div className="flex-1 rule-h" />
      </div>

      <div className="flex flex-wrap gap-1.5">
        <AnimatePresence initial={false}>
          {/* Paired: one chip, both signals, one task carrying both ids. */}
          {pairs.map(({ progress: p, status }) => {
            const c = categoryColors(p.goal.category, categories);
            const placed = status.placed;
            return (
              <motion.button
                key={`pair-${p.goal.id}`}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                onClick={() => !placed && onAddPaired(p.goal, status.template)}
                disabled={placed}
                title={
                  placed
                    ? `${p.goal.label} is already on today.`
                    : `${p.goal.label} — a weekly goal and a routine. ${p.done} of ${p.target} ${
                        p.goal.targetKind === 'sessions' ? 'sessions' : 'minutes'
                      } done this week; ${
                        status.streak.current > 0
                          ? `${status.streak.current}-day streak`
                          : 'no streak yet'
                      }. Adds one ${formatDuration(
                        p.goal.sessionMinutes
                      )} session that counts for both.`
                }
                className="group inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded transition-all hover:brightness-125"
                style={{
                  background: placed ? 'rgba(245, 242, 236,0.03)' : c.fill,
                  border: `1px solid ${placed ? 'var(--rule-2)' : c.line}`,
                  opacity: placed ? 0.55 : 1,
                  cursor: placed ? 'default' : 'pointer',
                }}
              >
                {placed ? (
                  <Check size={11} strokeWidth={2.6} className="text-bone-3" />
                ) : (
                  <Target size={11} strokeWidth={2.2} style={{ color: c.accent }} />
                )}
                <span
                  className="text-micro font-semibold truncate max-w-[130px]"
                  style={{ color: placed ? 'var(--bone-3)' : c.text }}
                >
                  {p.goal.label}
                </span>
                <span
                  className="font-mono text-nano tnum px-1 rounded-xs"
                  style={{ color: c.textDim, background: 'rgba(0,0,0,0.28)' }}
                >
                  {p.done}/{p.target}
                </span>
                {status.streak.current > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 font-mono text-nano tnum px-1 rounded-xs"
                    style={{
                      color: 'var(--flag)',
                      background: 'rgba(232, 148, 74,0.14)',
                    }}
                  >
                    <Flame size={8} strokeWidth={2.6} />
                    {status.streak.current}
                  </span>
                )}
                {p.goal.deferrals > 0 && (
                  <span
                    className="font-mono text-nano tnum px-1 rounded-xs"
                    style={{ color: 'var(--signal)', background: 'var(--signal-dim)' }}
                    title={`Carried over ${p.goal.deferrals} week${
                      p.goal.deferrals === 1 ? '' : 's'
                    }`}
                  >
                    ×{p.goal.deferrals}
                  </span>
                )}
                {!placed && (
                  <Plus
                    size={11}
                    strokeWidth={2.4}
                    className="opacity-40 group-hover:opacity-100 transition-opacity"
                    style={{ color: c.accent }}
                  />
                )}
              </motion.button>
            );
          })}

          {soloGoals.map((p) => {
            const c = categoryColors(p.goal.category, categories);
            return (
              <motion.button
                key={`goal-${p.goal.id}`}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                onClick={() => onAddGoal(p.goal)}
                title={`${p.goal.label} — ${p.done} of ${p.target} ${
                  p.goal.targetKind === 'sessions' ? 'sessions' : 'minutes'
                } done this week. Adds a ${formatDuration(
                  p.goal.sessionMinutes
                )} session to intake.`}
                className="group inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded transition-all hover:brightness-125"
                style={{
                  background: c.fill,
                  border: `1px solid ${c.line}`,
                }}
              >
                <Target size={11} strokeWidth={2.2} style={{ color: c.accent }} />
                <span
                  className="text-micro font-semibold truncate max-w-[130px]"
                  style={{ color: c.text }}
                >
                  {p.goal.label}
                </span>
                <span
                  className="font-mono text-nano tnum px-1 rounded"
                  style={{
                    color: c.textDim,
                    background: 'rgba(0,0,0,0.28)',
                  }}
                >
                  {p.done}/{p.target}
                </span>
                {p.goal.deferrals > 0 && (
                  <span
                    className="font-mono text-nano tnum px-1 rounded"
                    style={{
                      color: 'var(--signal)',
                      background: 'rgba(255, 176, 31,0.14)',
                    }}
                    title={`Carried over ${p.goal.deferrals} week${
                      p.goal.deferrals === 1 ? '' : 's'
                    }`}
                  >
                    ×{p.goal.deferrals}
                  </span>
                )}
                <Plus
                  size={11}
                  strokeWidth={2.4}
                  className="opacity-40 group-hover:opacity-100 transition-opacity"
                  style={{ color: c.accent }}
                />
              </motion.button>
            );
          })}

          {soloRoutines.map(({ template, streak, placed }) => {
            const c = categoryColors(template.category, categories);
            return (
              <motion.button
                key={`rt-${template.id}`}
                layout
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.94 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                onClick={() => !placed && onAddRoutine(template)}
                disabled={placed}
                title={
                  placed
                    ? `${template.label} is already on today.`
                    : `${template.label} — ${formatDuration(template.duration)}. ${
                        streak.current > 0
                          ? `${streak.current}-day streak.`
                          : 'No streak yet.'
                      }`
                }
                className="group inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1.5 rounded transition-all"
                style={{
                  background: placed ? 'rgba(245, 242, 236,0.03)' : c.fill,
                  border: `1px solid ${placed ? 'var(--rule-2)' : c.line}`,
                  opacity: placed ? 0.55 : 1,
                  cursor: placed ? 'default' : 'pointer',
                }}
              >
                {placed ? (
                  <Check size={11} strokeWidth={2.6} className="text-ink-3" />
                ) : (
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: c.accent }}
                  />
                )}
                <span
                  className="text-micro font-semibold truncate max-w-[130px]"
                  style={{ color: placed ? 'var(--bone-3)' : c.text }}
                >
                  {template.label}
                </span>
                {streak.current > 0 && (
                  <span
                    className="inline-flex items-center gap-0.5 font-mono text-nano tnum px-1 rounded"
                    style={{
                      color: 'var(--flag)',
                      background: 'rgba(232, 148, 74,0.14)',
                    }}
                  >
                    <Flame size={8} strokeWidth={2.6} />
                    {streak.current}
                  </span>
                )}
                {!placed && (
                  <Plus
                    size={11}
                    strokeWidth={2.4}
                    className="opacity-40 group-hover:opacity-100 transition-opacity"
                    style={{ color: c.accent }}
                  />
                )}
              </motion.button>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}

export default memo(SuggestionChips);

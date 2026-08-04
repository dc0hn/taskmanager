import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleSlash,
  CheckSquare,
  Clock3,
  CornerDownLeft,
  Plus,
  Scissors,
  Target,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import type {
  CarryoverItem,
  CategoryDef,
  GoalCadence,
  GoalTargetKind,
  WeeklyGoal,
  WeekRecord,
} from '../types';
import type { WeekOutcome } from '../types';
import type { WeekReview } from '../goals';
import {
  carryoverByCategory,
  STALE_DEFERRAL_THRESHOLD,
  checkmarkable,
  staleCarryover,
  weekProgress,
} from '../goals';
import { colorsFor } from '../utils/color';
import Ring from './Ring';
import { formatDuration } from '../utils/time';
import { uid } from '../utils/id';
import {
  addWeeks,
  currentWeekKey,
  formatWeekRange,
  formatWeekRangeLong,
} from '../week';

// ============================================================================
// GoalsView — weekly intentions, the carryover pile, and the weekly review.
//
// The carryover pile is deliberately uncomfortable to look at. An item that has
// been deferred six weeks says so, in warning colour, at the top of its group.
// That friction is the feature: the alternative is intent quietly evaporating.
// ============================================================================

interface Props {
  week: WeekRecord;
  weekKey: string;
  onWeekChange: (weekKey: string) => void;
  carryover: CarryoverItem[];
  categories: CategoryDef[];
  review: WeekReview;
  /** Finished weeks and how each ended, most recent first. */
  history: { week: string; outcome: WeekOutcome }[];
  /** This month's completion per goal id, for the small month gauge. */
  monthRatios: Record<string, { ratio: number; done: number; target: number }>;
  onAddGoal: (goal: WeeklyGoal) => void;
  onRemoveGoal: (id: string) => void;
  onSetVoided: (goalId: string, voided: boolean) => void;
  onSetCheckmark: (goalId: string, checkmark: boolean) => void;
  onPullCarryover: (goalId: string) => void;
  onDropCarryover: (goalId: string) => void;
  onResizeCarryover: (goalId: string, residual: number) => void;
}

export default function GoalsView({
  week,
  weekKey,
  onWeekChange,
  carryover,
  categories,
  review,
  history,
  monthRatios,
  onAddGoal,
  onRemoveGoal,
  onSetVoided,
  onSetCheckmark,
  onPullCarryover,
  onDropCarryover,
  onResizeCarryover,
}: Props) {
  const [adding, setAdding] = useState(false);
  const progress = useMemo(() => weekProgress(week), [week]);
  const groups = useMemo(
    () => carryoverByCategory(carryover, categories),
    [carryover, categories]
  );
  const stale = useMemo(() => staleCarryover(carryover), [carryover]);
  const isCurrent = weekKey === currentWeekKey();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll pl-8 pr-6 pb-8">
      <div className="max-w-[1100px]">
        {/* ------------- week nav ------------- */}
        <div className="flex items-center gap-2 py-4 flex-wrap">
          <button
            onClick={() => onWeekChange(addWeeks(weekKey, -1))}
            aria-label="Previous week"
            className="btn-quiet grid place-items-center w-[30px] h-[30px] rounded-lg"
          >
            <ArrowLeft size={14} strokeWidth={2} />
          </button>
          <button
            onClick={() => onWeekChange(currentWeekKey())}
            className="text-[12px] font-medium px-3 h-[30px] rounded-lg transition-colors"
            style={
              isCurrent
                ? {
                    background: 'var(--signal-dim)',
                    color: 'var(--bone-0)',
                    border: '1px solid var(--signal-line)',
                  }
                : {
                    color: 'var(--bone-2)',
                    border: '1px solid var(--rule-2)',
                  }
            }
          >
            This week
          </button>
          <button
            onClick={() => onWeekChange(addWeeks(weekKey, 1))}
            aria-label="Next week"
            className="btn-quiet grid place-items-center w-[30px] h-[30px] rounded-lg"
          >
            <ArrowRight size={14} strokeWidth={2} />
          </button>
          <span className="font-mono text-[12px] text-ink-2 tnum ml-1">
            {formatWeekRangeLong(weekKey)}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setAdding((v) => !v)}
            className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 h-[30px] rounded-lg"
          >
            <Plus size={14} strokeWidth={2.4} />
            New goal
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
              <GoalForm
                categories={categories}
                weekKey={weekKey}
                onSubmit={(g) => {
                  onAddGoal(g);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ------------- this week's goals ------------- */}
        <Section
          title="Intentions"
          count={progress.length}
          hint="What you mean to do this week."
        >
          {progress.length === 0 ? (
            <Empty>
              No goals set for this week. Add one, or pull something up from the
              carryover pile below.
            </Empty>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {progress.map((p) => {
                const c = colorsFor(
                  categories.find((x) => x.id === p.goal.category)?.accent ?? '#8b93a7'
                );
                const pct = Math.min(100, (p.done / p.target) * 100);
                // A ceiling is the one place in this app where a bar starts full and is
                // lost by filling. It recolours past four fifths rather than at the limit,
                // so the warning arrives while there is still room to act on it.
                const ceiling = p.goal.direction === 'atMost';
                return (
                  <div
                    key={p.goal.id}
                    className="ruled-row group relative"
                    style={{ borderLeft: `2.5px solid ${c.accent}` }}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <span
                            className="smallcaps text-[9px]"
                            style={{ color: c.accent }}
                          >
                            {categories.find((x) => x.id === p.goal.category)?.short ??
                              '—'}
                          </span>
                          <span
                            className="smallcaps text-[9px]"
                            style={{ color: 'var(--bone-3)' }}
                            title={
                              p.goal.cadence === 'weekly'
                                ? 'Reissues every week at its full target.'
                                : 'A one-off — what remains carries over.'
                            }
                          >
                            {p.goal.cadence === 'weekly' ? 'Weekly' : 'One-off'}
                          </span>
                          {p.goal.deferrals > 0 && (
                            <DeferralBadge n={p.goal.deferrals} />
                          )}
                          {p.outcome === 'met' && (
                            <span
                              className="inline-flex items-center gap-0.5 smallcaps text-[9px]"
                              style={{ color: 'var(--good)' }}
                            >
                              <Check size={9} strokeWidth={3} />
                              Met
                            </span>
                          )}
                          {p.outcome === 'void' && (
                            <span
                              className="smallcaps text-[9px] px-1.5 py-[1px] rounded"
                              style={{
                                background: 'rgba(245, 242, 236,0.07)',
                                color: 'var(--bone-3)',
                              }}
                            >
                              Stood down
                            </span>
                          )}
                        </div>
                        <div
                          className="text-[13.5px] font-semibold truncate"
                          style={{
                            color: p.outcome === 'void' ? 'var(--bone-3)' : 'var(--bone-0)',
                            textDecoration:
                              p.outcome === 'void' ? 'line-through' : undefined,
                          }}
                        >
                          {p.goal.label}
                        </div>
                        <div className="font-mono text-[10.5px] text-ink-3 tnum mt-0.5">
                          {/* A ceiling reads as consumption — "used", not "done" — because
                              the number going up is the thing you are trying to hold down. */}
                          {ceiling
                            ? p.goal.targetKind === 'sessions'
                              ? `${p.done} of ${p.target} sessions used`
                              : `${formatDuration(p.minutes)} of ${formatDuration(p.target)} used`
                            : p.goal.targetKind === 'sessions'
                              ? `${p.done} of ${p.target} sessions`
                              : `${formatDuration(p.minutes)} of ${formatDuration(p.target)}`}
                          {p.outcome === 'exceeded' && (
                            <span style={{ color: 'var(--signal)' }}>
                              {' · '}
                              Over by{' '}
                              {p.goal.targetKind === 'sessions'
                                ? `${p.done - p.target}`
                                : formatDuration(p.minutes - p.target)}
                            </span>
                          )}
                          {!ceiling && (
                            <>
                              {' · '}
                              {formatDuration(p.goal.sessionMinutes)} each
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5 shrink-0">
                        {/* Checkmark or scheduled. Always visible rather than revealed
                            on hover, because it changes whether the goal reaches the
                            scheduler at all — too large a consequence to hide. Offered
                            only where it can actually work: a minutes target cannot be
                            satisfied by a tick, which carries no minutes. */}
                        {isCurrent && checkmarkable(p.goal) && (
                          <button
                            onClick={() =>
                              onSetCheckmark(p.goal.id, p.goal.checkmark !== true)
                            }
                            aria-pressed={p.goal.checkmark === true}
                            title={
                              p.goal.checkmark
                                ? 'A checkmark — ticked from the day at any hour, never scheduled. Click to put it back on the grid.'
                                : 'Scheduled work. Click to make it a checkmark you tick off instead.'
                            }
                            className="inline-flex items-center gap-1 px-1.5 h-6 rounded-md text-[10px] font-medium transition-all"
                            style={{
                              background: p.goal.checkmark
                                ? 'var(--signal-dim)'
                                : 'transparent',
                              border: `1px solid ${
                                p.goal.checkmark ? 'var(--signal-line)' : 'var(--rule-2)'
                              }`,
                              color: p.goal.checkmark
                                ? 'var(--signal)'
                                : 'var(--bone-3)',
                            }}
                          >
                            {p.goal.checkmark ? (
                              <CheckSquare size={10} strokeWidth={2.2} />
                            ) : (
                              <Clock3 size={10} strokeWidth={2} />
                            )}
                            {p.goal.checkmark ? 'Checkmark' : 'Scheduled'}
                          </button>
                        )}
                        <button
                          onClick={() => onSetVoided(p.goal.id, p.outcome !== 'void')}
                          aria-label={
                            p.outcome === 'void' ? 'Bring this back' : 'Stand this down'
                          }
                          title={
                            p.outcome === 'void'
                              ? 'Bring this back for the week'
                              : "Stand down for this week — recorded as a decision, not a failure. It won't carry over or count a deferral."
                          }
                          className="grid place-items-center w-6 h-6 rounded-md text-bone-3 hover:text-ink-1 hover:bg-paper-4 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          {p.outcome === 'void' ? (
                            <Undo2 size={12} strokeWidth={1.9} />
                          ) : (
                            <CircleSlash size={12} strokeWidth={1.9} />
                          )}
                        </button>
                        <button
                          onClick={() => onRemoveGoal(p.goal.id)}
                          aria-label="Remove goal"
                          className="grid place-items-center w-6 h-6 rounded-md text-bone-3 hover:text-bad hover:bg-paper-4 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          <Trash2 size={12} strokeWidth={1.9} />
                        </button>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-3">
                      <div
                        className="flex-1 h-[5px] rounded-full overflow-hidden"
                        style={{ background: 'rgba(245, 242, 236,0.06)' }}
                      >
                        <motion.div
                          className="h-full rounded-full"
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ type: 'spring', stiffness: 120, damping: 26 }}
                          style={{
                            background: ceiling
                              ? pct >= 100
                                ? 'var(--signal)'
                                : pct >= 80
                                  ? 'var(--warn, var(--signal))'
                                  : c.accent
                              : p.outcome === 'met'
                                ? 'var(--good)'
                                : c.accent,
                          }}
                        />
                      </div>
                      {/* Month gauge, standing goals only — a one-off has no
                          weekly total to pro-rate. The bar above is the week; this
                          is the separate monthly statistic. */}
                      {p.goal.cadence === 'weekly' && monthRatios[p.goal.id] && (
                        <div
                          title={`This month: ${
                            p.goal.targetKind === 'sessions'
                              ? `${monthRatios[p.goal.id].done} of ${
                                  Math.round(monthRatios[p.goal.id].target * 10) / 10
                                } sessions`
                              : `${formatDuration(monthRatios[p.goal.id].done)} of ${formatDuration(
                                  Math.round(monthRatios[p.goal.id].target)
                                )}`
                          } — the weekly total pro-rated over ${
                            new Date().toLocaleDateString(undefined, { month: 'long' })
                          }`}
                          className="shrink-0"
                        >
                          {/* Full strength, not dimmed. The week bar sits
                              immediately left in the same colour, so the ring is
                              already distinguished by shape — dimming it as well
                              made it too faint to read at this size. */}
                          <Ring
                            ratio={monthRatios[p.goal.id].ratio}
                            size={30}
                            accent={c.accent}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ------------- carryover ------------- */}
        <Section
          title="Carried over"
          count={carryover.length}
          hint="Nothing here was deleted — it slipped, and it is still waiting."
          tone={carryover.length > 0 ? 'warn' : undefined}
        >
          {carryover.length === 0 ? (
            <Empty>Nothing has slipped.</Empty>
          ) : (
            <div className="space-y-4">
              {/* An unmanaged pile becomes a graveyard, and a graveyard carries no
                  signal — the user stops reading it, which defeats the feature. */}
              {stale.length > 0 && (
                <div
                  className="rounded-xl3 p-3 flex items-start gap-2.5"
                  style={{
                    background: 'rgba(224, 104, 95,0.08)',
                    border: '1px solid rgba(224, 104, 95,0.38)',
                  }}
                >
                  <TriangleAlert
                    size={14}
                    strokeWidth={2.2}
                    className="text-bad shrink-0 mt-[1px]"
                  />
                  <p className="text-[12px] text-ink-1 leading-snug">
                    <span className="font-semibold text-bad">
                      {stale.length} item{stale.length === 1 ? '' : 's'} deferred{' '}
                      {STALE_DEFERRAL_THRESHOLD}+ times.
                    </span>{' '}
                    Pull {stale.length === 1 ? 'it' : 'them'} in, halve what's owed, or
                    let {stale.length === 1 ? 'it' : 'them'} go. Abandoning something is a
                    legitimate decision — leaving it here forever isn't.
                  </p>
                </div>
              )}
              {groups.map(({ category, items }) => {
                const c = colorsFor(category.accent);
                return (
                  <div key={category.id}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span
                        className="w-2 h-2 rounded-full"
                        style={{ background: category.accent }}
                      />
                      <span className="text-[12px] font-semibold text-ink-2">
                        {category.label}
                      </span>
                      <span className="font-mono text-[10px] text-bone-3 tnum">
                        {items.length}
                      </span>
                      <div className="flex-1 rule-h" />
                    </div>
                    <div className="grid gap-1.5 md:grid-cols-2">
                      {items.map((item) => {
                        const stale = item.goal.deferrals >= 4;
                        return (
                          <div
                            key={item.goal.id}
                            className="rounded-xl3 p-2.5 flex items-start gap-2 group"
                            style={{
                              background: stale
                                ? 'rgba(255, 176, 31,0.07)'
                                : 'rgba(245, 242, 236,0.025)',
                              border: `1px solid ${
                                stale ? 'rgba(255, 176, 31,0.38)' : 'var(--rule-2)'
                              }`,
                            }}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                                <DeferralBadge n={item.goal.deferrals} />
                                {stale && (
                                  <TriangleAlert
                                    size={11}
                                    strokeWidth={2.2}
                                    className="text-warn"
                                  />
                                )}
                              </div>
                              <div
                                className="text-[13px] font-semibold truncate"
                                style={{ color: stale ? 'var(--signal)' : c.text }}
                              >
                                {item.goal.label}
                              </div>
                              <div className="font-mono text-[10px] text-ink-3 tnum mt-0.5">
                                {/* What is actually still owed, not the original size. */}
                                {item.goal.targetKind === 'sessions'
                                  ? `${item.residual} session${
                                      item.residual === 1 ? '' : 's'
                                    } left`
                                  : `${formatDuration(item.residual)} left`}
                                {' · got to '}
                                {item.lastProgress.done}/{item.lastProgress.target}
                              </div>
                              {item.firstDeferredWeek && (
                                <div className="font-mono text-[9.5px] text-bone-3 tnum mt-0.5">
                                  waiting since {formatWeekRange(item.firstDeferredWeek)}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-0.5 shrink-0">
                              <button
                                onClick={() => onPullCarryover(item.goal.id)}
                                title={`Pull into this week at ${item.residual}`}
                                aria-label="Pull into this week"
                                className="grid place-items-center w-6 h-6 rounded-md text-ink-3 hover:text-accent-bright hover:bg-paper-4 transition-colors"
                              >
                                <CornerDownLeft size={12} strokeWidth={2} />
                              </button>
                              {/* Resizing is the middle path between carrying an
                                  unrealistic obligation and abandoning it. */}
                              <button
                                onClick={() =>
                                  onResizeCarryover(
                                    item.goal.id,
                                    Math.max(1, Math.round(item.residual / 2))
                                  )
                                }
                                title="Halve what's owed — make it small enough to actually do"
                                aria-label="Halve what is owed"
                                className="grid place-items-center w-6 h-6 rounded-md text-bone-3 hover:text-ink-1 hover:bg-paper-4 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <Scissors size={12} strokeWidth={1.9} />
                              </button>
                              <button
                                onClick={() => onDropCarryover(item.goal.id)}
                                title="Let this go — archiving is a legitimate outcome"
                                aria-label="Let this go"
                                className="grid place-items-center w-6 h-6 rounded-md text-bone-3 hover:text-bad hover:bg-paper-4 opacity-0 group-hover:opacity-100 transition-all"
                              >
                                <X size={12} strokeWidth={2.2} />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Section>

        {/* ------------- review ------------- */}
        <Section
          title="Review"
          hint="Measured in time completed, not entries ticked."
        >
          <div className="form-well">
            <div className="flex items-baseline gap-3 mb-3 flex-wrap">
              <span className="font-mono text-[22px] tnum text-ink-0 font-semibold">
                {formatDuration(review.doneMinutes)}
              </span>
              <span className="font-mono text-[12px] text-ink-3 tnum">
                of {formatDuration(review.plannedMinutes)} planned
              </span>
              {review.plannedMinutes > 0 && (
                <span
                  className="font-mono text-[11px] tnum px-1.5 py-0.5 rounded"
                  style={{
                    background: 'var(--good-soft, rgba(111, 191, 139,0.14))',
                    color: 'var(--good)',
                  }}
                >
                  {Math.round((review.doneMinutes / review.plannedMinutes) * 100)}%
                </span>
              )}
            </div>

            {review.byCategory.length === 0 ? (
              <Empty>Nothing was scheduled this week.</Empty>
            ) : (
              <ul className="space-y-2.5">
                {review.byCategory
                  .slice()
                  .sort((a, b) => b.planned - a.planned)
                  .map((row) => {
                    const cat = categories.find((c) => c.id === row.categoryId);
                    const accent = cat?.accent ?? '#6b7488';
                    const c = colorsFor(accent);
                    const pct = row.planned > 0 ? (row.done / row.planned) * 100 : 0;
                    return (
                      <li key={row.categoryId}>
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ background: accent }}
                          />
                          <span className="text-[12.5px] text-ink-1 flex-1 truncate">
                            {cat?.label ?? 'Uncategorised'}
                          </span>
                          <span className="font-mono text-[11px] text-ink-2 tnum">
                            {formatDuration(row.done)} / {formatDuration(row.planned)}
                          </span>
                        </div>
                        <div
                          className="h-[5px] rounded-full overflow-hidden ml-4"
                          style={{ background: c.fill }}
                        >
                          <div
                            className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${pct}%`, background: accent }}
                          />
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}

            {review.goals.length > 0 && (
              <div className="grid gap-3 md:grid-cols-4 mt-4 pt-3.5 border-t border-rule-2">
                <OutcomeList
                  label="Met"
                  color="var(--good)"
                  items={review.met.map((g) => g.goal.label)}
                />
                <OutcomeList
                  label="Slipped"
                  color="var(--signal)"
                  items={review.slipped.map(
                    (g) => `${g.goal.label} (${g.done}/${g.target})`
                  )}
                />
                <OutcomeList
                  label="Missed"
                  color="var(--bad)"
                  items={review.missed.map((g) => g.goal.label)}
                />
                {/* Reported apart from failure on purpose: a week where you
                    consciously dropped something is not a week you failed. */}
                <OutcomeList
                  label="Stood down"
                  color="var(--bone-3)"
                  items={review.voided.map((g) => g.goal.label)}
                />
              </div>
            )}
          </div>
        </Section>

        {/* ------------- the record ------------- */}
        {history.length > 0 && (
          <Section
            title="The record"
            count={history.length}
            hint="Goals reset every Monday. What they came to does not."
          >
            <ul className="flex flex-col">
              {history.map((row) => (
                <RecordRow
                  key={row.week}
                  week={row.week}
                  outcome={row.outcome}
                  onOpen={() => onWeekChange(row.week)}
                />
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

/**
 * One finished week, and what it came to.
 *
 * The bar is the point of this row. A column of numbers makes you read every line to
 * find the bad weeks; proportion makes them obvious at a glance, and the run of them
 * side by side is the thing worth seeing — one missed goal is noise, the same goal
 * missed five weeks running is the record telling you something.
 *
 * Every bucket is drawn, including the ones that are not failures, because a bar that
 * showed only met and missed would silently rescale itself whenever a goal was stood
 * down and make a lighter week look like a stronger one.
 */
function RecordRow({
  week,
  outcome,
  onOpen,
}: {
  week: string;
  outcome: WeekOutcome;
  onOpen: () => void;
}) {
  const { met, slipped, missed, voided, exceeded, total } = outcome;
  const segments = [
    { n: met, color: 'var(--good)' },
    { n: slipped, color: 'var(--signal)' },
    { n: missed, color: 'var(--bad)' },
    { n: exceeded, color: 'var(--bad)' },
    { n: voided, color: 'var(--bone-3)' },
  ].filter((s) => s.n > 0);

  return (
    <li>
      <button
        onClick={onOpen}
        className="w-full flex items-center gap-3 py-[7px] px-1 rounded-md text-left transition-colors hover:bg-chassis-2"
      >
        <span className="font-mono text-[11px] text-ink-2 tnum w-[92px] shrink-0">
          {formatWeekRange(week)}
        </span>
        <span
          className="flex-1 h-[6px] rounded-full overflow-hidden flex min-w-[60px]"
          style={{ background: 'var(--chassis-3)' }}
        >
          {segments.map((s, i) => (
            <span
              key={i}
              style={{ width: `${(s.n / total) * 100}%`, background: s.color }}
            />
          ))}
        </span>
        {/* The count reads "2 missed", never "3/5 met" — a reset erases the progress
            bar, so the number worth keeping is the one that says what slipped. */}
        <span className="font-mono text-[11px] tnum w-[74px] shrink-0 text-right">
          {missed + slipped > 0 ? (
            <span style={{ color: 'var(--bad)' }}>
              {missed + slipped} missed
            </span>
          ) : (
            <span style={{ color: 'var(--good)' }}>all met</span>
          )}
        </span>
      </button>
    </li>
  );
}

// ---------------------------------------------------------------------------

function GoalForm({
  categories,
  weekKey,
  onSubmit,
  onCancel,
}: {
  categories: CategoryDef[];
  weekKey: string;
  onSubmit: (g: WeeklyGoal) => void;
  onCancel: () => void;
}) {
  const sorted = [...categories].sort((a, b) => a.order - b.order);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState(sorted[0]?.id ?? 'other');
  const [targetKind, setTargetKind] = useState<GoalTargetKind>('sessions');
  const [target, setTarget] = useState('3');
  const [sessionMinutes, setSessionMinutes] = useState('45');
  const [cadence, setCadence] = useState<GoalCadence>('weekly');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const t = Number(target);
    const sm = Number(sessionMinutes);
    if (!label.trim()) {
      setError('Give the goal a name.');
      return;
    }
    if (!Number.isFinite(t) || t <= 0) {
      setError(
        targetKind === 'sessions'
          ? 'How many sessions? Enter a number above zero.'
          : 'How many minutes? Enter a number above zero.'
      );
      return;
    }
    if (!Number.isFinite(sm) || sm <= 0) {
      setError('A session needs a length, so the scheduler has something to place.');
      return;
    }
    onSubmit({
      id: uid(),
      label: label.trim(),
      category,
      targetKind,
      target: Math.round(t),
      sessionMinutes: Math.round(sm),
      cadence,
      active: true,
      deferrals: 0,
      originWeek: weekKey,
    });
  }

  return (
    <div className="form-well mb-6">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label>What do you mean to do?</Label>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Practise guitar"
            className="input w-full text-[13.5px] px-2.5 py-2 focus:outline-none"
          />
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

        <div>
          <Label>Target</Label>
          <div className="flex items-center gap-1.5">
            <input
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="numeric"
              className="input w-16 font-mono text-[12.5px] px-2 py-2 tnum focus:outline-none"
            />
            <div className="segmented">
              {(['sessions', 'minutes'] as GoalTargetKind[]).map((k) => (
                <button
                  key={k}
                  data-active={targetKind === k}
                  onClick={() => {
                    setTargetKind(k);
                    setTarget(k === 'sessions' ? '3' : '180');
                  }}
                  className="segmented-item"
                >
                  {k === 'sessions' ? 'sessions' : 'minutes'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div>
          <Label>Each session lasts</Label>
          <div className="flex items-center gap-1.5">
            <input
              value={sessionMinutes}
              onChange={(e) => setSessionMinutes(e.target.value)}
              inputMode="numeric"
              className="input w-16 font-mono text-[12.5px] px-2 py-2 tnum focus:outline-none"
            />
            <span className="text-[12px] text-ink-3">minutes</span>
          </div>
        </div>

        <div className="md:col-span-2">
          <Label>At the end of the week</Label>
          <div className="segmented">
            {(['weekly', 'oneOff'] as GoalCadence[]).map((k) => (
              <button
                key={k}
                data-active={cadence === k}
                onClick={() => setCadence(k)}
                className="segmented-item"
              >
                {k === 'weekly' ? 'Start again' : 'Carry what is left'}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-bone-3 leading-snug mt-1.5 max-w-[62ch]">
            {cadence === 'weekly'
              ? 'A standing intention. It reappears every Monday at its full target, and counts a deferral when it slips — the weekly target is the point, so it never shrinks.'
              : 'A finite job. Whatever is still owed moves to the carryover pile and waits there until you pull it into a week.'}
          </p>
        </div>
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
          <Target size={13} strokeWidth={2.2} />
          Add goal
        </button>
      </div>
    </div>
  );
}

function DeferralBadge({ n }: { n: number }) {
  // Escalating tone: the longer something has waited, the louder it gets.
  const tone =
    n >= 6
      ? { bg: 'rgba(224, 104, 95,0.18)', fg: 'var(--bad)' }
      : n >= 3
        ? { bg: 'rgba(255, 176, 31,0.18)', fg: 'var(--signal)' }
        : { bg: 'rgba(245, 242, 236,0.07)', fg: 'var(--bone-2)' };
  return (
    <span
      className="font-mono text-[9px] tnum px-1.5 py-[1px] rounded"
      style={{ background: tone.bg, color: tone.fg }}
      title={`Deferred ${n} week${n === 1 ? '' : 's'}`}
    >
      {n}× deferred
    </span>
  );
}

function OutcomeList({
  label,
  color,
  items,
}: {
  label: string;
  color: string;
  items: string[];
}) {
  return (
    <div>
      <div className="smallcaps text-[9.5px] mb-1.5" style={{ color }}>
        {label} · {items.length}
      </div>
      {items.length === 0 ? (
        <p className="text-[11.5px] text-bone-3">—</p>
      ) : (
        <ul className="space-y-1">
          {items.map((t, i) => (
            <li key={i} className="text-[12px] text-ink-2 leading-snug">
              {t}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Section({
  title,
  count,
  hint,
  tone,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  tone?: 'warn';
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="flex items-baseline gap-2 mb-1">
        <h2
          className="text-[15px] font-semibold"
          style={{ color: tone === 'warn' ? 'var(--signal)' : 'var(--bone-0)' }}
        >
          {title}
        </h2>
        {count != null && (
          <span className="font-mono text-[10.5px] text-bone-3 tnum">
            {String(count).padStart(2, '0')}
          </span>
        )}
      </div>
      {hint && <p className="text-[12px] text-ink-3 mb-2.5">{hint}</p>}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12.5px] text-bone-3 py-3 leading-relaxed max-w-[52ch]">
      {children}
    </p>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="smallcaps text-[9px] text-bone-3 block mb-1.5">{children}</label>
  );
}

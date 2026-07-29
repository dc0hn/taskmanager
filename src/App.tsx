import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import SideNav, { type NavKey } from './components/SideNav';
import Toolbar from './components/Toolbar';
import TimeGrid from './components/TimeGrid';
import WeekStrip from './components/WeekStrip';
import MonthView from './components/MonthView';
import IntakePanel from './components/IntakePanel';
import ProgressWheel from './components/ProgressWheel';
import SummaryCard from './components/SummaryCard';
import EditBlockModal, { type EditTarget } from './components/EditBlockModal';
import GoalsView from './components/GoalsView';
import RoutinesView from './components/RoutinesView';
import CategoriesView from './components/CategoriesView';
import Toast from './components/Toast';
import BackupModal from './components/BackupModal';
import type {
  Block,
  CarryoverItem,
  CategoryDef,
  DayPlan,
  HabitStore,
  RecurringTask,
  Settings,
  Task,
  ViewMode,
  WeeklyGoal,
  WeekRecord,
} from './types';
import {
  listPlanDates,
  loadCarryover,
  loadCategories,
  loadHabits,
  loadPlan,
  loadPlans,
  loadAllWeeks,
  loadSettings,
  loadWeek,
  savePlan,
  saveCarryover,
  saveCategories,
  saveHabits,
  saveSettings,
  saveWeek,
} from './storage';
import { buildSchedule, rulesFor } from './scheduler';
import {
  buildWeekReview,
  dropFromCarryover,
  isSealed,
  issueRecurringGoals,
  openGoals as openGoalsOf,
  pruneCredits,
  pullFromCarryover,
  reconcileCredits,
  resizeCarryover,
  resolveElapsedWeeks,
  setVoided,
} from './goals';
import {
  dueStatuses,
  pruneCompletions,
  reconcileCompletions,
  taskFromTemplate,
} from './recurrence';
import { addDays, minutesTo24h, parse24h, toDateKey } from './utils/time';
import { uid } from './utils/id';
import { effectiveStart } from './utils/planning';
import { useModalMotion, useViewMotion } from './utils/motion';
import {
  addMonths,
  addWeeks,
  currentWeekKey,
  formatWeekRange,
  monthGridDates,
  toWeekKey,
  weekDates,
} from './week';

const AXIS_W = 62; // must match TimeGrid's gutter so the week strip lines up
const SAVE_DEBOUNCE = 250;

export default function App() {
  const todayKey = toDateKey(new Date());

  const [nav, setNav] = useState<NavKey>('calendar');
  const [view, setView] = useState<ViewMode>('day');
  const [date, setDate] = useState(todayKey);
  const [monthCursor, setMonthCursor] = useState(todayKey);
  const [goalsWeek, setGoalsWeek] = useState(() => currentWeekKey());

  const [plans, setPlans] = useState<Record<string, DayPlan>>(() => ({
    [todayKey]: loadPlan(todayKey),
  }));
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [categories, setCategories] = useState<CategoryDef[]>(loadCategories);
  const [carryover, setCarryover] = useState<CarryoverItem[]>(loadCarryover);
  const [habits, setHabits] = useState<HabitStore>(loadHabits);
  const [week, setWeek] = useState<WeekRecord>(() => loadWeek(currentWeekKey()));

  const [overflow, setOverflow] = useState<Task[]>([]);
  const [overflowReasons, setOverflowReasons] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [buildPulse, setBuildPulse] = useState(0);

  const rules = useMemo(() => rulesFor(categories), [categories]);
  const weekKey = useMemo(() => toWeekKey(date), [date]);

  // -------------------------------------------------------------------------
  // Which days need to be in memory. The month grid is the widest case at 42.
  // -------------------------------------------------------------------------
  const visibleDates = useMemo(() => {
    if (view === 'week') return weekDates(weekKey);
    if (view === 'month') return monthGridDates(date);
    return [date];
  }, [view, date, weekKey]);

  const loadedDates = useMemo(() => {
    const set = new Set<string>([
      ...visibleDates,
      ...weekDates(weekKey),
      ...weekDates(goalsWeek),
      ...monthGridDates(monthCursor),
    ]);
    return [...set].sort();
  }, [visibleDates, weekKey, goalsWeek, monthCursor]);

  // Load any day we don't have yet. Existing entries are kept so unsaved edits
  // are never clobbered by a re-read.
  useEffect(() => {
    setPlans((prev) => {
      const missing = loadedDates.filter((d) => !prev[d]);
      if (missing.length === 0) return prev;
      return { ...prev, ...loadPlans(missing) };
    });
  }, [loadedDates]);

  // -------------------------------------------------------------------------
  // Persistence — per-day dirty tracking, so a keystroke doesn't rewrite 42 days
  // -------------------------------------------------------------------------
  const dirty = useRef<Set<string>>(new Set());
  const plansRef = useRef(plans);
  plansRef.current = plans;

  const flush = useCallback(() => {
    for (const d of dirty.current) {
      const plan = plansRef.current[d];
      if (plan) savePlan(plan);
    }
    dirty.current.clear();
  }, []);

  useEffect(() => {
    if (dirty.current.size === 0) return;
    const id = setTimeout(flush, SAVE_DEBOUNCE);
    return () => clearTimeout(id);
  }, [plans, flush]);

  // Flush anything still pending when the window goes away, so an edit made
  // inside the debounce window is never lost.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('beforeunload', onHide);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('beforeunload', onHide);
      window.removeEventListener('pagehide', onHide);
      flush();
    };
  }, [flush]);

  useEffect(() => saveSettings(settings), [settings]);
  useEffect(() => saveCategories(categories), [categories]);
  useEffect(() => saveCarryover(carryover), [carryover]);
  useEffect(() => saveHabits(habits), [habits]);
  useEffect(() => saveWeek(week), [week]);

  const mutateDay = useCallback(
    (day: string, fn: (plan: DayPlan) => DayPlan) => {
      setPlans((prev) => {
        const current = prev[day] ?? { date: day, tasks: [], blocks: [] };
        dirty.current.add(day);
        return { ...prev, [day]: fn(current) };
      });
    },
    []
  );

  // -------------------------------------------------------------------------
  // Lazy week rollover
  //
  // Runs on mount and whenever the calendar week changes. Nothing depends on the
  // app having been open at midnight on Sunday: elapsed weeks are resolved on
  // read, in order, and the `resolved` flag makes it idempotent.
  // -------------------------------------------------------------------------
  useEffect(() => {
    const current = currentWeekKey();

    // 1) Seal every elapsed week and move what slipped into the pile.
    const result = resolveElapsedWeeks(current, loadAllWeeks(), loadCarryover());
    if (result.changed) {
      for (const w of result.resolved) saveWeek(w);
      setCarryover(result.carryover);
    }

    // 2) Copy standing (weekly-cadence) goals into the new week. Idempotent on
    //    (goalId, weekKey), so opening the app repeatedly on a Monday issues one
    //    set rather than one per launch.
    const issued = issueRecurringGoals(current, loadAllWeeks());
    if (issued) saveWeek(issued);

    if (result.changed || issued) setWeek(loadWeek(weekKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Swap the loaded week record when the displayed week changes.
  useEffect(() => {
    setWeek((prev) => (prev.week === weekKey ? prev : loadWeek(weekKey)));
  }, [weekKey]);

  // -------------------------------------------------------------------------
  // Ledger reconciliation
  //
  // Goal credits and routine completions are both derived from what the blocks
  // actually say, reconciled here in one place. That means no mutation path has
  // to remember to update them — a resize, a delete, a move to another day, or a
  // rebuild all flow through this.
  //
  // Crucially, only days we actually have information about may be reconciled.
  // `loadPlan` returns an empty plan for a date that has never been saved, and
  // treating that emptiness as proof that nothing happened would erase real
  // history: opening the month view would silently wipe every streak and credit
  // whose day record had since been trimmed. A date counts as authoritative only
  // once it has a stored record, or once it has blocks in memory.
  // -------------------------------------------------------------------------
  const authoritativeDates = useMemo(() => {
    const stored = new Set(listPlanDates());
    return loadedDates.filter(
      (d) => stored.has(d) || (plans[d]?.blocks.length ?? 0) > 0
    );
  }, [loadedDates, plans]);

  useEffect(() => {
    // A sealed week is settled history. Its outcome has already been folded into
    // the carryover pile, so rewriting its credits now would leave the two
    // disagreeing with no way to tell which was right.
    if (isSealed(week)) return;

    let credits = week.credits;
    for (const d of weekDates(week.week)) {
      if (!authoritativeDates.includes(d)) continue;
      credits = reconcileCredits(credits, d, plans[d]?.blocks ?? []);
    }
    credits = pruneCredits(credits, currentWeekKey());
    if (JSON.stringify(credits) !== JSON.stringify(week.credits)) {
      setWeek((prev) => ({ ...prev, credits }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, authoritativeDates, week]);

  useEffect(() => {
    let completions = habits.completions;
    for (const d of authoritativeDates) {
      completions = reconcileCompletions(completions, d, plans[d]?.blocks ?? []);
    }
    completions = pruneCompletions(completions, todayKey);
    if (JSON.stringify(completions) !== JSON.stringify(habits.completions)) {
      setHabits((prev) => ({ ...prev, completions }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plans, authoritativeDates, habits.completions]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------
  const dayPlan = plans[date] ?? { date, tasks: [], blocks: [] };

  const busyDates = useMemo(() => {
    const set = new Set<string>();
    for (const [d, p] of Object.entries(plans)) {
      if (p.blocks.some((b) => !b.auto)) set.add(d);
    }
    return set;
  }, [plans]);

  /** Category time across whatever the current view covers — feeds the nav legend. */
  const categoryTime = useMemo(() => {
    const out: Record<string, { done: number; planned: number }> = {};
    for (const d of visibleDates) {
      for (const b of plans[d]?.blocks ?? []) {
        if (b.auto) continue;
        const m = b.end - b.start;
        if (!Number.isFinite(m) || m <= 0) continue;
        const row = out[b.category] ?? { done: 0, planned: 0 };
        row.planned += m;
        if (b.completed) row.done += m;
        out[b.category] = row;
      }
    }
    return out;
  }, [visibleDates, plans]);

  const categoryUsage = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of Object.values(plans)) {
      for (const b of p.blocks) out[b.category] = (out[b.category] ?? 0) + 1;
    }
    return out;
  }, [plans]);

  const openGoals = useMemo(() => openGoalsOf(week), [week]);

  const dueRoutines = useMemo(() => {
    const placed = new Set<string>();
    for (const t of dayPlan.tasks) if (t.templateId) placed.add(t.templateId);
    for (const b of dayPlan.blocks) if (b.templateId) placed.add(b.templateId);
    return dueStatuses(habits, date, placed);
  }, [habits, date, dayPlan]);

  const goalsWeekRecord = useMemo(
    () => (goalsWeek === week.week ? week : loadWeek(goalsWeek)),
    [goalsWeek, week]
  );

  const review = useMemo(() => {
    const blocksByDate: Record<string, Block[]> = {};
    for (const d of weekDates(goalsWeek)) {
      blocksByDate[d] = plans[d]?.blocks ?? [];
    }
    return buildWeekReview(goalsWeekRecord, blocksByDate);
  }, [goalsWeekRecord, goalsWeek, plans]);

  const canReplan = useMemo(
    () => dayPlan.blocks.some((b) => !b.completed && !b.auto),
    [dayPlan.blocks]
  );

  // -------------------------------------------------------------------------
  // Day-level actions
  // -------------------------------------------------------------------------
  const handleAddTasks = useCallback(
    (newTasks: Task[]) => {
      mutateDay(date, (p) => ({ ...p, tasks: [...p.tasks, ...newTasks] }));
    },
    [date, mutateDay]
  );

  const handleUpdateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      mutateDay(date, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }));
    },
    [date, mutateDay]
  );

  const handleRemoveTask = useCallback(
    (id: string) => {
      mutateDay(date, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== id) }));
    },
    [date, mutateDay]
  );

  const handleBuildDay = useCallback(() => {
    const plan = plans[date];
    if (!plan || plan.tasks.length === 0) return;

    const intakeFixed = plan.tasks.filter((t) => t.fixedTime != null);
    const intakeFlex = plan.tasks.filter((t) => t.fixedTime == null);

    const conflictsWithIntake = (start: number, end: number) =>
      intakeFixed.some((t) => {
        const fs = t.fixedTime!;
        const fe = fs + t.duration;
        return !(fe <= start || fs >= end);
      });

    // Auto blocks are scheduler-owned; drop them and let the build recompute.
    const existing = plan.blocks.filter((b) => !b.auto);
    const preserved = existing.filter((b) => !conflictsWithIntake(b.start, b.end));
    const displaced: Task[] = existing
      .filter((b) => conflictsWithIntake(b.start, b.end))
      .map((b) => ({
        id: b.id,
        title: b.title,
        duration: b.end - b.start,
        category: b.category,
        priority: 'normal' as const,
        goalId: b.goalId,
        templateId: b.templateId,
      }));

    const result = buildSchedule(
      [...intakeFixed, ...displaced, ...intakeFlex],
      effectiveStart(date, settings),
      settings.workingEnd,
      preserved,
      rules
    );

    const completed = new Set(plan.blocks.filter((b) => b.completed).map((b) => b.id));
    const blocks = result.blocks.map((b) =>
      completed.has(b.id) ? { ...b, completed: true } : b
    );

    mutateDay(date, (p) => ({ ...p, blocks, tasks: [] }));
    setOverflow(result.overflow);
    setOverflowReasons(result.reasons);
    setBuildPulse((n) => n + 1);
  }, [plans, date, settings, rules, mutateDay]);

  const handleRebuildFromNow = useCallback(() => {
    const plan = plans[date];
    if (!plan) return;

    const completedBlocks = plan.blocks.filter((b) => b.completed);
    const completedIds = new Set(completedBlocks.map((b) => b.id));

    const reflow: Task[] = plan.blocks
      .filter((b) => !b.completed && !b.auto)
      .map((b) => ({
        id: b.id,
        title: b.title,
        duration: b.end - b.start,
        category: b.category,
        priority: 'normal' as const,
        goalId: b.goalId,
        templateId: b.templateId,
      }));

    const toPlace = [...plan.tasks, ...reflow];
    if (toPlace.length === 0) return;

    const result = buildSchedule(
      toPlace,
      effectiveStart(date, settings),
      settings.workingEnd,
      completedBlocks,
      rules
    );

    const blocks = result.blocks.map((b) =>
      completedIds.has(b.id) ? { ...b, completed: true } : b
    );

    mutateDay(date, (p) => ({ ...p, blocks, tasks: [] }));
    setOverflow(result.overflow);
    setOverflowReasons(result.reasons);
    setBuildPulse((n) => n + 1);
  }, [plans, date, settings, rules, mutateDay]);

  // -------------------------------------------------------------------------
  // Block actions — all keyed by date, because the week grid spans seven days
  // -------------------------------------------------------------------------
  const handleChangeBlock = useCallback(
    (day: string, id: string, patch: Partial<Block>) => {
      mutateDay(day, (p) => ({
        ...p,
        blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }));
    },
    [mutateDay]
  );

  /** Move a block between two days — the cross-column drag, and the modal's day field. */
  const handleMoveBlock = useCallback(
    (from: string, id: string, to: string, patch: Partial<Block>) => {
      const source = plansRef.current[from];
      const block = source?.blocks.find((b) => b.id === id);
      if (!block) return;
      mutateDay(from, (p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) }));
      mutateDay(to, (p) => ({ ...p, blocks: [...p.blocks, { ...block, ...patch }] }));
    },
    [mutateDay]
  );

  const handleToggleComplete = useCallback(
    (day: string, id: string) => {
      const block = plansRef.current[day]?.blocks.find((b) => b.id === id);

      // The block itself always toggles — that is a fact about your day. But if it
      // is credited to a goal in a week that has already been sealed, say so
      // rather than appearing to change a total that will not move.
      if (block?.goalId) {
        const owning = loadWeek(toWeekKey(day));
        if (isSealed(owning)) {
          setToast(
            `That week (${formatWeekRange(owning.week)}) is already closed, so its goal totals won't change. Pull the goal into this week to keep working on it.`
          );
        }
      }

      mutateDay(day, (p) => ({
        ...p,
        blocks: p.blocks.map((b) =>
          b.id === id ? { ...b, completed: !b.completed } : b
        ),
      }));
    },
    [mutateDay]
  );

  const handleDeleteBlock = useCallback(
    (day: string, id: string) => {
      mutateDay(day, (p) => ({ ...p, blocks: p.blocks.filter((b) => b.id !== id) }));
      setEditing(null);
    },
    [mutateDay]
  );

  const handleCreateBlock = useCallback(
    (day: string, start: number) => {
      const end = Math.min(start + 30, 24 * 60);
      const id = uid();
      const block: Block = { id, title: 'New entry', start, end, category: categories[0]?.id ?? 'other' };
      mutateDay(day, (p) => ({ ...p, blocks: [...p.blocks, block] }));
      setEditing({ date: day, block });
    },
    [mutateDay, categories]
  );

  const handleEditBlock = useCallback(
    (day: string, id: string) => {
      const block = plansRef.current[day]?.blocks.find((b) => b.id === id);
      if (block) setEditing({ date: day, block });
    },
    []
  );

  /** "Add entry" in the toolbar — find the first free half hour and open the editor. */
  const handleQuickAdd = useCallback(() => {
    const target = view === 'month' ? date : date;
    const blocks = plansRef.current[target]?.blocks ?? [];
    const from = effectiveStart(target, settings);
    for (let s = Math.ceil(from / 15) * 15; s + 30 <= settings.workingEnd; s += 15) {
      const clash = blocks.some((b) => !(s + 30 <= b.start || s >= b.end));
      if (!clash) {
        handleCreateBlock(target, s);
        return;
      }
    }
    setToast(
      `There's no free half hour left before ${minutesTo24h(
        settings.workingEnd
      )}. Extend your working hours or move something.`
    );
  }, [view, date, settings, handleCreateBlock]);

  // -------------------------------------------------------------------------
  // Goals and routines feeding into intake
  // -------------------------------------------------------------------------
  const handleAddGoalTask = useCallback(
    (goal: WeeklyGoal) => {
      handleAddTasks([
        {
          id: uid(),
          title: goal.label,
          duration: goal.sessionMinutes,
          category: goal.category,
          priority: 'normal',
          goalId: goal.id,
        },
      ]);
    },
    [handleAddTasks]
  );

  const handleAddRoutineTask = useCallback(
    (template: RecurringTask) => {
      handleAddTasks([taskFromTemplate(template)]);
    },
    [handleAddTasks]
  );

  /**
   * A goal and a routine that share a name are one piece of work. This adds a
   * single task carrying both ids, so ticking it credits the goal session and
   * the streak at once — no double scheduling, and no special-casing downstream,
   * because the two ledgers each reconcile off their own field.
   *
   * Duration comes from the goal's `sessionMinutes` rather than the routine's:
   * the goal is what progress is measured against, so its session estimate is
   * the figure the scheduler was asked to place.
   */
  const handleAddPairedTask = useCallback(
    (goal: WeeklyGoal, template: RecurringTask) => {
      handleAddTasks([
        {
          id: uid(),
          title: goal.label,
          duration: goal.sessionMinutes,
          category: goal.category,
          fixedTime: template.fixedTime,
          priority: template.priority,
          goalId: goal.id,
          templateId: template.id,
        },
      ]);
    },
    [handleAddTasks]
  );

  const handleAddGoal = useCallback(
    (goal: WeeklyGoal) => {
      if (goalsWeek === week.week) {
        setWeek((prev) => ({ ...prev, goals: [...prev.goals, goal] }));
      } else {
        const target = loadWeek(goalsWeek);
        saveWeek({ ...target, goals: [...target.goals, goal] });
        setGoalsWeek(goalsWeek); // force the memo to re-read
      }
    },
    [goalsWeek, week.week]
  );

  const handleRemoveGoal = useCallback(
    (id: string) => {
      if (goalsWeek === week.week) {
        setWeek((prev) => ({ ...prev, goals: prev.goals.filter((g) => g.id !== id) }));
      } else {
        const target = loadWeek(goalsWeek);
        saveWeek({ ...target, goals: target.goals.filter((g) => g.id !== id) });
        setGoalsWeek(goalsWeek);
      }
    },
    [goalsWeek, week.week]
  );

  const handlePullCarryover = useCallback(
    (goalId: string) => {
      const target = goalsWeek === week.week ? week : loadWeek(goalsWeek);
      const result = pullFromCarryover(target, carryover, goalId);
      setCarryover(result.carryover);
      if (goalsWeek === week.week) setWeek(result.week);
      else saveWeek(result.week);
    },
    [goalsWeek, week, carryover]
  );

  const handleDropCarryover = useCallback(
    (goalId: string) => setCarryover((prev) => dropFromCarryover(prev, goalId)),
    []
  );

  const handleResizeCarryover = useCallback(
    (goalId: string, residual: number) =>
      setCarryover((prev) => resizeCarryover(prev, goalId, residual)),
    []
  );

  /** Stand a goal down for the week, or bring it back. */
  const handleSetVoided = useCallback(
    (goalId: string, voided: boolean) => {
      if (goalsWeek === week.week) {
        setWeek((prev) => setVoided(prev, goalId, voided));
      } else {
        saveWeek(setVoided(loadWeek(goalsWeek), goalId, voided));
        setGoalsWeek(goalsWeek);
      }
    },
    [goalsWeek, week.week]
  );

  // -------------------------------------------------------------------------
  // Routines
  // -------------------------------------------------------------------------
  const handleAddRoutine = useCallback((t: RecurringTask) => {
    setHabits((prev) => ({ ...prev, templates: [...prev.templates, t] }));
  }, []);

  const handleUpdateRoutine = useCallback((id: string, patch: Partial<RecurringTask>) => {
    setHabits((prev) => ({
      ...prev,
      templates: prev.templates.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  }, []);

  const handleRemoveRoutine = useCallback((id: string) => {
    setHabits((prev) => ({
      ...prev,
      templates: prev.templates.filter((t) => t.id !== id),
      // Keep the completion history — it belongs to the days it happened on.
      completions: prev.completions,
    }));
  }, []);

  // -------------------------------------------------------------------------
  // Categories
  // -------------------------------------------------------------------------
  const handleAddCategory = useCallback((c: CategoryDef) => {
    setCategories((prev) => [...prev, c]);
  }, []);

  const handleUpdateCategory = useCallback((id: string, patch: Partial<CategoryDef>) => {
    setCategories((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, []);

  const handleRemoveCategory = useCallback((id: string) => {
    setCategories((prev) => {
      const next = prev.filter((c) => c.id !== id);
      // Never leave the list empty: pickers would be blank and every block would
      // resolve to Uncategorised.
      return next.length > 0 ? next : prev;
    });
  }, []);

  const handleReorderCategory = useCallback((id: string, dir: -1 | 1) => {
    setCategories((prev) => {
      const sorted = [...prev].sort((a, b) => a.order - b.order);
      const i = sorted.findIndex((c) => c.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sorted.length) return prev;
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      return sorted.map((c, idx) => ({ ...c, order: idx }));
    });
  }, []);

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------
  // Direction of travel, so a view transition moves the way the date is moving.
  // Stepping forward slides content in from the right; stepping back, the left.
  // Without this the same crossfade plays both ways and navigation stops feeling
  // spatial.
  const [travel, setTravel] = useState(0);

  const handleStep = useCallback(
    (dir: -1 | 1) => {
      setTravel(dir);
      if (view === 'day') setDate((d) => addDays(d, dir));
      else if (view === 'week') setDate((d) => addWeeks(d, dir));
      else setDate((d) => addMonths(d, dir));
    },
    [view]
  );

  useEffect(() => {
    setMonthCursor(date);
  }, [date]);

  const handleSelectDate = useCallback((d: string) => {
    setDate(d);
    setNav('calendar');
  }, []);

  const handleOpenDay = useCallback((d: string) => {
    setDate(d);
    setView('day');
  }, []);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  return (
    <div className="flex h-full w-full overflow-hidden">
      <SideNav
        nav={nav}
        onNav={setNav}
        cursor={monthCursor}
        selected={date}
        busyDates={busyDates}
        onSelectDate={handleSelectDate}
        onCursorChange={setMonthCursor}
        categories={categories}
        categoryTime={categoryTime}
        settings={settings}
        onOpenHours={() => setHoursOpen(true)}
        onOpenBackup={() => setBackupOpen(true)}
        badges={{
          goals: openGoals.length,
          routines: dueRoutines.filter((r) => r.streak.dueToday && !r.placed).length,
          carryover: carryover.length,
        }}
      />

      <main className="flex-1 min-w-0 flex flex-col h-full">
        {nav === 'calendar' && (
          <>
            <Toolbar
              view={view}
              onView={setView}
              date={date}
              weekKey={weekKey}
              onStep={handleStep}
              onToday={() => setDate(todayKey)}
              onAdd={handleQuickAdd}
              canReplan={canReplan && view === 'day'}
              onRebuildFromNow={handleRebuildFromNow}
            />

            {/* One keyed region per view+period, so switching view OR stepping
                the date animates. The key includes the period so consecutive
                days cross-fade rather than snapping. */}
            <ViewTransition viewKey={`${view}:${view === 'week' ? weekKey : date}`} travel={travel}>
            {view === 'month' ? (
              <MonthView
                cursor={date}
                plans={plans}
                categories={categories}
                onOpenDay={handleOpenDay}
                onEditBlock={handleEditBlock}
              />
            ) : view === 'week' ? (
              <div className="flex-1 min-h-0 flex flex-col px-6 pb-6">
                {/* One framed region — a single hairline, not a card inside a card. */}
                <div className="framed flex-1 min-h-0 flex flex-col overflow-hidden">
                  <WeekStrip
                    weekKey={weekKey}
                    plans={plans}
                    selected={date}
                    onSelectDay={handleOpenDay}
                    axisWidth={AXIS_W}
                  />
                  <TimeGrid
                    dates={visibleDates}
                    plans={plans}
                    categories={categories}
                    workingStart={settings.workingStart}
                    workingEnd={settings.workingEnd}
                    buildPulse={buildPulse}
                    onChangeBlock={handleChangeBlock}
                    onMoveBlock={handleMoveBlock}
                    onEditBlock={handleEditBlock}
                    onCreateBlock={handleCreateBlock}
                    onToggleComplete={handleToggleComplete}
                    onRefuse={setToast}
                    density="compact"
                  />
                </div>
              </div>
            ) : (
              // Asymmetric two-column measure — the sheet dominates, the margin
              // annotates. Divided by a single vertical rule rather than a gap
              // between two floating cards.
              <div className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[1fr_356px] px-6 pb-6 gap-0">
                <div className="framed flex flex-col min-h-0 overflow-hidden">
                  <TimeGrid
                    dates={[date]}
                    plans={plans}
                    categories={categories}
                    workingStart={settings.workingStart}
                    workingEnd={settings.workingEnd}
                    buildPulse={buildPulse}
                    onChangeBlock={handleChangeBlock}
                    onMoveBlock={handleMoveBlock}
                    onEditBlock={handleEditBlock}
                    onCreateBlock={handleCreateBlock}
                    onToggleComplete={handleToggleComplete}
                    onRefuse={setToast}
                    density="comfortable"
                  />
                </div>

                {/* The margin. Continuous surface, sections separated by rules —
                    `.panel + .panel` draws the hairline, so nothing here is a card.
                    A single vertical rule divides it from the sheet; that rule is
                    the whole reason this doesn't need to be a second card. */}
                <div className="min-h-0 overflow-y-auto thin-scroll xl:pl-6 xl:ml-6 xl:border-l xl:border-rule-2">
                  <ProgressWheel blocks={dayPlan.blocks} />
                  <IntakePanel
                    tasks={dayPlan.tasks}
                    overflow={overflow}
                    overflowReasons={overflowReasons}
                    categories={categories}
                    openGoals={openGoals}
                    dueRoutines={dueRoutines}
                    onAddTasks={handleAddTasks}
                    onUpdateTask={handleUpdateTask}
                    onRemoveTask={handleRemoveTask}
                    onBuildDay={handleBuildDay}
                    onClearOverflow={() => {
                      setOverflow([]);
                      setOverflowReasons({});
                    }}
                    onAddGoal={handleAddGoalTask}
                    onAddRoutine={handleAddRoutineTask}
                    onAddPaired={handleAddPairedTask}
                  />
                  <SummaryCard blocks={dayPlan.blocks} categories={categories} />
                </div>
              </div>
            )}
            </ViewTransition>
          </>
        )}

        {nav === 'goals' && (
          <>
            <div className="titlebar-drag" />
            <GoalsView
              week={goalsWeekRecord}
              weekKey={goalsWeek}
              onWeekChange={setGoalsWeek}
              carryover={carryover}
              categories={categories}
              review={review}
              onAddGoal={handleAddGoal}
              onRemoveGoal={handleRemoveGoal}
              onSetVoided={handleSetVoided}
              onPullCarryover={handlePullCarryover}
              onDropCarryover={handleDropCarryover}
              onResizeCarryover={handleResizeCarryover}
            />
          </>
        )}

        {nav === 'routines' && (
          <>
            <div className="titlebar-drag" />
            <RoutinesView
              store={habits}
              categories={categories}
              onAdd={handleAddRoutine}
              onUpdate={handleUpdateRoutine}
              onRemove={handleRemoveRoutine}
            />
          </>
        )}

        {nav === 'categories' && (
          <>
            <div className="titlebar-drag" />
            <CategoriesView
              categories={categories}
              usage={categoryUsage}
              onAdd={handleAddCategory}
              onUpdate={handleUpdateCategory}
              onRemove={handleRemoveCategory}
              onReorder={handleReorderCategory}
            />
          </>
        )}
      </main>

      <EditBlockModal
        target={editing}
        plans={plans}
        categories={categories}
        onClose={() => setEditing(null)}
        onSave={(day, id, patch, moveTo) => {
          if (moveTo) handleMoveBlock(day, id, moveTo, patch);
          else handleChangeBlock(day, id, patch);
          setEditing(null);
        }}
        onDelete={handleDeleteBlock}
      />

      <WorkingHoursModal
        open={hoursOpen}
        settings={settings}
        onClose={() => setHoursOpen(false)}
        onSave={setSettings}
        onError={setToast}
      />

      <BackupModal
        open={backupOpen}
        today={todayKey}
        onClose={() => setBackupOpen(false)}
        onNotify={setToast}
      />

      <Toast message={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Wraps the calendar body so switching view or stepping the period animates.
 *
 * No AnimatePresence: changing `key` remounts the div, which replays its
 * entrance while the previous view is simply gone. See the note on
 * `useViewMotion` for why exit animation is deliberately absent here — both
 * cross-fading and mode="wait" produce a worse result for full-height views.
 */
function ViewTransition({
  viewKey,
  travel,
  children,
}: {
  viewKey: string;
  travel: number;
  children: React.ReactNode;
}) {
  const motionProps = useViewMotion(travel);
  return (
    <motion.div
      key={viewKey}
      {...motionProps}
      className="flex-1 min-h-0 flex flex-col"
    >
      {children}
    </motion.div>
  );
}

function WorkingHoursModal({
  open,
  settings,
  onClose,
  onSave,
  onError,
}: {
  open: boolean;
  settings: Settings;
  onClose: () => void;
  onSave: (s: Settings) => void;
  onError: (msg: string) => void;
}) {
  const [start, setStart] = useState(minutesTo24h(settings.workingStart));
  const [end, setEnd] = useState(minutesTo24h(settings.workingEnd));

  useEffect(() => {
    setStart(minutesTo24h(settings.workingStart));
    setEnd(minutesTo24h(settings.workingEnd));
  }, [settings, open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function apply() {
    const s = parse24h(start);
    const e = parse24h(end);
    if (s == null || e == null) {
      onError('Working hours need to be times in HH:MM form.');
      return;
    }
    if (e <= s) {
      onError('The end of your working day has to come after the start.');
      return;
    }
    onSave({ workingStart: s, workingEnd: e });
    onClose();
  }

  // Shared motion vocabulary — same curves as every other modal, and it collapses
  // to an instant opacity change under prefers-reduced-motion.
  const m = useModalMotion();

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'rgba(8, 8, 7, 0.70)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={onClose}
            {...m.overlay}
          />
          <motion.div
            {...m.card}
            className="relative raised rounded-xl6 w-full max-w-sm p-6"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className="legend">Settings</span>
                <h3 className="font-display text-title text-bone-0 mt-1">
                  Working hours
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid place-items-center w-7 h-7 rounded-lg text-ink-3 hover:text-ink-0 hover:bg-paper-4 transition-colors"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
            <div className="rule-h mb-4" />

            <p className="text-[12px] text-ink-3 mb-3 leading-relaxed">
              The scheduler only places work inside this window, and reserves the last
              fifteen minutes as a shutdown block.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="smallcaps text-[9px] text-bone-3 block mb-1.5">
                  Start
                </label>
                <input
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="input w-full font-mono text-[12.5px] px-2.5 py-2 tnum focus:outline-none"
                />
              </div>
              <div>
                <label className="smallcaps text-[9px] text-bone-3 block mb-1.5">
                  End
                </label>
                <input
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="input w-full font-mono text-[12.5px] px-2.5 py-2 tnum focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={onClose}
                className="text-[12px] font-medium text-ink-3 hover:text-ink-0 px-3 py-2 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                className="btn-primary text-body-sm px-4 h-8"
              >
                Save
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

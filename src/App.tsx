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
  DailyStat,
  DayMarkDef,
  DayMarks,
  DayPlan,
  HabitStore,
  RecurringTask,
  Settings,
  AwardLedger,
  BadgeDef,
  DisciplineId,
  StreakState,
  Task,
  UserProgress,
  ViewMode,
  WeeklyGoal,
  WeekRecord,
} from './types';
import {
  listPlanDates,
  loadCarryover,
  loadCategories,
  loadDayMarkDefs,
  loadDayMarks,
  loadHabits,
  loadPlan,
  loadPlans,
  loadAllMonths,
  loadAllWeeks,
  loadSettings,
  loadWeek,
  savePlan,
  saveMonth,
  saveCarryover,
  saveCategories,
  loadAwards,
  loadDayStats,
  loadShop,
  loadProgress,
  loadStreak,
  saveDayMarkDefs,
  saveDayMarks,
  saveAwards,
  saveDayStats,
  saveShop,
  saveProgress,
  saveStreak,
  saveHabits,
  saveSettings,
  saveWeek,
} from './storage';
import DayMarkImport from './components/DayMarkImport';
import {
  applyProposal,
  countMarksInMonth,
  cycleMark,
  describeMarks,
  markById,
  monthsWithMarks,
  setMark,
} from './daymarks';
import { buildSchedule, rulesFor } from './scheduler';
import StandingView from './components/StandingView';
import { BadgeUnlockToast } from './components/BadgeShelf';
import { QuestDoneToast } from './components/QuestBoard';
import { CodexUnlockToast } from './components/CodexPanel';
import {
  boostFor,
  emptyShop,
  equip as equipItem,
  freezeCapacity,
  hasExtraWildcard,
  itemById,
  offersFor,
  purchase,
  spendRefill,
  unequip as unequipSlot,
  type ShopState,
} from './shop';
import {
  buildInsightContext,
  insightById,
  insightStatuses,
  isRead,
  readKey,
  unlocksDue,
} from './insights';
import {
  buildWeekContext,
  dailyChallenge,
  questPayout,
  questsFor,
  weeklyChallenge,
} from './quests';
import {
  mergeDisciplines,
  planAheadDue,
  reviewAwardsDue,
} from './bonuses';
import { emptyAwards } from './streaks';
import {
  badgeById,
  badgeContext,
  badgeIdFromKey,
  badgeStatuses,
  evaluateBadges,
} from './badges';
import {
  areaTotals,
  LEVELS_PER_CYCLE,
  RANKS,
  levelsCrossed,
  pruneStats,
  comboRuns,
  reckonDay,
  xpForBlock,
  reconcileDays,
  standingFor,
  isScored,
  resetProgress,
  withinRetention,
  type Standing,
} from './progress';
import {
  LevelTakeover,
  LevelToast,
  RunKeptToast,
  RunTakeover,
  XpFloat,
  type FloatingXp,
} from './components/pixel/XpToast';
import {
  biggestStreakMilestone,
  deservesTakeover,
  FREEZE_CAPACITY,
  displayRun,
  grantAwards,
  resetStreak,
  resolveStreak,
  routineAwardsDue,
  STREAK_THRESHOLD,
  todayQualifies,
} from './streaks';
import {
  isSfxEnabled,
  setSfxEnabled,
  sfxComplete,
  sfxCombo,
  sfxDayCleared,
  sfxLevel,
  sfxMilestone,
  sfxPrestige,
  sfxSpend,
} from './utils/sfx';
import MonthsView from './components/MonthsView';
import {
  currentMonthKey,
  emptyMonthRecord,
  monthInProgress,
  resolveElapsedMonths,
} from './month';
import {
  describeReflow,
  reflowInsert,
  reflowPlace,
  reflowRemove,
} from './reflow';
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
import { addDays, formatDuration, minutesTo24h, parse24h, toDateKey } from './utils/time';
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

/**
 * Minutes since midnight of `dayKey`, right now.
 *
 * Keeps counting past midnight: ticking a Monday block at 00:30 on Tuesday returns
 * 1470, not 30. Without that, anything finished in the small hours would score as
 * though it had been done before breakfast — and the punctuality bonus would be
 * handed out for work that was hours late.
 */
function minutesSinceMidnightOf(dayKey: string): number {
  const now = new Date();
  const todayKey = toDateKey(now);
  const wallMinutes = now.getHours() * 60 + now.getMinutes();
  if (dayKey === todayKey) return wallMinutes;
  const [y1, m1, d1] = dayKey.split('-').map(Number);
  const [y2, m2, d2] = todayKey.split('-').map(Number);
  const dayDiff = Math.round(
    (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000
  );
  // Ticking a *future* day's block clamps to its own end-of-day rather than going
  // negative, which would read as absurdly early.
  return dayDiff > 0 ? dayDiff * 1440 + wallMinutes : wallMinutes;
}

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
  const [markDefs, setMarkDefs] = useState<DayMarkDef[]>(loadDayMarkDefs);
  const [dayMarks, setDayMarks] = useState<DayMarks>(loadDayMarks);
  const [progress, setProgress] = useState<UserProgress>(loadProgress);
  const [dayStats, setDayStats] = useState<Record<string, DailyStat>>(loadDayStats);
  const [streak, setStreak] = useState<StreakState>(loadStreak);
  const [awards, setAwards] = useState<AwardLedger>(loadAwards);
  const [shop, setShop] = useState<ShopState>(loadShop);

  const [overflow, setOverflow] = useState<Task[]>([]);
  const [overflowReasons, setOverflowReasons] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [marksOpen, setMarksOpen] = useState(false);
  const [buildPulse, setBuildPulse] = useState(0);

  // Reward presentation. Three queues rather than one flag, because a single
  // generous day can cross several levels and each deserves its own moment.
  const [xpFloat, setXpFloat] = useState<FloatingXp | null>(null);
  /**
   * Level-ups queue rather than replace.
   *
   * One completion awards XP in several stages — the block, then badges, then a
   * challenge — and each stage can cross a level. A single slot meant the later
   * crossings stomped the earlier ones, so a jump from level 0 to 6 announced whichever
   * toast happened to be mounted rather than where you ended up.
   */
  const [levelQueue, setLevelQueue] = useState<Standing[]>([]);
  const [takeover, setTakeover] = useState<{ standing: Standing; prestige: boolean } | null>(null);
  const [sfxOn, setSfxOn] = useState(false);
  const [runKept, setRunKept] = useState<{ run: number; seed: number } | null>(null);
  const [runTakeover, setRunTakeover] = useState<number | null>(null);
  const [questQueue, setQuestQueue] = useState<{ name: string; xp: number }[]>([]);
  const [codexQueue, setCodexQueue] = useState<{ name: string; glyph: string; xp: number }[]>([]);
  const [badgeQueue, setBadgeQueue] = useState<BadgeDef[]>([]);
  /** Set on the day a comeback is paid, so the matching badge can see it. */
  const comebackTodayRef = useRef(false);

  const rules = useMemo(() => rulesFor(categories), [categories]);
  const weekKey = useMemo(() => toWeekKey(date), [date]);

  // Rewards clear themselves. Keyed on the award so a second completion inside the
  // window restarts the clock rather than inheriting the first one's remaining time.
  useEffect(() => {
    if (!xpFloat) return;
    const id = setTimeout(() => setXpFloat(null), 1000);
    return () => clearTimeout(id);
  }, [xpFloat]);

  useEffect(() => {
    if (levelQueue.length === 0) return;
    // Shorter than the badge queue: these are frequent and each says one word.
    const id = setTimeout(() => setLevelQueue((q) => q.slice(1)), 2200);
    return () => clearTimeout(id);
  }, [levelQueue]);

  useEffect(() => {
    if (!runKept) return;
    const id = setTimeout(() => setRunKept(null), 2600);
    return () => clearTimeout(id);
  }, [runKept]);

  // Badges show one at a time. Dropping the head after a beat lets the exit animation
  // hand over to the next, so a day that trips four of them plays four moments rather
  // than one card flickering between names.
  useEffect(() => {
    if (badgeQueue.length === 0) return;
    const id = setTimeout(() => setBadgeQueue((q) => q.slice(1)), 2800);
    return () => clearTimeout(id);
  }, [badgeQueue]);

  // The takeover is dismissed by clicking, but any key should also clear it — it
  // covers the screen, so every plausible "get out of my way" gesture must work.
  useEffect(() => {
    if (!takeover && runTakeover == null) return;
    const onKey = () => {
      setTakeover(null);
      setRunTakeover(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [takeover, runTakeover]);

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
  useEffect(() => saveDayMarkDefs(markDefs), [markDefs]);
  useEffect(() => saveDayMarks(dayMarks), [dayMarks]);
  // The ledger is written BEFORE the total it pays for, and the order is deliberate.
  //
  // Effects flush in declaration order, and there is no transaction across
  // localStorage keys — the process could in principle die between two writes. Every
  // other figure here is derived and self-heals: day stats and the XP total are
  // recomputed from the blocks, so a half-written pair converges on the next launch.
  // The award ledger is the one record that cannot be recomputed, and it is the one
  // that decides whether a one-off award gets paid again.
  //
  // So: ledger first. Losing that write means the award is unrecorded and re-granted,
  // paying the same XP twice, forever. Losing the progress write instead means the
  // award is recorded as paid and its XP is missed once. A single missed badge beats a
  // lifetime total that quietly climbs on every crash.
  useEffect(() => saveAwards(awards), [awards]);
  useEffect(() => saveProgress(progress), [progress]);
  useEffect(() => {
    // The module owns the AudioContext, so the toggle has to reach it as well as
    // localStorage — otherwise the switch flips and nothing changes.
    setSfxEnabled(sfxOn);
    try {
      localStorage.setItem('dp:sfx:v1', sfxOn ? '1' : '0');
    } catch {
      // A refused write only costs the preference, never the session.
    }
  }, [sfxOn]);
  useEffect(() => {
    try {
      const stored = localStorage.getItem('dp:sfx:v1');
      if (stored === '1') setSfxOn(true);
    } catch {
      // Ships silent, which is the safe default anyway.
    }
    setSfxOn((v) => (isSfxEnabled() ? true : v));
  }, []);
  useEffect(() => saveDayStats(dayStats), [dayStats]);
  useEffect(() => saveStreak(streak), [streak]);
  useEffect(() => saveShop(shop), [shop]);
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

    // 3) Seal every elapsed month and empty the carryover pile into it. The pile
    //    is month-scoped now: on the 1st it resets, and what was still waiting is
    //    written into that month's record as "carried and let go" rather than
    //    disappearing. Same lazy, idempotent shape as the weekly rollover — the
    //    presence of a month record is the guard.
    const monthResult = resolveElapsedMonths(
      currentMonthKey(),
      loadAllMonths(),
      loadAllWeeks(),
      result.changed ? result.carryover : loadCarryover(),
      todayKey
    );
    if (monthResult.changed) {
      for (const m of monthResult.sealed) saveMonth(m);
      setCarryover(monthResult.carryover);
    }

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
  // Progression
  //
  // A start date, then a per-day reconcile that runs on every change.
  //
  // There used to be a backfill here that scored the whole archive on first run, so
  // an existing user began at the level their history had already earned. That was
  // wrong in a way that only showed up later: it handed over a level nobody had
  // played for, and it made a reset impossible to mean — zeroing the total left every
  // past day unscored-but-scoreable, so the next month-view visit earned it all again.
  //
  // Now nothing before `startedOn` is ever counted. Reconciliation is still
  // idempotent: a day's XP is recomputed from its blocks and only the *difference*
  // against the stored figure moves the lifetime total, so this is safe to run on
  // every render pass.
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (progress.startedOn) return;
    // First run. Begin at nothing, counting from today.
    setProgress((p) => ({ ...p, startedOn: todayKey }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Reconcile every day currently in memory.
   *
   * Keyed on a cheap signature of the loaded days rather than on `plans` itself, so
   * an unrelated re-render does not re-walk 42 days. `progressRef` keeps the effect
   * off the progress object, which it writes to — depending on what you set is how
   * you get a render loop.
   */
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const statsRef = useRef(dayStats);
  statsRef.current = dayStats;

  const dayFingerprint = useMemo(
    () =>
      authoritativeDates
        .filter((d) => plans[d] != null)
        .map((d) => {
          const bs = plans[d].blocks;
          return `${d}:${bs.map((b) => `${b.id}${b.completed ? '1' : '0'}${b.start}-${b.end}${b.completedAt ?? ''}`).join(',')}`;
        })
        .join('|'),
    [authoritativeDates, plans]
  );

  useEffect(() => {
    if (!progressRef.current.startedOn) return;
    // Two guards, both load-bearing.
    //
    // `withinRetention` stops a pruned day being reconciled, which would read its
    // delta as the whole amount and count its XP twice.
    //
    // The presence check stops a day being scored before its plan has loaded. A date
    // becomes authoritative as soon as a stored record exists, but `plans` fills in
    // asynchronously — so without this, every day is briefly scored as EMPTY and then
    // rescored once its blocks arrive. The balance came out right because the two
    // deltas cancelled, which is exactly why it went unnoticed.
    const days = authoritativeDates
      .filter(
        (d) =>
          isScored(d, progressRef.current.startedOn) &&
          withinRetention(d, todayKey) &&
          plansRef.current[d] != null
      )
      .map((d) => ({ date: d, blocks: plansRef.current[d]!.blocks }));
    const boosts = Object.fromEntries(days.map((d) => [d.date, boostFor(shopRef.current, d.date)]));
    const before = progressRef.current.totalXp;
    const result = reconcileDays(progressRef.current, statsRef.current, days, categories, boosts);
    if (!result.changed) return;

    setProgress(result.progress);
    setDayStats(pruneStats(result.stats, todayKey));

    // Celebrate only forward movement. Un-ticking something silently gives the XP
    // back — no message, no sad noise. Momentum, not guilt.
    const after = result.progress.totalXp;
    if (after <= before) return;

    const crossed = levelsCrossed(before, after);
    if (crossed.length === 0) return;

    /**
     * Which crossing to put on screen when a single day crossed several.
     *
     * Not simply the last one. A day that prestiges may carry on into level 3 of the
     * new cycle, and celebrating level 3 would bury the thing that actually happened
     * — so a prestige crossing wins, then the highest arc capstone, then the last
     * ordinary level. The XP figure and meter always show the true current standing
     * regardless, so nothing here misreports where you are.
     */
    const startPrestige = standingFor(before).prestige;
    const prestigeCrossing = crossed.find((c) => c.prestige > startPrestige);
    const milestoneCrossing = [...crossed].reverse().find((c) => c.milestone);
    const celebrate = prestigeCrossing ?? milestoneCrossing ?? crossed[crossed.length - 1];

    if (prestigeCrossing) {
      setTakeover({ standing: prestigeCrossing, prestige: true });
      sfxPrestige();
    } else if (milestoneCrossing) {
      setTakeover({ standing: milestoneCrossing, prestige: false });
      sfxMilestone();
    } else {
      // Only the level actually arrived at, not every step to it: a burst of six
      // toasts for one completion is noise, and the last one is the news.
      setLevelQueue((q) => [...q, celebrate]);
      sfxLevel();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayFingerprint, categories]);

  // -------------------------------------------------------------------------
  // Streak resolution
  //
  // Runs after the XP pass, because it reads the day stats that pass produces.
  // Lazy and idempotent in the same way as the weekly and monthly rollovers: the
  // app may have been shut for a fortnight, so every elapsed day is walked once and
  // `resolvedThrough` is what stops it being walked twice.
  //
  // Today is deliberately never settled here — a morning with nothing done yet must
  // not break a run the afternoon was about to save.
  // -------------------------------------------------------------------------
  const streakRef = useRef(streak);
  streakRef.current = streak;
  const awardsRef = useRef(awards);
  awardsRef.current = awards;

  /**
   * Grant one-off awards and advance the ledger in the same step.
   *
   * Assigning the ref here is the whole point, and the reason is not obvious.
   *
   * Several effects grant in a single commit — one completion can finish a quest,
   * unlock a badge and keep the run all at once. Each of them used to build its new
   * ledger from `awardsRef.current`, which is only refreshed on render, so every
   * effect in the flush started from the same snapshot and produced a whole new
   * ledger object. The last `setAwards` won, and the earlier effects' keys were
   * simply gone — while their XP had already been paid. On the next launch those
   * keys were due again, and paid a second time. A lifetime total that inflated by
   * a badge here and a quest there, with nothing in the record to show why.
   *
   * Advancing the ref makes each grant visible to the next one in the same flush.
   * It also makes a re-run harmless, which is what StrictMode does on mount.
   */
  const grantOnce = useCallback((keys: string[]): string[] => {
    const { ledger, granted } = grantAwards(awardsRef.current, keys);
    if (granted.length === 0) return [];
    awardsRef.current = ledger;
    setAwards(ledger);
    return granted;
  }, []);

  useEffect(() => {
    if (!progressRef.current.startedOn) return;
    const withCapacity = {
      ...streakRef.current,
      capacity: freezeCapacity(shopRef.current, FREEZE_CAPACITY),
    };
    const result = resolveStreak(
      withCapacity,
      statsRef.current,
      dayMarks,
      todayKey,
      STREAK_THRESHOLD,
      progressRef.current.startedOn
    );
    if (!result.changed && result.state.capacity === streakRef.current.capacity) return;

    setStreak(result.state);

    // One-off awards go through the ledger, so the same comeback can never be paid
    // twice however many times this effect runs.
    if (result.awards.length > 0 || result.brass > 0) {
      const granted = grantOnce(result.awards);
      // Award XP only for keys that were genuinely new; kept-day brass is guarded by
      // `resolvedThrough` instead, since it is paid per day rather than per award.
      const xp = granted.length > 0 ? result.xp : 0;
      const brass = result.brass + Math.max(0, Math.round(xp * 0.1));
      if (xp > 0 || brass > 0) {
        setProgress((p) => ({ ...p, totalXp: p.totalXp + xp, brass: p.brass + brass }));
      }
      const milestone = biggestStreakMilestone(granted);
      if (deservesTakeover(milestone)) {
        setRunTakeover(milestone);
        sfxMilestone();
      } else if (milestone != null) {
        setToast(`${milestone} days running. +${result.xp} XP.`);
      }
    }

    // Say something only when the safety net actually did something, or when a run
    // ended. Both are framed as what they are: the net worked, or today starts over.
    if (result.awards.some((k) => k.startsWith('comeback:'))) {
      comebackTodayRef.current = true;
    }

    const froze = result.days.filter((d) => d.outcome === 'frozen');
    const reset = result.days.some((d) => d.outcome === 'reset');
    if (froze.length > 0) {
      setToast(
        froze.length === 1
          ? `A freeze covered ${froze[0].date} — your run is intact.`
          : `${froze.length} freezes were used while you were away. Your run is intact.`
      );
    } else if (reset) {
      setToast('Your run starts fresh today. The first day you finish is worth extra.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStats, dayMarks, todayKey]);

  /**
   * Routine streak milestones, paid once each.
   *
   * Separate from day-streak resolution because a routine's run is derived from its
   * own completion log, not from whether the day as a whole was kept — the two
   * measure different things and only meet here, in the same currency.
   */
  useEffect(() => {
    const runs = dueStatuses(habits, todayKey, new Set()).map((r) => ({
      templateId: r.template.id,
      current: r.streak.current,
    }));
    const due = routineAwardsDue(awardsRef.current, runs);
    if (due.keys.length === 0) return;
    const granted = grantOnce(due.keys);
    if (granted.length === 0) return;
    setProgress((p) => ({
      ...p,
      totalXp: p.totalXp + due.xp,
      brass: p.brass + Math.max(1, Math.round(due.xp * 0.1)),
    }));
    const first = granted[0].split(':');
    const label = habits.templates.find((t) => t.id === first[1])?.label ?? 'A routine';
    setToast(`${label} — ${first[2]} days running. +${due.xp} XP.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [habits, todayKey]);

  /**
   * Pay a habit bonus, once.
   *
   * Everything routes through the ledger, so an effect that re-runs on every render
   * cannot pay twice — the same guarantee the badges and streak milestones rely on.
   */
  const payBonus = useCallback(
    (award: { keys: string[]; xp: number; disciplines: Partial<Record<DisciplineId, number>>; labels: string[] }) => {
      if (award.keys.length === 0) return;
      if (grantOnce(award.keys).length === 0) return;
      setProgress((p) => ({
        ...p,
        totalXp: p.totalXp + award.xp,
        brass: p.brass + Math.max(1, Math.round(award.xp * 0.1)),
        disciplines: mergeDisciplines(p.disciplines ?? {}, award.disciplines),
      }));
      setToast(`${award.labels.join(' · ')} · +${award.xp} XP`);
    },
    [grantOnce]
  );

  /**
   * Tomorrow planned while it is still today.
   *
   * Watched rather than hooked to the build button, because a day can be planned by
   * building it, by dragging a block into it, or by adding one directly — and the
   * bonus is for the outcome, not for one particular route to it.
   */
  useEffect(() => {
    if (!progressRef.current.startedOn) return;
    payBonus(planAheadDue(awardsRef.current, plansRef.current, todayKey));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayFingerprint, todayKey, payBonus]);

  /**
   * Evaluate the badge library.
   *
   * Runs after the XP and streak passes, because it reads what both produce. Every
   * grant goes through the award ledger, so a condition that stays true forever —
   * "reach level 5" — pays exactly once however many times this is evaluated.
   *
   * `startedOn` is the epoch: counting badges measure from the day scoring began, so
   * a calendar full of older work cannot pre-unlock achievements it never earned.
   */
  useEffect(() => {
    if (!progressRef.current.startedOn) return;
    const context = badgeContext({
      progress: progressRef.current,
      streak: streakRef.current,
      stats: statsRef.current,
      marks: dayMarks,
      todayBlocks: plansRef.current[todayKey]?.blocks ?? [],
      categories,
      today: todayKey,
      epoch: progressRef.current.startedOn,
      comebackToday: comebackTodayRef.current,
    });
    const due = evaluateBadges(awardsRef.current, context);
    if (due.keys.length === 0) return;

    const granted = grantOnce(due.keys);
    if (granted.length === 0) return;

    // Built by loop rather than filtered: `badgeById` returns the rule, which carries
    // a `test` function, and a type predicate narrowing to the plain def would be
    // widening rather than narrowing.
    const defs: BadgeDef[] = [];
    for (const key of granted) {
      const def = badgeById(badgeIdFromKey(key));
      if (def) defs.push(def);
    }
    const xp = defs.reduce((sum, d) => sum + d.xp, 0);
    setProgress((p) => ({
      ...p,
      totalXp: p.totalXp + xp,
      brass: p.brass + Math.max(1, Math.round(xp * 0.1)),
    }));
    setBadgeQueue((q) => [...q, ...defs]);
    sfxLevel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStats, streak, dayMarks, todayKey, categories]);

  /**
   * Fire once when today crosses the threshold.
   *
   * Watched rather than computed inside the completion handler, because a day can
   * also cross by editing a block's length or un-ticking something elsewhere — and
   * the flourish should follow the fact, not one particular gesture that caused it.
   */
  const keptTodayRef = useRef<boolean | null>(null);
  useEffect(() => {
    const kept = todayQualifies(
      dayStats[todayKey],
      dayMarks[todayKey] != null
    );
    const was = keptTodayRef.current;
    keptTodayRef.current = kept;
    // First observation only establishes the baseline; it is not an event.
    if (was === null || was === kept || !kept) return;
    setRunKept({ run: streakRef.current.current + 1, seed: Date.now() });
    sfxDayCleared();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayStats, dayMarks, todayKey]);

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

  /**
   * Sealed months plus the one in progress.
   *
   * Past months are read from their own records, because credits are pruned at
   * twelve weeks and could not reconstruct them. The current month is computed
   * live from the week records so the gauge moves as you tick things off, and is
   * flagged as provisional in the view — a part-month measured against a whole
   * month's target necessarily reads low.
   */
  const monthRecords = useMemo(() => {
    const current = currentMonthKey();
    const sealed = loadAllMonths().filter((m) => m.month !== current);
    const rows = [...sealed, monthInProgress(current, loadAllWeeks())];

    // A month can hold day marks without holding any goal history — import a past
    // month's gig schedule and there is nothing for the rollover to have sealed. It
    // still needs a row, or those marks are counted nowhere.
    const listed = new Set(rows.map((m) => m.month));
    for (const monthKey of monthsWithMarks(dayMarks)) {
      if (listed.has(monthKey)) continue;
      rows.push(emptyMonthRecord(monthKey));
      listed.add(monthKey);
    }
    return rows;
    // `week` is a dependency so ticking a block re-reads the month in progress.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, carryover, nav, dayMarks]);

  /** This month's ratio per goal id, for the small gauge on each weekly goal. */
  const monthRatios = useMemo(() => {
    const live = monthInProgress(currentMonthKey(), loadAllWeeks());
    const out: Record<string, { ratio: number; done: number; target: number }> = {};
    for (const g of live.goals) {
      out[g.goalId] = { ratio: g.ratio, done: g.done, target: g.monthlyTarget };
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

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

  const reviewSeen = useRef('');

  const review = useMemo(() => {
    const blocksByDate: Record<string, Block[]> = {};
    for (const d of weekDates(goalsWeek)) {
      blocksByDate[d] = plans[d]?.blocks ?? [];
    }
    return buildWeekReview(goalsWeekRecord, blocksByDate);
  }, [goalsWeekRecord, goalsWeek, plans]);

  /**
   * Reading a finished week's review.
   *
   * Granted on looking rather than at rollover, and the reason is data: a review is
   * derived from that week's blocks, and blocks fall out of the retention window. At
   * the moment you are looking at it, everything needed is already loaded — and
   * looking is the behaviour being rewarded.
   *
   * The ref guards against re-firing while the same week sits on screen; the ledger
   * guards against ever paying twice.
   */
  useEffect(() => {
    if (nav !== 'goals') return;
    if (!progressRef.current.startedOn) return;
    const seenKey = `${goalsWeek}`;
    if (reviewSeen.current === seenKey) return;
    reviewSeen.current = seenKey;
    payBonus(reviewAwardsDue(awardsRef.current, goalsWeek, currentWeekKey(), review));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, goalsWeek, review, payBonus]);

  /** Area XP across everything currently loaded. */
  const areas = useMemo(() => {
    const t = areaTotals(
      authoritativeDates.map((d) => ({ date: d, blocks: plans[d]?.blocks ?? [] })),
      categories
    );
    // Consistency is the one discipline not derived from blocks — it accumulates in
    // the streak record as days are kept, so it is merged in rather than computed.
    // Focus and Endurance are derived from blocks; Consistency accumulates in the
    // streak record; Planning and Insight are banked in progress. Three homes because
    // they have three different natures, merged here for display only.
    return {
      byCategory: t.byCategory,
      byDiscipline: {
        ...t.byDiscipline,
        consistency: streak.consistencyXp,
        ...(progress.disciplines ?? {}),
      },
    };
  }, [authoritativeDates, plans, categories, streak.consistencyXp, progress.disciplines]);

  const todayReckoning = useMemo(
    () => reckonDay(todayKey, plans[todayKey]?.blocks ?? [], categories),
    [plans, todayKey, categories]
  );

  /** The trailing fortnight, oldest first, for the spark columns. */
  const recentDates = useMemo(
    () => Array.from({ length: 14 }, (_, i) => addDays(todayKey, i - 13)),
    [todayKey]
  );

  /**
   * This week's board, generated fresh.
   *
   * Keyed to the week the calendar is showing rather than to today, so stepping back
   * shows what that week offered. Only the CURRENT week can pay out — see the effect
   * below — because a past week's set is history, not an outstanding mission.
   */
  const questContext = useMemo(
    () =>
      buildWeekContext({
        weekKey,
        plans,
        stats: dayStats,
        week,
        habits,
        marks: dayMarks,
        markDefs,
        categories,
        startedOn: progress.startedOn,
      }),
    [weekKey, plans, dayStats, week, habits, dayMarks, markDefs, categories, progress.startedOn]
  );

  const quests = useMemo(
    () => questsFor(questContext, { extraWildcard: hasExtraWildcard(shop) }),
    [questContext, shop]
  );
  const daily = useMemo(() => dailyChallenge(questContext, todayKey), [questContext, todayKey]);
  const weekly = useMemo(() => weeklyChallenge(questContext), [questContext]);

  /**
   * A wide trailing window for the codex.
   *
   * Loaded from storage rather than taken from `plans`, which only ever holds what the
   * calendar is showing — a requirement of "twenty timed completions" that moved
   * whenever you changed view would be unusable. Only computed while Standing is open,
   * because it is ninety reads.
   */
  const INSIGHT_WINDOW_DAYS = 90;
  const insightContext = useMemo(() => {
    if (nav !== 'standing') return buildInsightContext({}, [], dayStats, categories);
    const dates = Array.from({ length: INSIGHT_WINDOW_DAYS }, (_, i) =>
      addDays(todayKey, i - (INSIGHT_WINDOW_DAYS - 1))
    );
    const stored = new Set(listPlanDates());
    // Only the scored era. An insight drawn from days before you started would pay XP
    // for history the rest of the system deliberately ignores.
    const wanted = dates.filter((d) => stored.has(d) && isScored(d, progress.startedOn));
    return buildInsightContext(loadPlans(wanted), wanted, dayStats, categories);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, todayKey, dayStats, categories, progress.startedOn]);

  const codex = useMemo(
    () => insightStatuses(awards, insightContext),
    [awards, insightContext]
  );

  const standing = useMemo(() => standingFor(progress.totalXp), [progress.totalXp]);

  /**
   * Unseal codex cards whose data requirement is met.
   *
   * Only while Standing is open, since that is the only time the wide window is
   * loaded. An insight that unsealed silently in the background would pay for a
   * discovery you never saw.
   */
  useEffect(() => {
    if (nav !== 'standing') return;
    if (!progressRef.current.startedOn) return;
    const due = unlocksDue(awardsRef.current, insightContext);
    if (due.keys.length === 0) return;

    if (grantOnce(due.keys).length === 0) return;
    setProgress((p) => ({
      ...p,
      totalXp: p.totalXp + due.xp,
      brass: p.brass + Math.max(1, Math.round(due.xp * 0.1)),
      disciplines: mergeDisciplines(p.disciplines ?? {}, { insight: due.xp }),
    }));
    setCodexQueue((q) => [
      ...q,
      ...due.ids.flatMap((id) => {
        const rule = insightById(id);
        return rule ? [{ name: rule.name, glyph: rule.glyph, xp: rule.xpUnlock }] : [];
      }),
    ]);
    sfxMilestone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav, insightContext]);

  useEffect(() => {
    if (codexQueue.length === 0) return;
    const id = setTimeout(() => setCodexQueue((q) => q.slice(1)), 3200);
    return () => clearTimeout(id);
  }, [codexQueue]);

  const shopRef = useRef(shop);
  shopRef.current = shop;

  const shopOffers = useMemo(
    () => offersFor(shop, progress, weekKey),
    [shop, progress, weekKey]
  );

  const handleBuy = useCallback(
    (itemId: string) => {
      const result = purchase(shopRef.current, progressRef.current, weekKey, itemId);
      if (!result.ok) {
        const offer = shopOffers.find((o) => o.item.id === itemId);
        setToast(
          result.reason === 'brass'
            ? `Not enough brass — ${((offer?.item.price ?? 0) - progressRef.current.brass).toLocaleString()} short.`
            : result.reason === 'level'
              ? `That needs level ${offer?.needsLevel}.`
              : result.reason === 'rotation'
                ? 'Out of stock this week.'
                : 'You already hold as many as you can.'
        );
        return;
      }
      setShop(result.shop);
      // Brass falls and the lifetime spend rises by the same amount, which is what
      // keeps derived earnings equal to balance plus spend.
      setProgress((p) => ({
        ...p,
        brass: Math.max(0, p.brass - result.spend),
        brassSpent: p.brassSpent + result.spend,
      }));
      const item = itemById(itemId);
      setToast(`${item?.name ?? 'Bought'} — ${result.spend.toLocaleString()} brass.`);
      sfxSpend();
    },
    [weekKey, shopOffers]
  );

  /**
   * Start again from nothing, counting from today.
   *
   * Clears every earned figure at once — XP, brass, the day ledger, the run, the award
   * ledger and the shop — and stamps a new start date. That last part is what makes it
   * stick: without it, reconciliation would find unscored days in the past and earn
   * them all back on the next visit to the month view.
   *
   * Deliberately does NOT touch plans, goals, routines, categories or day marks. Those
   * are your work, not your score.
   */
  const handleResetProgress = useCallback(() => {
    setProgress(resetProgress(todayKey));
    setDayStats({});
    setStreak(resetStreak(todayKey));
    setAwards(emptyAwards());
    setShop(emptyShop());
    setBadgeQueue([]);
    setCodexQueue([]);
    setQuestQueue([]);
    setLevelQueue([]);
    setTakeover(null);
    setRunTakeover(null);
    setRunKept(null);
    keptTodayRef.current = null;
    reviewSeen.current = '';
    comebackTodayRef.current = false;
    setToast('Standing reset. Level 0, nothing earned — counting from today.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayKey]);

  const handleEquip = useCallback((itemId: string) => {
    setShop((s) => equipItem(s, itemId));
  }, []);

  const handleUnequip = useCallback((slot: 'finish' | 'meter' | 'title' | 'frame') => {
    setShop((s) => unequipSlot(s, slot));
  }, []);

  /**
   * Spend a freeze refill the moment one is held and a freeze is missing.
   *
   * Applied automatically for the same reason the freeze itself is: something bought
   * to protect a run should not need remembering at the moment it is needed.
   */
  useEffect(() => {
    if ((shop.stock['freeze-refill'] ?? 0) === 0) return;
    if (streak.freezes >= streak.capacity) return;
    const r = spendRefill(shopRef.current);
    if (!r.ok) return;
    setShop(r.shop);
    setStreak((st) => ({ ...st, freezes: Math.min(st.capacity, st.freezes + 1) }));
    setToast('Freeze refilled.');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop.stock, streak.freezes, streak.capacity]);

  /**
   * Paid the first time a card is actually opened.
   *
   * Reading is a separate reward from unsealing because they are separate acts: the
   * data earned the unseal, but an insight you have not looked at has done nothing
   * for you.
   */
  const handleReadInsight = useCallback((id: string) => {
    if (isRead(awardsRef.current, id)) return;
    const rule = insightById(id);
    if (!rule) return;
    if (grantOnce([readKey(id)]).length === 0) return;
    setProgress((p) => ({
      ...p,
      totalXp: p.totalXp + rule.xpRead,
      brass: p.brass + Math.max(1, Math.round(rule.xpRead * 0.1)),
      disciplines: mergeDisciplines(p.disciplines ?? {}, { insight: rule.xpRead }),
    }));
    setToast(`${rule.name} — read. +${rule.xpRead} XP`);
  }, [grantOnce]);

  /**
   * Pay finished quests and challenges.
   *
   * Guarded on the week being the current one: a past week's board is a record, and
   * scrolling back through the calendar must not hand out bonuses for sets that closed
   * weeks ago. The ledger would stop a second payment, but it would not stop a first
   * one that was never earned in the present.
   */
  useEffect(() => {
    if (!progressRef.current.startedOn) return;
    if (weekKey !== currentWeekKey()) return;
    const due = questPayout(awardsRef.current, quests, [daily, weekly]);
    if (due.keys.length === 0) return;

    if (grantOnce(due.keys).length === 0) return;
    setProgress((p) => ({
      ...p,
      totalXp: p.totalXp + due.xp,
      brass: p.brass + Math.max(1, Math.round(due.xp * 0.1)),
    }));

    // One entry per finished thing, so a day that closes three plays three moments.
    const names = new Set(due.names);
    setQuestQueue((q) => [
      ...q,
      ...[...names].map((name) => ({
        name,
        xp:
          quests.find((x) => x.name === name)?.bonusXp ??
          [daily, weekly].find((c) => c.name === name)?.xp ??
          0,
      })),
    ]);
    sfxMilestone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quests, daily, weekly, weekKey]);

  useEffect(() => {
    if (questQueue.length === 0) return;
    const id = setTimeout(() => setQuestQueue((q) => q.slice(1)), 2800);
    return () => clearTimeout(id);
  }, [questQueue]);


  const badges = useMemo(
    () =>
      badgeStatuses(
        awards,
        badgeContext({
          progress,
          streak,
          stats: dayStats,
          marks: dayMarks,
          todayBlocks: plans[todayKey]?.blocks ?? [],
          categories,
          today: todayKey,
          epoch: progress.startedOn,
          comebackToday: false,
        })
      ),
    [awards, progress, streak, dayStats, dayMarks, plans, todayKey, categories]
  );

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

  /**
   * A marked day warns but never blocks.
   *
   * The mark records something about the day the scheduler knows nothing about —
   * a flight, a shoot — so the honest move is to say so and let the decision
   * stand. Refusing to build would make the mark a cage.
   */
  const warnIfMarked = useCallback(
    (day: string, placed: number) => {
      const mark = markById(markDefs, dayMarks[day]);
      if (!mark) return;
      setToast(
        `${placed} block${placed === 1 ? '' : 's'} placed — heads up, this day is marked ${mark.label.toLowerCase()}.`
      );
    },
    [markDefs, dayMarks]
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
    // Priority lives on the Task and is consumed by the scheduler; carrying it onto
    // the Block is what lets effort be weighted after the fact.
    const priorityOf = new Map(
      [...intakeFixed, ...displaced, ...intakeFlex].map((t) => [t.id, t.priority])
    );
    const blocks = result.blocks.map((b) => {
      const withPriority =
        priorityOf.get(b.id) === 'high' ? { ...b, priority: 'high' as const } : b;
      return completed.has(b.id) ? { ...withPriority, completed: true } : withPriority;
    });

    mutateDay(date, (p) => ({ ...p, blocks, tasks: [] }));
    setOverflow(result.overflow);
    setOverflowReasons(result.reasons);
    setBuildPulse((n) => n + 1);
    warnIfMarked(date, blocks.filter((b) => !b.auto).length);
  }, [plans, date, settings, rules, mutateDay, warnIfMarked]);

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
    warnIfMarked(date, blocks.filter((b) => !b.auto).length);
  }, [plans, date, settings, rules, mutateDay, warnIfMarked]);

  // -------------------------------------------------------------------------
  // Block actions — all keyed by date, because the week grid spans seven days
  // -------------------------------------------------------------------------
  /**
   * Change a block. When the change is geometric — a drag or a resize — the rest
   * of the day reflows around it: what collides gets pushed down by the least
   * amount that clears it, and the slot left behind closes up. Non-geometric
   * edits (title, category, completion) just patch.
   */
  const handleChangeBlock = useCallback(
    (day: string, id: string, patch: Partial<Block>) => {
      const geometric = patch.start != null || patch.end != null;
      if (!geometric) {
        mutateDay(day, (p) => ({
          ...p,
          blocks: p.blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)),
        }));
        return;
      }

      const plan = plansRef.current[day];
      const current = plan?.blocks.find((b) => b.id === id);
      if (!plan || !current) return;

      const start = patch.start ?? current.start;
      const end = patch.end ?? current.end;
      const outcome = reflowPlace(plan.blocks, id, start, end, settings.workingEnd);

      if (!outcome.ok) {
        if (outcome.message) setToast(outcome.message);
        return;
      }
      // Any non-geometric fields in the same patch still need applying.
      const rest = { ...patch };
      delete rest.start;
      delete rest.end;
      mutateDay(day, (p) => ({
        ...p,
        blocks: outcome.blocks.map((b) =>
          b.id === id ? { ...b, ...rest } : b
        ),
      }));
      const note = describeReflow(outcome, formatDuration);
      if (note) setToast(note);
    },
    [mutateDay, settings.workingEnd]
  );

  const handleTogglePin = useCallback(
    (day: string, id: string) => {
      mutateDay(day, (p) => ({
        ...p,
        blocks: p.blocks.map((b) => (b.id === id ? { ...b, pinned: !b.pinned } : b)),
      }));
    },
    [mutateDay]
  );

  /**
   * Move a block between two days — the cross-column drag, and the modal's day
   * field. Both ends reflow: the destination makes room, and the day it left
   * closes the slot behind it.
   */
  const handleMoveBlock = useCallback(
    (from: string, id: string, to: string, patch: Partial<Block>) => {
      const source = plansRef.current[from];
      const block = source?.blocks.find((b) => b.id === id);
      if (!source || !block) return;

      // A deliberate move, so it counts. Reflow displacement deliberately does not:
      // one drag can push six blocks down, and counting those would mark all seven
      // as rescheduled and make the number meaningless.
      const incoming = { ...block, ...patch, moves: (block.moves ?? 0) + 1 };
      const destination = plansRef.current[to]?.blocks ?? [];
      const landing = reflowInsert(destination, incoming, settings.workingEnd);
      if (!landing.ok) {
        if (landing.message) setToast(landing.message);
        return;
      }

      // Only close the source once the destination has accepted it, so a refused
      // move leaves both days untouched.
      const vacated = reflowRemove(source.blocks, id, settings.workingEnd);
      mutateDay(from, (p) => ({ ...p, blocks: vacated.blocks }));
      mutateDay(to, (p) => ({ ...p, blocks: landing.blocks }));

      const note = describeReflow(landing, formatDuration);
      if (note) setToast(note);
    },
    [mutateDay, settings.workingEnd]
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

      const nowCompleted = !block?.completed;

      mutateDay(day, (p) => ({
        ...p,
        blocks: p.blocks.map((b) =>
          b.id === id
            ? {
                ...b,
                completed: !b.completed,
                // Stamped on the way in, cleared on the way out so an un-tick
                // leaves no claim about when anything happened.
                completedAt: !b.completed ? minutesSinceMidnightOf(day) : undefined,
              }
            : b
        ),
      }));

      if (!nowCompleted || !block) return;

      // Immediate feedback, computed here rather than waiting for the reconcile
      // pass — a reward that arrives a frame after the click does not feel caused
      // by it. The authoritative total still comes from reconciliation.
      const dayBlocks = (plansRef.current[day]?.blocks ?? []).map((b) =>
        b.id === id ? { ...b, completed: true, completedAt: minutesSinceMidnightOf(day) } : b
      );
      const run = comboRuns(dayBlocks).get(id) ?? 0;
      const { xp } = xpForBlock(
        { ...block, completed: true, completedAt: minutesSinceMidnightOf(day) },
        categories,
        run
      );
      setXpFloat({ key: Date.now(), xp, combo: run });
      if (run > 0) sfxCombo(run);
      else sfxComplete();

      const after = reckonDay(day, dayBlocks, categories);
      const before = reckonDay(day, plansRef.current[day]?.blocks ?? [], categories);
      if (after.stat.cleared && !before.stat.cleared) sfxDayCleared();
    },
    [mutateDay, categories]
  );

  const handleDeleteBlock = useCallback(
    (day: string, id: string) => {
      // Removing an entry closes the slot behind it, same as dragging one away.
      mutateDay(day, (p) => ({
        ...p,
        blocks: reflowRemove(p.blocks, id, settings.workingEnd).blocks,
      }));
      setEditing(null);
    },
    [mutateDay, settings.workingEnd]
  );

  const handleCreateBlock = useCallback(
    (day: string, start: number) => {
      const end = Math.min(start + 30, 24 * 60);
      const block: Block = {
        id: uid(),
        title: 'New entry',
        start,
        end,
        category: categories[0]?.id ?? 'other',
      };
      // Clicking an occupied hour now inserts and pushes down rather than doing
      // nothing. Only pinned or completed work can refuse the slot.
      const existing = plansRef.current[day]?.blocks ?? [];
      const landing = reflowInsert(existing, block, settings.workingEnd);
      if (!landing.ok) {
        if (landing.message) setToast(landing.message);
        return;
      }
      mutateDay(day, (p) => ({ ...p, blocks: landing.blocks }));
      setEditing({ date: day, block });
      const note = describeReflow(landing, formatDuration);
      if (note) setToast(note);
    },
    [mutateDay, categories, settings.workingEnd]
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
  // Day marks
  // -------------------------------------------------------------------------
  const handleCycleMark = useCallback(
    (day: string) => {
      if (markDefs.length === 0) {
        setToast('No day marks defined yet. Add some under Categories.');
        return;
      }
      setDayMarks((prev) => {
        const next = cycleMark(prev[day] ?? null, markDefs);
        return setMark(prev, day, next);
      });
    },
    [markDefs]
  );

  const handleApplyMarks = useCallback(
    (proposal: Record<string, string | null>) => {
      // Report what actually CHANGED, not what the proposal covers. A proposal spans
      // every day of the month, carrying null for the ones the sampler declined, so
      // counting nulls reads "cleared 25" for a month that was already blank.
      let marked = 0;
      let cleared = 0;
      for (const [date, markId] of Object.entries(proposal)) {
        const was = dayMarks[date] ?? null;
        if (markId === was) continue;
        if (markId === null) cleared++;
        else marked++;
      }

      setDayMarks((prev) => applyProposal(prev, proposal));
      setMarksOpen(false);
      setToast(
        marked === 0 && cleared === 0
          ? 'Nothing changed — those days already read that way.'
          : [
              marked > 0 ? `Marked ${marked} day${marked === 1 ? '' : 's'}` : '',
              cleared > 0 ? `cleared ${cleared}` : '',
            ]
              .filter(Boolean)
              .join(', ') + '.'
      );
    },
    [dayMarks]
  );

  /**
   * Renaming or recolouring a mark is safe — marks reference definitions by id, so
   * every already-marked day follows the change. Deleting one leaves orphans, which
   * `orphanedMarks` surfaces rather than silently hiding.
   */
  const handleChangeMarkDefs = useCallback((defs: DayMarkDef[]) => {
    setMarkDefs(defs);
  }, []);

  const markSummaryForCursor = useMemo(
    () => describeMarks(countMarksInMonth(dayMarks, monthCursor.slice(0, 7)), markDefs),
    [dayMarks, monthCursor, markDefs]
  );

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
        standing={{
          level: standing.level,
          rank: standing.rank,
          progress: standing.levelProgress,
          sigilForm: standing.sigilForm,
          sigilPips: standing.sigilPips,
        }}
        brass={progress.brass}
        run={displayRun(streak, dayStats[todayKey], dayMarks[todayKey] != null)}
        freezes={streak.freezes}
        sfxOn={sfxOn}
        onToggleSfx={() => setSfxOn((v) => !v)}
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
              // The importer reads a whole month at once, so it is only offered
              // where a whole month is on screen.
              onImportMarks={view === 'month' ? () => setMarksOpen(true) : undefined}
              markSummary={view === 'month' ? markSummaryForCursor : ''}
              dayMark={markById(markDefs, dayMarks[date])}
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
                marks={dayMarks}
                markDefs={markDefs}
                onOpenDay={handleOpenDay}
                onEditBlock={handleEditBlock}
                onCycleMark={handleCycleMark}
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
                    marks={dayMarks}
                    markDefs={markDefs}
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
                    onTogglePin={handleTogglePin}
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
                    onTogglePin={handleTogglePin}
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
              monthRatios={monthRatios}
              onAddGoal={handleAddGoal}
              onRemoveGoal={handleRemoveGoal}
              onSetVoided={handleSetVoided}
              onPullCarryover={handlePullCarryover}
              onDropCarryover={handleDropCarryover}
              onResizeCarryover={handleResizeCarryover}
            />
          </>
        )}

        {nav === 'standing' && (
          <>
            <div className="titlebar-drag" />
            <StandingView
              progress={progress}
              streak={streak}
              todayKey={todayKey}
              marks={dayMarks}
              markDefs={markDefs}
              badges={badges}
              shop={shop}
              shopOffers={shopOffers}
              onResetProgress={handleResetProgress}
              onBuy={handleBuy}
              onEquipItem={handleEquip}
              onUnequipSlot={handleUnequip}
              previousWeekKey={addWeeks(weekKey, -1)}
              codex={codex}
              onReadInsight={handleReadInsight}
              insightWindowDays={INSIGHT_WINDOW_DAYS}
              quests={quests}
              daily={daily}
              weekly={weekly}
              awards={awards}
              routines={dueRoutines.map((r) => ({
                id: r.template.id,
                label: r.template.label,
                current: r.streak.current,
                dueToday: r.streak.dueToday,
                doneToday: r.streak.doneToday,
              }))}
              today={dayStats[todayKey]}
              todayLines={todayReckoning.lines}
              categories={categories}
              categoryXp={areas.byCategory}
              disciplineXp={areas.byDiscipline}
              stats={dayStats}
              recentDates={recentDates}
            />
          </>
        )}

        {nav === 'months' && (
          <>
            <div className="titlebar-drag" />
            <MonthsView
              months={monthRecords}
              currentMonth={currentMonthKey()}
              categories={categories}
              marks={dayMarks}
              markDefs={markDefs}
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
              markDefs={markDefs}
              marks={dayMarks}
              onChangeMarkDefs={handleChangeMarkDefs}
            />
          </>
        )}
      </main>

      <EditBlockModal
        target={editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onSave={(day, id, patch, moveTo) => {
          if (moveTo) handleMoveBlock(day, id, moveTo, patch);
          else handleChangeBlock(day, id, patch);
          setEditing(null);
        }}
        onDelete={handleDeleteBlock}
      />

      <DayMarkImport
        open={marksOpen}
        defs={markDefs}
        marks={dayMarks}
        initialMonth={monthCursor.slice(0, 7)}
        onClose={() => setMarksOpen(false)}
        onApply={handleApplyMarks}
        onChangeDefs={handleChangeMarkDefs}
        onNotify={setToast}
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

      {/* The reward layer. Three sizes, deliberately unequal — see XpToast. */}
      <XpFloat award={xpFloat} />
      <RunKeptToast
        run={runKept?.run ?? null}
        seed={runKept?.seed ?? 0}
        onDone={() => setRunKept(null)}
      />
      <RunTakeover days={runTakeover} onDismiss={() => setRunTakeover(null)} />
      <QuestDoneToast queue={questQueue} onDone={() => setQuestQueue((q) => q.slice(1))} />
      <CodexUnlockToast queue={codexQueue} onDone={() => setCodexQueue((q) => q.slice(1))} />
      <BadgeUnlockToast
        queue={badgeQueue}
        onDone={() => setBadgeQueue((q) => q.slice(1))}
      />
      <LevelToast
        standing={levelQueue[0] ?? null}
        pending={Math.max(0, levelQueue.length - 1)}
        onDone={() => setLevelQueue((q) => q.slice(1))}
      />
      <LevelTakeover
        standing={takeover?.standing ?? null}
        current={standing}
        prestige={takeover?.prestige ?? false}
        nextRank={standing.level < LEVELS_PER_CYCLE ? RANKS[standing.level] : null}
        onDismiss={() => setTakeover(null)}
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

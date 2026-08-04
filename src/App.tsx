import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
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
import { snapshotIfDue } from './snapshot';
import { momentOf, useRewardQueue, type RewardMoment } from './rewards';
import {
  initStore,
  progressionStore,
  type ProgressionStore,
} from './progression/reducer';
import { chainPayout, chainStatuses } from './chains';
import { assay, assayKey } from './assay';
import { characterOf, sealCharacter } from './characters';
import {
  currentSeason,
  resolveElapsedSeasons,
  seasonName,
  seasonProgress,
  type SeasonRecord,
} from './seasons';
import YearPage from './components/YearPage';
import BootSequence from './components/pixel/BootSequence';
import {
  commissionFor,
  payoutFor,
  placeCommission,
  pruneCommissions,
  refusalMessage,
  settleCommissions,
  type Commission,
} from './commissions';
import type {
  Block,
  CarryoverItem,
  CategoryDef,
  DayMarkDef,
  DayMarks,
  DayPlan,
  HabitStore,
  RecurringTask,
  Settings,
  AwardPayout,
  DisciplineId,
  Task,
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
  saveCommissions,
  loadCommissions,
  loadAllSeasons,
  saveSeason,
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
import { buildSchedule, rulesFor, type CategoryRules } from './scheduler';
import StandingView from './components/StandingView';
import { BadgeUnlockToast } from './components/BadgeShelf';
import { QuestDoneToast } from './components/QuestBoard';
import { CodexUnlockToast } from './components/CodexPanel';
import {
  boostFor,
  equip as equipItem,
  hasExtraWildcard,
  offersFor,
  setActive,
  spendBoost,
  spendRefill,
  unequip as unequipSlot,
} from './shop';
import {
  buildInsightContext,
  insightById,
  insightIdFromKey,
  strongestWindows,
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
  sealDraws,
  profileFacts,
  weeklyChallenge,
} from './quests';
import {
  planAheadDue,
  reviewAwardsDue,
} from './bonuses';
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
  comboRuns,
  reckonDay,
  xpForBlock,
  weekdayMedians,
  type DayModifiers,
  isScored,
  NO_MODIFIERS,
  standingFor,
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
  displayRun,
  routineAwardsDue,
  todayQualifies,
  STREAK_THRESHOLD,
} from './streaks';
import {
  isSfxEnabled,
  setSfxEnabled,
  sfxComplete,
  sfxCombo,
  sfxDayCleared,
  sfxLevel,
  sfxMilestone,
  sfxSpend,
  sfxPrestige,
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
import { clearToIntake, hasClearableBlocks } from './unschedule';
import {
  buildWeekReview,
  dropFromCarryover,
  isSealed,
  issueRecurringGoals,
  goalRunPayouts,
  openGoals as openGoalsOf,
  outcomeHistory,
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
import {
  addDays,
  daysBetween,
  formatDuration,
  minutesTo24h,
  parse24h,
  toDateKey,
} from './utils/time';
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
  const dayDiff = daysBetween(dayKey, todayKey);
  // Ticking a *future* day's block clamps to its own end-of-day rather than going
  // negative, which would read as absurdly early.
  return dayDiff > 0 ? dayDiff * 1440 + wallMinutes : wallMinutes;
}

/**
 * Turn a refusal reason into words.
 *
 * Module scope, because it is pure and needs nothing from the component. The reducer knows
 * the shop refused and which rule refused it; turning that into a sentence is presentation,
 * so the two stay on opposite sides of the dispatch.
 */
function shopRefusal(reason: string): string {
  switch (reason) {
    case 'brass':
      return 'Not enough brass for that yet.';
    case 'level':
      return 'That needs a higher level.';
    case 'rotation':
      return 'Out of stock this week.';
    case 'owned':
      return 'You already own that.';
    case 'cap':
    case 'stack':
      return 'You already hold as many as you can.';
    default:
      return 'That cannot be bought right now.';
  }
}

const AXIS_W = 62; // must match TimeGrid's gutter so the week strip lines up
/**
 * How far back the codex and the insight-driven scheduler look.
 *
 * Module scope rather than component body: two separate places load this window, one of
 * them from a callback declared before the other, and a component-level const cannot be
 * referenced by both.
 */
const INSIGHT_WINDOW_DAYS = 90;
const SAVE_DEBOUNCE = 250;

export default function App() {
  // State rather than a value recomputed each render, and the difference is the whole
  // point: recomputing gives the right answer only when something else happens to cause
  // a render. TimeGrid ticks its own clock every minute, so at midnight it moved to the
  // new day while everything hung off this one stayed on the old — the panel and the
  // grid disagreeing about what "today" was until an unrelated edit shook it loose.
  const [todayKey, setTodayKey] = useState(() => toDateKey(new Date()));

  const [nav, setNav] = useState<NavKey>('calendar');
  const [view, setView] = useState<ViewMode>('day');
  const [date, setDate] = useState(todayKey);
  const [monthCursor, setMonthCursor] = useState(todayKey);
  const [goalsWeek, setGoalsWeek] = useState(() => currentWeekKey());
  /**
   * The week containing today, and which week that was last time it changed.
   *
   * Derived from `todayKey` rather than read from the clock, so it advances with the
   * midnight tick instead of only when something else happens to re-render.
   */
  const thisWeek = useMemo(() => toWeekKey(todayKey), [todayKey]);
  const lastCurrentWeek = useRef(thisWeek);

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
  /**
   * XP, brass, the ledger, the run, the shop and the day stats — one store.
   *
   * These were five `useState` atoms written by a dozen effects, each reading the others
   * through a latest-value ref because an effect cannot depend on what it writes. That
   * arrangement cost three subtle bugs: the ledger lost update, the payout over-pay and the
   * brass re-mint. All three are now unexpressible rather than merely fixed — see the note
   * at the head of `progression/reducer.ts`.
   *
   * The store returns an IDENTICAL object when a dispatch changes nothing, which is what
   * lets the effects below depend on the state they also write to and still settle after
   * one pass. That is the property that made the refs deletable.
   */
  const [store, dispatch] = useReducer(
    progressionStore,
    undefined,
    (): ProgressionStore =>
      initStore({
        progress: loadProgress(),
        dayStats: loadDayStats(),
        streak: loadStreak(),
        awards: loadAwards(),
        shop: loadShop(),
      })
  );
  const { progress, dayStats, streak, awards, shop } = store.state;


  const [commissions, setCommissions] = useState<Commission[]>(loadCommissions);
  const [seasons, setSeasons] = useState<Record<string, SeasonRecord>>(loadAllSeasons);
  const [yearPageOpen, setYearPageOpen] = useState(false);
  /**
   * Bumped whenever a week record is written.
   *
   * The modifiers memo reads sealed characters out of storage, and storage is not reactive.
   * Without this, sealing a character on Monday would not reach the scoring path until some
   * unrelated render happened to rebuild the memo.
   */
  const [weekEpoch, setWeekEpoch] = useState(0);

  /**
   * The only latest-value mirror left.
   *
   * There were six. Five held progression state that a dozen effects read while also
   * writing — the arrangement that cost the ledger lost update, and the reason granting once
   * needed a ref advanced mid-flush. The store replaced them: it returns an identical object
   * when a dispatch changes nothing, so an effect can depend on the state it dispatches
   * against and still settle after one pass.
   *
   * `plans` is not progression state and is written by a debounced save path, so it keeps
   * its mirror. Synced after commit rather than during render, which is what the
   * `react-hooks/refs` rule is about and it is right to be: a ref written during a render
   * React discards would describe a render that never committed.
   */
  const plansRef = useRef(plans);

  useEffect(() => {
    plansRef.current = plans;
  });

  /**
   * The rules a build runs under, including what the history says when the setting is on.
   *
   * Loaded here rather than memoised, and on purpose. The codex's ninety-day window is
   * otherwise only in memory while Standing is open, so a memo would have made the
   * preference silently inert on the calendar — where the build button actually lives.
   * Reading it costs about four milliseconds against three years of stored plans
   * (measured in perf.test.ts), which is nothing once per press of a button, and it means
   * the setting does what it says wherever you are.
   */
  const schedulerRulesNow = useCallback((): CategoryRules => {
    const base = rulesFor(categories);
    if (!settings.useInsightScheduling) return base;
    if (!progress.startedOn) return base;

    const dates = Array.from({ length: INSIGHT_WINDOW_DAYS }, (_, i) =>
      addDays(todayKey, i - (INSIGHT_WINDOW_DAYS - 1))
    );
    const stored = new Set(listPlanDates());
    const wanted = dates.filter(
      (d) => stored.has(d) && isScored(d, progress.startedOn)
    );
    const windows = strongestWindows(
      buildInsightContext(loadPlans(wanted), wanted, dayStats, categories)
    );
    return { ...base, preferredWindow: (id: string) => windows[id] ?? null };
  }, [dayStats, progress.startedOn, categories, settings.useInsightScheduling, todayKey]);

  /**
   * Cross midnight without being touched.
   *
   * Every lazy rollover in here — the week record, the month record, the streak walk —
   * is correct whenever it runs, but it only runs when something renders. Left to
   * itself the app would sit on yesterday's date until the first click of the morning,
   * so a run resolved at 09:00 rather than at 00:00 and the day view opened on the
   * wrong day.
   *
   * The timer aims a couple of seconds PAST midnight, because a `setTimeout` that fires
   * a few milliseconds early would read the date as yesterday and then not fire again
   * for 24 hours. It reschedules from the real clock each time rather than adding 24
   * hours, which is what keeps it right across a DST change — one local day is not
   * always 1440 minutes long.
   *
   * The wake listener covers what the timer cannot: macOS suspends timers while the
   * machine sleeps, so a laptop closed at midnight fires the timeout late. Recomputing
   * on wake means late is harmless, since the date is always read from the clock rather
   * than counted forward.
   */
  useEffect(() => {
    let timer: number | undefined;

    const sync = () => setTodayKey((prev) => {
      const now = toDateKey(new Date());
      return now === prev ? prev : now;
    });

    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1,
        0,
        0,
        2
      );
      timer = window.setTimeout(() => {
        sync();
        schedule();
      }, Math.max(1000, nextMidnight.getTime() - now.getTime()));
    };

    schedule();
    // Gated on becoming visible. `visibilitychange` fires on hide as well as show, so
    // tabbing away used to resample and rebuild the timeout for no reason — harmless, but
    // it doubled the work and made the timer's lifecycle harder to reason about.
    const onWake = () => {
      if (document.visibilityState !== 'visible') return;
      sync();
      if (timer != null) window.clearTimeout(timer);
      schedule();
    };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    return () => {
      if (timer != null) window.clearTimeout(timer);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
    };
  }, []);

  /**
   * A daily copy of everything, in a file the app owns.
   *
   * Deliberately idle rather than immediate. A snapshot serialises the whole profile,
   * and doing that during launch would compete with the first paint for no reason — the
   * thing being protected against is losing the store, which a few seconds does not
   * change. Keyed on `todayKey`, so a session left open for a week still takes one a day.
   *
   * Nothing here can fail loudly. `snapshotIfDue` returns its outcome rather than
   * throwing, and a failure is recorded for the backup panel to show rather than
   * surfaced as a toast — a backup that interrupts you to report itself is worse than
   * one that quietly writes.
   */
  useEffect(() => {
    const idle = window.setTimeout(() => {
      void snapshotIfDue(todayKey);
    }, 4000);
    return () => window.clearTimeout(idle);
  }, [todayKey]);

  const [overflow, setOverflow] = useState<Task[]>([]);
  const [overflowReasons, setOverflowReasons] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<EditTarget | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [hoursOpen, setHoursOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [marksOpen, setMarksOpen] = useState(false);

  /**
   * A counter per modal, bumped each time one is OPENED.
   *
   * Used as a `key`, which makes opening a modal remount it — so its fields start from the
   * current props instead of being reset by an effect afterwards. That is what
   * `react-hooks/set-state-in-effect` was pointing at in all three of these, and the rule
   * was right: resetting state in an effect means the stale values render for one frame
   * first.
   *
   * Bumped on open rather than derived from the open flag, deliberately. Keying on the flag
   * itself would remount on CLOSE too, and each of these animates its own exit — a
   * component that remounts as it closes has nothing left to animate out.
   */
  const [modalEpoch, setModalEpoch] = useState(0);
  const bumpModal = useCallback(() => setModalEpoch((n) => n + 1), []);

  /**
   * Does anything own the screen?
   *
   * The gate on every bare-key shortcut. A global keydown handler that fires while a modal
   * is up is the classic way to make "n" create a block behind a dialog you were reading.
   */
  const anyModalOpen = hoursOpen || backupOpen || marksOpen || editing != null;
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
  const rewards = useRewardQueue();
  // Destructured because the queue object's identity changes as moments play, while these
  // two are stable for the component's life — so effects can depend on them honestly
  // instead of suppressing the dependency warning.
  const { push: pushReward, clear: clearRewards } = rewards;

  /**
   * Hand what the reducer produced to the parts of the app that are not pure.
   *
   * The reducer cannot play a sound or raise a toast, so it records what happened and this
   * drains it. Acknowledging with `Drained` is what stops the effect re-running — and
   * because the store returns an identical object when nothing changed, one pass settles.
   */
  useEffect(() => {
    if (
      store.outbox.length === 0 &&
      store.notes.length === 0 &&
      store.notice == null &&
      !store.purchased
    ) {
      return;
    }
    if (store.purchased) sfxSpend();

    for (const moment of store.outbox) {
      if (moment.kind === 'takeover') {
        if (moment.prestige) sfxPrestige();
        else sfxMilestone();
      } else if (moment.kind === 'runTakeover' || moment.kind === 'quest' || moment.kind === 'codex') {
        sfxMilestone();
      } else if (moment.kind === 'level' || moment.kind === 'badge') {
        sfxLevel();
      }
    }
    pushReward(...store.outbox);

    // Narration first, refusals second: a refusal is a response to something you just did,
    // so it should be the line left on screen.
    const line = store.notice ? shopRefusal(store.notice) : store.notes[0];
    if (line) setToast(line);

    dispatch({ type: 'Drained' });
  }, [store.outbox, store.notes, store.notice, store.purchased, pushReward]);
  const [sfxOn, setSfxOn] = useState(false);

  const rules = useMemo(() => rulesFor(categories), [categories]);

  const weekKey = useMemo(() => toWeekKey(date), [date]);

  /**
   * The character of the week you are actually in, for the rail and the Standing card.
   *
   * Read off the CURRENT week rather than the displayed one: scrolling back to March should
   * not change what the rail says this week is like. Days are scored against their own
   * week's character in `modifiers`; this is only the label.
   */
  const thisWeeksCharacter = useMemo(
    () => characterOf(loadWeek(currentWeekKey())),
    // `weekEpoch` is the whole point here: this reads sealed week records out of storage,
    // which is not reactive, so without it a character sealed on Monday would never reach
    // the value. eslint cannot see through `loadWeek`, so it calls the dep unnecessary.
    // These read records out of storage, which is not reactive, so the deps eslint calls
    // unnecessary are the only thing that invalidates them. It cannot see through the
    // `load*` calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekEpoch, todayKey]
  );

  /**
   * The trailing baseline behind each weekday in the week strip.
   *
   * Derived from stored day stats, which are already in memory — no new record and no new
   * mechanic, which is why this is the cheapest thing in the app that answers a question
   * the progression layer otherwise cannot.
   */
  const weekMedians = useMemo(
    () => weekdayMedians(dayStats, weekDates(weekKey)),
    [dayStats, weekKey]
  );

  // Rewards clear themselves. Keyed on the award so a second completion inside the
  // window restarts the clock rather than inheriting the first one's remaining time.
  useEffect(() => {
    if (!xpFloat) return;
    const id = setTimeout(() => setXpFloat(null), 1000);
    return () => clearTimeout(id);
  }, [xpFloat]);


  // A takeover is dismissed by clicking, but any key should also clear it — it covers the
  // screen, so every plausible "get out of my way" gesture has to work. Full-screen moments
  // carry no timer, so this is the only thing that advances the queue past one.
  const takeover = momentOf(rewards.current, 'takeover');
  const runTakeover = momentOf(rewards.current, 'runTakeover');
  useEffect(() => {
    if (!takeover && !runTakeover) return;
    const onKey = () => rewards.dismiss();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [takeover, runTakeover, rewards]);

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
  useEffect(() => saveCommissions(commissions), [commissions]);
  useEffect(() => saveWeek(week), [week]);

  // -------------------------------------------------------------------------
  // Undo
  //
  // The gap this closes: one drag can reflow six blocks, and `describeReflow` only ever
  // narrated it — "Moved 4 entries to make room" with no way back. For a calendar whose
  // core gesture cascades, that is the most consequential thing missing.
  //
  // A TRANSACTION IS A GESTURE, not a mutation. Moving a block between days calls
  // `mutateDay` twice, and two undo entries for one drag would mean pressing the shortcut
  // twice to reverse one action. So writes are collected into a pending transaction and
  // banked at the end of the microtask, which is exactly one synchronous gesture.
  //
  // THE FIRST SNAPSHOT OF A DAY WINS. If a gesture touches the same day twice, the
  // earliest capture is the true "before"; a later one would already contain half the
  // change being undone.
  //
  // `null` records a day that did not exist, so undoing its creation removes it rather
  // than leaving an empty plan behind.
  // -------------------------------------------------------------------------
  const UNDO_DEPTH = 25;
  type UndoTx = { label: string; days: Record<string, DayPlan | null> };
  const undoStack = useRef<UndoTx[]>([]);
  const pendingTx = useRef<UndoTx | null>(null);
  const [undoCount, setUndoCount] = useState(0);

  const recordUndo = useCallback((day: string, label: string) => {
    if (pendingTx.current == null) {
      pendingTx.current = { label, days: {} };
      queueMicrotask(() => {
        const tx = pendingTx.current;
        pendingTx.current = null;
        if (!tx || Object.keys(tx.days).length === 0) return;
        undoStack.current = [...undoStack.current, tx].slice(-UNDO_DEPTH);
        setUndoCount(undoStack.current.length);
      });
    }
    const tx = pendingTx.current;
    if (!(day in tx.days)) tx.days[day] = plansRef.current[day] ?? null;
  }, []);

  const mutateDay = useCallback(
    (day: string, fn: (plan: DayPlan) => DayPlan, label = 'that change') => {
      recordUndo(day, label);
      setPlans((prev) => {
        const current = prev[day] ?? { date: day, tasks: [], blocks: [] };
        dirty.current.add(day);
        return { ...prev, [day]: fn(current) };
      });
    },
    [recordUndo]
  );

  const undo = useCallback(() => {
    const tx = undoStack.current[undoStack.current.length - 1];
    if (!tx) {
      setToast('Nothing to undo.');
      return;
    }
    undoStack.current = undoStack.current.slice(0, -1);
    setUndoCount(undoStack.current.length);

    setPlans((prev) => {
      const next = { ...prev };
      for (const [day, before] of Object.entries(tx.days)) {
        dirty.current.add(day);
        if (before == null) next[day] = { date: day, tasks: [], blocks: [] };
        else next[day] = before;
      }
      return next;
    });
    setToast(`Undid ${tx.label}.`);
  }, []);

  // -------------------------------------------------------------------------
  // Lazy week rollover
  //
  // Runs on mount and again whenever the date changes under it. Nothing depends on the
  // app having been open at midnight on Sunday: elapsed weeks are resolved on
  // read, in order, and the `resolved` flag makes it idempotent.
  //
  // Keyed on `todayKey` rather than mounting once, which is what stops a session left
  // open over a weekend from sealing Sunday's week on Tuesday morning. Safe to re-run
  // precisely because every step here is already idempotent — the `resolved` flag for
  // weeks, the (goalId, weekKey) pair for issued goals, the presence of a record for
  // months. Re-running on a day that has already rolled over changes nothing.
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
    if (issued) {
      saveWeek(issued);
      // A run that just reached its target pays once, keyed on the target so a longer run
      // later still pays. Offered rather than granted here: the ledger decides.
      const runs = goalRunPayouts(issued.goals, awards.granted);
      if (runs.length > 0) dispatch({ type: 'AwardsOffered', payouts: runs, note: true });
    }

    // 2b) Seal this week's character, once. Written here rather than derived at scoring
    //     time because the draw is an index into a content array: extend that array and an
    //     unsealed week resolves differently, re-scoring every day in it. Sealing is what
    //     makes the pool safe to grow.
    // 2b) Seal this week's character and its draws, once. Written here rather than derived
    //     at scoring time because both are indexes into content arrays: extend one and an
    //     unsealed week resolves differently, re-scoring its days or re-drawing its
    //     challenges. Sealing is what makes those pools safe to grow.
    const record = loadWeek(current);
    const withCharacter = sealCharacter(record) ?? record;
    const withDraws = sealDraws(withCharacter) ?? withCharacter;
    if (withDraws !== record) {
      saveWeek(withDraws);
      setWeekEpoch((n) => n + 1);
    }

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

    if (result.changed || issued) {
      setWeek(loadWeek(weekKey));
      // Anything derived by reading week records out of storage has to be told they
      // moved. The history panel is the case that made this necessary: it is a memo
      // over `loadAllWeeks()`, so it runs during the first render — before this effect
      // has sealed anything — and on a launch after a week away the week that just
      // ended would have been missing from the record until the next relaunch.
      setWeekEpoch((n) => n + 1);
    }
  }, [awards.granted, weekKey, todayKey]);

  // Swap the loaded week record when the displayed week changes.
  useEffect(() => {
    setWeek((prev) => (prev.week === weekKey ? prev : loadWeek(weekKey)));
  }, [weekKey]);

  /**
   * Carry the goals view across Monday morning.
   *
   * The rollover above is already correct at the storage level, but it writes the NEW
   * week while this cursor still points at the old one — so a session left open over
   * the weekend went on showing Sunday's goals, at Sunday's progress, with the reissued
   * week sitting unseen in storage. The reset had happened; it just wasn't on screen,
   * which from the outside is indistinguishable from it not happening at all.
   *
   * Follow only if we were following. Someone who has deliberately paged back to review
   * a past week must not be yanked into the present because midnight passed while they
   * were reading — so the cursor advances only when it was sitting on the week that has
   * just ended. `lastCurrentWeek` is what makes that distinction possible: it records
   * which week was current the last time this ran, and the cursor moves only if it still
   * matches that.
   *
   * Ordered after the rollover effect deliberately. Effects run in declaration order, so
   * by the time this advances the cursor the new week has already been written and
   * sealed, and the read below finds a record rather than creating an empty one.
   */
  useEffect(() => {
    const previous = lastCurrentWeek.current;
    if (previous === thisWeek) return;
    lastCurrentWeek.current = thisWeek;
    setGoalsWeek((cursor) => (cursor === previous ? thisWeek : cursor));
  }, [thisWeek]);

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

  /**
   * Per-day scoring modifiers, built once and shared by every path that scores a day.
   *
   * A booster is per DAY and a character is per WEEK, so this resolves each date's week and
   * reads the sealed id off its record. Week records are loaded rather than taken from
   * `week`, which only ever holds the one on screen — the reconcile window spans up to nine
   * weeks, and a day scored against the wrong week's character would be worse than one
   * scored against none.
   */
  const modifiers = useMemo<Record<string, DayModifiers>>(() => {
    const byWeek = new Map<string, WeekRecord>();
    for (const w of loadAllWeeks()) byWeek.set(w.week, w);
    return Object.fromEntries(
      authoritativeDates.map((d) => [
        d,
        {
          boost: boostFor(shop, d),
          character: characterOf(byWeek.get(toWeekKey(d))),
        },
      ])
    );
    // `weekEpoch` is the whole point here: this reads sealed week records out of storage,
    // which is not reactive, so without it a character sealed on Monday would never reach
    // the value. eslint cannot see through `loadWeek`, so it calls the dep unnecessary.
    // These read records out of storage, which is not reactive, so the deps eslint calls
    // unnecessary are the only thing that invalidates them. It cannot see through the
    // `load*` calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authoritativeDates, shop, weekEpoch]);

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
  }, [todayKey, plans, authoritativeDates, habits.completions]);

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
    dispatch({ type: 'Started', today: todayKey });
     
  }, [progress.startedOn, todayKey]);

  /**
   * Reconcile every day currently in memory.
   *
   * Keyed on a cheap signature of the loaded days rather than on `plans` itself, so
   * an unrelated re-render does not re-walk 42 days. `progressRef` keeps the effect
   * off the progress object, which it writes to — depending on what you set is how
   * you get a render loop.
   */

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
    if (!progress.startedOn) return;
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
      .filter((d) => plans[d] != null)
      .map((d) => ({ date: d, blocks: plans[d]!.blocks }));
    if (days.length === 0) return;

    // The eligibility rules — scored era, retention window — live in the reducer now, so
    // there is one place they can be got wrong rather than one per caller.
    dispatch({
      type: 'DaysReconciled',
      days,
      categories,
      modifiers,
      today: todayKey,
    });
    // `plans` and everything derived from it are deliberately absent. `dayFingerprint` is a
    // cheap signature of exactly the days that matter, and it exists so an unrelated
    // re-render does not re-walk 42 days — depending on `plans` here would undo that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayFingerprint, categories, shop, todayKey]);

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

  /**
   * Offer one-off awards to the ledger.
   *
   * Three lines rather than the twenty this used to take, because the hard part moved into
   * the reducer. Several producers can offer in the same commit — one completion can
   * finish a quest, unlock a badge and keep the run at once — and each dispatch is applied
   * to the state the last one produced, in order. The mutable ref that used to make that
   * work mid-flush is gone, along with the class of bug it existed to paper over.
   *
   * `moments` is keyed by award key, so a celebration cannot outrun the payment it is for.
   */
  const offerAwards = useCallback(
    (
      payouts: AwardPayout[],
      moments?: Record<string, RewardMoment>,
      disciplines?: Partial<Record<DisciplineId, number>>
    ) => {
      if (payouts.length === 0) return;
      dispatch({ type: 'AwardsOffered', payouts, moments, disciplines });
    },
    []
  );

  useEffect(() => {
    // The walk, the awards, the brass and the narration all happen in the reducer now. It
    // is lazy and idempotent in the same way as the weekly and monthly rollovers: the app
    // may have been shut for a fortnight, so every elapsed day is walked once and
    // `resolvedThrough` is what stops it being walked twice.
    dispatch({ type: 'MidnightPassed', today: todayKey, marks: dayMarks });
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
    const due = routineAwardsDue(awards, runs);
    if (due.length === 0) return;
    // The producer knows how long the run is; only this caller knows what the routine is
    // called. Enriching the label here means the narration the reducer builds still names
    // the thing, without `streaks.ts` needing to know about habit templates.
    offerAwards(
      due.map((a) => {
        const [, templateId] = a.key.split(':');
        const name = habits.templates.find((t) => t.id === templateId)?.label ?? 'A routine';
        return { ...a, label: `${name} — ${a.label ?? 'a milestone'}` };
      }),
      undefined,
      undefined
    );
  }, [offerAwards, habits, todayKey, awards]);

  /**
   * Pay a habit bonus, once.
   *
   * Everything routes through the ledger, so an effect that re-runs on every render
   * cannot pay twice — the same guarantee the badges and streak milestones rely on.
   */
  const payBonus = useCallback(
    (due: AwardPayout[]) => {
      // Both review bonuses are raised by the same act, so one being already held is an
      // ordinary state. XP, disciplines and the narration all come from what was paid.
      if (due.length === 0) return;
      dispatch({ type: 'AwardsOffered', payouts: due, note: true });
    },
    []
  );

  /**
   * Tomorrow planned while it is still today.
   *
   * Watched rather than hooked to the build button, because a day can be planned by
   * building it, by dragging a block into it, or by adding one directly — and the
   * bonus is for the outcome, not for one particular route to it.
   */
  useEffect(() => {
    if (!progress.startedOn) return;
    payBonus(planAheadDue(awards, plansRef.current, todayKey));
     
  }, [awards, progress.startedOn, dayFingerprint, todayKey, payBonus]);

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
    if (!progress.startedOn) return;
    const context = badgeContext({
      progress,
      streak,
      stats: dayStats,
      marks: dayMarks,
      todayBlocks: plansRef.current[todayKey]?.blocks ?? [],
      categories,
      today: todayKey,
      epoch: progress.startedOn,
      // Read off the streak record rather than a ref, so it survives a reload.
      comebackToday: streak.comebackOn === todayKey,
    });
    const due = evaluateBadges(awards, context);
    if (due.length === 0) return;

    // Moments keyed by award key, so a badge card cannot appear for a badge the ledger
    // refused. Built by loop rather than filtered: `badgeById` returns the rule, which
    // carries a `test` function, and a type predicate narrowing to the plain def would be
    // widening rather than narrowing.
    const moments: Record<string, RewardMoment> = {};
    for (const p of due) {
      const def = badgeById(badgeIdFromKey(p.key));
      if (def) moments[p.key] = { kind: 'badge', def };
    }
    offerAwards(due, moments);
  }, [offerAwards, dayStats, streak, dayMarks, todayKey, categories, progress, awards]);

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
    pushReward({ kind: 'runKept', run: streak.current + 1, seed: Date.now() });
    sfxDayCleared();
     
  }, [streak, pushReward, dayStats, dayMarks, todayKey]);

  // -------------------------------------------------------------------------
  // Derived values
  // -------------------------------------------------------------------------
  // Memoised on the two things it depends on. As a bare `??` it allocated a fresh empty
  // plan on every render for any day with no record, so every memo downstream of it
  // recomputed every time — including the ones over the whole loaded window.
  const dayPlan = useMemo(
    () => plans[date] ?? { date, tasks: [], blocks: [] },
    [plans, date]
  );

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
    // These read records out of storage, which is not reactive, so the deps eslint calls
    // unnecessary are the only thing that invalidates them. It cannot see through the
    // `load*` calls.
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
    // These read records out of storage, which is not reactive, so the deps eslint calls
    // unnecessary are the only thing that invalidates them. It cannot see through the
    // `load*` calls.
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

  /**
   * The record of finished weeks — what survives the Monday reset.
   *
   * `weekEpoch` and `thisWeek` are the deps that matter: the first fires when a week is
   * sealed mid-session, the second when the boundary passes, and between them the
   * history picks up the week that has just ended without needing a relaunch.
   */
  const goalHistory = useMemo(
    () => outcomeHistory(loadAllWeeks()),
    // Reads week records out of storage, which is not reactive, so the deps eslint calls
    // unnecessary are the only thing that invalidates this. It cannot see through
    // `loadAllWeeks`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekEpoch, thisWeek]
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
    if (!progress.startedOn) return;
    const seenKey = `${goalsWeek}`;
    if (reviewSeen.current === seenKey) return;
    reviewSeen.current = seenKey;
    payBonus(reviewAwardsDue(awards, goalsWeek, currentWeekKey(), review));

    // The assay: paid once per finished week, on the act of looking. Brass only, so it
    // cannot move a level, and measured against this profile's own recent weeks rather
    // than an absolute bar.
    if (goalsWeek < currentWeekKey()) {
      const appraisal = assay(dayStats, goalsWeek);
      dispatch({
        type: 'AwardsOffered',
        payouts: [{ key: assayKey(goalsWeek), xp: 0, label: appraisal.note }],
        brassOverride: appraisal.brass,
        note: true,
      });
    }
     
  }, [dayStats, awards, progress.startedOn, nav, goalsWeek, review, payBonus]);

  /**
   * Per-day boost multipliers for everything currently loaded.
   *
   * Built once and shared by every path that scores a day, because a booster that only
   * some of them know about is worse than no booster: the meter, the area breakdown and
   * the toast would each report a different number for the same work.
   */


  /** Area XP across everything currently loaded. */
  const areas = useMemo(() => {
    const t = areaTotals(
      authoritativeDates.map((d) => ({ date: d, blocks: plans[d]?.blocks ?? [] })),
      categories,
      modifiers
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
  }, [authoritativeDates, plans, categories, modifiers, streak.consistencyXp, progress.disciplines]);

  const todayReckoning = useMemo(
    () => reckonDay(todayKey, plans[todayKey]?.blocks ?? [], categories, modifiers[todayKey] ?? NO_MODIFIERS),
    [modifiers, plans, todayKey, categories]
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
  /**
   * A wide trailing window for the codex, in two parts.
   *
   * Loaded from storage rather than taken from `plans`, which only ever holds what the
   * calendar is showing — a requirement of "twenty timed completions" that moved whenever
   * you changed view would be unusable. Only loaded while Standing is open, because it is
   * ninety reads.
   *
   * SPLIT deliberately. This was one memo, and its dependency list included `dayStats` —
   * which the streak, routine and bonus effects all write. So completing a block while
   * Standing was open re-ran the whole thing: a full key enumeration plus ninety
   * `getItem` and `JSON.parse` pairs, to answer a question only the aggregation needed.
   * The load now keys on the window alone, and the aggregation over it is cheap.
   */
  const insightWindow = useMemo(() => {
    if (nav !== 'standing') return { plans: {}, dates: [] as string[] };
    const dates = Array.from({ length: INSIGHT_WINDOW_DAYS }, (_, i) =>
      addDays(todayKey, i - (INSIGHT_WINDOW_DAYS - 1))
    );
    const stored = new Set(listPlanDates());
    // Only the scored era. An insight drawn from days before you started would pay XP
    // for history the rest of the system deliberately ignores.
    const wanted = dates.filter((d) => stored.has(d) && isScored(d, progress.startedOn));
    return { plans: loadPlans(wanted), dates: wanted };
  }, [nav, todayKey, progress.startedOn]);

  /**
   * Profile-wide facts for the discovery quests.
   *
   * Derived from the codex window, which is only loaded while Standing is open — so on the
   * calendar these are null and the four discovery specs report no progress. That is the
   * honest failure mode rather than a bug: a discovery quest firing on no data is worse
   * than one that cannot be finished, and opening Standing is exactly the moment the app
   * has the history to answer.
   */
  const questProfile = useMemo(
    () => profileFacts(insightWindow.dates.map((d) => ({ date: d, blocks: insightWindow.plans[d]?.blocks ?? [] })), categories),
    [insightWindow, categories]
  );

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
        // The discovery content asks questions a week cannot answer, so the profile-wide
        // facts come from the same wide window the codex uses. Null fields mean those
        // specs report no progress rather than resolving to hour zero.
        profile: questProfile,
        streakResetOn: streak.lastResetOn,
      }),
    [
      weekKey,
      plans,
      dayStats,
      week,
      habits,
      dayMarks,
      markDefs,
      categories,
      progress.startedOn,
      questProfile,
      streak.lastResetOn,
    ]
  );

  const quests = useMemo(
    () => questsFor(questContext, { extraWildcard: hasExtraWildcard(shop) }),
    [questContext, shop]
  );
  const daily = useMemo(() => dailyChallenge(questContext, todayKey), [questContext, todayKey]);
  const weekly = useMemo(() => weeklyChallenge(questContext), [questContext]);


  const insightContext = useMemo(
    () =>
      buildInsightContext(insightWindow.plans, insightWindow.dates, dayStats, categories),
    [insightWindow, dayStats, categories]
  );


  const codex = useMemo(
    () => insightStatuses(awards, insightContext),
    [awards, insightContext]
  );

  const standing = useMemo(() => standingFor(progress.totalXp), [progress.totalXp]);

  /**
   * Seal every season that has finished.
   *
   * Same lazy, idempotent shape as the week and month rollovers, and keyed on `todayKey` so
   * a session left open across a quarter boundary still seals on time. A seal is a reading,
   * not a reset: it writes down what was true and touches nothing else, because a planner
   * that confiscates progress at a date boundary has misunderstood what the progress was
   * for.
   */
  useEffect(() => {
    if (!progress.startedOn) return;
    const result = resolveElapsedSeasons(
      todayKey,
      seasons,
      {
        stats: dayStats,
        marks: dayMarks,
        totalXp: progress.totalXp,
        threshold: STREAK_THRESHOLD,
      },
      progress.startedOn
    );
    if (!result.changed) return;
    for (const record of result.sealed) saveSeason(record);
    setSeasons(loadAllSeasons());
    const last = result.sealed[result.sealed.length - 1];
    setToast(`${seasonName(last.season)} is sealed. ${last.daysKept} days kept.`);
     
  }, [dayStats, progress.startedOn, progress.totalXp, todayKey, seasons, dayMarks]);

  /** The season in progress, reckoned live so it reads beside the sealed ones. */
  const liveSeason = useMemo(
    () =>
      currentSeason(todayKey, seasons, {
        stats: dayStats,
        marks: dayMarks,
        totalXp: progress.totalXp,
        threshold: STREAK_THRESHOLD,
      }),
    [todayKey, seasons, dayStats, dayMarks, progress.totalXp]
  );

  /**
   * Settle commissions whose day has passed.
   *
   * Same lazy, idempotent shape as the streak walk: `outcome` moving off `open` is the
   * guard, so this is safe on every pass and correct after the app has been shut for a
   * fortnight. Today is never settled — the day is still in play, and forfeiting at
   * breakfast would take a stake for work the afternoon was going to do.
   *
   * Reads plans from storage rather than from `plans`, because a commission's day may not be
   * anywhere near the calendar view when it comes due.
   */
  useEffect(() => {
    const open = commissions.filter((c) => c.outcome === 'open' && c.date < todayKey);
    if (open.length === 0) return;

    const wanted = [...new Set(open.map((c) => c.date))];
    const result = settleCommissions(commissions, loadPlans(wanted), todayKey);
    if (!result.changed) return;

    setCommissions(pruneCommissions(result.commissions, todayKey));
    if (result.brass > 0) dispatch({ type: 'BrassCredited', brass: result.brass });

    const kept = result.settled.filter((c) => c.outcome === 'kept');
    const lost = result.settled.filter((c) => c.outcome === 'forfeited');
    if (kept.length > 0 && lost.length === 0) {
      setToast(
        `${kept.length === 1 ? 'Commission kept' : `${kept.length} commissions kept`} — ${result.brass.toLocaleString()} brass back.`
      );
    } else if (lost.length > 0 && kept.length === 0) {
      const staked = lost.reduce((sum, c) => sum + c.stake, 0);
      setToast(
        `${lost.length === 1 ? 'A commission lapsed' : `${lost.length} commissions lapsed`} — ${staked.toLocaleString()} brass forfeited.`
      );
    } else if (kept.length > 0) {
      setToast(
        `${kept.length} kept, ${lost.length} lapsed. ${result.brass.toLocaleString()} brass back.`
      );
    }
     
  }, [commissions, todayKey]);

  /**
   * Place a commission.
   *
   * The stake leaves the balance here, at placement, which is what makes it a stake rather
   * than a wager settled later. `brassSpent` moves with it so lifetime earnings stay
   * derivable — and a forfeit is then simply a spend that bought nothing, which the honest
   * negative balance can already express.
   */
  const handleCommit = useCallback(
    (date: string, blockId: string, stake: number) => {
      const result = placeCommission({
        existing: commissions,
        plan: plansRef.current[date],
        date,
        blockId,
        stake,
        brass: progress.brass,
        today: todayKey,
        id: uid(),
      });
      if (!result.ok || !result.commission) {
        setToast(
          refusalMessage(result.reason ?? 'missing', stake, progress.brass)
        );
        return;
      }
      setCommissions((cs) => [...cs, result.commission!]);
      dispatch({ type: 'BrassStaked', stake });
      setToast(
        `${stake.toLocaleString()} brass staked on “${result.commission.title}”. Finish it for ${payoutFor(stake).toLocaleString()}.`
      );
    },
    [progress.brass, commissions, todayKey]
  );

  /**
   * Chain progress, and the steps it owes.
   *
   * Built from lifetime counters rather than the week, which is the whole reason chains can
   * span a fortnight. Cheap enough to recompute freely — every input is already in memory.
   */
  const chainContext = useMemo(
    () => ({ progress, streak, stats: dayStats, awards, today: todayKey }),
    [progress, streak, dayStats, awards, todayKey]
  );

  const chains = useMemo(() => chainStatuses(awards, chainContext), [awards, chainContext]);

  useEffect(() => {
    if (!progress.startedOn) return;
    const due = chainPayout(awards, chainContext);
    if (due.length === 0) return;
    offerAwards(
      due,
      Object.fromEntries(
        due.map((a) => [
          a.key,
          { kind: 'quest' as const, name: a.label ?? 'Chain step', xp: a.xp },
        ])
      )
    );
  }, [awards, offerAwards, progress.startedOn, chainContext]);

  /**
   * Unseal codex cards whose data requirement is met.
   *
   * Only while Standing is open, since that is the only time the wide window is
   * loaded. An insight that unsealed silently in the background would pay for a
   * discovery you never saw.
   */
  useEffect(() => {
    if (nav !== 'standing') return;
    if (!progress.startedOn) return;
    const due = unlocksDue(awards, insightContext);
    if (due.length === 0) return;

    const moments: Record<string, RewardMoment> = {};
    for (const a of due) {
      const rule = insightById(insightIdFromKey(a.key));
      if (rule) {
        moments[a.key] = {
          kind: 'codex',
          name: rule.name,
          glyph: rule.glyph,
          xp: rule.xpUnlock,
        };
      }
    }
    offerAwards(due, moments);
  }, [offerAwards, progress.startedOn, nav, insightContext, awards]);

  const shopOffers = useMemo(
    () => offersFor(shop, progress, weekKey),
    [shop, progress, weekKey]
  );

  const handleBuy = useCallback(
    (itemId: string) => {
      // The refusal comes back through the store's notice, so the reason and the words for
      // it are decided in one place rather than duplicated either side of the dispatch.
      dispatch({ type: 'Purchased', itemId, weekKey });
    },
    [weekKey]
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
    dispatch({ type: 'Reset', today: todayKey });
    clearRewards();

    keptTodayRef.current = null;
    reviewSeen.current = '';
    setToast('Standing reset. Level 0, nothing earned — counting from today.');
  }, [clearRewards, todayKey]);

  const handleEquip = useCallback(
    (itemId: string) => dispatch({ type: 'ShopChanged', shop: equipItem(shop, itemId) }),
    [shop]
  );

  const handleUnequip = useCallback(
    (slot: 'finish' | 'meter' | 'title' | 'frame') =>
      dispatch({ type: 'ShopChanged', shop: unequipSlot(shop, slot) }),
    [shop]
  );

  /**
   * Switch an owned permanent on or off.
   *
   * `setActive` refuses anything not owned or not switchable, so this passes the
   * intent straight through rather than checking first — the rule lives in one place
   * and every caller gets it.
   */
  const handleToggleActive = useCallback(
    (itemId: string, on: boolean) =>
      dispatch({ type: 'ShopChanged', shop: setActive(shop, itemId, on) }),
    [shop]
  );

  /**
   * Spend a consumable, deliberately.
   *
   * The freeze refill used to spend ITSELF: an effect watched the freeze count and
   * cashed one in the moment a freeze was missing. The reasoning was that protection
   * should not need remembering — but the effect of it was that something bought for a
   * bad week was gone by Tuesday of a good one, spent on a gap that did not matter,
   * with a toast as the only notice. A safety net you cannot choose to hold is not a
   * safety net, it is a slow refund.
   *
   * Both arms report what happened. A consumable that silently declines to work is
   * worse than one that refuses out loud, because the stock still went down in the
   * only place anyone would think to look.
   */
  const handleUseItem = useCallback(
    (itemId: string) => {
      if (itemId === 'freeze-refill') {
        if (streak.freezes >= streak.capacity) {
          setToast('Your freezes are already full.');
          return;
        }
        const r = spendRefill(shop);
        if (!r.ok) return;
        dispatch({ type: 'ShopChanged', shop: r.shop });
        dispatch({ type: 'FreezesSet', freezes: streak.freezes + 1 });
        setToast('Freeze refilled.');
        return;
      }

      if (itemId === 'boost-day') {
        // Today, not a date picker. A past day would re-score history, and a future
        // one commits the booster to a day you cannot yet see — whereas "today" is
        // the decision someone actually wants to make, at the moment they want it.
        const r = spendBoost(shop, todayKey);
        if (!r.ok) {
          setToast('Today is already boosted.');
          return;
        }
        dispatch({ type: 'ShopChanged', shop: r.shop });
        setToast('Today counts double. It will be marked as boosted in the record.');
      }
    },
    [shop, streak.freezes, streak.capacity, todayKey]
  );

  /**
   * Paid the first time a card is actually opened.
   *
   * Reading is a separate reward from unsealing because they are separate acts: the
   * data earned the unseal, but an insight you have not looked at has done nothing
   * for you.
   */
  const handleReadInsight = useCallback(
    (id: string) => {
      if (isRead(awards, id)) return;
      const rule = insightById(id);
      if (!rule) return;
      dispatch({
        type: 'AwardsOffered',
        payouts: [
          {
            key: readKey(id),
            xp: rule.xpRead,
            discipline: 'insight',
            label: `${rule.name} — read`,
          },
        ],
        note: true,
      });
    },
    [awards]
  );

  /**
   * Pay finished quests and challenges.
   *
   * Guarded on the week being the current one: a past week's board is a record, and
   * scrolling back through the calendar must not hand out bonuses for sets that closed
   * weeks ago. The ledger would stop a second payment, but it would not stop a first
   * one that was never earned in the present.
   */
  useEffect(() => {
    if (!progress.startedOn) return;
    if (weekKey !== currentWeekKey()) return;
    const due = questPayout(awards, quests, [daily, weekly]);
    if (due.length === 0) return;

    // One entry per finished thing, so a day that closes three plays three moments. Keyed
    // by award key, so a card cannot appear for a quest the ledger refused.
    offerAwards(
      due,
      Object.fromEntries(
        due.map((a) => [
          a.key,
          { kind: 'quest' as const, name: a.label ?? 'Quest', xp: a.xp },
        ])
      )
    );
  }, [offerAwards, quests, daily, weekly, weekKey, awards, progress.startedOn]);

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

  /** Is there anything a clear would actually move? */
  const canUnschedule = useMemo(
    () => hasClearableBlocks(dayPlan.blocks),
    [dayPlan.blocks]
  );

  /**
   * Empty the day back into the intake, keeping what must not move.
   *
   * The rule itself lives in `clearToIntake` — what stays is the entire safety of this
   * operation, and a rule inside a click handler is a rule nothing can assert.
   */
  const handleUnscheduleUnpinned = useCallback(() => {
    const plan = plansRef.current[date];
    if (!plan) return;

    const { kept, returned, pinnedKept } = clearToIntake(plan.blocks);
    if (returned.length === 0) return;

    mutateDay(
      date,
      (p) => ({ ...p, blocks: kept, tasks: [...p.tasks, ...returned] }),
      'clearing the day'
    );
    setOverflow([]);
    setOverflowReasons({});
    setToast(
      pinnedKept > 0
        ? `${returned.length} back in the intake. ${pinnedKept} pinned ${
            pinnedKept === 1 ? 'entry' : 'entries'
          } left in place.`
        : `${returned.length} back in the intake.`
    );
  }, [date, mutateDay]);

  // -------------------------------------------------------------------------
  // Day-level actions
  // -------------------------------------------------------------------------
  const handleAddTasks = useCallback(
    (newTasks: Task[]) => {
      mutateDay(date, (p) => ({ ...p, tasks: [...p.tasks, ...newTasks] }), 'adding those tasks');
    },
    [date, mutateDay]
  );

  const handleUpdateTask = useCallback(
    (id: string, patch: Partial<Task>) => {
      mutateDay(date, (p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      }), 'that task edit');
    },
    [date, mutateDay]
  );

  const handleRemoveTask = useCallback(
    (id: string) => {
      mutateDay(date, (p) => ({ ...p, tasks: p.tasks.filter((t) => t.id !== id) }), 'removing that task');
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
        // Both of these have to survive the round trip. A rebuild turns every block
        // back into a task and schedules it again, so anything not copied here is
        // silently discarded by the act of rearranging the day — the note would
        // vanish, and a block deliberately kept whole would come back in chunks.
        notes: b.notes,
        keepWhole: b.keepWhole,
      }));

    const result = buildSchedule(
      [...intakeFixed, ...displaced, ...intakeFlex],
      effectiveStart(date, settings),
      settings.workingEnd,
      preserved,
      schedulerRulesNow()
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

    mutateDay(date, (p) => ({ ...p, blocks, tasks: [] }), 'building the day');
    setOverflow(result.overflow);
    setOverflowReasons(result.reasons);
    setBuildPulse((n) => n + 1);
    warnIfMarked(date, blocks.filter((b) => !b.auto).length);
  }, [plans, date, settings, schedulerRulesNow, mutateDay, warnIfMarked]);

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
        // Both of these have to survive the round trip. A rebuild turns every block
        // back into a task and schedules it again, so anything not copied here is
        // silently discarded by the act of rearranging the day — the note would
        // vanish, and a block deliberately kept whole would come back in chunks.
        notes: b.notes,
        keepWhole: b.keepWhole,
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

    mutateDay(date, (p) => ({ ...p, blocks, tasks: [] }), 'the rebuild');
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
        }), 'that change');
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
      }), 'moving that entry');
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
      }), 'that resize');
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
      // Two calls, one gesture. They land in the same microtask, so the undo transaction
      // covers both days and a single press puts the block back where it came from.
      mutateDay(from, (p) => ({ ...p, blocks: vacated.blocks }), 'moving that to another day');
      mutateDay(to, (p) => ({ ...p, blocks: landing.blocks }), 'moving that to another day');

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
      }), 'completing that entry');

      if (!nowCompleted || !block) return;

      // Immediate feedback, computed here rather than waiting for the reconcile
      // pass — a reward that arrives a frame after the click does not feel caused
      // by it. The authoritative total still comes from reconciliation.
      const dayBlocks = (plansRef.current[day]?.blocks ?? []).map((b) =>
        b.id === id ? { ...b, completed: true, completedAt: minutesSinceMidnightOf(day) } : b
      );
      const run = comboRuns(dayBlocks).get(id) ?? 0;
      const mods = modifiers[day] ?? NO_MODIFIERS;
      const { xp } = xpForBlock(
        { ...block, completed: true, completedAt: minutesSinceMidnightOf(day) },
        categories,
        run
      );
      // The boost is a day-level multiplier, so the float has to apply it itself. Left
      // out, a boosted day showed +121 on the tick and credited +242 a beat later —
      // and the number you watch fly up is the one you believe.
      setXpFloat({ key: Date.now(), xp: Math.round(xp * mods.boost), combo: run });
      if (run > 0) sfxCombo(run);
      else sfxComplete();

      // `cleared` is minutes against minutes, so the boost cannot change it. Passed
      // anyway: these two want to be the same call as everywhere else, and the next
      // person to read a field off them should not have to know which ones are safe.
      const after = reckonDay(day, dayBlocks, categories, mods);
      const before = reckonDay(day, plansRef.current[day]?.blocks ?? [], categories, mods);
      if (after.stat.cleared && !before.stat.cleared) sfxDayCleared();
    },
    [modifiers, mutateDay, categories]
  );

  const handleDeleteBlock = useCallback(
    (day: string, id: string) => {
      // Removing an entry closes the slot behind it, same as dragging one away.
      mutateDay(day, (p) => ({
        ...p,
        blocks: reflowRemove(p.blocks, id, settings.workingEnd).blocks,
      }), 'deleting that entry');
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
      mutateDay(day, (p) => ({ ...p, blocks: landing.blocks }), 'adding that entry');
      bumpModal();
      setEditing({ date: day, block });
      const note = describeReflow(landing, formatDuration);
      if (note) setToast(note);
    },
    [bumpModal, mutateDay, categories, settings.workingEnd]
  );

  const handleEditBlock = useCallback(
    (day: string, id: string) => {
      const block = plansRef.current[day]?.blocks.find((b) => b.id === id);
      if (block) {
        bumpModal();
        setEditing({ date: day, block });
      }
    },
    [bumpModal]
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

  // -------------------------------------------------------------------------
  // Keyboard
  //
  // Before this, four keydown listeners existed and all four only closed a modal — an app
  // opened every morning and driven all day was mouse-only. This is also an accessibility
  // floor rather than a power-user nicety: completing a block previously required hitting
  // a small target inside a positioned div, with no keyboard route to it at all.
  //
  // A SELECTION IS REAL STATE, scoped to the displayed day. Up and down walk the day in
  // schedule order, which is the order the grid draws — so the selection moves the way the
  // eye does. It clears when the date changes, because a selection pointing at a block on
  // a day you are no longer looking at is a trap.
  //
  // Every shortcut is refused while a modal is open or a field has focus. Typing "n" into
  // a task title must never create a block, and that is the failure mode a global handler
  // invites.
  // -------------------------------------------------------------------------
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => setSelectedId(null), [date, view, nav]);

  /** The day's blocks in the order they are drawn, which is the order to walk them in. */
  const selectableBlocks = useMemo(
    () => [...(plans[date]?.blocks ?? [])].sort((a, b) => a.start - b.start),
    [plans, date]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Undo works everywhere except inside a text field, where the browser's own undo is
      // what the user means.
      const target = e.target as HTMLElement | null;
      const typing =
        target != null &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if (meta && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (typing) return;
        e.preventDefault();
        undo();
        return;
      }

      // Everything below is a bare key, so it must not fire while typing, while a modifier
      // is held, or while any modal owns the screen.
      if (typing || meta || e.altKey) return;
      if (anyModalOpen) return;
      if (nav !== 'calendar') return;

      const blocks = selectableBlocks;
      const index = selectedId ? blocks.findIndex((b) => b.id === selectedId) : -1;

      switch (e.key) {
        case 't':
        case 'T':
          e.preventDefault();
          setTravel(date < todayKey ? 1 : -1);
          setDate(todayKey);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          handleStep(-1);
          return;
        case 'ArrowRight':
          e.preventDefault();
          handleStep(1);
          return;
        case '[':
          e.preventDefault();
          setView(view === 'month' ? 'week' : 'day');
          return;
        case ']':
          e.preventDefault();
          setView(view === 'day' ? 'week' : 'month');
          return;
        case 'n':
        case 'N':
          e.preventDefault();
          handleQuickAdd();
          return;
        case 'b':
        case 'B':
          e.preventDefault();
          if (view === 'day') handleBuildDay();
          return;
        case 'ArrowDown':
          if (view !== 'day' || blocks.length === 0) return;
          e.preventDefault();
          setSelectedId(blocks[Math.min(blocks.length - 1, index + 1)].id);
          return;
        case 'ArrowUp':
          if (view !== 'day' || blocks.length === 0) return;
          e.preventDefault();
          // From nothing selected, up selects the last block rather than the first, so the
          // two arrows enter the list from opposite ends.
          setSelectedId(blocks[index <= 0 ? blocks.length - 1 : index - 1].id);
          return;
        case ' ':
          if (index < 0) return;
          e.preventDefault();
          handleToggleComplete(date, blocks[index].id);
          return;
        case 'Enter':
          if (index < 0) return;
          e.preventDefault();
          handleEditBlock(date, blocks[index].id);
          return;
        case 'Escape':
          if (selectedId) {
            e.preventDefault();
            setSelectedId(null);
          }
          return;
        default:
          return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    anyModalOpen,
    date,
    handleBuildDay,
    handleEditBlock,
    handleQuickAdd,
    handleStep,
    handleToggleComplete,
    nav,
    selectableBlocks,
    selectedId,
    todayKey,
    undo,
    view,
  ]);

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
        onOpenBackup={() => {
          bumpModal();
          setBackupOpen(true);
        }}
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
        character={thisWeeksCharacter}
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
              canUnschedule={canUnschedule && view === 'day'}
              onUnschedule={handleUnscheduleUnpinned}
              onRebuildFromNow={handleRebuildFromNow}
              undoCount={undoCount}
              onUndo={undo}
              // The importer reads a whole month at once, so it is only offered
              // where a whole month is on screen.
              onImportMarks={
                view === 'month'
                  ? () => {
                      bumpModal();
                      setMarksOpen(true);
                    }
                  : undefined
              }
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
                    medians={weekMedians}
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
                    selectedId={selectedId}
                    onSelect={setSelectedId}
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
                    selectedId={selectedId}
                    onSelect={setSelectedId}
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
              history={goalHistory}
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
              onToggleActive={handleToggleActive}
              onUseItem={handleUseItem}
              previousWeekKey={addWeeks(weekKey, -1)}
              codex={codex}
              onReadInsight={handleReadInsight}
              insightWindowDays={INSIGHT_WINDOW_DAYS}
              quests={quests}
              chains={chains}
              season={liveSeason}
              character={thisWeeksCharacter}
              sealedSeasons={Object.keys(seasons).sort().map((k) => seasons[k])}
              seasonFraction={seasonProgress(todayKey)}
              commissions={commissions}
              onOpenYearPage={() => setYearPageOpen(true)}
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
        key={`edit:${modalEpoch}`}
        target={editing}
        categories={categories}
        onClose={() => setEditing(null)}
        onSave={(day, id, patch, moveTo) => {
          if (moveTo) handleMoveBlock(day, id, moveTo, patch);
          else handleChangeBlock(day, id, patch);
          setEditing(null);
        }}
        onDelete={handleDeleteBlock}
        today={todayKey}
        brass={progress.brass}
        commission={editing ? commissionFor(commissions, editing.block.id) ?? null : null}
        onCommit={handleCommit}
      />

      <DayMarkImport
        key={`marks:${modalEpoch}`}
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
        key={`backup:${modalEpoch}`}
        open={backupOpen}
        today={todayKey}
        onClose={() => setBackupOpen(false)}
        onNotify={setToast}
      />

      {/* The reward layer. Three sizes, deliberately unequal — see XpToast. */}
      <XpFloat award={xpFloat} />
      {/*
        One queue, so these play in sequence rather than piling on top of each other. Each
        renders only when it is the current moment; the queue's timer is the only thing
        that advances it.
      */}
      <RunKeptToast
        run={momentOf(rewards.current, 'runKept')?.run ?? null}
        seed={momentOf(rewards.current, 'runKept')?.seed ?? 0}
      />
      <RunTakeover days={runTakeover?.days ?? null} onDismiss={rewards.dismiss} />
      <QuestDoneToast
        quest={momentOf(rewards.current, 'quest')}
        remaining={rewards.remaining}
      />
      <CodexUnlockToast
        card={momentOf(rewards.current, 'codex')}
        remaining={rewards.remaining}
      />
      <BadgeUnlockToast
        def={momentOf(rewards.current, 'badge')?.def ?? null}
        remaining={rewards.remaining}
      />
      <LevelToast
        standing={momentOf(rewards.current, 'level')?.standing ?? null}
        pending={rewards.remaining}
      />
      <LevelTakeover
        standing={takeover?.standing ?? null}
        current={standing}
        prestige={takeover?.prestige ?? false}
        nextRank={standing.level < LEVELS_PER_CYCLE ? RANKS[standing.level] : null}
        onDismiss={rewards.dismiss}
      />

      {/*
        The only screen here a person would show someone else. Built entirely from records
        already kept, which is why it can be generated for any year after the fact.
      */}
      <YearPage
        open={yearPageOpen}
        year={Number(todayKey.slice(0, 4))}
        stats={dayStats}
        marks={dayMarks}
        markDefs={markDefs}
        seasons={Object.keys(seasons)
          .sort()
          .filter((k) => k.startsWith(todayKey.slice(0, 4)))
          .map((k) => seasons[k])}
        totalXp={progress.totalXp}
        onClose={() => setYearPageOpen(false)}
        onNotify={setToast}
      />

      {/*
        Last in the tree and highest in the stack, so everything above renders underneath it
        from the first frame. This is a curtain that leaves, not a gate that opens — and it
        owns its own lifecycle, so there is no flag here for anything to flip back.
      */}
      <BootSequence />

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
  const [useInsights, setUseInsights] = useState(settings.useInsightScheduling);

  useEffect(() => {
    setStart(minutesTo24h(settings.workingStart));
    setEnd(minutesTo24h(settings.workingEnd));
    setUseInsights(settings.useInsightScheduling);
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
    onSave({ workingStart: s, workingEnd: e, useInsightScheduling: useInsights });
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

            {/*
              The one place a codex finding is allowed to change behaviour rather than
              just report it, so it asks rather than assumes. Off by default: the build
              button's output should be predictable until you decide otherwise, and a
              scheduler that quietly changed its mind as history accumulated would be hard
              to trust and harder to debug.
            */}
            <label className="flex items-start gap-2.5 mt-4 cursor-pointer">
              <input
                type="checkbox"
                checked={useInsights}
                onChange={(e) => setUseInsights(e.target.checked)}
                className="mt-0.5 shrink-0"
              />
              <span className="min-w-0">
                <span className="text-[12.5px] text-ink-1 block">
                  Build around when you actually finish things
                </span>
                <span className="text-[11px] text-ink-3 block leading-relaxed mt-0.5">
                  Uses the codex&rsquo;s completion history to prefer each category&rsquo;s
                  strongest part of the day. Only ever chooses between tasks that already
                  fit the slot, and does nothing until there is enough history to be sure.
                </span>
              </span>
            </label>

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

import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Lock } from 'lucide-react';
import type {
  AwardLedger,
  CategoryDef,
  DailyStat,
  DayMarkDef,
  DayMarks,
  DisciplineId,
  StreakState,
  UserProgress,
  XpLine,
} from '../types';
import { DISCIPLINES } from '../types';
import { STREAK_THRESHOLD } from '../streaks';
import {
  areaStandingFor,
  brassEarned,
  CYCLE_XP,
  dayScore,
  LEVELS_PER_CYCLE,
  RANKS,
  standingFor,
  xpToNextLevel,
} from '../progress';
import { colorsFor, resolveCategory } from '../utils/color';
import Figure from './Figure';
import { formatDuration } from '../utils/time';
import { usePanelMotion, staggerDelay } from '../utils/motion';
import Foldable from './Foldable';
import Sigil from './pixel/Sigil';
import PixelMeter from './pixel/PixelMeter';
import StreakPanel from './StreakPanel';
import BadgeShelf from './BadgeShelf';
import QuestBoard from './QuestBoard';
import CodexPanel from './CodexPanel';
import ShopPanel from './ShopPanel';
import type { Offer, ShopState } from '../shop';
import { CATALOGUE } from '../shop';
import { CODEX_TOTAL, type InsightStatus } from '../insights';
import { questSummary, type Challenge, type Quest } from '../quests';
import type { BadgeStatus } from '../badges';

// ============================================================================
// StandingView
//
// Where the progression layer gets room to breathe. Three registers, top to bottom:
// who you are right now, what today has earned, and where your depth actually lies.
//
// The hybrid look lives here: the chassis, type and rules are the app's own, and
// the game parts — segmented meters, the pixel sigil, chunky tabular numerals — sit
// on top as a readout bolted to an instrument. Nothing is rounded, because a pixel
// grid with soft corners is neither one thing nor the other.
// ============================================================================

interface Props {
  progress: UserProgress;
  streak: StreakState;
  todayKey: string;
  marks: DayMarks;
  markDefs: DayMarkDef[];
  badges: BadgeStatus[];
  shop: ShopState;
  shopOffers: Offer[];
  onResetProgress: () => void;
  onBuy: (itemId: string) => void;
  onEquipItem: (itemId: string) => void;
  onUnequipSlot: (slot: 'finish' | 'meter' | 'title' | 'frame') => void;
  previousWeekKey: string;
  codex: InsightStatus[];
  onReadInsight: (id: string) => void;
  insightWindowDays: number;
  quests: Quest[];
  daily: Challenge;
  weekly: Challenge;
  awards: AwardLedger;
  routines: {
    id: string;
    label: string;
    current: number;
    dueToday: boolean;
    doneToday: boolean;
  }[];
  /** Today's stat, if the day has anything in it. */
  today: DailyStat | undefined;
  /** Today's ledger, most valuable first. */
  todayLines: XpLine[];
  categories: CategoryDef[];
  categoryXp: Record<string, number>;
  disciplineXp: Partial<Record<DisciplineId, number>>;
  /** Trailing stats for the run of recent days. */
  stats: Record<string, DailyStat>;
  recentDates: string[];
}

export default function StandingView({
  progress,
  streak,
  todayKey,
  marks,
  markDefs,
  badges,
  shop,
  shopOffers,
  onResetProgress,
  onBuy,
  onEquipItem,
  onUnequipSlot,
  previousWeekKey,
  codex,
  onReadInsight,
  insightWindowDays,
  quests,
  daily,
  weekly,
  awards,
  routines,
  today,
  todayLines,
  categories,
  categoryXp,
  disciplineXp,
  stats,
  recentDates,
}: Props) {
  const panel = usePanelMotion();
  const s = useMemo(() => standingFor(progress.totalXp), [progress.totalXp]);
  const toNext = xpToNextLevel(progress.totalXp);

  const score = dayScore(today);
  const lines = useMemo(() => [...todayLines].sort((a, b) => b.xp - a.xp), [todayLines]);

  const orderedCategories = useMemo(
    () => [...categories].sort((a, b) => (categoryXp[b.id] ?? 0) - (categoryXp[a.id] ?? 0)),
    [categories, categoryXp]
  );

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-6 pb-10">
      <motion.div {...panel} className="max-w-[900px]">
        {/* ---------------- the standing itself ---------------- */}
        <div className="py-5">
          <div className="flex items-start gap-5 flex-wrap">
            <Sigil
              form={s.sigilForm}
              pips={s.sigilPips}
              size={56}
              title={`Cycle ${s.prestige + 1} sigil`}
            />

            <div className="flex-1 min-w-[260px]">
              <div className="flex items-baseline gap-3 flex-wrap">
                <h2
                  className="font-display text-bone-0"
                  style={{ fontSize: 34, letterSpacing: '-0.02em', lineHeight: 1.05 }}
                >
                  {s.rank}
                </h2>
                <span
                  className="font-mono tnum"
                  style={{ fontSize: 11, letterSpacing: '0.14em', color: 'var(--signal)' }}
                >
                  LEVEL {s.level}
                </span>
                {s.prestige > 0 && (
                  <span
                    className="font-mono tnum px-1.5 py-[1px]"
                    style={{
                      fontSize: 9.5,
                      letterSpacing: '0.12em',
                      color: 'var(--action-ink)',
                      background: 'var(--signal)',
                    }}
                  >
                    CYCLE {s.prestige + 1}
                  </span>
                )}
              </div>

              <div className="mt-3">
                <PixelMeter
                  value={s.levelProgress}
                  segments={30}
                  height={12}
                  title={`${s.intoLevel} of ${s.levelCost} XP into level ${s.level}`}
                />
                <div className="flex items-baseline justify-between mt-1.5 gap-4 flex-wrap">
                  <span className="font-mono text-nano tnum text-bone-3 tracking-wide">
                    <Figure value={s.intoLevel} /> / {s.levelCost.toLocaleString()} XP
                    {' · '}
                    <Figure value={toNext} /> to{' '}
                    {s.level === LEVELS_PER_CYCLE ? 'prestige' : RANKS[s.level]}
                  </span>
                  <span className="font-mono text-nano tnum text-bone-2 tracking-wide">
                    <Figure value={progress.totalXp} /> XP lifetime
                  </span>
                </div>
              </div>
            </div>

            <BrassPanel progress={progress} />
          </div>

          {/* Cycle position, so level 60 never arrives as a surprise. */}
          <div className="mt-5">
            <div className="legend mb-1.5">Cycle {s.prestige + 1} · 60 levels</div>
            <PixelMeter
              value={(s.prestige > 0
                ? progress.totalXp - s.prestige * CYCLE_XP
                : progress.totalXp) / CYCLE_XP}
              segments={60}
              height={7}
              gap={1}
              color="var(--bone-3)"
              cursor={false}
              title={`Level ${s.level} of ${LEVELS_PER_CYCLE}`}
            />
          </div>
        </div>

        <div className="rule-h" />

        {/* ---------------- today ---------------- */}
        <Foldable
          id="today"
          title="Today"
          summary={
            today
              ? `${formatDuration(today.doneMinutes)} of ${formatDuration(today.plannedMinutes)} · +${today.xpEarned} XP`
              : 'nothing planned yet'
          }
        >

          {/* One bar, two markers: how far through today, and where the run is safe.
              These were two separate meters meaning different things sitting close
              enough together to be conflated. */}
          <PixelMeter
            value={score}
            segments={25}
            height={14}
            notchAt={STREAK_THRESHOLD}
            title={`${Math.round(score * 100)}% of today done — the run is safe past ${Math.round(STREAK_THRESHOLD * 100)}%`}
          />
          <div className="flex items-baseline justify-between mt-1 font-mono text-nano text-bone-4">
            <span />
            <span style={{ marginRight: `${(1 - STREAK_THRESHOLD) * 100}%` }}>
              run safe from here →
            </span>
          </div>

          <div className="flex items-center gap-4 mt-2 flex-wrap">
            <span
              className="font-mono tnum"
              style={{ fontSize: 20, fontWeight: 700, color: score >= 1 ? 'var(--good)' : 'var(--bone-0)' }}
            >
              {Math.round(score * 100)}%
            </span>
            {today && today.bestCombo > 1 && (
              <span
                className="font-mono px-1.5 py-[2px]"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--signal)',
                  background: 'var(--signal-dim)',
                }}
              >
                BEST COMBO ×{today.bestCombo}
              </span>
            )}
            {today?.cleared && (
              <span
                className="font-mono px-1.5 py-[2px]"
                style={{
                  fontSize: 10,
                  letterSpacing: '0.1em',
                  color: 'var(--action-ink)',
                  background: 'var(--good)',
                }}
              >
                DAY CLEARED
              </span>
            )}
          </div>

          {lines.length > 0 && (
            <div className="mt-4">
              <div className="legend mb-1">Ledger</div>
              {lines.map((line, i) => (
                <motion.div
                  key={line.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: staggerDelay(i), duration: 0.18 }}
                  className="flex items-baseline gap-3 py-1.5 border-b border-rule-1"
                >
                  <span
                    className="font-mono tnum shrink-0 text-right"
                    style={{ width: 52, color: 'var(--signal)', fontSize: 12, fontWeight: 700 }}
                  >
                    +{line.xp}
                  </span>
                  <span className="text-body-sm text-bone-1 truncate flex-1 min-w-0">
                    {line.label}
                  </span>
                  {line.minutes > 0 && (
                    <span className="font-mono text-nano tnum text-bone-3 shrink-0">
                      {formatDuration(line.minutes)}
                    </span>
                  )}
                  {line.notes.length > 0 && (
                    <span
                      className="font-mono text-nano text-bone-3 shrink-0 hidden sm:inline"
                      title={line.notes.join(' · ')}
                    >
                      {line.notes.join(' · ')}
                    </span>
                  )}
                </motion.div>
              ))}
            </div>
          )}
        </Foldable>

        <div className="rule-h" />

        <Foldable
          id="run"
          title="The run"
          summary={
            `best ${streak.longest} day${streak.longest === 1 ? '' : 's'}` +
            (streak.startedOn ? ` · since ${streak.startedOn}` : '')
          }
        >
          <StreakPanel
            streak={streak}
            today={todayKey}
            todayStat={today}
            stats={stats}
            marks={marks}
            markDefs={markDefs}
            dates={recentDates}
            routines={routines}
          />
        </Foldable>

        <div className="rule-h" />

        <div className="rule-h" />

        <Foldable
          id="quests"
          title="The board"
          summary={(() => {
            const s = questSummary(quests);
            return `${s.complete} of ${s.total} finished`;
          })()}
        >
          <QuestBoard quests={quests} daily={daily} weekly={weekly} awards={awards} />
        </Foldable>

        <div className="rule-h" />

        <Foldable
          id="shelf"
          title="The shelf"
          summary={`${badges.filter((b) => b.earned).length} of ${badges.length} earned`}
        >
          <BadgeShelf statuses={badges} />
        </Foldable>

        <div className="rule-h" />

        <Foldable
          id="codex"
          title="The codex"
          summary={(() => {
            const open = codex.filter((c) => c.unlocked).length;
            const unread = codex.filter((c) => c.unlocked && !c.read).length;
            return `${open} of ${CODEX_TOTAL} unsealed${unread > 0 ? ` · ${unread} unread` : ''}`;
          })()}
        >
          <CodexPanel
            statuses={codex}
            onRead={onReadInsight}
            windowDays={insightWindowDays}
          />
        </Foldable>

        <div className="rule-h" />

        <Foldable
          id="shop"
          title="The shop"
          summary={`${progress.brass.toLocaleString()} brass · ${shopOffers.filter((o) => o.canBuy).length} of ${CATALOGUE.length} affordable`}
        >
          <ShopPanel
            offers={shopOffers}
            shop={shop}
            brass={progress.brass}
            spent={progress.brassSpent}
            weekKey={todayKey}
            previousWeekKey={previousWeekKey}
            onBuy={onBuy}
            onEquip={onEquipItem}
            onUnequip={onUnequipSlot}
          />
        </Foldable>

        <div className="rule-h" />

        {/* ---------------- areas ---------------- */}
        <Foldable
          id="areas"
          title="Where your depth is"
          summary={`${orderedCategories.length} categories · ${DISCIPLINES.filter((d) => d.live).length} disciplines`}
        >
          <p className="text-body-sm text-bone-3 mb-4 max-w-[62ch] leading-relaxed">
            Categories rise with the time you put into them. Disciplines measure how you
            work rather than what on — and two of them are waiting on parts of the app
            that don't exist yet.
          </p>

          <div className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            <div>
              <div className="legend mb-2">Categories</div>
              {orderedCategories.map((cat, i) => {
                const c = colorsFor(resolveCategory(cat.id, categories).accent);
                return (
                  <AreaRow
                    key={cat.id}
                    label={cat.label}
                    xp={categoryXp[cat.id] ?? 0}
                    color={c.accent}
                    index={i}
                  />
                );
              })}
            </div>

            <div>
              <div className="legend mb-2">Disciplines</div>
              {DISCIPLINES.map((d, i) =>
                d.live ? (
                  <AreaRow
                    key={d.id}
                    label={d.label}
                    hint={d.blurb}
                    xp={disciplineXp[d.id] ?? 0}
                    color="var(--signal)"
                    index={i}
                  />
                ) : (
                  <div
                    key={d.id}
                    className="flex items-center gap-2 py-2 border-b border-rule-1"
                    style={{ opacity: 0.55 }}
                  >
                    <Lock size={11} strokeWidth={2} className="text-bone-4 shrink-0" />
                    <span className="text-body-sm text-bone-3">{d.label}</span>
                    <span className="font-mono text-nano text-bone-4 ml-auto">
                      {d.blurb.toLowerCase()}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        </Foldable>

        <div className="rule-h" />

        <ResetRow onReset={onResetProgress} />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BrassPanel({ progress }: { progress: UserProgress }) {
  return (
    <div
      className="px-3 py-2.5 shrink-0"
      style={{ background: 'var(--chassis-2)', border: '1px solid var(--rule-2)' }}
    >
      <div className="legend mb-1">Brass</div>
      <div className="flex items-baseline gap-1.5">
        {/* A pixel lozenge instead of a coin glyph — no icon font, no asset. */}
        <span
          style={{
            display: 'inline-block',
            width: 8,
            height: 8,
            background: 'var(--signal)',
            transform: 'rotate(45deg)',
          }}
        />
        <span
          className="font-mono tnum"
          style={{ fontSize: 20, fontWeight: 700, color: 'var(--bone-0)' }}
        >
          <Figure value={progress.brass} />
        </span>
      </div>
      <div className="font-mono text-nano tnum text-bone-3 mt-1">
        <Figure value={brassEarned(progress)} /> earned
      </div>
    </div>
  );
}

function AreaRow({
  label,
  hint,
  xp,
  color,
  index,
}: {
  label: string;
  hint?: string;
  xp: number;
  color: string;
  index: number;
}) {
  const a = areaStandingFor(xp);
  return (
    <motion.div
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: staggerDelay(index), duration: 0.2 }}
      className="py-2 border-b border-rule-1"
    >
      <div className="flex items-baseline gap-2">
        <span className="text-body-sm text-bone-1 truncate flex-1 min-w-0">{label}</span>
        <span
          className="font-mono tnum shrink-0"
          style={{ fontSize: 11, color: 'var(--bone-2)' }}
        >
          L{a.level}
        </span>
      </div>
      <div className="mt-1.5">
        <PixelMeter
          value={a.progress}
          segments={16}
          height={6}
          gap={1}
          color={color}
          cursor={false}
          title={`${a.intoLevel} / ${a.levelCost} XP into level ${a.level}`}
        />
      </div>
      {hint && (
        <div className="font-mono text-nano text-bone-4 mt-1">{hint.toLowerCase()}</div>
      )}
    </motion.div>
  );
}

/**
 * Starting over.
 *
 * Two clicks, and the second one is labelled with what it destroys. Kept at the very
 * bottom because it is the one control here you cannot undo — and stated plainly that
 * it leaves the calendar itself alone, since the fear that stops people using a reset
 * is not knowing whether their work goes with it.
 */
function ResetRow({ onReset }: { onReset: () => void }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <section className="py-5">
      <div className="flex items-baseline gap-3 flex-wrap">
        <div className="flex-1 min-w-[280px]">
          <div className="legend mb-1">Start again</div>
          <p className="text-body-sm text-bone-3 leading-relaxed max-w-[62ch]">
            Clears XP, brass, badges, the run, quests, the codex and everything bought,
            and counts from today. Your calendar, goals, routines and day marks are
            untouched.
          </p>
        </div>
        {confirming ? (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setConfirming(false)}
              className="btn-quiet text-body-sm px-3 h-8"
            >
              Keep it
            </button>
            <button
              onClick={() => {
                setConfirming(false);
                onReset();
              }}
              className="text-body-sm px-3 h-8 font-semibold"
              style={{ background: 'var(--bad)', color: 'var(--action-ink)' }}
            >
              Erase my standing
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirming(true)} className="btn-quiet text-body-sm px-3 h-8">
            Reset standing
          </button>
        )}
      </div>
    </section>
  );
}

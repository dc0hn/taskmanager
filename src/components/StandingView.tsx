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
import ChainBoard from './ChainBoard';
import type { ChainStatus } from '../chains';
import { seasonName, type SeasonRecord } from '../seasons';
import {
  commissionRecord,
  openCommissions,
  payoutFor,
  stakedTotal,
  type Commission,
} from '../commissions';
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
  onToggleActive: (itemId: string, on: boolean) => void;
  onUseItem: (itemId: string) => void;
  previousWeekKey: string;
  codex: InsightStatus[];
  onReadInsight: (id: string) => void;
  insightWindowDays: number;
  quests: Quest[];
  chains: ChainStatus[];
  /** The season in progress, reckoned live. */
  season: SeasonRecord;
  /** This week's sealed character, or null on weeks that predate them. */
  character: { name: string; blurb: string } | null;
  sealedSeasons: SeasonRecord[];
  /** How far through the season today is, 0..1. */
  seasonFraction: number;
  commissions: Commission[];
  onOpenYearPage: () => void;
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
  onToggleActive,
  onUseItem,
  previousWeekKey,
  codex,
  onReadInsight,
  insightWindowDays,
  quests,
  chains,
  season,
  character,
  sealedSeasons,
  seasonFraction,
  commissions,
  onOpenYearPage,
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

        {/*
          The week's character.

          A card rather than a fold: it is one line of fact about the seven days you are
          in, and burying it behind a disclosure would make it look like a setting. No
          motion beyond the panel's own entrance — an almanac forecasts, and weather does
          not announce itself.
        */}
        {character && (
          <>
            <div className="rule-h" />
            <div className="py-3">
              <div className="legend mb-1">This week</div>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span
                  className="font-display"
                  style={{ fontSize: 21, color: 'var(--bone-0)', lineHeight: 1.15 }}
                >
                  {character.name}
                </span>
                <span className="text-body-sm text-bone-3 max-w-[52ch] leading-relaxed">
                  {character.blurb}
                </span>
              </div>
            </div>
          </>
        )}

        {/*
          The season, and the year it belongs to.

          Placed above chains rather than below because it is the widest horizon on the
          screen and reads as the frame the rest sits inside.
        */}
        <Foldable
          id="season"
          title={seasonName(season.season)}
          summary={`${Math.round(seasonFraction * 100)}% elapsed · ${season.daysKept} days kept`}
        >
          <SeasonPanel
            season={season}
            sealed={sealedSeasons}
            fraction={seasonFraction}
            onOpenYearPage={onOpenYearPage}
          />
        </Foldable>

        <div className="rule-h" />

        {/* Between the weekly board and the hundred-day run, which had nothing in it. */}
        <Foldable
          id="chains"
          title="Chains"
          summary={`${chains.filter((c) => c.finished).length} of ${chains.length} complete`}
        >
          <ChainBoard statuses={chains} />
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
          <CommissionPanel commissions={commissions} />
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
            onToggleActive={onToggleActive}
            onUseItem={onUseItem}
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


/**
 * The season, its sealed predecessors, and the way out to the year page.
 *
 * A season is not a target and deliberately has no meter of "how well you are doing" — the
 * elapsed bar measures TIME, not performance, because the one thing a quarter-length frame
 * should not do is make three weeks in feel like failure.
 */
function SeasonPanel({
  season,
  sealed,
  fraction,
  onOpenYearPage,
}: {
  season: SeasonRecord;
  sealed: SeasonRecord[];
  fraction: number;
  onOpenYearPage: () => void;
}) {
  const hours = (m: number) => Math.round(m / 60).toLocaleString();

  return (
    <div>
      <p className="text-body-sm text-bone-3 mb-3 max-w-[64ch] leading-relaxed">
        A quarter of the year, sealed when it ends. Sealing records what was true and changes
        nothing else — your standing, your run and your brass all carry straight over.
      </p>

      <div className="mb-1">
        <PixelMeter value={fraction} segments={26} height={7} gap={1} cursor={false} title={`${Math.round(fraction * 100)}% of the season elapsed`} />
      </div>
      <div className="font-mono text-nano tnum text-bone-4 mb-4">
        {season.from} → {season.to} · {Math.round(fraction * 100)}% elapsed
      </div>

      <div className="grid gap-2 sm:grid-cols-4 mb-4">
        {[
          { label: 'DAYS KEPT', value: season.daysKept.toLocaleString() },
          { label: 'CLEARED', value: season.daysCleared.toLocaleString() },
          { label: 'BEST RUN', value: season.bestRun.toLocaleString() },
          { label: 'HOURS DEEP', value: hours(season.focusMinutes) },
        ].map((f) => (
          <div key={f.label}>
            <div className="font-mono tnum" style={{ fontSize: 19, color: 'var(--bone-0)' }}>
              {f.value}
            </div>
            <div className="font-mono text-nano text-bone-4 tracking-wide">{f.label}</div>
          </div>
        ))}
      </div>

      {sealed.length > 0 && (
        <div className="mb-4">
          <div className="legend mb-1.5">Sealed</div>
          <div className="grid gap-1">
            {sealed.map((s) => (
              <div
                key={s.season}
                className="flex items-baseline justify-between gap-3 px-2.5 py-1.5"
                style={{ background: 'var(--chassis-1)', border: '1px solid var(--rule-1)' }}
              >
                <span className="font-mono text-nano text-bone-2">{seasonName(s.season)}</span>
                <span className="font-mono text-nano tnum text-bone-3">
                  {s.rank} · {s.daysKept} kept · {hours(s.focusMinutes)}h deep
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <button onClick={onOpenYearPage} className="btn-quiet text-body-sm px-3 h-8">
        Open the year page
      </button>
    </div>
  );
}

/**
 * Brass currently at risk.
 *
 * Read-only on purpose. A commission is placed against a specific block on a specific day,
 * so it is placed where that block is — in the edit modal — rather than from a list here,
 * which would need its own block picker and would let you stake on something you were not
 * looking at.
 */
function CommissionPanel({ commissions }: { commissions: Commission[] }) {
  const open = openCommissions(commissions);
  const record = commissionRecord(commissions);
  if (open.length === 0 && record.kept === 0 && record.forfeited === 0) return null;

  return (
    <div
      className="px-3 py-2.5 mb-1"
      style={{ background: 'var(--chassis-2)', border: '1px solid var(--rule-2)' }}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
        <span className="legend">Commissioned</span>
        <span className="font-mono text-nano tnum text-bone-3">
          {stakedTotal(commissions).toLocaleString()} at risk · {record.kept} kept,{' '}
          {record.forfeited} lapsed · net {record.net >= 0 ? '+' : ''}
          {record.net.toLocaleString()}
        </span>
      </div>
      {open.length === 0 ? (
        <div className="font-mono text-nano text-bone-4">
          Nothing staked. Open a future entry to promise one.
        </div>
      ) : (
        <div className="grid gap-1">
          {open.map((c) => (
            <div key={c.id} className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-nano text-bone-2 truncate">
                {c.date} · {c.title}
              </span>
              <span className="font-mono text-nano tnum shrink-0" style={{ color: 'var(--signal)' }}>
                {c.stake.toLocaleString()} → {payoutFor(c.stake).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

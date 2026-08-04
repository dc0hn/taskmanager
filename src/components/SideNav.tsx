import { memo } from 'react';
import {
  CalendarDays,
  Clock3,
  Gauge,
  LayoutGrid,
  Microscope,
  Repeat,
  Tag,
  Target,
  TrendingUp,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { CategoryDef, Settings } from '../types';
import { colorsFor } from '../utils/color';
import { formatDuration, minutesTo24h } from '../utils/time';
import MiniMonth from './MiniMonth';
import PixelMeter from './pixel/PixelMeter';
import Sigil from './pixel/Sigil';
import { BackupButton } from './BackupModal';

// ============================================================================
// SideNav
//
// The primary navigation. The traffic lights sit on top of this rail (the Tauri
// window uses an overlay titlebar), which is why the top has a drag region and
// extra padding.
// ============================================================================

export type NavKey =
  | 'calendar'
  | 'goals'
  | 'routines'
  | 'standing'
  | 'months'
  | 'study'
  | 'categories';

interface Props {
  nav: NavKey;
  onNav: (key: NavKey) => void;
  cursor: string;
  selected: string;
  busyDates: Set<string>;
  onSelectDate: (date: string) => void;
  onCursorChange: (date: string) => void;
  categories: CategoryDef[];
  /** Minutes completed and planned per category, for the legend meters. */
  categoryTime: Record<string, { done: number; planned: number }>;
  settings: Settings;
  onOpenHours: () => void;
  onOpenBackup: () => void;
  /** Counts shown as badges on the nav rows. */
  badges: { goals: number; routines: number; carryover: number };
  /** Lifetime standing, shown under the colophon. */
  standing: { level: number; rank: string; progress: number; sigilForm: number; sigilPips: number };
  brass: number;
  /** Current day-streak, counting today if today already qualifies. */
  run: number;
  /** This week's character, when one is sealed. Weather, not an achievement. */
  character?: { name: string; blurb: string } | null;
  freezes: number;
  sfxOn: boolean;
  onToggleSfx: () => void;
}

const NAV_ITEMS: { key: NavKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'goals', label: 'Weekly goals', icon: Target },
  { key: 'routines', label: 'Routines', icon: Repeat },
  { key: 'standing', label: 'Standing', icon: TrendingUp },
  { key: 'months', label: 'The record', icon: Gauge },
  { key: 'study', label: 'The study', icon: Microscope },
  { key: 'categories', label: 'Categories', icon: Tag },
];

function SideNav({
  nav,
  onNav,
  cursor,
  selected,
  busyDates,
  onSelectDate,
  onCursorChange,
  categories,
  categoryTime,
  settings,
  onOpenHours,
  onOpenBackup,
  badges,
  standing,
  brass,
  run,
  character = null,
  freezes,
  sfxOn,
  onToggleSfx,
}: Props) {
  return (
    <aside className="rail w-[248px] shrink-0 flex flex-col h-full">
      {/* Room for the macOS traffic lights, and a drag handle for the window. */}
      <div className="titlebar-drag" />

      {/* Typographic mark, not an icon in a gradient chip. A serif A with an
          amber rule under it — a colophon. Distinctive at 24px, and it costs no
          asset. */}
      <div className="px-4 pb-5 pt-2">
        <div className="flex items-end gap-2">
          <span
            className="font-display text-bone-0 leading-none select-none"
            style={{ fontSize: '30px' }}
            aria-hidden
          >
            A
          </span>
          <div className="min-w-0 pb-[3px]">
            <div className="font-display text-title text-bone-0 leading-none">
              Almanac
            </div>
            <div className="legend mt-1">Local · Offline</div>
          </div>
        </div>

        {/* The amber rule becomes the level meter. It was already the colophon's
            underline, so standing reads as part of the masthead rather than as a
            widget bolted beneath it. */}
        <button
          onClick={() => onNav('standing')}
          className="mt-3 w-full text-left group"
          title={`Level ${standing.level} · ${standing.rank}`}
        >
          <PixelMeter
            value={standing.progress}
            segments={14}
            height={3}
            gap={1}
            cursor={false}
          />
          <div className="flex items-center gap-1.5 mt-1.5">
            <Sigil form={standing.sigilForm} pips={standing.sigilPips} size={11} shadow={false} />
            <span
              className="font-mono tnum"
              style={{ fontSize: 9.5, letterSpacing: '0.1em', color: 'var(--bone-3)' }}
            >
              L{standing.level} {standing.rank.toUpperCase()}
            </span>
            <span className="flex-1" />
            <span
              style={{
                display: 'inline-block',
                width: 5,
                height: 5,
                background: 'var(--signal)',
                // A drawn diamond rather than a rotated square. A rotated square's ink
              // sits ~21% outside its layout box on every side, so any ancestor
              // that clips — a collapsing panel, a scroll container — slices its
              // points flat. `clip-path` keeps the same shape strictly inside.
              clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
              }}
              aria-hidden
            />
            <span
              className="font-mono tnum"
              style={{ fontSize: 9.5, color: 'var(--bone-3)' }}
            >
              {brass}
            </span>
          </div>

          {/* The run sits under the level rather than beside it: they are different
              kinds of fact and crowding them onto one line made both harder to read. */}
          <div className="flex items-center gap-1.5 mt-1">
            {/* A pixel chevron stack, not a flame — this app does not do flames. */}
            <span className="flex flex-col gap-[1px]" aria-hidden>
              {[3, 5, 7].map((w) => (
                <span
                  key={w}
                  style={{
                    display: 'block',
                    width: w,
                    height: 1.5,
                    background: run > 0 ? 'var(--signal)' : 'var(--bone-5)',
                  }}
                />
              ))}
            </span>
            <span
              className="font-mono tnum"
              style={{
                fontSize: 9.5,
                letterSpacing: '0.1em',
                color: run > 0 ? 'var(--bone-2)' : 'var(--bone-4)',
              }}
            >
              {run}D RUN
            </span>
            <span className="flex-1" />
            {freezes > 0 && (
              <span
                className="font-mono tnum"
                style={{ fontSize: 9.5, color: 'var(--bone-3)' }}
                title={`${freezes} streak freeze${freezes === 1 ? '' : 's'} in hand`}
              >
                ❄{freezes}
              </span>
            )}
          </div>

          {/*
            The week's character, stated once and quietly.

            An almanac forecasts, so this reads as weather rather than as an achievement —
            no takeover on a Monday, no colour, no motion. The blurb is the title attribute
            because the name is the part you check at a glance and the rule is the part you
            look up.
          */}
          {character && (
            <div
              className="font-mono truncate"
              style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--bone-4)' }}
              title={character.blurb}
            >
              THIS WEEK — {character.name.toUpperCase()}
            </div>
          )}
        </button>
      </div>

      <nav className="px-2 space-y-0.5">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => {
          const active = nav === key;
          const badge =
            key === 'goals'
              ? badges.goals
              : key === 'routines'
                ? badges.routines
                : 0;
          return (
            <button
              key={key}
              onClick={() => onNav(key)}
              aria-current={active ? 'page' : undefined}
              className={`w-full flex items-center gap-2.5 px-2.5 py-[7px] rounded text-body-sm transition-colors ${
                active
                  ? 'bg-paper-4 text-ink-0 font-semibold'
                  : 'text-ink-2 hover:text-ink-0 hover:bg-paper-3 font-medium'
              }`}
            >
              <Icon size={15} strokeWidth={active ? 2.1 : 1.8} className="shrink-0" />
              <span className="flex-1 text-left truncate">{label}</span>
              {badge > 0 && (
                <span
                  className="font-mono text-nano tnum px-1.5 py-[1px] rounded-full shrink-0"
                  style={{
                    background: 'var(--signal-dim)',
                    color: 'var(--bone-0)',
                    border: '1px solid var(--signal-line)',
                  }}
                >
                  {badge}
                </span>
              )}
              {key === 'goals' && badges.carryover > 0 && (
                <span
                  className="font-mono text-nano tnum px-1.5 py-[1px] rounded-full shrink-0"
                  style={{
                    background: 'var(--signal-dim)',
                    color: 'var(--signal)',
                    border: '1px solid rgba(255, 176, 31,0.42)',
                  }}
                  title={`${badges.carryover} carried over`}
                >
                  {badges.carryover}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mx-4 my-3 rule-h" />

      <div className="px-4">
        <MiniMonth
          cursor={cursor}
          selected={selected}
          busyDates={busyDates}
          onSelect={onSelectDate}
          onCursorChange={onCursorChange}
        />
      </div>

      <div className="mx-4 my-3 rule-h" />

      {/* Category legend, doubling as a where-the-time-went meter. Bars show
          completed against planned for whatever range the caller passed in. */}
      <div className="px-4 flex-1 min-h-0 overflow-y-auto thin-scroll">
        <div className="legend mb-3">Categories</div>
        <div className="space-y-2.5 pb-3">
          {[...categories]
            .sort((a, b) => a.order - b.order)
            .map((cat) => {
              const c = colorsFor(cat.accent);
              const time = categoryTime[cat.id] ?? { done: 0, planned: 0 };
              const pct = time.planned > 0 ? (time.done / time.planned) * 100 : 0;
              return (
                <div key={cat.id}>
                  <div className="flex items-center gap-2 mb-1">
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: cat.accent }}
                    />
                    <span className="text-body-sm text-ink-2 flex-1 truncate">
                      {cat.label}
                    </span>
                    <span className="font-mono text-nano text-bone-3 tnum shrink-0">
                      {time.planned > 0 ? formatDuration(time.planned) : '—'}
                    </span>
                  </div>
                  <div
                    className="h-[3px] rounded-full overflow-hidden ml-4"
                    style={{ background: 'rgba(245, 242, 236,0.06)' }}
                  >
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${pct}%`, background: c.accent }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      <div className="mx-4 rule-h" />

      <div className="m-3 space-y-0.5">
        <button
          onClick={onOpenHours}
          className="flex items-center gap-2 px-2.5 py-2 rounded text-ink-2 hover:text-ink-0 hover:bg-paper-3 transition-colors w-full"
        >
          <Clock3 size={14} strokeWidth={1.8} className="shrink-0" />
          <span className="text-body-sm">Working hours</span>
          <span className="font-mono text-micro tnum text-ink-3 ml-auto">
            {minutesTo24h(settings.workingStart)}–{minutesTo24h(settings.workingEnd)}
          </span>
        </button>
        <button
          onClick={onToggleSfx}
          className="flex items-center gap-2 px-2.5 py-2 rounded text-ink-2 hover:text-ink-0 hover:bg-paper-3 transition-colors w-full"
          title={
            sfxOn
              ? 'Turn off the completion and level-up sounds'
              : 'Chiptune blips on completion, level-up and prestige. Synthesised on the fly — no audio files.'
          }
        >
          {sfxOn ? (
            <Volume2 size={14} strokeWidth={1.8} className="shrink-0" />
          ) : (
            <VolumeX size={14} strokeWidth={1.8} className="shrink-0" />
          )}
          <span className="text-body-sm">Sound</span>
          <span
            className="font-mono text-micro tnum ml-auto"
            style={{ color: sfxOn ? 'var(--signal)' : 'var(--bone-3)' }}
          >
            {sfxOn ? 'on' : 'off'}
          </span>
        </button>
        <BackupButton onClick={onOpenBackup} />
      </div>
    </aside>
  );
}

export default memo(SideNav);

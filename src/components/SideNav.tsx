import { memo } from 'react';
import {
  CalendarDays,
  Clock3,
  Gauge,
  LayoutGrid,
  Repeat,
  Tag,
  Target,
} from 'lucide-react';
import type { CategoryDef, Settings } from '../types';
import { colorsFor } from '../utils/color';
import { formatDuration, minutesTo24h } from '../utils/time';
import MiniMonth from './MiniMonth';
import { BackupButton } from './BackupModal';

// ============================================================================
// SideNav
//
// The primary navigation. The traffic lights sit on top of this rail (the Tauri
// window uses an overlay titlebar), which is why the top has a drag region and
// extra padding.
// ============================================================================

export type NavKey = 'calendar' | 'goals' | 'routines' | 'months' | 'categories';

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
}

const NAV_ITEMS: { key: NavKey; label: string; icon: typeof LayoutGrid }[] = [
  { key: 'calendar', label: 'Calendar', icon: CalendarDays },
  { key: 'goals', label: 'Weekly goals', icon: Target },
  { key: 'routines', label: 'Routines', icon: Repeat },
  { key: 'months', label: 'The record', icon: Gauge },
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
        <div
          className="mt-3 h-[2px] w-8"
          style={{ background: 'var(--signal)' }}
          aria-hidden
        />
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
        <BackupButton onClick={onOpenBackup} />
      </div>
    </aside>
  );
}

export default memo(SideNav);

import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, CalendarDays, Clock3, CopyPlus } from 'lucide-react';
import type { Settings } from '../types';
import { addDays, fromDateKey, minutesTo24h, parse24h, toDateKey } from '../utils/time';

interface Props {
  date: string;
  onChangeDate: (d: string) => void;
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onCopyYesterday: () => void;
}

function dayOfYear(d: Date): number {
  const start = new Date(d.getFullYear(), 0, 0);
  const diff = d.getTime() - start.getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

export default function Header({
  date,
  onChangeDate,
  settings,
  onChangeSettings,
  onCopyYesterday,
}: Props) {
  const [hoursOpen, setHoursOpen] = useState(false);
  const [start, setStart] = useState(minutesTo24h(settings.workingStart));
  const [end, setEnd] = useState(minutesTo24h(settings.workingEnd));

  useEffect(() => {
    setStart(minutesTo24h(settings.workingStart));
    setEnd(minutesTo24h(settings.workingEnd));
  }, [settings.workingStart, settings.workingEnd]);

  const today = toDateKey(new Date());
  const dObj = fromDateKey(date);
  const weekday = dObj.toLocaleDateString(undefined, { weekday: 'long' });
  const monthDay = dObj.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  const year = dObj.getFullYear();
  const doy = dayOfYear(dObj);

  function applyHours() {
    const s = parse24h(start);
    const e = parse24h(end);
    if (s == null || e == null || e <= s) return;
    onChangeSettings({ workingStart: s, workingEnd: e });
    setHoursOpen(false);
  }

  return (
    <header className="relative">
      {/* Eyebrow row: brand + actions */}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 text-ink-3">
          <span className="smallcaps text-[12px] text-ink-1">The Almanac</span>
          <span className="text-ink-3" aria-hidden>·</span>
          <span className="font-mono text-[11px] tracking-wider tnum text-ink-3">
            Vol. I — No. {String(doy).padStart(3, '0')}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onCopyYesterday}
            className="group inline-flex items-center gap-1.5 smallcaps text-[11px] text-ink-2 hover:text-ink-0 hover:bg-paper-3 px-2.5 py-1.5 rounded-md transition-colors"
            title="Copy yesterday's plan into today"
          >
            <CopyPlus size={13} className="opacity-80 group-hover:opacity-100 transition-opacity" />
            Copy yesterday
          </button>
          <div className="relative">
            <button
              onClick={() => setHoursOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 smallcaps text-[11px] text-ink-2 hover:text-ink-0 hover:bg-paper-3 px-2.5 py-1.5 rounded-md transition-colors"
              aria-expanded={hoursOpen}
            >
              <Clock3 size={13} className="opacity-80" />
              <span className="tnum font-mono normal-case tracking-wider text-[11px]">
                {minutesTo24h(settings.workingStart)}–{minutesTo24h(settings.workingEnd)}
              </span>
            </button>
            <AnimatePresence>
              {hoursOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: [0.2, 0.8, 0.2, 1] }}
                  className="absolute right-0 top-full mt-2 z-40 paper-card rounded-xl3 p-4 w-72"
                >
                  <p className="smallcaps text-[11px] text-ink-3 mb-2.5">
                    Working hours
                  </p>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1">
                        Start
                      </label>
                      <input
                        type="time"
                        value={start}
                        onChange={(e) => setStart(e.target.value)}
                        className="w-full font-mono text-[13px] bg-paper-4 rounded-md border border-rule-3 px-2 py-2 tnum focus:outline-none focus:focus-ring"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1">
                        End
                      </label>
                      <input
                        type="time"
                        value={end}
                        onChange={(e) => setEnd(e.target.value)}
                        className="w-full font-mono text-[13px] bg-paper-4 rounded-md border border-rule-3 px-2 py-2 tnum focus:outline-none focus:focus-ring"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-2 mt-3.5">
                    <button
                      onClick={() => setHoursOpen(false)}
                      className="text-[12px] font-medium text-ink-3 hover:text-ink-1 hover:bg-paper-3 px-2.5 py-1.5 rounded-md transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={applyHours}
                      className="text-[12px] font-semibold text-paper-4 bg-ink-1 hover:bg-ink-0 px-3 py-1.5 rounded-md transition-colors"
                    >
                      Save
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      <div className="rule-h" />

      {/* Masthead row */}
      <div className="flex items-end justify-between gap-6 pt-3 pb-3">
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={date}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <h1
                className="font-display text-ink-0 leading-[1.0] tracking-masthead"
                style={{
                  fontSize: 'clamp(1.85rem, 4.2vw, 3.2rem)',
                  fontWeight: 400,
                  fontVariationSettings: '"opsz" 144, "SOFT" 50, "WONK" 1',
                }}
              >
                <span className="italic" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80, "WONK" 1' }}>
                  {weekday}
                </span>
                <span className="text-ink-3 font-light">, </span>
                <span style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50, "WONK" 0' }}>
                  {monthDay}
                </span>
              </h1>
              <p className="mt-1 font-mono text-[11px] text-ink-3 tracking-wider tnum">
                {year} · day {String(doy).padStart(3, '0')} of 365
              </p>
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <NavBtn onClick={() => onChangeDate(addDays(date, -1))} ariaLabel="Previous day">
            <ChevronLeft size={18} strokeWidth={1.6} />
          </NavBtn>
          <button
            onClick={() => onChangeDate(today)}
            className={`smallcaps text-[12px] px-3.5 py-2 rounded-md transition-colors border min-h-[36px] ${
              date === today
                ? 'bg-ink-1 text-paper-4 border-ink-1 hover:bg-ink-0'
                : 'text-ink-2 hover:text-ink-0 border-rule-3 hover:bg-paper-3'
            }`}
          >
            Today
          </button>
          <NavBtn onClick={() => onChangeDate(addDays(date, 1))} ariaLabel="Next day">
            <ChevronRight size={18} strokeWidth={1.6} />
          </NavBtn>
          <label className="ml-1 inline-flex items-center gap-1.5 text-ink-2 hover:text-ink-0 px-2.5 py-2 rounded-md border border-rule-3 hover:bg-paper-3 cursor-pointer transition-colors min-h-[36px]">
            <CalendarDays size={15} strokeWidth={1.6} />
            <input
              type="date"
              value={date}
              onChange={(e) => onChangeDate(e.target.value)}
              className="bg-transparent text-[12px] font-mono tnum outline-none w-[110px]"
            />
          </label>
        </div>
      </div>

      <div className="rule-h-dotted" />
    </header>
  );
}

function NavBtn({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className="p-2 rounded-md text-ink-2 hover:text-ink-0 hover:bg-paper-3 transition-colors border border-rule-3 min-w-[36px] min-h-[36px] grid place-items-center"
    >
      {children}
    </button>
  );
}

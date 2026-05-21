import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, CalendarDays, Clock3, CopyPlus, Sparkles } from 'lucide-react';
import type { Settings } from '../types';
import { addDays, formatLongDate, minutesTo24h, parse24h, toDateKey } from '../utils/time';

interface Props {
  date: string;
  onChangeDate: (d: string) => void;
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onCopyYesterday: () => void;
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

  function applyHours() {
    const s = parse24h(start);
    const e = parse24h(end);
    if (s == null || e == null || e <= s) return;
    onChangeSettings({ workingStart: s, workingEnd: e });
    setHoursOpen(false);
  }

  return (
    <header className="relative flex items-center justify-between gap-4 px-5 py-3.5 bg-bg-1/80 glass shadow-soft rounded-xl3 border border-line-1 overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-60 bg-grid-fade" />
      <div className="relative flex items-center gap-3 min-w-0">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.2, 0.8, 0.2, 1] }}
          className="relative w-9 h-9 rounded-xl bg-gradient-to-br from-cat-deep to-cat-admin grid place-items-center text-white shadow-glow"
        >
          <Sparkles size={16} className="drop-shadow" />
          <span className="absolute inset-0 rounded-xl ring-1 ring-white/10" />
        </motion.div>
        <div className="min-w-0">
          <h1 className="text-[15px] font-semibold tracking-tight text-fg-0 leading-tight">
            Day Planner
          </h1>
          <motion.p
            key={date}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="text-xs text-fg-3 leading-tight tracking-wide"
          >
            {formatLongDate(date)}
          </motion.p>
        </div>
      </div>

      <div className="relative flex items-center gap-1.5 bg-bg-2/60 rounded-xl2 px-1.5 py-1 border border-line-1">
        <IconBtn onClick={() => onChangeDate(addDays(date, -1))} ariaLabel="Previous day">
          <ChevronLeft size={15} />
        </IconBtn>
        <button
          onClick={() => onChangeDate(today)}
          className={`text-xs font-medium tracking-wide px-2.5 py-1.5 rounded-lg transition-colors ${
            date === today
              ? 'bg-white/10 text-fg-0'
              : 'text-fg-2 hover:text-fg-0 hover:bg-white/5'
          }`}
        >
          Today
        </button>
        <IconBtn onClick={() => onChangeDate(addDays(date, 1))} ariaLabel="Next day">
          <ChevronRight size={15} />
        </IconBtn>
        <span className="w-px h-5 bg-line-2 mx-1" />
        <label className="inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg-0 px-1.5 py-1 rounded-lg hover:bg-white/5 cursor-pointer transition-colors">
          <CalendarDays size={13} />
          <input
            type="date"
            value={date}
            onChange={(e) => onChangeDate(e.target.value)}
            className="bg-transparent text-xs tnum outline-none w-[110px]"
          />
        </label>
      </div>

      <div className="relative flex items-center gap-1.5">
        <button
          onClick={onCopyYesterday}
          className="group inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg-0 px-3 py-1.5 rounded-xl2 border border-line-1 bg-bg-2/60 hover:bg-white/5 transition-all"
          title="Copy yesterday's plan into today"
        >
          <CopyPlus size={13} className="group-hover:scale-110 transition-transform" />
          Copy yesterday
        </button>
        <div className="relative">
          <button
            onClick={() => setHoursOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-fg-2 hover:text-fg-0 px-3 py-1.5 rounded-xl2 border border-line-1 bg-bg-2/60 hover:bg-white/5 tnum transition-all"
          >
            <Clock3 size={13} />
            {minutesTo24h(settings.workingStart)}–{minutesTo24h(settings.workingEnd)}
          </button>
          <AnimatePresence>
            {hoursOpen && (
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                className="absolute right-0 top-full mt-2 z-40 bg-bg-2 shadow-lift rounded-xl2 p-3.5 w-72 border border-line-2"
              >
                <p className="text-[11px] uppercase tracking-wider text-fg-4 mb-2.5">
                  Working hours
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[11px] text-fg-4 block mb-1">Start</label>
                    <input
                      type="time"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                      className="w-full text-sm bg-bg-1 rounded-lg border border-line-2 px-2 py-1.5 tnum focus:outline-none focus:focus-ring"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-fg-4 block mb-1">End</label>
                    <input
                      type="time"
                      value={end}
                      onChange={(e) => setEnd(e.target.value)}
                      className="w-full text-sm bg-bg-1 rounded-lg border border-line-2 px-2 py-1.5 tnum focus:outline-none focus:focus-ring"
                    />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-3">
                  <button
                    onClick={() => setHoursOpen(false)}
                    className="text-xs text-fg-3 hover:text-fg-1 px-2.5 py-1.5 rounded-lg hover:bg-white/5"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={applyHours}
                    className="text-xs font-medium text-white bg-gradient-to-r from-cat-deep to-violet-500 hover:brightness-110 px-3 py-1.5 rounded-lg shadow-glow"
                  >
                    Save
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </header>
  );
}

function IconBtn({
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
      className="p-1.5 rounded-lg text-fg-2 hover:text-fg-0 hover:bg-white/5 transition-colors"
    >
      {children}
    </button>
  );
}

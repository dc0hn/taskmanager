import { memo, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ClipboardCopy, X } from 'lucide-react';
import type { DailyStat, DayMarkDef, DayMarks } from '../types';
import type { SeasonRecord } from '../seasons';
import { seasonName } from '../seasons';
import { standingFor } from '../progress';
import { useModalMotion } from '../utils/motion';

// ============================================================================
// YearPage — the thing an almanac is actually for
//
// Every other surface in this app is for deciding what to do next. This one is for looking
// back at a year that is over, and it is the only screen here a person would show someone
// else.
//
// Built entirely from records already kept: day stats for the rings and the grid, day marks
// for the travel and gig days, the sealed seasons for the four quarters, and lifetime XP for
// the rank. Nothing new is stored to make this page exist, which is the whole reason it can
// be generated for any year after the fact.
//
// Rendered as ONE SVG rather than as DOM. Three reasons, in order of how much they matter:
// it can be copied out and kept as a file that will still open in twenty years; it prints
// without a stylesheet; and it forces the layout to be geometric rather than responsive,
// which is what makes it read as an artifact instead of a dashboard.
// ============================================================================

const W = 820;
const H = 1120;

/** The twelve month rings, laid out in a 4×3 grid. */
const RING_COLS = 4;
const RING_R = 52;
const RING_GAP_X = 190;
const RING_GAP_Y = 176;
const RINGS_TOP = 300;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface Props {
  open: boolean;
  year: number;
  stats: Record<string, DailyStat>;
  marks: DayMarks;
  markDefs: DayMarkDef[];
  seasons: SeasonRecord[];
  totalXp: number;
  onClose: () => void;
  onNotify: (message: string) => void;
}

interface MonthSummary {
  index: number;
  planned: number;
  done: number;
  cleared: number;
  days: number;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** Ring arc path for a fraction of a circle, starting at twelve o'clock. */
function arc(cx: number, cy: number, r: number, fraction: number): string {
  const f = Math.max(0, Math.min(0.9999, fraction));
  if (f <= 0) return '';
  const angle = f * Math.PI * 2 - Math.PI / 2;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  const large = f > 0.5 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x.toFixed(2)} ${y.toFixed(2)}`;
}

function YearPage({
  open,
  year,
  stats,
  marks,
  markDefs,
  seasons,
  totalXp,
  onClose,
  onNotify,
}: Props) {
  const m = useModalMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const [copied, setCopied] = useState(false);

  const months = useMemo<MonthSummary[]>(() => {
    const out: MonthSummary[] = MONTHS.map((_, index) => ({
      index,
      planned: 0,
      done: 0,
      cleared: 0,
      days: 0,
    }));
    for (const [date, s] of Object.entries(stats)) {
      if (Number(date.slice(0, 4)) !== year) continue;
      const mi = Number(date.slice(5, 7)) - 1;
      if (mi < 0 || mi > 11) continue;
      const row = out[mi];
      row.planned += s.plannedMinutes;
      row.done += s.doneMinutes;
      if (s.cleared) row.cleared += 1;
      if (s.plannedMinutes > 0) row.days += 1;
    }
    return out;
  }, [stats, year]);

  const totals = useMemo(() => {
    const done = months.reduce((sum, x) => sum + x.done, 0);
    const planned = months.reduce((sum, x) => sum + x.planned, 0);
    const cleared = months.reduce((sum, x) => sum + x.cleared, 0);
    const days = months.reduce((sum, x) => sum + x.days, 0);
    const bestRun = Math.max(0, ...seasons.map((s) => s.bestRun));
    const focus = seasons.reduce((sum, s) => sum + s.focusMinutes, 0);
    return { done, planned, cleared, days, bestRun, focus };
  }, [months, seasons]);

  const markTotals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const [date, id] of Object.entries(marks)) {
      if (Number(date.slice(0, 4)) !== year) continue;
      out[id] = (out[id] ?? 0) + 1;
    }
    return out;
  }, [marks, year]);

  const standing = standingFor(totalXp);

  async function copySvg() {
    const node = svgRef.current;
    if (!node) return;
    try {
      // Serialised with an explicit xmlns so the copied text is a standalone file rather
      // than a fragment that only renders inside a page.
      const clone = node.cloneNode(true) as SVGSVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      await navigator.clipboard.writeText(clone.outerHTML);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      onNotify('Copying was blocked. Take a screenshot of the page instead.');
    }
  }

  const hours = (minutes: number) => Math.round(minutes / 60).toLocaleString();

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-start justify-center p-4 overflow-auto thin-scroll">
          <motion.div
            className="fixed inset-0"
            style={{ background: 'rgba(8, 8, 7, 0.86)' }}
            onClick={onClose}
            {...m.overlay}
          />
          <motion.div {...m.card} className="relative my-6">
            <div className="flex items-center justify-between mb-3 gap-4">
              <span className="legend">The year page</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={copySvg}
                  className="btn-quiet inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-lg"
                  title="Copy this page as an SVG file you can keep or print"
                >
                  {copied ? <Check size={13} strokeWidth={2.6} /> : <ClipboardCopy size={13} strokeWidth={2.2} />}
                  {copied ? 'Copied' : 'Copy as SVG'}
                </button>
                <button
                  onClick={onClose}
                  aria-label="Close"
                  className="grid place-items-center w-7 h-7 rounded-lg text-ink-3 hover:text-ink-0 hover:bg-paper-4 transition-colors"
                >
                  <X size={15} strokeWidth={2} />
                </button>
              </div>
            </div>

            <svg
              ref={svgRef}
              viewBox={`0 0 ${W} ${H}`}
              width={W}
              height={H}
              style={{ maxWidth: '100%', height: 'auto', display: 'block' }}
              role="img"
              aria-label={`Almanac year page for ${year}`}
            >
              {/*
                Every colour is literal rather than a CSS variable. The whole point of this
                page is that it survives being copied out of the app, and a var() reference
                resolves to nothing in a file.
              */}
              <rect width={W} height={H} fill="#0b0d12" />
              <rect x="16" y="16" width={W - 32} height={H - 32} fill="none" stroke="#2a2f3a" />

              {/* ---- head ---- */}
              <text x={W / 2} y="92" textAnchor="middle" fill="#f5f2ec" fontSize="60" fontFamily="Georgia, serif">
                {year}
              </text>
              <text
                x={W / 2}
                y="124"
                textAnchor="middle"
                fill="#8b93a7"
                fontSize="11"
                letterSpacing="4"
                fontFamily="ui-monospace, monospace"
              >
                ALMANAC · THE YEAR IN RECORD
              </text>
              <line x1="60" y1="150" x2={W - 60} y2="150" stroke="#2a2f3a" />

              {/* ---- the standing reached ---- */}
              <text x={W / 2} y="196" textAnchor="middle" fill="#f5f2ec" fontSize="26" fontFamily="Georgia, serif">
                {standing.rank}
              </text>
              <text
                x={W / 2}
                y="218"
                textAnchor="middle"
                fill="#ff6b4a"
                fontSize="10.5"
                letterSpacing="2.5"
                fontFamily="ui-monospace, monospace"
              >
                {`LEVEL ${standing.level}${standing.prestige > 0 ? ` · CYCLE ${standing.prestige + 1}` : ''} · ${totalXp.toLocaleString()} XP`}
              </text>

              {/* ---- headline figures ---- */}
              {[
                { label: 'HOURS DONE', value: hours(totals.done) },
                { label: 'DAYS WORKED', value: totals.days.toLocaleString() },
                { label: 'DAYS CLEARED', value: totals.cleared.toLocaleString() },
                { label: 'LONGEST RUN', value: totals.bestRun.toLocaleString() },
              ].map((f, i) => {
                const x = 60 + i * ((W - 120) / 4) + (W - 120) / 8;
                return (
                  <g key={f.label}>
                    <text x={x} y="262" textAnchor="middle" fill="#f5f2ec" fontSize="25" fontFamily="ui-monospace, monospace">
                      {f.value}
                    </text>
                    <text x={x} y="278" textAnchor="middle" fill="#6b7488" fontSize="8" letterSpacing="1.6" fontFamily="ui-monospace, monospace">
                      {f.label}
                    </text>
                  </g>
                );
              })}

              {/* ---- twelve month rings ---- */}
              {months.map((month) => {
                const col = month.index % RING_COLS;
                const row = Math.floor(month.index / RING_COLS);
                const cx = 128 + col * RING_GAP_X;
                const cy = RINGS_TOP + row * RING_GAP_Y;
                const ratio = month.planned > 0 ? month.done / month.planned : 0;
                const inMonth = daysInMonth(year, month.index);

                return (
                  <g key={month.index}>
                    <circle cx={cx} cy={cy} r={RING_R} fill="none" stroke="#1b1f28" strokeWidth="9" />
                    {ratio > 0 && (
                      <path
                        d={arc(cx, cy, RING_R, Math.min(1, ratio))}
                        fill="none"
                        stroke="#3ecf8e"
                        strokeWidth="9"
                        strokeLinecap="butt"
                      />
                    )}
                    <text x={cx} y={cy + 2} textAnchor="middle" fill="#f5f2ec" fontSize="17" fontFamily="ui-monospace, monospace">
                      {hours(month.done)}
                    </text>
                    <text x={cx} y={cy + 16} textAnchor="middle" fill="#6b7488" fontSize="7.5" letterSpacing="1" fontFamily="ui-monospace, monospace">
                      HOURS
                    </text>
                    <text x={cx} y={cy + RING_R + 22} textAnchor="middle" fill="#8b93a7" fontSize="10.5" letterSpacing="2" fontFamily="ui-monospace, monospace">
                      {MONTHS[month.index].toUpperCase()}
                    </text>

                    {/* The month's days as a strip, so the shape of the month is legible
                        and not only its total. */}
                    {Array.from({ length: inMonth }, (_, di) => {
                      const date = `${year}-${String(month.index + 1).padStart(2, '0')}-${String(di + 1).padStart(2, '0')}`;
                      const s = stats[date];
                      const markId = marks[date];
                      const def = markDefs.find((x) => x.id === markId);
                      const score =
                        s && s.plannedMinutes > 0 ? Math.min(1, s.doneMinutes / s.plannedMinutes) : 0;
                      const w = 2.6;
                      const x = cx - (inMonth * w) / 2 + di * w;
                      return (
                        <rect
                          key={date}
                          x={x}
                          y={cy + RING_R + 30}
                          width={w - 0.6}
                          height={7}
                          fill={
                            def
                              ? def.color
                              : score >= 0.999
                                ? '#3ecf8e'
                                : score > 0
                                  ? '#2a6b52'
                                  : '#1b1f28'
                          }
                        />
                      );
                    })}
                  </g>
                );
              })}

              {/* ---- the four seasons ---- */}
              <line x1="60" y1={H - 214} x2={W - 60} y2={H - 214} stroke="#2a2f3a" />
              {seasons.slice(0, 4).map((s, i) => {
                const x = 60 + i * ((W - 120) / 4);
                const colW = (W - 120) / 4;
                return (
                  <g key={s.season}>
                    <text x={x + colW / 2} y={H - 186} textAnchor="middle" fill="#8b93a7" fontSize="8.5" letterSpacing="1.6" fontFamily="ui-monospace, monospace">
                      {seasonName(s.season).toUpperCase()}
                    </text>
                    <text x={x + colW / 2} y={H - 162} textAnchor="middle" fill="#f5f2ec" fontSize="15" fontFamily="Georgia, serif">
                      {s.rank}
                    </text>
                    <text x={x + colW / 2} y={H - 144} textAnchor="middle" fill="#6b7488" fontSize="9" fontFamily="ui-monospace, monospace">
                      {`${s.daysKept} kept · ${hours(s.focusMinutes)}h deep`}
                    </text>
                  </g>
                );
              })}

              {/* ---- marks ---- */}
              {Object.keys(markTotals).length > 0 && (
                <g>
                  {Object.entries(markTotals).map(([id, n], i) => {
                    const def = markDefs.find((x) => x.id === id);
                    const x = 60 + i * 160;
                    return (
                      <g key={id}>
                        <rect x={x} y={H - 108} width="9" height="9" fill={def?.color ?? '#8b93a7'} />
                        <text x={x + 16} y={H - 100} fill="#8b93a7" fontSize="10" fontFamily="ui-monospace, monospace">
                          {`${n} ${(def?.label ?? id).toLowerCase()} day${n === 1 ? '' : 's'}`}
                        </text>
                      </g>
                    );
                  })}
                </g>
              )}

              <text x={W / 2} y={H - 56} textAnchor="middle" fill="#3a4150" fontSize="9" letterSpacing="2" fontFamily="ui-monospace, monospace">
                {`KEPT LOCALLY · ${totals.planned > 0 ? Math.round((totals.done / totals.planned) * 100) : 0}% OF WHAT WAS PLANNED`}
              </text>
            </svg>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default memo(YearPage);

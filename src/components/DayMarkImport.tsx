import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardPaste, Scan, Trash2, X } from 'lucide-react';
import type { DayMarkDef, DayMarks } from '../types';
import {
  CELL_INSET,
  cellRect,
  cycleMark,
  DEFAULT_HUE_TOLERANCE,
  defaultFirstCell,
  dominantMarkColor,
  frameIsUsable,
  gridCells,
  matchColorOf,
  matchMark,
  monthsCovered,
  rowsNeeded,
  type GridFrame,
} from '../daymarks';
import { formatMonthKey } from '../month';
import { addDays } from '../utils/time';
import { fromDateKey } from '../utils/time';
import { colorsFor } from '../utils/color';
import { useModalMotion } from '../utils/motion';

// ============================================================================
// DayMarkImport — read a month of highlights off a screenshot of another calendar
//
// Entirely local. A pasted image becomes a data: URI, which the CSP already
// allows, and a canvas reads its pixels here in the app; nothing is uploaded and
// the image is discarded once sampled.
//
// Dates come from GRID POSITION, never from reading the image. Recognising the
// day numbers would mean bundling megabytes of OCR for a result that fails on
// anti-aliased text, so instead you say which month it is and which day the
// source's week starts on, and position does the rest.
//
// The sampler is assistive, not authoritative. It proposes, and you correct it on
// a grid before anything is written — which also means that if the source turns
// out to be a list or a timeline rather than a month grid, the confirm step still
// works as a plain manual marker.
// ============================================================================

interface Props {
  open: boolean;
  defs: DayMarkDef[];
  marks: DayMarks;
  /** The month the calendar view is currently showing, as a starting guess. */
  initialMonth: string;
  onClose: () => void;
  onApply: (proposal: Record<string, string | null>) => void;
  onChangeDefs: (defs: DayMarkDef[]) => void;
  onNotify: (message: string) => void;
}

type Step = 'paste' | 'frame' | 'confirm';

export default function DayMarkImport({
  open,
  defs,
  marks,
  initialMonth,
  onClose,
  onApply,
  onChangeDefs,
  onNotify,
}: Props) {
  const m = useModalMotion();
  const [step, setStep] = useState<Step>('paste');
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  // Anchored on the top-left cell's date rather than a month: a scrolling month
  // view can start in the previous month and span two. `weekStart` only seeds the
  // initial guess; after that the first-cell date carries the information.
  const [firstCell, setFirstCell] = useState(() => defaultFirstCell(initialMonth, 0));
  const [rows, setRows] = useState(() => rowsNeeded(initialMonth, 0));
  const [tolerance, setTolerance] = useState(DEFAULT_HUE_TOLERANCE);
  // Frame is normalised 0..1 against the image, so it survives any display scale
  // without a conversion step that could drift.
  const [frame, setFrame] = useState<GridFrame>({ x: 0, y: 0, w: 1, h: 1 });
  const [proposal, setProposal] = useState<Record<string, string | null>>({});
  const [sampled, setSampled] = useState<Record<string, string>>({});

  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);


  useEffect(() => {
    if (!open) {
      setStep('paste');
      setSrc(null);
      setProposal({});
      setSampled({});
      setFrame({ x: 0, y: 0, w: 1, h: 1 });
    } else {
      setFirstCell(defaultFirstCell(initialMonth, 0));
      setRows(rowsNeeded(initialMonth, 0));
    }
  }, [open, initialMonth]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // ---- getting the image in ------------------------------------------------

  const takeFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) {
        onNotify('That is not an image. Paste or drop a screenshot.');
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        setSrc(String(reader.result));
        setStep('frame');
      };
      reader.onerror = () => onNotify('That file could not be read.');
      reader.readAsDataURL(file);
    },
    [onNotify]
  );

  useEffect(() => {
    if (!open || step !== 'paste') return;
    function onPaste(e: ClipboardEvent) {
      const item = [...(e.clipboardData?.items ?? [])].find((i) =>
        i.type.startsWith('image/')
      );
      if (!item) return;
      const file = item.getAsFile();
      if (file) {
        e.preventDefault();
        takeFile(file);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [open, step, takeFile]);

  // ---- framing -------------------------------------------------------------

  const onFrameDown = (e: React.PointerEvent) => {
    const el = imgRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const p = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    dragRef.current = p;
    setFrame({ x: p.x, y: p.y, w: 0, h: 0 });

    const move = (ev: PointerEvent) => {
      const a = dragRef.current;
      if (!a) return;
      const bx = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const by = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      setFrame({
        x: Math.min(a.x, bx),
        y: Math.min(a.y, by),
        w: Math.abs(bx - a.x),
        h: Math.abs(by - a.y),
      });
    };
    const up = () => {
      dragRef.current = null;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ---- sampling ------------------------------------------------------------

  const runSample = useCallback(() => {
    const el = imgRef.current;
    if (!el || !src) return;

    const px: GridFrame = {
      x: frame.x * natural.w,
      y: frame.y * natural.h,
      w: frame.w * natural.w,
      h: frame.h * natural.h,
    };
    if (!frameIsUsable(px)) {
      onNotify('Drag a box around the calendar grid first — that frame is too small.');
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = natural.w;
    canvas.height = natural.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      onNotify('This machine could not open a canvas to read the image.');
      return;
    }
    ctx.drawImage(el, 0, 0, natural.w, natural.h);
    const data = ctx.getImageData(0, 0, natural.w, natural.h).data;

    // An import only ADDS. A day the sampler didn't recognise gets no entry at all,
    // rather than an explicit null, so anything already marked there survives — one
    // screenshot cannot quietly wipe six weeks of marks it happens not to cover.
    //
    // A null in the proposal therefore always means a person chose it: clicking a day
    // back to unmarked, or Clear these days.
    const next: Record<string, string | null> = {};
    const seen: Record<string, string> = {};
    for (const cell of gridCells(firstCell, rows)) {
      const rect = cellRect(px, rows, cell.row, cell.col, CELL_INSET);
      const sample = dominantMarkColor(data, natural.w, rect);
      const id = sample ? matchMark(sample.rgb, defs, tolerance) : null;
      if (!id) continue;
      next[cell.date] = id;
      seen[cell.date] = id;
    }
    setProposal(next);
    setSampled(seen);
    setStep('confirm');

    const hits = Object.keys(seen).length;
    onNotify(
      hits === 0
        ? 'No colours matched, so nothing will change. Adjust the frame or the mark colours, or just click the days you want.'
        : `Read ${hits} marked day${hits === 1 ? '' : 's'}. Check them over before saving.`
    );
  }, [src, frame, natural, firstCell, rows, defs, tolerance, onNotify]);

  // ---- confirm grid --------------------------------------------------------

  // The confirm grid mirrors the grid you framed — same first cell, same row count,
  // same column order — so it can be compared against the screenshot side by side.
  const confirmCells = useMemo(() => gridCells(firstCell, rows), [firstCell, rows]);
  const covered = useMemo(() => monthsCovered(firstCell, rows), [firstCell, rows]);

  const markFor = (date: string): string | null => {
    if (date in proposal) return proposal[date];
    return marks[date] ?? null;
  };

  /**
   * What applying would actually change, counted against what is already stored.
   *
   * Counted rather than assumed because the proposal can contain no-ops — re-reading
   * the same screenshot proposes marks that are already there — and, since a
   * deliberate clear is also a change, "Apply 0 marks" could otherwise sit on a
   * button about to delete a fortnight.
   */
  const changes = useMemo(() => {
    let set = 0;
    let cleared = 0;
    for (const [date, id] of Object.entries(proposal)) {
      const was = marks[date] ?? null;
      if (id === was) continue;
      if (id === null) cleared++;
      else set++;
    }
    return { set, cleared };
  }, [proposal, marks]);

  const applyLabel =
    changes.set > 0 && changes.cleared > 0
      ? `Apply ${changes.set} mark${changes.set === 1 ? '' : 's'}, clear ${changes.cleared}`
      : changes.set > 0
        ? `Apply ${changes.set} mark${changes.set === 1 ? '' : 's'}`
        : changes.cleared > 0
          ? `Clear ${changes.cleared} day${changes.cleared === 1 ? '' : 's'}`
          : 'Nothing to change';

  return (
    <AnimatePresence>
      {open && (
        // Must be a motion component, not a plain div: AnimatePresence waits for
        // its direct child to report an exit, and a plain element never does — the
        // modal then stays mounted forever after `open` goes false.
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.14 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'rgba(8, 8, 7, 0.72)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={onClose}
            {...m.overlay}
          />
          <motion.div
            {...m.card}
            className="relative raised rounded-xl6 w-full max-w-3xl p-6 max-h-[90vh] overflow-y-auto thin-scroll"
          >
            <div className="flex items-start justify-between mb-4">
              <div>
                <span className="legend">Month view</span>
                <h3 className="font-display text-title text-bone-0 mt-1">
                  Import highlights from a screenshot
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid place-items-center w-7 h-7 rounded text-bone-3 hover:text-bone-0 hover:bg-chassis-4 transition-colors"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
            <div className="rule-h mb-5" />

            {/* ---------------- mark colours ---------------- */}
            <div className="mb-5">
              <span className="legend">What to look for</span>
              <p className="text-body-sm text-bone-3 mt-1 mb-2 max-w-[64ch] leading-relaxed">
                Set each swatch to the colour that mark wears in the{' '}
                <em>other</em> calendar — not the colour it wears here. Matching is by
                hue, so the exact shade doesn't matter: a pale wash, a solid block and a
                thin bar of the same colour all read the same.
              </p>
              <div className="flex flex-wrap gap-2">
                {[...defs]
                  .sort((a, b) => a.order - b.order)
                  .map((d) => {
                    const source = matchColorOf(d);
                    return (
                      <div
                        key={d.id}
                        className="flex items-center gap-2 px-2 py-1.5 rounded"
                        style={{
                          background: colorsFor(source).fill,
                          border: `1px solid ${colorsFor(source).line}`,
                        }}
                      >
                        <input
                          type="color"
                          value={source}
                          onChange={(e) =>
                            onChangeDefs(
                              defs.map((x) =>
                                x.id === d.id ? { ...x, sourceColor: e.target.value } : x
                              )
                            )
                          }
                          aria-label={`Colour of ${d.label} in the source calendar`}
                          className="w-5 h-5 rounded-xs bg-transparent border-0 p-0 cursor-pointer"
                        />
                        <span
                          className="text-body-sm font-semibold"
                          style={{ color: colorsFor(source).text }}
                        >
                          {d.label}
                        </span>
                        {/* The colour it will actually wear here, so changing the
                            source swatch never looks like it changed the mark. */}
                        <span
                          className="rounded-full shrink-0"
                          style={{ width: 7, height: 7, background: d.color }}
                          title={`Shows as ${d.color} in Almanac`}
                        />
                      </div>
                    );
                  })}
              </div>
            </div>

            {/* ---------------- step 1: paste ---------------- */}
            {step === 'paste' && (
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f) takeFile(f);
                }}
                className="rounded-lg border border-dashed border-rule-3 py-12 px-6 text-center"
              >
                <ClipboardPaste
                  size={22}
                  strokeWidth={1.7}
                  className="text-bone-3 mx-auto mb-3"
                />
                <p className="text-body text-bone-1 mb-1">
                  Press ⌘V to paste a screenshot
                </p>
                <p className="text-body-sm text-bone-3 max-w-[52ch] mx-auto leading-relaxed">
                  Or drop an image here. It is read on this machine and never stored —
                  only the marks it produces are saved.
                </p>
                <label className="inline-block mt-4">
                  <span className="btn-quiet inline-flex items-center gap-2 text-body-sm px-3 h-8 cursor-pointer">
                    Choose a file
                  </span>
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) takeFile(f);
                    }}
                  />
                </label>
              </div>
            )}

            {/* ---------------- step 2: frame ---------------- */}
            {step === 'frame' && src && (
              <div>
                <div className="grid gap-3 md:grid-cols-3 mb-4">
                  <div>
                    <label className="legend block mb-1.5" htmlFor="dm-first-cell">
                      Date in the top-left cell
                    </label>
                    <input
                      id="dm-first-cell"
                      type="date"
                      value={firstCell}
                      onChange={(e) => {
                        if (e.target.value) setFirstCell(e.target.value);
                      }}
                      className="w-full bg-chassis-1 border border-rule-2 rounded px-2.5 h-8 font-mono text-body-sm text-ink-0 tnum outline-none focus:border-rule-3"
                    />
                    <p className="text-nano text-bone-3 mt-1 leading-relaxed">
                      {weekdayOf(firstCell)} — so columns run{' '}
                      {weekdayOf(firstCell, 'short')}→
                      {weekdayOf(addDays(firstCell, 6), 'short')}
                    </p>
                  </div>
                  <div>
                    <label className="legend block mb-1.5">Rows in the frame</label>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setRows((r) => Math.max(1, r - 1))}
                        className="btn-quiet w-7 h-8 grid place-items-center"
                        aria-label="One row fewer"
                      >
                        −
                      </button>
                      <span className="font-mono text-body-sm text-bone-1 tnum flex-1 text-center">
                        {rows}
                      </span>
                      <button
                        onClick={() => setRows((r) => Math.min(12, r + 1))}
                        className="btn-quiet w-7 h-8 grid place-items-center"
                        aria-label="One row more"
                      >
                        +
                      </button>
                    </div>
                    <p className="text-nano text-bone-3 mt-1 leading-relaxed tnum">
                      {covered.map(formatMonthKey).join(' · ')}
                    </p>
                  </div>
                  <div>
                    <label className="legend block mb-1.5">
                      Colour tolerance · {tolerance}°
                    </label>
                    <input
                      type="range"
                      min={10}
                      max={90}
                      value={tolerance}
                      onChange={(e) => setTolerance(Number(e.target.value))}
                      className="w-full"
                    />
                  </div>
                </div>

                <p className="text-body-sm text-bone-3 mb-2 leading-relaxed">
                  Drag a box around <span className="text-bone-1">just the day cells</span> —
                  no weekday header, no month title. The amber guide should land on the
                  source's own gridlines; if it doesn't, change the row count rather than
                  fighting the frame.
                </p>

                <div className="relative inline-block select-none rounded overflow-hidden border border-rule-2">
                  <img
                    ref={imgRef}
                    src={src}
                    alt="Pasted calendar"
                    onLoad={(e) =>
                      setNatural({
                        w: e.currentTarget.naturalWidth,
                        h: e.currentTarget.naturalHeight,
                      })
                    }
                    onPointerDown={onFrameDown}
                    className="block max-h-[46vh] w-auto cursor-crosshair"
                    draggable={false}
                  />
                  {frame.w > 0 && frame.h > 0 && (
                    <div
                      className="absolute pointer-events-none"
                      style={{
                        left: `${frame.x * 100}%`,
                        top: `${frame.y * 100}%`,
                        width: `${frame.w * 100}%`,
                        height: `${frame.h * 100}%`,
                        outline: '2px solid var(--signal)',
                        background: 'rgba(255,176,31,0.10)',
                        // The 7 × rows guide, so a misaligned frame is obvious
                        // before sampling rather than after.
                        backgroundImage: `repeating-linear-gradient(to right, var(--signal-line) 0 1px, transparent 1px ${100 / 7}%), repeating-linear-gradient(to bottom, var(--signal-line) 0 1px, transparent 1px ${100 / rows}%)`,
                      }}
                    />
                  )}
                </div>

                <div className="flex items-center justify-between mt-4">
                  <button
                    onClick={() => {
                      setSrc(null);
                      setStep('paste');
                    }}
                    className="text-body-sm text-bone-3 hover:text-bone-0 px-2 py-2 rounded transition-colors"
                  >
                    Use a different image
                  </button>
                  <button
                    onClick={runSample}
                    className="btn-primary inline-flex items-center gap-2 text-body-sm px-3.5 h-8"
                  >
                    <Scan size={14} strokeWidth={2.2} />
                    Read the colours
                  </button>
                </div>
              </div>
            )}

            {/* ---------------- step 3: confirm ---------------- */}
            {step === 'confirm' && (
              <div>
                <p className="text-body-sm text-bone-3 mb-3 max-w-[64ch] leading-relaxed">
                  {covered.map(formatMonthKey).join(' and ')} — click any day to change
                  its mark, or cycle it back to none. Importing only{' '}
                  <span className="text-bone-1">adds</span>: days the sampler didn't
                  recognise keep whatever they already had. Nothing is saved until you
                  apply.
                </p>

                {/* Same shape as the grid you framed, so it can be read against the
                    screenshot without translating between two column orders. */}
                <div className="grid grid-cols-7 gap-1 mb-4">
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i} className="legend text-center pb-1">
                      {weekdayOf(addDays(firstCell, i), 'narrow')}
                    </div>
                  ))}
                  {confirmCells.map((cell) => {
                    const id = markFor(cell.date);
                    const def = defs.find((d) => d.id === id) ?? null;
                    const c = def ? colorsFor(def.color) : null;
                    const wasSampled = cell.date in sampled;
                    return (
                      <button
                        key={cell.date}
                        onClick={() =>
                          setProposal((p) => ({
                            ...p,
                            [cell.date]: cycleMark(id, defs),
                          }))
                        }
                        title={
                          def
                            ? `${def.label}${wasSampled ? ' — read from the image' : ''}`
                            : 'No mark'
                        }
                        className="relative h-11 rounded-xs transition-colors"
                        style={{
                          background: c ? c.fill : 'rgba(245,242,236,0.03)',
                          border: `1px solid ${c ? c.line : 'var(--rule-2)'}`,
                        }}
                      >
                        <span
                          className="absolute top-1 left-1.5 font-mono text-nano tnum"
                          style={{ color: c ? c.text : 'var(--bone-3)' }}
                        >
                          {fromDateKey(cell.date).getDate()}
                        </span>
                        {def && (
                          <span
                            className="absolute bottom-1 left-1.5 right-1.5 text-nano font-semibold truncate text-left leading-none"
                            style={{ color: c!.text }}
                          >
                            {def.label}
                          </span>
                        )}
                        {/* A dot distinguishes what the sampler found from what you
                            set by hand, so a misread is easy to spot. */}
                        {wasSampled && (
                          <span
                            className="absolute top-1.5 right-1.5 w-1 h-1 rounded-full"
                            style={{ background: 'var(--signal)' }}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <button
                    onClick={() => setStep('frame')}
                    className="text-body-sm text-bone-3 hover:text-bone-0 px-2 py-2 rounded transition-colors"
                  >
                    Back to the image
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        // The one deliberate way to remove marks in bulk, and the way
                        // you undo a bad import. Since a read only adds, this is the
                        // only path to a proposal full of nulls.
                        const cleared: Record<string, string | null> = {};
                        for (const cell of confirmCells) cleared[cell.date] = null;
                        setProposal(cleared);
                        setSampled({});
                      }}
                      title={`Mark every one of these ${confirmCells.length} days for removal. Nothing happens until you apply.`}
                      className="btn-quiet inline-flex items-center gap-1.5 text-body-sm px-2.5 h-8"
                    >
                      <Trash2 size={13} strokeWidth={1.9} />
                      Clear these days
                    </button>
                    <button
                      onClick={() => {
                        onApply(proposal);
                        onClose();
                      }}
                      disabled={changes.set === 0 && changes.cleared === 0}
                      className="btn-primary text-body-sm px-4 h-8 disabled:opacity-40"
                    >
                      {applyLabel}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * A weekday name for a date key, in the viewer's locale.
 *
 * The confirm grid's column headers come from the framed grid's own first day
 * rather than being hardcoded Mon–Sun: a Sunday-first source would otherwise be
 * relabelled into a different week, which is exactly the misread the first-cell
 * date exists to prevent.
 */
function weekdayOf(dateKey: string, width: 'long' | 'short' | 'narrow' = 'long'): string {
  return fromDateKey(dateKey).toLocaleDateString(undefined, { weekday: width });
}

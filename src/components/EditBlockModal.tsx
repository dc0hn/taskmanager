import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pin, PinOff, Trash2, X } from 'lucide-react';
import type { Block, CategoryDef } from '../types';
import { colorsFor } from '../utils/color';
import { minutesTo24h, parse24h } from '../utils/time';

// ============================================================================
// EditBlockModal
//
// Also the place a block can be moved to another day without dragging — useful
// in day view, where there is no second column to drag into.
//
// This modal already set the standard for naming what went wrong rather than
// silently refusing ("Overlaps “Client call”."); the rest of the app now follows
// it via the toast.
// ============================================================================

export interface EditTarget {
  date: string;
  block: Block;
}

interface Props {
  target: EditTarget | null;
  categories: CategoryDef[];
  onClose: () => void;
  onSave: (date: string, id: string, patch: Partial<Block>, moveTo?: string) => void;
  onDelete: (date: string, id: string) => void;
}

export default function EditBlockModal({
  target,
  categories,
  onClose,
  onSave,
  onDelete,
}: Props) {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [category, setCategory] = useState('other');
  const [pinned, setPinned] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setTitle(target.block.title);
    setDate(target.date);
    setStart(minutesTo24h(target.block.start));
    setEnd(minutesTo24h(target.block.end));
    setCategory(target.block.category);
    setPinned(target.block.pinned === true);
    setError(null);
  }, [target]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (target) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [target, onClose]);

  function save() {
    if (!target) return;
    const s = parse24h(start);
    const e = parse24h(end);
    if (s == null || e == null) {
      setError('Use HH:MM (24-hour).');
      return;
    }
    if (e <= s) {
      setError('The end time has to be after the start time.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError('That date is not valid.');
      return;
    }

    // No overlap check. Overlapping is no longer an error — the day reflows
    // around the new times, and only pinned or completed work can refuse the
    // slot, which App reports on the toast. Blocking here would reject a save
    // that is now perfectly valid.
    const moving = date !== target.date;
    onSave(
      target.date,
      target.block.id,
      { title: title.trim() || 'Untitled', start: s, end: e, category, pinned },
      moving ? date : undefined
    );
  }

  const sorted = [...categories].sort((a, b) => a.order - b.order);

  return (
    <AnimatePresence>
      {target && (
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
              background: 'rgba(8, 8, 7, 0.70)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            className="relative raised rounded-xl6 w-full max-w-md p-5 shadow-lift"
          >
            <div className="flex items-start justify-between mb-3 gap-3">
              <div className="min-w-0">
                <p className="smallcaps text-[9.5px] text-bone-3 mb-1">Edit entry</p>
                <h3 className="font-display text-[19px] text-ink-0 leading-tight truncate font-semibold">
                  {title || 'Untitled'}
                </h3>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="grid place-items-center w-7 h-7 rounded-lg text-ink-3 hover:text-ink-0 hover:bg-paper-4 transition-colors shrink-0"
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
            <div className="rule-h mb-4" />

            <div className="space-y-3.5">
              <div>
                <Label>Title</Label>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input w-full text-[13.5px] px-2.5 py-2 focus:outline-none"
                />
              </div>

              <div>
                <Label>Day</Label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="input w-full font-mono text-[12.5px] px-2.5 py-2 tnum focus:outline-none"
                />
                {target && date !== target.date && (
                  <p className="text-[11px] text-accent-bright mt-1">
                    This will move the entry to another day.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Start</Label>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="input w-full font-mono text-[12.5px] px-2.5 py-2 tnum focus:outline-none"
                  />
                </div>
                <div>
                  <Label>End</Label>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="input w-full font-mono text-[12.5px] px-2.5 py-2 tnum focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <Label>Category</Label>
                <div className="flex flex-wrap gap-1.5">
                  {sorted.map((cat) => {
                    const active = category === cat.id;
                    const c = colorsFor(cat.accent);
                    return (
                      <button
                        key={cat.id}
                        onClick={() => setCategory(cat.id)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium transition-all"
                        style={{
                          background: active ? c.fillStrong : 'rgba(245, 242, 236,0.035)',
                          border: `1px solid ${active ? c.line : 'var(--rule-2)'}`,
                          color: active ? c.text : 'var(--bone-3)',
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: cat.accent }}
                        />
                        {cat.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <Label>Fixed in place</Label>
                <button
                  onClick={() => setPinned((v) => !v)}
                  aria-pressed={pinned}
                  className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md text-[11.5px] font-medium transition-all"
                  style={{
                    background: pinned ? 'var(--signal-dim)' : 'rgba(245,242,236,0.035)',
                    border: `1px solid ${pinned ? 'var(--signal-line)' : 'var(--rule-2)'}`,
                    color: pinned ? 'var(--signal)' : 'var(--bone-2)',
                  }}
                >
                  {pinned ? <Pin size={12} strokeWidth={2.4} /> : <PinOff size={12} strokeWidth={1.8} />}
                  {pinned ? 'Pinned' : 'Not pinned'}
                </button>
                <p className="text-[11px] text-bone-3 mt-1.5 leading-snug max-w-[46ch]">
                  {pinned
                    ? 'Rearranging other entries will move around this one instead of pushing it.'
                    : 'Rearranging other entries can push this one later to make room.'}
                </p>
              </div>

              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-[12.5px] text-bad leading-snug"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <div className="flex items-center justify-between mt-5 pt-3.5 border-t border-rule-2">
              <button
                onClick={() => target && onDelete(target.date, target.block.id)}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium text-bad hover:bg-bad-soft px-2.5 py-2 rounded-lg transition-colors"
              >
                <Trash2 size={13} strokeWidth={1.9} />
                Delete
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="text-[12px] font-medium text-ink-3 hover:text-ink-0 px-3 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={save}
                  className="btn-primary text-[12.5px] font-semibold px-4 py-2 rounded-lg"
                >
                  Save
                </motion.button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="smallcaps text-[9px] text-bone-3 block mb-1.5">{children}</label>
  );
}

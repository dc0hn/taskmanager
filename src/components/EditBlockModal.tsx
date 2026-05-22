import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, X } from 'lucide-react';
import { CATEGORIES } from '../types';
import type { Block, Category } from '../types';
import { minutesTo24h, parse24h } from '../utils/time';

interface Props {
  block: Block | null;
  otherBlocks: Block[];
  onClose: () => void;
  onSave: (patch: Partial<Block>) => void;
  onDelete: () => void;
}

export default function EditBlockModal({ block, otherBlocks, onClose, onSave, onDelete }: Props) {
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [category, setCategory] = useState<Category>('other');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (block) {
      setTitle(block.title);
      setStart(minutesTo24h(block.start));
      setEnd(minutesTo24h(block.end));
      setCategory(block.category);
      setError(null);
    }
  }, [block]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (block) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [block, onClose]);

  function save() {
    const s = parse24h(start);
    const e = parse24h(end);
    if (s == null || e == null) {
      setError('Use HH:MM (24h)');
      return;
    }
    if (e <= s) {
      setError('End time must be after start time.');
      return;
    }
    const conflict = otherBlocks.find((b) => !(e <= b.start || s >= b.end));
    if (conflict) {
      setError(`Overlaps "${conflict.title}".`);
      return;
    }
    onSave({ title: title.trim() || 'Untitled', start: s, end: e, category });
  }

  return (
    <AnimatePresence>
      {block && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <motion.div
            className="absolute inset-0"
            style={{
              background: 'rgba(28, 20, 11, 0.58)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 12, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="relative paper-card rounded-xl5 w-full max-w-md p-6 shadow-lift"
          >
            <div className="relative flex items-baseline justify-between mb-4">
              <div>
                <p className="smallcaps text-[11px] text-ink-3 mb-0.5">Edit entry</p>
                <h3 className="font-display italic text-[22px] text-ink-0 leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 80' }}>
                  {title || 'Untitled'}
                </h3>
              </div>
              <button
                onClick={onClose}
                className="grid place-items-center w-8 h-8 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-3 transition-colors"
                aria-label="Close"
              >
                <X size={16} strokeWidth={1.6} />
              </button>
            </div>
            <div className="rule-h mb-5" />

            <div className="relative space-y-4">
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1.5">
                  Title
                </label>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full font-display text-[14px] rounded border border-rule-2 bg-paper-4 px-2.5 py-2 text-ink-0 focus:outline-none focus:focus-ring"
                  style={{ fontVariationSettings: '"opsz" 24, "SOFT" 40' }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1.5">
                    Start
                  </label>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-full font-mono text-[13px] rounded border border-rule-2 bg-paper-4 px-2.5 py-2 tnum text-ink-0 focus:outline-none focus:focus-ring"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1.5">
                    End
                  </label>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-full font-mono text-[13px] rounded border border-rule-2 bg-paper-4 px-2.5 py-2 tnum text-ink-0 focus:outline-none focus:focus-ring"
                  />
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium uppercase tracking-wider text-ink-3 block mb-1.5">
                  Category
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => {
                    const active = category === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setCategory(c.id)}
                        className="text-[11.5px] font-medium px-3 py-1.5 rounded inline-flex items-center gap-1.5 border tracking-wide uppercase transition-all"
                        style={{
                          background: active ? c.bg : 'rgba(255,250,237,0.45)',
                          borderColor: active ? c.accent : 'rgba(28,20,11,0.18)',
                          color: active ? c.accent : '#3a2c1c',
                        }}
                      >
                        <span className="w-1.5 h-1.5 rounded-sm" style={{ background: c.accent }} />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -3 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="font-display italic text-[12.5px] text-seal"
                    style={{ fontVariationSettings: '"opsz" 14, "SOFT" 80' }}
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <div className="relative flex items-center justify-between mt-5 pt-4 border-t border-rule-3">
              <button
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 smallcaps text-[12px] text-seal hover:text-ink-0 hover:bg-paper-3 px-2.5 py-2 rounded-md transition-colors min-h-[36px]"
              >
                <Trash2 size={13} strokeWidth={1.7} />
                Delete entry
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="smallcaps text-[12px] text-ink-3 hover:text-ink-1 hover:bg-paper-3 px-3 py-2 rounded-md transition-colors min-h-[36px]"
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={save}
                  className="smallcaps text-[12px] text-paper-4 px-4 py-2 rounded-md stamp-shadow min-h-[36px]"
                  style={{
                    background:
                      'linear-gradient(180deg, #b14935 0%, #9e3a26 55%, #832c1b 100%)',
                  }}
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

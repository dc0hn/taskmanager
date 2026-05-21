import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, X } from 'lucide-react';
import { CATEGORIES } from '../types';
import type { Block, Category } from '../types';
import { minutesTo24h, parse24h } from '../utils/time';

interface Props {
  block: Block | null;
  onClose: () => void;
  onSave: (patch: Partial<Block>) => void;
  onDelete: () => void;
}

export default function EditBlockModal({ block, onClose, onSave, onDelete }: Props) {
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
            className="absolute inset-0 bg-bg-0/70"
            style={{ backdropFilter: 'blur(8px)' }}
            onClick={onClose}
          />
          <motion.div
            initial={{ y: 14, opacity: 0, scale: 0.97 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 10, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 360, damping: 28 }}
            className="relative bg-bg-2 border border-line-2 shadow-lift rounded-xl3 w-full max-w-md p-5 overflow-hidden"
          >
            <div className="absolute -top-20 -right-20 w-48 h-48 rounded-full bg-cat-deep/20 blur-3xl pointer-events-none" />
            <div className="relative flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold tracking-tight text-fg-0">Edit block</h3>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg text-fg-3 hover:text-fg-0 hover:bg-white/5"
                aria-label="Close"
              >
                <X size={15} />
              </button>
            </div>

            <div className="relative space-y-3.5">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1.5">
                  Title
                </label>
                <input
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full text-sm rounded-lg border border-line-2 bg-bg-1 px-2.5 py-2 text-fg-0 focus:outline-none focus:focus-ring"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1.5">
                    Start
                  </label>
                  <input
                    type="time"
                    value={start}
                    onChange={(e) => setStart(e.target.value)}
                    className="w-full text-sm rounded-lg border border-line-2 bg-bg-1 px-2.5 py-2 tnum text-fg-0 focus:outline-none focus:focus-ring"
                  />
                </div>
                <div>
                  <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1.5">
                    End
                  </label>
                  <input
                    type="time"
                    value={end}
                    onChange={(e) => setEnd(e.target.value)}
                    className="w-full text-sm rounded-lg border border-line-2 bg-bg-1 px-2.5 py-2 tnum text-fg-0 focus:outline-none focus:focus-ring"
                  />
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-fg-4 block mb-1.5">
                  Category
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORIES.map((c) => {
                    const active = category === c.id;
                    return (
                      <button
                        key={c.id}
                        onClick={() => setCategory(c.id)}
                        className="text-xs px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5 border transition-all"
                        style={{
                          background: active ? c.bg : 'rgba(255,255,255,0.03)',
                          borderColor: active ? c.accent : 'rgba(255,255,255,0.08)',
                          color: active ? c.accent : '#cbd5e1',
                        }}
                      >
                        <span
                          className="w-1.5 h-1.5 rounded-full"
                          style={{ background: c.accent, boxShadow: `0 0 6px ${c.accent}` }}
                        />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <AnimatePresence>
                {error && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-xs text-rose-300"
                  >
                    {error}
                  </motion.p>
                )}
              </AnimatePresence>
            </div>

            <div className="relative flex items-center justify-between mt-5">
              <button
                onClick={onDelete}
                className="inline-flex items-center gap-1.5 text-xs text-rose-300 hover:text-rose-200 px-2 py-1.5 rounded-lg hover:bg-rose-500/10"
              >
                <Trash2 size={13} />
                Delete
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  className="text-xs text-fg-2 hover:text-fg-0 px-3 py-1.5 rounded-lg hover:bg-white/5"
                >
                  Cancel
                </button>
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={save}
                  className="text-xs font-semibold text-white px-3.5 py-1.5 rounded-lg shadow-glow"
                  style={{
                    backgroundImage:
                      'linear-gradient(135deg, #7c3aed 0%, #6366f1 50%, #22d3ee 100%)',
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

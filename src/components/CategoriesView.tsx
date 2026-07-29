import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp, Lock, Plus, Tag, Trash2 } from 'lucide-react';
import type { CategoryDef, CategoryKind } from '../types';
import { CATEGORY_KINDS, CATEGORY_SWATCHES } from '../types';
import { colorsFor, slugifyCategoryId } from '../utils/color';

// ============================================================================
// CategoriesView
//
// Categories are user-definable. The scheduler does not know their ids — it
// reasons about their `kind`, which is why picking a kind here is the important
// choice and not merely a label. A new category set to Focus is frontloaded into
// the morning and chunked at ninety minutes without the scheduler being told
// anything about it.
//
// Only the accent colour is stored. The block fill, hairline and text shades are
// derived from it, so no combination a user can pick produces an illegible block.
// ============================================================================

interface Props {
  categories: CategoryDef[];
  /** How many stored blocks reference each category — shown before deleting. */
  usage: Record<string, number>;
  onAdd: (c: CategoryDef) => void;
  onUpdate: (id: string, patch: Partial<CategoryDef>) => void;
  onRemove: (id: string) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
}

export default function CategoriesView({
  categories,
  usage,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
}: Props) {
  const [adding, setAdding] = useState(false);
  const sorted = [...categories].sort((a, b) => a.order - b.order);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-6 pb-8">
      <div className="max-w-[860px]">
        <div className="flex items-center gap-2 py-4">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-0">Categories</h2>
            <p className="text-[12px] text-ink-3 mt-0.5 max-w-[60ch] leading-relaxed">
              A category's <em>kind</em> is what the scheduler acts on. Colour is only
              colour — every shade a block needs is derived from the accent you pick.
            </p>
          </div>
          <div className="flex-1" />
          <button
            onClick={() => setAdding((v) => !v)}
            className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3 h-[30px] rounded-lg shrink-0"
          >
            <Plus size={14} strokeWidth={2.4} />
            New category
          </button>
        </div>

        <AnimatePresence>
          {adding && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
              className="overflow-hidden"
            >
              <CategoryForm
                taken={categories.map((c) => c.id)}
                nextOrder={sorted.length}
                onSubmit={(c) => {
                  onAdd(c);
                  setAdding(false);
                }}
                onCancel={() => setAdding(false)}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div className="space-y-2">
          {sorted.map((cat, i) => (
            <CategoryRow
              key={cat.id}
              cat={cat}
              usage={usage[cat.id] ?? 0}
              isFirst={i === 0}
              isLast={i === sorted.length - 1}
              onUpdate={(patch) => onUpdate(cat.id, patch)}
              onRemove={() => onRemove(cat.id)}
              onReorder={(dir) => onReorder(cat.id, dir)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CategoryRow({
  cat,
  usage,
  isFirst,
  isLast,
  onUpdate,
  onRemove,
  onReorder,
}: {
  cat: CategoryDef;
  usage: number;
  isFirst: boolean;
  isLast: boolean;
  onUpdate: (patch: Partial<CategoryDef>) => void;
  onRemove: () => void;
  onReorder: (dir: -1 | 1) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const c = colorsFor(cat.accent);

  return (
    <div className="ruled-row" style={{ borderLeft: `2px solid ` }}>
      <div className="flex items-start gap-3 flex-wrap">
        {/* live preview of how a block in this category will look */}
        <div
          className="rounded-lg px-2.5 py-1.5 shrink-0 w-[132px]"
          style={{
            background: c.fill,
            border: `1px solid ${c.line}`,
            borderLeft: `3px solid ${c.accent}`,
          }}
        >
          <div className="smallcaps text-[8.5px]" style={{ color: c.accent }}>
            {cat.short}
          </div>
          <div className="text-[12px] font-semibold truncate" style={{ color: c.text }}>
            {cat.label}
          </div>
          <div className="font-mono text-[9px] tnum" style={{ color: c.textDim }}>
            9:00 – 10:30
          </div>
        </div>

        <div className="flex-1 min-w-[220px] space-y-2">
          <div className="flex gap-2">
            <input
              value={cat.label}
              onChange={(e) => onUpdate({ label: e.target.value })}
              placeholder="Label"
              className="input flex-1 text-[13px] px-2 py-1.5 focus:outline-none"
            />
            <input
              value={cat.short}
              onChange={(e) => onUpdate({ short: e.target.value })}
              placeholder="Short"
              className="input w-20 text-[13px] px-2 py-1.5 focus:outline-none"
            />
          </div>

          <div className="flex flex-wrap gap-1">
            {CATEGORY_SWATCHES.map((hex) => (
              <button
                key={hex}
                onClick={() => onUpdate({ accent: hex })}
                aria-label={`Use ${hex}`}
                className="w-6 h-6 rounded-md transition-transform hover:scale-110"
                style={{
                  background: hex,
                  boxShadow:
                    cat.accent.toLowerCase() === hex.toLowerCase()
                      ? '0 0 0 2px var(--chassis-2), 0 0 0 3.5px #fff'
                      : undefined,
                }}
              />
            ))}
          </div>

          <div className="flex flex-wrap gap-1">
            {CATEGORY_KINDS.map((k) => {
              const active = cat.kind === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => onUpdate({ kind: k.id })}
                  title={k.blurb}
                  className="px-2 py-1 rounded-md text-[11px] font-medium transition-all"
                  style={{
                    background: active ? 'var(--signal-dim)' : 'rgba(245, 242, 236,0.035)',
                    border: `1px solid ${active ? 'var(--signal-line)' : 'var(--rule-2)'}`,
                    color: active ? 'var(--bone-0)' : 'var(--bone-3)',
                  }}
                >
                  {k.label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-bone-3 leading-snug">
            {CATEGORY_KINDS.find((k) => k.id === cat.kind)?.blurb}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-0.5">
            <button
              onClick={() => onReorder(-1)}
              disabled={isFirst}
              aria-label="Move up"
              className="grid place-items-center w-6 h-6 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-4 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronUp size={13} strokeWidth={2.2} />
            </button>
            <button
              onClick={() => onReorder(1)}
              disabled={isLast}
              aria-label="Move down"
              className="grid place-items-center w-6 h-6 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-4 disabled:opacity-25 disabled:hover:bg-transparent transition-colors"
            >
              <ChevronDown size={13} strokeWidth={2.2} />
            </button>
            {cat.builtin ? (
              <span
                className="grid place-items-center w-6 h-6 text-ink-5"
                title="Built-in categories can be renamed and recoloured, but not deleted."
              >
                <Lock size={12} strokeWidth={1.9} />
              </span>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                aria-label="Delete category"
                className="grid place-items-center w-6 h-6 rounded-md text-bone-3 hover:text-bad hover:bg-paper-4 transition-colors"
              >
                <Trash2 size={12} strokeWidth={1.9} />
              </button>
            )}
          </div>
          <span className="font-mono text-[9.5px] text-bone-3 tnum">
            {usage === 0 ? 'unused' : `${usage} entr${usage === 1 ? 'y' : 'ies'}`}
          </span>
        </div>
      </div>

      <AnimatePresence>
        {confirming && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div
              className="mt-3 pt-3 border-t border-rule-2 flex items-center gap-3 flex-wrap"
            >
              <p className="text-[12px] text-ink-2 flex-1 min-w-[240px] leading-snug">
                {usage > 0 ? (
                  <>
                    {usage} existing {usage === 1 ? 'entry uses' : 'entries use'} this
                    category. {usage === 1 ? 'It' : 'They'} won't be deleted — they'll
                    show as <span className="text-ink-1">Uncategorised</span> and stay
                    editable.
                  </>
                ) : (
                  'Nothing uses this category. Safe to delete.'
                )}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirming(false)}
                  className="text-[12px] font-medium text-ink-3 hover:text-ink-0 px-2.5 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={() => {
                    onRemove();
                    setConfirming(false);
                  }}
                  className="text-[12px] font-semibold px-2.5 py-1.5 rounded-lg transition-colors"
                  style={{
                    background: 'rgba(224, 104, 95,0.16)',
                    border: '1px solid rgba(224, 104, 95,0.45)',
                    color: 'var(--bad)',
                  }}
                >
                  Delete
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function CategoryForm({
  taken,
  nextOrder,
  onSubmit,
  onCancel,
}: {
  taken: string[];
  nextOrder: number;
  onSubmit: (c: CategoryDef) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [short, setShort] = useState('');
  const [kind, setKind] = useState<CategoryKind>('focus');
  const [accent, setAccent] = useState(CATEGORY_SWATCHES[4]);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) {
      setError('Give the category a name.');
      return;
    }
    const id = slugifyCategoryId(trimmed, taken);
    onSubmit({
      id,
      label: trimmed,
      short: short.trim() || trimmed.split(' ')[0],
      kind,
      accent,
      order: nextOrder,
    });
  }

  const c = colorsFor(accent);

  return (
    <div className="form-well mb-6">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <Label>Name</Label>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Music practice"
            className="input w-full text-[13.5px] px-2.5 py-2 focus:outline-none"
          />
        </div>
        <div>
          <Label>Short label (on blocks)</Label>
          <input
            value={short}
            onChange={(e) => setShort(e.target.value)}
            placeholder="Music"
            className="input w-full text-[13.5px] px-2.5 py-2 focus:outline-none"
          />
        </div>

        <div className="md:col-span-2">
          <Label>How should the scheduler treat it?</Label>
          <div className="grid gap-1.5 md:grid-cols-2">
            {CATEGORY_KINDS.map((k) => {
              const active = kind === k.id;
              return (
                <button
                  key={k.id}
                  onClick={() => setKind(k.id)}
                  className="text-left px-2.5 py-2 rounded-lg transition-all"
                  style={{
                    background: active ? 'var(--signal-dim)' : 'rgba(245, 242, 236,0.03)',
                    border: `1px solid ${active ? 'var(--signal-line)' : 'var(--rule-2)'}`,
                  }}
                >
                  <div
                    className="text-[12.5px] font-semibold"
                    style={{ color: active ? 'var(--bone-0)' : 'var(--bone-1)' }}
                  >
                    {k.label}
                  </div>
                  <div className="text-[11px] text-ink-3 leading-snug mt-0.5">
                    {k.blurb}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="md:col-span-2">
          <Label>Colour</Label>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex flex-wrap gap-1.5">
              {CATEGORY_SWATCHES.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setAccent(hex)}
                  aria-label={`Use ${hex}`}
                  className="w-7 h-7 rounded-md transition-transform hover:scale-110"
                  style={{
                    background: hex,
                    boxShadow:
                      accent === hex
                        ? '0 0 0 2px var(--chassis-2), 0 0 0 3.5px #fff'
                        : undefined,
                  }}
                />
              ))}
            </div>
            <div
              className="rounded-lg px-2.5 py-1.5 w-[140px]"
              style={{
                background: c.fill,
                border: `1px solid ${c.line}`,
                borderLeft: `3px solid ${c.accent}`,
              }}
            >
              <div className="smallcaps text-[8.5px]" style={{ color: c.accent }}>
                {short.trim() || label.trim() || 'Preview'}
              </div>
              <div
                className="text-[12px] font-semibold truncate"
                style={{ color: c.text }}
              >
                {label.trim() || 'Your category'}
              </div>
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-[12.5px] text-bad mt-2.5">{error}</p>}

      <div className="flex justify-end gap-2 mt-3.5">
        <button
          onClick={onCancel}
          className="text-[12px] font-medium text-ink-3 hover:text-ink-0 px-3 py-2 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={submit}
          className="btn-primary inline-flex items-center gap-1.5 text-[12.5px] font-semibold px-3.5 py-2 rounded-lg"
        >
          <Tag size={13} strokeWidth={2.2} />
          Add category
        </button>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label className="smallcaps text-[9px] text-bone-3 block mb-1.5">{children}</label>
  );
}

import { memo, useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';

// ============================================================================
// Foldable — a section that remembers whether it was open
//
// The Standing view holds five sections and has three more coming; on one scroll
// that becomes unusable. Folding keeps everything in one place while letting the
// page be as short as you want it.
//
// The remembering is the part that makes it worth having. A panel that reopens every
// launch is worse than no panel at all, because you pay the closing cost repeatedly
// and never bank it. State lives under its own storage key, written straight through
// rather than routed via the app's records — it is a view preference, not data, and
// a corrupt value costs nothing more than a section being open.
// ============================================================================

const KEY_PREFIX = 'dp:fold:';

function readOpen(id: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + id);
    if (raw === '1') return true;
    if (raw === '0') return false;
  } catch {
    // A refused read only costs the preference.
  }
  return fallback;
}

interface Props {
  /** Stable id — the storage key is derived from it. */
  id: string;
  title: string;
  /** Shown beside the title while collapsed, so a folded section still informs. */
  summary?: string;
  /** Open on first ever visit. */
  defaultOpen?: boolean;
  children: React.ReactNode;
}

function Foldable({ id, title, summary, defaultOpen = true, children }: Props) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));

  useEffect(() => {
    try {
      localStorage.setItem(KEY_PREFIX + id, open ? '1' : '0');
    } catch {
      // Preference only; nothing downstream depends on it.
    }
  }, [id, open]);

  const toggle = useCallback(() => setOpen((v) => !v), []);

  return (
    <section className="py-4">
      <button
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-baseline gap-3 text-left group"
      >
        <ChevronRight
          size={14}
          strokeWidth={2.2}
          className="shrink-0 text-bone-3 group-hover:text-bone-1 transition-transform duration-200 ease-out"
          style={{ transform: open ? 'rotate(90deg)' : 'none', marginBottom: -2 }}
        />
        <h3 className="font-display text-title text-bone-0">{title}</h3>
        {summary && (
          <span className="font-mono text-nano tnum text-bone-3 tracking-wide ml-auto">
            {summary}
          </span>
        )}
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              duration: reduced ? 0 : 0.24,
              ease: [0.2, 0.8, 0.2, 1],
            }}
            // Clipped during the transition only. Left on permanently it would cut
            // off anything that legitimately overflows, such as a tooltip.
            style={{ overflow: 'hidden' }}
            className="pt-3"
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

export default memo(Foldable);

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

// ============================================================================
// Toast
//
// Exists so the app never refuses an action in silence. Dragging a block onto an
// occupied slot, clicking to create where there is no room, or a goal that
// cannot be scheduled all surface here, naming the thing that got in the way —
// the same courtesy the edit modal already extended ("Overlaps “Client call”.").
// ============================================================================

interface Props {
  message: string | null;
  onDismiss: () => void;
  /** Auto-dismiss delay in ms. */
  timeout?: number;
}

export default function Toast({ message, onDismiss, timeout = 4200 }: Props) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, timeout);
    return () => clearTimeout(id);
  }, [message, onDismiss, timeout]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-[min(560px,calc(100vw-2rem))]"
          role="status"
          aria-live="polite"
        >
          <div
            className="flex items-start gap-2.5 pl-3 pr-2 py-2.5 rounded-xl4 shadow-lift"
            style={{
              background: 'linear-gradient(180deg, #232838, #1a1e29)',
              border: '1px solid var(--warn-line, rgba(255, 176, 31,0.42))',
            }}
          >
            <AlertTriangle
              size={15}
              strokeWidth={2}
              className="text-warn shrink-0 mt-[1px]"
            />
            <p className="text-[13px] text-ink-1 leading-snug flex-1">{message}</p>
            <button
              onClick={onDismiss}
              aria-label="Dismiss"
              className="grid place-items-center w-6 h-6 rounded-md text-ink-3 hover:text-ink-0 hover:bg-paper-4 transition-colors shrink-0"
            >
              <X size={13} strokeWidth={2} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

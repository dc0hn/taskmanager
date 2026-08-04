import { toDateKey } from '../utils/time';
import type { EventKind, StudyEvent } from './ledger';

// ============================================================================
// The recorder
//
// A tiny buffered writer sitting between the app and the ledger. It exists because the
// alternative — writing localStorage on every interaction — would serialise a fortnight
// of events on every click, which at ~108 KB is a real cost paid at exactly the moment
// the user is trying to do something.
//
// So events accumulate in memory and flush on a timer, on page hide, and before
// anything reads the ledger. The window in which a crash loses events is a second or
// two of navigation, which is an acceptable loss for a study instrument and an
// unacceptable one for a calendar — which is why nothing the user CREATES goes through
// here. This records that a thing happened; the thing itself is saved by the normal
// path, synchronously, as it always was.
//
// It is deliberately not a React hook. Recording must be callable from inside event
// handlers and effects without adding a dependency to any of them, and a hook would
// make every call site re-render when the buffer changed.
// ============================================================================

type Flush = (events: StudyEvent[]) => void;

let buffer: StudyEvent[] = [];
let flushTo: Flush | null = null;
let timer: number | undefined;

/** Milliseconds of quiet before the buffer is written. */
const FLUSH_DELAY = 2000;

/**
 * Install the sink. Called once, by the app, with the function that persists events.
 *
 * Split from `record` so the ledger's storage is not imported by every module that
 * wants to record something — and so tests can install a sink that captures rather
 * than writes.
 */
export function installRecorder(flush: Flush): () => void {
  flushTo = flush;
  const onHide = () => {
    if (document.visibilityState === 'hidden') flushNow();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushNow);
  return () => {
    flushNow();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flushNow);
    flushTo = null;
  };
}

/** Write whatever is buffered, now. Safe to call when there is nothing to write. */
export function flushNow(): void {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = undefined;
  }
  if (buffer.length === 0 || !flushTo) return;
  const pending = buffer;
  buffer = [];
  flushTo(pending);
}

/**
 * Record one observation.
 *
 * Never throws, whatever it is handed. A study instrument that can break the app it is
 * observing is a worse instrument than one that misses an event, and the call sites are
 * inside click handlers where an exception would abandon the user's actual action
 * half-done.
 */
export function record(
  kind: EventKind,
  opts: { date?: string; ref?: string; a?: number; b?: number } = {}
): void {
  try {
    const event: StudyEvent = {
      at: Math.floor(Date.now() / 1000),
      kind,
      date: opts.date ?? toDateKey(new Date()),
      ref: opts.ref ?? '',
      a: Number.isFinite(opts.a) ? Math.round(opts.a as number) : 0,
      b: Number.isFinite(opts.b) ? Math.round(opts.b as number) : 0,
    };
    buffer.push(event);

    if (timer == null) {
      timer = window.setTimeout(flushNow, FLUSH_DELAY);
    }
  } catch {
    // Deliberately silent. See above.
  }
}

/** Test seam: drop anything buffered without writing it. */
export function resetRecorder(): void {
  if (timer != null) window.clearTimeout(timer);
  timer = undefined;
  buffer = [];
  flushTo = null;
}

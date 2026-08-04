import { exportAll, importAll } from './storage';
import { daysBetween } from './streaks';

// ============================================================================
// Snapshots to a real file
//
// localStorage was the only copy of everything. Inside the WebKit webview that is a
// SQLite file under ~/Library/WebKit/com.dc0hn.almanac/, which is a real file on a real
// disk — but it is a file the app does not own, cannot see, and which the platform is
// entitled to clear. A "clear website data", a profile reset, a corrupt page store, and
// every plan, streak and week of history is gone with no second copy anywhere.
//
// This does not move the store. localStorage stays the working set, because everything
// in it is read synchronously during render and making that asynchronous would touch
// every load path in the app for no gain in durability. What it adds is a second copy in
// a place the app owns, written on a cadence, using the export document that already
// exists.
//
// Three decisions worth stating:
//
//   THE BACKEND CHOOSES THE PATH. `write_snapshot` takes contents and nothing else, so
//   there is no filesystem grant to scope and no path argument to validate.
//
//   IT IS NEVER ON THE INTERACTION PATH. A snapshot is a whole-profile serialise. It
//   runs on an idle callback after launch, never inside a save.
//
//   FAILING IS NOT AN ERROR. No snapshot mechanism should be able to take the app down
//   with it. Every failure here is recorded and swallowed; the working set is unaffected.
// ============================================================================

export const SNAPSHOT_KEY = 'dp:snapshot:v1';

/** How often a snapshot is taken, in days. */
export const SNAPSHOT_EVERY_DAYS = 1;

export interface SnapshotRecord {
  /** Date key of the last successful snapshot, or empty if never. */
  lastOn: string;
  /** Where it was written, for showing the user something they can go and look at. */
  path: string;
  /** Last failure, kept so a silently-broken snapshot is still visible somewhere. */
  error?: string;
}

export function emptySnapshotRecord(): SnapshotRecord {
  return { lastOn: '', path: '' };
}

/**
 * Is a snapshot owed?
 *
 * Pure, and separated from the writing so the cadence can be tested without a
 * filesystem. A record with no date has never snapshotted and is always due, which is
 * what makes the first launch after an update take one.
 */
export function snapshotDue(
  record: SnapshotRecord,
  today: string,
  everyDays = SNAPSHOT_EVERY_DAYS
): boolean {
  if (!record.lastOn) return true;
  // A clock moved backwards would otherwise wait days for its own past to catch up.
  if (record.lastOn > today) return true;
  return daysBetween(record.lastOn, today) >= everyDays;
}

export function loadSnapshotRecord(): SnapshotRecord {
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    if (!raw) return emptySnapshotRecord();
    const parsed = JSON.parse(raw) as Partial<SnapshotRecord>;
    return {
      lastOn: typeof parsed.lastOn === 'string' ? parsed.lastOn : '',
      path: typeof parsed.path === 'string' ? parsed.path : '',
      error: typeof parsed.error === 'string' ? parsed.error : undefined,
    };
  } catch {
    return emptySnapshotRecord();
  }
}

export function saveSnapshotRecord(record: SnapshotRecord): void {
  try {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(record));
  } catch {
    // The snapshot itself succeeded or failed on its own terms; losing the bookkeeping
    // only means the next launch tries again, which is harmless.
  }
}

/**
 * Is there a Tauri backend to talk to at all?
 *
 * The browser dev server has no backend, so the snapshot is simply unavailable there.
 * Checked rather than assumed, because a thrown import in the dev server would be an
 * error where the honest answer is "not applicable".
 */
export function backendAvailable(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/** The two calls into the backend. Isolated so everything above them stays testable. */
async function invokeWrite(contents: string): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('write_snapshot', { contents });
}

async function invokeRead(previous: boolean): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('read_snapshot', { previous });
}

export interface SnapshotOutcome {
  ok: boolean;
  /** Absolute path written, when it worked. */
  path?: string;
  message: string;
}

/**
 * Take a snapshot now, whether or not one is due.
 *
 * Returns rather than throws. A backup that can crash the thing it is backing up is
 * worse than no backup.
 */
export async function takeSnapshot(today: string): Promise<SnapshotOutcome> {
  if (!backendAvailable()) {
    return { ok: false, message: 'Snapshots need the desktop app — this is the dev server.' };
  }
  try {
    const doc = exportAll(today);
    const path = await invokeWrite(JSON.stringify(doc));
    const count = Object.keys(doc.records).length;
    saveSnapshotRecord({ lastOn: today, path });
    return {
      ok: true,
      path,
      message: `Snapshotted ${count} record${count === 1 ? '' : 's'} to ${path}`,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Almanac: snapshot failed', e);
    // Keep the previous success date. Recording today would make a permanently failing
    // snapshot look like a daily one.
    const previous = loadSnapshotRecord();
    saveSnapshotRecord({ ...previous, error: message });
    return { ok: false, message: `Snapshot failed: ${message}` };
  }
}

/** Take one only if the cadence says it is owed. */
export async function snapshotIfDue(today: string): Promise<SnapshotOutcome | null> {
  if (!backendAvailable()) return null;
  if (!snapshotDue(loadSnapshotRecord(), today)) return null;
  return takeSnapshot(today);
}

export interface VerifyOutcome {
  ok: boolean;
  message: string;
}

/**
 * Read the snapshot back and check it is a restorable document.
 *
 * A backup nobody has ever read is a backup in name — the file can be present,
 * correctly named, and empty or truncated, and you find out at the moment you least
 * want to. This reads it, parses it, checks the format marker and counts the records,
 * and touches nothing: it is the one operation here with no side effects at all.
 */
export async function verifySnapshot(previous = false): Promise<VerifyOutcome> {
  if (!backendAvailable()) {
    return { ok: false, message: 'Snapshots need the desktop app.' };
  }
  const which = previous ? 'the previous snapshot' : 'the snapshot';
  let text: string;
  try {
    text = await invokeRead(previous);
  } catch (e) {
    return { ok: false, message: `Could not read ${which}: ${String(e)}` };
  }

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return {
      ok: false,
      message: `${which} is present but not readable JSON — it cannot be restored from.`,
    };
  }

  const d = doc as Record<string, unknown> | null;
  const records = d && typeof d.records === 'object' && d.records !== null
    ? Object.keys(d.records as Record<string, unknown>).length
    : 0;
  if (!d || typeof d.version !== 'number' || records === 0) {
    return { ok: false, message: `${which} is not a valid Almanac export.` };
  }

  const kb = (text.length / 1024).toFixed(1);
  return {
    ok: true,
    message: `${which} is readable — ${records} records, ${kb} KB. Restorable.`,
  };
}

export interface RestoreOutcome {
  ok: boolean;
  message: string;
  written: number;
}

/**
 * Read the snapshot back and put it through the ordinary import path.
 *
 * Deliberately `importAll` rather than anything new: a snapshot is an export document, so
 * every record goes through the same normalisers as a hand-pasted file. A snapshot that
 * had picked up a bad record restores whatever was salvageable instead of installing the
 * damage — which is the behaviour the import path was written for.
 *
 * `replace` is the caller's decision and it is the consequential one. Replacing wipes
 * what is currently stored; merging leaves anything the snapshot does not mention. The UI
 * asks, and defaults to replacing, because a restore is almost always "this profile is
 * wrong, put the good one back".
 */
export async function restoreFromSnapshot(
  replace: boolean,
  previous = false
): Promise<RestoreOutcome> {
  if (!backendAvailable()) {
    return {
      ok: false,
      message: 'Snapshots need the desktop app \u2014 this is the dev server.',
      written: 0,
    };
  }
  try {
    const json = await invokeRead(previous);
    const result = importAll(json, replace);
    return { ok: result.ok, message: result.message, written: result.written };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('Almanac: restore failed', e);
    return { ok: false, message: `Restore failed: ${message}`, written: 0 };
  }
}

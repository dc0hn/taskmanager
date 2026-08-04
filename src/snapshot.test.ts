import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptySnapshotRecord,
  loadSnapshotRecord,
  saveSnapshotRecord,
  snapshotDue,
  SNAPSHOT_KEY,
  backendAvailable,
} from './snapshot';

// The cadence and the bookkeeping are pure and tested here. The one call that reaches
// the backend is isolated behind `backendAvailable`, which is false under vitest — so
// these tests can cover everything that decides WHETHER to snapshot without needing a
// filesystem or a Tauri process.

/** Same in-memory stand-in the other storage suites use; vitest runs in node. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
}

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe('snapshotDue', () => {
  it('is due when nothing has ever been snapshotted', () => {
    expect(snapshotDue(emptySnapshotRecord(), '2026-07-30')).toBe(true);
  });

  it('is not due again the same day', () => {
    expect(snapshotDue({ lastOn: '2026-07-30', path: '/x' }, '2026-07-30')).toBe(false);
  });

  it('is due the next day', () => {
    expect(snapshotDue({ lastOn: '2026-07-29', path: '/x' }, '2026-07-30')).toBe(true);
  });

  it('is due after a long closure', () => {
    expect(snapshotDue({ lastOn: '2026-01-01', path: '/x' }, '2026-07-30')).toBe(true);
  });

  it('honours a wider cadence', () => {
    const record = { lastOn: '2026-07-28', path: '/x' };
    expect(snapshotDue(record, '2026-07-30', 7)).toBe(false);
    expect(snapshotDue(record, '2026-08-04', 7)).toBe(true);
  });

  it('is due when the record is in the future', () => {
    // A clock moved backwards, or a profile imported from a machine set ahead. Waiting
    // for its own past to catch up would leave days unsnapshotted for no reason.
    expect(snapshotDue({ lastOn: '2027-01-01', path: '/x' }, '2026-07-30')).toBe(true);
  });
});

describe('the snapshot record', () => {
  it('round-trips', () => {
    saveSnapshotRecord({ lastOn: '2026-07-30', path: '/tmp/a.json' });
    expect(loadSnapshotRecord()).toEqual({
      lastOn: '2026-07-30',
      path: '/tmp/a.json',
      error: undefined,
    });
  });

  it('keeps a recorded failure', () => {
    saveSnapshotRecord({ lastOn: '', path: '', error: 'rename failed' });
    expect(loadSnapshotRecord().error).toBe('rename failed');
  });

  it('reads an absent record as never snapshotted', () => {
    expect(loadSnapshotRecord()).toEqual(emptySnapshotRecord());
  });

  it('survives a corrupt record rather than throwing', () => {
    // Every other loader in the app is defensive about hand-edited storage; this is the
    // one whose failure would otherwise surface during launch.
    localStorage.setItem(SNAPSHOT_KEY, '{not json');
    expect(loadSnapshotRecord()).toEqual(emptySnapshotRecord());
  });

  it('drops fields of the wrong type', () => {
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ lastOn: 42, path: null }));
    expect(loadSnapshotRecord()).toEqual(emptySnapshotRecord());
  });
});

describe('backend detection', () => {
  it('reports no backend outside the desktop app', () => {
    // Which is what makes the dev server say "not applicable" rather than "failed".
    expect(backendAvailable()).toBe(false);
  });
});

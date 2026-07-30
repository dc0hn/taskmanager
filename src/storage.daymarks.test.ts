import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadDayMarkDefs,
  loadDayMarks,
  saveDayMarkDefs,
  saveDayMarks,
} from './storage';
import { matchMark, rgbToHsl } from './daymarks';
import { DEFAULT_DAY_MARKS } from './types';
import type { DayMarkDef } from './types';

// ============================================================================
// Day-mark persistence.
//
// These exist because of a bug that survived every other test: `sourceColor` was
// added to the type but not to the storage normaliser, so it was silently dropped
// on the first save. Nothing looked broken — the marks kept their colours and the
// month view was correct — but the importer fell back to matching the DISPLAY
// colour, so gigs imported correctly in the session that set them up and never
// again afterwards.
//
// The lesson these tests encode: a normaliser that drops a field is not a
// formatting detail, it is a silent behaviour change one reload later. So the
// round trip is asserted per field rather than assumed.
// ============================================================================

// The real screenshot's amber gig bar.
const SOURCE_AMBER = { r: 101, g: 70, b: 33 };
// Its teal travel bar.
const SOURCE_TEAL = { r: 31, g: 96, b: 88 };

/**
 * A localStorage good enough for storage.ts, defined here rather than by switching
 * the suite to jsdom.
 *
 * The other nine test files are pure logic and run under `environment: 'node'`.
 * Pulling in jsdom for this one file would slow all of them down and add a
 * dependency to an app whose whole point is having very few. storage.ts reads the
 * global lazily inside each function, so defining it before the first call is
 * enough — and `key`/`length` matter, because the prefix scans iterate by index.
 */
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

describe('day-mark definition round trip', () => {
  it('preserves sourceColor, which nothing else would reveal', () => {
    const defs: DayMarkDef[] = [
      { id: 'gig', label: 'Gig', color: '#f472b6', sourceColor: '#654621', order: 0 },
    ];
    saveDayMarkDefs(defs);
    expect(loadDayMarkDefs()[0].sourceColor).toBe('#654621');
  });

  it('keeps matching the source colour after a reload', () => {
    // The actual regression, stated as behaviour rather than as a field.
    saveDayMarkDefs(DEFAULT_DAY_MARKS);
    const reloaded = loadDayMarkDefs();
    expect(matchMark(SOURCE_AMBER, reloaded)).toBe('gig');
    expect(matchMark(SOURCE_TEAL, reloaded)).toBe('travel');
  });

  it('would fail to match the amber gig if sourceColor were lost', () => {
    // Proof the test above bites: pink is 62° from amber, well outside tolerance.
    // Omit-by-rest: the discarded binding is the whole point, so it is named to say so.
    const stripped = DEFAULT_DAY_MARKS.map((def) => {
      const copy = { ...def };
      delete copy.sourceColor;
      return copy;
    });
    expect(matchMark(SOURCE_AMBER, stripped)).toBeNull();
    // And a demonstration of why: display pink is nowhere near source amber.
    const pink = rgbToHsl({ r: 244, g: 114, b: 182 }).h;
    const amber = rgbToHsl(SOURCE_AMBER).h;
    expect(Math.abs(pink - amber)).toBeGreaterThan(34);
  });

  it('leaves sourceColor absent rather than inventing one', () => {
    // A mark you never import needs no source colour, and `matchColorOf` falls back
    // to `color`. Writing a bogus default would break that fallback.
    saveDayMarkDefs([{ id: 'off', label: 'Off', color: '#6fbf8b', order: 0 }]);
    expect(loadDayMarkDefs()[0].sourceColor).toBeUndefined();
  });

  it('drops a malformed sourceColor instead of storing it', () => {
    localStorage.setItem(
      'dp:markdefs:v1',
      JSON.stringify([{ id: 'gig', label: 'Gig', color: '#f472b6', sourceColor: 'teal-ish', order: 0 }])
    );
    expect(loadDayMarkDefs()[0].sourceColor).toBeUndefined();
  });

  it('preserves label, colour and order', () => {
    const defs: DayMarkDef[] = [
      { id: 'b', label: 'Second', color: '#4a9eff', order: 1 },
      { id: 'a', label: 'First', color: '#f472b6', order: 0 },
    ];
    saveDayMarkDefs(defs);
    const back = loadDayMarkDefs();
    expect(back.map((d) => d.id)).toEqual(['a', 'b']); // sorted by order
    expect(back.map((d) => d.label)).toEqual(['First', 'Second']);
    expect(back.map((d) => d.color)).toEqual(['#f472b6', '#4a9eff']);
  });

  it('falls back to the defaults rather than handing back an empty list', () => {
    saveDayMarkDefs([]);
    expect(loadDayMarkDefs()).toEqual(DEFAULT_DAY_MARKS);
  });

  it('discards entries with no id or label', () => {
    localStorage.setItem(
      'dp:markdefs:v1',
      JSON.stringify([
        { id: '', label: 'Nameless', color: '#4a9eff', order: 0 },
        { id: 'ok', label: 'Fine', color: '#4a9eff', order: 1 },
        { id: 'blank', label: '   ', color: '#4a9eff', order: 2 },
      ])
    );
    expect(loadDayMarkDefs().map((d) => d.id)).toEqual(['ok']);
  });

  it('drops a duplicate id, keeping the first', () => {
    localStorage.setItem(
      'dp:markdefs:v1',
      JSON.stringify([
        { id: 'gig', label: 'Gig', color: '#f472b6', order: 0 },
        { id: 'gig', label: 'Gig again', color: '#4a9eff', order: 1 },
      ])
    );
    const back = loadDayMarkDefs();
    expect(back).toHaveLength(1);
    expect(back[0].label).toBe('Gig');
  });

  it('returns the defaults for absent or non-array storage', () => {
    expect(loadDayMarkDefs()).toEqual(DEFAULT_DAY_MARKS);
    localStorage.setItem('dp:markdefs:v1', JSON.stringify({ not: 'an array' }));
    expect(loadDayMarkDefs()).toEqual(DEFAULT_DAY_MARKS);
  });
});

describe('day-mark round trip', () => {
  it('preserves marks across a save and load', () => {
    saveDayMarks({ '2026-11-19': 'travel', '2026-12-03': 'gig' });
    expect(loadDayMarks()).toEqual({ '2026-11-19': 'travel', '2026-12-03': 'gig' });
  });

  it('drops a key that is not a date', () => {
    localStorage.setItem(
      'dp:daymarks:v1',
      JSON.stringify({ '2026-11-19': 'travel', someday: 'gig', '11/19/2026': 'gig' })
    );
    expect(loadDayMarks()).toEqual({ '2026-11-19': 'travel' });
  });

  it('drops a key shaped like a date but naming no real day', () => {
    // The shape check alone let these through, and a record keyed to a day no view
    // can reach is invisible and impossible to delete from the UI.
    localStorage.setItem(
      'dp:daymarks:v1',
      JSON.stringify({
        '2026-13-45': 'gig', // month 13, day 45
        '2026-02-30': 'gig', // February 30th
        '2027-02-29': 'gig', // not a leap year
        '2026-11-19': 'travel',
      })
    );
    expect(loadDayMarks()).toEqual({ '2026-11-19': 'travel' });
  });

  it('keeps a real leap day', () => {
    saveDayMarks({ '2028-02-29': 'gig' });
    expect(loadDayMarks()).toEqual({ '2028-02-29': 'gig' });
  });

  it('drops an empty mark id rather than storing a blank', () => {
    localStorage.setItem(
      'dp:daymarks:v1',
      JSON.stringify({ '2026-11-19': '', '2026-11-20': 'gig' })
    );
    expect(loadDayMarks()).toEqual({ '2026-11-20': 'gig' });
  });

  it('keeps an id whose definition is gone, so it can be reported not hidden', () => {
    // `orphanedMarks` surfaces these; discarding them here would erase the evidence.
    saveDayMarks({ '2026-11-19': 'deleted-mark' });
    expect(loadDayMarks()).toEqual({ '2026-11-19': 'deleted-mark' });
  });

  it('returns an empty object for absent storage', () => {
    expect(loadDayMarks()).toEqual({});
  });
});

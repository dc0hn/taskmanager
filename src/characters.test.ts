import { describe, it, expect } from 'vitest';
import {
  CHARACTERS,
  characterById,
  characterOf,
  drawCharacter,
  sealCharacter,
} from './characters';
import { reckonDay, NO_MODIFIERS, comboMultiplier, COMBO_MAX_RUN } from './progress';
import { DEFAULT_CATEGORIES } from './types';
import type { Block, CategoryKind, WeekRecord } from './types';

const CATS = DEFAULT_CATEGORIES;
const DAY = '2026-07-30';

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  title: 'Work',
  start: 540,
  end: 660,
  category: 'deep',
  completed: true,
  completedAt: 660,
  ...over,
});

const week = (over: Partial<WeekRecord> = {}): WeekRecord => ({
  week: '2026-07-27',
  goals: [],
  credits: [],
  ...over,
});

// ---------------------------------------------------------------------------

describe('the character pool', () => {
  it('holds the eight it was drawn against, in declaration order', () => {
    // A guard, not a preference. `pick` indexes by `seed % length`, so the length and the
    // order are part of the answer for every unsealed week. If this fails, the pool changed
    // and every unsealed draw moved with it — which needs to be a decision.
    expect(CHARACTERS.map((c) => c.id)).toEqual([
      'long-nights',
      'early-frost',
      'fair-weather',
      'high-seas',
      'dry-spell',
      'steady-hand',
      'broad-acres',
      'the-long-haul',
    ]);
  });

  it('gives every character a name and a blurb', () => {
    for (const c of CHARACTERS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(0);
      expect(c.blurb.endsWith('.')).toBe(true);
    }
  });

  it('keeps ids unique, since one is sealed into every week record', () => {
    expect(new Set(CHARACTERS.map((c) => c.id)).size).toBe(CHARACTERS.length);
  });

  it('never reduces a figure, for any block it could be handed', () => {
    // The rule that makes a character weather rather than a punishment: there is no penalty
    // anywhere in this app, and a week that lowered your rate would be one for a draw you
    // did not make. Table-driven across every combination that reaches `weigh`.
    const kinds: CategoryKind[] = ['focus', 'shallow', 'rest', 'neutral'];
    const starts = [0, 8 * 60, 12 * 60, 20 * 60, 23 * 60];
    const durations = [15, 45, 90, 180];
    const stamps = [undefined, 8 * 60, 9 * 60, 660, 1400];
    const priorities: (Block['priority'])[] = ['high', 'normal', undefined];

    for (const c of CHARACTERS) {
      if (!c.weigh) continue;
      for (const kind of kinds) {
        for (const start of starts) {
          for (const minutes of durations) {
            for (const completedAt of stamps) {
              for (const priority of priorities) {
                const b = block({
                  start,
                  end: start + minutes,
                  completedAt,
                  priority,
                });
                const w = c.weigh(b, kind, minutes);
                expect(w, `${c.id} ${kind} ${start} ${minutes} ${completedAt}`).toBeGreaterThanOrEqual(1);
                expect(Number.isFinite(w)).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('never sets a brass rate or combo cap below the house default', () => {
    for (const c of CHARACTERS) {
      if (c.brassRate != null) expect(c.brassRate).toBeGreaterThanOrEqual(0.1);
      if (c.comboMax != null) expect(c.comboMax).toBeGreaterThanOrEqual(COMBO_MAX_RUN);
    }
  });

  it('never returns a negative day bonus', () => {
    for (const c of CHARACTERS) {
      if (!c.dayBonus) continue;
      expect(c.dayBonus({ byCategory: {}, completedCount: 0 })).toBeGreaterThanOrEqual(0);
      expect(
        c.dayBonus({ byCategory: { deep: 100, admin: 50 }, completedCount: 4 })
      ).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('drawing and sealing', () => {
  it('draws the same character for the same week, always', () => {
    expect(drawCharacter('2026-07-27').id).toBe(drawCharacter('2026-07-27').id);
  });

  it('spreads across the pool over a year', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 52; i++) seen.add(drawCharacter(`2026-W${i}`).id);
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });

  it('seals an id into a week that has none', () => {
    const sealed = sealCharacter(week());
    expect(sealed).not.toBeNull();
    expect(sealed!.character).toBe(drawCharacter('2026-07-27').id);
  });

  it('never re-seals a week that already has one', () => {
    // Re-sealing would re-score the week, which is the whole failure the seal prevents.
    expect(sealCharacter(week({ character: 'dry-spell' }))).toBeNull();
  });

  it('reads a sealed id back, and an unknown one as nothing', () => {
    expect(characterOf(week({ character: 'dry-spell' }))?.id).toBe('dry-spell');
    // Not CHARACTERS[0]. A record naming a character this build has never heard of must
    // score as unmodified rather than as whichever one happens to sit at index zero.
    expect(characterOf(week({ character: 'from-the-future' }))).toBeNull();
    expect(characterOf(week())).toBeNull();
    expect(characterOf(undefined)).toBeNull();
    expect(characterById(undefined)).toBeNull();
  });
});

describe('scoring with a character', () => {
  const score = (id: string | null, blocks: Block[]) =>
    reckonDay(DAY, blocks, CATS, {
      boost: 1,
      character: id ? characterById(id) : null,
    }).stat;

  it('is idempotent — same inputs, same stat, twice', () => {
    const blocks = [block()];
    const a = score('the-long-haul', blocks);
    const b = score('the-long-haul', blocks);
    expect(a).toEqual(b);
  });

  it('pays more for a long block under the long haul', () => {
    const long = [block({ start: 540, end: 540 + 120, completedAt: 660 })];
    expect(score('the-long-haul', long).xpEarned).toBeGreaterThan(score(null, long).xpEarned);
  });

  it('leaves a short block alone under the long haul', () => {
    const short = [block({ start: 540, end: 600, completedAt: 600 })];
    expect(score('the-long-haul', short).xpEarned).toBe(score(null, short).xpEarned);
  });

  it('pays more for rest under fair weather, and not for focus', () => {
    const rest = [block({ category: 'break' })];
    const focus = [block({ category: 'deep' })];
    expect(score('fair-weather', rest).xpEarned).toBeGreaterThan(score(null, rest).xpEarned);
    expect(score('fair-weather', focus).xpEarned).toBe(score(null, focus).xpEarned);
  });

  it('mints double brass under a dry spell, without touching XP', () => {
    const blocks = [block()];
    const plain = score(null, blocks);
    const dry = score('dry-spell', blocks);
    expect(dry.xpEarned).toBe(plain.xpEarned);
    expect(dry.brassEarned).toBeGreaterThan(plain.brassEarned);
  });

  it('adds a flat bonus per category under broad acres', () => {
    const spread = [
      block({ id: 'a', category: 'deep' }),
      block({ id: 'b', category: 'admin', start: 660, end: 720, completedAt: 720 }),
    ];
    const gain = score('broad-acres', spread).xpEarned - score(null, spread).xpEarned;
    expect(gain).toBe(60); // two categories × 30
  });

  it('carries runs further under high seas', () => {
    expect(comboMultiplier(7, 8)).toBeGreaterThan(comboMultiplier(7));
    // And never below the house cap, whatever a character asks for.
    expect(comboMultiplier(5, 2)).toBe(comboMultiplier(5));
  });

  it('scores a day with no character exactly as before', () => {
    const blocks = [block()];
    expect(reckonDay(DAY, blocks, CATS, NO_MODIFIERS).stat).toEqual(
      reckonDay(DAY, blocks, CATS).stat
    );
  });

  it('never scores a day lower than it would with no character', () => {
    // The invariant, checked against every character rather than argued for.
    const blocks = [
      block({ id: 'a', category: 'deep', start: 540, end: 660, completedAt: 655 }),
      block({ id: 'b', category: 'break', start: 660, end: 720, completedAt: 725 }),
      block({ id: 'c', category: 'admin', start: 1230, end: 1320, completedAt: 1320 }),
    ];
    const plain = score(null, blocks).xpEarned;
    for (const c of CHARACTERS) {
      expect(score(c.id, blocks).xpEarned, c.id).toBeGreaterThanOrEqual(plain);
    }
  });

  it('shows the day bonus as its own line', () => {
    // A figure you cannot see the source of is untrustworthy, which is why the boost has its
    // own line too.
    const r = reckonDay(DAY, [block()], CATS, {
      boost: 1,
      character: characterById('broad-acres'),
    });
    expect(r.lines.some((l) => l.label === "The week's character")).toBe(true);
  });
});

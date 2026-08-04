import type { Block, CategoryKind, WeekRecord } from './types';
import { wasOnTime } from './progress';
import { pick } from './quests';

// ============================================================================
// Weekly characters — the almanac forecasts
//
// Each week has a character, drawn from its own key, that changes how scoring works for
// seven days. It re-colours everything already in the game rather than adding alongside it,
// which is why eight of them are worth more variety than eight more quests would be.
//
// SEALED, NOT DERIVED. This is the whole of the correctness argument and it is worth
// stating plainly. The character comes from an array indexed by a seeded `pick`, so if
// `CHARACTERS` is ever extended, the same week key resolves to a DIFFERENT character —
// and because scoring is recomputed from blocks on every visit, every day in that week
// would silently re-score at a different rate. Lifetime XP would drift with nothing in the
// record to explain it.
//
// So the id is written into the week record the first time the week is issued, and
// `reckonDay` reads the sealed id and never re-derives it. Weeks that predate this have no
// sealed id and score with no character at all — deliberately NOT backfilled, because
// retroactively re-scoring history is the exact failure the seal exists to prevent.
//
// NO CHARACTER MAY REDUCE A FIGURE. Every `weigh` returns >= 1. This is the "misses are
// silent, no penalties" rule applied to modifiers: a week that lowered your rate would be a
// punishment for a draw you did not make, and there is no penalty anywhere else in this
// app.
// ============================================================================

export interface WeekCharacter {
  id: string;
  name: string;
  blurb: string;
  /** Per-block multiplier, applied inside xpForBlock after the combo term. */
  weigh?: (b: Block, kind: CategoryKind, minutes: number) => number;
  /** Flat XP added once per day, after the cleared bonus, before the boost. */
  dayBonus?: (r: { byCategory: Record<string, number>; completedCount: number }) => number;
  /** Overrides BRASS_PER_XP for days in this week. */
  brassRate?: number;
  /** Overrides COMBO_MAX_RUN for days in this week. */
  comboMax?: number;
}

/**
 * APPEND ONLY. NEVER REORDER. NEVER DELETE.
 *
 * `pick` indexes this by `seed % length`, so the LENGTH is part of the answer for every
 * week key. Changing it re-draws every week that has not been sealed yet — and the sealed
 * ones are safe only because they stopped asking. Retire an entry by leaving it in place;
 * removing it shifts everything after it.
 *
 * There is a test pinning the count and the declaration order so this fails CI rather than
 * failing quietly months later.
 */
export const CHARACTERS: WeekCharacter[] = [
  {
    id: 'long-nights',
    name: 'Long nights',
    blurb: 'Anything worked after eight pays a quarter more.',
    weigh: (b) => (b.start >= 20 * 60 ? 1.25 : 1),
  },
  {
    id: 'early-frost',
    name: 'Early frost',
    blurb: 'Anything finished before nine pays a third more.',
    weigh: (b) => (b.completedAt != null && b.completedAt < 9 * 60 ? 1.3 : 1),
  },
  {
    id: 'fair-weather',
    name: 'Fair weather',
    blurb: 'Rest counts half again. Take the recovery.',
    weigh: (_b, kind) => (kind === 'rest' ? 1.5 : 1),
  },
  {
    id: 'high-seas',
    name: 'High seas',
    blurb: 'Runs carry to eight instead of five.',
    comboMax: 8,
  },
  {
    id: 'dry-spell',
    name: 'Dry spell',
    blurb: 'Brass mints at double. Experience is unchanged.',
    brassRate: 0.2,
  },
  {
    id: 'steady-hand',
    name: 'Steady hand',
    blurb: 'Finishing on time is worth more than usual.',
    weigh: (b) => (wasOnTime(b) ? 1.22 : 1),
  },
  {
    id: 'broad-acres',
    name: 'Broad acres',
    blurb: 'Every distinct category you touch adds thirty.',
    dayBonus: (r) => Object.keys(r.byCategory).length * 30,
  },
  {
    id: 'the-long-haul',
    name: 'The long haul',
    blurb: 'Ninety minutes or more pays a third more.',
    weigh: (_b, _k, minutes) => (minutes >= 90 ? 1.35 : 1),
  },
];

export function characterById(id: string | undefined): WeekCharacter | null {
  if (!id) return null;
  return CHARACTERS.find((c) => c.id === id) ?? null;
}

/**
 * The character a week would draw, if it has not been sealed yet.
 *
 * Only ever called when SEALING. Reading it to decide how a day scores would defeat the
 * point — see the note at the head of this file.
 */
export function drawCharacter(weekKey: string): WeekCharacter {
  return pick(CHARACTERS, `character:${weekKey}`);
}

/**
 * Seal a character into a week record, if it does not have one.
 *
 * Returns null when nothing changed, matching `issueRecurringGoals`, so the rollover can
 * tell whether there is anything to write.
 */
export function sealCharacter(week: WeekRecord): WeekRecord | null {
  if (week.character) return null;
  return { ...week, character: drawCharacter(week.week).id };
}

/**
 * The sealed character of a week, or null.
 *
 * An unknown id resolves to null rather than to a default. A record naming a character this
 * build has never heard of should score as unmodified, not as whichever one happens to sit
 * at index zero.
 */
export function characterOf(week: WeekRecord | undefined): WeekCharacter | null {
  return characterById(week?.character);
}

import type { UserProgress } from './types';
import { standingFor, STAT_RETENTION_DAYS } from './progress';
import { daysBetween, shiftDay } from './streaks';

// ============================================================================
// The shop
//
// Where brass goes. Four decisions shape it:
//
//   XP NEVER FALLS, BRASS DOES. Buying something reduces the balance and raises the
//   lifetime spend; the XP total and the level are untouched. So shopping can never
//   cost you standing, and "earned" stays derivable as balance plus spend.
//
//   STOCK ROTATES. Some items only appear on certain weeks, which is what makes
//   opening the shop worth doing rather than a list you exhaust once. Availability is
//   a pure function of the week key — same rotation on any machine, nothing stored.
//
//   ANYTHING THAT AFFECTS SCORING IS MARKED. A double-XP day is recorded by date, so
//   the record can say which days were boosted. A score you cannot audit is not a
//   score, and a booster that hides itself would quietly corrupt every insight.
//
//   NOTHING HERE BUYS PROGRESS OUTRIGHT. There is no "instant level", because the one
//   thing the whole system is for is the work.
// ============================================================================

export type ShopKind = 'cosmetic' | 'utility' | 'quest' | 'booster';

export interface ShopItem {
  id: string;
  name: string;
  blurb: string;
  kind: ShopKind;
  price: number;
  /** Badge glyph used as the tile mark. */
  glyph: string;
  /** Minimum overall level before it is offered at all. */
  minLevel?: number;
  /**
   * Completed cycles required before this is offered.
   *
   * Locked prestige stock stays VISIBLE and marked rather than hidden. The point of it is
   * to give the sigil weight, and a reward you cannot see is not one you are working
   * toward.
   */
  minPrestige?: number;
  /**
   * Rotating stock. Offered only on weeks where the week index modulo `every`
   * equals `offset`. Absent means always in stock.
   */
  rotation?: { every: number; offset: number };
  /** Consumables can be bought repeatedly, up to `stackLimit`. */
  consumable?: boolean;
  stackLimit?: number;
  /**
   * How many times a permanent upgrade may be bought. Defaults to one.
   *
   * Needed because an extra freeze slot is a permanent upgrade you should be able to
   * buy twice — and treating it as a plain one-off meant the second purchase was
   * refused as "already owned" while the cap check never got a chance to run.
   */
  maxOwned?: number;
  /**
   * Cosmetic slot this fills. Buying a second item for the same slot does not
   * replace the first — both are owned, and one is equipped.
   */
  slot?: 'finish' | 'meter' | 'title' | 'frame';
  /** The value applied when equipped. */
  value?: string;
}

export interface ShopState {
  /** One-off purchases. */
  owned: string[];
  /** Consumable counts by item id. */
  stock: Record<string, number>;
  /** Equipped cosmetic per slot. */
  equipped: Partial<Record<'finish' | 'meter' | 'title' | 'frame', string>>;
  /** Dates a double-XP booster was spent on, so the record can mark them. */
  boostedDates: string[];
  /** Weeks whose wildcard has been rerolled, and how many times. */
  rerolls: Record<string, number>;
  /**
   * Permanent non-cosmetic items that are switched ON. Absent means off.
   *
   * Owning something and using it are separate facts. A freeze slot or an extra
   * wildcard changes how the app scores and what it asks of you, and applying that the
   * instant it is paid for takes the decision away at exactly the moment it should be
   * offered — you bought the option, not the obligation.
   *
   * Stored as what is ON rather than what is off, so a profile written before this
   * existed reads as an empty list, and nothing silently switches itself on when the
   * catalogue grows. See `setActive`.
   */
  active: string[];
}

export function emptyShop(): ShopState {
  return {
    owned: [],
    stock: {},
    equipped: {},
    boostedDates: [],
    rerolls: {},
    active: [],
  };
}

/** The multiplier a boosted day earns. */
export const BOOST_MULTIPLIER = 2;

/** Cap, so a run of purchases cannot turn the score into a purchase history. */
export const MAX_FREEZE_SLOTS = 2;

// ---------------------------------------------------------------------------
// Rotation
// ---------------------------------------------------------------------------

/** Weeks since a fixed Monday, so the rotation is identical everywhere. */
const ROTATION_EPOCH = '2020-01-06';

export function weekIndexOf(weekKey: string): number {
  return Math.floor(daysBetween(ROTATION_EPOCH, weekKey) / 7);
}

export function inStock(item: ShopItem, weekKey: string): boolean {
  if (!item.rotation) return true;
  const { every, offset } = item.rotation;
  return ((weekIndexOf(weekKey) % every) + every) % every === offset;
}

// ---------------------------------------------------------------------------
// The catalogue
// ---------------------------------------------------------------------------

export const CATALOGUE: ShopItem[] = [
  // ---- cosmetics: finishes for the rank sigil ----
  {
    id: 'finish-bronze',
    name: 'Bronze finish',
    blurb: 'Your rank sigil in bronze',
    kind: 'cosmetic',
    price: 240,
    glyph: 'level-5',
    slot: 'finish',
    value: '#c08552',
  },
  {
    id: 'finish-iron',
    name: 'Iron finish',
    blurb: 'Cold grey, for the unsentimental',
    kind: 'cosmetic',
    price: 320,
    glyph: 'level-5',
    minLevel: 10,
    slot: 'finish',
    value: '#9aa3ad',
  },
  {
    id: 'finish-verdigris',
    name: 'Verdigris finish',
    blurb: 'Aged copper. Only some weeks.',
    kind: 'cosmetic',
    price: 460,
    glyph: 'level-10',
    minLevel: 15,
    rotation: { every: 3, offset: 1 },
    slot: 'finish',
    value: '#4fb3a0',
  },
  {
    id: 'finish-gold',
    name: 'Gold finish',
    blurb: 'Unsubtle, and that is the point',
    kind: 'cosmetic',
    price: 900,
    glyph: 'level-25',
    minLevel: 30,
    slot: 'finish',
    value: '#f0c14b',
  },
  {
    id: 'finish-obsidian',
    name: 'Obsidian finish',
    blurb: 'Near-black with a bone edge. Rare stock.',
    kind: 'cosmetic',
    price: 1400,
    glyph: 'prestige-1',
    minLevel: 45,
    rotation: { every: 5, offset: 2 },
    slot: 'finish',
    value: '#d8d2c6',
  },

  // ---- cosmetics: meter styles ----
  {
    id: 'meter-brass',
    name: 'Brass meter',
    blurb: 'Warmer segments on every meter',
    kind: 'cosmetic',
    price: 200,
    glyph: 'big-day',
    slot: 'meter',
    value: '#d99a2b',
  },
  {
    id: 'meter-signal',
    name: 'Signal meter',
    blurb: 'Brighter, harder-edged segments',
    kind: 'cosmetic',
    price: 380,
    glyph: 'big-day',
    minLevel: 12,
    slot: 'meter',
    value: '#ffc65a',
  },
  {
    id: 'meter-bone',
    name: 'Bone meter',
    blurb: 'Quiet. For when amber everywhere is too much.',
    kind: 'cosmetic',
    price: 300,
    glyph: 'flawless',
    rotation: { every: 2, offset: 0 },
    slot: 'meter',
    value: '#ddd8ce',
  },

  // ---- cosmetics: titles ----
  {
    id: 'title-punctual',
    name: 'Title: the Punctual',
    blurb: 'Appended to your rank in the rail',
    kind: 'cosmetic',
    price: 260,
    glyph: 'flawless',
    minLevel: 8,
    slot: 'title',
    value: 'the Punctual',
  },
  {
    id: 'title-unbroken',
    name: 'Title: the Unbroken',
    blurb: 'For a run worth naming',
    kind: 'cosmetic',
    price: 520,
    glyph: 'streak-30',
    minLevel: 20,
    slot: 'title',
    value: 'the Unbroken',
  },
  {
    id: 'title-nocturne',
    name: 'Title: Nocturne',
    blurb: 'Some weeks only',
    kind: 'cosmetic',
    price: 480,
    glyph: 'night-owl',
    rotation: { every: 4, offset: 3 },
    slot: 'title',
    value: 'Nocturne',
  },
  {
    id: 'title-cartographer',
    name: 'Title: Cartographer',
    blurb: 'Reserved for the long haul',
    kind: 'cosmetic',
    price: 1100,
    glyph: 'hundred-days-kept',
    minLevel: 40,
    slot: 'title',
    value: 'Cartographer',
  },

  // ---- cosmetics: shelf frames ----
  {
    id: 'frame-engraved',
    name: 'Engraved frames',
    blurb: 'A harder edge on every earned badge',
    kind: 'cosmetic',
    price: 340,
    glyph: 'blocks-50',
    minLevel: 10,
    slot: 'frame',
    value: 'engraved',
  },
  {
    id: 'frame-plain',
    name: 'Plain frames',
    blurb: 'No edge at all. Restraint, purchased.',
    kind: 'cosmetic',
    price: 180,
    glyph: 'blocks-10',
    slot: 'frame',
    value: 'plain',
  },

  // ---- utility ----
  {
    id: 'freeze-slot',
    name: 'Extra freeze slot',
    blurb: 'Hold one more streak freeze, permanently',
    kind: 'utility',
    price: 700,
    glyph: 'streak-7',
    minLevel: 6,
    maxOwned: MAX_FREEZE_SLOTS,
  },
  {
    id: 'freeze-refill',
    name: 'Freeze refill',
    blurb: 'Top your freezes back up now',
    kind: 'utility',
    price: 180,
    glyph: 'streak-7',
    consumable: true,
    stackLimit: 3,
  },

  // ---- quest control ----
  {
    id: 'quest-reroll',
    name: 'Wildcard reroll',
    blurb: "Redraw this week's wildcard quest",
    kind: 'quest',
    price: 220,
    glyph: 'big-day',
    consumable: true,
    stackLimit: 3,
  },
  {
    id: 'quest-extra',
    name: 'Second wildcard',
    blurb: 'Carry an extra wildcard every week, permanently',
    kind: 'quest',
    price: 950,
    glyph: 'level-10',
    minLevel: 18,
  },

  // ---- instruments: permanent, small, compounding ----
  //
  // What gives a long-running profile texture. Deliberately none of them touch scoring:
  // the two the hand-off proposed that did are addressed in the note at the end of this
  // block.
  {
    id: 'inst-loupe',
    name: 'Loupe',
    blurb: 'One more codex card in view at a time',
    kind: 'utility',
    price: 600,
    glyph: 'early-bird',
  },
  {
    id: 'inst-almanac-hand',
    name: 'Almanac hand',
    blurb: 'The week strip names each day\u2019s character alongside its load',
    kind: 'utility',
    price: 700,
    glyph: 'big-day',
  },
  {
    id: 'inst-brass-scales',
    name: 'Brass scales',
    blurb: 'Brass mints five percent faster, for good',
    kind: 'utility',
    price: 1600,
    glyph: 'flawless',
    minLevel: 20,
  },

  // ---- consumables that create a decision, not top-ups ----
  {
    id: 'use-assay',
    name: 'Assay',
    blurb: 'Name the next badge you have not earned',
    kind: 'utility',
    price: 150,
    glyph: 'first-block',
    consumable: true,
    stackLimit: 5,
  },
  {
    id: 'use-bench-day',
    name: 'Bench day',
    blurb: 'Name a day ahead. It cannot break a run.',
    kind: 'utility',
    price: 250,
    glyph: 'streak-7',
    consumable: true,
    stackLimit: 3,
  },
  {
    id: 'use-reprieve',
    name: 'Reprieve',
    blurb: 'Hold yesterday\u2019s run without spending a freeze',
    kind: 'utility',
    price: 300,
    glyph: 'streak-14',
    consumable: true,
    stackLimit: 2,
  },
  {
    id: 'use-double-bill',
    name: 'Double bill',
    blurb: 'Two wildcards this week instead of one',
    kind: 'quest',
    price: 400,
    glyph: 'big-day',
    consumable: true,
    stackLimit: 2,
  },

  // ---- prestige stock: visible from the start, locked until a cycle is done ----
  {
    id: 'title-almanacker',
    name: 'Title: Almanacker',
    blurb: 'For a second pass through the ranks',
    kind: 'cosmetic',
    price: 1800,
    glyph: 'prestige-1',
    minPrestige: 1,
    slot: 'title',
    value: 'Almanacker',
  },
  {
    id: 'finish-meridian',
    name: 'Meridian finish',
    blurb: 'Only for a cycle completed',
    kind: 'cosmetic',
    price: 2200,
    glyph: 'prestige-1',
    minPrestige: 1,
    slot: 'finish',
    value: '#7fd4ff',
  },

  /*
   * THREE ITEMS FROM THE HAND-OFF ARE DELIBERATELY NOT HERE.
   *
   *   `inst-second-hand` sold the week strip's trailing four-week shadow for 700 brass.
   *   That shipped free before this list was written, and taking a working feature away in
   *   order to sell it back is the one move that would make the shop feel worse.
   *   `inst-almanac-hand` above fills its slot with something that does not already exist.
   *
   *   `inst-ledger-rule` raised STAT_RETENTION_DAYS from 400 to 800. That reintroduces the
   *   exact bug `withinRetention` exists to prevent: days 401-800 would start passing the
   *   window again, but their stats were pruned long ago, so reconciliation would find no
   *   stored figure and add the WHOLE day rather than a delta. Buying it would inflate the
   *   lifetime total by every pruned day the month view then touched. It needs to raise
   *   retention forward-only from the purchase date to be safe, which is a different item.
   *
   *   `inst-sandglass` widened the punctuality window, which is a scoring input. It would
   *   have to be sealed per week exactly as a character is, or buying it retroactively
   *   re-scores every day already recorded. Worth building on top of the sealing that now
   *   exists; not worth shipping without it.
   */

  // ---- boosters ----
  {
    id: 'boost-day',
    name: 'Double-XP day',
    blurb: 'Doubles a chosen day. Marked as boosted in the record.',
    kind: 'booster',
    price: 500,
    glyph: 'big-day',
    minLevel: 5,
    consumable: true,
    stackLimit: 2,
  },
];

export function itemById(id: string): ShopItem | undefined {
  return CATALOGUE.find((i) => i.id === id);
}

// ---------------------------------------------------------------------------
// Availability and purchase
// ---------------------------------------------------------------------------

export type Unavailable =
  | 'owned'
  | 'level'
  | 'prestige'
  | 'rotation'
  | 'brass'
  | 'stack'
  | 'cap';

export interface Offer {
  item: ShopItem;
  /** True when it can be bought right now. */
  canBuy: boolean;
  /** Why not, when it cannot. */
  reason: Unavailable | null;
  owned: boolean;
  held: number;
  /** Level needed, when that is what blocks it. */
  needsLevel: number | null;
}

// ---------------------------------------------------------------------------
// Switching an owned item on and off
// ---------------------------------------------------------------------------

/**
 * Whether an item can be switched at all.
 *
 * Cosmetics are excluded because they already have a better answer: a slot holds one
 * item, so `equip` IS the switch, and giving them a second on/off state would let a
 * finish be both equipped and inactive with no way to tell which was meant.
 *
 * Consumables are excluded because a switch is the wrong shape for them entirely.
 * They are not worn, they are spent — the decision is WHEN, not whether, and that is
 * what `stock` and the spend functions below already model.
 */
export function togglable(item: ShopItem): boolean {
  return !item.slot && !item.consumable;
}

/** Whether an owned permanent is currently in effect. */
export function isActive(shop: ShopState, itemId: string): boolean {
  return shop.active.includes(itemId);
}

/**
 * Switch an owned permanent on or off.
 *
 * Refuses anything not owned, so a profile cannot carry an active item it never
 * bought, and refuses cosmetics and consumables per `togglable`. Idempotent in both
 * directions, which is what lets the caller send the intended STATE rather than
 * having to know the current one.
 */
export function setActive(shop: ShopState, itemId: string, on: boolean): ShopState {
  const item = itemById(itemId);
  if (!item || !togglable(item) || !shop.owned.includes(itemId)) return shop;
  const already = shop.active.includes(itemId);
  if (already === on) return shop;
  return {
    ...shop,
    active: on
      ? [...shop.active, itemId]
      : shop.active.filter((id) => id !== itemId),
  };
}

/** How many of a permanent item are held. `owned` is a multiset for this reason. */
export function ownedCount(shop: ShopState, itemId: string): number {
  return shop.owned.filter((id) => id === itemId).length;
}

/**
 * Extra freeze slots held.
 *
 * Derived from purchases rather than stored alongside them, so the two can never
 * disagree — the same reasoning that made lifetime brass earnings derived.
 */
export function freezeSlots(shop: ShopState): number {
  // Owned but switched off contributes nothing. The slot is a capacity you have
  // bought the right to use, not one that turns itself on the moment it is paid for.
  if (!isActive(shop, 'freeze-slot')) return 0;
  return Math.min(MAX_FREEZE_SLOTS, ownedCount(shop, 'freeze-slot'));
}

export function offersFor(
  shop: ShopState,
  progress: UserProgress,
  weekKey: string
): Offer[] {
  const level = standingFor(progress.totalXp).level;
  const prestige = standingFor(progress.totalXp).prestige;
  // A later cycle should not re-lock what an earlier one already reached.
  const effectiveLevel = prestige > 0 ? 60 : level;

  return CATALOGUE.filter((item) => inStock(item, weekKey) || shop.owned.includes(item.id))
    .map((item) => {
      const copies = ownedCount(shop, item.id);
      const limit = item.maxOwned ?? 1;
      const owned = copies > 0;
      const held = shop.stock[item.id] ?? 0;

      let reason: Unavailable | null = null;
      // `cap` rather than `owned` once a repeatable upgrade is exhausted, so the
      // message can say "that is as many as you can hold".
      if (!item.consumable && copies >= limit) reason = limit > 1 ? 'cap' : 'owned';
      else if (item.minPrestige != null && prestige < item.minPrestige) reason = 'prestige';
      else if (item.minLevel != null && effectiveLevel < item.minLevel) reason = 'level';
      else if (!inStock(item, weekKey)) reason = 'rotation';
      else if (item.consumable && held >= (item.stackLimit ?? 1)) reason = 'stack';
      else if (progress.brass < item.price) reason = 'brass';

      return {
        item,
        canBuy: reason === null,
        reason,
        owned,
        held: item.consumable ? held : copies,
        needsLevel: reason === 'level' ? (item.minLevel ?? null) : null,
      };
    });
}

export interface PurchaseResult {
  ok: boolean;
  /** Why it was refused, for the message. */
  reason: Unavailable | null;
  shop: ShopState;
  /** Brass to deduct and add to lifetime spend. */
  spend: number;
}

/**
 * Buy something.
 *
 * Refuses rather than clamping. A purchase that silently did less than asked — half a
 * refill, a cosmetic you already owned — would be worse than a refusal, because the
 * brass would be gone either way.
 */
export function purchase(
  shop: ShopState,
  progress: UserProgress,
  weekKey: string,
  itemId: string
): PurchaseResult {
  const offer = offersFor(shop, progress, weekKey).find((o) => o.item.id === itemId);
  if (!offer) return { ok: false, reason: 'rotation', shop, spend: 0 };
  if (!offer.canBuy) return { ok: false, reason: offer.reason, shop, spend: 0 };

  const { item } = offer;
  const next: ShopState = {
    ...shop,
    owned: [...shop.owned],
    active: [...shop.active],
    stock: { ...shop.stock },
    equipped: { ...shop.equipped },
    boostedDates: [...shop.boostedDates],
    rerolls: { ...shop.rerolls },
  };

  if (item.consumable) {
    next.stock[item.id] = (next.stock[item.id] ?? 0) + 1;
  } else {
    next.owned.push(item.id);
    // A cosmetic equips itself on purchase. Buying a look and then having to find a
    // second control to apply it is a needless step.
    if (item.slot && item.value) next.equipped[item.slot] = item.id;
  }

  return { ok: true, reason: null, shop: next, spend: item.price };
}

/** Equip something already owned. */
export function equip(shop: ShopState, itemId: string): ShopState {
  const item = itemById(itemId);
  if (!item?.slot || !shop.owned.includes(itemId)) return shop;
  return { ...shop, equipped: { ...shop.equipped, [item.slot]: itemId } };
}

/** Clear a slot back to the default look. */
export function unequip(shop: ShopState, slot: NonNullable<ShopItem['slot']>): ShopState {
  const equipped = { ...shop.equipped };
  delete equipped[slot];
  return { ...shop, equipped };
}

/** The value in effect for a slot, or null for the default. */
export function equippedValue(
  shop: ShopState,
  slot: NonNullable<ShopItem['slot']>
): string | null {
  const id = shop.equipped[slot];
  if (!id) return null;
  return itemById(id)?.value ?? null;
}

// ---------------------------------------------------------------------------
// Spending consumables
// ---------------------------------------------------------------------------

export interface ConsumeResult {
  ok: boolean;
  shop: ShopState;
}

function take(shop: ShopState, itemId: string): ShopState | null {
  const held = shop.stock[itemId] ?? 0;
  if (held <= 0) return null;
  const stock = { ...shop.stock, [itemId]: held - 1 };
  if (stock[itemId] === 0) delete stock[itemId];
  return { ...shop, stock };
}

/** Spend a refill. The caller applies the freeze to the streak record. */
export function spendRefill(shop: ShopState): ConsumeResult {
  const next = take(shop, 'freeze-refill');
  return next ? { ok: true, shop: next } : { ok: false, shop };
}

/**
 * Spend a booster on a day. Refuses a day already boosted.
 *
 * Note what this does NOT do: cap the list by length. It used to keep the last sixty,
 * and a count cap on this particular list is a retroactive clawback waiting to happen.
 * Reconciliation recomputes a day's XP from its blocks on every visit, so the moment a
 * date fell off the end its boost silently became a one — and the next time the month
 * view loaded that day, the delta took the doubled half of its XP straight back out of
 * the lifetime total, months after it was earned.
 *
 * Growth is not a concern: an entry costs a purchased booster, so the list is rate
 * limited by brass, and `pruneBoostedDates` trims by date on load.
 */
export function spendBoost(shop: ShopState, date: string): ConsumeResult {
  if (shop.boostedDates.includes(date)) return { ok: false, shop };
  const next = take(shop, 'boost-day');
  if (!next) return { ok: false, shop };
  return { ok: true, shop: { ...next, boostedDates: [...next.boostedDates, date] } };
}

/**
 * Drop boosted dates that no reconciliation can reach any more.
 *
 * Bounded by DATE against the same window day stats use, not by count. Once a day is
 * outside the retention window it is never reconciled again, so forgetting its boost
 * costs nothing — its XP is already banked in the lifetime total and its stat is gone.
 * That is the difference between this and a length cap: one drops records that can no
 * longer change an answer, the other drops records that still can.
 */
export function pruneBoostedDates(dates: string[], today: string): string[] {
  const cutoff = shiftDay(today, -STAT_RETENTION_DAYS);
  return dates.filter((d) => d >= cutoff);
}

/** Spend a reroll on this week's wildcard. */
export function spendReroll(shop: ShopState, weekKey: string): ConsumeResult {
  const next = take(shop, 'quest-reroll');
  if (!next) return { ok: false, shop };
  return {
    ok: true,
    shop: { ...next, rerolls: { ...next.rerolls, [weekKey]: (next.rerolls[weekKey] ?? 0) + 1 } },
  };
}

export function isBoosted(shop: ShopState, date: string): boolean {
  return shop.boostedDates.includes(date);
}

export function boostFor(shop: ShopState, date: string): number {
  return isBoosted(shop, date) ? BOOST_MULTIPLIER : 1;
}

export function rerollsFor(shop: ShopState, weekKey: string): number {
  return shop.rerolls[weekKey] ?? 0;
}

export function hasExtraWildcard(shop: ShopState): boolean {
  return shop.owned.includes('quest-extra') && isActive(shop, 'quest-extra');
}

/** How many freezes the streak may hold, given what has been bought. */
export function freezeCapacity(shop: ShopState, base: number): number {
  return base + freezeSlots(shop);
}

/** Items in stock this week that were not last week, for the "new this week" line. */
export function newThisWeek(weekKey: string, previousWeekKey: string): ShopItem[] {
  return CATALOGUE.filter(
    (i) => i.rotation && inStock(i, weekKey) && !inStock(i, previousWeekKey)
  );
}

export { standingFor };

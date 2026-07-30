import type { UserProgress } from './types';
import { standingFor } from './progress';
import { daysBetween } from './streaks';

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
}

export function emptyShop(): ShopState {
  return {
    owned: [],
    stock: {},
    equipped: {},
    boostedDates: [],
    rerolls: {},
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

export type Unavailable = 'owned' | 'level' | 'rotation' | 'brass' | 'stack' | 'cap';

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

/** Spend a booster on a day. Refuses a day already boosted. */
export function spendBoost(shop: ShopState, date: string): ConsumeResult {
  if (shop.boostedDates.includes(date)) return { ok: false, shop };
  const next = take(shop, 'boost-day');
  if (!next) return { ok: false, shop };
  return { ok: true, shop: { ...next, boostedDates: [...next.boostedDates, date].slice(-60) } };
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
  return shop.owned.includes('quest-extra');
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

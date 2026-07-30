import { describe, it, expect } from 'vitest';
import {
  BOOST_MULTIPLIER,
  boostFor,
  CATALOGUE,
  emptyShop,
  equip,
  equippedValue,
  freezeCapacity,
  freezeSlots,
  hasExtraWildcard,
  inStock,
  isBoosted,
  itemById,
  MAX_FREEZE_SLOTS,
  newThisWeek,
  offersFor,
  purchase,
  rerollsFor,
  spendBoost,
  spendRefill,
  spendReroll,
  unequip,
  weekIndexOf,
} from './shop';
import { emptyProgress, CYCLE_XP, xpToReachLevel } from './progress';
import type { UserProgress } from './types';

const WEEK = '2026-07-27';

function rich(brass: number, level = 60): UserProgress {
  return {
    ...emptyProgress(),
    totalXp: level >= 60 ? CYCLE_XP - 1 : xpToReachLevel(level),
    brass,
  };
}

function shiftWeeks(weekKey: string, n: number): string {
  const [y, m, d] = weekKey.split('-').map(Number);
  const out = new Date(Date.UTC(y, m - 1, d) + n * 7 * 86_400_000);
  return `${out.getUTCFullYear()}-${String(out.getUTCMonth() + 1).padStart(2, '0')}-${String(out.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------

describe('the catalogue', () => {
  it('has no duplicate ids', () => {
    expect(new Set(CATALOGUE.map((i) => i.id)).size).toBe(CATALOGUE.length);
  });

  it('gives every item a name, blurb, price and glyph', () => {
    for (const i of CATALOGUE) {
      expect(i.name.length).toBeGreaterThan(0);
      expect(i.blurb.length).toBeGreaterThan(0);
      expect(i.price).toBeGreaterThan(0);
      expect(i.glyph.length).toBeGreaterThan(0);
    }
  });

  it('sells nothing that buys progress outright', () => {
    // The one thing the whole system is for is the work.
    for (const i of CATALOGUE) {
      expect(i.id).not.toMatch(/level|xp-gift|instant/);
    }
  });

  it('gives every cosmetic a slot and a value', () => {
    for (const i of CATALOGUE.filter((x) => x.kind === 'cosmetic')) {
      expect(i.slot).toBeTruthy();
      expect(i.value).toBeTruthy();
    }
  });

  it('gives every consumable a stack limit', () => {
    for (const i of CATALOGUE.filter((x) => x.consumable)) {
      expect(i.stackLimit).toBeGreaterThan(0);
    }
  });

  it('stocks all four kinds', () => {
    expect(new Set(CATALOGUE.map((i) => i.kind))).toEqual(
      new Set(['cosmetic', 'utility', 'quest', 'booster'])
    );
  });

  it('keeps some stock rotating and some always available', () => {
    expect(CATALOGUE.some((i) => i.rotation)).toBe(true);
    expect(CATALOGUE.some((i) => !i.rotation)).toBe(true);
  });
});

describe('rotation', () => {
  it('counts weeks from a fixed Monday, so it matches everywhere', () => {
    expect(weekIndexOf('2020-01-06')).toBe(0);
    expect(weekIndexOf('2020-01-13')).toBe(1);
    expect(weekIndexOf(WEEK)).toBeGreaterThan(300);
  });

  it('always stocks an item with no rotation', () => {
    const always = CATALOGUE.find((i) => !i.rotation)!;
    for (let i = 0; i < 8; i++) {
      expect(inStock(always, shiftWeeks(WEEK, i))).toBe(true);
    }
  });

  it('stocks a rotating item on some weeks and not others', () => {
    const rotating = CATALOGUE.find((i) => i.rotation)!;
    const weeks = Array.from({ length: 10 }, (_, i) => inStock(rotating, shiftWeeks(WEEK, i)));
    expect(weeks).toContain(true);
    expect(weeks).toContain(false);
  });

  it('is stable for the same week', () => {
    const rotating = CATALOGUE.find((i) => i.rotation)!;
    expect(inStock(rotating, WEEK)).toBe(inStock(rotating, WEEK));
  });

  it('reports what is newly in stock this week', () => {
    const rotating = CATALOGUE.filter((i) => i.rotation);
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      const w = shiftWeeks(WEEK, i);
      const prev = shiftWeeks(WEEK, i - 1);
      if (newThisWeek(w, prev).length > 0) found = true;
    }
    expect(rotating.length).toBeGreaterThan(0);
    expect(found).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe('offers', () => {
  it('hides an out-of-stock item you do not own', () => {
    const rotating = CATALOGUE.find((i) => i.rotation)!;
    let offWeek = WEEK;
    for (let i = 0; i < 12; i++) {
      const w = shiftWeeks(WEEK, i);
      if (!inStock(rotating, w)) {
        offWeek = w;
        break;
      }
    }
    const ids = offersFor(emptyShop(), rich(9999), offWeek).map((o) => o.item.id);
    expect(ids).not.toContain(rotating.id);
  });

  it('keeps showing something you already own even out of stock', () => {
    // Otherwise an owned cosmetic would vanish from the wardrobe on the wrong week.
    const rotating = CATALOGUE.find((i) => i.rotation && i.slot)!;
    const shop = { ...emptyShop(), owned: [rotating.id] };
    let offWeek = WEEK;
    for (let i = 0; i < 12; i++) {
      const w = shiftWeeks(WEEK, i);
      if (!inStock(rotating, w)) {
        offWeek = w;
        break;
      }
    }
    const offer = offersFor(shop, rich(9999), offWeek).find((o) => o.item.id === rotating.id);
    expect(offer).toBeDefined();
    expect(offer!.owned).toBe(true);
  });

  it('refuses on brass', () => {
    const offer = offersFor(emptyShop(), rich(0), WEEK).find((o) => o.item.id === 'meter-brass')!;
    expect(offer.canBuy).toBe(false);
    expect(offer.reason).toBe('brass');
  });

  it('refuses on level, and says which level', () => {
    const progress = { ...emptyProgress(), brass: 9999, totalXp: xpToReachLevel(2) };
    const offer = offersFor(emptyShop(), progress, WEEK).find((o) => o.item.id === 'finish-gold')!;
    expect(offer.reason).toBe('level');
    expect(offer.needsLevel).toBe(30);
  });

  it('never re-locks a level gate after a prestige', () => {
    // Level resets to 1 at prestige. Re-locking a cosmetic you already qualified for
    // would make prestige a punishment.
    const afterPrestige = { ...emptyProgress(), brass: 9999, totalXp: CYCLE_XP + 10 };
    const offer = offersFor(emptyShop(), afterPrestige, WEEK).find(
      (o) => o.item.id === 'finish-gold'
    )!;
    expect(offer.reason).not.toBe('level');
  });

  it('refuses a one-off already owned', () => {
    const shop = { ...emptyShop(), owned: ['meter-brass'] };
    const offer = offersFor(shop, rich(9999), WEEK).find((o) => o.item.id === 'meter-brass')!;
    expect(offer.reason).toBe('owned');
  });

  it('refuses a consumable already at its stack limit', () => {
    const item = itemById('freeze-refill')!;
    const shop = { ...emptyShop(), stock: { 'freeze-refill': item.stackLimit! } };
    const offer = offersFor(shop, rich(9999), WEEK).find((o) => o.item.id === 'freeze-refill')!;
    expect(offer.reason).toBe('stack');
  });

  it('refuses another freeze slot at the cap', () => {
    const shop = { ...emptyShop(), owned: Array(MAX_FREEZE_SLOTS).fill('freeze-slot') };
    const offer = offersFor(shop, rich(9999), WEEK).find((o) => o.item.id === 'freeze-slot')!;
    expect(offer.reason).toBe('cap');
  });
});

// ---------------------------------------------------------------------------

describe('purchase', () => {
  it('buys a cosmetic and equips it immediately', () => {
    // Buying a look and then hunting for a second control to apply it is a needless
    // step.
    const r = purchase(emptyShop(), rich(9999), WEEK, 'meter-brass');
    expect(r.ok).toBe(true);
    expect(r.spend).toBe(itemById('meter-brass')!.price);
    expect(r.shop.owned).toContain('meter-brass');
    expect(r.shop.equipped.meter).toBe('meter-brass');
  });

  it('refuses rather than clamping', () => {
    // A purchase that silently did less than asked would be worse than a refusal,
    // because the brass would be gone either way.
    const r = purchase(emptyShop(), rich(0), WEEK, 'meter-brass');
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('brass');
    expect(r.spend).toBe(0);
    expect(r.shop.owned).toEqual([]);
  });

  it('leaves the original state untouched on success', () => {
    const before = emptyShop();
    purchase(before, rich(9999), WEEK, 'meter-brass');
    expect(before.owned).toEqual([]);
  });

  it('stacks a consumable', () => {
    let shop = emptyShop();
    shop = purchase(shop, rich(9999), WEEK, 'freeze-refill').shop;
    shop = purchase(shop, rich(9999), WEEK, 'freeze-refill').shop;
    expect(shop.stock['freeze-refill']).toBe(2);
  });

  it('raises the freeze slot count, up to the cap', () => {
    let shop = emptyShop();
    for (let i = 0; i < 5; i++) {
      const r = purchase(shop, rich(99999), WEEK, 'freeze-slot');
      if (r.ok) shop = r.shop;
    }
    expect(freezeSlots(shop)).toBe(MAX_FREEZE_SLOTS);
  });

  it('refuses an unknown id', () => {
    expect(purchase(emptyShop(), rich(9999), WEEK, 'nonsense').ok).toBe(false);
  });
});

describe('equipping', () => {
  it('switches between two owned items in the same slot', () => {
    let shop = { ...emptyShop(), owned: ['meter-brass', 'meter-bone'] };
    shop = equip(shop, 'meter-brass');
    expect(equippedValue(shop, 'meter')).toBe(itemById('meter-brass')!.value);
    shop = equip(shop, 'meter-bone');
    expect(equippedValue(shop, 'meter')).toBe(itemById('meter-bone')!.value);
  });

  it('refuses to equip what is not owned', () => {
    const shop = equip(emptyShop(), 'meter-brass');
    expect(shop.equipped.meter).toBeUndefined();
  });

  it('clears back to the default look', () => {
    let shop = { ...emptyShop(), owned: ['meter-brass'] };
    shop = equip(shop, 'meter-brass');
    shop = unequip(shop, 'meter');
    expect(equippedValue(shop, 'meter')).toBeNull();
  });

  it('reports null for an empty slot', () => {
    expect(equippedValue(emptyShop(), 'title')).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe('consumables', () => {
  it('spends a refill and refuses when there are none', () => {
    const stocked = { ...emptyShop(), stock: { 'freeze-refill': 1 } };
    const first = spendRefill(stocked);
    expect(first.ok).toBe(true);
    expect(first.shop.stock['freeze-refill']).toBeUndefined();
    expect(spendRefill(first.shop).ok).toBe(false);
  });

  it('boosts a day, once', () => {
    const stocked = { ...emptyShop(), stock: { 'boost-day': 2 } };
    const first = spendBoost(stocked, '2026-07-30');
    expect(first.ok).toBe(true);
    expect(isBoosted(first.shop, '2026-07-30')).toBe(true);
    expect(boostFor(first.shop, '2026-07-30')).toBe(BOOST_MULTIPLIER);

    // The same day cannot be boosted twice, even with stock left.
    const second = spendBoost(first.shop, '2026-07-30');
    expect(second.ok).toBe(false);
    expect(second.shop.stock['boost-day']).toBe(1);
  });

  it('leaves an unboosted day at a multiplier of one', () => {
    expect(boostFor(emptyShop(), '2026-07-30')).toBe(1);
  });

  it('records boosted days so the score can be audited', () => {
    // A booster that hid itself would quietly corrupt every insight downstream.
    const stocked = { ...emptyShop(), stock: { 'boost-day': 1 } };
    const r = spendBoost(stocked, '2026-07-30');
    expect(r.shop.boostedDates).toContain('2026-07-30');
  });

  it('spends a reroll against the week it was used on', () => {
    const stocked = { ...emptyShop(), stock: { 'quest-reroll': 1 } };
    const r = spendReroll(stocked, WEEK);
    expect(r.ok).toBe(true);
    expect(rerollsFor(r.shop, WEEK)).toBe(1);
    expect(rerollsFor(r.shop, '2026-08-03')).toBe(0);
    expect(spendReroll(r.shop, WEEK).ok).toBe(false);
  });
});

describe('permanent upgrades', () => {
  it('raises freeze capacity by what was bought', () => {
    expect(freezeCapacity(emptyShop(), 1)).toBe(1);
    expect(freezeCapacity({ ...emptyShop(), owned: ['freeze-slot', 'freeze-slot'] }, 1)).toBe(3);
  });

  it('never raises capacity past the cap, whatever the record says', () => {
    expect(freezeCapacity({ ...emptyShop(), owned: Array(99).fill('freeze-slot') }, 1)).toBe(
      1 + MAX_FREEZE_SLOTS
    );
  });

  it('reports the extra wildcard', () => {
    expect(hasExtraWildcard(emptyShop())).toBe(false);
    expect(hasExtraWildcard({ ...emptyShop(), owned: ['quest-extra'] })).toBe(true);
  });
});

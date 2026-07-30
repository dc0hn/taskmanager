import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ShopKind, ShopState, Offer, Unavailable } from '../shop';
import { itemById, newThisWeek } from '../shop';
import { motion, useReducedMotion } from 'framer-motion';
import { DUR } from '../utils/motion';
import BadgeGlyph from './pixel/BadgeGlyph';
import Figure from './Figure';

// ============================================================================
// ShopPanel
//
// Where brass goes.
//
// Two things this has to communicate that a plain list would not:
//
//   WHY SOMETHING CANNOT BE BOUGHT. "Locked" is useless. Each refused tile says the
//   actual reason — short by so much brass, needs level 30, out of stock this week —
//   because the difference between "come back richer" and "come back Thursday" is the
//   whole point of a rotating shop.
//
//   THAT A BOOSTER IS NOT FREE. The double-XP day says on the tile that boosted days
//   are marked in the record. Anything affecting the score has to admit it at the
//   point of sale, not in a footnote.
// ============================================================================

const KIND_LABEL: Record<ShopKind, string> = {
  cosmetic: 'Finishes and titles',
  utility: 'The safety net',
  quest: 'The board',
  booster: 'Boosters',
};

const KIND_BLURB: Record<ShopKind, string> = {
  cosmetic: 'Looks only. Nothing here touches the score.',
  utility: 'Protects a run you have already earned.',
  quest: 'Changes what the board asks of you.',
  booster: 'Affects the score, and says so.',
};

const KIND_ORDER: ShopKind[] = ['utility', 'quest', 'booster', 'cosmetic'];

function reasonText(offer: Offer, brass: number): string {
  const map: Record<Unavailable, string> = {
    owned: 'owned',
    cap: 'as many as you can hold',
    level: `needs level ${offer.needsLevel}`,
    prestige: 'needs a completed cycle',
    rotation: 'not in stock this week',
    brass: `${(offer.item.price - brass).toLocaleString()} more brass`,
    stack: `holding ${offer.held} already`,
  };
  return offer.reason ? map[offer.reason] : '';
}

interface Props {
  offers: Offer[];
  shop: ShopState;
  brass: number;
  spent: number;
  weekKey: string;
  previousWeekKey: string;
  onBuy: (itemId: string) => void;
  onEquip: (itemId: string) => void;
  onUnequip: (slot: 'finish' | 'meter' | 'title' | 'frame') => void;
}

function ShopPanel({
  offers,
  shop,
  brass,
  spent,
  weekKey,
  previousWeekKey,
  onBuy,
  onEquip,
  onUnequip,
}: Props) {
  const fresh = useMemo(
    () => newThisWeek(weekKey, previousWeekKey),
    [weekKey, previousWeekKey]
  );

  /**
   * True for a moment after the balance changes.
   *
   * Keyed on the balance rather than on a purchase callback, because brass also arrives
   * from completing work and being paid a bonus — the balance moving is the fact worth
   * marking, not one particular route to it.
   */
  const reduced = useReducedMotion() ?? false;
  const [flash, setFlash] = useState(false);
  const previousBrass = useRef(brass);
  useEffect(() => {
    if (previousBrass.current === brass) return;
    previousBrass.current = brass;
    setFlash(true);
    const id = window.setTimeout(() => setFlash(false), 220);
    return () => window.clearTimeout(id);
  }, [brass]);

  const grouped = useMemo(() => {
    const out: Record<ShopKind, Offer[]> = { cosmetic: [], utility: [], quest: [], booster: [] };
    for (const o of offers) out[o.item.kind].push(o);
    // Affordable first, then by price — so the tile you can act on is at the top.
    for (const k of KIND_ORDER) {
      out[k].sort((a, b) => {
        if (a.canBuy !== b.canBuy) return a.canBuy ? -1 : 1;
        return a.item.price - b.item.price;
      });
    }
    return out;
  }, [offers]);

  return (
    <div>
      <div className="flex items-baseline gap-4 flex-wrap mb-1">
        <span className="flex items-baseline gap-1.5">
          <span
            style={{
              display: 'inline-block',
              width: 8,
              height: 8,
              background: 'var(--signal)',
              transform: 'rotate(45deg)',
            }}
            aria-hidden
          />
          {/*
            The balance flashes when it moves, then counts to its new figure.

            A purchase used to be a toast and a silently different number — the one moment
            in the shop where something is actually spent, and nothing on the balance said
            so. The flash marks that it changed; the count says by how much.
          */}
          <motion.span
            className="font-mono tnum"
            style={{ fontSize: 20, fontWeight: 700 }}
            initial={false}
            animate={{ color: flash ? 'var(--signal)' : 'var(--bone-0)' }}
            transition={
              reduced ? { duration: 0 } : { duration: flash ? DUR.instant : DUR.slow }
            }
          >
            <Figure value={brass} />
          </motion.span>
        </span>
        <span className="font-mono text-nano tnum text-bone-3">
          <Figure value={spent} /> spent all told
        </span>
        {fresh.length > 0 && (
          <span
            className="font-mono text-nano tnum px-1.5"
            style={{ color: 'var(--action-ink)', background: 'var(--signal)' }}
          >
            {fresh.length} NEW THIS WEEK
          </span>
        )}
      </div>
      <p className="text-body-sm text-bone-3 mb-4 max-w-[64ch] leading-relaxed">
        Brass is minted alongside XP and spending it never touches your level. Some
        stock only appears on certain weeks.
      </p>

      {/* What is currently worn, so the wardrobe is not hidden inside the catalogue. */}
      <Equipped shop={shop} onUnequip={onUnequip} onEquip={onEquip} />

      {KIND_ORDER.map((kind) =>
        grouped[kind].length === 0 ? null : (
          <div key={kind} className="mt-5">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="legend">{KIND_LABEL[kind]}</span>
              <span className="font-mono text-nano text-bone-4">{KIND_BLURB[kind]}</span>
            </div>
            <div className="grid gap-1.5 lg:grid-cols-2">
              {grouped[kind].map((offer) => (
                <ShopTile
                  key={offer.item.id}
                  offer={offer}
                  brass={brass}
                  equipped={
                    offer.item.slot != null &&
                    shop.equipped[offer.item.slot] === offer.item.id
                  }
                  onBuy={onBuy}
                  onEquip={onEquip}
                />
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Equipped({
  shop,
  onEquip,
  onUnequip,
}: {
  shop: ShopState;
  onEquip: (id: string) => void;
  onUnequip: (slot: 'finish' | 'meter' | 'title' | 'frame') => void;
}) {
  const slots: ('finish' | 'meter' | 'title' | 'frame')[] = ['finish', 'meter', 'title', 'frame'];
  const anyOwned = shop.owned.some((id) => itemById(id)?.slot != null);
  if (!anyOwned) return null;

  return (
    <div
      className="px-3 py-2.5 mb-1"
      style={{ background: 'var(--chassis-2)', border: '1px solid var(--rule-2)' }}
    >
      <div className="legend mb-2">Worn</div>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {slots.map((slot) => {
          const owned = shop.owned.filter((id) => itemById(id)?.slot === slot);
          if (owned.length === 0) return null;
          const current = shop.equipped[slot];
          return (
            <div key={slot} className="flex items-center gap-2 flex-wrap">
              <span
                className="font-mono text-nano text-bone-3 shrink-0"
                style={{ width: 46 }}
              >
                {slot}
              </span>
              {owned.map((id) => {
                const item = itemById(id)!;
                const on = current === id;
                return (
                  <button
                    key={id}
                    onClick={() => (on ? onUnequip(slot) : onEquip(id))}
                    className="font-mono text-nano px-1.5 py-[2px] transition-colors"
                    style={{
                      color: on ? 'var(--action-ink)' : 'var(--bone-2)',
                      background: on ? 'var(--signal)' : 'var(--chassis-4)',
                    }}
                    title={on ? 'Worn — click to take it off' : `Wear ${item.name}`}
                  >
                    {item.name.replace(/^Title: /, '')}
                  </button>
                );
              })}
              {!current && (
                <span className="font-mono text-nano text-bone-4">default</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShopTile({
  offer,
  brass,
  equipped,
  onBuy,
  onEquip,
}: {
  offer: Offer;
  brass: number;
  equipped: boolean;
  onBuy: (id: string) => void;
  onEquip: (id: string) => void;
}) {
  const { item, canBuy, owned, held } = offer;
  const isConsumable = item.consumable === true;

  return (
    <div
      className="flex items-start gap-2.5 px-2.5 py-2"
      style={{
        background: canBuy ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${canBuy ? 'var(--rule-3)' : 'var(--rule-1)'}`,
        opacity: offer.reason === 'rotation' ? 0.6 : 1,
      }}
    >
      <BadgeGlyph
        badgeId={item.glyph}
        size={22}
        color={canBuy ? 'var(--signal)' : 'var(--bone-4)'}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap">
          <span
            className="text-body-sm"
            style={{ color: 'var(--bone-0)', fontWeight: 600 }}
          >
            {item.name}
          </span>
          {item.rotation && (
            <span className="font-mono text-nano text-bone-4">rotating</span>
          )}
          {isConsumable && held > 0 && (
            <span className="font-mono text-nano" style={{ color: 'var(--signal)' }}>
              holding {held}
            </span>
          )}
          {!isConsumable && owned && held > 1 && (
            <span className="font-mono text-nano" style={{ color: 'var(--signal)' }}>
              ×{held}
            </span>
          )}
        </div>
        <div className="font-mono text-nano text-bone-3 leading-snug mt-0.5">
          {item.blurb}
        </div>
        {!canBuy && (
          <div className="font-mono text-nano text-bone-4 mt-1">
            {reasonText(offer, brass)}
          </div>
        )}
      </div>

      <div className="flex flex-col items-end gap-1 shrink-0">
        <span className="font-mono tnum text-nano" style={{ color: 'var(--bone-2)' }}>
          {item.price.toLocaleString()} ◈
        </span>
        {canBuy ? (
          <button
            onClick={() => onBuy(item.id)}
            className="btn-primary font-mono px-2 h-6"
            style={{ fontSize: 10, letterSpacing: '0.08em' }}
          >
            BUY
          </button>
        ) : owned && item.slot && !equipped ? (
          <button
            onClick={() => onEquip(item.id)}
            className="btn-quiet font-mono px-2 h-6"
            style={{ fontSize: 10, letterSpacing: '0.08em' }}
          >
            WEAR
          </button>
        ) : equipped ? (
          <span className="font-mono text-nano" style={{ color: 'var(--signal)' }}>
            worn
          </span>
        ) : null}
      </div>
    </div>
  );
}

export default memo(ShopPanel);

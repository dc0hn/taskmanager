import { memo, useMemo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { BadgeGroup } from '../types';
import {
  BADGE_TOTAL,
  laddersOf,
  nextUp,
  sortForDisplay,
  standalone,
  type BadgeStatus,
  type LadderStatus,
} from '../badges';
import BadgeGlyph from './pixel/BadgeGlyph';
import PixelMeter from './pixel/PixelMeter';
import PixelBurst from './pixel/PixelBurst';

// ============================================================================
// BadgeShelf
//
// The library, and the moment one unlocks.
//
// Four decisions carry it, three of them corrections after looking at a first pass:
//
//   LADDERS ARE ONE TILE. Four near-identical "complete N blocks" cards taught the
//   eye to skip that whole region. One tile showing 1 → 10 → 50 → 250 says the same
//   thing and reads as a single climbing thing.
//
//   SEALED SLOTS ARE SMALL. They were full-height empty frames, and eight of them
//   left a void bigger than the badges themselves. Shrunk to a row of markers, they
//   say "there is more here" without occupying the space of what they conceal.
//
//   ONE THING TO AIM AT. A wall of twenty-six is a wall. A single line naming the
//   closest locked badge turns it into a target.
//
//   PROGRESS ONLY WHERE IT IS HONEST. "Finish something before 9am" has no partial
//   state, so it shows nothing rather than a bar stuck at zero.
// ============================================================================

const GROUP_LABEL: Record<BadgeGroup, string> = {
  milestone: 'Milestones',
  behaviour: 'Discoveries',
  effort: 'Feats',
};

const GROUP_BLURB: Record<BadgeGroup, string> = {
  milestone: 'Signposted, and worth aiming at.',
  behaviour: 'Sealed until something you do trips them.',
  effort: 'For the genuinely hard things.',
};

const GROUP_ORDER: BadgeGroup[] = ['milestone', 'behaviour', 'effort'];

interface Props {
  statuses: BadgeStatus[];
}

function BadgeShelf({ statuses }: Props) {
  const earned = statuses.filter((s) => s.earned).length;
  const ladders = useMemo(() => laddersOf(statuses), [statuses]);
  const next = useMemo(() => nextUp(statuses), [statuses]);

  const loose = useMemo(() => {
    const out: Record<BadgeGroup, BadgeStatus[]> = { milestone: [], behaviour: [], effort: [] };
    for (const s of standalone(statuses)) out[s.def.group].push(s);
    for (const g of GROUP_ORDER) out[g] = sortForDisplay(out[g]);
    return out;
  }, [statuses]);

  return (
    <div>
      {/* The count lives in the fold header, so it is not repeated here. What this
          line adds is a single target, which is the point: twenty-six is a wall, one
          named badge is something to aim at. */}
      {next && (
        <div className="font-mono text-nano tnum text-bone-3 tracking-wide mb-1.5">
          next up · <span className="text-bone-1">{next.def.name}</span> ·{' '}
          {next.progressLabel}
        </div>
      )}
      <PixelMeter
        value={BADGE_TOTAL > 0 ? earned / BADGE_TOTAL : 0}
        segments={BADGE_TOTAL}
        height={6}
        gap={1}
        cursor={false}
        title={`${earned} of ${BADGE_TOTAL} earned`}
      />

      {/* Ladders first: they are the spine, and collapsing them shortens the shelf
          by eight tiles. */}
      <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 mt-4">
        {ladders.map((l) => (
          <LadderTile key={l.id} ladder={l} />
        ))}
      </div>

      {GROUP_ORDER.map((group) => {
        const visible = loose[group].filter((s) => !(s.def.hidden && !s.earned));
        const sealed = loose[group].filter((s) => s.def.hidden && !s.earned);
        if (visible.length === 0 && sealed.length === 0) return null;
        return (
          <div key={group} className="mt-5">
            <div className="flex items-baseline gap-2 mb-2">
              <span className="legend">{GROUP_LABEL[group]}</span>
              <span className="font-mono text-nano text-bone-4">{GROUP_BLURB[group]}</span>
            </div>

            {visible.length > 0 && (
              <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                {visible.map((s) => (
                  <BadgeTile key={s.def.id} status={s} />
                ))}
              </div>
            )}

            {sealed.length > 0 && (
              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {sealed.map((s) => (
                  <span
                    key={s.def.id}
                    className="grid place-items-center shrink-0"
                    style={{ width: 18, height: 18, border: '1px dashed var(--bone-5)' }}
                    title="Sealed — something you do will trip it"
                    aria-label="A sealed badge"
                  >
                    <span style={{ width: 3, height: 3, background: 'var(--bone-5)' }} />
                  </span>
                ))}
                <span className="font-mono text-nano text-bone-4 ml-1">
                  {sealed.length} still sealed
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LadderTile({ ladder }: { ladder: LadderStatus }) {
  const { name, description, rungs, earned, next, paid } = ladder;
  const top = rungs[rungs.length - 1];
  const showGlyph = next ?? top;

  return (
    <div
      className="flex items-start gap-2.5 px-2.5 py-2"
      style={{
        background: earned > 0 ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${earned > 0 ? 'var(--signal-line)' : 'var(--rule-1)'}`,
      }}
      title={rungs
        .map((r) => `${r.def.rung}: ${r.earned ? (r.prior ? 'prior' : 'earned') : 'locked'}`)
        .join(' · ')}
    >
      <BadgeGlyph
        badgeId={showGlyph.def.id}
        size={22}
        color={earned > 0 ? 'var(--signal)' : 'var(--bone-4)'}
      />
      <div className="min-w-0 flex-1">
        <div className="text-body-sm truncate" style={{ color: 'var(--bone-0)', fontWeight: 600 }}>
          {name}
        </div>
        <div className="font-mono text-nano text-bone-3 leading-snug">{description}</div>

        {/* The rungs as a row of stops, so the ladder reads as one climbing thing. */}
        <div className="flex items-center gap-1 mt-1.5">
          {rungs.map((r) => (
            <span
              key={r.def.id}
              className="font-mono text-nano tnum px-1"
              style={{
                color: r.earned ? 'var(--action-ink)' : 'var(--bone-3)',
                background: r.earned
                  ? r.prior
                    ? 'var(--bone-4)'
                    : 'var(--signal)'
                  : 'var(--chassis-4)',
              }}
              title={
                r.earned
                  ? r.prior
                    ? `${r.def.name} — prior service`
                    : `${r.def.name} — earned, +${r.def.xp} XP`
                  : `${r.def.name} — ${r.progressLabel ?? 'locked'}`
              }
            >
              {r.def.rung}
            </span>
          ))}
        </div>

        {next && next.progress != null && (
          <div className="mt-1.5">
            <PixelMeter
              value={next.progress}
              segments={14}
              height={4}
              gap={1}
              cursor={false}
              color="var(--bone-3)"
              title={next.progressLabel ?? ''}
            />
            <div className="font-mono text-nano tnum text-bone-4 mt-1">
              {next.progressLabel} to {next.def.rung}
            </div>
          </div>
        )}
        {!next && <div className="font-mono text-nano text-bone-4 mt-1.5">complete</div>}
      </div>
      {paid > 0 && (
        <span
          className="font-mono text-nano tnum shrink-0"
          style={{ color: 'var(--signal)' }}
        >
          +{paid}
        </span>
      )}
    </div>
  );
}

function BadgeTile({ status }: { status: BadgeStatus }) {
  const { def, earned, prior, progress, progressLabel } = status;

  return (
    <div
      className="flex items-start gap-2.5 px-2.5 py-2"
      style={{
        background: earned ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${earned ? 'var(--signal-line)' : 'var(--rule-1)'}`,
      }}
      title={`${def.name} · ${def.description} · +${def.xp} XP`}
    >
      <BadgeGlyph
        badgeId={def.id}
        size={22}
        color={earned ? (prior ? 'var(--bone-2)' : 'var(--signal)') : 'var(--bone-4)'}
      />
      <div className="min-w-0 flex-1">
        <div
          className="text-body-sm truncate"
          style={{
            color: earned ? 'var(--bone-0)' : 'var(--bone-2)',
            fontWeight: earned ? 600 : 500,
          }}
        >
          {def.name}
        </div>
        <div className="font-mono text-nano text-bone-3 leading-snug">{def.description}</div>

        {progress != null && progressLabel && (
          <div className="mt-1.5">
            <PixelMeter
              value={progress}
              segments={12}
              height={4}
              gap={1}
              cursor={false}
              color="var(--bone-3)"
              title={progressLabel}
            />
            <div className="font-mono text-nano tnum text-bone-4 mt-1">{progressLabel}</div>
          </div>
        )}
      </div>

      {earned && (
        <span
          className="font-mono text-nano tnum shrink-0"
          style={{ color: prior ? 'var(--bone-4)' : 'var(--signal)' }}
          title={prior ? 'Already true when tracking began, so it paid nothing' : `+${def.xp} XP`}
        >
          {prior ? 'prior' : `+${def.xp}`}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The unlock moment.
 *
 * A queue rather than a single card, because a good day can trip several at once and
 * a badge that flashes past behind another is a reward silently lost — the same
 * reasoning as levels crossing in one tick.
 */
export const BadgeUnlockToast = memo(function BadgeUnlockToast({
  queue,
  onDone,
}: {
  queue: BadgeStatus['def'][];
  onDone: () => void;
}) {
  const reduced = useReducedMotion();
  const current = queue[0] ?? null;

  return (
    <div className="fixed left-6 bottom-6 z-[62] pointer-events-none">
      <AnimatePresence onExitComplete={onDone}>
        {current && (
          <motion.div
            key={current.id}
            initial={{ opacity: 0, x: reduced ? 0 : -24, scale: reduced ? 1 : 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: reduced ? 0 : -24 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.15, 1.2, 0.4, 1] }}
            className="relative flex items-center gap-3 px-3 py-2.5"
            style={{
              background: 'var(--chassis-2)',
              border: '1px solid var(--signal-line)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <PixelBurst
              seed={current.id.length * 7}
              count={18}
              spread={80}
              size={5}
              duration={0.8}
            />
            <BadgeGlyph badgeId={current.id} size={28} />
            <div className="text-left">
              <div
                className="font-mono"
                style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--signal)' }}
              >
                BADGE EARNED
                {queue.length > 1 && ` · ${queue.length - 1} MORE`}
              </div>
              <div
                className="font-display"
                style={{ fontSize: 16, color: 'var(--bone-0)', lineHeight: 1.15 }}
              >
                {current.name}
              </div>
              <div className="font-mono text-nano text-bone-3 mt-0.5">
                {current.description} · +{current.xp} XP
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default memo(BadgeShelf);

import { memo } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { AwardLedger } from '../types';
import { isPaid, type Challenge, type Quest, type QuestKind } from '../quests';
import BadgeGlyph from './pixel/BadgeGlyph';
import PixelMeter from './pixel/PixelMeter';
import PixelBurst from './pixel/PixelBurst';
import Figure from './Figure';

// ============================================================================
// QuestBoard
//
// This week's missions and the two challenges.
//
// Everything here is generated, so the board is a reading of your own week rather
// than a list you maintain. That has one consequence worth stating in the copy: a
// quest can appear or change shape when you edit the calendar, and it should be
// obvious that this is the board following you rather than the app moving goalposts.
//
// Nothing on this board can be failed. A quest that runs out of week simply stops
// being generated, and Monday brings a new set — so there is no expiry state to
// draw, no red, and no countdown.
// ============================================================================

/** Each kind borrows a badge glyph, so the board shares the shelf's vocabulary. */
const KIND_GLYPH: Record<QuestKind, string> = {
  goal: 'level-10',
  run: 'streak-30',
  routine: 'weekday-five',
  heavyday: 'heavy-lifter',
  wildcard: 'big-day',
};

const KIND_LABEL: Record<QuestKind, string> = {
  goal: 'goal',
  run: 'trip',
  routine: 'routine',
  heavyday: 'heavy day',
  wildcard: 'this week only',
};

interface Props {
  quests: Quest[];
  daily: Challenge;
  weekly: Challenge;
  awards: AwardLedger;
}

function QuestBoard({ quests, daily, weekly, awards }: Props) {
  const outstanding = [
    ...quests.filter((q) => !isPaid(awards, q.id)).map((q) => q.bonusXp),
    ...[daily, weekly].filter((c) => !isPaid(awards, c.id)).map((c) => c.xp),
  ].reduce((s, n) => s + n, 0);

  return (
    <div>
      <p className="text-body-sm text-bone-3 mb-3 max-w-[64ch] leading-relaxed">
        Generated from the week you have already planned — a set only pays when the
        whole set is done. Edit the calendar and the board follows; nothing here can be
        failed, and Monday brings a new one.
      </p>

      {/* The two challenges first: they are the smallest ask and the fastest read. */}
      <div className="grid gap-1.5 sm:grid-cols-2 mb-4">
        <ChallengeTile challenge={daily} kicker="Today" awards={awards} />
        <ChallengeTile challenge={weekly} kicker="This week" awards={awards} />
      </div>

      {quests.length === 0 ? (
        <p className="text-body-sm text-bone-3 leading-relaxed max-w-[60ch]">
          No missions this week yet. They appear once a weekly goal, a routine or a
          marked trip has more than one block booked against it.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mb-2">
            <span className="legend">Missions</span>
            {/* The fold header already carries the count, so this says the other
                thing worth knowing: what is still on the table. */}
            <span className="font-mono text-nano tnum text-bone-4">
              {outstanding > 0
                ? `${outstanding.toLocaleString()} XP still unclaimed`
                : 'everything claimed'}
            </span>
          </div>
          <div className="grid gap-1.5 lg:grid-cols-2">
            {quests.map((q) => (
              <QuestTile key={q.id} quest={q} awards={awards} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function QuestTile({ quest, awards }: { quest: Quest; awards: AwardLedger }) {
  const paid = isPaid(awards, quest.id);
  const ratio = quest.total > 0 ? quest.done / quest.total : 0;

  return (
    <div
      className="flex items-start gap-2.5 px-2.5 py-2 min-w-0"
      style={{
        background: quest.complete ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${quest.complete ? 'var(--signal-line)' : 'var(--rule-1)'}`,
      }}
      title={quest.dates.length > 0 ? quest.dates.join(' · ') : undefined}
    >
      <BadgeGlyph
        badgeId={KIND_GLYPH[quest.kind]}
        size={22}
        color={quest.complete ? 'var(--signal)' : 'var(--bone-4)'}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span
            className="text-body-sm truncate"
            style={{
              color: quest.complete ? 'var(--bone-0)' : 'var(--bone-1)',
              fontWeight: quest.complete ? 600 : 500,
            }}
          >
            {quest.name}
          </span>
          <span className="font-mono text-nano text-bone-4 shrink-0">
            {KIND_LABEL[quest.kind]}
          </span>
        </div>
        <div className="font-mono text-nano text-bone-3 leading-snug">{quest.blurb}</div>

        <div className="mt-1.5">
          <PixelMeter
            value={ratio}
            segments={Math.min(Math.max(quest.total, 6), 20)}
            height={5}
            gap={1}
            cursor={false}
            color={quest.complete ? 'var(--signal)' : 'var(--bone-3)'}
            title={`${quest.done} of ${quest.total}`}
          />
          <div className="font-mono text-nano tnum text-bone-4 mt-1">
            {quest.done} / {quest.total}
            {quest.dates.length > 1 && ` · ${quest.dates.length} days`}
          </div>
        </div>
      </div>
      <span
        className="font-mono text-nano tnum shrink-0"
        style={{ color: quest.complete ? 'var(--signal)' : 'var(--bone-4)' }}
        title={paid ? 'Paid' : `Worth ${quest.bonusXp} XP when the set is finished`}
      >
        {paid ? `+${quest.bonusXp}` : `${quest.bonusXp}`}
      </span>
    </div>
  );
}

function ChallengeTile({
  challenge,
  kicker,
  awards,
}: {
  challenge: Challenge;
  kicker: string;
  awards: AwardLedger;
}) {
  const paid = isPaid(awards, challenge.id);
  const ratio = challenge.total > 0 ? challenge.done / challenge.total : 0;

  return (
    <div
      className="px-2.5 py-2"
      style={{
        background: challenge.complete ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${challenge.complete ? 'var(--signal-line)' : 'var(--rule-2)'}`,
      }}
    >
      <div className="flex items-baseline gap-2">
        <span className="legend" style={{ color: 'var(--signal)' }}>
          {kicker}
        </span>
        <span
          className="text-body-sm truncate flex-1 min-w-0"
          style={{ color: 'var(--bone-0)', fontWeight: 600 }}
        >
          {challenge.name}
        </span>
        <span
          className="font-mono text-nano tnum shrink-0"
          style={{ color: challenge.complete ? 'var(--signal)' : 'var(--bone-4)' }}
        >
          {paid ? `+${challenge.xp}` : `${challenge.xp}`}
        </span>
      </div>
      <div className="font-mono text-nano text-bone-3 leading-snug mt-0.5">
        {challenge.blurb}
      </div>
      <div className="mt-1.5">
        <PixelMeter
          value={ratio}
          segments={Math.min(Math.max(challenge.total, 8), 24)}
          height={6}
          gap={1}
          cursor={false}
          color={challenge.complete ? 'var(--signal)' : 'var(--bone-3)'}
          title={`${challenge.done} of ${challenge.total}`}
        />
        <div className="font-mono text-nano tnum text-bone-4 mt-1">
          {/* The tally counts; the target does not. Only one of the two ever moves. */}
          <Figure value={challenge.done} /> / {challenge.total.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The moment a set closes. Queued, for the same reason badges are. */
export const QuestDoneToast = memo(function QuestDoneToast({
  quest,
  remaining,
}: {
  quest: { name: string; xp: number } | null;
  remaining: number;
}) {
  const reduced = useReducedMotion();
  const current = quest;

  return (
    <div className="fixed right-6 bottom-24 z-[62] pointer-events-none">
      <AnimatePresence>
        {current && (
          <motion.div
            key={current.name}
            initial={{ opacity: 0, y: reduced ? 0 : 12, scale: reduced ? 1 : 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -10 }}
            transition={{ duration: reduced ? 0 : 0.3, ease: [0.15, 1.2, 0.4, 1] }}
            className="relative flex items-center gap-3 px-3 py-2.5"
            style={{
              background: 'var(--chassis-2)',
              border: '1px solid var(--signal-line)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
          >
            <PixelBurst seed={current.name.length * 11} count={20} spread={90} size={5} />
            <BadgeGlyph badgeId="big-day" size={26} />
            <div className="text-left">
              <div
                className="font-mono"
                style={{ fontSize: 9.5, letterSpacing: '0.14em', color: 'var(--signal)' }}
              >
                SET FINISHED
                {remaining > 0 && ` · ${remaining} MORE`}
              </div>
              <div
                className="font-display"
                style={{ fontSize: 16, color: 'var(--bone-0)', lineHeight: 1.15 }}
              >
                {current.name}
              </div>
              <div className="font-mono text-nano text-bone-3 mt-0.5">
                +{current.xp} XP
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default memo(QuestBoard);

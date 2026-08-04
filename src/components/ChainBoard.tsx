import { memo } from 'react';
import type { ChainStatus } from '../chains';
import BadgeGlyph from './pixel/BadgeGlyph';
import PixelMeter from './pixel/PixelMeter';
import Figure from './Figure';

// ============================================================================
// ChainBoard — the multi-week middle distance
//
// Reads differently from the quest board on purpose. A quest is a target you either hit
// this week or do not; a chain is a thing you are PART-WAY THROUGH, so the emphasis here is
// on the steps behind you as much as the one in front.
//
// The next step's name is shown but its target is not. Naming it gives the chain a shape
// you can see the end of; showing all three targets at once would collapse it into a longer
// quest, which is the one thing it must not be.
// ============================================================================

interface Props {
  statuses: ChainStatus[];
}

function ChainBoard({ statuses }: Props) {
  const finished = statuses.filter((s) => s.finished).length;

  return (
    <div>
      <p className="text-body-sm text-bone-3 mb-1 max-w-[64ch] leading-relaxed">
        Longer than a week, shorter than a run. Each step unlocks the next, and finishing a
        chain leaves something behind.
      </p>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="font-mono text-nano tnum text-bone-2 tracking-wide">
          {finished} of {statuses.length} complete
        </span>
      </div>

      <div className="grid gap-1.5">
        {statuses.map((s) => (
          <ChainRow key={s.def.id} status={s} />
        ))}
      </div>
    </div>
  );
}

function ChainRow({ status }: { status: ChainStatus }) {
  const { def, step, done, total, cleared, finished, mementoHeld } = status;

  return (
    <div
      className="px-3 py-2.5"
      style={{
        background: finished ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${finished ? 'var(--signal)' : 'var(--rule-1)'}`,
      }}
    >
      <div className="flex items-start gap-3">
        <BadgeGlyph
          badgeId={def.glyph}
          size={24}
          color={finished ? 'var(--signal)' : 'var(--bone-3)'}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className="text-body-sm" style={{ color: 'var(--bone-0)', fontWeight: 600 }}>
              {def.name}
            </span>
            {/* Step pips. Three squares says "three steps" faster than "1 of 3" reads. */}
            <span className="inline-flex items-center gap-1" aria-hidden>
              {def.steps.map((_, i) => (
                <span
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    background: i < cleared ? 'var(--signal)' : 'var(--chassis-4)',
                    // A drawn diamond rather than a rotated square. A rotated square's ink
              // sits ~21% outside its layout box on every side, so any ancestor
              // that clips — a collapsing panel, a scroll container — slices its
              // points flat. `clip-path` keeps the same shape strictly inside.
              clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
                  }}
                />
              ))}
            </span>
            <span className="font-mono text-nano text-bone-4 tnum">
              {cleared} of {def.steps.length}
            </span>
          </div>

          <div className="font-mono text-nano text-bone-3 leading-snug mt-0.5">{def.blurb}</div>

          {finished ? (
            <div className="font-mono text-nano mt-1.5" style={{ color: 'var(--signal)' }}>
              {mementoHeld
                ? `${def.mementoName} — earned`
                : `${def.mementoName} — owed`}
            </div>
          ) : (
            step && (
              <div className="mt-1.5">
                <div className="flex items-baseline justify-between gap-3 mb-1 flex-wrap">
                  <span className="font-mono text-nano text-bone-2">{step.blurb}</span>
                  <span className="font-mono text-nano tnum text-bone-3">
                    <Figure value={done} /> / {total} · +{step.xp} XP
                  </span>
                </div>
                <PixelMeter
                  value={total > 0 ? done / total : 0}
                  segments={20}
                  height={5}
                  gap={1}
                  cursor={false}
                  title={`${done} of ${total} — ${step.name}`}
                />
                {/*
                  The step after this one is named, not measured. That is the difference
                  between something you are part-way through and a list of three targets.
                */}
                {def.steps[status.stepIndex + 1] && (
                  <div className="font-mono text-nano text-bone-5 mt-1">
                    then: {def.steps[status.stepIndex + 1].name}
                  </div>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

export default memo(ChainBoard);

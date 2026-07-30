import { memo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { CODEX_TOTAL, sortCodex, type InsightStatus } from '../insights';
import BadgeGlyph from './pixel/BadgeGlyph';
import PixelMeter from './pixel/PixelMeter';
import PixelBurst from './pixel/PixelBurst';

// ============================================================================
// CodexPanel
//
// Eight things the calendar can work out about you, sealed until there is enough
// history to say them honestly.
//
// The reading step is deliberately a click rather than a scroll-past. Two reasons,
// one mechanical and one honest: it is what the read reward is paid for, and an
// insight you have not looked at has done nothing for you. A card that revealed
// itself on render would pay for nothing.
//
// A sealed card shows its PROMISE and its requirement but never a partial answer.
// Half an insight is worse than none — it invites acting on noise, which is exactly
// what the requirement exists to prevent.
// ============================================================================

interface Props {
  statuses: InsightStatus[];
  /** Called the first time a card is opened, so the read can be paid. */
  onRead: (id: string) => void;
  /** How many days of history the window covers, for the caveat line. */
  windowDays: number;
}

function CodexPanel({ statuses, onRead, windowDays }: Props) {
  const ordered = sortCodex(statuses);
  const unlocked = statuses.filter((s) => s.unlocked).length;
  const unread = statuses.filter((s) => s.unlocked && !s.read).length;

  return (
    <div>
      <p className="text-body-sm text-bone-3 mb-1 max-w-[64ch] leading-relaxed">
        What the calendar has worked out, from the last {windowDays} days of blocks you
        actually completed. Each card stays sealed until there is enough history behind
        it to be worth trusting.
      </p>
      <div className="flex items-baseline gap-3 mb-3">
        <span className="font-mono text-nano tnum text-bone-2 tracking-wide">
          {unlocked} of {CODEX_TOTAL} unsealed
        </span>
        {unread > 0 && (
          <span
            className="font-mono text-nano tnum px-1.5"
            style={{ color: 'var(--action-ink)', background: 'var(--signal)' }}
          >
            {unread} UNREAD
          </span>
        )}
      </div>

      <div className="grid gap-1.5">
        {ordered.map((s) => (
          <InsightCard key={s.id} status={s} onRead={onRead} />
        ))}
      </div>
    </div>
  );
}

function InsightCard({
  status,
  onRead,
}: {
  status: InsightStatus;
  onRead: (id: string) => void;
}) {
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);

  const reveal = () => {
    if (!status.unlocked) return;
    setOpen((v) => !v);
    if (!status.read) onRead(status.id);
  };

  const sealed = !status.unlocked;

  return (
    <div
      style={{
        background: status.unlocked ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${
          status.unlocked && !status.read ? 'var(--signal)' : status.unlocked ? 'var(--rule-2)' : 'var(--rule-1)'
        }`,
      }}
    >
      <button
        onClick={reveal}
        disabled={sealed}
        aria-expanded={open}
        className="w-full flex items-start gap-3 px-3 py-2.5 text-left disabled:cursor-default"
      >
        <div className="relative shrink-0">
          {status.unlocked && !status.read && (
            <PixelBurst seed={status.id.length * 5} count={14} spread={54} size={4} duration={0.8} />
          )}
          <BadgeGlyph
            badgeId={status.glyph}
            size={24}
            color={sealed ? 'var(--bone-5)' : 'var(--signal)'}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            <span
              className="text-body-sm"
              style={{
                color: sealed ? 'var(--bone-2)' : 'var(--bone-0)',
                fontWeight: sealed ? 500 : 600,
              }}
            >
              {status.name}
            </span>
            {status.unlocked && !status.read && (
              <span
                className="font-mono text-nano px-1"
                style={{
                  letterSpacing: '0.1em',
                  color: 'var(--action-ink)',
                  background: 'var(--signal)',
                }}
              >
                NEW · +{status.xpRead}
              </span>
            )}
          </div>

          {/* The promise, always. A sealed card says what it will tell you — that is
              what makes the requirement feel like a target rather than a locked door. */}
          <div className="font-mono text-nano text-bone-3 leading-snug mt-0.5">
            {status.promise}
          </div>

          {sealed && (
            <div className="mt-1.5">
              <PixelMeter
                value={status.progress}
                segments={16}
                height={4}
                gap={1}
                cursor={false}
                color="var(--bone-3)"
                title={`${status.progressLabel} — ${status.requirement}`}
              />
              <div className="font-mono text-nano tnum text-bone-4 mt-1">
                {status.progressLabel} · {status.requirement}
              </div>
            </div>
          )}

          {status.unlocked && !open && status.finding && (
            <div className="font-mono text-nano text-bone-2 mt-1.5">
              {status.read ? 'tap to read again' : 'tap to reveal'}
            </div>
          )}
        </div>
      </button>

      <AnimatePresence initial={false}>
        {open && status.finding && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: reduced ? 0 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div className="px-3 pb-3 pt-0">
              <div className="rule-h mb-3" />
              <div
                className="font-display mb-2"
                style={{ fontSize: 19, color: 'var(--bone-0)', lineHeight: 1.25 }}
              >
                {status.finding.headline}
              </div>
              {status.finding.detail.map((line, i) => (
                <p
                  key={i}
                  className="text-body-sm text-bone-2 leading-relaxed max-w-[64ch] mb-1.5"
                >
                  {line}
                </p>
              ))}

              {status.finding.bars && status.finding.bars.length > 0 && (
                <div className="mt-3 space-y-1">
                  {status.finding.bars.map((bar) => (
                    <div key={bar.label} className="flex items-center gap-2">
                      <span
                        className="font-mono text-nano text-bone-3 shrink-0 text-right"
                        style={{ width: 96 }}
                      >
                        {bar.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <PixelMeter
                          value={bar.max > 0 ? bar.value / bar.max : 0}
                          segments={22}
                          height={7}
                          gap={1}
                          cursor={false}
                          title={`${bar.label}: ${bar.note ?? bar.value}`}
                        />
                      </div>
                      <span
                        className="font-mono text-nano tnum text-bone-2 shrink-0 text-right"
                        style={{ width: 92 }}
                      >
                        {bar.note ?? bar.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The unseal moment. */
export const CodexUnlockToast = memo(function CodexUnlockToast({
  card,
  remaining,
}: {
  card: { name: string; glyph: string; xp: number } | null;
  remaining: number;
}) {
  const reduced = useReducedMotion();
  const current = card;

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[62] pointer-events-none">
      <AnimatePresence>
        {current && (
          <motion.div
            key={current.name}
            initial={{ opacity: 0, y: reduced ? 0 : 16, scale: reduced ? 1 : 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: reduced ? 0 : -12 }}
            transition={{ duration: reduced ? 0 : 0.32, ease: [0.15, 1.25, 0.4, 1] }}
            className="relative flex items-center gap-3 px-4 py-3"
            style={{
              background: 'var(--chassis-2)',
              border: '1px solid var(--signal)',
              boxShadow: '0 10px 30px rgba(0,0,0,0.55)',
            }}
          >
            <PixelBurst seed={current.name.length * 13} count={26} spread={110} size={5} />
            <BadgeGlyph badgeId={current.glyph} size={30} />
            <div className="text-left">
              <div
                className="font-mono"
                style={{ fontSize: 9.5, letterSpacing: '0.16em', color: 'var(--signal)' }}
              >
                CODEX UNSEALED
                {remaining > 0 && ` · ${remaining} MORE`}
              </div>
              <div
                className="font-display"
                style={{ fontSize: 17, color: 'var(--bone-0)', lineHeight: 1.15 }}
              >
                {current.name}
              </div>
              <div className="font-mono text-nano text-bone-3 mt-0.5">
                +{current.xp} XP · open it to read what it found
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

export default memo(CodexPanel);

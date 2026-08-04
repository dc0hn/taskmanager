import { memo, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  Upload,
} from 'lucide-react';
import type { DayDigest } from '../study/digest';
import type { Metric } from '../study/metrics';
import { battery, byWeekday } from '../study/metrics';
import { LIMITS } from '../study/limits';
import {
  BASELINE_DAYS,
  scoreFinding,
  shouldExport,
  type Finding,
  type FindingCheck,
} from '../study/briefing';
import {
  answeredCount,
  QUESTIONS,
  type Answers,
  type Individuality,
} from '../study/profile';

// ============================================================================
// StudyView — habits, routines and usage
//
// A study, not a dashboard. The difference shows in three places, and they are the
// reason this is not just another set of charts:
//
//   IT SAYS WHAT IT CANNOT SEE, prominently and permanently. §V. A study whose limits
//   are stated once in a preamble will be read as though it had none.
//
//   IT REFUSES TO ANSWER without enough evidence, and shows the refusal rather than
//   hiding the metric. "Insufficient evidence, continuing to observe" is a finding.
//
//   IT SCORES ITS OWN PAST CLAIMS. An imported finding that predicted something is
//   checked against what actually happened, and a contradiction is displayed exactly
//   as prominently as a confirmation.
//
// Nothing here rates the user. §VIII: standard times are for planning, never for
// judgement. There is no score, no grade, and no percentage of a target.
// ============================================================================

type Tab = 'observe' | 'profile' | 'findings' | 'limits';

interface Props {
  digests: DayDigest[];
  profile: Individuality;
  findings: Finding[];
  lastExport: string | null;
  today: string;
  onSaveProfile: (answers: Answers) => void;
  onExport: () => void;
  onImport: (text: string) => void;
  importError: string;
}

function StudyView({
  digests,
  profile,
  findings,
  lastExport,
  today,
  onSaveProfile,
  onExport,
  onImport,
  importError,
}: Props) {
  const [tab, setTab] = useState<Tab>('observe');

  const metrics = useMemo(() => battery(digests), [digests]);
  const prompt = useMemo(
    () => shouldExport(digests, lastExport, today),
    [digests, lastExport, today]
  );
  const checks = useMemo(
    () => findings.map((f) => scoreFinding(f, metrics)),
    [findings, metrics]
  );

  const answered = answeredCount(profile);

  return (
    <div className="flex-1 min-h-0 overflow-y-auto thin-scroll px-6 pb-8">
      <div className="max-w-[1100px]">
        <div className="flex items-center gap-2 py-4 flex-wrap">
          {(
            [
              ['observe', 'Observation'],
              ['profile', `Reconnaissance ${answered}/5`],
              ['findings', `Findings ${findings.length ? findings.length : ''}`],
              ['limits', 'What I cannot see'],
            ] as [Tab, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className="text-[12px] font-medium px-3 h-[30px] rounded-lg transition-colors"
              style={
                tab === key
                  ? {
                      background: 'var(--signal-dim)',
                      color: 'var(--bone-0)',
                      border: '1px solid var(--signal-line)',
                    }
                  : { color: 'var(--bone-2)', border: '1px solid var(--rule-2)' }
              }
            >
              {label.trim()}
            </button>
          ))}
        </div>

        {tab === 'observe' && (
          <Observation
            digests={digests}
            metrics={metrics}
            prompt={prompt}
            answered={answered}
            onExport={onExport}
          />
        )}
        {tab === 'profile' && (
          <Reconnaissance profile={profile} onSave={onSaveProfile} />
        )}
        {tab === 'findings' && (
          <Findings checks={checks} onImport={onImport} error={importError} />
        )}
        {tab === 'limits' && <Limits />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Observation({
  digests,
  metrics,
  prompt,
  answered,
  onExport,
}: {
  digests: DayDigest[];
  metrics: Metric[];
  prompt: ReturnType<typeof shouldExport>;
  answered: number;
  onExport: () => void;
}) {
  const observed = digests.length;
  const baselineLeft = Math.max(0, BASELINE_DAYS - observed);
  const weekdays = useMemo(() => byWeekday(digests), [digests]);

  return (
    <div>
      {/* The single most important thing on the page while the baseline runs. */}
      <div
        className="px-3.5 py-3 mb-5 rounded"
        style={{ background: 'var(--chassis-2)', border: '1px solid var(--rule-2)' }}
      >
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <span className="legend">
            {baselineLeft > 0 ? 'Baseline in progress' : 'Baseline complete'}
          </span>
          <span className="font-mono text-nano text-bone-3 tnum">
            {observed} {observed === 1 ? 'day' : 'days'} observed
          </span>
        </div>
        <div
          className="h-[6px] rounded-full overflow-hidden mt-2"
          style={{ background: 'var(--chassis-4)' }}
        >
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${Math.min(100, (observed / BASELINE_DAYS) * 100)}%`,
              background: baselineLeft > 0 ? 'var(--signal)' : 'var(--good)',
            }}
          />
        </div>
        <p className="text-[12px] text-ink-3 mt-2 leading-snug max-w-[62ch]">
          {baselineLeft > 0 ? (
            <>
              Observing without recommending. {baselineLeft} more{' '}
              {baselineLeft === 1 ? 'day' : 'days'} before anything is proposed — a bad
              baseline poisons every comparison made afterwards, so nothing here is a
              suggestion yet.
            </>
          ) : (
            <>
              Enough observation to compare against. Figures below still describe rather
              than prescribe; a week is one data point, not a trend.
            </>
          )}
        </p>
        {answered < 5 && (
          <p className="text-[12px] mt-2 leading-snug" style={{ color: 'var(--signal)' }}>
            {5 - answered} reconnaissance {5 - answered === 1 ? 'question' : 'questions'}{' '}
            unanswered. Without them the study will optimise for whatever is easiest to
            count.
          </p>
        )}
      </div>

      {/* Export suggestion — the app deciding when analysis is worth doing. */}
      <div
        className="px-3.5 py-3 mb-6 rounded flex items-start gap-3 flex-wrap"
        style={{
          background: prompt.ready ? 'var(--signal-dim)' : 'var(--chassis-1)',
          border: `1px solid ${prompt.ready ? 'var(--signal-line)' : 'var(--rule-1)'}`,
        }}
      >
        <div className="min-w-0 flex-1">
          <div
            className="text-[12.5px] font-semibold"
            style={{ color: prompt.ready ? 'var(--bone-0)' : 'var(--bone-2)' }}
          >
            {prompt.ready ? 'Worth exporting for analysis' : 'Not yet worth exporting'}
          </div>
          <p className="text-[12px] text-ink-3 mt-0.5 leading-snug max-w-[62ch]">
            {prompt.reason}
          </p>
        </div>
        <button
          onClick={onExport}
          disabled={observed === 0}
          className={prompt.ready ? 'btn-primary' : 'btn-quiet'}
          style={{
            fontSize: 12,
            fontWeight: 600,
            padding: '0 12px',
            height: 30,
            borderRadius: 6,
            opacity: observed === 0 ? 0.4 : 1,
          }}
        >
          <span className="inline-flex items-center gap-1.5">
            <Download size={12} strokeWidth={2} />
            Copy briefing
          </span>
        </button>
      </div>

      <Section title="The battery" hint="Every figure states what it needs and refuses below it.">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {metrics.map((m) => (
            <MetricCard key={m.id} metric={m} />
          ))}
        </div>
      </Section>

      <Section
        title="The shape of the week"
        hint="Completion by weekday. Blank where a weekday has not been observed."
      >
        <div className="flex items-end gap-1.5" style={{ height: 96 }}>
          {weekdays.map((row) => {
            const label = ['S', 'M', 'T', 'W', 'T', 'F', 'S'][row.weekday];
            const height = row.completion == null ? 0 : Math.max(2, row.completion * 84);
            return (
              <div key={row.weekday} className="flex-1 flex flex-col items-center gap-1">
                <span className="font-mono text-nano text-bone-4 tnum">
                  {row.completion == null ? '' : `${Math.round(row.completion * 100)}`}
                </span>
                <div
                  className="w-full rounded-sm transition-all duration-500"
                  style={{
                    height,
                    background:
                      row.completion == null ? 'var(--chassis-3)' : 'var(--signal)',
                    minHeight: 2,
                  }}
                  title={
                    row.n === 0
                      ? 'Not observed'
                      : `${row.n} ${row.n === 1 ? 'day' : 'days'} observed`
                  }
                />
                <span className="font-mono text-nano text-bone-3">{label}</span>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

const CONFIDENCE_COLOUR: Record<Metric['confidence'], string> = {
  none: 'var(--bone-4)',
  weak: 'var(--bone-3)',
  fair: 'var(--signal)',
  good: 'var(--good)',
};

function MetricCard({ metric }: { metric: Metric }) {
  const [open, setOpen] = useState(false);
  const enough = metric.value != null;

  return (
    <div
      className="px-3 py-2.5 rounded"
      style={{
        background: enough ? 'var(--chassis-2)' : 'var(--chassis-1)',
        border: `1px solid ${enough ? 'var(--rule-2)' : 'var(--rule-1)'}`,
      }}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium" style={{ color: 'var(--bone-1)' }}>
          {metric.label}
        </span>
        <span
          className="font-mono text-nano tnum shrink-0"
          style={{ color: CONFIDENCE_COLOUR[metric.confidence] }}
          title={`${metric.n} of ${metric.needs} days needed`}
        >
          {metric.n}/{metric.needs}
        </span>
      </div>

      <div className="mt-1">
        {enough ? (
          <span
            className="font-mono tnum"
            style={{ fontSize: 20, color: 'var(--bone-0)', fontWeight: 600 }}
          >
            {metric.display}
          </span>
        ) : (
          // The refusal, shown rather than hidden. §XII.
          <span className="text-[12px] leading-snug" style={{ color: 'var(--bone-4)' }}>
            Insufficient evidence — continuing to observe.
          </span>
        )}
      </div>

      <button
        onClick={() => setOpen((v) => !v)}
        className="mt-1.5 inline-flex items-center gap-1 font-mono text-nano text-bone-4 hover:text-bone-2 transition-colors"
      >
        <ChevronDown
          size={10}
          strokeWidth={2}
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }}
        />
        definition
      </button>
      {open && (
        <div className="mt-1.5">
          <p className="text-[11.5px] text-ink-3 leading-snug">{metric.definition}</p>
          {metric.caveat && (
            <p
              className="text-[11.5px] leading-snug mt-1.5 pl-2"
              style={{ color: 'var(--bad)', borderLeft: '2px solid var(--bad)' }}
            >
              {metric.caveat}
            </p>
          )}
          <p className="font-mono text-nano text-bone-4 mt-1.5">v{metric.version}</p>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Reconnaissance({
  profile,
  onSave,
}: {
  profile: Individuality;
  onSave: (answers: Answers) => void;
}) {
  const [draft, setDraft] = useState<Answers>(profile.answers);
  const dirty = QUESTIONS.some((q) => draft[q.key] !== profile.answers[q.key]);

  return (
    <div>
      <p className="text-[12.5px] text-ink-3 leading-relaxed max-w-[64ch] mb-5">
        Asked before measuring, and revisable afterwards. Taylor would start timing
        immediately and Frank would start filming; Lillian would ask first, and she is
        right. Your answers are treated as a hypothesis to be tested, not a brief to be
        followed — particularly the fourth.
      </p>

      {QUESTIONS.map((q) => (
        <div key={q.key} className="mb-5">
          <div className="text-[13px] font-semibold mb-1" style={{ color: 'var(--bone-0)' }}>
            {q.prompt}
          </div>
          <p className="text-[11.5px] text-ink-3 leading-snug max-w-[62ch] mb-2">
            {q.because}
          </p>
          <textarea
            value={draft[q.key]}
            onChange={(e) => setDraft({ ...draft, [q.key]: e.target.value.slice(0, 4000) })}
            rows={3}
            placeholder={q.placeholder}
            className="input w-full text-[12.5px] px-2.5 py-2 leading-relaxed resize-y focus:outline-none"
          />
        </div>
      ))}

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={() => onSave(draft)}
          disabled={!dirty}
          className="btn-primary text-[12.5px] font-semibold px-4 py-2 rounded-lg"
          style={{ opacity: dirty ? 1 : 0.4 }}
        >
          Save answers
        </button>
        {profile.revised && (
          <span className="font-mono text-nano text-bone-3">
            last revised {profile.revised}
            {profile.history.length > 0 &&
              ` · ${profile.history.length} earlier ${
                profile.history.length === 1 ? 'version' : 'versions'
              } kept`}
          </span>
        )}
      </div>

      {profile.history.length > 0 && (
        <p className="text-[11.5px] text-ink-3 mt-3 leading-snug max-w-[62ch]">
          Earlier answers are kept rather than overwritten. A changed account of what a
          good week looks like is itself an observation, and one no metric would catch.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

const VERDICT_STYLE: Record<
  FindingCheck['verdict'],
  { label: string; colour: string }
> = {
  held: { label: 'held', colour: 'var(--good)' },
  contradicted: { label: 'contradicted', colour: 'var(--bad)' },
  flat: { label: 'no real change', colour: 'var(--bone-3)' },
  unmeasurable: { label: 'not yet checkable', colour: 'var(--bone-4)' },
};

const KIND_STYLE: Record<Finding['kind'], string> = {
  observed: 'var(--good)',
  inferred: 'var(--signal)',
  hypothesis: 'var(--bone-3)',
};

function Findings({
  checks,
  onImport,
  error,
}: {
  checks: FindingCheck[];
  onImport: (text: string) => void;
  error: string;
}) {
  const [text, setText] = useState('');

  return (
    <div>
      <Section
        title="Import findings"
        hint="Paste an analysis pack. Anything without a stated evidence class is refused rather than repaired."
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          placeholder="Paste the findings JSON here…"
          className="input w-full font-mono text-[11.5px] px-2.5 py-2 leading-relaxed resize-y focus:outline-none"
        />
        <div className="flex items-center gap-3 mt-2 flex-wrap">
          <button
            onClick={() => {
              onImport(text);
              setText('');
            }}
            disabled={!text.trim()}
            className="btn-quiet inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-2 rounded-lg"
            style={{ opacity: text.trim() ? 1 : 0.4 }}
          >
            <Upload size={12} strokeWidth={2} />
            Import
          </button>
          {error && (
            <span className="text-[12px]" style={{ color: 'var(--bad)' }}>
              {error}
            </span>
          )}
        </div>
      </Section>

      <Section
        title="The register"
        count={checks.length}
        hint="Sealed on import. A finding is never rewritten when later data disagrees — the disagreement is the result."
      >
        {checks.length === 0 ? (
          <p className="text-[12.5px] text-bone-3 py-3 leading-relaxed max-w-[52ch]">
            Nothing imported yet. Findings arrive from analysis run outside the app, and
            each one that carries a prediction is checked here against what actually
            happened next.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {checks.map((check) => (
              <li
                key={check.finding.id}
                className="px-3 py-2.5 rounded"
                style={{ background: 'var(--chassis-2)', border: '1px solid var(--rule-2)' }}
              >
                <div className="flex items-baseline gap-2 flex-wrap mb-1">
                  <span
                    className="font-mono text-nano px-1.5 py-[1px] rounded-sm"
                    style={{
                      color: KIND_STYLE[check.finding.kind],
                      border: `1px solid ${KIND_STYLE[check.finding.kind]}`,
                    }}
                  >
                    {check.finding.kind}
                  </span>
                  {check.finding.voice && (
                    <span className="font-mono text-nano text-bone-4">
                      {check.finding.voice}
                    </span>
                  )}
                  <span className="font-mono text-nano text-bone-4 tnum ml-auto">
                    {check.finding.dated}
                  </span>
                </div>
                <div
                  className="text-[13px] font-semibold leading-snug"
                  style={{ color: 'var(--bone-0)' }}
                >
                  {check.finding.headline}
                </div>
                {check.finding.detail && (
                  <p className="text-[12px] text-ink-3 leading-snug mt-1 max-w-[64ch]">
                    {check.finding.detail}
                  </p>
                )}
                <div className="flex items-baseline gap-2 mt-2 flex-wrap">
                  <span
                    className="font-mono text-nano px-1.5 py-[1px] rounded-sm"
                    style={{
                      background: VERDICT_STYLE[check.verdict].colour,
                      color: 'var(--chassis-0)',
                    }}
                  >
                    {VERDICT_STYLE[check.verdict].label}
                  </span>
                  <span className="text-[11.5px] text-ink-3">{check.note}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Limits() {
  return (
    <div>
      <p className="text-[12.5px] text-ink-3 leading-relaxed max-w-[64ch] mb-5">
        This study observes the calendar, not the life. Time not scheduled is not time
        not worked, and nothing below is a gap that careful reading can close — each one
        is a boundary on what any figure in this section can honestly claim.
      </p>
      <ul className="flex flex-col gap-2">
        {LIMITS.map((limit) => (
          <li
            key={limit.id}
            className="px-3 py-2.5 rounded"
            style={{ background: 'var(--chassis-2)', border: '1px solid var(--rule-2)' }}
          >
            <div className="flex items-baseline gap-2 flex-wrap">
              {limit.status === 'unrecordable' ? (
                <EyeOff size={12} strokeWidth={2} style={{ color: 'var(--bad)' }} />
              ) : (
                <Eye size={12} strokeWidth={2} style={{ color: 'var(--signal)' }} />
              )}
              <span
                className="text-[13px] font-semibold leading-snug"
                style={{ color: 'var(--bone-0)' }}
              >
                {limit.blind}
              </span>
              <span className="font-mono text-nano text-bone-4 ml-auto">
                {limit.status}
              </span>
            </div>
            <p className="text-[12px] text-ink-3 leading-snug mt-1 max-w-[64ch]">
              {limit.because}
            </p>
            <p
              className="text-[12px] leading-snug mt-1.5 pl-2 max-w-[64ch]"
              style={{ color: 'var(--bone-2)', borderLeft: '2px solid var(--rule-3)' }}
            >
              {limit.instead}
            </p>
          </li>
        ))}
      </ul>
      <div
        className="mt-5 px-3.5 py-3 rounded flex items-start gap-2.5"
        style={{ background: 'var(--chassis-1)', border: '1px solid var(--rule-2)' }}
      >
        <AlertTriangle size={14} strokeWidth={2} style={{ color: 'var(--signal)' }} />
        <p className="text-[12px] text-ink-3 leading-snug max-w-[64ch]">
          The instrument is also an intervention. Almanac both records your working life
          and rewards it, and this section adds a second layer of being watched — so
          expect an early improvement that is an artifact of attention rather than of
          method. The study will not claim credit for it.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Section({
  title,
  count,
  hint,
  children,
}: {
  title: string;
  count?: number;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-7">
      <div className="flex items-baseline gap-2 mb-1">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--bone-0)' }}>
          {title}
        </h2>
        {count != null && (
          <span className="font-mono text-[10.5px] text-bone-3 tnum">
            {String(count).padStart(2, '0')}
          </span>
        )}
      </div>
      {hint && <p className="text-[12px] text-ink-3 mb-2.5 max-w-[64ch]">{hint}</p>}
      {children}
    </section>
  );
}

export default memo(StudyView);

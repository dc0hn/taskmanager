import { describe, it, expect } from 'vitest';
import {
  append,
  decodeEvent,
  encodeEvent,
  eventsOn,
  RAW_WINDOW_DAYS,
  trimRaw,
  type EventKind,
  type StudyEvent,
} from './study/ledger';
import {
  buildDigest,
  digestFinishedDays,
  emptyDigest,
  pruneDigests,
  selfCheck,
  type DayDigest,
} from './study/digest';
import { battery, byWeekday } from './study/metrics';
import {
  BASELINE_DAYS,
  buildBriefing,
  FINDINGS_FORMAT,
  parseFindings,
  scoreFinding,
  shouldExport,
  type Finding,
} from './study/briefing';
import { answeredCount, emptyProfile, QUESTIONS, revise } from './study/profile';
import { LIMITS } from './study/limits';
import type { Block } from './types';

const TODAY = '2026-08-14';

const ev = (over: Partial<StudyEvent> = {}): StudyEvent => ({
  at: 1786000000,
  kind: 'block.done',
  date: TODAY,
  ref: 'b1',
  a: 0,
  b: 0,
  ...over,
});

const block = (over: Partial<Block> = {}): Block => ({
  id: 'b1',
  title: 'Write',
  start: 540,
  end: 600,
  category: 'deep',
  ...over,
});

const digest = (over: Partial<DayDigest> = {}): DayDigest => ({
  ...emptyDigest('2026-08-01'),
  ...over,
});

// ---------------------------------------------------------------------------
// The codec. It exists to hit a storage budget, so it is measured, not trusted.
// ---------------------------------------------------------------------------

describe('the event codec', () => {
  it('round-trips every kind of event', () => {
    const kinds: EventKind[] = [
      'app.open', 'view.switch', 'day.nav',
      'task.add', 'task.remove', 'task.edit',
      'block.create', 'block.edit', 'block.move', 'block.resize',
      'block.done', 'block.undone', 'block.delete',
      'day.build', 'day.replan', 'day.clear',
    ];
    for (const kind of kinds) {
      const original = ev({ kind, ref: 'x9', a: -45, b: 3 });
      expect(decodeEvent(encodeEvent(original)), kind).toEqual(original);
    }
  });

  it('round-trips an event with everything empty', () => {
    const original = ev({ kind: 'app.open', ref: '', a: 0, b: 0 });
    expect(decodeEvent(encodeEvent(original))).toEqual(original);
  });

  it('drops trailing zeros to earn its keep', () => {
    // Date before ref is what makes this fire: a navigation event carries a date and
    // nothing else, so it costs three fields rather than six.
    expect(encodeEvent(ev({ kind: 'app.open', ref: '', a: 0, b: 0 }))).toHaveLength(3);
    expect(encodeEvent(ev({ kind: 'app.open', ref: '', date: '', a: 0, b: 0 }))).toHaveLength(2);
  });

  it('stays inside the storage budget the section promises', () => {
    // The whole reason for a positional codec, and it is asserted over a REALISTIC MIX
    // rather than one event — a day is mostly ref-less navigation, and measuring a
    // worst-case block.move would set a budget no design could meet.
    //
    // If this regresses, the fortnight of raw events stops fitting ~109 KB and the
    // storage figure quoted to the user becomes false.
    const day = [
      ...Array(11).fill(ev({ kind: 'app.open', ref: '', a: 0, b: 0 })),
      ...Array(120).fill(ev({ kind: 'view.switch', ref: 'week', a: 0, b: 0 })),
      ...Array(89).fill(ev({ kind: 'day.nav', ref: '', a: 0, b: 0 })),
      ...Array(12).fill(ev({ kind: 'block.done', ref: 'k3n8fq2m', a: 665, b: 60 })),
      ...Array(9).fill(ev({ kind: 'block.move', ref: 'k3n8fq2m', a: -45, b: 1 })),
      ...Array(24).fill(ev({ kind: 'block.edit', ref: 'k3n8fq2m', a: 0, b: 0 })),
    ];
    const bytes = JSON.stringify(day.map(encodeEvent)).length;
    expect(bytes / day.length).toBeLessThanOrEqual(31);
    // A fortnight of days this size, in kilobytes.
    expect((bytes * 14) / 1024).toBeLessThan(120);
  });

  it('refuses a row it cannot read rather than inventing a partial event', () => {
    for (const bad of [null, {}, [], [123], ['x', 1], [123, 99], [0, 1], [-5, 1]]) {
      expect(decodeEvent(bad), JSON.stringify(bad)).toBeNull();
    }
  });

  it('reads a short row as one with empty tail fields', () => {
    const decoded = decodeEvent([1786000000, 0]);
    expect(decoded).toMatchObject({ kind: 'app.open', ref: '', date: '', a: 0, b: 0 });
  });
});

describe('the raw window', () => {
  it('keeps today and drops what falls outside the window', () => {
    const events = [
      ev({ date: TODAY }),
      ev({ date: '2026-08-01' }), // 13 days back — inside
      ev({ date: '2026-07-31' }), // 14 days back — outside
      ev({ date: '2026-01-01' }),
    ];
    expect(trimRaw(events, TODAY).map((e) => e.date)).toEqual([TODAY, '2026-08-01']);
  });

  it('drops an event dated in the future rather than keeping it forever', () => {
    expect(trimRaw([ev({ date: '2026-09-01' })], TODAY)).toEqual([]);
  });

  it('holds exactly the advertised number of days', () => {
    const events = Array.from({ length: 40 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 14) - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      return ev({ date: key });
    });
    expect(trimRaw(events, TODAY)).toHaveLength(RAW_WINDOW_DAYS);
  });

  it('appends without reordering', () => {
    const a = ev({ at: 100 });
    const b = ev({ at: 50 });
    expect(append([a], b).map((e) => e.at)).toEqual([100, 50]);
  });

  it('reads one day back in time order', () => {
    const events = [ev({ at: 300 }), ev({ at: 100, date: '2026-08-01' }), ev({ at: 200 })];
    expect(eventsOn(events, TODAY).map((e) => e.at)).toEqual([200, 300]);
  });
});

// ---------------------------------------------------------------------------
// The digest — what survives the film being thrown away
// ---------------------------------------------------------------------------

const focus = (id: string) => id === 'deep';

describe('buildDigest', () => {
  it('measures the shape of a day', () => {
    const d = buildDigest(
      TODAY,
      [
        block({ id: 'a', start: 540, end: 660, completed: true, completedAt: 665 }),
        block({ id: 'b', start: 660, end: 690, category: 'admin' }),
        block({ id: 'c', start: 700, end: 715, category: 'break', auto: true }),
      ],
      [],
      undefined,
      focus
    );
    expect(d).toMatchObject({
      blocksPlanned: 2,
      blocksDone: 1,
      minutesPlanned: 150,
      minutesDone: 120,
      longestBlock: 120,
      deepMinutes: 120,
      focusMinutes: 120,
      contexts: 2,
    });
  });

  it('excludes auto blocks, which are the scheduler talking to itself', () => {
    const d = buildDigest(TODAY, [block({ auto: true })], [], undefined, focus);
    expect(d.blocksPlanned).toBe(0);
    expect(d.minutesPlanned).toBe(0);
  });

  it('leaves drift null when nothing carried a timestamp', () => {
    // Absence means unknown, never on time — the same rule `wasOnTime` holds.
    const d = buildDigest(TODAY, [block({ completed: true })], [], undefined, focus);
    expect(d.tickDrift).toBeNull();
    expect(d.firstTick).toBeNull();
  });

  it('reports drift signed, so early is visibly early', () => {
    const d = buildDigest(
      TODAY,
      [block({ completed: true, end: 600, completedAt: 570 })],
      [],
      undefined,
      focus
    );
    expect(d.tickDrift).toBe(-30);
  });

  it('counts motions from the event log', () => {
    const d = buildDigest(TODAY, [], [
      ev({ kind: 'app.open' }),
      ev({ kind: 'app.open' }),
      ev({ kind: 'block.move' }),
      ev({ kind: 'view.switch' }),
      ev({ kind: 'day.nav' }),
      ev({ kind: 'day.build' }),
      ev({ kind: 'app.open', date: '2026-01-01' }),
    ], undefined, focus);
    expect(d).toMatchObject({
      opens: 2, moves: 1, viewSwitches: 1, dayNavigations: 1, builds: 1,
    });
  });

  it("defers to the app's own figures where a stat exists", () => {
    // So the study and the app can never quote different numbers for the same day.
    const d = buildDigest(TODAY, [block({ start: 0, end: 60 })], [], {
      date: TODAY,
      plannedMinutes: 999,
      doneMinutes: 480,
      xpEarned: 0,
      brassEarned: 0,
      bestCombo: 0,
      cleared: false,
      completedCount: 0,
      focusMinutes: 300,
    }, focus);
    expect(d.minutesPlanned).toBe(999);
    expect(d.minutesDone).toBe(480);
    expect(d.focusMinutes).toBe(300);
  });
});

describe('digestFinishedDays', () => {
  const noBlocks = () => [];
  const noStat = () => undefined;

  it('never digests today, because it has not finished happening', () => {
    const out = digestFinishedDays(TODAY, [ev({ date: TODAY })], [], noBlocks, noStat, focus);
    expect(out).toEqual([]);
  });

  it('digests a finished day', () => {
    const out = digestFinishedDays(
      TODAY, [ev({ date: '2026-08-13' })], [], noBlocks, noStat, focus
    );
    expect(out.map((d) => d.date)).toEqual(['2026-08-13']);
  });

  it('is idempotent — a sealed day is never rebuilt', () => {
    const events = [ev({ date: '2026-08-13' })];
    const first = digestFinishedDays(TODAY, events, [], noBlocks, noStat, focus);
    const second = digestFinishedDays(TODAY, events, first, noBlocks, noStat, focus);
    expect(second).toEqual([]);
  });

  it('returns only what is new, so a bug can add a day but never rewrite one', () => {
    const sealed = [digest({ date: '2026-08-13', opens: 99 })];
    const out = digestFinishedDays(
      TODAY,
      [ev({ date: '2026-08-13' }), ev({ date: '2026-08-12' })],
      sealed, noBlocks, noStat, focus
    );
    expect(out.map((d) => d.date)).toEqual(['2026-08-12']);
  });

  it('prunes by date, keeping the window', () => {
    const kept = pruneDigests(
      [digest({ date: '2026-08-13' }), digest({ date: '2020-01-01' })],
      TODAY, 400
    );
    expect(kept.map((d) => d.date)).toEqual(['2026-08-13']);
  });
});

// ---------------------------------------------------------------------------
// The battery. Its refusals matter more than its answers.
// ---------------------------------------------------------------------------

describe('the metric battery', () => {
  const day = (over: Partial<DayDigest> = {}) =>
    digest({ blocksPlanned: 5, blocksDone: 4, minutesPlanned: 300, minutesDone: 240, ...over });

  it('refuses every metric on an empty record', () => {
    for (const m of battery([])) {
      expect(m.value, m.id).toBeNull();
      expect(m.confidence, m.id).toBe('none');
      expect(m.display, m.id).toBe('');
    }
  });

  it('refuses rather than answering from too few days', () => {
    // §XII: the finding is "insufficient evidence, continuing to observe". A battery
    // that quietly divides by three days produces exactly the confident nonsense the
    // method exists to prevent.
    const three = Array.from({ length: 3 }, (_, i) =>
      day({ date: `2026-08-0${i + 1}` })
    );
    const completion = battery(three).find((m) => m.id === 'completion')!;
    expect(completion.value).toBeNull();
    expect(completion.n).toBe(3);
    expect(completion.needs).toBe(5);
  });

  it('answers once the requirement is met', () => {
    const seven = Array.from({ length: 7 }, (_, i) =>
      day({ date: `2026-08-0${i + 1}` })
    );
    const completion = battery(seven).find((m) => m.id === 'completion')!;
    expect(completion.value).toBeCloseTo(0.8, 5);
    expect(completion.display).toBe('80%');
  });

  it('grades confidence by how much evidence there is', () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => day({ date: `2026-${String(i + 1).padStart(2, '0')}-01` }));
    const at = (n: number) => battery(make(n)).find((m) => m.id === 'completion')!.confidence;
    expect(at(4)).toBe('none');
    expect(at(6)).toBe('weak');
    expect(at(12)).toBe('fair');
    expect(at(25)).toBe('good');
  });

  it('never claims to measure actual duration', () => {
    // The single most important honesty requirement in the brief. The app records when
    // a block was ticked and nothing else.
    const drift = battery([])!.find((m) => m.id === 'tick-drift')!;
    expect(drift.caveat).toMatch(/never when it was started/i);
    expect(battery([]).some((m) => /actual duration/i.test(m.label))).toBe(false);
  });

  it('gives every metric a definition and a version', () => {
    for (const m of battery([])) {
      expect(m.definition.length, m.id).toBeGreaterThan(10);
      expect(m.version, m.id).toBeGreaterThanOrEqual(1);
    }
  });

  it('has no duplicate metric ids', () => {
    const ids = battery([]).map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ignores days with no plan when averaging planned work', () => {
    // A day off is not a day of zero commitment, and letting it into the mean would
    // report a holiday as a collapse in output.
    const days = [
      ...Array.from({ length: 5 }, (_, i) => day({ date: `2026-08-0${i + 1}` })),
      digest({ date: '2026-08-06' }),
    ];
    const committed = battery(days).find((m) => m.id === 'committed')!;
    expect(committed.value).toBe(300);
  });
});

describe('byWeekday', () => {
  it('returns all seven days, empty ones included', () => {
    const rows = byWeekday([]);
    expect(rows).toHaveLength(7);
    expect(rows.every((r) => r.n === 0 && r.completion === null)).toBe(true);
  });

  it('files a date under the right weekday, in UTC', () => {
    // 2026-08-03 is a Monday.
    const rows = byWeekday([digest({ date: '2026-08-03', blocksPlanned: 2, blocksDone: 1 })]);
    expect(rows[1].n).toBe(1);
    expect(rows[1].completion).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// The round trip
// ---------------------------------------------------------------------------

describe('when to export', () => {
  const days = (n: number) =>
    Array.from({ length: n }, (_, i) => digest({ date: `2026-01-${String(i + 1).padStart(2, '0')}` }));

  it('refuses before the baseline is complete', () => {
    const p = shouldExport(days(4), null, TODAY);
    expect(p.ready).toBe(false);
    expect(p.reason).toMatch(/10 more days/);
  });

  it('offers the first export once the baseline is done', () => {
    const p = shouldExport(days(BASELINE_DAYS), null, TODAY);
    expect(p.ready).toBe(true);
    expect(p.reason).toMatch(/Baseline complete/);
  });

  it('waits a week between exports, because a week is one observation', () => {
    expect(shouldExport(days(30), '2026-08-11', TODAY).ready).toBe(false);
    expect(shouldExport(days(30), '2026-08-07', TODAY).ready).toBe(true);
  });
});

describe('the briefing pack', () => {
  it('carries the limits alongside the data they qualify', () => {
    const pack = buildBriefing(TODAY, [digest()], emptyProfile(), []);
    expect(pack.limits).toBe(LIMITS);
    expect(pack.limits.length).toBeGreaterThan(0);
  });

  it('sends days oldest first, so the series can be read as a series', () => {
    const pack = buildBriefing(
      TODAY,
      [digest({ date: '2026-08-05' }), digest({ date: '2026-08-01' })],
      emptyProfile(), []
    );
    expect(pack.days.map((d) => d.date)).toEqual(['2026-08-01', '2026-08-05']);
  });
});

describe('importing findings', () => {
  const pack = (findings: unknown[]) => ({ format: FINDINGS_FORMAT, findings });
  const good = {
    id: 'f1',
    dated: '2026-08-14',
    kind: 'inferred',
    headline: 'Thursday reschedules run high',
    detail: 'Across six weeks.',
  };

  it('reads a well-formed pack', () => {
    const { pack: p, error } = parseFindings(pack([good]));
    expect(error).toBe('');
    expect(p!.findings[0]).toMatchObject({ id: 'f1', kind: 'inferred' });
  });

  it('refuses a pack in the wrong format', () => {
    expect(parseFindings({ format: 'something.else', findings: [good] }).pack).toBeNull();
    expect(parseFindings('not json at all').pack).toBeNull();
  });

  it('DROPS a finding with no evidence class rather than defaulting one', () => {
    // The one place this codebase refuses instead of repairing. A finding whose `kind`
    // fell off and defaulted to 'observed' would launder a hypothesis into a fact.
    const { pack: p } = parseFindings(pack([{ ...good, kind: undefined }]));
    expect(p).toBeNull();
    for (const kind of ['guess', '', 'OBSERVED', 7]) {
      expect(parseFindings(pack([{ ...good, kind }])).pack, String(kind)).toBeNull();
    }
  });

  it('drops a finding with no id or no headline', () => {
    expect(parseFindings(pack([{ ...good, id: '' }])).pack).toBeNull();
    expect(parseFindings(pack([{ ...good, headline: '   ' }])).pack).toBeNull();
  });

  it('keeps the good findings and drops the bad from the same pack', () => {
    const { pack: p } = parseFindings(pack([good, { ...good, id: 'f2', kind: 'nonsense' }]));
    expect(p!.findings.map((f) => f.id)).toEqual(['f1']);
  });

  it('reads a watch only when it is complete', () => {
    const withWatch = { ...good, watch: { metric: 'deep-ratio', direction: 'up', from: 0.3 } };
    expect(parseFindings(pack([withWatch])).pack!.findings[0].watch).toEqual({
      metric: 'deep-ratio', direction: 'up', from: 0.3, target: undefined,
    });
    for (const bad of [
      { metric: 'deep-ratio', direction: 'up' },
      { metric: 'deep-ratio', from: 0.3 },
      { metric: 'deep-ratio', direction: 'sideways', from: 0.3 },
      { direction: 'up', from: 0.3 },
    ]) {
      const parsed = parseFindings(pack([{ ...good, watch: bad }])).pack!;
      expect(parsed.findings[0].watch, JSON.stringify(bad)).toBeUndefined();
    }
  });

  it('keeps a named voice, and only a real one', () => {
    expect(parseFindings(pack([{ ...good, voice: 'lillian' }])).pack!.findings[0].voice)
      .toBe('lillian');
    expect(parseFindings(pack([{ ...good, voice: 'gilbert' }])).pack!.findings[0].voice)
      .toBeUndefined();
  });
});

describe('checking a finding against what happened next', () => {
  const finding = (watch?: Finding['watch']): Finding => ({
    id: 'f1', dated: '2026-08-01', kind: 'hypothesis',
    headline: 'Deep work will rise', detail: '', watch,
  });
  const days = (n: number, over: Partial<DayDigest> = {}) =>
    Array.from({ length: n }, (_, i) =>
      digest({
        date: `2026-08-${String(i + 1).padStart(2, '0')}`,
        blocksPlanned: 5, blocksDone: 4, minutesPlanned: 300, ...over,
      })
    );

  it('says so when there is no prediction to check', () => {
    expect(scoreFinding(finding(), battery(days(10))).verdict).toBe('unmeasurable');
  });

  it('says so when the metric cannot be computed yet', () => {
    const check = scoreFinding(
      finding({ metric: 'deep-ratio', direction: 'up', from: 0.3 }),
      battery(days(2))
    );
    expect(check.verdict).toBe('unmeasurable');
    expect(check.note).toMatch(/does not have enough data/);
  });

  it('reports a real move in the predicted direction as held', () => {
    const current = battery(days(10, { deepMinutes: 300 })); // ratio 1.0
    const check = scoreFinding(
      finding({ metric: 'deep-ratio', direction: 'up', from: 0.3 }),
      current
    );
    expect(check.verdict).toBe('held');
  });

  it('reports a move the other way as contradicted, not as silence', () => {
    // §XII requires negative results be published.
    const current = battery(days(10, { deepMinutes: 0 })); // ratio 0
    const check = scoreFinding(
      finding({ metric: 'deep-ratio', direction: 'up', from: 0.3 }),
      current
    );
    expect(check.verdict).toBe('contradicted');
  });

  it('calls a small move flat rather than a win', () => {
    // "a 4% change in a noisy metric over one week is nothing, and calling it a win is
    // how this practice degrades into astrology."
    const current = battery(days(10, { deepMinutes: 315 })); // ratio 1.05
    const check = scoreFinding(
      finding({ metric: 'deep-ratio', direction: 'up', from: 1.0 }),
      current
    );
    expect(check.verdict).toBe('flat');
  });

  it('refuses a ratio against zero rather than reporting infinite improvement', () => {
    const check = scoreFinding(
      finding({ metric: 'deep-ratio', direction: 'up', from: 0 }),
      battery(days(10, { deepMinutes: 300 }))
    );
    expect(check.verdict).toBe('unmeasurable');
  });

  it('contradicts a steady prediction when the metric moves either way', () => {
    for (const deepMinutes of [0, 300]) {
      const check = scoreFinding(
        finding({ metric: 'deep-ratio', direction: 'steady', from: 0.5 }),
        battery(days(10, { deepMinutes }))
      );
      expect(check.verdict, String(deepMinutes)).toBe('contradicted');
    }
  });
});

// ---------------------------------------------------------------------------
// The Individuality File
// ---------------------------------------------------------------------------

describe('the individuality file', () => {
  const answers = {
    work: 'a', goodWeek: 'b', recovered: 'c', selfDiagnosis: 'd', nonNegotiable: 'e',
  };

  it('asks all five reconnaissance questions', () => {
    expect(QUESTIONS).toHaveLength(5);
    for (const q of QUESTIONS) {
      expect(q.because.length, q.key).toBeGreaterThan(20);
    }
  });

  it('counts what has been answered', () => {
    expect(answeredCount(emptyProfile())).toBe(0);
    expect(answeredCount(revise(emptyProfile(), { ...answers, work: '' }, TODAY))).toBe(4);
  });

  it('treats whitespace as unanswered', () => {
    const p = revise(emptyProfile(), { ...answers, work: '   ' }, TODAY);
    expect(answeredCount(p)).toBe(4);
  });

  it('keeps the previous answers when they change, because a changed mind is data', () => {
    const first = revise(emptyProfile(), answers, '2026-01-01');
    const second = revise(first, { ...answers, goodWeek: 'something else' }, TODAY);
    expect(second.history).toHaveLength(1);
    expect(second.history[0]).toMatchObject({ revised: '2026-01-01' });
    expect(second.history[0].answers.goodWeek).toBe('b');
  });

  it('does not manufacture a revision when nothing changed', () => {
    const first = revise(emptyProfile(), answers, '2026-01-01');
    expect(revise(first, answers, TODAY)).toBe(first);
  });

  it('bounds the history rather than keeping every edit forever', () => {
    let p = emptyProfile();
    for (let i = 0; i < 40; i++) {
      p = revise(p, { ...answers, work: `v${i}` }, `2026-01-${String((i % 28) + 1).padStart(2, '0')}`);
    }
    expect(p.history.length).toBeLessThanOrEqual(20);
  });
});

describe('the stated limits', () => {
  it('names the actual-duration gap, which is the brief’s primary measurement', () => {
    const limit = LIMITS.find((l) => l.id === 'actual-duration');
    expect(limit).toBeDefined();
    expect(limit!.instead).toMatch(/not computed at all rather than estimated/i);
  });

  it('gives every limit a mechanical reason and a substitute', () => {
    for (const l of LIMITS) {
      expect(l.because.length, l.id).toBeGreaterThan(20);
      expect(l.instead.length, l.id).toBeGreaterThan(10);
    }
  });

  it('separates what is merely unrecorded from what is unrecordable', () => {
    // The difference matters: one is a backlog item, the other is a permanent
    // boundary on what this study can ever claim.
    expect(LIMITS.some((l) => l.status === 'not recorded')).toBe(true);
    expect(LIMITS.some((l) => l.status === 'unrecordable')).toBe(true);
  });

  it('admits the study is watching a watched subject', () => {
    expect(LIMITS.find((l) => l.id === 'hawthorne')).toBeDefined();
  });
});

describe('the digest self-check', () => {
  const blocks = (n: number): Block[] =>
    Array.from({ length: n }, (_, i) =>
      block({ id: `b${i}`, start: 540 + i * 60, end: 600 + i * 60 })
    );

  it('is silent when a sealed row still matches', () => {
    const sealed = buildDigest('2026-08-01', blocks(3), [], undefined, focus);
    expect(selfCheck([sealed], () => blocks(3), focus)).toEqual([]);
  });

  it('names the field when a re-derivation disagrees', () => {
    const sealed = { ...buildDigest('2026-08-01', blocks(3), [], undefined, focus) };
    sealed.blocksPlanned = 99;
    const drift = selfCheck([sealed], () => blocks(3), focus);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toMatchObject({ field: 'blocksPlanned', sealed: 99, recomputed: 3 });
  });

  it('NEVER rewrites the sealed row', () => {
    // The sealed value is settled history. A self-check that corrected it would be the
    // very drift it exists to detect.
    const sealed = { ...buildDigest('2026-08-01', blocks(3), [], undefined, focus) };
    sealed.blocksPlanned = 99;
    selfCheck([sealed], () => blocks(3), focus);
    expect(sealed.blocksPlanned).toBe(99);
  });

  it('skips a day whose plan is gone rather than blaming the code', () => {
    const sealed = buildDigest('2026-08-01', blocks(3), [], undefined, focus);
    expect(selfCheck([sealed], () => [], focus)).toEqual([]);
  });

  it('does not compare motion counts, which the raw events no longer support', () => {
    const sealed = { ...buildDigest('2026-08-01', blocks(1), [], undefined, focus) };
    sealed.opens = 11;
    sealed.moves = 4;
    expect(selfCheck([sealed], () => blocks(1), focus)).toEqual([]);
  });

  it('samples the most recent days first', () => {
    const days = Array.from({ length: 40 }, (_, i) =>
      buildDigest(`2026-08-${String(i + 1).padStart(2, '0')}`, blocks(1), [], undefined, focus)
    );
    const drift = selfCheck(days, () => blocks(2), focus, 5);
    const dates = [...new Set(drift.map((d) => d.date))];
    expect(dates).toHaveLength(5);
    expect(dates).toContain('2026-08-40');
  });
});

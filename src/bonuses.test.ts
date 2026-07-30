import { describe, it, expect } from 'vitest';
import {
  BONUSES,
  mergeDisciplines,
  noDeferKey,
  planAheadDue,
  planAheadKey,
  reviewAwardsDue,
  reviewKey,
} from './bonuses';
import type { WeekReview } from './goals';
import type { AwardLedger, Block, DayPlan } from './types';

const TODAY = '2026-07-30';
const TOMORROW = '2026-07-31';
const NONE: AwardLedger = { granted: [] };

function block(p: Partial<Block> = {}): Block {
  return {
    id: 'b1',
    title: 'Edit gallery',
    start: 540,
    end: 600,
    category: 'deep',
    ...p,
  };
}

function plan(date: string, blocks: Block[]): DayPlan {
  return { date, tasks: [], blocks };
}

function review(p: Partial<WeekReview> = {}): WeekReview {
  return {
    week: '2026-07-20',
    byCategory: [],
    doneMinutes: 300,
    plannedMinutes: 400,
    goals: [],
    met: [],
    slipped: [],
    missed: [],
    voided: [],
    ...p,
  };
}

/** A stand-in for a goal progress row; only its presence matters here. */
const goal = { goalId: 'g1' } as unknown as WeekReview['goals'][number];

// ---------------------------------------------------------------------------

describe('the bonus table', () => {
  it('routes every bonus to a discipline that exists', () => {
    for (const spec of Object.values(BONUSES)) {
      expect(['planning', 'insight']).toContain(spec.discipline);
      expect(spec.xp).toBeGreaterThan(0);
      expect(spec.label.length).toBeGreaterThan(0);
    }
  });

  it('pays a clean week more than a single act of reading', () => {
    expect(BONUSES.nodefer.xp).toBeGreaterThan(BONUSES.review.xp);
  });
});

describe('planAheadDue', () => {
  it('pays when tomorrow has real blocks', () => {
    const plans = { [TOMORROW]: plan(TOMORROW, [block()]) };
    const r = planAheadDue(NONE, plans, TODAY);
    expect(r.keys).toEqual([planAheadKey(TOMORROW)]);
    expect(r.xp).toBe(BONUSES.plan.xp);
    expect(r.disciplines.planning).toBe(BONUSES.plan.xp);
  });

  it('pays nothing when tomorrow is empty', () => {
    expect(planAheadDue(NONE, { [TOMORROW]: plan(TOMORROW, []) }, TODAY).keys).toEqual([]);
    expect(planAheadDue(NONE, {}, TODAY).keys).toEqual([]);
  });

  it('does not count a day holding only auto blocks', () => {
    // The scheduler adds its own breaks. A day containing nothing but a shutdown
    // block has not been planned by anyone.
    const plans = { [TOMORROW]: plan(TOMORROW, [block({ auto: true })]) };
    expect(planAheadDue(NONE, plans, TODAY).keys).toEqual([]);
  });

  it('ignores a plan for today, however full it is', () => {
    const plans = { [TODAY]: plan(TODAY, [block(), block({ id: 'b2' })]) };
    expect(planAheadDue(NONE, plans, TODAY).keys).toEqual([]);
  });

  it('ignores a plan for next week', () => {
    const later = '2026-08-05';
    expect(planAheadDue(NONE, { [later]: plan(later, [block()]) }, TODAY).keys).toEqual([]);
  });

  it('pays once per day planned, so editing the same plan cannot farm it', () => {
    const plans = { [TOMORROW]: plan(TOMORROW, [block()]) };
    const held: AwardLedger = { granted: [planAheadKey(TOMORROW)] };
    expect(planAheadDue(held, plans, TODAY).keys).toEqual([]);
  });

  it('keys on the day being planned, not on today', () => {
    // So tomorrow's award survives into tomorrow without being re-payable.
    const plans = { [TOMORROW]: plan(TOMORROW, [block()]) };
    expect(planAheadDue(NONE, plans, TODAY).keys[0]).toContain(TOMORROW);
  });

  it('crosses a month boundary', () => {
    const plans = { '2026-08-01': plan('2026-08-01', [block()]) };
    expect(planAheadDue(NONE, plans, '2026-07-31').keys).toEqual([
      planAheadKey('2026-08-01'),
    ]);
  });
});

describe('reviewAwardsDue', () => {
  const PAST = '2026-07-20';
  const CURRENT = '2026-07-27';

  it('pays for reading a finished week', () => {
    const r = reviewAwardsDue(NONE, PAST, CURRENT, review({ goals: [goal] , met: [goal] }));
    expect(r.keys).toContain(reviewKey(PAST));
    expect(r.disciplines.insight).toBe(BONUSES.review.xp);
  });

  it('pays nothing for the week you are still in', () => {
    // Reading the current week is not reflection, it is looking at today with extra
    // steps.
    expect(reviewAwardsDue(NONE, CURRENT, CURRENT, review()).keys).toEqual([]);
  });

  it('pays nothing for a future week', () => {
    expect(reviewAwardsDue(NONE, '2026-08-03', CURRENT, review()).keys).toEqual([]);
  });

  it('adds the clean-week bonus when nothing slipped or was missed', () => {
    const r = reviewAwardsDue(
      NONE,
      PAST,
      CURRENT,
      review({ goals: [goal, goal], met: [goal, goal] })
    );
    expect(r.keys).toContain(noDeferKey(PAST));
    expect(r.xp).toBe(BONUSES.review.xp + BONUSES.nodefer.xp);
  });

  it('withholds the clean-week bonus when something slipped', () => {
    const r = reviewAwardsDue(NONE, PAST, CURRENT, review({ goals: [goal], slipped: [goal] }));
    expect(r.keys).toContain(reviewKey(PAST));
    expect(r.keys).not.toContain(noDeferKey(PAST));
  });

  it('withholds it when something was missed outright', () => {
    const r = reviewAwardsDue(NONE, PAST, CURRENT, review({ goals: [goal], missed: [goal] }));
    expect(r.keys).not.toContain(noDeferKey(PAST));
  });

  it('does not treat a voided goal as a deferral', () => {
    // Standing something down deliberately is a decision, and the app already reports
    // it separately from a miss. The bonus is not going to disagree.
    const r = reviewAwardsDue(
      NONE,
      PAST,
      CURRENT,
      review({ goals: [goal, goal], met: [goal], voided: [goal] })
    );
    expect(r.keys).toContain(noDeferKey(PAST));
  });

  it('pays nothing at all for an empty week', () => {
    // Found live: stepping back through a year of blank weeks collected fifty XP
    // apiece for reading nothing.
    const empty = review({ goals: [], plannedMinutes: 0, doneMinutes: 0 });
    expect(reviewAwardsDue(NONE, PAST, CURRENT, empty).keys).toEqual([]);
    expect(reviewAwardsDue(NONE, PAST, CURRENT, empty).xp).toBe(0);
  });

  it('still pays for a week with time logged but no goals set', () => {
    // There is real work to reflect on, even with nothing formally intended.
    const r = reviewAwardsDue(NONE, PAST, CURRENT, review({ goals: [], plannedMinutes: 400 }));
    expect(r.keys).toEqual([reviewKey(PAST)]);
  });

  it('pays nothing clean for a week with no goals at all', () => {
    // A week where nothing was intended cannot have had nothing deferred, and paying
    // for it would reward not planning.
    const r = reviewAwardsDue(NONE, PAST, CURRENT, review({ goals: [], plannedMinutes: 400 }));
    expect(r.keys).toContain(reviewKey(PAST));
    expect(r.keys).not.toContain(noDeferKey(PAST));
  });

  it('pays each week once', () => {
    const held: AwardLedger = { granted: [reviewKey(PAST), noDeferKey(PAST)] };
    const r = reviewAwardsDue(held, PAST, CURRENT, review({ goals: [goal], met: [goal] }));
    expect(r.keys).toEqual([]);
    expect(r.xp).toBe(0);
  });

  it('can still pay the clean bonus after the read was already paid', () => {
    const held: AwardLedger = { granted: [reviewKey(PAST)] };
    const r = reviewAwardsDue(held, PAST, CURRENT, review({ goals: [goal], met: [goal] }));
    expect(r.keys).toEqual([noDeferKey(PAST)]);
  });
});

describe('mergeDisciplines', () => {
  it('adds into an existing bag', () => {
    expect(mergeDisciplines({ planning: 40 }, { planning: 40, insight: 50 })).toEqual({
      planning: 80,
      insight: 50,
    });
  });

  it('starts from nothing', () => {
    expect(mergeDisciplines({}, { insight: 50 })).toEqual({ insight: 50 });
  });

  it('leaves the original untouched', () => {
    const before = { planning: 10 };
    mergeDisciplines(before, { planning: 10 });
    expect(before).toEqual({ planning: 10 });
  });

  it('is a no-op for an empty addition', () => {
    expect(mergeDisciplines({ planning: 10 }, {})).toEqual({ planning: 10 });
  });
});

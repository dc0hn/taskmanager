import type { AwardLedger, AwardPayout, DayPlan, DisciplineId } from './types';
import type { WeekReview } from './goals';
import { addDays } from './utils/time';

// ============================================================================
// Habit bonuses
//
// Three rewards for using Almanac well rather than for finishing tasks. They exist
// because the calendar only improves you if you keep coming back to it, and the two
// behaviours that most decide whether you do — planning ahead, and looking back —
// otherwise pay nothing at all.
//
// Each is a one-off keyed award, so they ride the same ledger as badges and streak
// milestones and inherit its idempotency for free.
//
// Two of the three are deliberately granted at the moment you LOOK, not at rollover.
// The honest reason is data: a week's review is derived from its blocks, and blocks
// older than the retention window are gone. Tying the award to the act of reading
// means the data needed is exactly the data already on screen — and reading it is the
// behaviour being rewarded anyway.
// ============================================================================

export const BONUSES: Record<
  string,
  { xp: number; discipline: DisciplineId; label: string }
> = {
  plan: { xp: 40, discipline: 'planning', label: 'Tomorrow planned before today ended' },
  review: { xp: 50, discipline: 'insight', label: 'Weekly review read' },
  nodefer: { xp: 120, discipline: 'planning', label: 'A week with nothing deferred' },
};

export function planAheadKey(dateKey: string): string {
  return `plan:${dateKey}`;
}

export function reviewKey(weekKey: string): string {
  return `review:${weekKey}`;
}

export function noDeferKey(weekKey: string): string {
  return `nodefer:${weekKey}`;
}

/**
 * Each bonus carries its own XP, discipline and label.
 *
 * Previously a list of keys beside one summed figure and one merged discipline map,
 * which meant the caller could only pay all of it or none of it. Both bonuses here are
 * raised by the same act, so "one is new and one is not" is an ordinary state — and the
 * summed form paid for both.
 */
function collect(kinds: string[]): AwardPayout[] {
  const payouts: AwardPayout[] = [];
  for (const kind of kinds) {
    const spec = BONUSES[kind.split(':')[0]];
    if (!spec) continue;
    payouts.push({ key: kind, xp: spec.xp, discipline: spec.discipline, label: spec.label });
  }
  return payouts;
}

/**
 * Is tomorrow planned, while it is still today?
 *
 * Keyed on the date being planned rather than on today, so it pays once per day
 * planned ahead and cannot be farmed by editing the same plan repeatedly.
 *
 * Auto blocks do not count. The scheduler adds its own breaks, and a day containing
 * nothing but a shutdown block is not a planned day.
 */
export function planAheadDue(
  ledger: AwardLedger,
  plans: Record<string, DayPlan>,
  today: string
): AwardPayout[] {
  const tomorrow = addDays(today, 1);
  const blocks = plans[tomorrow]?.blocks ?? [];
  if (!blocks.some((b) => !b.auto)) return [];
  const key = planAheadKey(tomorrow);
  if (ledger.granted.includes(key)) return [];
  return collect([key]);
}

/**
 * Bonuses owed for looking back at a week that has finished.
 *
 * Both are evaluated together because they answer the same act. The no-defer bonus
 * needs a week with goals in it — a week where nothing was intended cannot have had
 * nothing deferred, and paying for that would reward not planning.
 *
 * Voided goals are not deferrals. Standing something down deliberately is a decision,
 * and the app has always reported it separately from a miss; it would be perverse for
 * the bonus to disagree.
 */
export function reviewAwardsDue(
  ledger: AwardLedger,
  weekKey: string,
  currentWeek: string,
  review: WeekReview
): AwardPayout[] {
  // Only a finished week can be reviewed. Reading the week you are still in is not
  // reflection, it is just looking at today with extra steps.
  if (weekKey >= currentWeek) return [];

  // And only a week that holds something. Without this the bonus is farmable: step
  // back through a year of blank weeks and collect fifty XP apiece for reading
  // nothing. A week with no goals and no time recorded has nothing to reflect on.
  const hasSubstance = review.goals.length > 0 || review.plannedMinutes > 0;
  if (!hasSubstance) return [];

  const kinds: string[] = [];
  const read = reviewKey(weekKey);
  if (!ledger.granted.includes(read)) kinds.push(read);

  const clean =
    review.goals.length > 0 &&
    review.slipped.length === 0 &&
    review.missed.length === 0;
  const nodefer = noDeferKey(weekKey);
  if (clean && !ledger.granted.includes(nodefer)) kinds.push(nodefer);

  return collect(kinds);
}

/** Merge discipline credits, for accumulating into stored progress. */
export function mergeDisciplines(
  into: Partial<Record<DisciplineId, number>>,
  add: Partial<Record<DisciplineId, number>>
): Partial<Record<DisciplineId, number>> {
  const out = { ...into };
  for (const [id, xp] of Object.entries(add)) {
    const key = id as DisciplineId;
    out[key] = (out[key] ?? 0) + (xp ?? 0);
  }
  return out;
}

// ============================================================================
// What the instrument cannot see
//
// §V: "You observe the calendar, not the life... Never present calendar-derived
// inference as observed fact." This file is that requirement made concrete, and it is
// deliberately a first-class part of the section rather than a footnote — a study whose
// limits are stated once in a preamble and never again will be read as if it had none.
//
// The list is maintained by hand and should GROW as the study finds new blind spots.
// An entry leaves only when the app genuinely starts recording the thing.
// ============================================================================

export interface Limit {
  id: string;
  /** What the study cannot know. */
  blind: string;
  /** Why — the actual mechanical reason, not a hedge. */
  because: string;
  /** What the study uses instead, and what that substitute is worth. */
  instead: string;
  /** Whether recording it is possible at all, or merely not done yet. */
  status: 'not recorded' | 'unrecordable';
}

export const LIMITS: Limit[] = [
  {
    id: 'actual-duration',
    blind: 'How long any piece of work actually took',
    because:
      'Almanac records when a block was TICKED, never when it was started. There is no actual duration anywhere in the data model.',
    instead:
      'Lateness against the booked slot, which is a different quantity and is labelled as one. The plan-to-actual ratio — called the primary measurement in the brief — is not computed at all rather than estimated.',
    status: 'not recorded',
  },
  {
    id: 'off-calendar-work',
    blind: 'Work done that was never on the calendar',
    because:
      'The calendar is a record of intention. Time not scheduled is not time not worked, and nothing in the app observes the difference.',
    instead:
      'Nothing. Every figure here is about planned work only, and a low completion rate may mean a day spent working on something else entirely.',
    status: 'unrecordable',
  },
  {
    id: 'context-switching',
    blind: 'Switching between other applications',
    because:
      'Almanac sees its own window and nothing else. The Transport therbligs — moving between tools, re-finding your place — happen outside it.',
    instead:
      'Navigation inside Almanac, and distinct categories per day as a crude proxy. Both are weak substitutes and are marked as such.',
    status: 'unrecordable',
  },
  {
    id: 'interruption',
    blind: 'Whether a long block was actually uninterrupted',
    because:
      'A 90-minute block is a 90-minute intention. The app cannot see the phone call in the middle of it.',
    instead:
      'The deep-work ratio measures the SHAPE OF THE PLAN, not the experience of it. It is named that way on purpose.',
    status: 'unrecordable',
  },
  {
    id: 'setup-teardown',
    blind: 'Ramp-in and wind-down around a block',
    because:
      'Not modelled. A block has a start and an end and no concept of the time either side of it.',
    instead:
      'Nothing yet. The brief calls these the most under-scheduled elements in knowledge work, so this is the most valuable gap on the list.',
    status: 'not recorded',
  },
  {
    id: 'why',
    blind: 'Why anything happened',
    because:
      'A rescheduled block and an abandoned one look identical in an event log. Intent is not observable.',
    instead:
      'The Fatigue and Affect log, which is you telling the study what the data cannot. It is the only route to this and the study is worth much less without it.',
    status: 'unrecordable',
  },
  {
    id: 'hawthorne',
    blind: 'Whether being observed is changing the behaviour',
    because:
      '§XI: you know you are being watched, by the app and by the study. Behaviour under observation is not baseline behaviour.',
    instead:
      'Expect an early improvement that is an artifact of attention rather than of method. The study will not claim credit for the first two weeks of movement.',
    status: 'unrecordable',
  },
];

// ============================================================================
// The Individuality File
//
// §XIII calls this the most underrated artifact the study keeps, and §XVII says to ask
// before measuring — Taylor would start timing immediately, Frank would start filming,
// Lillian would ask the worker first, and she is right.
//
// So these are the reconnaissance questions, asked inside the app rather than once in
// conversation. In the app because they are REVISABLE: what a good week looks like will
// change, and a study built on a year-old answer to that question is optimising for
// somebody who no longer exists.
//
// The self-diagnosis is recorded verbatim and treated as a HYPOTHESIS, not a finding.
// §VII is explicit that it is often wrong in an interesting way, and the only way to
// find out is to have written down what was believed before the data arrived.
// ============================================================================

export interface Individuality {
  /** ISO date the answers were last revised. Empty until first answered. */
  revised: string;
  /** Every prior version, newest first — so a changed mind is itself observable. */
  history: { revised: string; answers: Answers }[];
  answers: Answers;
}

export interface Answers {
  /** What the work actually consists of. */
  work: string;
  /** What a genuinely good week looks like — in their words, not in metrics. */
  goodWeek: string;
  /** What recovered time would be spent on. This defines happiness minutes. */
  recovered: string;
  /** Their own diagnosis of their problem. Tested, never assumed. */
  selfDiagnosis: string;
  /** What is non-negotiable — the things no optimum may touch. */
  nonNegotiable: string;
}

export interface Question {
  key: keyof Answers;
  prompt: string;
  /** Why the study is asking, so no question feels like a form to fill in. */
  because: string;
  placeholder: string;
}

export const QUESTIONS: Question[] = [
  {
    key: 'work',
    prompt: 'What does your work actually consist of?',
    because:
      'The calendar shows categories and durations. It cannot tell the difference between an hour of writing and an hour of waiting for someone to reply.',
    placeholder: 'The kinds of work, roughly how they divide, what a normal day holds…',
  },
  {
    key: 'goodWeek',
    prompt: 'What does a genuinely good week look like to you?',
    because:
      'Every metric here is a proxy for this. Without it the study will optimise for whatever is easiest to count, which is the oldest failure in the discipline.',
    placeholder: 'Not what you think you should say. What actually feels like a good week.',
  },
  {
    key: 'recovered',
    prompt: 'If the study gave you back three hours a week, what would you do with them?',
    because:
      'This is the real scoreboard. Happiness minutes are the hours returned to you for the things you said you valued — so the study needs to know what those are before it can claim to have returned any.',
    placeholder: 'Specific things, not "rest" — the study will look for whether they happened.',
  },
  {
    key: 'selfDiagnosis',
    prompt: 'What do you think your problem is?',
    because:
      'Recorded verbatim and treated as a hypothesis, not a finding. It is often wrong in an interesting way, and the only way to learn that is to have written it down first.',
    placeholder: 'Your own account of what goes wrong and why.',
  },
  {
    key: 'nonNegotiable',
    prompt: 'What is non-negotiable?',
    because:
      'The things no optimum may touch. A recommendation that ignores this will be correct in general and wrong for you, and the study will discard such recommendations rather than soften them.',
    placeholder: 'Fixed commitments, hours you will not work, ways you refuse to operate…',
  },
];

export function emptyProfile(): Individuality {
  return {
    revised: '',
    history: [],
    answers: {
      work: '',
      goodWeek: '',
      recovered: '',
      selfDiagnosis: '',
      nonNegotiable: '',
    },
  };
}

/** How many of the five have been answered. */
export function answeredCount(profile: Individuality): number {
  return QUESTIONS.filter((q) => profile.answers[q.key].trim().length > 0).length;
}

/**
 * Record a revision, keeping the previous answers.
 *
 * A changed mind is data. Someone whose account of a good week shifts over six months
 * has told the study something no metric would have caught, and overwriting the old
 * answer would destroy exactly that. Unchanged answers are not versioned — only a real
 * edit pushes history, so opening the form and closing it does not manufacture a
 * revision.
 */
export function revise(
  profile: Individuality,
  answers: Answers,
  today: string
): Individuality {
  const same = QUESTIONS.every((q) => profile.answers[q.key] === answers[q.key]);
  if (same) return profile;

  const history = profile.revised
    ? [{ revised: profile.revised, answers: profile.answers }, ...profile.history].slice(0, 20)
    : profile.history;

  return { revised: today, history, answers };
}

# Almanac — Progression v2

Hand-off spec. Five phases, in order. Phase 0 is a refactor and must land first;
Phases 1–4 are additive and can ship independently behind their own flags.

Scope was chosen deliberately: **moderate volume**. Enough content that nothing
repeats inside a season, not so much that the test suite stops keeping up.

---

## 0. Read this before touching anything

This codebase has invariants that are not obvious and are load-bearing. Every one
of them was paid for by a bug. Breaking one will not fail a test — it will quietly
inflate or deflate a lifetime total months later.

### 0.1 The scoring core is idempotent, and must stay that way

`reckonDay` is a pure function of `(date, blocks, categories, modifiers)`.
`reconcileDay` recomputes a day and applies only the **difference** against the
stored `DailyStat`. Run it a hundred times, the total is identical.

Consequences you must respect:

- **Never accumulate by listening to events.** No `totalXp += x` anywhere outside
  reconciliation and the award-ledger paths.
- **Any new multiplier must be a pure function of the date**, or of state that is
  sealed and never recomputed. A multiplier derived from live mutable state will
  drift the moment a day is reconciled twice.
- **Never widen what `reckonDay` reads without threading it through every call
  site.** There are five: `reconcileDay`, `areaTotals`, and three in `App.tsx`.
  This has been got wrong once already (boosters shipped half-wired).

### 0.2 Replace the trailing `boost` parameter with a modifiers object

Do this as the first change in Phase 1. Today `reckonDay(date, blocks, categories,
boost = 1)` takes a bare number, and adding a second scoring input as a second bare
parameter is how the boost bug happened.

```ts
export interface DayModifiers {
  /** Purchased booster for this specific day. 1 when none. */
  boost: number;
  /** The sealed character for the week this day belongs to. Null before Phase 1. */
  character: WeekCharacter | null;
}

export const NO_MODIFIERS: DayModifiers = { boost: 1, character: null };
```

`reckonDay(date, blocks, categories, mods = NO_MODIFIERS)`. Omitting a field
becomes a type error rather than a silent `1`. Build the object **once** in
`App.tsx` and share it — there is already a `boosts` memo doing exactly this for
the boost half; widen it.

### 0.3 One-off awards go through the ledger, per key

Every producer returns `AwardPayout[]` — `{ key, xp, discipline?, label? }`. Every
caller sums XP **from what `grantOnce` returned**, never from a pre-computed total.
This is already correct throughout; do not reintroduce a summed figure beside a
key list.

Award keys must encode enough to be unique forever: `assay:2026-08-03`,
`piecework:2026-08-03`, `goalrun:<goalId>:8`. A key that can recur pays twice.

### 0.4 Content arrays are append-only

`WILDCARDS`, `DAILY_CHALLENGES`, `WEEKLY_CHALLENGES`, and the new `CHARACTERS` are
indexed by a seeded `pick()` over the array. **Reordering or inserting changes what
a past week resolves to.** Append only, never reorder, never delete — retire an
item with an `active: false` flag that `pick` filters out at the *end* of the
array rather than removing it.

Add this as a comment at the head of each array, and a test that asserts the first
N ids in declaration order, so a reorder fails CI.

### 0.5 Storage validates everything on read

Every new persisted field needs a normaliser in `storage.ts` that clamps, defaults
and drops. A hand-edited or truncated profile must yield something usable, never a
`NaN` that reaches timeline geometry. Follow the existing shape: `isFiniteNum`,
`isDateKey`, explicit carry-through of every field.

**Every new field must also be carried through explicitly.** A normaliser that
drops a field is not a formatting detail; it is a silent behaviour change one
reload later.

### 0.6 Design principles that outrank any mechanic here

- **Misses are silent.** There is no penalty anywhere in this app. Not doing
  something earns nothing, which is already the whole of the feedback.
- **Rest is not lesser.** A completed break earns its minutes like anything else.
- **A reset is not a failure.** The vocabulary is "fresh start". Never phrase a
  broken run as something the user did wrong.
- **Nothing buys progress outright.** No shop item may grant XP or levels.
- **Every award is a second reading of facts the calendar already holds.** No
  mechanic pays for opening the app; it pays for work the record can verify.

### 0.7 Voice

Terse. Concrete. Almanac / workshop / press / observatory register. Names are plain
nouns or short phrases. Blurbs are one clause, sentence case, no exclamation marks,
no second-person cheerleading. Copy in this document is final — use it verbatim.

### 0.8 Testing bar

The suite is 795 tests across 21 files and is the reason this codebase can be
changed confidently. Every phase below adds tests in the same style:

- Pure functions get exhaustive unit tests including boundaries and empty input.
- Anything persisted gets a `storage.*.test.ts` round-trip including a corrupt record.
- Anything on a hot path gets a case in `perf.test.ts` with a `< 16ms` assertion.
- `npm test` must stay green. `npx tsc -b` and `npx eslint .` must both exit 0.

---

## Phase 0 — Progression reducer and reward queue

**Why first:** `App.tsx` is 2,638 lines with 40 `useState`, 45 `useEffect`, 31
`useMemo`, 45 `useCallback` and 11 eslint suppressions. Phases 1–4 add five
subsystems. Adding them to the current structure makes the extraction
substantially harder later, and the reward-queue bug below is already live.

### 0a. `src/progression/reducer.ts`

Roughly a dozen effects in `App.tsx` form one subsystem: they read
`progressRef` / `streakRef` / `awardsRef` / `shopRef`, compute payouts, and write
`progress` / `awards` / `streak` / `shop`. The refs-and-effects sequencing exists
to order writes that a reducer orders for free.

```ts
export interface ProgressionState {
  progress: UserProgress;
  awards: AwardLedger;
  streak: StreakState;
  shop: ShopState;
  dayStats: Record<string, DailyStat>;
}

export type ProgressionEvent =
  | { type: 'DaysReconciled'; days: { date: string; blocks: Block[] }[];
      categories: CategoryDef[]; modifiers: Record<string, DayModifiers> }
  | { type: 'MidnightPassed'; today: string; marks: DayMarks }
  | { type: 'Purchased'; itemId: string; weekKey: string }
  | { type: 'AwardsOffered'; payouts: AwardPayout[] }
  | { type: 'Reset'; today: string };

export interface ProgressionResult {
  state: ProgressionState;
  /** Reward moments to present, in the order they should be shown. */
  moments: RewardMoment[];
  changed: boolean;
}

export function progressionReducer(
  state: ProgressionState,
  event: ProgressionEvent
): ProgressionResult;
```

Requirements:

- **Pure.** No React, no `Date.now()`, no `localStorage`. Every time-dependent
  input arrives on the event. This is what makes it testable, and the confidence
  in the rest of this codebase comes from exactly that property.
- Award granting happens **once**, inside the reducer, so the mid-flush ledger
  problem `grantOnce` currently solves with a mutable ref disappears structurally.
- `App.tsx` keeps one `useReducer` plus the persistence effects. Delete the
  per-subsystem refs that exist only to be read inside effects.

Add `src/progression/reducer.test.ts`. Cover at minimum: the same event applied
twice changes nothing the second time; an award key already in the ledger pays
zero; a reconcile that lowers XP does not celebrate.

### 0b. `useRewardQueue()`

Eight states (`badgeQueue`, `codexQueue`, `questQueue`, `levelQueue`, `takeover`,
`runTakeover`, `runKept`, `xpFloat`) with eight independent timeout effects.

**This is a live bug, not only untidiness:** a level-up, a badge and a quest
completing in one commit each start their own timer and overlap on screen. One
ordered queue with one timer fixes it.

```ts
export type RewardMoment =
  | { kind: 'xp'; xp: number; combo: number }
  | { kind: 'level'; standing: Standing }
  | { kind: 'badge'; def: BadgeDef }
  | { kind: 'quest'; name: string; xp: number }
  | { kind: 'codex'; card: InsightCard }
  | { kind: 'runKept'; run: number }
  | { kind: 'takeover'; standing: Standing; prestige: boolean }
  | { kind: 'runTakeover'; days: number };
```

Ordering rule: takeovers pre-empt and clear the rest of the queue; otherwise
first-in-first-out. Each moment carries its own dwell time. Honour
`useReducedMotion` by collapsing dwell to a single short toast.

### 0c. Clear the three fixable suppressions

The commit note for `0c1ac7a` identifies three `react-hooks/set-state-in-effect`
suppressions "that a `key` prop would genuinely fix". Fix those three and remove
their entries from the eslint config. Leave the rest documented as they are.

**Phase 0 acceptance:** `App.tsx` under 1,800 lines. `npm test` green. No
behaviour change visible to the user except that overlapping reward moments now
queue instead of stacking.

---

## Phase 1 — Weekly characters

An almanac forecasts. Each week has a character, drawn deterministically from the
week key, that changes how scoring works for seven days. This is the highest
variety-per-line addition available, because it re-colours all existing content
rather than adding alongside it.

### 1a. Sealing — do this correctly or not at all

The character is derived from a **content array**, so if `CHARACTERS` is ever
extended or reordered, `pick()` resolves a *past* week to a different character
and every day in it re-scores at a different rate on the next reconcile. Lifetime
XP drifts with no record of why.

**Seal the character id into `WeekRecord` when the week is first issued.**

```ts
export interface WeekRecord {
  week: string;
  goals: WeeklyGoal[];
  credits: GoalCredit[];
  resolved?: boolean;
  /** Character id, sealed on first issue. Absent on weeks predating this. */
  character?: string;
}
```

- Sealed alongside `issueRecurringGoals` in the existing lazy week rollover.
- `reckonDay` reads the **sealed** id, never re-derives it.
- A week with no sealed id (every week before this ships) scores with
  `character: null`. Do not backfill — retroactively re-scoring history is the
  exact failure this seal prevents.
- Normalise on read: unknown id resolves to `null`, not to a default character.

### 1b. `src/characters.ts`

```ts
export interface WeekCharacter {
  id: string;
  name: string;
  blurb: string;
  /** Per-block multiplier, applied inside xpForBlock after the combo term. */
  weigh?: (b: Block, kind: CategoryKind, minutes: number) => number;
  /** Flat XP added once per day, after the cleared bonus, before the boost. */
  dayBonus?: (r: { byCategory: Record<string, number>; completedCount: number }) => number;
  /** Overrides BRASS_PER_XP for days in this week. */
  brassRate?: number;
  /** Overrides COMBO_MAX_RUN for days in this week. */
  comboMax?: number;
}
```

**Composition order inside `reckonDay`** — insert into the existing pipeline, do
not restructure it:

1. Per block: `minutes × XP_PER_MINUTE × kindWeight × priority × onTime × combo × character.weigh`
2. Day-cleared bonus (unchanged)
3. `character.dayBonus` — as its own `XpLine`, label `The week's character`
4. Boost — as its own `XpLine`, scaling `byCategory` and `byDiscipline` (unchanged)
5. `brass = xpEarned × (character.brassRate ?? BRASS_PER_XP)`

A character must never reduce a figure. Every `weigh` returns `>= 1`. This is the
"misses are silent, no penalties" rule applied to modifiers — a week that
*lowered* your rate would be a punishment for a draw the user did not make.

### 1c. The eight characters — copy is final

```ts
export const CHARACTERS: WeekCharacter[] = [
  {
    id: 'long-nights',
    name: 'Long nights',
    blurb: 'Anything worked after eight pays a quarter more.',
    weigh: (b) => (b.start >= 20 * 60 ? 1.25 : 1),
  },
  {
    id: 'early-frost',
    name: 'Early frost',
    blurb: 'Anything finished before nine pays a third more.',
    weigh: (b) => (b.completedAt != null && b.completedAt < 9 * 60 ? 1.3 : 1),
  },
  {
    id: 'fair-weather',
    name: 'Fair weather',
    blurb: 'Rest counts half again. Take the recovery.',
    weigh: (_b, kind) => (kind === 'rest' ? 1.5 : 1),
  },
  {
    id: 'high-seas',
    name: 'High seas',
    blurb: 'Runs carry to eight instead of five.',
    comboMax: 8,
  },
  {
    id: 'dry-spell',
    name: 'Dry spell',
    blurb: 'Brass mints at double. Experience is unchanged.',
    brassRate: 0.2,
  },
  {
    id: 'steady-hand',
    name: 'Steady hand',
    blurb: 'Finishing on time is worth more than usual.',
    weigh: (b) => (wasOnTime(b) ? 1.22 : 1),
  },
  {
    id: 'broad-acres',
    name: 'Broad acres',
    blurb: 'Every distinct category you touch adds thirty.',
    dayBonus: (r) => Object.keys(r.byCategory).length * 30,
  },
  {
    id: 'the-long-haul',
    name: 'The long haul',
    blurb: 'Ninety minutes or more pays a third more.',
    weigh: (_b, _k, minutes) => (minutes >= 90 ? 1.35 : 1),
  },
];
```

### 1d. Presentation

One line in the rail, beside the run: **`This week — Long nights`** with the blurb
as the title attribute or a fold. On the Standing view, show the current character
as a small card. No animation beyond the existing panel entrance.

The Monday transition should not be a takeover. It is weather, not an achievement.

### 1e. Tests — `src/characters.test.ts`

- Every character's `weigh` returns `>= 1` for every combination of kind,
  priority, on-time and duration. Table-driven.
- `pick` over `CHARACTERS` is stable for a fixed week key.
- Declaration-order test guarding 0.4.
- A sealed unknown id scores as `null`, not as `CHARACTERS[0]`.
- `reckonDay` with a character is idempotent: same inputs, same stat, twice.
- Add a `perf.test.ts` case: 60 days × 480 blocks with a character applied stays
  under 16ms.

---

## Phase 2 — Quest and challenge content

Pure content against existing interfaces. No scoring changes. The lowest-risk
phase and the one with the most immediate felt effect, because weekly challenges
currently cycle every four weeks — the shortest repeat loop in the game.

Four new axes. Everything shipped today is "do N of X"; none of the below is.

- **Constraint** — do it a particular way. The only axis that can make an easy
  week interesting.
- **Prediction** — commit, then verify. Rewards estimation, which is the skill a
  planner actually teaches and which nothing currently pays for.
- **Recovery** — pays the return, not only the run. The streak already frames a
  reset as a fresh start; nothing yet rewards taking it.
- **Discovery** — tells the user something about themselves. Gets more
  interesting the longer the app is used. Pairs with `insights.ts`.

### 2a. Weekly challenges — 4 → 12

Append these eight to `WEEKLY_CHALLENGES`.

| id | name | blurb | axis |
|---|---|---|---|
| `nothing-moved` | Nothing moved | Complete twenty blocks without moving any of them | constraint |
| `even-hand` | Even hand | Let no category take more than half your completed minutes | constraint |
| `good-eye` | Good eye | Finish five blocks within ten minutes of when you planned to | prediction |
| `honest-hours` | Honest hours | Land planned and completed minutes within a twentieth of each other | prediction |
| `second-wind` | Second wind | Clear a day straight after one that fell short | recovery |
| `salvage` | Salvage | Complete three blocks that had been moved more than once | recovery |
| `best-hour` | Your best hour | Complete four blocks in the hour you most often finish work | discovery |
| `quiet-corner` | The quiet corner | Put an hour into the category you have touched least this month | discovery |

### 2b. Daily challenges — 6 → 12

Append these six to `DAILY_CHALLENGES`.

| id | name | blurb | axis |
|---|---|---|---|
| `down-tools` | Down tools | Clear the day with nothing finished after seven | constraint |
| `one-sitting` | One sitting | Finish two hours or more with nothing scheduled inside it | constraint |
| `as-planned` | As planned | Complete every block without moving any of them | constraint |
| `to-the-minute` | To the minute | Finish two blocks within five minutes of when you planned to | prediction |
| `back-to-the-bench` | Back to the bench | Clear a day within two days of a fresh start | recovery |
| `dawn-watch` | Dawn watch | Finish something before seven | constraint |

### 2c. Wildcards — 8 → 16

Append these eight to `WILDCARDS`. `total` in brackets.

| id | name | blurb | total | axis |
|---|---|---|---|---|
| `nothing-after-dark` | Nothing after dark | Clear two days with nothing finished after seven | 2 | constraint |
| `three-sittings` | Three sittings | Complete three blocks of two hours or more, uninterrupted | 3 | constraint |
| `good-eye-six` | A good eye | Finish six blocks within ten minutes of when you planned to | 6 | prediction |
| `honest-four` | Honest week | Land within a twentieth of your planned minutes on four days | 4 | prediction |
| `twice-returned` | Twice returned | Twice, clear a day straight after one that fell short | 2 | recovery |
| `salvaged` | Salvaged | Complete four blocks that had been moved more than once | 4 | recovery |
| `know-the-hour` | Know the hour | Complete six blocks in your strongest hour | 6 | discovery |
| `far-field` | Far field | Put two hours into the category you have touched least | 2 | discovery |

### 2d. Predicates the new content needs

Most exist. Three are new — put them in `quests.ts` beside the existing helpers,
**not** duplicated per spec. A second copy of a threshold has already caused one
bug here.

```ts
/** Ticked within `tolerance` minutes either side of its scheduled end. */
export function finishedWhenPlanned(b: Block, tolerance = 10): boolean {
  return b.completed && b.completedAt != null &&
         Math.abs(b.completedAt - b.end) <= tolerance;
}

/** Blocks that were rescheduled at least `n` times before being completed. */
export function salvaged(blocks: Block[], n = 2): Block[] {
  return blocks.filter((b) => b.completed && (b.moves ?? 0) >= n);
}

/** The hour of day this profile most often completes work in. */
export function strongestHour(ctx: WeekContext): number | null;
```

`strongestHour` must return `null` on thin history and every dependent quest must
degrade to unavailable rather than to hour zero. A discovery quest that fires on
no data is worse than no discovery quest.

### 2e. Tests — extend `quests.test.ts`

Every new spec gets: a case that satisfies it, a case one short, and an
empty-week case. Plus the declaration-order guard from 0.4 for all three arrays.

---

## Phase 3 — Goal types

Two new types. Both are small changes to `WeeklyGoal` plus normalisers plus the
editor UI. A third (paired ratio goals) is deliberately deferred.

### 3a. Ceiling goals — "no more than"

Every goal today is a floor. A ceiling is the only way to express *protect my
focus time*, and it is something a calendar can verify that a to-do list cannot.

```ts
export interface WeeklyGoal {
  // ...existing
  /** 'atLeast' is the historical behaviour and the default. */
  direction?: 'atLeast' | 'atMost';
}
```

- A ceiling goal is **met by default** and lost by exceeding. It is the one place
  in the app where a bar starts full.
- It never deducts anything. Exceeding it simply pays nothing.
- Progress reads as *"180 of 300 minutes used"*, and the ring fills toward the
  limit rather than toward completion. Recolour to `--signal` past four fifths.
- Copy for the review when exceeded: **"Over by 40 minutes."** Not "failed".
- Carryover does not apply. A ceiling cannot be deferred; normaliser must force
  `cadence: 'weekly'` and ignore `deferrals`.

### 3b. Run goals — "four weeks running"

Quests are weekly. Day-streaks are a hundred days. Nothing occupies the two-to-six
week middle, which is where most real habits are won.

```ts
export interface WeeklyGoal {
  // ...existing
  /** Present on a goal that wants consecutive weeks. */
  run?: { target: number; current: number; best: number };
}
```

- Advances at week rollover, in the existing `resolveElapsedWeeks` pass, only for
  a week where the goal was met. Idempotent via the existing `resolved` flag.
- A missed week resets `current` to zero, keeps `best`, and reissues. Same
  vocabulary as the day-streak: **"Fresh start on this one."**
- A `voided` week neither advances nor resets — standing down deliberately is not
  a lapse. This mirrors the existing `voided` semantics exactly.
- Pays a one-off `AwardPayout` on reaching target: key `goalrun:<goalId>:<target>`,
  XP `40 × target`. Keyed on target so a longer run later still pays.

### 3c. Storage

Both fields need normalisers in `storage.ts` → `normalizeGoal`:

- `direction`: `'atMost'` only when exactly that string, else `'atLeast'`.
- `run`: dropped entirely unless `target` is a finite integer `>= 2`; `current`
  clamped to `[0, target]`; `best` clamped to `>= current`.

Round-trip tests in `storage.progress.test.ts` including a corrupt `run` object.

### 3d. Deferred — do not build

**Paired ratio goals** ("for every 3 hours of focus, 1 hour of rest"). Genuinely
novel and on-theme, but it needs a second category on the goal, a different
progress shape, and a review presentation none of the existing components fit.
Revisit once 3a and 3b are in use.

---

## Phase 4 — Shop and brass

The catalogue is 15 cosmetics and 5 functional items, and the five functional ones
are all defensive. Brass is `XP × 0.1` plus 5 per kept day — strictly proportional
to XP, which means **there is no skill in earning it**. Both halves get addressed.

### 4a. New `ShopItem` field

```ts
export interface ShopItem {
  // ...existing
  /** Completed cycles required before this is offered at all. */
  minPrestige?: number;
}
```

Filter in the existing offer builder beside `minLevel`. Locked prestige stock
should be **visible and marked**, not hidden — the point is that it gives the
sigil weight.

### 4b. Eleven items — copy is final

**Instruments.** Permanent, small, compounding. These are what give a long-running
profile texture.

| id | name | kind | price | blurb |
|---|---|---|---|---|
| `inst-loupe` | Loupe | utility | 600 | One more codex card in view at a time |
| `inst-second-hand` | Second hand | utility | 700 | The week strip shows your trailing four-week shadow |
| `inst-sandglass` | Sandglass | utility | 900 | The punctuality window widens to ten minutes |
| `inst-ledger-rule` | Ledger rule | utility | 1200 | Day records keep for eight hundred days instead of four hundred |
| `inst-brass-scales` | Brass scales | utility | 1600 | Brass mints five percent faster, for good |

**Consumables that create a decision.** Not top-ups.

| id | name | kind | price | stack | blurb |
|---|---|---|---|---|---|
| `use-assay` | Assay | utility | 150 | 5 | Name the next badge you have not earned |
| `use-bench-day` | Bench day | utility | 250 | 3 | Name a day ahead. It cannot break a run. |
| `use-reprieve` | Reprieve | utility | 300 | 2 | Hold yesterday's run without spending a freeze |
| `use-double-bill` | Double bill | quest | 400 | 2 | Two wildcards this week instead of one |

**Prestige stock.** `minPrestige: 1`.

| id | name | kind | price | slot | blurb |
|---|---|---|---|---|---|
| `title-almanacker` | Title: Almanacker | cosmetic | 1800 | title | For a second pass through the ranks |
| `finish-meridian` | Meridian finish | cosmetic | 2200 | finish | Only for a cycle completed |

Notes: `inst-sandglass` changes `ON_TIME_WEIGHT`'s eligibility window, which is a
**scoring input** — it must go through `DayModifiers` and be sealed per week the
same way a character is, or it retroactively re-scores history when bought.
`inst-ledger-rule` changes `STAT_RETENTION_DAYS`, which interacts with
`withinRetention`; read the comment there before touching it.

### 4c. Two new brass sources

**Piecework — brass for precision.** The best single addition here: it rewards
*estimation*, which is a genuinely different skill from volume, and it quietly
teaches the thing a planner is for.

- 8 brass per block ticked within **±5 minutes of its scheduled end**.
- Derivable from `completedAt` and `end`, both already stored.
- Distinct from and complementary to `wasOnTime` (which is `completedAt <= end`).
- Computed inside `reckonDay` so it reconciles like everything else. It is brass
  only — no XP — so it cannot disturb levels.
- Surface it as its own line: **"Piecework — 3 blocks to the minute"**.

**The assay — a weekly appraisal.** Makes brass a reward for variety of behaviour
rather than raw volume, and gives `insights.ts` somewhere to pay out.

- Paid once per week on opening the review. Key `assay:<weekKey>`.
- 20–120 brass, scaled by how the week compared against the profile's own trailing
  four-week median — not against an absolute bar.
- Presents as a discovered fact, one sentence, e.g. **"Your strongest hour was
  ten in the morning — four blocks finished there."**
- Thin history pays the floor of 20 and says so plainly rather than inventing a
  comparison.

### 4d. Deferred — do not build

**Commissions** (stake brass on a named block next week, double back on
completion, forfeit on miss). The most interesting mechanic on the list and the
heaviest: it needs nomination UI, a forfeiture path, and careful interaction with
the negative-balance floor. Build after 4a–4c are in use.

**Daily login brass.** Explicitly rejected. It pays for opening the app rather
than for work the record can verify, which contradicts §0.6.

### 4e. Tests

- `shop.test.ts`: `minPrestige` gating; every new consumable respects its stack
  limit; every permanent respects `maxOwned`.
- `progress.test.ts`: piecework pays at exactly ±5 and not at ±6; piecework is
  idempotent across repeated reconciles; piecework adds no XP.
- New `assay.test.ts`: scaling against a synthetic trailing median; floor on thin
  history; the key pays exactly once.

---

## Build order and flags

| Phase | Ships behind | Depends on |
|---|---|---|
| 0 — reducer + reward queue | — (refactor, no flag) | — |
| 1 — weekly characters | `characters` | 0, and §0.2 modifiers object |
| 2 — quest content | `questsV2` | — (independent) |
| 3 — goal types | `goalsV2` | — (independent) |
| 4 — shop + brass | `shopV2` | 0.2 for sandglass; 1 for sealing pattern |

Phases 2 and 3 are independent of everything and can be done in parallel with 1.
Phase 4's `inst-sandglass` is the only item that depends on Phase 1's sealing
work — if Phase 1 slips, ship Phase 4 without that one item.

## Definition of done, every phase

- `npm test` green; `npx tsc -b` exits 0; `npx eslint .` exits 0.
- New pure logic has unit tests including boundaries and empty input.
- New persisted fields have normalisers and a corrupt-record round-trip test.
- Anything touching `reckonDay` has an idempotency test — same inputs twice, same
  stat — and a `perf.test.ts` case under 16ms.
- Content arrays have a declaration-order guard test.
- No new `eslint-disable` without a comment giving the reason.
- Every user-facing string taken verbatim from this document.

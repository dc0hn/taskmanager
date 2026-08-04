# Almanac

A local-first calendar and task scheduler for people who set their own hours.

Dump what you want to get done into the morning intake, press **Build my day**, and
an opinionated scheduler lays it onto the timeline — frontloading focused work,
splitting long sessions at the 90-minute mark, batching similar work together,
inserting recovery breaks, and reserving the end of the day so work doesn't bleed
into the evening. Then drag it around until it looks right.

Above the daily plan sit two layers that stop intent from evaporating:

- **Weekly goals** — "practise guitar three times this week". Progress is credited
  automatically when the work gets ticked off, and anything that slips lands in a
  carryover pile that counts how many weeks it has been deferred.
- **Routines** — the things that come back. Daily, weekdays, or specific days, each
  with a streak derived from what actually happened.

Everything runs on your machine. No accounts, no backend, no network calls of any
kind — not even a webfont.

## Running it

```bash
npm install
npm run tauri:dev     # the real desktop app
npm run tauri:build   # produce Almanac.app
npm test              # 177 tests
```

> **Use `tauri:dev`, not `npm run dev`.** The packaged app and the browser dev
> server have completely separate `localStorage`, so plans made at
> `localhost:5173` will not appear in the app. `npm run dev` is only useful for
> quick visual work.

If port 5173 is busy, run on another one — both halves have to agree:

```bash
npx tauri dev --config '{"build":{"devUrl":"http://localhost:5199","beforeDevCommand":"npm run dev -- --port 5199 --strictPort"}}'
```

## The daily ritual

1. Type tasks into **Intake**, one per line. `Enter` adds, `⌘Enter` adds and builds.
2. Tap a chip under **Draw from** to pull in a weekly goal or a routine that's due —
   it drops a pre-tagged task into the queue and nothing more, so the ordinary
   parser and scheduler handle it from there.
3. Press **Build my day**.
4. Tick things off as you go. The dial fills by *time*, not by number of entries.
5. When the day derails, **Rebuild from now** freezes what you've finished and
   reflows the rest from this minute forward.

### Inline shorthand

Tokens are stripped from the line; whatever is left becomes the title.

| Token | Examples |
| --- | --- |
| Fixed time | `@2pm` `@2:30pm` `@14:00` `@1430` `2pm` `14:00` |
| Time range (sets time *and* duration) | `2pm-4pm` `2-4pm` `14:00-16:00` `2pm to 4pm` |
| Duration | `30m` `90min` `1h` `1hr` `1h30m` `2h15m` |
| Priority | `!high` `high` `p1` · `!normal` `normal` `p2` |
| Category | `#deep` `#admin` `#break` `#other`, plus `#focus` `#email` `#lunch` `#personal` |
| Custom category | any category by id, short label, or name — `#music-practice`, `#music` |

Defaults when a token is absent: 60 minutes, normal priority, and whichever
category chip is selected. An inline `#token` always wins.

```
Edit the Nashville gallery 2h !high #deep
Client call @2pm 30m #admin
Lunch @12:30pm 45m #lunch
Gym 4-5pm
```

## Views

- **Day** — one column, plus intake, the progress dial, and the time breakdown.
- **Week** — seven columns. Drag a block sideways to move it to another day.
- **Month** — pills per day, with `+N more` when a day overflows.

Drag to move, drag an edge to resize (5-minute snapping), double-click to edit,
click empty space to add. If something is refused — an occupied slot, a full day —
it says so and names what got in the way.

## Categories

Categories are yours to define. What the scheduler acts on is not a category's name
but its **kind**:

| Kind | Behaviour |
| --- | --- |
| **Focus** | Frontloaded into the morning. Sessions over 2h split into ≤90m chunks. |
| **Shallow** | Batched after focus work, to limit context switching. |
| **Rest** | Counts as recovery, so it suppresses the automatic break after it. |
| **Neutral** | No special treatment. |

So a new "Music practice" category set to Focus inherits morning priority and
chunking without the scheduler knowing it exists. Only the accent colour is stored —
the block fill, hairline and text shades are derived from it, so no colour you can
pick produces an unreadable block. Built-in categories can be renamed and
recoloured but not deleted, and deleting a custom one never deletes work: affected
entries show as *Uncategorised* and stay editable.

## Weekly goals and carryover

A goal has a label, a category, a target (a number of sessions, or total minutes),
an estimated session length so the scheduler has something to place, and a
**cadence** deciding what happens to it at the week boundary:

| Cadence | At the end of the week |
| --- | --- |
| **Start again** (`weekly`) | A standing intention. Reappears every Monday at its **full** target — a habit's weekly target is the point, so it never shrinks — and counts a deferral when it slips. Never enters the carryover pile, because it's already in the new week. |
| **Carry what is left** (`oneOff`) | A finite job. The **residual** — what's actually still owed — moves to the carryover pile and waits until you pull it in. |

- **Crediting** is a ledger keyed by block, so un-ticking something reverses cleanly
  rather than leaving a counter inflated.
- **A session is one goal on one day.** The scheduler splits long focus work into
  chunks that share a goal; counting distinct days means one two-hour sitting counts
  once. Minutes always sum in full.
- **Rollover is lazy.** Elapsed weeks resolve on read, in order, the next time you
  open the app — nothing depends on it having been running at midnight on Sunday,
  and resolving three times changes nothing after the first.
- **Repeat slips consolidate with `max()`, never a sum.** A 3-session goal missed
  three times stays at 3, not 9. Summation is the debt spiral in arithmetic form,
  and an unhittable target gets the app closed rather than the work done. The
  escalating pressure comes from the deferral count, which does keep climbing.
- **Standing something down is not failing.** A goal you consciously drop for the
  week is recorded as *stood down* — no carryover, no deferral penalty, and reported
  in its own column in the review. Collapsing "I decided not to" into "I failed to"
  corrupts the only signal the review exists to produce.
- **Sealed weeks stay sealed.** Once rollover has closed a week its goal totals are
  settled history. Ticking a block in a closed week still changes the block, but it
  says plainly that the week's totals won't move and offers to pull the goal into the
  current week instead.
- **Anything deferred six times** raises a triage prompt: pull it in, halve what's
  owed, or let it go. An unmanaged pile becomes a graveyard, and a graveyard carries
  no signal.

Raw credits are kept for the trailing 12 weeks; beyond that a week's sealed outcome
is the durable record.

Weeks are keyed by the date of their Monday rather than an ISO week number — see the
comment at the top of `src/week.ts` for why that removes a class of bug instead of
requiring careful handling of it.

## Routines and streaks

A routine is a template, not a stored instance: nothing is written to a day until
you put it there. That means no background job has to generate tomorrow, and
deleting one from a day doesn't need a tombstone to stop it reappearing.

Streaks are derived from the completion log rather than stored, and only days
matching the rule participate — a weekdays routine is not broken by the weekend, and
an unfinished *today* doesn't zero yesterday's run.

## Where the data lives

| Key | Contents |
| --- | --- |
| `dp:plan:YYYY-MM-DD` | one record per day (tasks + blocks) |
| `dp:week:YYYY-MM-DD` | weekly goals and their credit ledger, keyed by Monday |
| `dp:carryover:v1` | the deferred pile |
| `dp:habits:v1` | routine templates and completion log |
| `dp:categories:v1` | category definitions |
| `dp:settings:v2` | working hours |

Inside the app that's a SQLite file under `~/Library/WebKit/com.dc0hn.almanac/`.
Every read is validated and every write is guarded: corrupt records are repaired or
dropped rather than allowed to blank the window, and a failed write logs instead of
throwing into a render. A day that has never been saved is treated as *no
information* rather than as proof that nothing happened, so browsing back through
old months never erases a streak.

**Backup & restore** lives at the bottom of the nav rail. It produces one
self-contained JSON document of every `dp:` record and takes one back, merging by
default or replacing on request. Imports go through the same validators as a normal
read, so a truncated or hand-edited file restores whatever was salvageable instead of
breaking the app.

It's a textarea and a copy button rather than a file dialog on purpose: downloads in
Tauri's WKWebView are unreliable, and a native picker would mean a new plugin, a
capability entry and a permission prompt. Copy-and-paste needs none of that and can't
fail silently — which matters most for the feature whose whole job is to work on the
worst day you have.

## Stack and layout

Tauri 2 (Rust shell, macOS WKWebView) + React 19 + TypeScript + Vite + Tailwind +
Framer Motion. The Rust side is deliberately almost empty — all logic is in the web
layer. All times are integer minutes since midnight; no `Date` objects are stored.

```
src/
  types.ts          domain types, category kinds, defaults
  parser.ts         inline shorthand
  scheduler.ts      buildSchedule — the algorithm
  week.ts           week-key and month-grid maths
  goals.ts          goal progress, crediting, rollover, review
  recurrence.ts     recurrence rules and streaks
  storage.ts        localStorage with validation on read
  utils/color.ts    derives every category shade from one accent
  utils/time.ts     date keys and formatting
  utils/planning.ts effectiveStart — "build from now"
  components/
    shell           SideNav · Toolbar · MiniMonth
    calendar        TimeGrid (day + week) · WeekStrip · MonthView
    day             IntakePanel · SuggestionChips · ProgressWheel · SummaryCard
    management      GoalsView · RoutinesView · CategoriesView
    shared          EditBlockModal · Toast · ErrorBoundary
```

`TimeGrid` renders both the day and the week view — one column or seven — so the
time-axis geometry, drag maths, conflict rules and now-line exist exactly once.

## Tests

```bash
npm test
```

177 tests, covering the shorthand parser, the scheduler, week-key maths (including
year boundaries, 53-week years, leap days and DST transitions), goal crediting and
rollover idempotency and consolidation, weekly reissue, void handling, and recurrence
and streak logic.

## Distribution

Builds are **ad-hoc signed** (`Signature=adhoc`, no Team ID) and not notarized. That is
fine for a build you install on your own machine, which is what this is for.

Gatekeeper will refuse it on any other Mac. Sharing the app would need, in order:

1. An Apple Developer Program membership, for a Developer ID Application certificate.
2. `bundle.macOS.signingIdentity` and `hardenedRuntime: true` in `src-tauri/tauri.conf.json`.
3. Notarization via `APPLE_ID`, `APPLE_TEAM_ID` and an app-specific `APPLE_PASSWORD`.

There is also **no update channel** — no `updater` config, no endpoint, no signing key.
Updates happen by rebuilding and copying to `/Applications`. An updater without a signed
public key would be worse than none, so it is deliberately absent rather than half-built.

## Data and storage

Everything lives in `localStorage` (a WebKit SQLite file under
`~/Library/WebKit/com.dc0hn.almanac/`), plus a daily JSON snapshot in the app data
directory written fsync-then-rename with one generation kept.

Day plans and week records are **never pruned** — they are the primary record of what
you did. Sealed month and season summaries are dropped after five years. The backup
panel shows the store's size against the ~5 MB quota so the ceiling is visible before
it is reached; export a backup if it starts to fill.

Storage is plaintext by design: it is a local single-user app and there are no
credentials to protect. Editing your own data files is possible and is a consciously
accepted trade, not a vulnerability.

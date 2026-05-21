# Day Planner

A local-first web app for self-employed people who set their own hours. Dump in
the tasks you want to get done in the morning, hit **Build my day**, and the
app lays them out into an elegant, time-blocked schedule that you can refine by
hand.

Everything runs on your machine. No accounts, no backend, no telemetry.
Each day's plan is saved in your browser's `localStorage` under its own date
key so plans persist across restarts.

## Start it

```bash
npm install
npm run dev
```

Then open the URL the dev server prints (default: **http://localhost:5173/**).

To make a production build:

```bash
npm run build
npm run preview
```

## How it works

### Morning intake → schedule

1. Type tasks in the right-hand panel, one per line. Press **Enter** to add.
2. Each task has a duration (default 60 min), a category, an optional
   fixed time, and an optional priority. Click a task to refine those.
3. Hit **Build my day**. The scheduler:
   - respects fixed-time tasks as anchors,
   - front-loads high-priority and deep-work tasks,
   - inserts a lunch block at noon and short breaks after ~90 min of work,
   - flags anything that didn't fit ("Didn't fit" card at the bottom).

### Inline shorthand

You can put options inline when typing a task:

| Token        | Meaning                                |
| ------------ | -------------------------------------- |
| `@2pm`       | Fixed time. Also `@2:30pm`, `@14:00`.  |
| `30m` / `1h` | Duration. Also `90m`, `1h30m`.         |
| `!high`      | High priority.                         |
| `#deep`      | Category. Also `#admin`, `#break`, `#other`. |

Example:

```
Client call @2pm 30m #admin
Deep work on proposal 90m !high #deep
Email triage 20m #admin
Lunch with Sam @12:30pm 60m #break
```

### Refine by hand

- **Drag** a block to move it (snaps to 5-minute increments).
- **Drag the top or bottom edge** to resize.
- **Click "Edit"** on a hovered block (or double-click) to open the modal
  and change title, time, category, or delete it.
- **Click empty space** on the timeline to create a new 30-minute block.

Every change auto-saves.

### Days

- Use the **arrows / Today / date picker** in the header to switch days.
- A new day starts empty.
- **Copy yesterday** pulls in yesterday's tasks *and* blocks as a starting
  point.

### Settings

- The **working hours** chip in the top right lets you change your default
  schedule window (e.g. 9–5, 10–7).
- Categories live in `src/types.ts` (`CATEGORIES` array). Adjust labels,
  colors, or add new ones there — the change flows through the intake
  pickers, the timeline, and the summary card automatically.

## Where data is stored

All data is in your browser's `localStorage` under these keys:

- `dp:plan:YYYY-MM-DD` — one entry per planned day (tasks + blocks).
- `dp:settings` — working hours.

To wipe everything: open DevTools → Application → Local Storage → clear the
`dp:` keys (or all of `http://localhost:5173`).

## Stack

- **Vite + React + TypeScript** — fast local dev, clean components.
- **Tailwind CSS** — styling.
- **Framer Motion** — subtle block transitions and the modal fade.
- **lucide-react** — icons.

No backend, no database, no network calls.

## File map

```
src/
  App.tsx              — top-level layout & state
  main.tsx             — root render
  index.css            — Tailwind imports + base styles
  types.ts             — Task, Block, Category, DayPlan, Settings
  storage.ts           — localStorage helpers (per-date plans)
  parser.ts            — inline shorthand parser (@2pm, 30m, !high, #deep)
  scheduler.ts         — Build-my-day algorithm
  utils/time.ts        — date keys, 12/24h formatting, duration formatting
  components/
    Header.tsx         — title, date nav, working-hours menu, Copy yesterday
    IntakePanel.tsx    — morning intake input + unscheduled list
    Timeline.tsx       — vertical hour grid with drag/resize blocks
    EditBlockModal.tsx — edit/delete a single block
    SummaryCard.tsx    — per-category hours + grand total
```

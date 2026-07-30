import { describe, it, expect } from 'vitest';
import type { DayPlan } from './types';

// ============================================================================
// The undo transaction model.
//
// The stack itself lives in App.tsx, where it needs `plansRef` and React state. What is
// testable — and what the correctness actually rests on — is the two rules that decide
// what a transaction CONTAINS. Both are reimplemented here against the same shapes, so a
// change to either rule has to be a deliberate one.
//
//   ONE GESTURE, ONE ENTRY. Moving a block between days writes to two days. Two entries
//   would mean pressing undo twice to reverse one drag.
//
//   THE FIRST SNAPSHOT OF A DAY WINS. A gesture that touches the same day twice must keep
//   the earliest capture; a later one already contains half the change being undone.
// ============================================================================

type Tx = { label: string; days: Record<string, DayPlan | null> };

const plan = (date: string, ids: string[]): DayPlan => ({
  date,
  tasks: [],
  blocks: ids.map((id, i) => ({
    id,
    title: id,
    start: 540 + i * 60,
    end: 600 + i * 60,
    category: 'deep',
  })),
});

/** The accumulator from App.tsx, isolated. */
function makeTx() {
  let pending: Tx | null = null;
  const banked: Tx[] = [];
  return {
    record(day: string, label: string, before: DayPlan | null) {
      if (pending == null) pending = { label, days: {} };
      if (!(day in pending.days)) pending.days[day] = before;
    },
    /** Stands in for the end of the microtask. */
    flush() {
      if (pending && Object.keys(pending.days).length > 0) banked.push(pending);
      pending = null;
    },
    banked,
  };
}

/** Applying a transaction, as `undo` does. */
function applyTx(
  plans: Record<string, DayPlan>,
  tx: Tx
): Record<string, DayPlan> {
  const next = { ...plans };
  for (const [day, before] of Object.entries(tx.days)) {
    next[day] = before ?? { date: day, tasks: [], blocks: [] };
  }
  return next;
}

describe('an undo transaction is a gesture', () => {
  it('collects both days of a cross-day move into one entry', () => {
    const t = makeTx();
    t.record('2026-07-30', 'moving that to another day', plan('2026-07-30', ['a', 'b']));
    t.record('2026-07-31', 'moving that to another day', plan('2026-07-31', []));
    t.flush();

    expect(t.banked).toHaveLength(1);
    expect(Object.keys(t.banked[0].days).sort()).toEqual(['2026-07-30', '2026-07-31']);
  });

  it('keeps the first snapshot when a gesture touches a day twice', () => {
    const t = makeTx();
    const original = plan('2026-07-30', ['a']);
    const halfway = plan('2026-07-30', ['a', 'b']);
    t.record('2026-07-30', 'that change', original);
    t.record('2026-07-30', 'that change', halfway);
    t.flush();

    // The later capture already held the block being added.
    expect(t.banked[0].days['2026-07-30']).toBe(original);
  });

  it('banks separate gestures separately', () => {
    const t = makeTx();
    t.record('2026-07-30', 'first', plan('2026-07-30', ['a']));
    t.flush();
    t.record('2026-07-30', 'second', plan('2026-07-30', ['a', 'b']));
    t.flush();
    expect(t.banked.map((x) => x.label)).toEqual(['first', 'second']);
  });

  it('banks nothing for a gesture that wrote nothing', () => {
    const t = makeTx();
    t.flush();
    expect(t.banked).toEqual([]);
  });
});

describe('applying a transaction', () => {
  it('restores every day it covers', () => {
    const before = { '2026-07-30': plan('2026-07-30', ['a', 'b']) };
    const after = {
      '2026-07-30': plan('2026-07-30', ['a']),
      '2026-07-31': plan('2026-07-31', ['b']),
    };
    const tx: Tx = {
      label: 'moving that to another day',
      days: { '2026-07-30': before['2026-07-30'], '2026-07-31': null },
    };
    const restored = applyTx(after, tx);
    expect(restored['2026-07-30'].blocks.map((x) => x.id)).toEqual(['a', 'b']);
    // The destination day did not exist before the move, so it goes back to empty rather
    // than keeping the block that was moved into it.
    expect(restored['2026-07-31'].blocks).toEqual([]);
  });

  it('leaves days the gesture never touched alone', () => {
    const plans = {
      '2026-07-30': plan('2026-07-30', ['a']),
      '2026-08-01': plan('2026-08-01', ['z']),
    };
    const tx: Tx = { label: 'x', days: { '2026-07-30': null } };
    const restored = applyTx(plans, tx);
    expect(restored['2026-08-01']).toBe(plans['2026-08-01']);
  });

  it('round-trips a reflow cascade', () => {
    // The case that motivated undo: one drag moves several blocks, and the whole day has
    // to come back as it was rather than block by block.
    const original = plan('2026-07-30', ['a', 'b', 'c', 'd']);
    const cascaded = plan('2026-07-30', ['a', 'b', 'c', 'd']);
    cascaded.blocks = cascaded.blocks.map((x) => ({ ...x, start: x.start + 60, end: x.end + 60 }));

    const tx: Tx = { label: 'that change', days: { '2026-07-30': original } };
    const restored = applyTx({ '2026-07-30': cascaded }, tx);
    expect(restored['2026-07-30'].blocks.map((x) => x.start)).toEqual(
      original.blocks.map((x) => x.start)
    );
  });
});

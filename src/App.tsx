import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import Header from './components/Header';
import IntakePanel from './components/IntakePanel';
import Timeline from './components/Timeline';
import EditBlockModal from './components/EditBlockModal';
import SummaryCard from './components/SummaryCard';
import ProgressWheel from './components/ProgressWheel';
import type { Block, DayPlan, Settings, Task } from './types';
import { loadPlan, loadSettings, savePlan, saveSettings } from './storage';
import { buildSchedule } from './scheduler';
import { addDays, toDateKey } from './utils/time';

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

export default function App() {
  const [date, setDate] = useState<string>(() => toDateKey(new Date()));
  const [plan, setPlan] = useState<DayPlan>(() => loadPlan(toDateKey(new Date())));
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [overflow, setOverflow] = useState<Task[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [buildPulse, setBuildPulse] = useState(0);

  useEffect(() => {
    setPlan(loadPlan(date));
    setOverflow([]);
  }, [date]);

  useEffect(() => {
    savePlan(plan);
  }, [plan]);

  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  function setTasks(updater: (tasks: Task[]) => Task[]) {
    setPlan((p) => ({ ...p, tasks: updater(p.tasks) }));
  }
  function setBlocks(updater: (blocks: Block[]) => Block[]) {
    setPlan((p) => ({ ...p, blocks: updater(p.blocks) }));
  }

  function handleAddTasks(newTasks: Task[]) {
    setTasks((tasks) => [...tasks, ...newTasks]);
  }
  function handleRemoveTask(id: string) {
    setTasks((tasks) => tasks.filter((t) => t.id !== id));
  }
  function handleUpdateTask(id: string, patch: Partial<Task>) {
    setTasks((tasks) => tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  function handleBuildDay() {
    if (plan.tasks.length === 0) return;

    const intakeFixed = plan.tasks.filter((t) => t.fixedTime != null);
    const intakeFlex = plan.tasks.filter((t) => t.fixedTime == null);

    // Fixed-time intake tasks always win their slot. Existing blocks overlapping
    // those slots get rescheduled as flexible instead of being lost.
    const conflictsWithIntake = (start: number, end: number) =>
      intakeFixed.some((t) => {
        const fs = t.fixedTime!;
        const fe = fs + t.duration;
        return !(fe <= start || fs >= end);
      });

    // Auto-breaks/shutdown are scheduler-owned; drop them and let the new
    // build recompute. Non-auto blocks that don't conflict with new intake
    // fixed-time tasks stay put as-is (no transition buffer is carved around
    // them — they were already placed cleanly).
    const existing = plan.blocks.filter((b) => !b.auto);
    const preserved: Block[] = existing.filter(
      (b) => !conflictsWithIntake(b.start, b.end)
    );
    const displacedAsFlex: Task[] = existing
      .filter((b) => conflictsWithIntake(b.start, b.end))
      .map((b) => ({
        id: b.id,
        title: b.title,
        duration: b.end - b.start,
        category: b.category,
        priority: 'normal',
      }));

    const result = buildSchedule(
      [...intakeFixed, ...displacedAsFlex, ...intakeFlex],
      settings.workingStart,
      settings.workingEnd,
      preserved
    );

    // Preserve completion state across a rebuild (the scheduler now keeps task ids).
    const completed = new Set(plan.blocks.filter((b) => b.completed).map((b) => b.id));
    const finalBlocks: Block[] = result.blocks.map((b) =>
      completed.has(b.id) ? { ...b, completed: true } : b
    );

    setPlan((p) => ({ ...p, blocks: finalBlocks, tasks: [] }));
    setOverflow(result.overflow);
    setBuildPulse((n) => n + 1);
  }

  function handleChangeBlock(id: string, patch: Partial<Block>) {
    setBlocks((blocks) => blocks.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }
  function handleToggleComplete(id: string) {
    setBlocks((blocks) =>
      blocks.map((b) => (b.id === id ? { ...b, completed: !b.completed } : b))
    );
  }
  function handleDeleteBlock(id: string) {
    setBlocks((blocks) => blocks.filter((b) => b.id !== id));
    setEditingId(null);
  }
  function handleCreateBlock(start: number) {
    const end = Math.min(start + 30, 24 * 60);
    const conflicts = plan.blocks.some((b) => !(end <= b.start || start >= b.end));
    if (conflicts) return;
    const id = uid();
    setBlocks((blocks) => [...blocks, { id, title: 'New block', start, end, category: 'other' }]);
    setEditingId(id);
  }
  function handleCopyYesterday() {
    const y = loadPlan(addDays(date, -1));
    if (y.blocks.length === 0 && y.tasks.length === 0) return;
    setPlan((p) => ({
      date: p.date,
      blocks: y.blocks.map((b) => ({ ...b, id: uid() })),
      tasks: y.tasks.map((t) => ({ ...t, id: uid() })),
    }));
  }

  const editingBlock = useMemo(
    () => plan.blocks.find((b) => b.id === editingId) ?? null,
    [editingId, plan.blocks]
  );

  return (
    <div className="min-h-screen text-ink-1">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
        className="max-w-[1320px] mx-auto p-4 lg:p-6 flex flex-col gap-5"
      >
        <Header
          date={date}
          onChangeDate={setDate}
          settings={settings}
          onChangeSettings={setSettings}
          onCopyYesterday={handleCopyYesterday}
        />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-5 items-stretch">
          <Timeline
            blocks={plan.blocks}
            workingStart={settings.workingStart}
            workingEnd={settings.workingEnd}
            date={date}
            buildPulse={buildPulse}
            onChangeBlock={handleChangeBlock}
            onEditBlock={(id) => setEditingId(id)}
            onCreateBlock={handleCreateBlock}
            onToggleComplete={handleToggleComplete}
          />
          <div className="flex flex-col gap-5 h-full min-h-0">
            <ProgressWheel blocks={plan.blocks} />
            <IntakePanel
              tasks={plan.tasks}
              overflow={overflow}
              onAddTasks={handleAddTasks}
              onUpdateTask={handleUpdateTask}
              onRemoveTask={handleRemoveTask}
              onBuildDay={handleBuildDay}
              onClearOverflow={() => setOverflow([])}
            />
            <SummaryCard blocks={plan.blocks} />
          </div>
        </div>
      </motion.div>

      <EditBlockModal
        block={editingBlock}
        otherBlocks={plan.blocks.filter((b) => b.id !== editingId)}
        onClose={() => setEditingId(null)}
        onSave={(patch) => {
          if (!editingBlock) return;
          handleChangeBlock(editingBlock.id, patch);
          setEditingId(null);
        }}
        onDelete={() => editingBlock && handleDeleteBlock(editingBlock.id)}
      />
    </div>
  );
}

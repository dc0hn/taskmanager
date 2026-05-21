import { DEFAULT_SETTINGS } from './types';
import type { DayPlan, Settings } from './types';

const PLAN_PREFIX = 'dp:plan:';
const SETTINGS_KEY = 'dp:settings';

export function loadPlan(date: string): DayPlan {
  try {
    const raw = localStorage.getItem(PLAN_PREFIX + date);
    if (!raw) return { date, tasks: [], blocks: [] };
    const parsed = JSON.parse(raw);
    return {
      date,
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
      blocks: Array.isArray(parsed.blocks) ? parsed.blocks : [],
    };
  } catch {
    return { date, tasks: [], blocks: [] };
  }
}

export function savePlan(plan: DayPlan) {
  localStorage.setItem(PLAN_PREFIX + plan.date, JSON.stringify(plan));
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      workingStart:
        typeof parsed.workingStart === 'number' ? parsed.workingStart : DEFAULT_SETTINGS.workingStart,
      workingEnd:
        typeof parsed.workingEnd === 'number' ? parsed.workingEnd : DEFAULT_SETTINGS.workingEnd,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function listPlanDates(): string[] {
  const dates: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(PLAN_PREFIX)) dates.push(key.slice(PLAN_PREFIX.length));
  }
  return dates.sort();
}

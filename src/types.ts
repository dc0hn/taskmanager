export type Category = 'deep' | 'admin' | 'break' | 'other';

export const CATEGORIES: { id: Category; label: string; accent: string; bg: string }[] = [
  { id: 'deep', label: 'Deep focus', accent: '#7a2530', bg: 'rgba(122,37,48,0.10)' },
  { id: 'admin', label: 'Admin & email', accent: '#1f3b5d', bg: 'rgba(31,59,93,0.10)' },
  { id: 'break', label: 'Break / personal', accent: '#b07720', bg: 'rgba(176,119,32,0.13)' },
  { id: 'other', label: 'Other', accent: '#4a3d2e', bg: 'rgba(74,61,46,0.08)' },
];

export interface Task {
  id: string;
  title: string;
  duration: number; // minutes
  category: Category;
  fixedTime?: number; // minutes since midnight
  priority: 'high' | 'normal';
}

export interface Block {
  id: string;
  title: string;
  start: number; // minutes since midnight
  end: number; // minutes since midnight
  category: Category;
  completed?: boolean;
  auto?: boolean; // true for synthetic blocks added by the scheduler (e.g. auto breaks)
}

export interface DayPlan {
  date: string; // YYYY-MM-DD
  tasks: Task[]; // unscheduled
  blocks: Block[]; // scheduled
}

export interface Settings {
  workingStart: number; // minutes since midnight
  workingEnd: number;
}

export const DEFAULT_SETTINGS: Settings = {
  workingStart: 8 * 60,
  workingEnd: 19 * 60,
};

export type Category = 'deep' | 'admin' | 'break' | 'other';

export const CATEGORIES: { id: Category; label: string; accent: string; bg: string }[] = [
  { id: 'deep', label: 'Deep / focused work', accent: '#6366f1', bg: '#eef0ff' },
  { id: 'admin', label: 'Admin & email', accent: '#0ea5a4', bg: '#e6f7f6' },
  { id: 'break', label: 'Break / personal', accent: '#d97706', bg: '#fdf2e1' },
  { id: 'other', label: 'Other', accent: '#64748b', bg: '#eef1f5' },
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
  workingEnd: 18 * 60,
};

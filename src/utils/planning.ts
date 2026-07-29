import type { Settings } from '../types';
import { toDateKey } from './time';

// The minute-of-day a (re)build should start from.
//   • For any day other than today → the working-day start.
//   • For today → the next 5-minute mark from "now", clamped into the working
//     window, so a freshly built/rebuilt plan never hands back slots that have
//     already passed.
// `now` is injectable so this is unit-testable without mocking the clock.
export function effectiveStart(
  date: string,
  settings: Settings,
  now: Date = new Date()
): number {
  if (date !== toDateKey(now)) return settings.workingStart;
  const nowMin = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
  return Math.min(settings.workingEnd, Math.max(settings.workingStart, nowMin));
}

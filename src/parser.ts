import type { Category, Task } from './types';

// Parse inline shorthand from a single line into a partial task.
// Recognized:
//   @2pm  @2:30pm  @14:00      -> fixedTime
//   30m   90m   1h   1h30m     -> duration
//   !high                       -> priority high
//   #deep #admin #break #other  -> category
// The remaining text after stripping these tokens becomes the title.

const CATEGORY_TOKENS: Record<string, Category> = {
  '#deep': 'deep',
  '#focus': 'deep',
  '#focused': 'deep',
  '#admin': 'admin',
  '#email': 'admin',
  '#break': 'break',
  '#personal': 'break',
  '#lunch': 'break',
  '#other': 'other',
};

const DURATION_PRESETS = [15, 30, 60, 90, 120];

function parseTimeToken(tok: string): number | null {
  // Accept: @2pm, @2:30pm, @14:00, @1430
  const m = tok.match(/^@(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mm = m[2] ? Number(m[2]) : 0;
  const period = m[3]?.toLowerCase();
  if (period === 'am') {
    if (h === 12) h = 0;
  } else if (period === 'pm') {
    if (h !== 12) h += 12;
  }
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

function tryDuration(tok: string): number | null {
  // h-only: 2h, 1hr
  let m = tok.match(/^(\d+)(h|hr|hour|hours)$/i);
  if (m) return Number(m[1]) * 60;
  // h+m: 1h30m, 2h15m
  m = tok.match(/^(\d+)(h|hr)(\d+)(m|min)?$/i);
  if (m) return Number(m[1]) * 60 + Number(m[3]);
  // m-only: 30m, 90min
  m = tok.match(/^(\d+)(m|min|mins)$/i);
  if (m) return Number(m[1]);
  return null;
}

export function parseTaskLine(line: string): Partial<Task> & { title: string } {
  const tokens = line.split(/\s+/).filter(Boolean);
  const remaining: string[] = [];
  const result: Partial<Task> & { title: string } = { title: '' };

  for (const t of tokens) {
    // priority
    if (/^!high$/i.test(t)) {
      result.priority = 'high';
      continue;
    }
    if (/^!normal$/i.test(t)) {
      result.priority = 'normal';
      continue;
    }
    // category
    const catKey = t.toLowerCase();
    if (catKey in CATEGORY_TOKENS) {
      result.category = CATEGORY_TOKENS[catKey];
      continue;
    }
    // fixed time
    if (t.startsWith('@')) {
      const ft = parseTimeToken(t);
      if (ft != null) {
        result.fixedTime = ft;
        continue;
      }
    }
    // duration
    const dur = tryDuration(t);
    if (dur != null) {
      result.duration = dur;
      continue;
    }
    remaining.push(t);
  }

  result.title = remaining.join(' ').trim();
  return result;
}

export { DURATION_PRESETS };

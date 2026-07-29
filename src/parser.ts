import type { Category, CategoryDef, Task } from './types';

// Parse inline shorthand from a single line into a partial task.
// Recognized:
//   2pm  2:30pm  14:00  @2pm           -> fixedTime
//   2pm-4pm  2-4pm  2pm to 4pm  14:00-16:00  -> fixedTime + duration
//   30m   90m   1h   1h30m              -> duration
//   !high  high  p1                     -> priority high
//   !normal  normal  p2                 -> priority normal
//   #deep #admin #break #other          -> category
//   #<any custom category>              -> category
// The remaining text after stripping these tokens becomes the title.

/**
 * Convenience aliases for the shipped categories. These are additive — a token
 * map is always built from the live category list too, so a custom "Music
 * practice" category is addressable as #music-practice (its id) or #music (its
 * short label) without anything being registered here.
 */
const BUILTIN_ALIASES: Record<string, Category> = {
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

/**
 * Build the `#token -> category id` map for a set of categories.
 *
 * Each category answers to its id, its short label, and its full label with
 * spaces collapsed to hyphens. Builtin aliases fill in behind those, so a user
 * who renames "Deep focus" to "Studio time" can still type #deep out of habit —
 * unless they created a *new* category that legitimately claims that token, in
 * which case the real category wins.
 */
export function buildCategoryTokens(
  categories: CategoryDef[]
): Record<string, Category> {
  const map: Record<string, Category> = {};

  // Aliases first, so live categories can override them below.
  for (const [token, id] of Object.entries(BUILTIN_ALIASES)) {
    if (categories.some((c) => c.id === id)) map[token] = id;
  }

  const slug = (s: string) =>
    '#' + s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

  for (const c of categories) {
    for (const token of [slug(c.id), slug(c.short), slug(c.label)]) {
      if (token.length > 1) map[token] = c.id;
    }
  }
  return map;
}

const DURATION_PRESETS = [15, 30, 60, 90, 120];

function parseTimeToken(tok: string): number | null {
  // Accept: 2pm, 2:30pm, 14:00, @2pm, @1430.
  // Bare tokens (no @) must have a colon or am/pm, so plain numbers like "1430" don't accidentally match.
  const hadAt = tok.startsWith('@');
  const body = hadAt ? tok.slice(1) : tok;
  const m = body.match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/i);
  if (!m) return null;
  const hasColon = body.includes(':');
  const hasPeriod = !!m[3];
  if (!hadAt && !hasColon && !hasPeriod) return null;
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

function tryRange(tok: string): { start: number; end: number } | null {
  // Accept: 2pm-4pm, 2-4pm (shared period), 14:00-16:00, @2pm-4pm
  const hadAt = tok.startsWith('@');
  const body = hadAt ? tok.slice(1) : tok;
  const parts = body.split(/[-–]/);
  if (parts.length !== 2) return null;
  let [a, b] = parts;
  if (!a || !b) return null;
  // Shared period: "2-4pm" -> "2pm-4pm"
  const bPeriod = b.match(/(am|pm)$/i);
  if (bPeriod && !/(am|pm)$/i.test(a)) {
    a = a + bPeriod[1];
  }
  // Parse via @-prefixed form so bare numbers (e.g. "2" in "2-4pm" after sharing handles it,
  // and "14" in "14:00-16:00" is fine because the colon is preserved per-half) are accepted.
  const start = parseTimeToken('@' + a);
  const end = parseTimeToken('@' + b);
  if (start == null || end == null) return null;
  if (end <= start) return null;
  return { start, end };
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

export function parseTaskLine(
  line: string,
  categoryTokens: Record<string, Category> = BUILTIN_ALIASES
): Partial<Task> & { title: string } {
  // Pre-pass: collapse "2pm to 4pm" into "2pm-4pm" so it's a single token.
  const collapsed = line.replace(
    /(@?\d{1,2}(?::\d{2})?(?:am|pm)?)\s+to\s+(\d{1,2}(?::\d{2})?(?:am|pm)?)/gi,
    '$1-$2',
  );
  const tokens = collapsed.split(/\s+/).filter(Boolean);
  const remaining: string[] = [];
  const result: Partial<Task> & { title: string } = { title: '' };

  for (const t of tokens) {
    // priority
    if (/^(!?high|p1)$/i.test(t)) {
      result.priority = 'high';
      continue;
    }
    if (/^(!?normal|p2)$/i.test(t)) {
      result.priority = 'normal';
      continue;
    }
    // category
    const catKey = t.toLowerCase();
    if (catKey in categoryTokens) {
      result.category = categoryTokens[catKey];
      continue;
    }
    // time range (sets both start time and duration)
    const range = tryRange(t);
    if (range) {
      result.fixedTime = range.start;
      result.duration = range.end - range.start;
      continue;
    }
    // fixed time
    const ft = parseTimeToken(t);
    if (ft != null) {
      result.fixedTime = ft;
      continue;
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

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(key: string, n: number): string {
  const d = fromDateKey(key);
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}

export function formatLongDate(key: string): string {
  const d = fromDateKey(key);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

export function isSameDay(a: string, b: string): boolean {
  return a === b;
}

// "HH:MM" — 24h, used in inputs
export function minutesTo24h(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function parse24h(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

// 12h display: "9:30 am", "2:00 pm"
export function format12h(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const period = h24 >= 12 ? 'pm' : 'am';
  const h = ((h24 + 11) % 12) + 1;
  return `${h}:${String(m).padStart(2, '0')} ${period}`;
}

// Hour-label display: "8 AM" for whole hours, "8:30 AM" otherwise.
export function formatHourLabel(min: number): string {
  const h24 = Math.floor(min / 60);
  const m = min % 60;
  const h = ((h24 + 11) % 12) + 1;
  const p = h24 >= 12 ? 'PM' : 'AM';
  return m === 0 ? `${h} ${p}` : `${h}:${String(m).padStart(2, '0')} ${p}`;
}

export function formatDuration(min: number): string {
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

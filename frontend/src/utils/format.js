export const ROLE_LABELS = {
  super_admin: 'System Admin',
  program_director: 'Program Director',
  league_coach: 'Coach',
  referee_assignor: 'Referee Assignor',
  referee: 'Referee',
};

export const CATEGORY = {
  PRACTICE: { label: 'Practice', short: 'Practice', cls: 'bg-cat-practice' },
  WEEKNIGHT_GAME: { label: 'Weeknight game', short: 'Weeknight', cls: 'bg-cat-weeknight' },
  WEEKEND_GAME_BLOCK: { label: 'Weekend game block', short: 'Weekend', cls: 'bg-cat-weekend' },
};

export function time12(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}${h >= 12 ? 'pm' : 'am'}`;
}
export const timeRange = (a, b) => `${time12(a)}–${time12(b)}`;

const d = (iso) => new Date(`${iso}T12:00:00`);
export const toISO = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const todayISO = () => toISO(new Date());
export function addDays(iso, n) { const x = d(iso); x.setDate(x.getDate() + n); return toISO(x); }
export function startOfWeek(iso) { const x = d(iso); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return toISO(x); } // Monday
export const weekday = (iso, style = 'short') => d(iso).toLocaleDateString(undefined, { weekday: style });
export const monthDay = (iso) => d(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const longDate = (iso) => d(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
export function dateRange(a, b) {
  if (a === b) return monthDay(a);
  const sameYear = a.slice(0, 4) === b.slice(0, 4);
  return `${monthDay(a)} – ${monthDay(b)}${sameYear ? '' : `, ${b.slice(0, 4)}`}`;
}
export function timestamp(sqlUtc) {
  if (!sqlUtc) return '';
  const x = new Date(`${sqlUtc.replace(' ', 'T')}Z`);
  return x.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
export const hoursBetween = (a, b) => {
  const m = (t) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  return (m(b) - m(a)) / 60;
};

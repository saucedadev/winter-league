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
// The league's time zone (e.g. America/Los_Angeles), set at startup from the
// server so "today" and timestamps match the league, not each device's clock.
let leagueTimeZone;
export function setLeagueTimeZone(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); leagueTimeZone = tz; } catch { leagueTimeZone = undefined; }
}
export const getLeagueTimeZone = () => leagueTimeZone;
// "Today" as YYYY-MM-DD in the league's time zone.
export function todayISO() {
  if (!leagueTimeZone) return toISO(new Date());
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: leagueTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
// "Pacific Time" (or the league's zone), for labels.
export function leagueTimeZoneLabel() {
  if (!leagueTimeZone) return '';
  for (const timeZoneName of ['longGeneric', 'long']) {
    try {
      const n = new Intl.DateTimeFormat('en-US', { timeZone: leagueTimeZone, timeZoneName }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      if (n) return n.value;
    } catch { /* older browsers: try the next style */ }
  }
  return leagueTimeZone;
}
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
  return x.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: leagueTimeZone });
}
export const hoursBetween = (a, b) => {
  const m = (t) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm; };
  return (m(b) - m(a)) / 60;
};

export const money = (cents) => (cents == null ? '' : `$${(cents / 100).toFixed(2)}`);

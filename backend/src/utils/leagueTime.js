import { config } from '../config.js';

// The league's clock. Game dates and times are stored as local wall-clock
// values in the league's time zone (config.leagueTimezone, Pacific by
// default). The server itself runs on UTC, so anything that asks "what day
// is it?" or "has check-in opened?" must go through here, never through
// new Date().toISOString(), which is UTC and rolls over at 4–5 PM Pacific.
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: config.leagueTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// { date: 'YYYY-MM-DD', minutes: minutes since local midnight }
export function leagueNow(at = new Date()) {
  const p = Object.fromEntries(fmt.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

export const leagueToday = (at = new Date()) => leagueNow(at).date;

// A database timestamp ("2026-11-05 19:10:21", always UTC) as league-local
// text for exports and emails, e.g. "2026-11-05 11:10 AM".
export function leagueTimestamp(utc) {
  if (!utc) return '';
  const d = new Date(`${String(utc).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(utc);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: config.leagueTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute} ${p.dayPeriod.replace(/\./g, '').toUpperCase()}`;
}

// "Pacific Time" (or whatever LEAGUE_TIMEZONE is), for column headings.
export function leagueZoneLabel() {
  for (const timeZoneName of ['longGeneric', 'long']) {
    try {
      const n = new Intl.DateTimeFormat('en-US', { timeZone: config.leagueTimezone, timeZoneName }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName');
      if (n) return n.value;
    } catch { /* older runtimes: try the next style */ }
  }
  return config.leagueTimezone;
}

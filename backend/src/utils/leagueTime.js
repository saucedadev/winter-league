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

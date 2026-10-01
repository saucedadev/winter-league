// Schedule exports (.csv), built in the browser from the games the page is
// showing, so a download always matches the screen (including its filters)
// and never contains anything the signed-in user can't already see.
import { time12 } from './format';

const cell = (v) => {
  const s = v == null ? '' : String(v);
  // Quote anything with a comma, quote or line break. A leading = + - @ is
  // prefixed so spreadsheet apps don't run it as a formula.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
}

// Save a CSV file. The byte-order mark makes Excel open accented names correctly.
export function downloadCsv(filename, header, rows) {
  const blob = new Blob([`﻿${toCsv(header, rows)}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// "Pacific Youth Conference" -> "pacific-youth-conference"
export const slug = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-') || 'schedule';

const STATUS = { scheduled: 'Scheduled', cancelled: 'Cancelled', unscheduled: 'Not placed' };
const dayName = (iso) => (iso ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }) : '');

// One row per game. Dates stay YYYY-MM-DD so spreadsheets sort them correctly.
// withTravel: add the away team's travel distance (Schedule builder).
export function scheduleRows(games, { withTravel = false } = {}) {
  const header = ['Date', 'Day', 'Start', 'End', 'Division', 'Home team', 'Home program', 'Away team', 'Away program',
    'Venue', 'Court', 'Address', 'Status', 'Home score', 'Away score', 'Referees', 'Notes'];
  if (withTravel) header.splice(12, 0, 'Travel (miles)');
  const rows = games.map((g) => {
    const notes = [
      g.isGuestGame && 'Guest game',
      g.status === 'cancelled' && g.cancelReason && `Cancelled: ${g.cancelReason}`,
      g.status === 'unscheduled' && (g.note || 'Waiting to be placed'),
      g.isAdded && `Added${g.addedReason ? `: ${g.addedReason}` : ''}`,
      g.isException && `Exception: ${g.exceptionNote}`,
      g.hasBlackoutConflict && `Blackout: ${g.blackoutReason}`,
      g.scoreNote && `Score note: ${g.scoreNote}`,
    ].filter(Boolean).join('; ');
    const address = [g.venueAddress, g.venueCity].filter(Boolean).join(', ');
    const row = [
      g.date || '', dayName(g.date), g.startTime ? time12(g.startTime) : '', g.endTime ? time12(g.endTime) : '',
      g.divisionName,
      g.homeTeamName, `${g.homeProgramName}${g.homeIsGuest ? ' (guest)' : ''}`,
      g.awayTeamName, `${g.awayProgramName}${g.awayIsGuest ? ' (guest)' : ''}`,
      g.venueName || '', g.courtName || '', address,
      STATUS[g.status] || g.status,
      g.hasScore ? g.homeScore : '', g.hasScore ? g.awayScore : '',
      g.refereeNames || '', notes,
    ];
    if (withTravel) row.splice(12, 0, g.travelMiles ?? '');
    return row;
  });
  return { header, rows };
}

export function downloadSchedule(filename, games, opts) {
  const { header, rows } = scheduleRows(games, opts);
  downloadCsv(filename, header, rows);
}

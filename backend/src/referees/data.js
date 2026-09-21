// Module C — referee assignment helpers shared by the referee routes and
// the Phase 2 schedule/request code (which calls onGamesChanged when games
// move or are cancelled).
import { one, all, db, newId } from '../db/client.js';
import { config } from '../config.js';
import { sendEmail } from '../utils/email.js';
import { logActivity } from '../utils/activityLog.js';
import { toMinutes, milesBetween } from '../scheduling/core.js';
import { formatTime12 } from '../utils/validate.js';
import { leagueNow } from '../utils/leagueTime.js';
import { GAME_SELECT, shapeGame } from '../scheduling/data.js';

export const DEFAULT_REF_SETTINGS = Object.freeze({
  refereesPerGame: 2,
  defaultPayCents: 4000,       // $40.00 per game
  checkInOpensMinutes: 60,     // before tip-off
  checkInClosesMinutes: 180,   // after tip-off
});
const LIMITS = {
  refereesPerGame: [1, 4, 'Referees per game'],
  defaultPayCents: [0, 100000, 'Default pay per game'],
  checkInOpensMinutes: [0, 720, 'Check-in opens (minutes before)'],
  checkInClosesMinutes: [0, 720, 'Check-in closes (minutes after)'],
};

export function normalizeRefSettings(input = {}) {
  const out = { ...DEFAULT_REF_SETTINGS };
  const errors = [];
  for (const [k, [min, max, label]] of Object.entries(LIMITS)) {
    if (input[k] === undefined || input[k] === null || input[k] === '') continue;
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${label} must be a whole number from ${min} to ${max}.`);
    else out[k] = n;
  }
  if (errors.length) { const e = new Error(errors.join(' ')); e.validation = true; throw e; }
  return out;
}

export async function getRefSettings() {
  const row = await one("SELECT value FROM app_settings WHERE key = 'referee_settings'");
  try { return normalizeRefSettings(row ? JSON.parse(row.value) : {}); } catch { return { ...DEFAULT_REF_SETTINGS }; }
}
export async function saveRefSettings(s) {
  await db.execute({ sql: "INSERT INTO app_settings (key, value) VALUES ('referee_settings', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [JSON.stringify(s)] });
}

export async function currentPublishedRun() {
  return one(`SELECT r.* FROM schedule_runs r JOIN seasons s ON s.id = r.season_id
    WHERE s.is_active = 1 AND r.status = 'published'`);
}

// ---------------------------------------------------------------------
// Slots: every scheduled game in a published run has positions 1..N.
// Idempotent; also trims EMPTY extra positions if N was lowered.
// ---------------------------------------------------------------------
export async function syncSlots(runId, refereesPerGame) {
  if (!runId) return;
  const n = refereesPerGame || (await getRefSettings()).refereesPerGame;
  await db.batch([
    {
      sql: `WITH RECURSIVE pos(p) AS (SELECT 1 UNION ALL SELECT p + 1 FROM pos WHERE p < ?)
            INSERT INTO referee_assignments (id, game_id, position, referee_id, status)
            SELECT lower(hex(randomblob(16))), g.id, pos.p, NULL, 'assigned'
            FROM games g CROSS JOIN pos
            WHERE g.run_id = ? AND g.status = 'scheduled'
              AND NOT EXISTS (SELECT 1 FROM referee_assignments a WHERE a.game_id = g.id AND a.position = pos.p)`,
      args: [n, runId],
    },
    { sql: 'DELETE FROM referee_assignments WHERE referee_id IS NULL AND position > ? AND game_id IN (SELECT id FROM games WHERE run_id = ?)', args: [n, runId] },
  ], 'write');
}

// ---------------------------------------------------------------------
// Time: "now" in league-local date + minutes, for check-in windows.
// ---------------------------------------------------------------------
export { leagueNow };

// { open, reason } — can this game be checked in to right now?
export function checkInWindow(game, settings, now = leagueNow()) {
  if (game.status !== 'scheduled') return { open: false, reason: 'This game isn’t scheduled.' };
  if (config.demoCheckInAnytime && game.date >= now.date) return { open: true, reason: 'Demo mode: check-in is open for every upcoming game.' };
  const start = toMinutes(game.startTime);
  if (game.date !== now.date) {
    return { open: false, reason: game.date > now.date ? `Check-in opens ${settings.checkInOpensMinutes} minutes before tip-off on game day.` : 'Check-in for this game has closed.' };
  }
  if (now.minutes < start - settings.checkInOpensMinutes) return { open: false, reason: `Check-in opens ${settings.checkInOpensMinutes} minutes before tip-off.` };
  if (now.minutes > start + settings.checkInClosesMinutes) return { open: false, reason: 'Check-in for this game has closed. Ask the assignor to confirm you worked it.' };
  return { open: true, reason: null };
}

// ---------------------------------------------------------------------
// Referee eligibility for one game
// ---------------------------------------------------------------------
const overlaps = (a, b) => a.date === b.date && a.startTime < b.endTime && b.startTime < a.endTime;
const gapMinutes = (a, b) => Math.min(Math.abs(toMinutes(a.startTime) - toMinutes(b.endTime)), Math.abs(toMinutes(b.startTime) - toMinutes(a.endTime)));

// Pure check. others: the referee's other assignments [{gameId, date, startTime, endTime, venueId, venueName}]
export function refereeProblems(game, others, unavailable) {
  const blocking = [];
  const warnings = [];
  const off = unavailable.find((u) => game.date >= u.startDate && game.date <= u.endDate);
  if (off) blocking.push(`Marked unavailable${off.note ? ` (${off.note})` : ''}`);
  if (others.some((o) => o.gameId === game.id)) blocking.push('Already on this game');
  const clash = others.find((o) => o.gameId !== game.id && overlaps(o, game));
  if (clash) blocking.push(`Already working ${clash.venueName} at ${formatTime12(clash.startTime)}`);
  const tight = others.find((o) => o.gameId !== game.id && o.date === game.date && !overlaps(o, game) && o.venueId !== game.venueId && gapMinutes(o, game) < 30);
  if (tight) warnings.push(`Back-to-back with a game at ${tight.venueName}`);
  const sameDay = others.filter((o) => o.gameId !== game.id && o.date === game.date).length;
  if (sameDay >= 3) warnings.push(`Already has ${sameDay} games that day`);
  return { blocking, warnings };
}

// Loads what refereeProblems needs for a set of referees on given dates.
export async function loadRefereeContext(dates, refereeIds = null) {
  if (!dates.length) return { others: new Map(), unavailable: new Map() };
  const dph = dates.map(() => '?').join(',');
  const rFilter = refereeIds ? ` AND a.referee_id IN (${refereeIds.map(() => '?').join(',')})` : '';
  const rows = await all(`SELECT a.id AS assignment_id, a.referee_id, g.id AS game_id, g.date, g.start_time, g.end_time, v.id AS venue_id, v.name AS venue_name
    FROM referee_assignments a JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
    JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id
    WHERE a.referee_id IS NOT NULL AND r.status = 'published' AND g.status = 'scheduled' AND g.date IN (${dph})${rFilter}`,
  [...dates, ...(refereeIds || [])]);
  const others = new Map();
  for (const r of rows) {
    if (!others.has(r.refereeId)) others.set(r.refereeId, []);
    others.get(r.refereeId).push(r);
  }
  const minD = [...dates].sort()[0];
  const maxD = [...dates].sort().at(-1);
  const un = await all(`SELECT * FROM referee_unavailability WHERE end_date >= ? AND start_date <= ?${refereeIds ? ` AND user_id IN (${refereeIds.map(() => '?').join(',')})` : ''}`,
    [minD, maxD, ...(refereeIds || [])]);
  const unavailable = new Map();
  for (const u of un) {
    if (!unavailable.has(u.userId)) unavailable.set(u.userId, []);
    unavailable.get(u.userId).push(u);
  }
  return { others, unavailable };
}

export async function activeReferees() {
  return all(`SELECT u.id, u.first_name, u.last_name, u.email, u.phone, u.is_active FROM users u
    WHERE u.role = 'referee' AND u.is_active = 1 ORDER BY u.last_name COLLATE NOCASE, u.first_name COLLATE NOCASE`);
}

// ---------------------------------------------------------------------
// Games + their assignments for listing
// ---------------------------------------------------------------------
export async function gamesWithAssignments(where, args) {
  const games = (await all(`${GAME_SELECT} WHERE ${where} ORDER BY g.date, g.start_time, v.name COLLATE NOCASE, c.name COLLATE NOCASE`, args)).map(shapeGame);
  if (!games.length) return [];
  const ids = games.map((g) => g.id);
  const rows = await all(`SELECT a.*, u.first_name || ' ' || u.last_name AS referee_name, u.email AS referee_email, u.phone AS referee_phone
    FROM referee_assignments a LEFT JOIN users u ON u.id = a.referee_id
    WHERE a.game_id IN (${ids.map(() => '?').join(',')}) ORDER BY a.position`, ids);
  const byGame = new Map(ids.map((id) => [id, []]));
  for (const r of rows) byGame.get(r.gameId)?.push(r);
  return games.map((g) => ({ ...g, assignments: byGame.get(g.id) }));
}

// ---------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------
export async function notifyUsers(where, args, subject, text) {
  try {
    const users = await all(`SELECT email, first_name FROM users WHERE is_active = 1 AND (${where})`, args);
    await Promise.all(users.map((u) => sendEmail({ to: u.email, subject, text: `Hi ${u.firstName},\n\n${text}\n\n${config.appUrls[0]}` })));
  } catch (err) { console.error('referee notification failed:', err.message); }
}
export const notifyAssignors = (subject, text) => notifyUsers("role = 'referee_assignor'", [], subject, text);
export const gameLine = (g) => `${g.homeTeamName} vs ${g.awayTeamName}, ${g.date} at ${g.startTime ? formatTime12(g.startTime) : 'a time to be set'}, ${g.venueName || 'venue to be set'}${g.courtName ? ` – ${g.courtName}` : ''}`;

// ---------------------------------------------------------------------
// Phase 2 hook: games moved, swapped, cancelled, or restored.
// Referees stay on a moved game unless the new time conflicts with their
// other games or their unavailable dates — then they're removed and the
// assignor is told. Cancelled games release everyone.
// ---------------------------------------------------------------------
export async function onGamesChanged(gameIds, actor) {
  if (!gameIds.length) return { kept: 0, removed: 0 };
  const run = await currentPublishedRun();
  if (!run) return { kept: 0, removed: 0 };
  await syncSlots(run.id);
  const games = await gamesWithAssignments(`g.id IN (${gameIds.map(() => '?').join(',')}) AND g.run_id = ?`, [...gameIds, run.id]);
  let kept = 0;
  let removed = 0;
  const stmts = [];
  for (const g of games) {
    for (const a of g.assignments.filter((x) => x.refereeId)) {
      let reason = null;
      if (g.status === 'cancelled') reason = 'the game was cancelled';
      else if (g.status !== 'scheduled') reason = 'the game was taken off the schedule';
      else {
        const ctx = await loadRefereeContext([g.date], [a.refereeId]);
        const others = (ctx.others.get(a.refereeId) || []).filter((o) => o.assignmentId !== a.id);
        const p = refereeProblems(g, others, ctx.unavailable.get(a.refereeId) || []);
        if (p.blocking.length) reason = `the new time doesn’t work for you (${p.blocking[0].toLowerCase()})`;
      }
      if (reason) {
        removed++;
        stmts.push({ sql: "UPDATE referee_assignments SET referee_id = NULL, status = 'assigned', assigned_by = NULL, assigned_at = NULL, checked_in_at = NULL, check_in_method = NULL, check_in_distance_miles = NULL, pay_cents = NULL, updated_at = datetime('now') WHERE id = ?", args: [a.id] });
        await notifyUsers('id = ?', [a.refereeId], 'You’ve been taken off a game', `You were removed from ${gameLine(g)} because ${reason}.`);
        if (g.status === 'scheduled') await notifyAssignors('A referee slot reopened', `${a.refereeName} was removed from ${gameLine(g)} after a schedule change. The slot needs a new referee.`);
        await logActivity({ category: 'referee', action: 'unassigned', actor, details: `${a.refereeName} removed from ${g.homeTeamName} vs ${g.awayTeamName}: ${reason}` });
      } else {
        kept++;
        await notifyUsers('id = ?', [a.refereeId], 'A game you’re working has moved', `This game has a new date, time, or court:\n${gameLine(g)}\nYou’re still assigned.`);
      }
    }
  }
  if (stmts.length) await db.batch(stmts, 'write');
  return { kept, removed };
}

// When a newer schedule replaces the published one, carry referees over to
// games that are unchanged (same teams, date, start time, and court).
// Returns { carried, dropped } for the upcoming assignments on the old run.
export async function carryOverAssignments(oldRunId, newRunId, today) {
  const settings = await getRefSettings();
  await syncSlots(newRunId, settings.refereesPerGame);
  const old = await all(`SELECT a.position, a.referee_id, a.assigned_by, a.assigned_at, g.home_team_id, g.away_team_id, g.date, g.start_time, g.court_id
    FROM referee_assignments a JOIN games g ON g.id = a.game_id
    WHERE g.run_id = ? AND a.referee_id IS NOT NULL AND g.status = 'scheduled' AND g.date >= ?`, [oldRunId, today]);
  if (!old.length) return { carried: 0, dropped: 0 };
  const fresh = await all(`SELECT a.id, a.position, g.home_team_id, g.away_team_id, g.date, g.start_time, g.court_id
    FROM referee_assignments a JOIN games g ON g.id = a.game_id WHERE g.run_id = ? AND a.referee_id IS NULL`, [newRunId]);
  const key = (x) => `${[x.homeTeamId, x.awayTeamId].sort().join('|')}|${x.date}|${x.startTime}|${x.courtId}|${x.position}`;
  const open = new Map(fresh.map((f) => [key(f), f]));
  const stmts = [];
  for (const o of old) {
    const f = open.get(key(o));
    if (!f) continue;
    open.delete(key(o));
    stmts.push({ sql: "UPDATE referee_assignments SET referee_id = ?, status = 'assigned', assigned_by = ?, assigned_at = ?, updated_at = datetime('now') WHERE id = ?", args: [o.refereeId, o.assignedBy, o.assignedAt, f.id] });
  }
  if (stmts.length) await db.batch(stmts, 'write');
  return { carried: stmts.length, dropped: old.length - stmts.length };
}

export async function upcomingAssignmentCount(runId, today) {
  const r = await one(`SELECT COUNT(*) AS n FROM referee_assignments a JOIN games g ON g.id = a.game_id
    WHERE g.run_id = ? AND a.referee_id IS NOT NULL AND g.status = 'scheduled' AND g.date >= ?`, [runId, today]);
  return Number(r.n);
}

export const payRate = (profileRate, settings) => (profileRate == null ? settings.defaultPayCents : profileRate);
export { milesBetween, newId };

// Fill open slots in [from, to]. Strict: skips anyone with a conflict, an
// unavailable date, or a back-to-back at another venue. Prefers whoever has
// the fewest games this season, then the fewest that day, then last name.
// Returns { filled, stillOpen, byRef: Map(refereeId -> [games]) }.
export async function autoFill({ runId, from, to, assignedBy = null }) {
  const games = (await gamesWithAssignments("g.run_id = ? AND g.status = 'scheduled' AND g.date BETWEEN ? AND ?", [runId, from, to]))
    .filter((g) => g.assignments.some((a) => !a.refereeId));
  const refs = await activeReferees();
  const byRef = new Map();
  if (!games.length || !refs.length) return { filled: 0, stillOpen: games.reduce((n, g) => n + g.assignments.filter((a) => !a.refereeId).length, 0), byRef };

  const ctx = await loadRefereeContext([...new Set(games.map((g) => g.date))]);
  const season = await all(`SELECT a.referee_id, COUNT(*) AS n FROM referee_assignments a JOIN games g ON g.id = a.game_id
    WHERE g.run_id = ? AND a.referee_id IS NOT NULL AND g.status = 'scheduled' GROUP BY a.referee_id`, [runId]);
  const count = new Map(refs.map((x) => [x.id, 0]));
  for (const s of season) if (count.has(s.refereeId)) count.set(s.refereeId, Number(s.n));

  const stmts = [];
  let stillOpen = 0;
  for (const g of games) {
    for (const slot of g.assignments.filter((a) => !a.refereeId)) {
      let best = null;
      for (const ref of refs) {
        const others = ctx.others.get(ref.id) || [];
        const p = refereeProblems(g, others, ctx.unavailable.get(ref.id) || []);
        if (p.blocking.length || p.warnings.length) continue;
        const score = [count.get(ref.id), others.filter((o) => o.date === g.date).length, ref.lastName.toLowerCase()];
        const better = !best || score[0] < best.score[0] || (score[0] === best.score[0] && (score[1] < best.score[1] || (score[1] === best.score[1] && score[2] < best.score[2])));
        if (better) best = { ref, score };
      }
      if (!best) { stillOpen++; continue; }
      const id = best.ref.id;
      stmts.push({ sql: "UPDATE referee_assignments SET referee_id = ?, status = 'assigned', assigned_by = ?, assigned_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", args: [id, assignedBy, slot.id] });
      if (!ctx.others.has(id)) ctx.others.set(id, []);
      ctx.others.get(id).push({ assignmentId: slot.id, refereeId: id, gameId: g.id, date: g.date, startTime: g.startTime, endTime: g.endTime, venueId: g.venueId, venueName: g.venueName });
      count.set(id, count.get(id) + 1);
      if (!byRef.has(id)) byRef.set(id, []);
      byRef.get(id).push(g);
    }
  }
  if (stmts.length) await db.batch(stmts, 'write');
  return { filled: stmts.length, stillOpen, byRef };
}

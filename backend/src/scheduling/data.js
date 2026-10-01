import { one, all, db, newId } from '../db/client.js';
import { addDays, formatTime12 } from '../utils/validate.js';
import { leagueToday } from '../utils/leagueTime.js';
import { normalizeRules, programHomes, carveWindows, milesBetween, teamProblems, toMinutes, travelCapFor, hasTravelOverride, reservationFit, reservationLabel, reservationText, withReservations, addMinutes } from './core.js';

// Every division, for naming the divisions a slot is kept for.
const allDivisions = () => all('SELECT id, name, grade, gender, is_active FROM divisions ORDER BY sort_order');
import { buildSchedule } from './matchmaker.js';

export const GAME_CATEGORIES = ['WEEKNIGHT_GAME', 'WEEKEND_GAME_BLOCK'];
const CAT_SQL = `('WEEKNIGHT_GAME', 'WEEKEND_GAME_BLOCK')`;

// ---------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------
// { divisionId: name } for every division — used to check division overrides.
export async function divisionNameMap() {
  const rows = await all('SELECT id, name FROM divisions');
  return Object.fromEntries(rows.map((d) => [d.id, d.name]));
}

// { programId: name } for every league (non-guest) program — used to check
// program overrides. Guests have no home gyms, so no travel cap.
export async function programNameMap() {
  const rows = await all('SELECT id, name FROM programs WHERE is_guest = 0');
  return Object.fromEntries(rows.map((p) => [p.id, p.name]));
}

// League rules as saved. Overrides for divisions that have since been
// deleted are dropped so they can't block saving the rules again.
export async function getRules() {
  const row = await one("SELECT value FROM app_settings WHERE key = 'schedule_rules'");
  if (!row) return normalizeRules({});
  let rules;
  try { rules = normalizeRules(JSON.parse(row.value)); } catch { return normalizeRules({}); }
  const ids = Object.keys(rules.divisionOverrides);
  if (ids.length) {
    const names = await divisionNameMap();
    for (const id of ids) if (!names[id]) delete rules.divisionOverrides[id];
  }
  const pids = Object.keys(rules.programOverrides);
  if (pids.length) {
    const names = await programNameMap();
    for (const id of pids) if (!names[id]) delete rules.programOverrides[id];
  }
  return rules;
}

export async function saveRules(rules) {
  await db.execute({
    sql: "INSERT INTO app_settings (key, value) VALUES ('schedule_rules', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    args: [JSON.stringify(rules)],
  });
}

// ---------------------------------------------------------------------
// Game rows as the API returns them
// ---------------------------------------------------------------------
export const GAME_SELECT = `SELECT g.*,
  d.name AS division_name, d.sort_order AS division_sort, d.gender AS division_gender,
  ht.name AS home_team_name, ht.program_id AS home_program_id, hp.name AS home_program_name, hp.short_code AS home_program_code,
  ht.head_coach_user_id AS home_coach_id, hp.is_guest AS home_is_guest,
  at.name AS away_team_name, at.program_id AS away_program_id, ap.name AS away_program_name, ap.short_code AS away_program_code,
  at.head_coach_user_id AS away_coach_id, ap.is_guest AS away_is_guest,
  su.first_name || ' ' || su.last_name AS score_entered_by_name,
  cu.first_name || ' ' || cu.last_name AS cancelled_by_name,
  adu.first_name || ' ' || adu.last_name AS added_by_name,
  (SELECT GROUP_CONCAT(n, ', ') FROM (SELECT ru.first_name || ' ' || ru.last_name AS n FROM referee_assignments ra
     JOIN users ru ON ru.id = ra.referee_id WHERE ra.game_id = g.id ORDER BY ra.position)) AS referee_names,
  (SELECT COUNT(*) FROM referee_assignments ra WHERE ra.game_id = g.id) AS referee_slots,
  c.name AS court_name, v.id AS venue_id, v.name AS venue_name, v.program_id AS venue_program_id, v.address AS venue_address, v.city AS venue_city,
  (SELECT b.reason FROM blackout_dates b WHERE g.date IS NOT NULL AND g.date BETWEEN b.start_date AND b.end_date
     AND ((b.program_id = v.program_id AND (b.venue_id IS NULL OR b.venue_id = v.id))
       OR (b.venue_id IS NULL AND b.program_id IN (ht.program_id, at.program_id))) LIMIT 1) AS blackout_reason,
  (SELECT r.id FROM change_requests r WHERE (r.game_id = g.id OR r.swap_game_id = g.id)
     AND r.status IN ('pending_director', 'pending_counterpart', 'pending_admin') LIMIT 1) AS open_request_id
  FROM games g
  JOIN divisions d ON d.id = g.division_id
  JOIN teams ht ON ht.id = g.home_team_id JOIN programs hp ON hp.id = ht.program_id
  JOIN teams at ON at.id = g.away_team_id JOIN programs ap ON ap.id = at.program_id
  LEFT JOIN courts c ON c.id = g.court_id LEFT JOIN venues v ON v.id = c.venue_id
  LEFT JOIN users su ON su.id = g.score_entered_by
  LEFT JOIN users cu ON cu.id = g.cancelled_by
  LEFT JOIN users adu ON adu.id = g.added_by`;

export const GAME_ORDER = `ORDER BY g.date IS NULL, g.date, g.start_time, d.sort_order, v.name COLLATE NOCASE, c.name COLLATE NOCASE`;

export function shapeGame(g) {
  return { ...g, hasBlackoutConflict: !!g.blackoutReason, hasOpenRequest: !!g.openRequestId, hasScore: g.homeScore != null && g.awayScore != null,
    isAdded: !!g.addedAt, isException: !!g.exceptionNote,
    homeIsGuest: !!g.homeIsGuest, awayIsGuest: !!g.awayIsGuest, isGuestGame: !!(g.homeIsGuest || g.awayIsGuest) };
}

export async function getGame(id) {
  const g = await one(`${GAME_SELECT} WHERE g.id = ?`, [id]);
  return g ? shapeGame(g) : null;
}

// ---------------------------------------------------------------------
// Inputs for the matchmaker
// ---------------------------------------------------------------------
async function loadInputs(season, rules) {
  const teams = await all(`SELECT t.id, t.name, t.program_id, t.division_id, d.name AS division_name, d.gender AS division_gender, p.name AS program_name
    FROM teams t JOIN divisions d ON d.id = t.division_id JOIN programs p ON p.id = t.program_id
    WHERE t.is_active = 1 AND d.is_active = 1 AND p.is_active = 1 AND p.is_guest = 0
    ORDER BY d.sort_order, p.name COLLATE NOCASE, t.name COLLATE NOCASE`);
  const venues = await all('SELECT v.program_id, v.latitude, v.longitude FROM venues v JOIN programs p ON p.id = v.program_id WHERE v.is_active = 1 AND p.is_active = 1');

  // Open game slots: game categories, inside the season, active venue, not
  // covered by any blackout for the venue or the whole program.
  const slots = await all(`SELECT g.id, g.program_id, g.court_id, g.date, g.start_time, g.end_time, g.category,
      g.reserved_divisions, g.reserved_mode,
      c.name AS court_name, v.id AS venue_id, v.name AS venue_name, v.latitude, v.longitude
    FROM gym_slots g JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id JOIN programs p ON p.id = g.program_id
    WHERE g.season_id = ? AND g.category IN ${CAT_SQL} AND v.is_active = 1 AND p.is_active = 1
      AND g.date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM blackout_dates b WHERE b.program_id = g.program_id
        AND (b.venue_id IS NULL OR b.venue_id = v.id) AND g.date BETWEEN b.start_date AND b.end_date)`,
  [season.id, season.startDate, season.endDate]);

  // Program-wide blackouts stop that program's teams playing ANYWHERE that day.
  const blackouts = await all(`SELECT program_id, start_date, end_date FROM blackout_dates
    WHERE venue_id IS NULL AND end_date >= ? AND start_date <= ?`, [season.startDate, season.endDate]);
  const programBlackouts = new Set();
  for (const b of blackouts) {
    for (let d = b.startDate < season.startDate ? season.startDate : b.startDate; d <= b.endDate && d <= season.endDate; d = addDays(d, 1)) {
      programBlackouts.add(`${b.programId}|${d}`);
    }
  }
  const programNames = Object.fromEntries(teams.map((t) => [t.programId, t.programName]));
  return { teams, windows: carveWindows(withReservations(slots, await allDivisions()), rules.gameMinutes, rules.bufferMinutes), homes: programHomes(venues), programBlackouts, programNames };
}

// Builds a new draft for the season. Any earlier draft for the season is
// replaced — there is only ever one draft at a time.
export async function generateDraft(season, rules, userId) {
  const inputs = await loadInputs(season, rules);
  const result = buildSchedule({ ...inputs, rules });

  const runId = newId();
  const stmts = [];
  const oldDrafts = await all("SELECT id FROM schedule_runs WHERE season_id = ? AND status = 'draft'", [season.id]);
  for (const d of oldDrafts) {
    stmts.push({ sql: 'DELETE FROM games WHERE run_id = ?', args: [d.id] });
    stmts.push({ sql: 'DELETE FROM schedule_runs WHERE id = ?', args: [d.id] });
  }
  stmts.push({
    sql: 'INSERT INTO schedule_runs (id, season_id, status, rules, summary, warnings, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    args: [runId, season.id, 'draft', JSON.stringify(rules), JSON.stringify(result.summary), JSON.stringify(result.warnings), userId],
  });
  for (const g of result.games) {
    const w = g.window;
    stmts.push({
      sql: `INSERT INTO games (id, run_id, season_id, division_id, home_team_id, away_team_id, court_id, gym_slot_id, date, start_time, end_time, status, travel_miles, round, note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [newId(), runId, season.id, g.divisionId, g.homeTeamId, g.awayTeamId, w?.courtId ?? null, w?.slotId ?? null,
        w?.date ?? null, w?.startTime ?? null, w?.endTime ?? null, w ? 'scheduled' : 'unscheduled', g.travelMiles, g.round, g.note],
    });
  }
  // One atomic write: a failed generation never leaves half a draft behind.
  await db.batch(stmts, 'write');
  return { runId, ...result };
}

// ---------------------------------------------------------------------
// Placement checks — used by admin edits and change requests
// ---------------------------------------------------------------------
export async function runRules(runId) {
  const r = await one('SELECT rules FROM schedule_runs WHERE id = ?', [runId]);
  try { return normalizeRules(JSON.parse(r?.rules || '{}')); } catch { return normalizeRules({}); }
}

async function programHomeMap() {
  return programHomes(await all('SELECT program_id, latitude, longitude FROM venues WHERE is_active = 1'));
}

// Checks one proposed placement for a game.
//   game:     a row from getGame()
//   target:   { courtId, date, startTime, endTime }
//   excludeIds: games being moved together (e.g. both halves of a swap)
// Returns { errors[], warnings[], flip, slotId, travelMiles }. "flip" means
// the court belongs to the away team's program, so home/away swap.
export async function checkPlacement(game, target, { excludeIds = [], rules, today = null } = {}) {
  rules ||= await runRules(game.runId);
  const errors = [];
  const warnings = [];
  const exclude = [...new Set([game.id, ...excludeIds])];
  const ph = exclude.map(() => '?').join(',');

  const court = await one(`SELECT c.id, c.name, v.id AS venue_id, v.name AS venue_name, v.program_id, v.latitude, v.longitude, v.is_active
    FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ?`, [target.courtId]);
  if (!court) return { errors: ['That court no longer exists.'], warnings };
  if (!court.isActive) errors.push(`${court.venueName} is inactive.`);

  let flip = false;
  if (court.programId === game.homeProgramId) flip = false;
  else if (court.programId === game.awayProgramId) flip = true;
  else return { errors: [`${court.venueName} doesn’t belong to either team’s program.`], warnings };
  const home = flip ? { id: game.awayTeamId, name: game.awayTeamName, programId: game.awayProgramId } : { id: game.homeTeamId, name: game.homeTeamName, programId: game.homeProgramId };
  const away = flip ? { id: game.homeTeamId, name: game.homeTeamName, programId: game.homeProgramId } : { id: game.awayTeamId, name: game.awayTeamName, programId: game.awayProgramId };

  const season = await one('SELECT * FROM seasons WHERE id = ?', [game.seasonId]);
  if (target.date < season.startDate || target.date > season.endDate) errors.push(`That date is outside the ${season.name} season.`);
  if (today && target.date < today) errors.push('That date has already passed.');
  if (toMinutes(target.endTime) - toMinutes(target.startTime) < rules.gameMinutes) warnings.push(`That’s shorter than the ${rules.gameMinutes}-minute game length.`);

  const slotRow = await one(`SELECT s.id, s.reserved_divisions, s.reserved_mode
    FROM gym_slots s
    WHERE s.court_id = ? AND s.date = ? AND s.category IN ${CAT_SQL}
    AND s.start_time <= ? AND s.end_time >= ? LIMIT 1`, [court.id, target.date, target.startTime, target.endTime]);
  const slot = slotRow ? withReservations([slotRow], await allDivisions())[0] : null;
  if (!slot) errors.push(`${court.venueName} – ${court.name} has no open game slot covering that time.`);
  else {
    // Day preferences: a slot tagged for other games.
    const fit = reservationFit(slot, game.divisionId, game.divisionGender);
    if (fit === 'only-other') errors.push(`That slot is kept for ${reservationLabel(slot)} games only.`);
    else if (fit === 'prefer-other') warnings.push(`That slot is a ${reservationLabel(slot)} priority slot.`);
  }

  const venueBlackout = await one(`SELECT reason FROM blackout_dates WHERE program_id = ? AND (venue_id IS NULL OR venue_id = ?)
    AND ? BETWEEN start_date AND end_date LIMIT 1`, [court.programId, court.venueId, target.date]);
  if (venueBlackout) errors.push(`${court.venueName} is blacked out that day (${venueBlackout.reason}).`);
  const progBlackout = await one(`SELECT b.reason, p.name FROM blackout_dates b JOIN programs p ON p.id = b.program_id
    WHERE b.venue_id IS NULL AND b.program_id IN (?, ?) AND b.program_id != ? AND ? BETWEEN b.start_date AND b.end_date LIMIT 1`,
  [home.programId, away.programId, court.programId, target.date]);
  if (progBlackout) errors.push(`${progBlackout.name} is blacked out that day (${progBlackout.reason}).`);

  const courtClash = await one(`SELECT start_time, end_time FROM games WHERE run_id = ? AND status = 'scheduled' AND court_id = ? AND date = ?
    AND start_time < ? AND end_time > ? AND id NOT IN (${ph}) LIMIT 1`,
  [game.runId, court.id, target.date, target.endTime, target.startTime, ...exclude]);
  if (courtClash) errors.push(`Another game is already on that court at ${formatTime12(courtClash.startTime)}.`);
  else if (rules.bufferMinutes) {
    // Not overlapping, but closer than the buffer to a game before or after it.
    const buf = rules.bufferMinutes;
    const near = await one(`SELECT start_time, end_time FROM games WHERE run_id = ? AND status = 'scheduled' AND court_id = ? AND date = ?
      AND start_time < ? AND end_time > ? AND id NOT IN (${ph}) LIMIT 1`,
    [game.runId, court.id, target.date, addMinutes(target.endTime, buf), addMinutes(target.startTime, -buf), ...exclude]);
    if (near) warnings.push(`That leaves less than the ${buf}-minute buffer next to the ${formatTime12(near.startTime)} game on that court.`);
  }

  for (const t of [home, away]) {
    const tg = await all(`SELECT date FROM games WHERE run_id = ? AND status = 'scheduled' AND (home_team_id = ? OR away_team_id = ?)
      AND id NOT IN (${ph})`, [game.runId, t.id, t.id, ...exclude]);
    errors.push(...teamProblems(t.name, tg, target.date, rules).map((p) => `${p}.`));
  }

  const homes = await programHomeMap();
  const travelMiles = milesBetween({ lat: court.latitude, lng: court.longitude }, homes[away.programId]);
  // The traveling (away) program's cap: its own lower cap if it has one.
  const cap = travelCapFor(rules, away.programId);
  if (travelMiles != null && travelMiles > cap) {
    warnings.push(`${away.name} would travel ${travelMiles} miles (${hasTravelOverride(rules, away.programId) ? `its program’s own cap is ${cap}` : `cap ${cap}`}).`);
  }

  return { errors, warnings, flip, slotId: slot?.id || null, travelMiles, court };
}

// Every open window at either team's programs where this game could go,
// already filtered by the same rules as checkPlacement (done in memory so
// it's one pass instead of a query per window).
export async function placementOptions(game, { today = null, limit = 150 } = {}) {
  const rules = await runRules(game.runId);
  const season = await one('SELECT * FROM seasons WHERE id = ?', [game.seasonId]);
  const from = today && today > season.startDate ? today : season.startDate;
  const programIds = [...new Set([game.homeProgramId, game.awayProgramId])];
  const pph = programIds.map(() => '?').join(',');

  const slots = await all(`SELECT g.id, g.program_id, g.court_id, g.date, g.start_time, g.end_time, g.category,
      g.reserved_divisions, g.reserved_mode,
      c.name AS court_name, v.id AS venue_id, v.name AS venue_name, v.latitude, v.longitude
    FROM gym_slots g JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id
    WHERE g.program_id IN (${pph}) AND g.season_id = ? AND g.category IN ${CAT_SQL} AND v.is_active = 1 AND g.date BETWEEN ? AND ?
      AND NOT EXISTS (SELECT 1 FROM blackout_dates b WHERE b.program_id = g.program_id
        AND (b.venue_id IS NULL OR b.venue_id = v.id) AND g.date BETWEEN b.start_date AND b.end_date)
    ORDER BY g.date, g.start_time`, [...programIds, season.id, from, season.endDate]);
  const windows = carveWindows(withReservations(slots, await allDivisions()), rules.gameMinutes, rules.bufferMinutes);

  const progBlackouts = await all(`SELECT program_id, start_date, end_date FROM blackout_dates WHERE venue_id IS NULL AND program_id IN (${pph})`, programIds);
  const blockedDay = (date) => progBlackouts.some((b) => date >= b.startDate && date <= b.endDate);

  const runGames = await all(`SELECT id, court_id, date, start_time, end_time, home_team_id, away_team_id FROM games
    WHERE run_id = ? AND status = 'scheduled' AND id != ?`, [game.runId, game.id]);
  const busy = new Set(runGames.map((g) => `${g.courtId}|${g.date}`));
  // Busy: another game overlaps the window, or is closer than the buffer to it.
  const buf = rules.bufferMinutes || 0;
  const courtBusy = (w) => busy.has(`${w.courtId}|${w.date}`) && runGames.some((g) => g.courtId === w.courtId && g.date === w.date
    && g.startTime < addMinutes(w.endTime, buf) && g.endTime > addMinutes(w.startTime, -buf));
  const gamesOf = (teamId) => runGames.filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId);
  const homeGames = gamesOf(game.homeTeamId);
  const awayGames = gamesOf(game.awayTeamId);
  const homes = await programHomeMap();

  const options = [];
  for (const w of windows) {
    if (w.date === game.date && w.startTime === game.startTime && w.courtId === game.courtId) continue; // where it already is
    if (blockedDay(w.date) || courtBusy(w)) continue;
    const fit = reservationFit(w, game.divisionId, game.divisionGender);
    if (fit === 'only-other') continue; // kept for other games
    if (teamProblems(game.homeTeamName, homeGames, w.date, rules).length) continue;
    if (teamProblems(game.awayTeamName, awayGames, w.date, rules).length) continue;
    const flip = w.programId !== game.homeProgramId;
    const awayProgram = flip ? game.homeProgramId : game.awayProgramId;
    const travelMiles = milesBetween(w, homes[awayProgram]);
    const cap = travelCapFor(rules, awayProgram);
    options.push({ ...w, flip, travelMiles, travelCap: cap, overTravelCap: travelMiles != null && travelMiles > cap, reserved: reservationText(w), reservedFit: fit });
    if (options.length >= limit) break;
  }
  return { options, rules };
}

// The UPDATE that moves a game into a checked placement (flipping home/away
// when the court belongs to the away team's program).
export function placementUpdate(game, target, check) {
  const home = check.flip ? game.awayTeamId : game.homeTeamId;
  const away = check.flip ? game.homeTeamId : game.awayTeamId;
  return {
    sql: `UPDATE games SET court_id = ?, gym_slot_id = ?, date = ?, start_time = ?, end_time = ?, home_team_id = ?, away_team_id = ?,
          travel_miles = ?, status = 'scheduled', note = NULL, updated_at = datetime('now') WHERE id = ?`,
    args: [target.courtId, check.slotId, target.date, target.startTime, target.endTime, home, away, check.travelMiles, game.id],
  };
}

// "Today" in the league's time zone (see utils/leagueTime.js), not UTC.
export const todayStr = () => leagueToday();

export const describeGame = (g) => `${g.homeTeamName} vs ${g.awayTeamName}${g.date ? ` on ${g.date} at ${formatTime12(g.startTime)}` : ''}`;

export async function activeSeason() {
  return one('SELECT * FROM seasons WHERE is_active = 1');
}

export async function publishedRun(seasonId) {
  return one("SELECT * FROM schedule_runs WHERE season_id = ? AND status = 'published'", [seasonId]);
}

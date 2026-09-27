// Adding a game by hand (System Admin) or by request (coach / director).
//
// A new game is checked in two parts:
//   1. The pairing (opponent rules): same division, not two teams from one
//      program (unless the league allows it), and under the rematch limit
//      (with any division override). A System Admin may break these on
//      purpose, as an EXCEPTION with a reason; a request never can.
//   2. The placement: exactly the same checks as moving a game (court free,
//      open game slot, blackouts, days between games, games per week,
//      travel). These are never bypassed; times are picked from a list that
//      already passes them.
import { one, all } from '../db/client.js';
import { rulesForDivision } from './core.js';
import { runRules, checkPlacement, placementOptions } from './data.js';

// Placeholder id for a game that doesn't exist yet. It must be a real string:
// the placement checks exclude "this game" with `id NOT IN (...)`, and NULL
// there would match nothing.
export const NEW_GAME_ID = '__new_game__';

const TEAM_SELECT = `SELECT t.id, t.name, t.program_id, t.division_id, t.head_coach_user_id AS coach_id, t.is_active,
    d.name AS division_name, d.sort_order AS division_sort, d.is_active AS division_active, d.gender AS division_gender,
    p.name AS program_name, p.short_code AS program_code, p.is_active AS program_active, p.is_guest
  FROM teams t JOIN divisions d ON d.id = t.division_id JOIN programs p ON p.id = t.program_id`;

export async function getTeam(id) {
  return id ? one(`${TEAM_SELECT} WHERE t.id = ?`, [id]) : null;
}

// Every active team, with how many league games it has in this schedule
// (games against guests are counted separately: they don't count toward the
// games-per-team target).
export async function teamsForRun(runId) {
  const [teams, ctx] = await Promise.all([
    all(`${TEAM_SELECT} WHERE t.is_active = 1 AND d.is_active = 1 AND p.is_active = 1
      ORDER BY p.is_guest, d.sort_order, d.name, t.name COLLATE NOCASE`),
    pairingContext(runId),
  ]);
  return teams.map((t) => ({ ...t, isGuest: !!t.isGuest, games: ctx.games(t.id), guestGames: ctx.guestGames(t.id) }));
}

// A game-shaped object for a game that doesn't exist yet, so the placement
// checks (which take a game) can be reused as they are.
export function virtualGame(run, home, away, placement = {}) {
  return {
    id: NEW_GAME_ID, runId: run.id, seasonId: run.seasonId, status: 'scheduled',
    divisionId: home.divisionId, divisionGender: home.divisionGender, divisionName: home.divisionId === away.divisionId ? home.divisionName : `${home.divisionName} / ${away.divisionName}`,
    homeTeamId: home.id, homeTeamName: home.name, homeProgramId: home.programId, homeProgramName: home.programName, homeCoachId: home.coachId,
    awayTeamId: away.id, awayTeamName: away.name, awayProgramId: away.programId, awayProgramName: away.programName, awayCoachId: away.coachId,
    date: null, startTime: null, endTime: null, courtId: null,
    hasScore: false, hasOpenRequest: false, isAdded: true,
    homeIsGuest: !!home.isGuest, awayIsGuest: !!away.isGuest, isGuestGame: !!(home.isGuest || away.isGuest),
    ...placement,
  };
}

// Games per team and meetings per pair in a run, from one query, so checking
// every possible opponent doesn't cost a query each (it matters on Turso).
// games(id) counts league games only; guestGames(id) counts games against guests.
export async function pairingContext(runId) {
  const rows = await all(`SELECT g.home_team_id, g.away_team_id, (hp.is_guest OR ap.is_guest) AS guest
    FROM games g JOIN teams ht ON ht.id = g.home_team_id JOIN programs hp ON hp.id = ht.program_id
    JOIN teams at ON at.id = g.away_team_id JOIN programs ap ON ap.id = at.program_id
    WHERE g.run_id = ? AND g.status != 'cancelled'`, [runId]);
  const counts = new Map();
  const guestCounts = new Map();
  const pairs = new Map();
  const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const g of rows) {
    const bucket = g.guest ? guestCounts : counts;
    for (const t of [g.homeTeamId, g.awayTeamId]) bucket.set(t, (bucket.get(t) || 0) + 1);
    pairs.set(key(g.homeTeamId, g.awayTeamId), (pairs.get(key(g.homeTeamId, g.awayTeamId)) || 0) + 1);
  }
  return { games: (id) => counts.get(id) || 0, guestGames: (id) => guestCounts.get(id) || 0, meetings: (a, b) => pairs.get(key(a, b)) || 0 };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// Opponent-rule problems for pairing team with opponent in this run.
//   errors:     never allowed (inactive team, a team against itself)
//   exceptions: league rules this game would break (a System Admin may add
//               it anyway, with a reason; a request can't)
//   warnings:   worth knowing, never blocking (over the games-per-team target)
export async function pairingCheck(run, team, opponent, { rules = null, ctx = null } = {}) {
  rules ||= await runRules(run.id);
  ctx ||= await pairingContext(run.id);
  const errors = [];
  const exceptions = [];
  const warnings = [];
  if (!team || !opponent) return { errors: ['Choose both teams.'], exceptions, warnings, meetings: 0 };
  if (team.id === opponent.id) return { errors: ['A team can’t play itself.'], exceptions, warnings, meetings: 0 };
  for (const t of [team, opponent]) {
    if (!t.isActive || !t.divisionActive || !t.programActive) errors.push(`${t.name} isn’t active.`);
  }
  if (team.isGuest && opponent.isGuest) errors.push('Two guest teams can’t play each other. A guest game needs a league team.');
  if (team.divisionId !== opponent.divisionId) {
    exceptions.push(`Different divisions (${team.divisionName} and ${opponent.divisionName}).`);
  }
  if (!rules.allowSameProgram && team.programId === opponent.programId) {
    exceptions.push(`Both teams are from ${team.programName}, and teams from the same program don’t play each other.`);
  }
  const meetings = ctx.meetings(team.id, opponent.id);
  const limit = rulesForDivision(rules, team.divisionId).maxVsSameOpponent;
  if (limit != null && meetings >= limit) {
    exceptions.push(`They already play ${plural(meetings, 'time')}; the limit is ${plural(limit, 'game')} against the same opponent.`);
  }
  // Games against guests don't count toward the target, so only warn for league games.
  if (!team.isGuest && !opponent.isGuest) {
    for (const t of [team, opponent]) {
      const n = ctx.games(t.id);
      if (n >= rules.gamesPerTeam) warnings.push(`${t.name} will have ${n + 1} games (target ${rules.gamesPerTeam}).`);
    }
  }
  return { errors, exceptions, warnings, meetings };
}

// Open times for the new game at either team's programs, filtered by every
// placement rule. `team` is listed as home; an option at the opponent's gym
// has flip = true (the opponent hosts).
export async function addOptions(run, team, opponent, { today = null } = {}) {
  return placementOptions(virtualGame(run, team, opponent), { today });
}

// Checks a chosen time for the new game. Returns checkPlacement's result plus
// the home and away team once the court decides who hosts.
export async function checkAddPlacement(run, team, opponent, target, { today = null } = {}) {
  const game = virtualGame(run, team, opponent);
  const check = await checkPlacement(game, target, { today });
  const [home, away] = check.flip ? [opponent, team] : [team, opponent];
  return { ...check, home, away };
}

// The INSERT for a new game.
export function insertGame({ id, run, home, away, target = null, check = null, userId, reason, exceptionNote }) {
  return {
    sql: `INSERT INTO games (id, run_id, season_id, division_id, home_team_id, away_team_id, court_id, gym_slot_id, date, start_time, end_time,
            status, travel_miles, note, added_by, added_at, added_reason, exception_note)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
    args: [id, run.id, run.seasonId, home.divisionId, home.id, away.id, target?.courtId ?? null, check?.slotId ?? null,
      target?.date ?? null, target?.startTime ?? null, target?.endTime ?? null, target ? 'scheduled' : 'unscheduled',
      check?.travelMiles ?? null, target ? null : 'Added by hand; not placed yet.', userId, reason || null, exceptionNote || null],
  };
}

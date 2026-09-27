import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, isSuperAdmin } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { assertDate, assertTime, isValidDate, formatTime12 } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';
import { normalizeRules } from '../scheduling/core.js';
import {
  getRules, saveRules, divisionNameMap, programNameMap, generateDraft, GAME_SELECT, GAME_ORDER, shapeGame, getGame,
  checkPlacement, placementOptions, placementUpdate, todayStr, describeGame, activeSeason, publishedRun,
} from '../scheduling/data.js';
import { onGamesChanged, syncSlots, carryOverAssignments, upcomingAssignmentCount, leagueNow, notifyUsers } from '../referees/data.js';
import { config } from '../config.js';
import { toMinutes } from '../scheduling/core.js';
import { getTeam, teamsForRun, pairingCheck, pairingContext, addOptions, checkAddPlacement, insertGame } from '../scheduling/addGame.js';
import { runRules } from '../scheduling/data.js';
import { reviewState, shareDraft, draftChanged, deadlinePassed, gameLabel, REVIEW_LABELS } from '../scheduling/review.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);
const adminOnly = requireRole('super_admin');

const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const shapeRun = (r) => r && ({ ...r, rules: parseJson(r.rules, {}), summary: parseJson(r.summary, null), warnings: parseJson(r.warnings, []), publishOverride: parseJson(r.publishOverride, null) });

async function requireSeason() {
  const s = await activeSeason();
  if (!s) throw conflict('No season is active. Set one up under League setup first.');
  return s;
}

// Who may ask for a change to this game (Module D): a coach of either
// team, or the Program Director of either team's program. Admins edit
// directly instead of requesting.
export function canRequestFor(user, game) {
  if (user.role === 'league_coach') return [game.homeCoachId, game.awayCoachId].includes(user.id);
  if (user.role === 'program_director') return [game.homeProgramId, game.awayProgramId].includes(user.programId);
  return false;
}

// ---------------------------------------------------------------------
// Final scores: a coach of either team, either team's Program Director, or a
// System Admin, from tip-off on game day onward (any time in demo mode).
// ---------------------------------------------------------------------
export function canScoreFor(user, game) {
  if (isSuperAdmin(user)) return true;
  if (user.role === 'league_coach') return [game.homeCoachId, game.awayCoachId].includes(user.id);
  if (user.role === 'program_director') return [game.homeProgramId, game.awayProgramId].includes(user.programId);
  return false;
}
export function scoringOpen(game, now = leagueNow()) {
  if (game.status !== 'scheduled' || !game.date) return false;
  if (config.demoCheckInAnytime) return true;
  return game.date < now.date || (game.date === now.date && now.minutes >= toMinutes(game.startTime));
}
// Played (tip-off has passed), regardless of demo mode: what "needs a score" means.
export const hasBeenPlayed = (g, now = leagueNow()) => g.status === 'scheduled' && !!g.date && (g.date < now.date || (g.date === now.date && now.minutes >= toMinutes(g.startTime)));
const scoreLine = (g, home = g.homeScore, away = g.awayScore) => `${g.homeTeamName} ${home} – ${away} ${g.awayTeamName}`;

async function loadGameFor(req, { requireEditable = false } = {}) {
  const game = await getGame(req.params.id);
  if (!game) throw notFound('Game');
  const runRow = await one('SELECT status FROM schedule_runs WHERE id = ?', [game.runId]);
  game.runStatus = runRow.status;
  if (runRow.status !== 'published' && !isSuperAdmin(req.user)) throw notFound('Game'); // drafts are admin-only
  if (requireEditable && runRow.status === 'superseded') throw conflict('That game belongs to an older schedule that has been replaced.');
  return game;
}

// ---------------------------------------------------------------------
// Rules (System Admin)
// ---------------------------------------------------------------------
router.get('/rules', adminOnly, ah(async (req, res) => res.json({ rules: await getRules() })));

// Validate rules from the browser, including division overrides (which must
// name divisions that exist).
async function cleanRules(input) {
  const [divisionNames, programNames] = await Promise.all([divisionNameMap(), programNameMap()]);
  try { return { rules: normalizeRules(input || {}, { divisionNames, programNames }), divisionNames, programNames }; }
  catch (e) { throw badRequest(e.message); }
}
const limitText = (v) => (v == null ? 'no limit' : `at most ${v} game${v === 1 ? '' : 's'}`);
function overridesText(rules, divisionNames, programNames = {}) {
  const list = Object.entries(rules.divisionOverrides || {})
    .map(([id, o]) => `${divisionNames[id] || 'a division'}: ${limitText(o.maxVsSameOpponent)} against the same opponent`);
  const plist = Object.entries(rules.programOverrides || {})
    .map(([id, o]) => `${programNames[id] || 'a program'}: ${o.maxTravelMiles}-mile travel cap`);
  return (list.length ? `; division overrides — ${list.join(', ')}` : '') + (plist.length ? `; program overrides — ${plist.join(', ')}` : '');
}

router.put('/rules', adminOnly, ah(async (req, res) => {
  const { rules, divisionNames, programNames } = await cleanRules(req.body);
  await saveRules(rules);
  await logActivity({ category: 'schedule', action: 'rules', actor: req.user, details: `Updated schedule rules: ${rules.gamesPerTeam} games per team, ${rules.gameMinutes}-minute games, ${rules.maxTravelMiles}-mile travel cap${overridesText(rules, divisionNames, programNames)}` });
  res.json({ rules });
}));

// ---------------------------------------------------------------------
// Overview for the Schedule builder (System Admin)
// ---------------------------------------------------------------------
router.get('/overview', adminOnly, ah(async (req, res) => {
  const season = await activeSeason();
  if (!season) return res.json({ season: null });
  const [draft, published, openRequests] = await Promise.all([
    one("SELECT * FROM schedule_runs WHERE season_id = ? AND status = 'draft' ORDER BY created_at DESC LIMIT 1", [season.id]),
    publishedRun(season.id),
    one("SELECT COUNT(*) AS n FROM change_requests WHERE status IN ('pending_director', 'pending_counterpart', 'pending_admin')"),
  ]);
  const assignedAhead = published ? await upcomingAssignmentCount(published.id, leagueNow().date) : 0;
  const divisions = (await all('SELECT id, name, is_active FROM divisions ORDER BY sort_order, name'))
    .map((d) => ({ id: d.id, name: d.name, isActive: !!d.isActive }));
  // League programs, for program overrides (guests have no gyms, so no travel cap).
  const programs = (await all('SELECT id, name, short_code, is_active FROM programs WHERE is_guest = 0 ORDER BY name COLLATE NOCASE'))
    .map((p) => ({ id: p.id, name: p.name, shortCode: p.shortCode, isActive: !!p.isActive }));
  res.json({ season, rules: await getRules(), divisions, programs, draft: shapeRun(draft), published: shapeRun(published), openRequests: Number(openRequests.n), assignedAhead });
}));

// ---------------------------------------------------------------------
// Generate a new draft (replaces any existing draft)
// ---------------------------------------------------------------------
router.post('/generate', adminOnly, ah(async (req, res) => {
  const season = await requireSeason();
  let rules = await getRules();
  let divisionNames = null;
  let programNames = null;
  if (req.body?.rules) {
    ({ rules, divisionNames, programNames } = await cleanRules(req.body.rules));
    await saveRules(rules);
  }
  const started = Date.now();
  const result = await generateDraft(season, rules, req.user.id);
  divisionNames ||= await divisionNameMap();
  programNames ||= await programNameMap();
  await logActivity({ category: 'schedule', action: 'generated', actor: req.user,
    details: `Generated a draft schedule for ${season.name}: ${result.summary.scheduledGames} games placed, ${result.summary.unscheduledGames} unplaced${overridesText(rules, divisionNames, programNames)}` });
  const draft = await one('SELECT * FROM schedule_runs WHERE id = ?', [result.runId]);
  res.status(201).json({ draft: shapeRun(draft), ms: Date.now() - started });
}));

// ---------------------------------------------------------------------
// Games in a run (drafts: admin only; published: everyone)
// ---------------------------------------------------------------------
function gameFilters(q, where, args) {
  if (q.divisionId) { where.push('g.division_id = ?'); args.push(q.divisionId); }
  if (q.programId) { where.push('(ht.program_id = ? OR at.program_id = ?)'); args.push(q.programId, q.programId); }
  if (q.teamId) { where.push('(g.home_team_id = ? OR g.away_team_id = ?)'); args.push(q.teamId, q.teamId); }
  if (q.status && ['scheduled', 'unscheduled', 'cancelled'].includes(q.status)) { where.push('g.status = ?'); args.push(q.status); }
  if (isValidDate(q.from)) { where.push('g.date >= ?'); args.push(q.from); }
  if (isValidDate(q.to)) { where.push('g.date <= ?'); args.push(q.to); }
}

router.get('/runs/:id/games', adminOnly, ah(async (req, res) => {
  const r = await one('SELECT * FROM schedule_runs WHERE id = ?', [req.params.id]);
  if (!r) throw notFound('Schedule');
  const where = ['g.run_id = ?'];
  const args = [r.id];
  gameFilters(req.query, where, args);
  const games = await all(`${GAME_SELECT} WHERE ${where.join(' AND ')} ${GAME_ORDER}`, args);
  res.json({ run: shapeRun(r), games: games.map(shapeGame) });
}));

// The published schedule for the active season. ?mine=1 narrows to the
// signed-in coach's teams or director's program.
router.get('/games', ah(async (req, res) => {
  const season = await activeSeason();
  const pub = season && await publishedRun(season.id);
  if (!pub) return res.json({ published: false, games: [] });
  const where = ['g.run_id = ?', "g.status != 'unscheduled'"];
  const args = [pub.id];
  gameFilters(req.query, where, args);
  if (req.query.mine === '1') {
    if (req.user.role === 'league_coach') { where.push('(ht.head_coach_user_id = ? OR at.head_coach_user_id = ?)'); args.push(req.user.id, req.user.id); }
    else if (req.user.programId) { where.push('(ht.program_id = ? OR at.program_id = ?)'); args.push(req.user.programId, req.user.programId); }
  }
  const games = await all(`${GAME_SELECT} WHERE ${where.join(' AND ')} ${GAME_ORDER}`, args);
  const today = todayStr();
  res.json({
    published: true, publishedAt: pub.publishedAt, season,
    games: games.map((g) => ({ ...shapeGame(g), canRequest: g.status === 'scheduled' && g.date >= today && !hasBeenPlayed(g) && !shapeGame(g).hasScore && canRequestFor(req.user, g), canScore: scoringOpen(g) && canScoreFor(req.user, g),
      needsScore: !shapeGame(g).hasScore && hasBeenPlayed(g) && canScoreFor(req.user, g) })),
  });
}));

router.get('/games/:id', ah(async (req, res) => {
  const game = await loadGameFor(req);
  res.json({ game: { ...game, canRequest: game.runStatus === 'published' && game.status === 'scheduled' && game.date >= todayStr() && !hasBeenPlayed(game) && !game.hasScore && canRequestFor(req.user, game),
    canScore: game.runStatus === 'published' && scoringOpen(game) && canScoreFor(req.user, game) } });
}));

// Open windows this game could move to. Admins see every window in the
// season (they can fix the past); requesters only future ones.
router.get('/games/:id/options', ah(async (req, res) => {
  const game = await loadGameFor(req, { requireEditable: true });
  if (!isSuperAdmin(req.user) && !canRequestFor(req.user, game)) throw forbidden('You can only request changes to your own teams’ games.');
  const today = isSuperAdmin(req.user) && game.runStatus === 'draft' ? null : todayStr();
  const { options, rules } = await placementOptions(game, { today });
  res.json({ options, rules });
}));

// Other games this one could trade date/time/court with. Both halves of the
// swap are checked against every rule.
router.get('/games/:id/swap-options', ah(async (req, res) => {
  const game = await loadGameFor(req, { requireEditable: true });
  if (!isSuperAdmin(req.user) && !canRequestFor(req.user, game)) throw forbidden('You can only request changes to your own teams’ games.');
  if (game.status !== 'scheduled') return res.json({ options: [] });
  const today = game.runStatus === 'draft' ? '0000-00-00' : todayStr();
  const mine = [game.homeProgramId, game.awayProgramId];
  // Candidate must be hostable by this game's programs and vice versa.
  const candidates = await all(`${GAME_SELECT}
    WHERE g.run_id = ? AND g.status = 'scheduled' AND g.id != ? AND g.date >= ?
      AND v.program_id IN (?, ?) AND ? IN (ht.program_id, at.program_id)
    ORDER BY (g.home_team_id IN (?, ?) OR g.away_team_id IN (?, ?)) DESC, ABS(julianday(g.date) - julianday(?)) LIMIT 60`,
  [game.runId, game.id, today, ...mine, game.venueProgramId, game.homeTeamId, game.awayTeamId, game.homeTeamId, game.awayTeamId, game.date]);
  const options = [];
  for (const c of candidates.map(shapeGame)) {
    if (c.hasOpenRequest || c.hasScore || hasBeenPlayed(c)) continue;
    // Requesters may only swap with games they could request on themselves.
    if (!isSuperAdmin(req.user) && !canRequestFor(req.user, c)) continue;
    const a = await checkPlacement(game, { courtId: c.courtId, date: c.date, startTime: c.startTime, endTime: c.endTime }, { excludeIds: [c.id] });
    if (a.errors.length) continue;
    const b = await checkPlacement(c, { courtId: game.courtId, date: game.date, startTime: game.startTime, endTime: game.endTime }, { excludeIds: [game.id] });
    if (b.errors.length) continue;
    options.push({ game: c, warnings: [...a.warnings, ...b.warnings] });
    if (options.length >= 15) break;
  }
  res.json({ options });
}));

// ---------------------------------------------------------------------
// Adding a game (System Admin: directly; coach / director: by request)
// ---------------------------------------------------------------------
// Which schedule an add is for. A System Admin names it (?runId=, draft or
// published); everyone else works on the published schedule.
async function addRunFor(req, runId = req.query.runId) {
  let r;
  if (isSuperAdmin(req.user) && runId) r = await one('SELECT * FROM schedule_runs WHERE id = ?', [runId]);
  else {
    const season = await activeSeason();
    r = season && await publishedRun(season.id);
  }
  if (!r) throw notFound('Schedule');
  if (!['draft', 'published'].includes(r.status)) throw conflict('That schedule has been replaced. Add games to the current one.');
  return r;
}
// Teams a coach or director may add a game for (a System Admin: any).
export const canAddFor = (user, team) => isSuperAdmin(user)
  || (user.role === 'league_coach' && team.coachId === user.id)
  || (user.role === 'program_director' && team.programId === user.programId);
const requesterOnly = (req) => {
  if (!isSuperAdmin(req.user) && !['program_director', 'league_coach'].includes(req.user.role)) throw forbidden('Only coaches, directors, and the league can add games.');
};
async function teamFor(req, id, label = 'Team') {
  const t = await getTeam(id);
  if (!t) throw notFound(label);
  return t;
}

// GET /api/schedule/add-game/teams?runId= — every active team with its game
// count, plus which ones the signed-in user may add a game for.
router.get('/add-game/teams', ah(async (req, res) => {
  requesterOnly(req);
  const r = await addRunFor(req);
  const rules = await runRules(r.id);
  const teams = await teamsForRun(r.id);
  res.json({ run: { id: r.id, status: r.status }, gamesPerTeam: rules.gamesPerTeam,
    teams: teams.map((t) => ({ id: t.id, name: t.name, divisionId: t.divisionId, divisionName: t.divisionName, programId: t.programId, programName: t.programName,
      isGuest: t.isGuest, games: t.games, guestGames: t.guestGames, mine: canAddFor(req.user, t) })) });
}));

// GET /api/schedule/add-game/opponents?runId=&teamId= — possible opponents.
// A System Admin sees every team, each with the rules it would be an
// exception to; a coach or director sees only opponents within the rules.
router.get('/add-game/opponents', ah(async (req, res) => {
  requesterOnly(req);
  const r = await addRunFor(req);
  const team = await teamFor(req, req.query.teamId);
  if (!canAddFor(req.user, team)) throw forbidden('You can only add games for your own teams.');
  const [rules, ctx, teams] = await Promise.all([runRules(r.id), pairingContext(r.id), teamsForRun(r.id)]);
  const opponents = [];
  for (const o of teams) {
    if (o.id === team.id) continue;
    const c = await pairingCheck(r, team, o, { rules, ctx });
    if (c.errors.length) continue;
    if (!isSuperAdmin(req.user) && c.exceptions.length) continue;
    opponents.push({ id: o.id, name: o.name, divisionId: o.divisionId, divisionName: o.divisionName, programName: o.programName, isGuest: o.isGuest,
      games: o.games, meetings: c.meetings, sameDivision: o.divisionId === team.divisionId, exceptions: c.exceptions });
  }
  // Same division first, league teams before guests, then fewest meetings so far.
  opponents.sort((a, b) => Number(b.sameDivision) - Number(a.sameDivision) || a.exceptions.length - b.exceptions.length
    || Number(a.isGuest) - Number(b.isGuest) || a.meetings - b.meetings || a.name.localeCompare(b.name));
  res.json({ team: { id: team.id, name: team.name, divisionName: team.divisionName, isGuest: !!team.isGuest, games: ctx.games(team.id), guestGames: ctx.guestGames(team.id) }, gamesPerTeam: rules.gamesPerTeam, opponents });
}));

// GET /api/schedule/add-game/options?runId=&teamId=&opponentId= — open times
// for the new game, already filtered by every placement rule.
router.get('/add-game/options', ah(async (req, res) => {
  requesterOnly(req);
  const r = await addRunFor(req);
  const team = await teamFor(req, req.query.teamId);
  const opponent = await teamFor(req, req.query.opponentId, 'Opponent');
  if (!canAddFor(req.user, team)) throw forbidden('You can only add games for your own teams.');
  const check = await pairingCheck(r, team, opponent);
  if (check.errors.length) throw badRequest(check.errors[0]);
  if (!isSuperAdmin(req.user) && check.exceptions.length) throw conflict(`That game isn’t allowed: ${check.exceptions[0]}`);
  const today = isSuperAdmin(req.user) && r.status === 'draft' ? null : todayStr();
  const { options } = await addOptions(r, team, opponent, { today });
  res.json({ options, exceptions: check.exceptions, warnings: check.warnings });
}));

// POST /api/schedule/runs/:id/games — a System Admin adds a game.
//   { teamId, opponentId, courtId, date, startTime, endTime, reason, exception }
//   Leave out the time to add it to Unplaced (drafts only).
//   exception: true acknowledges the league rules it breaks; a reason is then required.
router.post('/runs/:id/games', adminOnly, ah(async (req, res) => {
  const r = await addRunFor(req, req.params.id);
  const b = req.body || {};
  const team = await teamFor(req, b.teamId);
  const opponent = await teamFor(req, b.opponentId, 'Opponent');
  const hasTime = b.courtId || b.date || b.startTime || b.endTime;
  if (!hasTime && r.status !== 'draft') throw badRequest('Choose a time for the game. Only a draft can hold unplaced games.');
  const pairing = await pairingCheck(r, team, opponent);
  if (pairing.errors.length) throw badRequest(pairing.errors[0]);
  const reason = typeof b.reason === 'string' ? b.reason.trim().slice(0, 300) : '';
  if (pairing.exceptions.length) {
    if (b.exception !== true) {
      throw conflict(`This game breaks a league rule: ${pairing.exceptions.join(' ')} Add it as an exception, with a reason, if it’s intended.`,
        { code: 'EXCEPTION_REQUIRED', exceptions: pairing.exceptions });
    }
    if (reason.length < 5) throw badRequest('Say why this game is an exception to the league rules (it’s kept with the game).');
  }
  let target = null;
  let check = null;
  let home = team;
  let away = opponent;
  if (hasTime) {
    assertDate(b.date); assertTime(b.startTime, 'Start time'); assertTime(b.endTime, 'End time');
    if (!b.courtId) throw badRequest('Choose a court.');
    if (b.startTime >= b.endTime) throw badRequest('End time must be after start time.');
    target = { courtId: b.courtId, date: b.date, startTime: b.startTime, endTime: b.endTime };
    check = await checkAddPlacement(r, team, opponent, target, { today: r.status === 'draft' ? null : todayStr() });
    if (check.errors.length) throw conflict(check.errors[0], { errors: check.errors, warnings: check.warnings });
    ({ home, away } = check);
  }
  const id = newId();
  const exceptionNote = pairing.exceptions.length ? pairing.exceptions.join(' ') : null;
  await db.execute(insertGame({ id, run: r, home, away, target, check, userId: req.user.id, reason, exceptionNote }));
  const game = await getGame(id);
  const where = target ? ` on ${target.date} ${target.startTime} at ${check.court.venueName} – ${check.court.name}` : ' (not placed yet)';
  const detail = `Added ${home.name} vs ${away.name}${where}${exceptionNote ? ` as an exception: ${exceptionNote}` : ''}${reason ? ` Reason: ${reason}` : ''}`;
  let referees = null;
  if (r.status === 'published') {
    await logActivity({ category: 'schedule', action: 'added', actor: req.user, programId: home.programId, programIds: [home.programId, away.programId], details: detail });
    referees = await onGamesChanged([id], req.user); // gives the new game its referee slots
    // Both programs' directors and both coaches hear about a new game.
    await notifyUsers("id != ? AND ((role = 'program_director' AND program_id IN (?, ?)) OR id IN (?, ?))",
      [req.user.id, home.programId, away.programId, home.coachId || '', away.coachId || ''],
      `Game added: ${home.name} vs ${away.name}`,
      `The league added a game to the schedule:\n${home.name} vs ${away.name}\n${game.date} at ${formatTime12(game.startTime)} · ${game.venueName} – ${game.courtName}${reason ? `\nReason: ${reason}` : ''}`);
  }
  // In a shared draft, both programs have to review again.
  if (r.status === 'draft') await draftChanged(r.id, [home.programId, away.programId], `${home.name} vs ${away.name} was added${where}.`, req.user);
  res.status(201).json({ game, warnings: [...pairing.warnings, ...(check?.warnings || [])], referees });
}));

// DELETE /api/schedule/games/:id — remove a pairing from a DRAFT. (On the
// published schedule, games are cancelled instead, so there's a record.)
router.delete('/games/:id', adminOnly, ah(async (req, res) => {
  const game = await loadGameFor(req, { requireEditable: true });
  if (game.runStatus !== 'draft') throw conflict('Games on the published schedule can’t be removed. Cancel the game instead, so there’s a record of it.');
  await run('DELETE FROM games WHERE id = ?', [game.id]);
  await draftChanged(game.runId, [game.homeProgramId, game.awayProgramId], `${gameLabel(game)} was removed from the draft.`, req.user);
  res.json({ ok: true, removed: { id: game.id, homeTeamName: game.homeTeamName, awayTeamName: game.awayTeamName } });
}));

// ---------------------------------------------------------------------
// Admin edits (draft or published). Body is one of:
//   { courtId, date, startTime, endTime }  move / place
//   { action: 'flip' }                     swap home and away
//   { action: 'unschedule' }               take it off the calendar
//   { action: 'cancel' } / { action: 'restore' }  (published games)
// ---------------------------------------------------------------------
router.put('/games/:id', adminOnly, ah(async (req, res) => {
  const game = await loadGameFor(req, { requireEditable: true });
  const b = req.body || {};
  let detail;
  let warnings = [];
  // A game with a final score can't be moved, unplaced, or cancelled; clear the score first.
  if (game.hasScore && b.action !== 'flip' && b.action !== 'restore') {
    throw conflict('This game has a final score. Clear the score before changing the game.');
  }
  if (b.action === 'flip') {
    // Scores belong to teams, so they swap along with home and away.
    await run(`UPDATE games SET home_team_id = away_team_id, away_team_id = home_team_id, home_score = away_score, away_score = home_score, updated_at = datetime('now') WHERE id = ?`, [game.id]);
    detail = `Swapped home/away: ${game.awayTeamName} now hosts ${game.homeTeamName}`;
  } else if (b.action === 'unschedule') {
    await run(`UPDATE games SET status = 'unscheduled', court_id = NULL, gym_slot_id = NULL, date = NULL, start_time = NULL, end_time = NULL,
      travel_miles = NULL, note = 'Removed from the calendar by an admin.', updated_at = datetime('now') WHERE id = ?`, [game.id]);
    detail = `Unscheduled ${describeGame(game)}`;
  } else if (b.action === 'cancel' || b.action === 'restore') {
    if (b.action === 'cancel' && game.status !== 'scheduled') throw badRequest('Only scheduled games can be cancelled.');
    if (b.action === 'restore' && game.status !== 'cancelled') throw badRequest('Only cancelled games can be restored.');
    if (b.action === 'restore') {
      const check = await checkPlacement(game, { courtId: game.courtId, date: game.date, startTime: game.startTime, endTime: game.endTime });
      if (check.errors.length) throw conflict(`Can’t restore: ${check.errors[0]}`, { errors: check.errors });
    }
    if (b.action === 'cancel') {
      // Why a game was called off is part of the record, so it's required.
      const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
      if (reason.length < 5) throw badRequest('Say why the game is being cancelled (it shows on the schedule).');
      await run(`UPDATE games SET status = 'cancelled', cancel_reason = ?, cancelled_by = ?, cancelled_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
        [reason.slice(0, 200), req.user.id, game.id]);
      detail = `Cancelled ${describeGame(game)}: ${reason.slice(0, 200)}`;
    } else {
      await run(`UPDATE games SET status = 'scheduled', cancel_reason = NULL, cancelled_by = NULL, cancelled_at = NULL, updated_at = datetime('now') WHERE id = ?`, [game.id]);
      detail = `Restored ${describeGame(game)}`;
    }
  } else {
    assertDate(b.date); assertTime(b.startTime, 'Start time'); assertTime(b.endTime, 'End time');
    if (!b.courtId) throw badRequest('Choose a court.');
    if (b.startTime >= b.endTime) throw badRequest('End time must be after start time.');
    const target = { courtId: b.courtId, date: b.date, startTime: b.startTime, endTime: b.endTime };
    const check = await checkPlacement(game, target);
    if (check.errors.length) throw conflict(check.errors[0], { errors: check.errors, warnings: check.warnings });
    await db.execute(placementUpdate(game, target, check));
    warnings = check.warnings;
    detail = `${game.status === 'unscheduled' ? 'Placed' : 'Moved'} ${game.homeTeamName} vs ${game.awayTeamName} to ${b.date} ${b.startTime} at ${check.court.venueName} – ${check.court.name}${check.flip ? ' (home/away swapped)' : ''}`;
  }
  let referees = null;
  if (game.runStatus === 'published') {
    // Both teams' programs see an admin's change to their game.
    await logActivity({ category: 'schedule', action: 'edited', actor: req.user, programId: game.homeProgramId, programIds: [game.homeProgramId, game.awayProgramId], details: detail });
    // Moves, cancels, and restores affect referee slots; a flip doesn't.
    if (b.action !== 'flip') referees = await onGamesChanged([game.id], req.user);
  } else {
    // A shared draft: the two teams' programs have to review again.
    await draftChanged(game.runId, [game.homeProgramId, game.awayProgramId], `${detail}.`, req.user);
  }
  res.json({ game: await getGame(game.id), warnings, referees });
}));

// PUT /api/schedule/games/:id/score  { homeScore, awayScore, note }
router.put('/games/:id/score', ah(async (req, res) => {
  const game = await loadGameFor(req, { requireEditable: true });
  if (game.runStatus !== 'published') throw conflict('Scores can only be entered on the published schedule.');
  if (!canScoreFor(req.user, game)) throw forbidden('Only the coaches and directors of the two teams, or the league, can enter this score.');
  if (game.status !== 'scheduled') throw conflict('This game isn’t being played, so it can’t have a score.');
  if (!scoringOpen(game)) throw conflict('Scores can be entered from tip-off on game day.');
  const score = (v, label) => {
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (!Number.isInteger(n) || n < 0 || n > 250) throw badRequest(`${label} must be a whole number from 0 to 250.`);
    return n;
  };
  const homeScore = score(req.body?.homeScore, `${game.homeTeamName}’s score`);
  const awayScore = score(req.body?.awayScore, `${game.awayTeamName}’s score`);
  const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim().slice(0, 120) : null;
  if (game.hasScore && game.homeScore === homeScore && game.awayScore === awayScore && (game.scoreNote || null) === note) {
    return res.json({ game: await getGame(game.id) }); // nothing changed
  }
  await run(`UPDATE games SET home_score = ?, away_score = ?, score_note = ?, score_entered_by = ?, score_entered_at = datetime('now'),
    updated_at = datetime('now') WHERE id = ?`, [homeScore, awayScore, note, req.user.id, game.id]);
  const line = scoreLine(game, homeScore, awayScore);
  const details = game.hasScore ? `Corrected the final score: ${line} (was ${game.homeScore} – ${game.awayScore})` : `Final score: ${line}`;
  await logActivity({ category: 'schedule', action: game.hasScore ? 'score corrected' : 'score', actor: req.user, programId: game.homeProgramId,
    programIds: [game.homeProgramId, game.awayProgramId], details: `${details}${note ? ` · ${note}` : ''}` });

  // Let the other side know, so a wrong score gets noticed. (A System Admin's entry tells both sides.)
  const mySide = isSuperAdmin(req.user) ? null
    : [game.homeCoachId, game.homeProgramId].includes(req.user.role === 'league_coach' ? req.user.id : req.user.programId) ? 'home' : 'away';
  const sides = mySide === 'home' ? ['away'] : mySide === 'away' ? ['home'] : ['home', 'away'];
  for (const side of sides) {
    const programId = side === 'home' ? game.homeProgramId : game.awayProgramId;
    const coachId = side === 'home' ? game.homeCoachId : game.awayCoachId;
    await notifyUsers("id != ? AND ((role = 'program_director' AND program_id = ?) OR id = ?)", [req.user.id, programId, coachId || ''],
      `${game.hasScore ? 'Score corrected' : 'Final score entered'}: ${game.homeTeamName} vs ${game.awayTeamName}`,
      `${req.user.firstName} ${req.user.lastName} ${game.hasScore ? 'corrected' : 'entered'} the final score for the ${game.date} game:\n${line}${note ? `\nNote: ${note}` : ''}\nIf it’s wrong, correct it on the Schedule page or contact the league.`);
  }
  res.json({ game: await getGame(game.id) });
}));

// DELETE /api/schedule/games/:id/score
router.delete('/games/:id/score', ah(async (req, res) => {
  const game = await loadGameFor(req, { requireEditable: true });
  if (!canScoreFor(req.user, game)) throw forbidden('Only the coaches and directors of the two teams, or the league, can clear this score.');
  if (!game.hasScore) return res.json({ game });
  await run(`UPDATE games SET home_score = NULL, away_score = NULL, score_note = NULL, score_entered_by = NULL, score_entered_at = NULL,
    updated_at = datetime('now') WHERE id = ?`, [game.id]);
  await logActivity({ category: 'schedule', action: 'score cleared', actor: req.user, programId: game.homeProgramId,
    programIds: [game.homeProgramId, game.awayProgramId], details: `Cleared the final score of ${game.homeTeamName} vs ${game.awayTeamName} on ${game.date} (was ${game.homeScore} – ${game.awayScore})` });
  res.json({ game: await getGame(game.id) });
}));

// ---------------------------------------------------------------------
// Draft sharing and director sign-off
// ---------------------------------------------------------------------
async function draftRun(id) {
  const r = await one('SELECT * FROM schedule_runs WHERE id = ?', [id]);
  if (!r) throw notFound('Schedule');
  if (r.status !== 'draft') throw conflict('Only a draft can be shared for review.');
  return r;
}
const readDeadline = (v) => {
  if (v === undefined || v === null || v === '') return null;
  assertDate(v, 'Deadline');
  if (v < leagueNow().date) throw badRequest('The deadline can’t be in the past.');
  return v;
};

// GET /api/schedule/runs/:id/review — each program's status and every flag.
router.get('/runs/:id/review', adminOnly, ah(async (req, res) => {
  const r = await one('SELECT * FROM schedule_runs WHERE id = ?', [req.params.id]);
  if (!r) throw notFound('Schedule');
  res.json({ review: await reviewState(r) });
}));

// POST /api/schedule/runs/:id/share  { deadline }  — share with directors
// (again on a shared draft: change the deadline).
router.post('/runs/:id/share', adminOnly, ah(async (req, res) => {
  const r = await draftRun(req.params.id);
  const deadline = readDeadline(req.body?.deadline);
  await shareDraft(r, { deadline, actor: req.user });
  res.json({ review: await reviewState(await one('SELECT * FROM schedule_runs WHERE id = ?', [r.id])) });
}));

// POST /api/schedule/runs/:id/review/:programId/sign-off  { note }
// The System Admin signs off for a program that has no active director.
router.post('/runs/:id/review/:programId/sign-off', adminOnly, ah(async (req, res) => {
  const r = await draftRun(req.params.id);
  if (!r.sharedAt) throw conflict('Share the draft with directors first.');
  const rev = await one('SELECT * FROM draft_reviews WHERE run_id = ? AND program_id = ?', [r.id, req.params.programId]);
  if (!rev) throw notFound('Program review');
  const director = await one("SELECT 1 FROM users WHERE program_id = ? AND role = 'program_director' AND is_active = 1", [rev.programId]);
  if (director) throw conflict('This program has a director, who signs off for it. You can sign off only for programs without one.');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
  await run(`UPDATE draft_reviews SET status = 'signed_off', decided_by = ?, decided_at = datetime('now'), on_behalf = 1, note = ?, reset_reason = NULL, updated_at = datetime('now') WHERE id = ?`,
    [req.user.id, note || null, rev.id]);
  const prog = await one('SELECT name FROM programs WHERE id = ?', [rev.programId]);
  await logActivity({ category: 'schedule', action: 'signed off', actor: req.user, programId: rev.programId,
    details: `Signed off the draft schedule on behalf of ${prog.name} (no director)${note ? `: ${note}` : ''}` });
  res.json({ review: await reviewState(r) });
}));

// POST /api/schedule/flags/:id/resolve  { note } — the admin answers a flag.
router.post('/flags/:id/resolve', adminOnly, ah(async (req, res) => {
  const f = await one('SELECT * FROM draft_flags WHERE id = ?', [req.params.id]);
  if (!f) throw notFound('Flag');
  if (f.status === 'resolved') throw conflict('That flag is already resolved.');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
  await run(`UPDATE draft_flags SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution_note = ? WHERE id = ?`, [req.user.id, note || null, f.id]);
  await logActivity({ category: 'schedule', action: 'flag resolved', actor: req.user, programId: f.programId, details: `Resolved a draft flag on ${f.gameLabel}${note ? `: ${note}` : ''}` });
  await notifyUsers("role = 'program_director' AND program_id = ?", [f.programId], 'The league answered your flag on the draft',
    `Your flag on ${f.gameLabel} has been resolved.${note ? `\n${note}` : ''}\nCheck your games under Draft review and sign off when they work.`);
  const r = await one('SELECT * FROM schedule_runs WHERE id = ?', [f.runId]);
  res.json({ review: await reviewState(r) });
}));

// ---- the director's side ----
const directorOnly = requireRole('program_director');
async function sharedDraftFor(user) {
  if (!user.programId) throw forbidden('Your account isn’t assigned to a program.');
  const season = await activeSeason();
  const r = season && await one("SELECT * FROM schedule_runs WHERE season_id = ? AND status = 'draft' AND shared_at IS NOT NULL", [season.id]);
  if (!r) return { run: null };
  const review = await one('SELECT * FROM draft_reviews WHERE run_id = ? AND program_id = ?', [r.id, user.programId]);
  return { run: r, review };
}

// GET /api/schedule/draft-review — the shared draft, as this director's program sees it.
router.get('/draft-review', directorOnly, ah(async (req, res) => {
  const { run: r, review } = await sharedDraftFor(req.user);
  if (!r || !review) return res.json({ shared: false });
  // Their own program's games only (the league's decision): all they need to review.
  const games = (await all(`${GAME_SELECT} WHERE g.run_id = ? AND (ht.program_id = ? OR at.program_id = ?) ${GAME_ORDER}`,
    [r.id, req.user.programId, req.user.programId])).map(shapeGame);
  const flags = await all(`SELECT f.*, ru.first_name || ' ' || ru.last_name AS resolved_by_name FROM draft_flags f
    LEFT JOIN users ru ON ru.id = f.resolved_by WHERE f.run_id = ? AND f.program_id = ? ORDER BY f.created_at DESC`, [r.id, req.user.programId]);
  const decider = review.decidedBy ? await one("SELECT first_name || ' ' || last_name AS n FROM users WHERE id = ?", [review.decidedBy]) : null;
  res.json({ shared: true, run: { id: r.id, sharedAt: r.sharedAt, deadline: r.reviewDeadline, deadlinePassed: deadlinePassed(r), createdAt: r.createdAt },
    review: { ...review, onBehalf: !!review.onBehalf, statusLabel: REVIEW_LABELS[review.status], decidedByName: decider?.n || null }, games, flags });
}));

// POST /api/schedule/draft-review/sign-off  { note }
router.post('/draft-review/sign-off', directorOnly, ah(async (req, res) => {
  const { run: r, review } = await sharedDraftFor(req.user);
  if (!r || !review) throw conflict('There’s no draft waiting for your review.');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 300) : '';
  await db.batch([
    { sql: `UPDATE draft_reviews SET status = 'signed_off', decided_by = ?, decided_at = datetime('now'), on_behalf = 0, note = ?, reset_reason = NULL, updated_at = datetime('now') WHERE id = ?`,
      args: [req.user.id, note || null, review.id] },
    // Signing off means the games work as they are, so any open flags are withdrawn.
    { sql: `UPDATE draft_flags SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution_note = 'Withdrawn: the program signed off.'
      WHERE run_id = ? AND program_id = ? AND status = 'open'`, args: [req.user.id, r.id, req.user.programId] },
  ], 'write');
  await logActivity({ category: 'schedule', action: 'signed off', actor: req.user, programId: req.user.programId, details: `Signed off the draft schedule${note ? `: ${note}` : ''}` });
  const left = await one("SELECT COUNT(*) AS n FROM draft_reviews WHERE run_id = ? AND status != 'signed_off'", [r.id]);
  if (Number(left.n) === 0) {
    await notifyUsers("role = 'super_admin'", [], 'Every program has signed off the draft', 'Every program has signed off the draft schedule. You can publish it from the Schedule builder.');
  }
  res.json({ ok: true, remaining: Number(left.n) });
}));

// POST /api/schedule/draft-review/flags  { gameId, note } — flag one of your games.
router.post('/draft-review/flags', directorOnly, ah(async (req, res) => {
  const { run: r, review } = await sharedDraftFor(req.user);
  if (!r || !review) throw conflict('There’s no draft waiting for your review.');
  const game = await getGame(req.body?.gameId);
  if (!game || game.runId !== r.id || ![game.homeProgramId, game.awayProgramId].includes(req.user.programId)) throw notFound('Game');
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
  if (note.length < 5) throw badRequest('Say what’s wrong with this game, e.g. “11/5 clashes with our school event.”');
  const label = gameLabel(game);
  await db.batch([
    { sql: 'INSERT INTO draft_flags (id, run_id, program_id, game_id, game_label, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      args: [newId(), r.id, req.user.programId, game.id, label, note.slice(0, 400), req.user.id] },
    { sql: `UPDATE draft_reviews SET status = 'flagged', decided_by = ?, decided_at = datetime('now'), on_behalf = 0, note = NULL, updated_at = datetime('now') WHERE id = ?`, args: [req.user.id, review.id] },
  ], 'write');
  await logActivity({ category: 'schedule', action: 'flagged', actor: req.user, programId: req.user.programId, details: `Flagged a draft game: ${label}: ${note.slice(0, 200)}` });
  await notifyUsers("role = 'super_admin'", [], 'A director flagged a game in the draft',
    `${req.user.firstName} ${req.user.lastName} flagged a game in the draft schedule:\n${label}\n“${note.slice(0, 400)}”\nReview it in the Schedule builder.`);
  res.status(201).json({ ok: true });
}));

// ---------------------------------------------------------------------
// Publish / discard
// ---------------------------------------------------------------------
router.post('/runs/:id/publish', adminOnly, ah(async (req, res) => {
  const r = await one('SELECT * FROM schedule_runs WHERE id = ?', [req.params.id]);
  if (!r) throw notFound('Schedule');
  if (r.status !== 'draft') throw conflict('Only a draft can be published.');
  // Director sign-off: every program with teams must have signed off. After
  // the review deadline has passed, the admin may publish anyway (override),
  // and that's recorded on the schedule.
  const review = await reviewState(r);
  let override = null;
  if (!review.shared) {
    throw conflict('Share the draft with the Program Directors and collect their sign-offs before publishing.', { code: 'NOT_SHARED' });
  }
  if (!review.allSignedOff) {
    const names = review.pending.map((p) => `${p.programName} (${REVIEW_LABELS[p.status].toLowerCase()})`).join(', ');
    if (!review.deadlinePassed) {
      throw conflict(`Every program has to sign off before publishing. Still to sign off: ${names}.${review.deadline ? ` You can publish anyway after the ${review.deadline} deadline.` : ' Set a review deadline if you may need to publish without every sign-off.'}`,
        { code: 'SIGNOFF_REQUIRED', pending: review.pending, deadline: review.deadline });
    }
    if (req.body?.override !== true) {
      throw conflict(`The review deadline (${review.deadline}) has passed, but not every program has signed off: ${names}. Confirm to publish anyway; the override is recorded.`,
        { code: 'OVERRIDE_REQUIRED', pending: review.pending, deadline: review.deadline });
    }
    const note = typeof req.body?.overrideNote === 'string' ? req.body.overrideNote.trim().slice(0, 300) : '';
    override = { by: req.user.id, byName: `${req.user.firstName} ${req.user.lastName}`, at: new Date().toISOString(), deadline: review.deadline, pending: review.pending, note: note || null };
  }
  const current = await publishedRun(r.seasonId);
  const assignedAhead = current ? await upcomingAssignmentCount(current.id, leagueNow().date) : 0;
  if (current && req.body?.replace !== true) {
    throw conflict(`A schedule is already published for this season. Publishing this draft will replace it and cancel any open change requests.${assignedAhead ? ` ${assignedAhead} upcoming referee assignment${assignedAhead === 1 ? '' : 's'} will carry over only where a game is unchanged (same teams, date, time, and court).` : ''}`,
      { code: 'REPLACE_REQUIRED', assignedAhead });
  }
  const stmts = [];
  if (current) {
    stmts.push({ sql: "UPDATE schedule_runs SET status = 'superseded' WHERE id = ?", args: [current.id] });
    stmts.push({
      sql: `UPDATE change_requests SET status = 'cancelled', decision_note = 'Cancelled automatically: a new schedule was published.', decided_at = datetime('now'), updated_at = datetime('now')
            WHERE status IN ('pending_director', 'pending_counterpart', 'pending_admin')
              AND (game_id IN (SELECT id FROM games WHERE run_id = ?) OR (type = 'add' AND run_id = ?))`,
      args: [current.id, current.id],
    });
  }
  stmts.push({ sql: "UPDATE schedule_runs SET status = 'published', published_by = ?, published_at = datetime('now'), publish_override = ? WHERE id = ?", args: [req.user.id, override ? JSON.stringify(override) : null, r.id] });
  await db.batch(stmts, 'write');
  // Module C: every published game gets its referee slots; carry referees
  // over to unchanged games when replacing an earlier schedule.
  const carry = current ? await carryOverAssignments(current.id, r.id, leagueNow().date) : { carried: 0, dropped: 0 };
  // Final scores follow unchanged games (same teams, date, time, and court) to the new schedule.
  if (current) {
    const scored = await all(`SELECT home_team_id, away_team_id, home_score, away_score, score_note, score_entered_by, score_entered_at, date, start_time, court_id
      FROM games WHERE run_id = ? AND home_score IS NOT NULL AND away_score IS NOT NULL`, [current.id]);
    if (scored.length) {
      const fresh = await all('SELECT id, home_team_id, away_team_id, date, start_time, court_id FROM games WHERE run_id = ?', [r.id]);
      const key = (g) => `${[g.homeTeamId, g.awayTeamId].sort().join('|')}|${g.date}|${g.startTime}|${g.courtId}`;
      const byKey = new Map(fresh.map((g) => [key(g), g]));
      const copies = scored.flatMap((o) => {
        const n = byKey.get(key(o));
        if (!n) return [];
        const same = n.homeTeamId === o.homeTeamId;
        return [{ sql: `UPDATE games SET home_score = ?, away_score = ?, score_note = ?, score_entered_by = ?, score_entered_at = ? WHERE id = ?`,
          args: [same ? o.homeScore : o.awayScore, same ? o.awayScore : o.homeScore, o.scoreNote, o.scoreEnteredBy, o.scoreEnteredAt, n.id] }];
      });
      if (copies.length) await db.batch(copies, 'write');
    }
  }
  if (!current) await syncSlots(r.id);
  if (carry.dropped) {
    await logActivity({ category: 'referee', action: 'unassigned', actor: req.user, details: `${carry.dropped} referee assignment(s) didn’t carry over to the new schedule because their games changed` });
  }
  const counts = await one("SELECT SUM(status = 'scheduled') AS scheduled, SUM(status = 'unscheduled') AS unscheduled FROM games WHERE run_id = ?", [r.id]);
  await logActivity({ category: 'schedule', action: 'published', actor: req.user,
    details: `Published the schedule: ${counts.scheduled || 0} games${counts.unscheduled ? ` (${counts.unscheduled} unplaced pairings left off)` : ''}${current ? ', replacing the previous schedule' : ''}${override
      ? `. Published after the ${override.deadline} review deadline without sign-off from ${override.pending.map((p) => p.programName).join(', ')}${override.note ? ` (${override.note})` : ''}` : ''}` });
  res.json({ published: shapeRun(await one('SELECT * FROM schedule_runs WHERE id = ?', [r.id])), referees: carry });
}));

router.delete('/runs/:id', adminOnly, ah(async (req, res) => {
  const r = await one('SELECT * FROM schedule_runs WHERE id = ?', [req.params.id]);
  if (!r) throw notFound('Schedule');
  if (r.status !== 'draft') throw conflict('Only a draft can be discarded.');
  await db.batch([
    { sql: 'DELETE FROM games WHERE run_id = ?', args: [r.id] },
    { sql: 'DELETE FROM schedule_runs WHERE id = ?', args: [r.id] },
  ], 'write');
  await logActivity({ category: 'schedule', action: 'discarded', actor: req.user, details: 'Discarded the draft schedule' });
  res.json({ ok: true });
}));

export default router;

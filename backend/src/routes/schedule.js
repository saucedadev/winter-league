import { Router } from 'express';
import { one, all, run, db } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, isSuperAdmin } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { assertDate, assertTime, isValidDate } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';
import { normalizeRules } from '../scheduling/core.js';
import {
  getRules, saveRules, generateDraft, GAME_SELECT, GAME_ORDER, shapeGame, getGame,
  checkPlacement, placementOptions, placementUpdate, todayStr, describeGame, activeSeason, publishedRun,
} from '../scheduling/data.js';
import { onGamesChanged, syncSlots, carryOverAssignments, upcomingAssignmentCount, leagueNow, notifyUsers } from '../referees/data.js';
import { config } from '../config.js';
import { toMinutes } from '../scheduling/core.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);
const adminOnly = requireRole('super_admin');

const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };
const shapeRun = (r) => r && ({ ...r, rules: parseJson(r.rules, {}), summary: parseJson(r.summary, null), warnings: parseJson(r.warnings, []) });

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

router.put('/rules', adminOnly, ah(async (req, res) => {
  let rules;
  try { rules = normalizeRules(req.body || {}); } catch (e) { throw badRequest(e.message); }
  await saveRules(rules);
  await logActivity({ category: 'schedule', action: 'rules', actor: req.user, details: `Updated schedule rules: ${rules.gamesPerTeam} games per team, ${rules.gameMinutes}-minute games, ${rules.maxTravelMiles}-mile travel cap` });
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
  res.json({ season, rules: await getRules(), draft: shapeRun(draft), published: shapeRun(published), openRequests: Number(openRequests.n), assignedAhead });
}));

// ---------------------------------------------------------------------
// Generate a new draft (replaces any existing draft)
// ---------------------------------------------------------------------
router.post('/generate', adminOnly, ah(async (req, res) => {
  const season = await requireSeason();
  let rules = await getRules();
  if (req.body?.rules) {
    try { rules = normalizeRules(req.body.rules); } catch (e) { throw badRequest(e.message); }
    await saveRules(rules);
  }
  const started = Date.now();
  const result = await generateDraft(season, rules, req.user.id);
  await logActivity({ category: 'schedule', action: 'generated', actor: req.user,
    details: `Generated a draft schedule for ${season.name}: ${result.summary.scheduledGames} games placed, ${result.summary.unscheduledGames} unplaced` });
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
// Publish / discard
// ---------------------------------------------------------------------
router.post('/runs/:id/publish', adminOnly, ah(async (req, res) => {
  const r = await one('SELECT * FROM schedule_runs WHERE id = ?', [req.params.id]);
  if (!r) throw notFound('Schedule');
  if (r.status !== 'draft') throw conflict('Only a draft can be published.');
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
            WHERE status IN ('pending_director', 'pending_counterpart', 'pending_admin') AND game_id IN (SELECT id FROM games WHERE run_id = ?)`,
      args: [current.id],
    });
  }
  stmts.push({ sql: "UPDATE schedule_runs SET status = 'published', published_by = ?, published_at = datetime('now') WHERE id = ?", args: [req.user.id, r.id] });
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
    details: `Published the schedule: ${counts.scheduled || 0} games${counts.unscheduled ? ` (${counts.unscheduled} unplaced pairings left off)` : ''}${current ? ', replacing the previous schedule' : ''}` });
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

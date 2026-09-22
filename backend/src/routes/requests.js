// Module D — reschedule & swap requests on the published schedule.
//
//   coach asks ──▶ pending_director ──▶ pending_counterpart ──▶ pending_admin ──▶ approved (applied)
//   director asks ───────────────────▶ pending_counterpart ──▶ ...
//
//   pending_director:    the requesting program's director endorses (coach requests only)
//   pending_counterpart: every OTHER program with a team in the affected game(s) agrees
//   pending_admin:       System Admin gives league sign-off; the change is re-checked and applied
// Any stage can deny (ends it). The requester or their director can cancel
// while it's pending. Every transition is written to the activity log.
import { Router } from 'express';
import { one, all, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, isSuperAdmin } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { assertDate, assertTime, trimOrNull, formatTime12 } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';
import { sendEmail } from '../utils/email.js';
import { config } from '../config.js';
import { getGame, checkPlacement, placementUpdate, todayStr, describeGame } from '../scheduling/data.js';
import { canRequestFor, hasBeenPlayed } from './schedule.js';
import { onGamesChanged } from '../referees/data.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director', 'league_coach'));

const OPEN = ['pending_director', 'pending_counterpart', 'pending_admin'];
const OPEN_SQL = `('pending_director', 'pending_counterpart', 'pending_admin')`;
export const STATUS_LABELS = {
  pending_director: 'Waiting on program director',
  pending_counterpart: 'Waiting on other program',
  pending_admin: 'Waiting on league sign-off',
  approved: 'Approved',
  denied: 'Denied',
  cancelled: 'Cancelled',
};

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
async function notify({ role, programIds = null, userIds = [], subject, text }) {
  try {
    const where = [];
    const args = [];
    if (role) {
      where.push(`(role = ?${programIds ? ` AND program_id IN (${programIds.map(() => '?').join(',')})` : ''})`);
      args.push(role, ...(programIds || []));
    }
    if (userIds.filter(Boolean).length) {
      where.push(`id IN (${userIds.filter(Boolean).map(() => '?').join(',')})`);
      args.push(...userIds.filter(Boolean));
    }
    if (!where.length) return;
    const users = await all(`SELECT DISTINCT email, first_name FROM users WHERE is_active = 1 AND (${where.join(' OR ')})`, args);
    await Promise.all(users.map((u) => sendEmail({ to: u.email, subject, text: `Hi ${u.firstName},\n\n${text}\n\nReview it at ${config.appUrls[0]}/requests` })));
  } catch (err) {
    console.error('request notification failed:', err.message);
  }
}

function involvedPrograms(games) {
  return [...new Set(games.flatMap((g) => [g.homeProgramId, g.awayProgramId]))];
}

function summarize(r, game, swapGame) {
  if (r.type === 'swap') return `Swap ${describeGame(game)} with ${describeGame(swapGame)}`;
  return `Move ${describeGame(game)} to ${r.proposedDate} at ${formatTime12(r.proposedStartTime)}`;
}

// What the signed-in user can do with this request right now.
function actionsFor(user, r, steps) {
  const acts = [];
  if (!OPEN.includes(r.status)) return acts;
  if (r.status === 'pending_director' && user.role === 'program_director' && user.programId === r.requestingProgramId) acts.push('approve', 'deny');
  if (r.status === 'pending_counterpart' && user.role === 'program_director'
    && steps.some((s) => s.stage === 'counterpart' && s.programId === user.programId && s.decision === 'pending')) acts.push('approve', 'deny');
  if (r.status === 'pending_admin' && isSuperAdmin(user)) acts.push('approve', 'deny');
  if (isSuperAdmin(user) && !acts.includes('deny')) acts.push('deny'); // league override
  if (r.requestedBy === user.id || (user.role === 'program_director' && user.programId === r.requestingProgramId)) acts.push('cancel');
  return acts;
}

const REQUEST_SELECT = `SELECT r.*, u.first_name || ' ' || u.last_name AS requested_by_name, u.role AS requested_by_role,
    p.name AS requesting_program_name, p.short_code AS requesting_program_code,
    c.name AS proposed_court_name, v.name AS proposed_venue_name,
    du.first_name || ' ' || du.last_name AS decided_by_name
  FROM change_requests r
  LEFT JOIN users u ON u.id = r.requested_by
  JOIN programs p ON p.id = r.requesting_program_id
  LEFT JOIN courts c ON c.id = r.proposed_court_id LEFT JOIN venues v ON v.id = c.venue_id
  LEFT JOIN users du ON du.id = r.decided_by`;

// Where a game was when the request was filed, so the record still shows
// "was X, now Y" after the change is applied.
const SNAP_FIELDS = ['date', 'startTime', 'endTime', 'courtId', 'courtName', 'venueName', 'homeTeamName', 'awayTeamName', 'homeTeamId', 'awayTeamId', 'divisionName'];
export const snapshotOf = (game, swapGame) => JSON.stringify({
  game: Object.fromEntries(SNAP_FIELDS.map((k) => [k, game[k]])),
  swapGame: swapGame ? Object.fromEntries(SNAP_FIELDS.map((k) => [k, swapGame[k]])) : null,
});

async function hydrate(r, user) {
  const [game, swapGame, steps] = await Promise.all([
    getGame(r.gameId),
    r.swapGameId ? getGame(r.swapGameId) : null,
    all(`SELECT s.*, p.name AS program_name, p.short_code AS program_code, u.first_name || ' ' || u.last_name AS decided_by_name
         FROM change_request_steps s JOIN programs p ON p.id = s.program_id LEFT JOIN users u ON u.id = s.decided_by
         WHERE s.request_id = ? ORDER BY s.stage = 'counterpart', p.name`, [r.id]),
  ]);
  let before = null;
  try { before = r.snapshot ? JSON.parse(r.snapshot) : null; } catch { /* older rows */ }
  return { ...r, snapshot: undefined, before, statusLabel: STATUS_LABELS[r.status], game, swapGame, steps, summary: summarize(r, game, swapGame), actions: actionsFor(user, r, steps) };
}

async function loadRequest(id) {
  const r = await one(`${REQUEST_SELECT} WHERE r.id = ?`, [id]);
  if (!r) throw notFound('Request');
  return r;
}

function visibleTo(user, r, game, swapGame, steps) {
  if (isSuperAdmin(user)) return true;
  if (user.role === 'program_director') return r.requestingProgramId === user.programId || steps.some((s) => s.programId === user.programId);
  const coaches = [game, swapGame].filter(Boolean).flatMap((g) => [g.homeCoachId, g.awayCoachId]);
  return r.requestedBy === user.id || coaches.includes(user.id);
}

// Validates the proposal and returns what applying it would do.
async function evaluate(r, game, swapGame, { today }) {
  if (r.type === 'swap') {
    const a = await checkPlacement(game, { courtId: swapGame.courtId, date: swapGame.date, startTime: swapGame.startTime, endTime: swapGame.endTime }, { excludeIds: [swapGame.id], today });
    const b = await checkPlacement(swapGame, { courtId: game.courtId, date: game.date, startTime: game.startTime, endTime: game.endTime }, { excludeIds: [game.id], today });
    return {
      errors: [...a.errors, ...b.errors], warnings: [...a.warnings, ...b.warnings],
      updates: [
        placementUpdate(game, { courtId: swapGame.courtId, date: swapGame.date, startTime: swapGame.startTime, endTime: swapGame.endTime }, a),
        placementUpdate(swapGame, { courtId: game.courtId, date: game.date, startTime: game.startTime, endTime: game.endTime }, b),
      ],
    };
  }
  const target = { courtId: r.proposedCourtId, date: r.proposedDate, startTime: r.proposedStartTime, endTime: r.proposedEndTime };
  const c = await checkPlacement(game, target, { today });
  return { errors: c.errors, warnings: c.warnings, updates: [placementUpdate(game, target, c)], flip: c.flip };
}

async function assertRequestableGame(user, id, label) {
  const g = await getGame(id);
  if (!g) throw notFound(label);
  const runRow = await one('SELECT status FROM schedule_runs WHERE id = ?', [g.runId]);
  if (runRow?.status !== 'published') throw badRequest(`${label} isn’t on the published schedule.`);
  if (g.status !== 'scheduled') throw badRequest(`${label} isn’t currently scheduled.`);
  if (g.date < todayStr() || hasBeenPlayed(g) || g.hasScore) throw badRequest(`${label} has already been played.`);
  if (g.hasOpenRequest) throw conflict(`${label} already has an open change request. Wait for it to be decided or cancel it first.`);
  return g;
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

// GET /api/requests?state=open|closed|all
router.get('/', ah(async (req, res) => {
  const where = [];
  const args = [];
  if (req.query.state === 'closed') where.push(`r.status NOT IN ${OPEN_SQL}`);
  else if (req.query.state !== 'all') where.push(`r.status IN ${OPEN_SQL}`);
  const u = req.user;
  if (u.role === 'program_director') {
    where.push('(r.requesting_program_id = ? OR EXISTS (SELECT 1 FROM change_request_steps s WHERE s.request_id = r.id AND s.program_id = ?))');
    args.push(u.programId, u.programId);
  } else if (u.role === 'league_coach') {
    where.push(`(r.requested_by = ? OR EXISTS (SELECT 1 FROM games g JOIN teams t ON t.id IN (g.home_team_id, g.away_team_id)
      WHERE g.id IN (r.game_id, r.swap_game_id) AND t.head_coach_user_id = ?))`);
    args.push(u.id, u.id);
  }
  const rows = await all(`${REQUEST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT 200`, args);
  const requests = await Promise.all(rows.map((r) => hydrate(r, u)));
  res.json({ requests, statusLabels: STATUS_LABELS });
}));

// GET /api/requests/count — how many need the signed-in user's decision (nav badge)
router.get('/count', ah(async (req, res) => {
  const u = req.user;
  let n = 0;
  if (isSuperAdmin(u)) n = (await one("SELECT COUNT(*) AS n FROM change_requests WHERE status = 'pending_admin'")).n;
  else if (u.role === 'program_director') {
    n = (await one(`SELECT COUNT(*) AS n FROM change_requests r WHERE
      (r.status = 'pending_director' AND r.requesting_program_id = ?)
      OR (r.status = 'pending_counterpart' AND EXISTS (SELECT 1 FROM change_request_steps s WHERE s.request_id = r.id
          AND s.stage = 'counterpart' AND s.program_id = ? AND s.decision = 'pending'))`, [u.programId, u.programId])).n;
  }
  res.json({ needsAction: Number(n) });
}));

router.get('/:id', ah(async (req, res) => {
  const r = await hydrate(await loadRequest(req.params.id), req.user);
  if (!visibleTo(req.user, r, r.game, r.swapGame, r.steps)) throw notFound('Request');
  res.json({ request: r });
}));

// POST /api/requests  { gameId, type: 'reschedule'|'swap', reason,
//   courtId, date, startTime, endTime }   (reschedule)
//   swapGameId                              (swap)
router.post('/', ah(async (req, res) => {
  const u = req.user;
  if (isSuperAdmin(u)) throw badRequest('System Admins change games directly from the Schedule builder instead of filing requests.');
  const b = req.body || {};
  if (!['reschedule', 'swap'].includes(b.type)) throw badRequest('Choose reschedule or swap.');
  const reason = trimOrNull(b.reason);
  if (!reason || reason.length < 5) throw badRequest('Give a short reason so the other program and the league know why.');
  if (!u.programId) throw forbidden('Your account isn’t assigned to a program.');

  const game = await assertRequestableGame(u, b.gameId, 'That game');
  if (!canRequestFor(u, game)) throw forbidden('You can only request changes to your own teams’ games.');

  let swapGame = null;
  const draft = { type: b.type, proposedCourtId: null, proposedDate: null, proposedStartTime: null, proposedEndTime: null };
  if (b.type === 'swap') {
    if (!b.swapGameId || b.swapGameId === game.id) throw badRequest('Choose the game to swap with.');
    swapGame = await assertRequestableGame(u, b.swapGameId, 'The other game');
    if (swapGame.runId !== game.runId) throw badRequest('Both games must be on the same schedule.');
    if (!canRequestFor(u, swapGame)) throw forbidden('You can only swap with another of your own teams’ games.');
  } else {
    assertDate(b.date); assertTime(b.startTime, 'Start time'); assertTime(b.endTime, 'End time');
    if (!b.courtId) throw badRequest('Choose where the game should move to.');
    Object.assign(draft, { proposedCourtId: b.courtId, proposedDate: b.date, proposedStartTime: b.startTime, proposedEndTime: b.endTime });
  }

  const ev = await evaluate(draft, game, swapGame, { today: todayStr() });
  if (ev.errors.length) throw conflict(ev.errors[0], { errors: ev.errors });

  const counterparts = involvedPrograms([game, swapGame].filter(Boolean)).filter((p) => p !== u.programId);
  const status = u.role === 'league_coach' ? 'pending_director' : counterparts.length ? 'pending_counterpart' : 'pending_admin';
  const id = newId();
  const stmts = [{
    sql: `INSERT INTO change_requests (id, game_id, type, swap_game_id, proposed_court_id, proposed_date, proposed_start_time, proposed_end_time,
          reason, snapshot, requested_by, requesting_program_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [id, game.id, b.type, swapGame?.id || null, draft.proposedCourtId, draft.proposedDate, draft.proposedStartTime, draft.proposedEndTime,
      reason, snapshotOf(game, swapGame), u.id, u.programId, status],
  }];
  if (u.role === 'league_coach') stmts.push({ sql: 'INSERT INTO change_request_steps (id, request_id, stage, program_id) VALUES (?, ?, ?, ?)', args: [newId(), id, 'director', u.programId] });
  for (const p of counterparts) stmts.push({ sql: 'INSERT INTO change_request_steps (id, request_id, stage, program_id) VALUES (?, ?, ?, ?)', args: [newId(), id, 'counterpart', p] });
  await db.batch(stmts, 'write');

  const summary = summarize({ ...draft, type: b.type }, game, swapGame);
  // Every program with a team in the affected game(s) sees each step of the request.
  await logActivity({ category: 'request', action: 'created', actor: u, programId: u.programId, programIds: involvedPrograms([game, swapGame].filter(Boolean)), details: `Requested: ${summary}` });
  const text = `${u.firstName} ${u.lastName} requested a schedule change:\n${summary}\nReason: ${reason}`;
  if (status === 'pending_director') await notify({ role: 'program_director', programIds: [u.programId], subject: 'Schedule change request needs your review', text });
  else if (status === 'pending_counterpart') await notify({ role: 'program_director', programIds: counterparts, subject: 'Another program asked to change a game with your team', text });
  else await notify({ role: 'super_admin', subject: 'Schedule change request needs league sign-off', text });

  res.status(201).json({ request: await hydrate(await loadRequest(id), u), warnings: ev.warnings });
}));

// POST /api/requests/:id/act  { action: 'approve'|'deny', note }
router.post('/:id/act', ah(async (req, res) => {
  const u = req.user;
  const r = await loadRequest(req.params.id);
  const steps = await all('SELECT * FROM change_request_steps WHERE request_id = ?', [r.id]);
  const action = req.body?.action;
  const note = trimOrNull(req.body?.note);
  if (!['approve', 'deny'].includes(action)) throw badRequest('Action must be approve or deny.');
  if (!actionsFor(u, r, steps).includes(action)) {
    throw OPEN.includes(r.status) ? forbidden('This request isn’t waiting on you.') : conflict(`This request is already ${r.status}.`);
  }
  if (action === 'deny' && (!note || note.length < 3)) throw badRequest('Add a short note explaining the denial.');

  const game = await getGame(r.gameId);
  const swapGame = r.swapGameId ? await getGame(r.swapGameId) : null;
  const summary = summarize(r, game, swapGame);
  const requesterNote = `${summary}${note ? `\nNote: ${note}` : ''}`;
  const stmts = [];

  // Which step is this user acting on?
  const myStep = r.status === 'pending_director'
    ? steps.find((s) => s.stage === 'director')
    : r.status === 'pending_counterpart' && u.role === 'program_director'
      ? steps.find((s) => s.stage === 'counterpart' && s.programId === u.programId && s.decision === 'pending')
      : null;
  if (myStep) {
    stmts.push({ sql: "UPDATE change_request_steps SET decision = ?, decided_by = ?, decided_at = datetime('now'), note = ? WHERE id = ?",
      args: [action === 'approve' ? 'approved' : 'denied', u.id, note, myStep.id] });
  }

  let next;
  if (action === 'deny') {
    next = 'denied';
    stmts.push({ sql: "UPDATE change_requests SET status = 'denied', decision_note = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", args: [note, u.id, r.id] });
  } else if (r.status === 'pending_director') {
    next = steps.some((s) => s.stage === 'counterpart') ? 'pending_counterpart' : 'pending_admin';
  } else if (r.status === 'pending_counterpart') {
    const stillPending = steps.filter((s) => s.stage === 'counterpart' && s.decision === 'pending' && s.id !== myStep.id);
    next = stillPending.length ? 'pending_counterpart' : 'pending_admin';
  } else {
    // League sign-off: re-check against the schedule as it is NOW, then apply.
    const ev = await evaluate(r, game, swapGame, { today: todayStr() });
    if (ev.errors.length) throw conflict(`This change no longer fits the schedule: ${ev.errors[0]} Deny it with a note so the requester can pick another option.`, { errors: ev.errors });
    stmts.push(...ev.updates);
    next = 'approved';
    stmts.push({ sql: "UPDATE change_requests SET status = 'approved', decision_note = ?, decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", args: [note, u.id, r.id] });
  }
  if (next !== r.status && !['approved', 'denied'].includes(next)) {
    stmts.push({ sql: "UPDATE change_requests SET status = ?, updated_at = datetime('now') WHERE id = ?", args: [next, r.id] });
  }
  await db.batch(stmts, 'write');
  if (next === 'approved') await onGamesChanged([game.id, swapGame?.id].filter(Boolean), u);

  const verb = action === 'deny' ? 'Denied' : next === 'approved' ? 'Approved and applied' : 'Approved';
  await logActivity({ category: 'request', action: action === 'deny' ? 'denied' : next === 'approved' ? 'applied' : 'approved', actor: u, programId: r.requestingProgramId, programIds: involvedPrograms([game, swapGame].filter(Boolean)),
    details: `${verb}${myStep?.stage === 'counterpart' ? ' (as the other program)' : myStep?.stage === 'director' ? ' (as program director)' : ''}: ${summary}` });

  if (next === 'denied' || next === 'approved') {
    await notify({ userIds: [r.requestedBy], role: 'program_director', programIds: involvedPrograms([game, swapGame].filter(Boolean)),
      subject: `Schedule change ${next}`, text: `This schedule change was ${next}:\n${requesterNote}` });
  } else if (next === 'pending_counterpart' && r.status !== 'pending_counterpart') {
    await notify({ role: 'program_director', programIds: steps.filter((s) => s.stage === 'counterpart').map((s) => s.programId),
      subject: 'Another program asked to change a game with your team', text: `A schedule change needs your program’s agreement:\n${summary}\nReason: ${r.reason}` });
  } else if (next === 'pending_admin') {
    await notify({ role: 'super_admin', subject: 'Schedule change request needs league sign-off', text: `Both programs have agreed:\n${summary}\nReason: ${r.reason}` });
  }
  res.json({ request: await hydrate(await loadRequest(r.id), u) });
}));

// POST /api/requests/:id/cancel
router.post('/:id/cancel', ah(async (req, res) => {
  const r = await loadRequest(req.params.id);
  const steps = await all('SELECT * FROM change_request_steps WHERE request_id = ?', [r.id]);
  if (!actionsFor(req.user, r, steps).includes('cancel')) {
    throw OPEN.includes(r.status) ? forbidden('Only the person who asked, or their program director, can cancel this.') : conflict(`This request is already ${r.status}.`);
  }
  await db.execute({ sql: "UPDATE change_requests SET status = 'cancelled', decided_by = ?, decided_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", args: [req.user.id, r.id] });
  const game = await getGame(r.gameId);
  const swapGame = r.swapGameId ? await getGame(r.swapGameId) : null;
  await logActivity({ category: 'request', action: 'cancelled', actor: req.user, programId: r.requestingProgramId, programIds: involvedPrograms([game, swapGame].filter(Boolean)), details: `Cancelled request: ${summarize(r, game, swapGame)}` });
  res.json({ request: await hydrate(await loadRequest(r.id), req.user) });
}));

export default router;

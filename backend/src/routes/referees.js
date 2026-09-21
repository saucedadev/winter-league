// Module C — referee assignment, mobile check-in, and payout export.
//   Referee Assignor + System Admin: roster, assigning, auto-fill, marking worked/no-show, payouts.
//   Referee: their own games, decline, check-in, unavailable dates.
import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { assertDate, assertEmail, isValidDate, requireFields, trimOrNull, normalizePhone } from '../utils/validate.js';
import { hashPassword, tempPassword } from '../utils/security.js';
import { generateUsername } from '../utils/username.js';
import { logActivity } from '../utils/activityLog.js';
import {
  getRefSettings, saveRefSettings, normalizeRefSettings, currentPublishedRun, syncSlots, leagueNow, checkInWindow,
  refereeProblems, loadRefereeContext, activeReferees, gamesWithAssignments, notifyUsers, notifyAssignors, gameLine,
  payRate, milesBetween, autoFill, lowerFirst,
} from '../referees/data.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);
const managers = requireRole('super_admin', 'referee_assignor');
const refereeOnly = requireRole('referee');

const today = () => leagueNow().date;
const money = (c) => `$${(c / 100).toFixed(2)}`;
const refName = (u) => `${u.firstName} ${u.lastName}`;

async function requireRun() {
  const r = await currentPublishedRun();
  if (!r) throw conflict('No schedule has been published yet. Referees can be assigned once the league publishes one.');
  return r;
}

async function loadAssignment(id) {
  const a = await one(`SELECT a.*, g.run_id, r.status AS run_status FROM referee_assignments a
    JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id WHERE a.id = ?`, [id]);
  if (!a) throw notFound('Referee slot');
  const [game] = await gamesWithAssignments('g.id = ?', [a.gameId]);
  return { a, game };
}

// =====================================================================
// Settings
// =====================================================================
router.get('/settings', managers, ah(async (req, res) => res.json({ settings: await getRefSettings() })));

router.put('/settings', managers, ah(async (req, res) => {
  let s;
  try { s = normalizeRefSettings(req.body || {}); } catch (e) { throw badRequest(e.message); }
  await saveRefSettings(s);
  const r = await currentPublishedRun();
  if (r) await syncSlots(r.id, s.refereesPerGame);
  await logActivity({ category: 'referee', action: 'settings', actor: req.user, details: `Referee settings: ${s.refereesPerGame} per game, ${money(s.defaultPayCents)} default pay` });
  res.json({ settings: s });
}));

// =====================================================================
// Roster
// =====================================================================
router.get('/roster', managers, ah(async (req, res) => {
  const t = today();
  const refs = await all(`SELECT u.id, u.first_name, u.last_name, u.username, u.email, u.phone, u.is_active, u.last_login_at, u.must_change_password,
      rp.pay_rate_cents, rp.notes,
      (SELECT COUNT(*) FROM referee_assignments a JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
        WHERE a.referee_id = u.id AND r.status = 'published' AND g.status = 'scheduled' AND g.date >= ?) AS upcoming,
      (SELECT COUNT(*) FROM referee_assignments a JOIN games g ON g.id = a.game_id
        WHERE a.referee_id = u.id AND a.status = 'checked_in' AND g.status != 'cancelled') AS worked,
      (SELECT COUNT(*) FROM referee_assignments a WHERE a.referee_id = u.id AND a.status = 'no_show') AS no_shows
    FROM users u LEFT JOIN referee_profiles rp ON rp.user_id = u.id
    WHERE u.role = 'referee' ORDER BY u.is_active DESC, u.last_name COLLATE NOCASE, u.first_name COLLATE NOCASE`, [t]);
  const unav = await all('SELECT * FROM referee_unavailability WHERE end_date >= ? ORDER BY start_date', [t]);
  res.json({
    settings: await getRefSettings(),
    referees: refs.map((r) => ({ ...r, isActive: !!r.isActive, unavailable: unav.filter((u) => u.userId === r.id) })),
  });
}));

// Assignors add referees themselves; the temporary password is shown once.
router.post('/roster', managers, ah(async (req, res) => {
  requireFields(req.body, ['firstName', 'lastName', 'email']);
  const b = req.body;
  assertEmail(b.email);
  const rate = parseRate(b.payRateCents);
  const id = newId();
  const username = await generateUsername(b.firstName, b.lastName);
  const password = tempPassword();
  await db.batch([
    { sql: `INSERT INTO users (id, first_name, last_name, username, email, phone, password_hash, role, program_id, must_change_password)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'referee', NULL, 1)`,
      args: [id, b.firstName.trim(), b.lastName.trim(), username, b.email.trim(), normalizePhone(b.phone), await hashPassword(password)] },
    { sql: 'INSERT INTO referee_profiles (user_id, pay_rate_cents, notes) VALUES (?, ?, ?)', args: [id, rate, trimOrNull(b.notes)] },
  ], 'write');
  await logActivity({ category: 'user', action: 'created', actor: req.user, details: `Added referee ${b.firstName.trim()} ${b.lastName.trim()} (${username})` });
  res.status(201).json({ referee: { id, username, firstName: b.firstName.trim(), lastName: b.lastName.trim() }, temporaryPassword: password });
}));

function parseRate(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw badRequest('Pay rate must be a whole number of cents from 0 to 100000 (e.g. 4500 = $45.00).');
  return n;
}

router.put('/roster/:id', managers, ah(async (req, res) => {
  const u = await one("SELECT * FROM users WHERE id = ? AND role = 'referee'", [req.params.id]);
  if (!u) throw notFound('Referee');
  const b = req.body || {};
  const stmts = [];
  if (b.payRateCents !== undefined || b.notes !== undefined) {
    const current = await one('SELECT * FROM referee_profiles WHERE user_id = ?', [u.id]);
    const rate = b.payRateCents !== undefined ? parseRate(b.payRateCents) : current?.payRateCents ?? null;
    const notes = b.notes !== undefined ? trimOrNull(b.notes) : current?.notes ?? null;
    stmts.push({ sql: `INSERT INTO referee_profiles (user_id, pay_rate_cents, notes) VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET pay_rate_cents = excluded.pay_rate_cents, notes = excluded.notes, updated_at = datetime('now')`, args: [u.id, rate, notes] });
  }
  if (b.phone !== undefined || b.email !== undefined) {
    const email = b.email !== undefined ? b.email.trim() : u.email;
    assertEmail(email);
    stmts.push({ sql: "UPDATE users SET email = ?, phone = ?, updated_at = datetime('now') WHERE id = ?", args: [email, b.phone !== undefined ? normalizePhone(b.phone, 'Phone number', u.phone) : u.phone, u.id] });
  }
  if (b.isActive !== undefined) {
    stmts.push({ sql: "UPDATE users SET is_active = ?, updated_at = datetime('now') WHERE id = ?", args: [b.isActive ? 1 : 0, u.id] });
    if (!b.isActive) {
      // A deactivated referee comes off every upcoming game.
      stmts.push({ sql: `UPDATE referee_assignments SET referee_id = NULL, status = 'assigned', assigned_by = NULL, assigned_at = NULL, updated_at = datetime('now')
        WHERE referee_id = ? AND status = 'assigned' AND game_id IN (SELECT id FROM games WHERE date >= ?)`, args: [u.id, today()] });
    }
  }
  if (stmts.length) await db.batch(stmts, 'write');
  await logActivity({ category: 'referee', action: 'edited', actor: req.user, details: `Updated referee ${refName(u)}${b.isActive === false ? ' (deactivated; removed from upcoming games)' : ''}` });
  res.json({ ok: true });
}));

// =====================================================================
// Assigning
// =====================================================================

// GET /api/referees/games?from=&to=&open=1
router.get('/games', managers, ah(async (req, res) => {
  const r = await currentPublishedRun();
  if (!r) return res.json({ published: false, games: [] });
  const settings = await getRefSettings();
  await syncSlots(r.id, settings.refereesPerGame);
  const from = isValidDate(req.query.from) ? req.query.from : today();
  const to = isValidDate(req.query.to) ? req.query.to : '9999-12-31';
  let games = await gamesWithAssignments("g.run_id = ? AND g.status = 'scheduled' AND g.date BETWEEN ? AND ?", [r.id, from, to]);
  if (req.query.open === '1') games = games.filter((g) => g.assignments.some((a) => !a.refereeId));
  const counts = await one(`SELECT COUNT(*) AS slots, SUM(a.referee_id IS NULL) AS open FROM referee_assignments a
    JOIN games g ON g.id = a.game_id WHERE g.run_id = ? AND g.status = 'scheduled' AND g.date >= ?`, [r.id, today()]);
  res.json({ published: true, settings, games, upcoming: { slots: Number(counts.slots || 0), open: Number(counts.open || 0) }, today: today() });
}));

// Who could take this slot, with reasons for anyone who can't.
router.get('/assignments/:id/candidates', managers, ah(async (req, res) => {
  const { a, game } = await loadAssignment(req.params.id);
  const refs = await activeReferees();
  const ctx = await loadRefereeContext([game.date]);
  const season = await all(`SELECT a.referee_id, COUNT(*) AS n FROM referee_assignments a JOIN games g ON g.id = a.game_id
    WHERE g.run_id = ? AND a.referee_id IS NOT NULL AND g.status = 'scheduled' GROUP BY a.referee_id`, [game.runId]);
  const seasonCount = new Map(season.map((s) => [s.refereeId, Number(s.n)]));
  const candidates = refs.map((r) => {
    const others = (ctx.others.get(r.id) || []).filter((o) => o.assignmentId !== a.id);
    const p = refereeProblems(game, others, ctx.unavailable.get(r.id) || []);
    return { id: r.id, name: refName(r), seasonGames: seasonCount.get(r.id) || 0, dayGames: others.filter((o) => o.date === game.date).length, ...p, current: r.id === a.refereeId };
  }).sort((x, y) => (x.blocking.length - y.blocking.length) || (x.warnings.length - y.warnings.length) || (x.seasonGames - y.seasonGames) || x.name.localeCompare(y.name));
  res.json({ game, slot: a, candidates });
}));

// PUT /api/referees/assignments/:id  { refereeId | null }
router.put('/assignments/:id', managers, ah(async (req, res) => {
  const { a, game } = await loadAssignment(req.params.id);
  if (a.runStatus !== 'published') throw conflict('That game is no longer on the published schedule.');
  if (game.status !== 'scheduled') throw conflict('That game isn’t scheduled.');
  const refereeId = trimOrNull(req.body?.refereeId);
  let warnings = [];
  if (refereeId) {
    const ref = await one("SELECT * FROM users WHERE id = ? AND role = 'referee'", [refereeId]);
    if (!ref || !ref.isActive) throw badRequest('Choose an active referee.');
    const ctx = await loadRefereeContext([game.date], [refereeId]);
    const others = (ctx.others.get(refereeId) || []).filter((o) => o.assignmentId !== a.id);
    const p = refereeProblems(game, others, ctx.unavailable.get(refereeId) || []);
    if (p.blocking.length) throw conflict(`${refName(ref)} can’t take this game: ${lowerFirst(p.blocking[0])}.`, { blocking: p.blocking });
    warnings = p.warnings;
    await run(`UPDATE referee_assignments SET referee_id = ?, status = 'assigned', assigned_by = ?, assigned_at = datetime('now'),
      checked_in_at = NULL, check_in_method = NULL, check_in_distance_miles = NULL, pay_cents = NULL, updated_at = datetime('now') WHERE id = ?`, [refereeId, req.user.id, a.id]);
    await notifyUsers('id = ?', [refereeId], 'You have a new game', `You’ve been assigned to referee:\n${gameLine(game)}\nSee your games at /my-games. If you can’t make it, decline it there before game day.`);
    if (a.refereeId && a.refereeId !== refereeId) await notifyUsers('id = ?', [a.refereeId], 'You’ve been taken off a game', `You’re no longer assigned to ${gameLine(game)}.`);
    await logActivity({ category: 'referee', action: 'assigned', actor: req.user, details: `Assigned ${refName(ref)} to ${game.homeTeamName} vs ${game.awayTeamName} on ${game.date}` });
  } else {
    if (!a.refereeId) return res.json({ ok: true });
    await run(`UPDATE referee_assignments SET referee_id = NULL, status = 'assigned', assigned_by = NULL, assigned_at = NULL,
      checked_in_at = NULL, check_in_method = NULL, check_in_distance_miles = NULL, pay_cents = NULL, updated_at = datetime('now') WHERE id = ?`, [a.id]);
    await notifyUsers('id = ?', [a.refereeId], 'You’ve been taken off a game', `You’re no longer assigned to ${gameLine(game)}.`);
    await logActivity({ category: 'referee', action: 'unassigned', actor: req.user, details: `Removed a referee from ${game.homeTeamName} vs ${game.awayTeamName} on ${game.date}` });
  }
  const [fresh] = await gamesWithAssignments('g.id = ?', [game.id]);
  res.json({ game: fresh, warnings });
}));

// POST /api/referees/auto-fill { from, to }
// Fills open slots in upcoming games. Strict: never uses anyone with a
// conflict, an unavailable date, or a back-to-back at another venue. Picks
// whoever has the fewest games this season, then fewest that day.
router.post('/auto-fill', managers, ah(async (req, res) => {
  const r = await requireRun();
  const settings = await getRefSettings();
  await syncSlots(r.id, settings.refereesPerGame);
  const t = today();
  const from = isValidDate(req.body?.from) && req.body.from > t ? req.body.from : t;
  const to = isValidDate(req.body?.to) ? req.body.to : '9999-12-31';
  if (!(await activeReferees()).length) throw conflict('Add referees to the roster first.');
  const { filled, stillOpen, byRef } = await autoFill({ runId: r.id, from, to, assignedBy: req.user.id });
  for (const [id, list] of byRef) {
    await notifyUsers('id = ?', [id], `You have ${list.length} new game${list.length > 1 ? 's' : ''}`, `You’ve been assigned to referee:\n${list.map(gameLine).join('\n')}`);
  }
  await logActivity({ category: 'referee', action: 'auto-filled', actor: req.user, details: `Auto-filled ${filled} referee slot${filled === 1 ? '' : 's'}${stillOpen ? `; ${stillOpen} still open` : ''}` });
  res.json({ filled, stillOpen });
}));

// Assignor confirms who worked. status: checked_in | no_show | assigned (reset)
router.put('/assignments/:id/status', managers, ah(async (req, res) => {
  const { a, game } = await loadAssignment(req.params.id);
  const status = req.body?.status;
  if (!['checked_in', 'no_show', 'assigned'].includes(status)) throw badRequest('Status must be checked_in, no_show, or assigned.');
  if (!a.refereeId) throw badRequest('Nobody is assigned to this slot.');
  if (status !== 'assigned' && game.date > today()) throw badRequest('You can only confirm attendance on or after game day.');
  const profile = await one('SELECT pay_rate_cents FROM referee_profiles WHERE user_id = ?', [a.refereeId]);
  const settings = await getRefSettings();
  if (status === 'checked_in') {
    await run(`UPDATE referee_assignments SET status = 'checked_in', checked_in_at = COALESCE(checked_in_at, datetime('now')),
      check_in_method = COALESCE(check_in_method, 'assignor'), pay_cents = COALESCE(pay_cents, ?), updated_at = datetime('now') WHERE id = ?`,
    [payRate(profile?.payRateCents, settings), a.id]);
  } else {
    await run(`UPDATE referee_assignments SET status = ?, checked_in_at = NULL, check_in_method = NULL, check_in_distance_miles = NULL,
      pay_cents = NULL, updated_at = datetime('now') WHERE id = ?`, [status, a.id]);
  }
  const ref = await one('SELECT first_name, last_name FROM users WHERE id = ?', [a.refereeId]);
  const label = { checked_in: 'worked', no_show: 'a no-show', assigned: 'not yet confirmed' }[status];
  await logActivity({ category: 'referee', action: 'attendance', actor: req.user, details: `Marked ${refName(ref)} as ${label} for ${game.homeTeamName} vs ${game.awayTeamName} on ${game.date}` });
  const [fresh] = await gamesWithAssignments('g.id = ?', [game.id]);
  res.json({ game: fresh });
}));

// =====================================================================
// Referee self-service
// =====================================================================
router.get('/me/assignments', refereeOnly, ah(async (req, res) => {
  const settings = await getRefSettings();
  const now = leagueNow();
  const rows = await all(`SELECT a.id FROM referee_assignments a JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
    WHERE a.referee_id = ? AND r.status IN ('published', 'superseded') AND (r.status = 'published' OR a.status != 'assigned')
    ORDER BY g.date, g.start_time`, [req.user.id]);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return res.json({ assignments: [], settings, today: now.date });
  const games = await gamesWithAssignments(`g.id IN (SELECT game_id FROM referee_assignments WHERE id IN (${ids.map(() => '?').join(',')}))`, ids);
  const assignments = [];
  for (const g of games) {
    const mine = g.assignments.find((x) => x.refereeId === req.user.id);
    if (!mine) continue;
    const win = checkInWindow(g, settings, now);
    assignments.push({
      ...mine, game: g,
      partners: g.assignments.filter((x) => x.id !== mine.id).map((x) => x.refereeName || 'Open'),
      canCheckIn: mine.status === 'assigned' && win.open,
      checkInNote: mine.status === 'assigned' ? win.reason : null,
      canDecline: mine.status === 'assigned' && g.date > now.date && g.status === 'scheduled',
      isPast: g.date < now.date,
      payCents: mine.payCents,
    });
  }
  res.json({ assignments, settings, today: now.date });
}));

router.post('/me/assignments/:id/check-in', refereeOnly, ah(async (req, res) => {
  const { a, game } = await loadAssignment(req.params.id);
  if (a.refereeId !== req.user.id) throw forbidden('That isn’t one of your games.');
  if (a.status === 'checked_in') return res.json({ ok: true, alreadyCheckedIn: true });
  if (a.status !== 'assigned') throw conflict('The assignor has already recorded attendance for this game.');
  const settings = await getRefSettings();
  const win = checkInWindow(game, settings);
  if (!win.open) throw conflict(win.reason);
  let distance = null;
  const { latitude, longitude } = req.body || {};
  if (latitude != null && longitude != null) {
    const venue = await one('SELECT latitude, longitude FROM venues WHERE id = ?', [game.venueId]);
    distance = milesBetween({ lat: Number(latitude), lng: Number(longitude) }, { lat: venue?.latitude, lng: venue?.longitude });
  }
  const profile = await one('SELECT pay_rate_cents FROM referee_profiles WHERE user_id = ?', [req.user.id]);
  await run(`UPDATE referee_assignments SET status = 'checked_in', checked_in_at = datetime('now'), check_in_method = 'referee',
    check_in_distance_miles = ?, pay_cents = ?, updated_at = datetime('now') WHERE id = ?`, [distance, payRate(profile?.payRateCents, settings), a.id]);
  await logActivity({ category: 'referee', action: 'checked in', actor: req.user,
    details: `Checked in for ${game.homeTeamName} vs ${game.awayTeamName} at ${game.venueName}${distance != null ? ` (${distance} mi from the venue)` : ' (location not shared)'}` });
  res.json({ ok: true, distanceMiles: distance });
}));

router.post('/me/assignments/:id/decline', refereeOnly, ah(async (req, res) => {
  const { a, game } = await loadAssignment(req.params.id);
  if (a.refereeId !== req.user.id) throw forbidden('That isn’t one of your games.');
  if (a.status !== 'assigned') throw conflict('Attendance has already been recorded for this game.');
  if (game.date <= today()) throw conflict('It’s game day, so you can’t decline here. Contact the referee assignor directly.');
  const reason = trimOrNull(req.body?.reason);
  if (!reason || reason.length < 3) throw badRequest('Give the assignor a short reason.');
  await run(`UPDATE referee_assignments SET referee_id = NULL, assigned_by = NULL, assigned_at = NULL, updated_at = datetime('now') WHERE id = ?`, [a.id]);
  await notifyAssignors('A referee declined a game', `${req.user.firstName} ${req.user.lastName} can’t work ${gameLine(game)}.\nReason: ${reason}\nThe slot is open again.`);
  await logActivity({ category: 'referee', action: 'declined', actor: req.user, details: `Declined ${game.homeTeamName} vs ${game.awayTeamName} on ${game.date}: ${reason}` });
  res.json({ ok: true });
}));

router.get('/me/unavailability', refereeOnly, ah(async (req, res) => {
  res.json({ unavailable: await all('SELECT * FROM referee_unavailability WHERE user_id = ? AND end_date >= ? ORDER BY start_date', [req.user.id, today()]) });
}));

router.post('/me/unavailability', refereeOnly, ah(async (req, res) => {
  const { startDate, endDate } = req.body || {};
  assertDate(startDate, 'First day'); assertDate(endDate, 'Last day');
  if (endDate < startDate) throw badRequest('The last day must be on or after the first day.');
  if (endDate < today()) throw badRequest('Those dates have already passed.');
  const id = newId();
  await run('INSERT INTO referee_unavailability (id, user_id, start_date, end_date, note) VALUES (?, ?, ?, ?, ?)', [id, req.user.id, startDate, endDate, trimOrNull(req.body.note)]);
  // Games they're already on in that range stay assigned; tell them and the assignor.
  const clashes = await gamesWithAssignments(`g.status = 'scheduled' AND g.date BETWEEN ? AND ? AND g.id IN (SELECT a.game_id FROM referee_assignments a
    JOIN games gg ON gg.id = a.game_id JOIN schedule_runs r ON r.id = gg.run_id WHERE a.referee_id = ? AND r.status = 'published')`, [startDate, endDate, req.user.id]);
  if (clashes.length) {
    await notifyAssignors('A referee marked dates unavailable', `${req.user.firstName} ${req.user.lastName} is unavailable ${startDate} to ${endDate} but is still assigned to:\n${clashes.map(gameLine).join('\n')}`);
  }
  res.status(201).json({ unavailable: await one('SELECT * FROM referee_unavailability WHERE id = ?', [id]), stillAssigned: clashes.length });
}));

router.delete('/me/unavailability/:id', refereeOnly, ah(async (req, res) => {
  const r = await run('DELETE FROM referee_unavailability WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!r.rowsAffected) throw notFound('Unavailable dates');
  res.json({ ok: true });
}));

// =====================================================================
// Payouts — CSV export only; no money moves through this app.
// =====================================================================
async function payoutRows(from, to) {
  const settings = await getRefSettings();
  const rows = await all(`SELECT a.id, a.referee_id, a.checked_in_at, a.check_in_method, a.check_in_distance_miles, a.pay_cents,
      u.first_name, u.last_name, u.email, u.username, rp.pay_rate_cents,
      g.date, g.start_time, d.name AS division_name, ht.name AS home_team_name, at.name AS away_team_name, v.name AS venue_name, c.name AS court_name
    FROM referee_assignments a
    JOIN users u ON u.id = a.referee_id LEFT JOIN referee_profiles rp ON rp.user_id = u.id
    JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
    JOIN divisions d ON d.id = g.division_id JOIN teams ht ON ht.id = g.home_team_id JOIN teams at ON at.id = g.away_team_id
    JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id
    WHERE a.status = 'checked_in' AND g.status != 'cancelled' AND r.status IN ('published', 'superseded') AND g.date BETWEEN ? AND ?
    ORDER BY u.last_name COLLATE NOCASE, u.first_name COLLATE NOCASE, g.date, g.start_time`, [from, to]);
  const detail = rows.map((r) => ({ ...r, amountCents: r.payCents ?? payRate(r.payRateCents, settings) }));
  const byRef = new Map();
  for (const d of detail) {
    if (!byRef.has(d.refereeId)) byRef.set(d.refereeId, { refereeId: d.refereeId, name: `${d.firstName} ${d.lastName}`, email: d.email, username: d.username, games: 0, totalCents: 0 });
    const s = byRef.get(d.refereeId);
    s.games++; s.totalCents += d.amountCents;
  }
  const summary = [...byRef.values()];
  return { detail, summary, totals: { referees: summary.length, games: detail.length, totalCents: summary.reduce((x, s) => x + s.totalCents, 0) } };
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

router.get('/payouts', managers, ah(async (req, res) => {
  const { from, to } = req.query;
  assertDate(from, 'From'); assertDate(to, 'To');
  if (to < from) throw badRequest('“To” must be on or after “From”.');
  const data = await payoutRows(from, to);
  // Open/unconfirmed games in range, so nothing is paid out by accident while incomplete.
  const pending = await one(`SELECT COUNT(*) AS n FROM referee_assignments a JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
    WHERE a.referee_id IS NOT NULL AND a.status = 'assigned' AND r.status = 'published' AND g.status = 'scheduled' AND g.date BETWEEN ? AND ? AND g.date <= ?`, [from, to, today()]);
  if (req.query.format !== 'csv') return res.json({ ...data, unconfirmed: Number(pending.n) });

  const type = req.query.type === 'detail' ? 'detail' : 'summary';
  const csv = type === 'summary'
    ? toCsv(['Referee', 'Email', 'Username', 'Games worked', 'Total ($)'], data.summary.map((s) => [s.name, s.email, s.username, s.games, (s.totalCents / 100).toFixed(2)]))
    : toCsv(['Referee', 'Email', 'Date', 'Start', 'Division', 'Home', 'Away', 'Venue', 'Court', 'Checked in (UTC)', 'Confirmed by', 'Distance from venue (mi)', 'Amount ($)'],
      data.detail.map((d) => [`${d.firstName} ${d.lastName}`, d.email, d.date, d.startTime, d.divisionName, d.homeTeamName, d.awayTeamName, d.venueName, d.courtName,
        d.checkedInAt, d.checkInMethod === 'assignor' ? 'Assignor' : 'Referee check-in', d.checkInDistanceMiles ?? '', (d.amountCents / 100).toFixed(2)]));
  await logActivity({ category: 'referee', action: 'payout export', actor: req.user, details: `Exported referee payouts (${type}) for ${from} to ${to}: ${data.totals.games} games, ${money(data.totals.totalCents)}` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="referee-payouts-${type}-${from}-to-${to}.csv"`);
  res.send(`\uFEFF${csv}`); // BOM so Excel opens UTF-8 names correctly
}));

export default router;

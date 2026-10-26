// Module C — referee assignment, mobile check-in, and payout export.
//   Referee Assignor + System Admin: roster, assigning, auto-fill, marking worked/no-show, payouts.
//   Referee: their own games, decline, check-in, unavailable dates.
import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { assertDate, assertEmail, isValidDate, requireFields, trimOrNull, normalizePhone, formatTime12 } from '../utils/validate.js';
import { hashPassword, tempPassword } from '../utils/security.js';
import { generateUsername } from '../utils/username.js';
import { logActivity } from '../utils/activityLog.js';
import {
  getRefSettings, saveRefSettings, normalizeRefSettings, currentPublishedRun, syncSlots, leagueNow, checkInWindow,
  refereeProblems, loadRefereeContext, activeReferees, gamesWithAssignments, notifyUsers, notifyAssignors, gameLine,
  payRate, milesBetween, autoFill, lowerFirst, payersFor, splitCents, paidByLabel,
} from '../referees/data.js';
import { leagueTimestamp, leagueZoneLabel } from '../utils/leagueTime.js';
import { PAYMENT_METHODS, PAID_WITH, RECENT_CHANGE_DAYS } from '../referees/payMethods.js';

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
// Payment methods (how a referee gets paid: Venmo for now)
// =====================================================================
// userId -> { venmo: { handle, display, updatedAt, recentlyChanged } }
async function methodsFor(userIds) {
  const out = new Map(userIds.map((id) => [id, {}]));
  if (!userIds.length) return out;
  const cutoff = new Date(Date.now() - RECENT_CHANGE_DAYS * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  for (let i = 0; i < userIds.length; i += 500) {
    const chunk = userIds.slice(i, i + 500);
    const rows = await all(`SELECT user_id, method, handle, updated_at FROM referee_payment_methods WHERE user_id IN (${chunk.map(() => '?').join(',')})`, chunk);
    for (const r of rows) {
      const m = PAYMENT_METHODS[r.method];
      if (!m) continue; // a method no longer offered
      out.get(r.userId)[r.method] = { handle: r.handle, display: m.show(r.handle), updatedAt: r.updatedAt, recentlyChanged: r.updatedAt >= cutoff };
    }
  }
  return out;
}

// Saves the methods given in `body` (e.g. { venmo: 'name' }, or '' to remove
// one). Any change is logged and emailed to the referee, so a username can't
// be swapped without them knowing.
async function savePaymentMethods(referee, body, actor) {
  const current = (await methodsFor([referee.id])).get(referee.id);
  const changes = [];
  for (const [key, m] of Object.entries(PAYMENT_METHODS)) {
    if (body?.[key] === undefined) continue;
    const raw = body[key];
    const next = raw === null || String(raw).trim() === '' ? null : m.normalize(raw);
    const before = current[key]?.handle || null;
    if (next === before) continue;
    if (next) {
      await run(`INSERT INTO referee_payment_methods (user_id, method, handle, updated_by) VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, method) DO UPDATE SET handle = excluded.handle, updated_by = excluded.updated_by, updated_at = datetime('now')`, [referee.id, key, next, actor.id]);
    } else {
      await run('DELETE FROM referee_payment_methods WHERE user_id = ? AND method = ?', [referee.id, key]);
    }
    changes.push(next ? `${m.label} username set to ${m.show(next)}` : `${m.label} username removed`);
  }
  if (!changes.length) return [];
  const self = actor.id === referee.id;
  await logActivity({ category: 'referee', action: 'payment details', actor, details: `${refName(referee)}: ${changes.join('; ')}` });
  await notifyUsers('id = ?', [referee.id], 'Your payment details were changed',
    `${self ? 'You changed' : `${actor.firstName} ${actor.lastName} changed`} how you get paid:\n${changes.map((c) => `• ${c}`).join('\n')}\n\nPrograms use this to pay you. If you didn’t expect this change, contact the referee assignor right away.`,
    { label: 'Open My games', url: '/my-games' });
  return changes;
}

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
  const methods = await methodsFor(refs.map((r) => r.id));
  res.json({
    settings: await getRefSettings(),
    referees: refs.map((r) => ({ ...r, isActive: !!r.isActive, unavailable: unav.filter((u) => u.userId === r.id), paymentMethods: methods.get(r.id) })),
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
  // Check a new payment username before saving anything else.
  if (b.paymentMethods) for (const [k, m] of Object.entries(PAYMENT_METHODS)) if (b.paymentMethods[k]) m.normalize(b.paymentMethods[k]);
  if (stmts.length) await db.batch(stmts, 'write');
  if (stmts.length) await logActivity({ category: 'referee', action: 'edited', actor: req.user, details: `Updated referee ${refName(u)}${b.isActive === false ? ' (deactivated; removed from upcoming games)' : ''}` });
  if (b.paymentMethods) await savePaymentMethods(u, b.paymentMethods, req.user);
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
    await notifyUsers('id = ?', [refereeId], 'You have a new game', `You’ve been assigned to referee:\n${gameLine(game)}\n\nIf you can’t make it, decline it under My games before game day.`, { label: 'See your games', url: '/my-games' });
    if (a.refereeId && a.refereeId !== refereeId) await notifyUsers('id = ?', [a.refereeId], 'You’ve been taken off a game', `You’re no longer assigned to ${gameLine(game)}.`, { label: 'See your games', url: '/my-games' });
    await logActivity({ category: 'referee', action: 'assigned', actor: req.user, details: `Assigned ${refName(ref)} to ${game.homeTeamName} vs ${game.awayTeamName} on ${game.date}` });
  } else {
    if (!a.refereeId) return res.json({ ok: true });
    await run(`UPDATE referee_assignments SET referee_id = NULL, status = 'assigned', assigned_by = NULL, assigned_at = NULL,
      checked_in_at = NULL, check_in_method = NULL, check_in_distance_miles = NULL, pay_cents = NULL, updated_at = datetime('now') WHERE id = ?`, [a.id]);
    await notifyUsers('id = ?', [a.refereeId], 'You’ve been taken off a game', `You’re no longer assigned to ${gameLine(game)}.`, { label: 'See your games', url: '/my-games' });
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
    await notifyUsers('id = ?', [id], `You have ${list.length} new game${list.length > 1 ? 's' : ''}`, `You’ve been assigned to referee:\n${list.map(gameLine).join('\n')}\n\nIf you can’t make one, decline it under My games before game day.`, { label: 'See your games', url: '/my-games' });
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
  // What programs have marked as paid, per game.
  const paid = new Map();
  if (assignments.length) {
    const aIds = assignments.map((a) => a.id);
    const rows = await all(`SELECT i.assignment_id, i.amount_cents, p.paid_on, p.method, pr.name AS program_name, p.confirmed_at
      FROM referee_payment_items i JOIN referee_payments p ON p.id = i.payment_id JOIN programs pr ON pr.id = p.program_id
      WHERE p.referee_id = ? AND i.assignment_id IN (${aIds.map(() => '?').join(',')}) ORDER BY p.paid_on`, [req.user.id, ...aIds]);
    for (const r of rows) {
      if (!paid.has(r.assignmentId)) paid.set(r.assignmentId, []);
      paid.get(r.assignmentId).push({ programName: r.programName, amountCents: r.amountCents, paidOn: r.paidOn, method: PAID_WITH[r.method] || r.method });
    }
  }
  for (const a of assignments) a.paid = paid.get(a.id) || [];
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

// How the referee gets paid (their own Venmo username, etc.).
router.get('/me/payment-methods', refereeOnly, ah(async (req, res) => {
  res.json({ paymentMethods: (await methodsFor([req.user.id])).get(req.user.id), offered: Object.entries(PAYMENT_METHODS).map(([id, m]) => ({ id, label: m.label })) });
}));
router.put('/me/payment-methods', refereeOnly, ah(async (req, res) => {
  const me = await one('SELECT * FROM users WHERE id = ?', [req.user.id]);
  await savePaymentMethods(me, req.body || {}, req.user);
  res.json({ paymentMethods: (await methodsFor([req.user.id])).get(req.user.id) });
}));

// Payments programs have marked as paid to this referee, newest first.
router.get('/me/payments', refereeOnly, ah(async (req, res) => {
  const rows = await all(`SELECT p.*, pr.name AS program_name, (SELECT COUNT(*) FROM referee_payment_items i WHERE i.payment_id = p.id) AS games
    FROM referee_payments p JOIN programs pr ON pr.id = p.program_id WHERE p.referee_id = ? ORDER BY p.paid_on DESC, p.created_at DESC`, [req.user.id]);
  res.json({ payments: rows.map((p) => ({ id: p.id, programName: p.programName, amountCents: p.amountCents, method: PAID_WITH[p.method] || p.method,
    paidOn: p.paidOn, note: p.note, games: Number(p.games), confirmedAt: p.confirmedAt })) });
}));
// "Got it": the referee confirms the money arrived.
router.post('/me/payments/:id/confirm', refereeOnly, ah(async (req, res) => {
  const p = await one('SELECT p.*, pr.name AS program_name FROM referee_payments p JOIN programs pr ON pr.id = p.program_id WHERE p.id = ? AND p.referee_id = ?', [req.params.id, req.user.id]);
  if (!p) throw notFound('Payment');
  if (!p.confirmedAt) {
    await run("UPDATE referee_payments SET confirmed_at = datetime('now') WHERE id = ?", [p.id]);
    await logActivity({ category: 'referee', action: 'payment received', actor: req.user, programId: p.programId,
      details: `${refName(req.user)} confirmed receiving ${money(p.amountCents)} from ${p.programName} (${PAID_WITH[p.method] || p.method}, ${p.paidOn})` });
  }
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
// One row per PAYMENT: a referee on a game, and the program that pays them
// (see payersFor). A referee the two programs split appears as two rows of half.
// programId limits the rows to what that program pays (what a Program Director
// sees). Leave it out for the whole league.
async function payoutRows(from, to, programId = null) {
  const settings = await getRefSettings();
  const rows = await all(`SELECT a.id, a.game_id, a.position, a.referee_id, a.checked_in_at, a.check_in_method, a.check_in_distance_miles, a.pay_cents,
      u.first_name, u.last_name, u.email, u.username, rp.pay_rate_cents,
      g.date, g.start_time, g.end_time, g.home_score, g.away_score, d.name AS division_name,
      ht.name AS home_team_name, at.name AS away_team_name, hp.name AS home_program_name, ap.name AS away_program_name,
      ht.program_id AS home_program_id, at.program_id AS away_program_id,
      hp.is_guest AS home_is_guest, ap.is_guest AS away_is_guest,
      v.name AS venue_name, c.name AS court_name
    FROM referee_assignments a
    JOIN users u ON u.id = a.referee_id LEFT JOIN referee_profiles rp ON rp.user_id = u.id
    JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
    JOIN divisions d ON d.id = g.division_id
    JOIN teams ht ON ht.id = g.home_team_id JOIN programs hp ON hp.id = ht.program_id
    JOIN teams at ON at.id = g.away_team_id JOIN programs ap ON ap.id = at.program_id
    JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id
    WHERE a.status = 'checked_in' AND g.status != 'cancelled' AND r.status IN ('published', 'superseded') AND g.date BETWEEN ? AND ?
      ${programId ? 'AND ? IN (ht.program_id, at.program_id)' : ''}
    ORDER BY u.last_name COLLATE NOCASE, u.first_name COLLATE NOCASE, g.date, g.start_time`,
  programId ? [from, to, programId] : [from, to]);

  // Every referee slot on those games, to work out who pays whom.
  const gameIds = [...new Set(rows.map((r) => r.gameId))];
  const crew = new Map(gameIds.map((id) => [id, []]));
  for (let i = 0; i < gameIds.length; i += 500) {
    const chunk = gameIds.slice(i, i + 500);
    const slots = await all(`SELECT a.id, a.game_id, a.position, a.referee_id, a.status, u.first_name || ' ' || u.last_name AS referee_name
      FROM referee_assignments a LEFT JOIN users u ON u.id = a.referee_id WHERE a.game_id IN (${chunk.map(() => '?').join(',')}) ORDER BY a.position`, chunk);
    for (const x of slots) crew.get(x.gameId).push(x);
  }
  const payers = new Map(); // gameId -> Map(assignmentId -> shares)
  const detail = [];
  for (const r of rows) {
    if (!payers.has(r.gameId)) payers.set(r.gameId, payersFor(r, crew.get(r.gameId)));
    const forGame = payers.get(r.gameId);
    // Guest teams are marked in names so exports never mix them up with league teams.
    const home = `${r.homeTeamName}${r.homeIsGuest ? ' (guest)' : ''}`;
    const away = `${r.awayTeamName}${r.awayIsGuest ? ' (guest)' : ''}`;
    const fullCents = r.payCents ?? payRate(r.payRateCents, settings);
    const shares = splitCents(fullCents, forGame.get(r.id) || []);
    // The rest of the crew and who pays them, so a program can see nothing is missing.
    const others = crew.get(r.gameId).filter((x) => x.id !== r.id && forGame.has(x.id))
      .map((x) => ({ name: x.refereeName, position: x.position, paidBy: paidByLabel(forGame.get(x.id)) }));
    for (const sh of shares) {
      if (programId && sh.programId !== programId) continue;
      detail.push({ ...r, id: `${r.id}:${sh.programId}`, assignmentId: r.id, homeTeamName: home, awayTeamName: away, isGuestGame: !!(r.homeIsGuest || r.awayIsGuest),
        matchup: `${home} vs ${away}`, fullCents, amountCents: sh.cents, isSplit: shares.length > 1,
        paidByProgramId: sh.programId, paidByName: sh.programName, paidByIsGuest: sh.isGuest,
        splitWith: shares.length > 1 ? shares.find((x) => x.programId !== sh.programId)?.programName : null, others });
    }
  }
  // What each program has already marked as paid for each of these games.
  const paidBy = new Map(); // `${assignmentId}:${programId}` -> cents
  const aIds = [...new Set(detail.map((d) => d.assignmentId))];
  for (let i = 0; i < aIds.length; i += 500) {
    const chunk = aIds.slice(i, i + 500);
    const rows = await all(`SELECT i.assignment_id, p.program_id, SUM(i.amount_cents) AS cents FROM referee_payment_items i
      JOIN referee_payments p ON p.id = i.payment_id WHERE i.assignment_id IN (${chunk.map(() => '?').join(',')}) GROUP BY i.assignment_id, p.program_id`, chunk);
    for (const r of rows) paidBy.set(`${r.assignmentId}:${r.programId}`, Number(r.cents));
  }
  for (const d of detail) {
    d.paidCents = paidBy.get(d.id) || 0;
    d.outstandingCents = Math.max(0, d.amountCents - d.paidCents);
    d.payStatus = d.outstandingCents === 0 ? 'paid' : d.paidCents ? 'part' : 'unpaid';
  }

  const byRef = new Map();
  const byProgram = new Map();
  const counted = new Set();
  for (const d of detail) {
    if (!byRef.has(d.refereeId)) byRef.set(d.refereeId, { refereeId: d.refereeId, name: `${d.firstName} ${d.lastName}`, email: d.email, username: d.username, games: 0, totalCents: 0, paidCents: 0, unpaidCents: 0 });
    const s = byRef.get(d.refereeId);
    if (!counted.has(d.assignmentId)) { counted.add(d.assignmentId); s.games++; }
    s.totalCents += d.amountCents; s.paidCents += Math.min(d.paidCents, d.amountCents); s.unpaidCents += d.outstandingCents;
    if (!byProgram.has(d.paidByProgramId)) byProgram.set(d.paidByProgramId, { programId: d.paidByProgramId, name: d.paidByName, isGuest: d.paidByIsGuest, payments: 0, totalCents: 0, paidCents: 0, unpaidCents: 0 });
    const p = byProgram.get(d.paidByProgramId);
    p.payments++; p.totalCents += d.amountCents; p.paidCents += Math.min(d.paidCents, d.amountCents); p.unpaidCents += d.outstandingCents;
  }
  const summary = [...byRef.values()];
  const methods = await methodsFor(summary.map((s) => s.refereeId));
  for (const s of summary) s.paymentMethods = methods.get(s.refereeId);
  const programs = [...byProgram.values()].sort((a, b) => a.name.localeCompare(b.name));
  const sum = (k) => summary.reduce((x, s) => x + s[k], 0);
  return { detail, summary, programs, totals: { referees: summary.length, games: counted.size, totalCents: sum('totalCents'), paidCents: sum('paidCents'), unpaidCents: sum('unpaidCents') } };
}

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (header, rows) => [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');

// Program Directors see the referees THEIR program pays; the assignor and
// System Admin see the whole league, with who pays each referee.
router.get('/payouts', requireRole('super_admin', 'referee_assignor', 'program_director'), ah(async (req, res) => {
  const { from, to } = req.query;
  assertDate(from, 'From'); assertDate(to, 'To');
  if (to < from) throw badRequest('“To” must be on or after “From”.');
  // Directors see their own program. The league sees everything, or one
  // program when one is chosen in the header (to mark payments on its behalf).
  const scopeProgram = req.user.role === 'program_director' ? req.user.programId : (req.query.programId || null);
  if (req.user.role === 'program_director' && !scopeProgram) throw forbidden('Your account isn’t assigned to a program.');
  const data = await payoutRows(from, to, scopeProgram);
  data.payments = await paymentsFor(data, scopeProgram, req.user);
  // Open/unconfirmed games in range, so nothing is paid out by accident while incomplete.
  const pending = await one(`SELECT COUNT(*) AS n FROM referee_assignments a JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
    JOIN teams ht ON ht.id = g.home_team_id JOIN teams at ON at.id = g.away_team_id
    WHERE a.referee_id IS NOT NULL AND a.status = 'assigned' AND r.status = 'published' AND g.status = 'scheduled'
      AND g.date BETWEEN ? AND ? AND g.date <= ?${scopeProgram ? ' AND ? IN (ht.program_id, at.program_id)' : ''}`,
  scopeProgram ? [from, to, today(), scopeProgram] : [from, to, today()]);
  if (req.query.format !== 'csv') return res.json({ ...data, unconfirmed: Number(pending.n), scope: scopeProgram ? 'program' : 'league' });

  const type = ['detail', 'programs'].includes(req.query.type) ? req.query.type : 'summary';
  const usd = (c) => (c / 100).toFixed(2);
  const csv = type === 'summary'
    ? toCsv(['Referee', 'Email', 'Username', 'Venmo', 'Games worked', 'Total ($)', 'Paid ($)', 'Unpaid ($)'], data.summary.map((s) => [s.name, s.email, s.username, s.paymentMethods?.venmo?.display || '', s.games, usd(s.totalCents), usd(s.paidCents), usd(s.unpaidCents)]))
    : type === 'programs'
      ? toCsv(['Program', 'Referee payments', 'Total ($)', 'Paid ($)', 'Unpaid ($)'], data.programs.map((p) => [p.name, p.payments, usd(p.totalCents), usd(p.paidCents), usd(p.unpaidCents)]))
      // One row per payment. Check-in times are stored in UTC and exported in league time, where the games are played.
      : toCsv(['Referee', 'Email', 'Date', 'Home team', 'Away team', `Checked in (${leagueZoneLabel()})`, 'Confirmed by', 'Paid by', 'Share', 'Amount ($)', 'Status', 'Paid ($)'],
        data.detail.map((d) => [`${d.firstName} ${d.lastName}`, d.email, d.date, d.homeTeamName, d.awayTeamName,
          leagueTimestamp(d.checkedInAt), d.checkInMethod === 'assignor' ? 'Assignor' : 'Referee check-in', d.paidByName, d.isSplit ? 'Half' : 'Full', usd(d.amountCents),
          { paid: 'Paid', part: 'Partly paid', unpaid: 'Unpaid' }[d.payStatus], usd(Math.min(d.paidCents, d.amountCents))]));
  await logActivity({ category: 'referee', action: 'payout export', actor: req.user, details: `Exported referee payouts (${type}) for ${from} to ${to}: ${data.totals.games} games worked, ${money(data.totals.totalCents)}` });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="referee-payouts-${type}-${from}-to-${to}.csv"`);
  res.send(`\uFEFF${csv}`); // BOM so Excel opens UTF-8 names correctly
}));

// Payments covering the games on the page, newest first. canUndo: the league
// always; a director for their own program's payments until the referee has
// confirmed receiving it.
async function paymentsFor(data, scopeProgram, user) {
  const aIds = [...new Set(data.detail.map((d) => d.assignmentId))];
  if (!aIds.length) return [];
  const ids = new Set();
  for (let i = 0; i < aIds.length; i += 500) {
    const chunk = aIds.slice(i, i + 500);
    for (const r of await all(`SELECT DISTINCT payment_id FROM referee_payment_items WHERE assignment_id IN (${chunk.map(() => '?').join(',')})`, chunk)) ids.add(r.paymentId);
  }
  if (!ids.size) return [];
  const list = [...ids];
  const rows = await all(`SELECT p.*, pr.name AS program_name, u.first_name || ' ' || u.last_name AS recorded_by_name,
      (SELECT COUNT(*) FROM referee_payment_items i WHERE i.payment_id = p.id) AS games
    FROM referee_payments p JOIN programs pr ON pr.id = p.program_id LEFT JOIN users u ON u.id = p.recorded_by
    WHERE p.id IN (${list.map(() => '?').join(',')})${scopeProgram ? ' AND p.program_id = ?' : ''} ORDER BY p.paid_on DESC, p.created_at DESC`,
  scopeProgram ? [...list, scopeProgram] : list);
  const league = ['super_admin', 'referee_assignor'].includes(user.role);
  return rows.map((p) => ({ id: p.id, refereeId: p.refereeId, programId: p.programId, programName: p.programName, method: p.method, methodLabel: PAID_WITH[p.method] || p.method,
    amountCents: p.amountCents, paidOn: p.paidOn, note: p.note, games: Number(p.games), recordedByName: p.recordedByName, createdAt: p.createdAt, confirmedAt: p.confirmedAt,
    canUndo: league || (p.programId === user.programId && !p.confirmedAt) }));
}

// ---- POST /api/referees/payments ----  Mark as paid.
// { refereeId, programId (league only; a director always pays for their own
//   program), assignmentIds: [...], method, paidOn, note }
// Each game must still be owed by that program; what's recorded is what was
// still owed for it.
router.post('/payments', requireRole('super_admin', 'referee_assignor', 'program_director'), ah(async (req, res) => {
  const b = req.body || {};
  const programId = req.user.role === 'program_director' ? req.user.programId : b.programId;
  if (!programId) throw badRequest('Choose which program made the payment.');
  const program = await one('SELECT id, name FROM programs WHERE id = ?', [programId]);
  if (!program) throw notFound('Program');
  const referee = await one("SELECT * FROM users WHERE id = ? AND role = 'referee'", [b.refereeId]);
  if (!referee) throw notFound('Referee');
  if (!PAID_WITH[b.method]) throw badRequest('Choose how it was paid.');
  assertDate(b.paidOn, 'Paid on');
  if (b.paidOn > today()) throw badRequest('The payment date can’t be in the future.');
  const ids = [...new Set(Array.isArray(b.assignmentIds) ? b.assignmentIds : [])];
  if (!ids.length) throw badRequest('Choose at least one game.');

  const owed = (await payoutRows('0000-01-01', '9999-12-31', programId)).detail.filter((d) => d.refereeId === referee.id && ids.includes(d.assignmentId));
  if (owed.length !== ids.length) throw conflict(`Some of those games aren’t owed by ${program.name} any more. Refresh the page and try again.`);
  if (owed.some((d) => d.outstandingCents <= 0)) throw conflict('Some of those games are already marked as paid. Refresh the page to see the latest.');
  const amount = owed.reduce((n, d) => n + d.outstandingCents, 0);
  const id = newId();
  const note = trimOrNull(b.note)?.slice(0, 300) || null;
  await db.batch([
    { sql: 'INSERT INTO referee_payments (id, referee_id, program_id, method, amount_cents, paid_on, note, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      args: [id, referee.id, programId, b.method, amount, b.paidOn, note, req.user.id] },
    ...owed.map((d) => ({ sql: 'INSERT INTO referee_payment_items (payment_id, assignment_id, amount_cents, game_date, game_label) VALUES (?, ?, ?, ?, ?)',
      args: [id, d.assignmentId, d.outstandingCents, d.date, `${d.matchup} · ${d.divisionName}`] })),
  ], 'write');
  const what = `${money(amount)} for ${owed.length} game${owed.length === 1 ? '' : 's'}`;
  await logActivity({ category: 'referee', action: 'payment', actor: req.user, programId,
    details: `${program.name} paid ${refName(referee)} ${what} (${PAID_WITH[b.method]}, ${b.paidOn})${note ? `: ${note}` : ''}` });
  await notifyUsers('id = ?', [referee.id], `${program.name} marked a payment to you`,
    `${program.name} marked ${what} as paid by ${PAID_WITH[b.method]} on ${b.paidOn}.${note ? `\nNote: ${note}` : ''}\n\nWhen it arrives, open My games and choose Got it, so they know you received it.`,
    { label: 'Open My games', url: '/my-games' });
  res.status(201).json({ payment: { id, amountCents: amount, games: owed.length } });
}));

// ---- DELETE /api/referees/payments/:id ----  Undo a mark (e.g. marked by mistake).
router.delete('/payments/:id', requireRole('super_admin', 'referee_assignor', 'program_director'), ah(async (req, res) => {
  const p = await one('SELECT p.*, pr.name AS program_name FROM referee_payments p JOIN programs pr ON pr.id = p.program_id WHERE p.id = ?', [req.params.id]);
  if (!p) throw notFound('Payment');
  if (req.user.role === 'program_director') {
    if (p.programId !== req.user.programId) throw forbidden('That payment belongs to another program.');
    if (p.confirmedAt) throw conflict('The referee has already confirmed receiving this payment. Ask the league if it needs to be undone.');
  }
  const referee = await one('SELECT * FROM users WHERE id = ?', [p.refereeId]);
  await run('DELETE FROM referee_payment_items WHERE payment_id = ?', [p.id]);
  await run('DELETE FROM referee_payments WHERE id = ?', [p.id]);
  await logActivity({ category: 'referee', action: 'payment undone', actor: req.user, programId: p.programId,
    details: `Undid ${p.programName}’s payment of ${money(p.amountCents)} to ${referee ? refName(referee) : 'a referee'} (${PAID_WITH[p.method] || p.method}, ${p.paidOn})` });
  if (referee) await notifyUsers('id = ?', [referee.id], `A payment from ${p.programName} was taken back off the record`,
    `${p.programName}’s payment of ${money(p.amountCents)} (${PAID_WITH[p.method] || p.method}, ${p.paidOn}) was marked by mistake and has been removed from the record. Those games show as unpaid again.`,
    { label: 'Open My games', url: '/my-games' });
  res.json({ ok: true });
}));

export default router;

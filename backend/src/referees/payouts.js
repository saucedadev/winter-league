// Referee payouts: who is owed what, by which program, and what has been paid.
// Used by the payouts page (routes/referees.js) and the referee reserve
// (routes/reserves.js).
import { all } from '../db/client.js';
import { getRefSettings, payRate, payersFor, splitCents, paidByLabel } from './data.js';
import { PAYMENT_METHODS, RECENT_CHANGE_DAYS } from './payMethods.js';

// userId -> { venmo: { handle, display, updatedAt, recentlyChanged } }
export async function methodsFor(userIds) {
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

// One row per PAYMENT: a referee on a game, and the program that pays them
// (see payersFor). A referee the two programs split appears as two rows of half.
// programId limits the rows to what that program pays (what a Program Director
// sees). Leave it out for the whole league.
export async function payoutRows(from, to, programId = null) {
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
  // How each paying program pays its referees ('direct' or 'reserve').
  const payerIds = [...new Set(detail.map((d) => d.paidByProgramId))];
  const modes = new Map();
  if (payerIds.length) for (const p of await all(`SELECT id, referee_pay_mode FROM programs WHERE id IN (${payerIds.map(() => '?').join(',')})`, payerIds)) modes.set(p.id, p.refereePayMode);
  for (const d of detail) {
    d.payerMode = modes.get(d.paidByProgramId) || 'direct';
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


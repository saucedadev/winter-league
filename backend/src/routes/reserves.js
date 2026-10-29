// Referee payout reserve (see referees/reserve.js for how the figures work).
//   Program Director: their own program's reserve: add deposits (the assignor
//     confirms them), see the statement, set a low-balance alert.
//   Referee Assignor + System Admin: every program's reserve, including guest
//     programs: confirm or decline deposits, record deposits, refunds and
//     adjustments, refund what's left at season end, switch a program between
//     paying referees directly and paying from a reserve.
// Confirmed entries are never edited or deleted; a mistake is corrected with a
// reversing adjustment, so the statement always explains itself.
import { Router } from 'express';
import { one, all, run, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest, conflict, forbidden, notFound } from '../utils/http.js';
import { assertDate, trimOrNull } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';
import { leagueNow, notifyUsers, notifyAssignors } from '../referees/data.js';
import { PAID_WITH } from '../referees/payMethods.js';
import { RESERVE_METHODS, seasonFor, reserveFigures, checkReserveAlert } from '../referees/reserve.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'referee_assignor', 'program_director'));

const today = () => leagueNow().date;
const isLeague = (u) => u.role === 'super_admin' || u.role === 'referee_assignor';
const money = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const KIND_LABEL = { deposit: 'Deposit', refund: 'Refund', adjustment: 'Adjustment' };
const csvCell = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const toCsv = (header, rows) => `﻿${[header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}`;
const usd = (c) => (c / 100).toFixed(2);

async function requireSeason(req) {
  const season = await seasonFor(req.query.seasonId || null);
  if (!season) throw conflict('There’s no active season yet. Reserves are kept per season, so set one up under League setup first.');
  return season;
}
async function loadProgram(req, id) {
  const p = await one('SELECT * FROM programs WHERE id = ?', [id]);
  if (!p) throw notFound('Program');
  if (!isLeague(req.user) && p.id !== req.user.programId) throw forbidden('You can only see your own program’s reserve.');
  return p;
}
const toProgram = (programId, subject, text) => notifyUsers("role = 'program_director' AND program_id = ?", [programId], subject, text, { label: 'Open Referee reserve', url: '/reserve' });

// ---- GET /api/reserves ----  Summary: one row per program (a director: just theirs).
router.get('/', ah(async (req, res) => {
  const season = await requireSeason(req);
  const seasons = await all('SELECT id, name, start_date, end_date, is_active FROM seasons ORDER BY start_date DESC');
  if (!isLeague(req.user)) {
    if (!req.user.programId) throw forbidden('Your account isn’t assigned to a program.');
    const f = (await reserveFigures(season, [req.user.programId])).get(req.user.programId);
    return res.json({ season, seasons, scope: 'program', programs: [f] });
  }
  // Active programs, plus any inactive one that has reserve activity this season.
  const all1 = [...(await reserveFigures(season)).values()];
  const programs = all1.filter((f) => f.isActive || f.deposited || f.paidOut || f.refunded || f.adjusted || f.pendingDeposits);
  const reserveOnes = programs.filter((f) => f.mode === 'reserve' || f.balance || f.deposited);
  const total = (k) => reserveOnes.reduce((n, f) => n + f[k], 0);
  const totals = { deposited: total('deposited'), paidOut: total('paidOut'), refunded: total('refunded'), adjusted: total('adjusted'), balance: total('balance'),
    owed: total('owed'), upcoming: total('upcoming'), available: total('available'), pendingDeposits: programs.reduce((n, f) => n + f.pendingDeposits, 0) };
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="referee-reserves-${season.name.replace(/[^\w-]+/g, '-')}.csv"`);
    return res.send(toCsv(['Program', 'Guest', 'Pays referees', 'Deposited ($)', 'Adjustments ($)', 'Refunded ($)', 'Paid out ($)', 'Balance ($)', 'Owed, not yet paid ($)', 'Upcoming, estimate ($)', 'Available ($)', 'Deposits waiting'],
      programs.map((f) => [f.name, f.isGuest ? 'Yes' : '', f.mode === 'reserve' ? 'From reserve' : 'Directly', usd(f.deposited), usd(f.adjusted), usd(f.refunded), usd(f.paidOut), usd(f.balance), usd(f.owed), usd(f.upcoming), usd(f.available), f.pendingDeposits])));
  }
  res.json({ season, seasons, scope: 'league', programs, totals });
}));

// ---- GET /api/reserves/:programId ----  One program: figures, entries, statement.
// Statement: opening balance before `from`, every deposit, refund, adjustment and
// referee payout in [from, to] with a running balance, and the closing balance.
router.get('/:programId', ah(async (req, res) => {
  const season = await requireSeason(req);
  const p = await loadProgram(req, req.params.programId);
  const f = (await reserveFigures(season, [p.id])).get(p.id);
  const entries = await all(`SELECT e.*, u.first_name || ' ' || u.last_name AS entered_by_name, d.first_name || ' ' || d.last_name AS decided_by_name,
      (SELECT COUNT(*) FROM reserve_entries x WHERE x.reverses_id = e.id) AS reversed
    FROM reserve_entries e LEFT JOIN users u ON u.id = e.entered_by LEFT JOIN users d ON d.id = e.decided_by
    WHERE e.program_id = ? AND e.season_id = ? ORDER BY e.entry_date, e.entered_at`, [p.id, season.id]);
  const payouts = await all(`SELECT rp.*, u.first_name || ' ' || u.last_name AS referee_name, r.first_name || ' ' || r.last_name AS recorded_by_name
    FROM referee_payments rp JOIN users u ON u.id = rp.referee_id LEFT JOIN users r ON r.id = rp.recorded_by
    WHERE rp.program_id = ? AND rp.from_reserve = 1 AND rp.season_id = ? ORDER BY rp.paid_on, rp.created_at`, [p.id, season.id]);
  const items = payouts.length ? await all(`SELECT payment_id, game_date, game_label, amount_cents FROM referee_payment_items
    WHERE payment_id IN (${payouts.map(() => '?').join(',')}) ORDER BY game_date`, payouts.map((x) => x.id)) : [];

  const lines = [
    ...entries.filter((e) => e.status === 'confirmed').map((e) => ({
      type: e.kind, id: e.id, date: e.entryDate, at: e.enteredAt, label: KIND_LABEL[e.kind], method: RESERVE_METHODS[e.method] || null, note: e.note,
      cents: e.kind === 'refund' ? -e.amountCents : e.amountCents, by: e.enteredByName, confirmedBy: e.decidedBy && e.decidedBy !== e.enteredBy ? e.decidedByName : null, reversesId: e.reversesId, reversed: Number(e.reversed) > 0,
      canReverse: isLeague(req.user) && !e.reversesId && Number(e.reversed) === 0,
    })),
    ...payouts.map((x) => ({
      type: 'payout', id: x.id, date: x.paidOn, at: x.createdAt, label: `Paid ${x.refereeName}`, method: PAID_WITH[x.method] || x.method, note: x.note, cents: -x.amountCents, by: x.recordedByName,
      games: items.filter((i) => i.paymentId === x.id).map((i) => ({ date: i.gameDate, label: i.gameLabel, cents: i.amountCents })), confirmedAt: x.confirmedAt,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.at.localeCompare(b.at));
  const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
  const to = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
  let running = 0;
  let opening = 0;
  const shown = [];
  for (const l of lines) {
    if (from && l.date < from) { opening += l.cents; running += l.cents; continue; }
    if (to && l.date > to) continue;
    running += l.cents;
    shown.push({ ...l, balance: running });
  }
  const statement = { from, to, opening, closing: running, lines: shown };

  if (req.query.format === 'csv') {
    const rows = [['', 'Opening balance', '', '', '', '', usd(opening)]];
    for (const l of shown) rows.push([l.date, l.label, l.method || '', l.type === 'payout' ? l.games.map((g) => `${g.date} ${g.label}`).join('; ') : (l.note || ''), [l.by, l.confirmedBy && `confirmed by ${l.confirmedBy}`].filter(Boolean).join(', '), usd(l.cents), usd(l.balance)]);
    rows.push(['', 'Closing balance', '', '', '', '', usd(running)]);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="referee-reserve-${p.shortCode || 'program'}-${season.name.replace(/[^\w-]+/g, '-')}.csv"`);
    return res.send(toCsv(['Date', 'Entry', 'Method', 'Details', 'By', 'Amount ($)', 'Balance ($)'], rows));
  }
  res.json({
    season, program: { id: p.id, name: p.name, isGuest: !!p.isGuest, mode: p.refereePayMode, alertCents: p.reserveAlertCents },
    figures: f, statement,
    pending: entries.filter((e) => e.status === 'pending').map((e) => ({ id: e.id, amountCents: e.amountCents, method: RESERVE_METHODS[e.method] || e.method, date: e.entryDate, note: e.note, enteredByName: e.enteredByName, enteredAt: e.enteredAt })),
    declined: entries.filter((e) => e.status === 'declined').map((e) => ({ id: e.id, amountCents: e.amountCents, method: RESERVE_METHODS[e.method] || e.method, date: e.entryDate, note: e.note, decisionNote: e.decisionNote, decidedByName: e.decidedByName })),
  });
}));

// ---- PUT /api/reserves/:programId/settings ----  { mode?: 'direct'|'reserve', alertCents?: n|null }
router.put('/:programId/settings', ah(async (req, res) => {
  const p = await loadProgram(req, req.params.programId);
  const b = req.body || {};
  if (b.mode !== undefined) {
    if (!isLeague(req.user)) throw forbidden('The league switches how a program pays its referees.');
    if (!['direct', 'reserve'].includes(b.mode)) throw badRequest('Choose direct or reserve.');
    if (b.mode !== p.refereePayMode) {
      await run("UPDATE programs SET referee_pay_mode = ?, updated_at = datetime('now') WHERE id = ?", [b.mode, p.id]);
      await logActivity({ category: 'referee', action: 'reserve', actor: req.user, programId: p.id,
        details: `${p.name} now ${b.mode === 'reserve' ? 'pays referees from a reserve held by the referee assignor' : 'pays its referees directly'}` });
      await toProgram(p.id, `${p.name}: how referees are paid has changed`, b.mode === 'reserve'
        ? 'Your program now pays its referees from a reserve: you pay the referee assignor in advance, add each payment under Referee reserve, and the assignor pays your referees from it.'
        : 'Your program now pays its referees directly again: pay them from Referee payouts and mark each payment as paid.');
    }
  }
  if (b.alertCents !== undefined) {
    const v = b.alertCents === null || b.alertCents === '' ? null : Number(b.alertCents);
    if (v !== null && (!Number.isInteger(v) || v < 0 || v > 10000000)) throw badRequest('Enter the alert level in whole cents (e.g. 10000 = $100.00), or leave it blank for no alert.');
    await run("UPDATE programs SET reserve_alert_cents = ?, reserve_alerted = 0, updated_at = datetime('now') WHERE id = ?", [v, p.id]);
    await checkReserveAlert(p.id);
  }
  res.json({ ok: true });
}));

// ---- POST /api/reserves/:programId/entries ----
// { kind: deposit|refund|adjustment, amountCents, method, entryDate, note, reversesId }
//   Director: deposits only, for their own program; they wait for the assignor to confirm.
//   League: deposits (confirmed straight away; they're the ones holding the
//   money), refunds, adjustments (+ or -, note required), and reversals
//   ({ reversesId, note }) which undo a confirmed entry with an opposite adjustment.
router.post('/:programId/entries', ah(async (req, res) => {
  const p = await loadProgram(req, req.params.programId);
  const season = await one('SELECT * FROM seasons WHERE is_active = 1');
  if (!season) throw conflict('There’s no active season yet.');
  const b = req.body || {};
  const league = isLeague(req.user);
  const note = trimOrNull(b.note)?.slice(0, 300) || null;
  const date = b.entryDate || today();
  assertDate(date, 'Date');
  if (date > today()) throw badRequest('The date can’t be in the future.');

  // Reversal of a confirmed entry.
  if (b.reversesId) {
    if (!league) throw forbidden('Ask the referee assignor to correct an entry.');
    const orig = await one("SELECT * FROM reserve_entries WHERE id = ? AND program_id = ? AND status = 'confirmed'", [b.reversesId, p.id]);
    if (!orig) throw notFound('Entry');
    if (orig.reversesId) throw conflict('That entry is itself a correction. Record a new adjustment instead.');
    if (await one('SELECT 1 FROM reserve_entries WHERE reverses_id = ?', [orig.id])) throw conflict('That entry has already been reversed.');
    if (!note) throw badRequest('Say why it’s being reversed, for the program’s statement.');
    const effect = orig.kind === 'refund' ? -orig.amountCents : orig.amountCents;
    const id = newId();
    await run(`INSERT INTO reserve_entries (id, program_id, season_id, kind, amount_cents, method, entry_date, note, status, reverses_id, entered_by, decided_by, decided_at)
      VALUES (?, ?, ?, 'adjustment', ?, NULL, ?, ?, 'confirmed', ?, ?, ?, datetime('now'))`, [id, p.id, orig.seasonId, -effect, date, note, orig.id, req.user.id, req.user.id]);
    await logActivity({ category: 'referee', action: 'reserve', actor: req.user, programId: p.id,
      details: `Reversed ${p.name}’s ${KIND_LABEL[orig.kind].toLowerCase()} of ${money(orig.amountCents)} (${orig.entryDate}): ${note}` });
    if (!p.isGuest) await toProgram(p.id, `${p.name}: a reserve entry was corrected`, `The ${KIND_LABEL[orig.kind].toLowerCase()} of ${money(orig.amountCents)} on ${orig.entryDate} was reversed.\nReason: ${note}`);
    await checkReserveAlert(p.id);
    return res.status(201).json({ entry: { id } });
  }

  const kind = b.kind;
  if (!['deposit', 'refund', 'adjustment'].includes(kind)) throw badRequest('Choose deposit, refund, or adjustment.');
  if (!league && kind !== 'deposit') throw forbidden('Directors add deposits. Refunds and adjustments are recorded by the referee assignor.');
  const amount = Number(b.amountCents);
  if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 10000000) throw badRequest('Enter the amount in dollars and cents.');
  if (kind !== 'adjustment' && amount < 0) throw badRequest('Enter a positive amount.');
  if (kind === 'adjustment' && !note) throw badRequest('Say what the adjustment is for, for the program’s statement.');
  if (kind !== 'adjustment' && !RESERVE_METHODS[b.method]) throw badRequest('Choose how the money was paid.');
  if (kind === 'deposit' && p.refereePayMode !== 'reserve') throw conflict(`${p.name} pays its referees directly, so it doesn’t have a reserve. The league can switch it to a reserve first.`);
  const status = kind === 'deposit' && !league ? 'pending' : 'confirmed';
  const id = newId();
  await run(`INSERT INTO reserve_entries (id, program_id, season_id, kind, amount_cents, method, entry_date, note, status, entered_by, decided_by, decided_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${status === 'confirmed' ? "datetime('now')" : 'NULL'})`,
  [id, p.id, season.id, kind, amount, kind === 'adjustment' ? null : b.method, date, note, status, req.user.id, status === 'confirmed' ? req.user.id : null]);
  const what = `${KIND_LABEL[kind].toLowerCase()} of ${money(amount)}${kind === 'adjustment' ? '' : ` (${RESERVE_METHODS[b.method]}, ${date})`}`;
  await logActivity({ category: 'referee', action: 'reserve', actor: req.user, programId: p.id,
    details: `${status === 'pending' ? 'Added' : 'Recorded'} ${p.name}’s ${what}${status === 'pending' ? ', waiting for the assignor to confirm' : ''}${note ? `: ${note}` : ''}` });
  if (status === 'pending') {
    await notifyAssignors(`${p.name} added a reserve deposit`, `${p.name} says they paid ${money(amount)} into their referee reserve (${RESERVE_METHODS[b.method]}, ${date}).${note ? `\nNote: ${note}` : ''}\n\nOnce you've received it, open Referee reserve and confirm it. It doesn't count toward their balance until you do.`);
  } else if (!p.isGuest) {
    await toProgram(p.id, `${p.name}: referee reserve ${kind} recorded`, `The referee assignor recorded a ${what} for ${p.name}'s referee reserve.${note ? `\nNote: ${note}` : ''}`);
  }
  await checkReserveAlert(p.id);
  res.status(201).json({ entry: { id, status } });
}));

// ---- POST /api/reserves/entries/:id/confirm | /decline ----  (league) a director's deposit.
async function pendingEntry(id) {
  const e = await one('SELECT e.*, p.name AS program_name FROM reserve_entries e JOIN programs p ON p.id = e.program_id WHERE e.id = ?', [id]);
  if (!e) throw notFound('Deposit');
  if (e.status !== 'pending') throw conflict('That deposit has already been confirmed or declined.');
  return e;
}
router.post('/entries/:id/confirm', ah(async (req, res) => {
  if (!isLeague(req.user)) throw forbidden('The referee assignor confirms deposits.');
  const e = await pendingEntry(req.params.id);
  await run("UPDATE reserve_entries SET status = 'confirmed', decided_by = ?, decided_at = datetime('now') WHERE id = ?", [req.user.id, e.id]);
  await logActivity({ category: 'referee', action: 'reserve', actor: req.user, programId: e.programId, details: `Confirmed ${e.programName}’s reserve deposit of ${money(e.amountCents)} (${e.entryDate})` });
  await toProgram(e.programId, `${e.programName}: reserve deposit confirmed`, `The referee assignor confirmed receiving your deposit of ${money(e.amountCents)} (${e.entryDate}). It's now in your referee reserve.`);
  await checkReserveAlert(e.programId);
  res.json({ ok: true });
}));
router.post('/entries/:id/decline', ah(async (req, res) => {
  if (!isLeague(req.user)) throw forbidden('The referee assignor confirms deposits.');
  const e = await pendingEntry(req.params.id);
  const note = trimOrNull(req.body?.note);
  if (!note || note.length < 3) throw badRequest('Say why, for the program (e.g. “Not received yet”).');
  await run("UPDATE reserve_entries SET status = 'declined', decided_by = ?, decided_at = datetime('now'), decision_note = ? WHERE id = ?", [req.user.id, note.slice(0, 300), e.id]);
  await logActivity({ category: 'referee', action: 'reserve', actor: req.user, programId: e.programId, details: `Declined ${e.programName}’s reserve deposit of ${money(e.amountCents)} (${e.entryDate}): ${note}` });
  await toProgram(e.programId, `${e.programName}: reserve deposit not confirmed`, `The referee assignor didn't confirm your deposit of ${money(e.amountCents)} (${e.entryDate}).\nReason: ${note}`);
  res.json({ ok: true });
}));
// ---- DELETE /api/reserves/entries/:id ----  A director withdraws their own deposit while it's still waiting.
router.delete('/entries/:id', ah(async (req, res) => {
  const e = await one('SELECT e.*, p.name AS program_name FROM reserve_entries e JOIN programs p ON p.id = e.program_id WHERE e.id = ?', [req.params.id]);
  if (!e) throw notFound('Deposit');
  if (!isLeague(req.user) && e.programId !== req.user.programId) throw forbidden('That deposit belongs to another program.');
  if (e.status !== 'pending') throw conflict('Only a deposit that’s still waiting can be withdrawn. A confirmed one is corrected by the assignor.');
  await run('DELETE FROM reserve_entries WHERE id = ?', [e.id]);
  await logActivity({ category: 'referee', action: 'reserve', actor: req.user, programId: e.programId, details: `Withdrew ${e.programName}’s reserve deposit of ${money(e.amountCents)} (${e.entryDate}) before it was confirmed` });
  res.json({ ok: true });
}));

// ---- POST /api/reserves/:programId/refund-balance ----  (league) Season end:
// refund whatever is left. Referees owed for games already worked are paid first.
router.post('/:programId/refund-balance', ah(async (req, res) => {
  if (!isLeague(req.user)) throw forbidden('The referee assignor refunds reserves.');
  const p = await loadProgram(req, req.params.programId);
  const season = await one('SELECT * FROM seasons WHERE is_active = 1');
  if (!season) throw conflict('There’s no active season yet.');
  const b = req.body || {};
  if (!RESERVE_METHODS[b.method]) throw badRequest('Choose how the refund was paid.');
  const date = b.entryDate || today();
  assertDate(date, 'Date');
  if (date > today()) throw badRequest('The date can’t be in the future.');
  const f = (await reserveFigures(season, [p.id])).get(p.id);
  if (f.owed > 0) throw conflict(`${p.name} still owes referees ${money(f.owed)} for games already played. Pay them from the reserve first, then refund what’s left.`);
  if (f.balance <= 0) throw conflict(`There’s nothing left to refund: ${p.name}’s balance is ${money(f.balance)}.`);
  const note = trimOrNull(b.note)?.slice(0, 300) || 'Remaining balance refunded at season end';
  const id = newId();
  await run(`INSERT INTO reserve_entries (id, program_id, season_id, kind, amount_cents, method, entry_date, note, status, entered_by, decided_by, decided_at)
    VALUES (?, ?, ?, 'refund', ?, ?, ?, ?, 'confirmed', ?, ?, datetime('now'))`, [id, p.id, season.id, f.balance, b.method, date, note, req.user.id, req.user.id]);
  await logActivity({ category: 'referee', action: 'reserve', actor: req.user, programId: p.id, details: `Refunded ${p.name}’s remaining reserve of ${money(f.balance)} (${RESERVE_METHODS[b.method]}, ${date})` });
  if (!p.isGuest) await toProgram(p.id, `${p.name}: referee reserve refunded`, `The referee assignor refunded the ${money(f.balance)} left in your referee reserve (${RESERVE_METHODS[b.method]}, ${date}).${f.upcoming ? `\n\nNote: referees are still assigned to upcoming games (about ${money(f.upcoming)}). Add a new deposit if your program will play them.` : ''}`);
  res.status(201).json({ entry: { id, amountCents: f.balance } });
}));

export default router;

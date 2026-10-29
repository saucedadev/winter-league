// Referee payout reserve: money a program has prepaid to the referee assignor,
// who pays that program's referees from it.
//
//   balance   = confirmed deposits + adjustments - refunds - referee payouts from the reserve
//   owed      = referees who worked the program's games and haven't been paid yet
//   upcoming  = an estimate for referees already assigned to its future games
//   available = balance - owed - upcoming
//
// Everything is per season. Figures are always worked out from the entries and
// payments, never stored, so they can't drift.
import { one, all, run } from '../db/client.js';
import { getRefSettings, payRate, payersFor, splitCents, leagueNow, notifyUsers } from './data.js';
import { payoutRows } from './payouts.js';

export const RESERVE_METHODS = { check: 'Check', cash: 'Cash', venmo: 'Venmo', other: 'Other' };

export async function seasonFor(seasonId) {
  return seasonId ? one('SELECT * FROM seasons WHERE id = ?', [seasonId]) : one('SELECT * FROM seasons WHERE is_active = 1');
}

// Estimated fees for referees assigned (not yet worked) to future games in the
// season: programId -> cents, using the same one-referee-each rule as payouts.
async function upcomingShares(season) {
  const settings = await getRefSettings();
  const today = leagueNow().date;
  const rows = await all(`SELECT a.id, a.game_id, a.position, a.referee_id, a.status, rp.pay_rate_cents,
      ht.program_id AS home_program_id, at.program_id AS away_program_id, hp.name AS home_program_name, ap.name AS away_program_name,
      hp.is_guest AS home_is_guest, ap.is_guest AS away_is_guest
    FROM referee_assignments a JOIN games g ON g.id = a.game_id JOIN schedule_runs r ON r.id = g.run_id
    JOIN teams ht ON ht.id = g.home_team_id JOIN programs hp ON hp.id = ht.program_id
    JOIN teams at ON at.id = g.away_team_id JOIN programs ap ON ap.id = at.program_id
    LEFT JOIN referee_profiles rp ON rp.user_id = a.referee_id
    WHERE r.status = 'published' AND g.status = 'scheduled' AND g.date >= ? AND g.date BETWEEN ? AND ?`, [today, season.startDate, season.endDate]);
  const byGame = new Map();
  for (const r of rows) { if (!byGame.has(r.gameId)) byGame.set(r.gameId, []); byGame.get(r.gameId).push(r); }
  const out = new Map();
  for (const crew of byGame.values()) {
    const payers = payersFor({ ...crew[0], homeIsGuest: crew[0].homeIsGuest, awayIsGuest: crew[0].awayIsGuest }, crew);
    for (const a of crew) {
      if (!a.refereeId || a.status !== 'assigned') continue; // worked ones are in "owed"
      for (const sh of splitCents(payRate(a.payRateCents, settings), payers.get(a.id) || [])) out.set(sh.programId, (out.get(sh.programId) || 0) + sh.cents);
    }
  }
  return out;
}

// programId -> figures, for every program (or just `programIds`) in the season.
export async function reserveFigures(season, programIds = null) {
  const settings = await getRefSettings();
  const progs = await all(`SELECT id, name, is_guest, is_active, referee_pay_mode, reserve_alert_cents FROM programs
    ${programIds ? `WHERE id IN (${programIds.map(() => '?').join(',')})` : ''} ORDER BY is_guest, name COLLATE NOCASE`, programIds || []);
  const entries = await all(`SELECT program_id, kind, status, SUM(amount_cents) AS cents, COUNT(*) AS n FROM reserve_entries
    WHERE season_id = ? GROUP BY program_id, kind, status`, [season.id]);
  const paidOut = await all(`SELECT program_id, SUM(amount_cents) AS cents FROM referee_payments
    WHERE from_reserve = 1 AND season_id = ? GROUP BY program_id`, [season.id]);
  const owed = new Map();
  for (const d of (await payoutRows(season.startDate, season.endDate)).detail) owed.set(d.paidByProgramId, (owed.get(d.paidByProgramId) || 0) + d.outstandingCents);
  const upcoming = await upcomingShares(season);
  const sum = (pid, kind, status) => entries.filter((e) => e.programId === pid && e.kind === kind && e.status === status).reduce((n, e) => n + Number(e.cents), 0);
  const count = (pid, kind, status) => entries.filter((e) => e.programId === pid && e.kind === kind && e.status === status).reduce((n, e) => n + Number(e.n), 0);
  const out = new Map();
  for (const p of progs) {
    const deposited = sum(p.id, 'deposit', 'confirmed');
    const adjusted = sum(p.id, 'adjustment', 'confirmed');
    const refunded = sum(p.id, 'refund', 'confirmed');
    const out1 = Number(paidOut.find((x) => x.programId === p.id)?.cents || 0);
    const balance = deposited + adjusted - refunded - out1;
    const o = owed.get(p.id) || 0;
    const u = upcoming.get(p.id) || 0;
    const available = balance - o - u;
    out.set(p.id, {
      programId: p.id, name: p.name, isGuest: !!p.isGuest, isActive: !!p.isActive, mode: p.refereePayMode || 'direct', alertCents: p.reserveAlertCents,
      deposited, adjusted, refunded, paidOut: out1, balance, owed: o, upcoming: u, available,
      pendingDeposits: count(p.id, 'deposit', 'pending'), pendingCents: sum(p.id, 'deposit', 'pending'),
      // A rough "covers about N more games", at the league's default fee per referee.
      gamesLeft: available > 0 && settings.defaultPayCents > 0 ? Math.floor(available / settings.defaultPayCents) : 0,
    });
  }
  return out;
}

// After money moves: email the program once when "available" drops below its
// alert level, and re-arm the alert once it's back above.
export async function checkReserveAlert(programId) {
  const season = await seasonFor();
  const p = await one('SELECT id, name, referee_pay_mode, reserve_alert_cents, reserve_alerted FROM programs WHERE id = ?', [programId]);
  if (!season || !p || p.refereePayMode !== 'reserve' || p.reserveAlertCents == null) return;
  const f = (await reserveFigures(season, [programId])).get(programId);
  const low = f.available < p.reserveAlertCents;
  if (low && !p.reserveAlerted) {
    await run('UPDATE programs SET reserve_alerted = 1 WHERE id = ?', [programId]);
    const money = (c) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
    const text = `${p.name}'s referee reserve is running low.\n\nBalance: ${money(f.balance)}\nOwed to referees, not yet paid: ${money(f.owed)}\nAssigned to upcoming games (estimate): ${money(f.upcoming)}\nAvailable: ${money(f.available)}\n\nYour alert level is ${money(p.reserveAlertCents)}. To top it up, pay the referee assignor and add the deposit under Referee reserve.`;
    await notifyUsers("role = 'program_director' AND program_id = ?", [programId], `${p.name}: referee reserve is running low`, text, { label: 'Open Referee reserve', url: '/reserve' });
    await notifyUsers("role = 'referee_assignor'", [], `${p.name}: referee reserve is running low`, text, { label: 'Open Referee reserve', url: '/reserve' });
  } else if (!low && p.reserveAlerted) {
    await run('UPDATE programs SET reserve_alerted = 0 WHERE id = ?', [programId]);
  }
}

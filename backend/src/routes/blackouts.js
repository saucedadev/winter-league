import { Router } from 'express';
import { one, all, run, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope, assertCanManageProgram, resolveWriteProgram } from '../middleware/auth.js';
import { ah, badRequest, notFound } from '../utils/http.js';
import { requireFields, assertDate, trimOrNull, isValidDate } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director'));

const SELECT = `SELECT b.*, p.name AS program_name, p.short_code, v.name AS venue_name,
  (SELECT COUNT(*) FROM gym_slots g JOIN courts c ON c.id = g.court_id
    WHERE g.program_id = b.program_id AND (b.venue_id IS NULL OR c.venue_id = b.venue_id)
      AND g.date BETWEEN b.start_date AND b.end_date) AS affected_slots
  FROM blackout_dates b JOIN programs p ON p.id = b.program_id LEFT JOIN venues v ON v.id = b.venue_id`;

async function validate(programId, body) {
  assertDate(body.startDate, 'Start date');
  assertDate(body.endDate, 'End date');
  if (body.endDate < body.startDate) throw badRequest('End date can’t be before the start date.');
  if (body.venueId && !(await one('SELECT 1 FROM venues WHERE id = ? AND program_id = ?', [body.venueId, programId]))) {
    throw badRequest('Choose one of this program’s venues, or leave it blank to cover every venue.');
  }
}

// ---- GET /api/blackouts?programId=&from=&to= ----
router.get('/', ah(async (req, res) => {
  const programId = readScope(req);
  const where = [];
  const args = [];
  if (programId) { where.push('b.program_id = ?'); args.push(programId); }
  if (isValidDate(req.query.from)) { where.push('b.end_date >= ?'); args.push(req.query.from); }
  if (isValidDate(req.query.to)) { where.push('b.start_date <= ?'); args.push(req.query.to); }
  const blackouts = await all(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY b.start_date, p.name COLLATE NOCASE`, args);
  res.json({ blackouts });
}));

// Published games that a blackout now covers. Games are never moved
// automatically; the response tells the user so the league can fix them.
async function affectedGames(programId, venueId, startDate, endDate) {
  const r = await one(`SELECT COUNT(*) AS n FROM games g JOIN schedule_runs sr ON sr.id = g.run_id
    JOIN courts c ON c.id = g.court_id JOIN venues v ON v.id = c.venue_id
    JOIN teams ht ON ht.id = g.home_team_id JOIN teams at ON at.id = g.away_team_id
    WHERE sr.status = 'published' AND g.status = 'scheduled' AND g.date BETWEEN ? AND ?
      AND ${venueId ? 'v.id = ?' : '(v.program_id = ? OR ht.program_id = ? OR at.program_id = ?)'}`,
  venueId ? [startDate, endDate, venueId] : [startDate, endDate, programId, programId, programId]);
  return Number(r.n);
}

router.post('/', ah(async (req, res) => {
  requireFields(req.body, ['startDate', 'endDate', 'reason']);
  const programId = resolveWriteProgram(req, req.body.programId);
  const venueId = trimOrNull(req.body.venueId);
  await validate(programId, { ...req.body, venueId });
  const id = newId();
  await run('INSERT INTO blackout_dates (id, program_id, venue_id, start_date, end_date, reason, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, programId, venueId, req.body.startDate, req.body.endDate, req.body.reason.trim(), req.user.id]);
  const b = await one(`${SELECT} WHERE b.id = ?`, [id]);
  await logActivity({ category: 'blackout', action: 'created', actor: req.user, programId,
    details: `Blacked out ${b.venueName || 'all venues'} ${b.startDate === b.endDate ? `on ${b.startDate}` : `from ${b.startDate} to ${b.endDate}`}: ${b.reason}` });
  res.status(201).json({ blackout: b, affectedGames: await affectedGames(programId, venueId, b.startDate, b.endDate) });
}));

router.put('/:id', ah(async (req, res) => {
  const b = await one('SELECT * FROM blackout_dates WHERE id = ?', [req.params.id]);
  if (!b) throw notFound('Blackout');
  assertCanManageProgram(req, b.programId);
  const next = {
    venueId: req.body.venueId !== undefined ? trimOrNull(req.body.venueId) : b.venueId,
    startDate: req.body.startDate || b.startDate,
    endDate: req.body.endDate || b.endDate,
    reason: req.body.reason?.trim() || b.reason,
  };
  await validate(b.programId, next);
  await run('UPDATE blackout_dates SET venue_id = ?, start_date = ?, end_date = ?, reason = ? WHERE id = ?', [next.venueId, next.startDate, next.endDate, next.reason, b.id]);
  await logActivity({ category: 'blackout', action: 'edited', actor: req.user, programId: b.programId, details: `Updated blackout: ${next.reason}` });
  res.json({ blackout: await one(`${SELECT} WHERE b.id = ?`, [b.id]), affectedGames: await affectedGames(b.programId, next.venueId, next.startDate, next.endDate) });
}));

router.delete('/:id', ah(async (req, res) => {
  const b = await one('SELECT * FROM blackout_dates WHERE id = ?', [req.params.id]);
  if (!b) throw notFound('Blackout');
  assertCanManageProgram(req, b.programId);
  await run('DELETE FROM blackout_dates WHERE id = ?', [b.id]);
  await logActivity({ category: 'blackout', action: 'deleted', actor: req.user, programId: b.programId, details: `Removed blackout: ${b.reason}` });
  res.json({ ok: true });
}));

export default router;

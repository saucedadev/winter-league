import { Router } from 'express';
import { one, all, run, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope, assertCanManageProgram, resolveWriteProgram } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { requireFields, trimOrNull } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);
const managers = requireRole('super_admin', 'program_director');

const SELECT = `SELECT t.*, p.name AS program_name, p.short_code, d.name AS division_name, d.sort_order AS division_order,
  u.first_name || ' ' || u.last_name AS head_coach_name
  FROM teams t JOIN programs p ON p.id = t.program_id JOIN divisions d ON d.id = t.division_id
  LEFT JOIN users u ON u.id = t.head_coach_user_id`;

async function validateRefs(programId, divisionId, coachId) {
  if (!(await one('SELECT 1 FROM divisions WHERE id = ?', [divisionId]))) throw badRequest('Choose a valid division.');
  if (coachId) {
    const coach = await one('SELECT role, program_id FROM users WHERE id = ? AND is_active = 1', [coachId]);
    if (!coach || coach.role !== 'league_coach' || coach.programId !== programId) {
      throw badRequest('The head coach must be an active Coach account in the same program.');
    }
  }
}

// ---- GET /api/teams ----
router.get('/', requireRole('super_admin', 'program_director', 'league_coach'), ah(async (req, res) => {
  const programId = readScope(req);
  const where = [];
  const args = [];
  if (programId) { where.push('t.program_id = ?'); args.push(programId); }
  if (req.query.divisionId) { where.push('t.division_id = ?'); args.push(req.query.divisionId); }
  const teams = await all(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY d.sort_order, d.name COLLATE NOCASE, p.name COLLATE NOCASE, t.name COLLATE NOCASE`, args);
  res.json({ teams: teams.map((t) => ({ ...t, isActive: !!t.isActive })) });
}));

// ---- GET /api/teams/coaches ---- (active Coach accounts a PD can assign as head coach)
router.get('/coaches', managers, ah(async (req, res) => {
  const programId = readScope(req);
  const coaches = await all(
    `SELECT id, first_name, last_name, program_id FROM users WHERE role = 'league_coach' AND is_active = 1 ${programId ? 'AND program_id = ?' : ''}
     ORDER BY last_name COLLATE NOCASE, first_name COLLATE NOCASE`, programId ? [programId] : []);
  res.json({ coaches });
}));

// ---- POST /api/teams ----
router.post('/', managers, ah(async (req, res) => {
  requireFields(req.body, ['name', 'divisionId']);
  const programId = resolveWriteProgram(req, req.body.programId);
  const coachId = trimOrNull(req.body.headCoachUserId);
  await validateRefs(programId, req.body.divisionId, coachId);
  const name = req.body.name.trim();
  if (await one('SELECT 1 FROM teams WHERE program_id = ? AND division_id = ? AND name = ?', [programId, req.body.divisionId, name])) {
    throw conflict('This program already has a team with that name in that division.');
  }
  const id = newId();
  await run('INSERT INTO teams (id, program_id, division_id, name, head_coach_user_id) VALUES (?, ?, ?, ?, ?)', [id, programId, req.body.divisionId, name, coachId]);
  await logActivity({ category: 'team', action: 'created', actor: req.user, programId, details: `Added team ${name}` });
  res.status(201).json({ team: await one(`${SELECT} WHERE t.id = ?`, [id]) });
}));

// ---- PUT /api/teams/:id ----
router.put('/:id', managers, ah(async (req, res) => {
  const t = await one('SELECT * FROM teams WHERE id = ?', [req.params.id]);
  if (!t) throw notFound('Team');
  assertCanManageProgram(req, t.programId);
  const next = {
    name: req.body.name?.trim() || t.name,
    divisionId: req.body.divisionId || t.divisionId,
    coachId: req.body.headCoachUserId !== undefined ? trimOrNull(req.body.headCoachUserId) : t.headCoachUserId,
    isActive: req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : t.isActive,
  };
  await validateRefs(t.programId, next.divisionId, next.coachId);
  if (await one('SELECT 1 FROM teams WHERE program_id = ? AND division_id = ? AND name = ? AND id != ?', [t.programId, next.divisionId, next.name, t.id])) {
    throw conflict('This program already has a team with that name in that division.');
  }
  await run(`UPDATE teams SET name = ?, division_id = ?, head_coach_user_id = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    [next.name, next.divisionId, next.coachId, next.isActive, t.id]);
  await logActivity({ category: 'team', action: 'edited', actor: req.user, programId: t.programId, details: `Updated team ${next.name}` });
  res.json({ team: await one(`${SELECT} WHERE t.id = ?`, [t.id]) });
}));

// ---- DELETE /api/teams/:id ----
router.delete('/:id', managers, ah(async (req, res) => {
  const t = await one('SELECT * FROM teams WHERE id = ?', [req.params.id]);
  if (!t) throw notFound('Team');
  assertCanManageProgram(req, t.programId);
  await run('DELETE FROM teams WHERE id = ?', [t.id]);
  await logActivity({ category: 'team', action: 'deleted', actor: req.user, programId: t.programId, details: `Deleted team ${t.name}` });
  res.json({ ok: true });
}));

export default router;

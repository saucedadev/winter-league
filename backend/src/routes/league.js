// Seasons + divisions: league-wide reference data, readable by every
// signed-in role, editable only by the System Admin.
import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { requireFields, assertDate, trimOrNull } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);
const adminOnly = requireRole('super_admin');

// ======================= Seasons =======================
router.get('/seasons', ah(async (req, res) => {
  const seasons = await all(`SELECT s.*, (SELECT COUNT(*) FROM gym_slots g WHERE g.season_id = s.id) AS slot_count
    FROM seasons s ORDER BY s.start_date DESC`);
  res.json({ seasons: seasons.map((s) => ({ ...s, isActive: !!s.isActive })) });
}));

function validateSeason(body) {
  assertDate(body.startDate, 'Start date');
  assertDate(body.endDate, 'End date');
  if (body.startDate >= body.endDate) throw badRequest('The season must end after it starts.');
}

router.post('/seasons', adminOnly, ah(async (req, res) => {
  requireFields(req.body, ['name', 'startDate', 'endDate']);
  validateSeason(req.body);
  if (await one('SELECT 1 FROM seasons WHERE name = ?', [req.body.name.trim()])) throw conflict('A season with that name already exists.');
  const id = newId();
  const makeActive = !!req.body.isActive || !(await one('SELECT 1 FROM seasons WHERE is_active = 1'));
  await db.batch([
    ...(makeActive ? ['UPDATE seasons SET is_active = 0'] : []),
    { sql: 'INSERT INTO seasons (id, name, start_date, end_date, is_active) VALUES (?, ?, ?, ?, ?)', args: [id, req.body.name.trim(), req.body.startDate, req.body.endDate, makeActive ? 1 : 0] },
  ], 'write');
  await logActivity({ category: 'season', action: 'created', actor: req.user, details: `Created season ${req.body.name.trim()}` });
  res.status(201).json({ season: await one('SELECT * FROM seasons WHERE id = ?', [id]) });
}));

router.put('/seasons/:id', adminOnly, ah(async (req, res) => {
  const s = await one('SELECT * FROM seasons WHERE id = ?', [req.params.id]);
  if (!s) throw notFound('Season');
  const next = { name: req.body.name?.trim() || s.name, startDate: req.body.startDate || s.startDate, endDate: req.body.endDate || s.endDate };
  validateSeason(next);
  const outside = await one('SELECT COUNT(*) AS n FROM gym_slots WHERE season_id = ? AND (date < ? OR date > ?)', [s.id, next.startDate, next.endDate]);
  if (Number(outside.n) > 0) throw conflict(`${outside.n} gym slot(s) fall outside those dates. Move or delete them first.`);
  const activate = req.body.isActive === true;
  await db.batch([
    ...(activate ? ['UPDATE seasons SET is_active = 0'] : []),
    { sql: `UPDATE seasons SET name = ?, start_date = ?, end_date = ?${activate ? ', is_active = 1' : ''} WHERE id = ?`, args: [next.name, next.startDate, next.endDate, s.id] },
  ], 'write');
  await logActivity({ category: 'season', action: activate ? 'activated' : 'edited', actor: req.user, details: `${activate ? 'Made active' : 'Updated'}: season ${next.name}` });
  res.json({ season: await one('SELECT * FROM seasons WHERE id = ?', [s.id]) });
}));

router.delete('/seasons/:id', adminOnly, ah(async (req, res) => {
  const s = await one('SELECT * FROM seasons WHERE id = ?', [req.params.id]);
  if (!s) throw notFound('Season');
  if (await one('SELECT 1 FROM gym_slots WHERE season_id = ? LIMIT 1', [s.id])) throw conflict('This season has gym slots and can’t be deleted.');
  await run('DELETE FROM seasons WHERE id = ?', [s.id]);
  await logActivity({ category: 'season', action: 'deleted', actor: req.user, details: `Deleted season ${s.name}` });
  res.json({ ok: true });
}));

// ======================= Divisions =======================
const GENDERS = ['boys', 'girls', 'coed'];

router.get('/divisions', ah(async (req, res) => {
  const divisions = await all(`SELECT d.*, (SELECT COUNT(*) FROM teams t WHERE t.division_id = d.id AND t.is_active = 1) AS team_count
    FROM divisions d ORDER BY d.sort_order, d.name COLLATE NOCASE`);
  res.json({ divisions: divisions.map((d) => ({ ...d, isActive: !!d.isActive })) });
}));

router.post('/divisions', adminOnly, ah(async (req, res) => {
  requireFields(req.body, ['name', 'gender']);
  if (!GENDERS.includes(req.body.gender)) throw badRequest('Gender must be boys, girls, or coed.');
  if (await one('SELECT 1 FROM divisions WHERE name = ?', [req.body.name.trim()])) throw conflict('A division with that name already exists.');
  const id = newId();
  const order = Number.isFinite(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : Number((await one('SELECT COALESCE(MAX(sort_order), 0) + 10 AS n FROM divisions')).n);
  await run('INSERT INTO divisions (id, name, grade, gender, sort_order) VALUES (?, ?, ?, ?, ?)',
    [id, req.body.name.trim(), trimOrNull(req.body.grade), req.body.gender, order]);
  await logActivity({ category: 'division', action: 'created', actor: req.user, details: `Added division ${req.body.name.trim()}` });
  res.status(201).json({ division: await one('SELECT * FROM divisions WHERE id = ?', [id]) });
}));

router.put('/divisions/:id', adminOnly, ah(async (req, res) => {
  const d = await one('SELECT * FROM divisions WHERE id = ?', [req.params.id]);
  if (!d) throw notFound('Division');
  const gender = req.body.gender || d.gender;
  if (!GENDERS.includes(gender)) throw badRequest('Gender must be boys, girls, or coed.');
  const name = req.body.name?.trim() || d.name;
  if (await one('SELECT 1 FROM divisions WHERE name = ? AND id != ?', [name, d.id])) throw conflict('Another division already uses that name.');
  await run('UPDATE divisions SET name = ?, grade = ?, gender = ?, sort_order = ?, is_active = ? WHERE id = ?', [
    name, req.body.grade !== undefined ? trimOrNull(req.body.grade) : d.grade, gender,
    req.body.sortOrder !== undefined ? Number(req.body.sortOrder) : d.sortOrder,
    req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : d.isActive, d.id,
  ]);
  await logActivity({ category: 'division', action: 'edited', actor: req.user, details: `Updated division ${name}` });
  res.json({ division: await one('SELECT * FROM divisions WHERE id = ?', [d.id]) });
}));

router.delete('/divisions/:id', adminOnly, ah(async (req, res) => {
  const d = await one('SELECT * FROM divisions WHERE id = ?', [req.params.id]);
  if (!d) throw notFound('Division');
  if (await one('SELECT 1 FROM teams WHERE division_id = ? LIMIT 1', [d.id])) throw conflict('Teams are assigned to this division. Deactivate it instead.');
  await run('DELETE FROM divisions WHERE id = ?', [d.id]);
  await logActivity({ category: 'division', action: 'deleted', actor: req.user, details: `Deleted division ${d.name}` });
  res.json({ ok: true });
}));

export default router;

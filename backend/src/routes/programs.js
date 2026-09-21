import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { config } from '../config.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { requireFields, trimOrNull } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);

async function activeProgramCount(excludingId = '') {
  return Number((await one('SELECT COUNT(*) AS n FROM programs WHERE is_active = 1 AND id != ?', [excludingId])).n);
}

function normalizeCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{2,6}$/.test(c)) throw badRequest('Short code must be 2–6 letters or numbers (e.g. NSH).');
  return c;
}

// ---- GET /api/programs ---- (every signed-in role can see the list of programs)
router.get('/', ah(async (req, res) => {
  const programs = await all(`
    SELECT p.*,
      (SELECT COUNT(*) FROM venues v WHERE v.program_id = p.id AND v.is_active = 1) AS venue_count,
      (SELECT COUNT(*) FROM teams t WHERE t.program_id = p.id AND t.is_active = 1) AS team_count,
      (SELECT COUNT(*) FROM users u WHERE u.program_id = p.id AND u.role = 'program_director' AND u.is_active = 1) AS director_count
    FROM programs p ORDER BY p.name COLLATE NOCASE`);
  res.json({ programs: programs.map((p) => ({ ...p, isActive: !!p.isActive })), maxPrograms: config.maxPrograms });
}));

// ---- POST /api/programs ----
router.post('/', requireRole('super_admin'), ah(async (req, res) => {
  requireFields(req.body, ['name', 'shortCode']);
  if ((await activeProgramCount()) >= config.maxPrograms) {
    throw conflict(`The league is capped at ${config.maxPrograms} active programs. Deactivate one before adding another.`);
  }
  const code = normalizeCode(req.body.shortCode);
  if (await one('SELECT 1 FROM programs WHERE name = ? OR short_code = ?', [req.body.name.trim(), code])) {
    throw conflict('A program with that name or short code already exists.');
  }
  const id = newId();
  await run(
    'INSERT INTO programs (id, name, short_code, city, contact_email, contact_phone) VALUES (?, ?, ?, ?, ?, ?)',
    [id, req.body.name.trim(), code, trimOrNull(req.body.city), trimOrNull(req.body.contactEmail), trimOrNull(req.body.contactPhone)]
  );
  await logActivity({ category: 'program', action: 'created', actor: req.user, programId: id, details: `Added program ${req.body.name.trim()} (${code})` });
  res.status(201).json({ program: await one('SELECT * FROM programs WHERE id = ?', [id]) });
}));

// ---- PUT /api/programs/:id ----
router.put('/:id', requireRole('super_admin'), ah(async (req, res) => {
  const p = await one('SELECT * FROM programs WHERE id = ?', [req.params.id]);
  if (!p) throw notFound('Program');
  const name = req.body.name?.trim() || p.name;
  const code = req.body.shortCode ? normalizeCode(req.body.shortCode) : p.shortCode;
  const isActive = req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : p.isActive;

  if (isActive && !p.isActive && (await activeProgramCount(p.id)) >= config.maxPrograms) {
    throw conflict(`The league already has ${config.maxPrograms} active programs.`);
  }
  if (await one('SELECT 1 FROM programs WHERE (name = ? OR short_code = ?) AND id != ?', [name, code, p.id])) {
    throw conflict('Another program already uses that name or short code.');
  }
  await run(
    `UPDATE programs SET name = ?, short_code = ?, city = ?, contact_email = ?, contact_phone = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    [name, code, req.body.city !== undefined ? trimOrNull(req.body.city) : p.city,
      req.body.contactEmail !== undefined ? trimOrNull(req.body.contactEmail) : p.contactEmail,
      req.body.contactPhone !== undefined ? trimOrNull(req.body.contactPhone) : p.contactPhone,
      isActive, p.id]
  );
  await logActivity({ category: 'program', action: 'edited', actor: req.user, programId: p.id, details: `Updated program ${name}` });
  res.json({ program: await one('SELECT * FROM programs WHERE id = ?', [p.id]) });
}));

// ---- DELETE /api/programs/:id ---- (only while it has nothing attached)
router.delete('/:id', requireRole('super_admin'), ah(async (req, res) => {
  const p = await one('SELECT * FROM programs WHERE id = ?', [req.params.id]);
  if (!p) throw notFound('Program');
  const used = await one(`SELECT
    (SELECT COUNT(*) FROM venues WHERE program_id = ?) + (SELECT COUNT(*) FROM teams WHERE program_id = ?) + (SELECT COUNT(*) FROM users WHERE program_id = ?) AS n`,
    [p.id, p.id, p.id]);
  if (Number(used.n) > 0) throw conflict('This program has venues, teams, or users. Deactivate it instead of deleting.');
  await db.batch([
    { sql: 'DELETE FROM blackout_dates WHERE program_id = ?', args: [p.id] },
    { sql: 'DELETE FROM programs WHERE id = ?', args: [p.id] },
  ], 'write');
  await logActivity({ category: 'program', action: 'deleted', actor: req.user, details: `Deleted program ${p.name}` });
  res.json({ ok: true });
}));

export default router;

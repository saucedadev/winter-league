import { Router } from 'express';
import { one, all, run, db, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope, assertCanManageProgram, resolveWriteProgram } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { requireFields, trimOrNull } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);
const managers = requireRole('super_admin', 'program_director');

function parseCoord(v, label, min, max) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw badRequest(`${label} must be a number between ${min} and ${max}.`);
  return n;
}

async function venueWithCourts(id) {
  const v = await one('SELECT v.*, p.name AS program_name, p.short_code FROM venues v JOIN programs p ON p.id = v.program_id WHERE v.id = ?', [id]);
  if (!v) return null;
  v.courts = await all('SELECT id, name, sort_order FROM courts WHERE venue_id = ? ORDER BY sort_order, name', [id]);
  v.isActive = !!v.isActive;
  return v;
}

// ---- GET /api/venues ----
router.get('/', requireRole('super_admin', 'program_director', 'league_coach'), ah(async (req, res) => {
  const programId = readScope(req);
  const venues = await all(
    `SELECT v.*, p.name AS program_name, p.short_code FROM venues v JOIN programs p ON p.id = v.program_id
     ${programId ? 'WHERE v.program_id = ?' : ''} ORDER BY p.name COLLATE NOCASE, v.name COLLATE NOCASE`,
    programId ? [programId] : []
  );
  const courts = await all(
    `SELECT c.* FROM courts c JOIN venues v ON v.id = c.venue_id ${programId ? 'WHERE v.program_id = ?' : ''} ORDER BY c.sort_order, c.name`,
    programId ? [programId] : []
  );
  for (const v of venues) {
    v.isActive = !!v.isActive;
    v.courts = courts.filter((c) => c.venueId === v.id).map(({ id, name, sortOrder }) => ({ id, name, sortOrder }));
  }
  res.json({ venues });
}));

// ---- POST /api/venues ----
router.post('/', managers, ah(async (req, res) => {
  requireFields(req.body, ['name']);
  const programId = resolveWriteProgram(req, req.body.programId);
  const name = req.body.name.trim();
  if (await one('SELECT 1 FROM venues WHERE program_id = ? AND name = ?', [programId, name])) throw conflict('This program already has a venue with that name.');

  const courtNames = (Array.isArray(req.body.courts) ? req.body.courts : [])
    .map((c) => String(c || '').trim()).filter(Boolean);
  if (!courtNames.length) courtNames.push('Main court');
  if (new Set(courtNames.map((c) => c.toLowerCase())).size !== courtNames.length) throw badRequest('Court names must be unique within a venue.');

  const id = newId();
  await db.batch([
    {
      sql: `INSERT INTO venues (id, program_id, name, address, city, state, zip, latitude, longitude, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [id, programId, name, trimOrNull(req.body.address), trimOrNull(req.body.city), trimOrNull(req.body.state), trimOrNull(req.body.zip),
        parseCoord(req.body.latitude, 'Latitude', -90, 90), parseCoord(req.body.longitude, 'Longitude', -180, 180), trimOrNull(req.body.notes)],
    },
    ...courtNames.map((c, i) => ({ sql: 'INSERT INTO courts (id, venue_id, name, sort_order) VALUES (?, ?, ?, ?)', args: [newId(), id, c, i] })),
  ], 'write');
  await logActivity({ category: 'venue', action: 'created', actor: req.user, programId, details: `Added venue ${name} (${courtNames.length} court${courtNames.length > 1 ? 's' : ''})` });
  res.status(201).json({ venue: await venueWithCourts(id) });
}));

// ---- PUT /api/venues/:id ----
router.put('/:id', managers, ah(async (req, res) => {
  const v = await one('SELECT * FROM venues WHERE id = ?', [req.params.id]);
  if (!v) throw notFound('Venue');
  assertCanManageProgram(req, v.programId);
  const name = req.body.name?.trim() || v.name;
  if (await one('SELECT 1 FROM venues WHERE program_id = ? AND name = ? AND id != ?', [v.programId, name, v.id])) throw conflict('This program already has a venue with that name.');
  const pick = (k) => (req.body[k] !== undefined ? trimOrNull(req.body[k]) : v[k]);
  await run(
    `UPDATE venues SET name = ?, address = ?, city = ?, state = ?, zip = ?, latitude = ?, longitude = ?, notes = ?, is_active = ?, updated_at = datetime('now') WHERE id = ?`,
    [name, pick('address'), pick('city'), pick('state'), pick('zip'),
      req.body.latitude !== undefined ? parseCoord(req.body.latitude, 'Latitude', -90, 90) : v.latitude,
      req.body.longitude !== undefined ? parseCoord(req.body.longitude, 'Longitude', -180, 180) : v.longitude,
      pick('notes'), req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : v.isActive, v.id]
  );
  await logActivity({ category: 'venue', action: 'edited', actor: req.user, programId: v.programId, details: `Updated venue ${name}` });
  res.json({ venue: await venueWithCourts(v.id) });
}));

// ---- DELETE /api/venues/:id ----
router.delete('/:id', managers, ah(async (req, res) => {
  const v = await one('SELECT * FROM venues WHERE id = ?', [req.params.id]);
  if (!v) throw notFound('Venue');
  assertCanManageProgram(req, v.programId);
  const slots = await one('SELECT COUNT(*) AS n FROM gym_slots g JOIN courts c ON c.id = g.court_id WHERE c.venue_id = ?', [v.id]);
  if (Number(slots.n) > 0) throw conflict(`This venue has ${slots.n} gym slot(s). Deactivate it instead, or delete its slots first.`);
  // Explicit rather than relying on ON DELETE CASCADE: foreign-key pragmas
  // don't persist across Turso's per-request HTTP connections.
  await db.batch([
    { sql: 'DELETE FROM blackout_dates WHERE venue_id = ?', args: [v.id] },
    { sql: 'DELETE FROM courts WHERE venue_id = ?', args: [v.id] },
    { sql: 'DELETE FROM venues WHERE id = ?', args: [v.id] },
  ], 'write');
  await logActivity({ category: 'venue', action: 'deleted', actor: req.user, programId: v.programId, details: `Deleted venue ${v.name}` });
  res.json({ ok: true });
}));

// ---------------- Courts ----------------
router.post('/:id/courts', managers, ah(async (req, res) => {
  requireFields(req.body, ['name']);
  const v = await one('SELECT * FROM venues WHERE id = ?', [req.params.id]);
  if (!v) throw notFound('Venue');
  assertCanManageProgram(req, v.programId);
  const name = req.body.name.trim();
  if (await one('SELECT 1 FROM courts WHERE venue_id = ? AND name = ?', [v.id, name])) throw conflict('This venue already has a court with that name.');
  const order = Number((await one('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM courts WHERE venue_id = ?', [v.id])).n);
  await run('INSERT INTO courts (id, venue_id, name, sort_order) VALUES (?, ?, ?, ?)', [newId(), v.id, name, order]);
  await logActivity({ category: 'venue', action: 'edited', actor: req.user, programId: v.programId, details: `Added court ${name} at ${v.name}` });
  res.status(201).json({ venue: await venueWithCourts(v.id) });
}));

router.put('/courts/:courtId', managers, ah(async (req, res) => {
  requireFields(req.body, ['name']);
  const c = await one('SELECT c.*, v.program_id, v.name AS venue_name FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ?', [req.params.courtId]);
  if (!c) throw notFound('Court');
  assertCanManageProgram(req, c.programId);
  const name = req.body.name.trim();
  if (await one('SELECT 1 FROM courts WHERE venue_id = ? AND name = ? AND id != ?', [c.venueId, name, c.id])) throw conflict('This venue already has a court with that name.');
  await run('UPDATE courts SET name = ? WHERE id = ?', [name, c.id]);
  res.json({ venue: await venueWithCourts(c.venueId) });
}));

router.delete('/courts/:courtId', managers, ah(async (req, res) => {
  const c = await one('SELECT c.*, v.program_id, v.name AS venue_name FROM courts c JOIN venues v ON v.id = c.venue_id WHERE c.id = ?', [req.params.courtId]);
  if (!c) throw notFound('Court');
  assertCanManageProgram(req, c.programId);
  if (Number((await one('SELECT COUNT(*) AS n FROM courts WHERE venue_id = ?', [c.venueId])).n) <= 1) throw conflict('A venue needs at least one court.');
  if (await one('SELECT 1 FROM gym_slots WHERE court_id = ? LIMIT 1', [c.id])) throw conflict('This court has gym slots. Delete those slots first.');
  await run('DELETE FROM courts WHERE id = ?', [c.id]);
  await logActivity({ category: 'venue', action: 'edited', actor: req.user, programId: c.programId, details: `Removed court ${c.name} from ${c.venueName}` });
  res.json({ venue: await venueWithCourts(c.venueId) });
}));

export default router;

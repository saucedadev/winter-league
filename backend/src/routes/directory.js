// Program Directory: a Program Director's own contact list (migration 012).
// Contacts are NOT app accounts and can't sign in; creating accounts stays a
// System Admin job (Users). A contact with the Coach role can be a team's head
// coach until a real Coach account replaces them.
//
// Program Directors see and manage their own program's directory; System
// Admins see every program's (or one, with ?programId=).
import { Router } from 'express';
import { one, all, run, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope, assertCanManageProgram, resolveWriteProgram } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { assertEmail, trimOrNull, normalizePhone } from '../utils/validate.js';
import { logActivity } from '../utils/activityLog.js';
import { assertLeagueProgram } from '../utils/guests.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director'));

export const DIRECTORY_ROLES = { coach: 'Coach', referee: 'Referee' };
const roleLabel = (c) => (c.role === 'other' ? c.roleOther || 'Other' : DIRECTORY_ROLES[c.role] || '');

const SELECT = `SELECT c.*, p.name AS program_name, p.short_code,
    (SELECT GROUP_CONCAT(t.name, ', ') FROM teams t WHERE t.head_coach_contact_id = c.id) AS coach_of_teams,
    (SELECT COUNT(*) FROM teams t WHERE t.head_coach_contact_id = c.id) AS coach_of_count,
    -- A Coach account in the same program that looks like the same person
    -- (same email, or same first and last name), so they can be switched over.
    (SELECT u.id FROM users u WHERE u.program_id = c.program_id AND u.role = 'league_coach' AND u.is_active = 1
       AND ((c.email IS NOT NULL AND lower(u.email) = lower(c.email))
         OR (lower(u.first_name) = lower(c.first_name) AND lower(u.last_name) = lower(c.last_name))) LIMIT 1) AS matching_user_id
  FROM directory_contacts c JOIN programs p ON p.id = c.program_id`;
const shape = (c) => ({ ...c, roleLabel: roleLabel(c), coachOfCount: Number(c.coachOfCount || 0) });

// Validate the fields; returns clean values.
function readContact(b, existing = {}) {
  const pick = (k) => (b[k] !== undefined ? b[k] : existing[k]);
  const firstName = String(pick('firstName') || '').trim();
  const lastName = String(pick('lastName') || '').trim();
  if (!firstName || !lastName) throw badRequest('First and last name are required.');
  if (firstName.length > 60 || lastName.length > 60) throw badRequest('Names can be at most 60 characters.');
  const email = trimOrNull(pick('email'));
  if (email) assertEmail(email);
  const phone = b.phone !== undefined ? normalizePhone(b.phone, 'Phone number', existing.phone) : existing.phone ?? null;
  let role = pick('role') || null;
  let roleOther = null;
  if (role && !['coach', 'referee', 'other'].includes(role)) throw badRequest('Role must be Coach, Referee, or a role you type in.');
  if (role === 'other') {
    roleOther = String(pick('roleOther') || '').trim();
    if (!roleOther) throw badRequest('Type the role, e.g. Team manager.');
    if (roleOther.length > 40) throw badRequest('The role can be at most 40 characters.');
    // Typing "coach" or "referee" means the built-in role.
    if (/^coach$/i.test(roleOther)) { role = 'coach'; roleOther = null; }
    else if (/^referee$/i.test(roleOther)) { role = 'referee'; roleOther = null; }
  }
  return { firstName, lastName, email, phone, role, roleOther };
}

// ---- GET /api/directory?programId= ----
router.get('/', ah(async (req, res) => {
  const programId = readScope(req);
  const rows = await all(`${SELECT} ${programId ? 'WHERE c.program_id = ?' : ''}
    ORDER BY c.last_name COLLATE NOCASE, c.first_name COLLATE NOCASE`, programId ? [programId] : []);
  res.json({ contacts: rows.map(shape), roles: DIRECTORY_ROLES });
}));

// ---- POST /api/directory ----
router.post('/', ah(async (req, res) => {
  const programId = resolveWriteProgram(req, req.body?.programId);
  await assertLeagueProgram(programId, 'a directory', 'Directories belong to the league’s own programs.');
  const c = readContact(req.body || {});
  const id = newId();
  await run(`INSERT INTO directory_contacts (id, program_id, first_name, last_name, email, phone, role, role_other, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, programId, c.firstName, c.lastName, c.email, c.phone, c.role, c.roleOther, req.user.id]);
  await logActivity({ category: 'program', action: 'directory', actor: req.user, programId, details: `Added ${c.firstName} ${c.lastName} to the directory` });
  res.status(201).json({ contact: shape(await one(`${SELECT} WHERE c.id = ?`, [id])) });
}));

// ---- PUT /api/directory/:id ----
router.put('/:id', ah(async (req, res) => {
  const existing = await one('SELECT * FROM directory_contacts WHERE id = ?', [req.params.id]);
  if (!existing) throw notFound('Contact');
  assertCanManageProgram(req, existing.programId);
  const c = readContact(req.body || {}, existing);
  if (existing.role === 'coach' && c.role !== 'coach') {
    const used = await one('SELECT COUNT(*) AS n FROM teams WHERE head_coach_contact_id = ?', [existing.id]);
    if (Number(used.n)) throw conflict(`${existing.firstName} ${existing.lastName} is the head coach of ${used.n} team${used.n > 1 ? 's' : ''}. Choose a different coach for ${used.n > 1 ? 'those teams' : 'that team'} first, or keep the role Coach.`);
  }
  await run(`UPDATE directory_contacts SET first_name = ?, last_name = ?, email = ?, phone = ?, role = ?, role_other = ?, updated_at = datetime('now') WHERE id = ?`,
    [c.firstName, c.lastName, c.email, c.phone, c.role, c.roleOther, existing.id]);
  await logActivity({ category: 'program', action: 'directory', actor: req.user, programId: existing.programId, details: `Updated ${c.firstName} ${c.lastName} in the directory` });
  res.json({ contact: shape(await one(`${SELECT} WHERE c.id = ?`, [existing.id])) });
}));

// ---- DELETE /api/directory/:id ----  (teams they coached show no coach)
router.delete('/:id', ah(async (req, res) => {
  const existing = await one('SELECT * FROM directory_contacts WHERE id = ?', [req.params.id]);
  if (!existing) throw notFound('Contact');
  assertCanManageProgram(req, existing.programId);
  const used = await one('SELECT COUNT(*) AS n FROM teams WHERE head_coach_contact_id = ?', [existing.id]);
  await run("UPDATE teams SET head_coach_contact_id = NULL, updated_at = datetime('now') WHERE head_coach_contact_id = ?", [existing.id]);
  await run('DELETE FROM directory_contacts WHERE id = ?', [existing.id]);
  await logActivity({ category: 'program', action: 'directory', actor: req.user, programId: existing.programId,
    details: `Removed ${existing.firstName} ${existing.lastName} from the directory${Number(used.n) ? ` (was head coach of ${used.n} team${used.n > 1 ? 's' : ''})` : ''}` });
  res.json({ ok: true, teamsCleared: Number(used.n) });
}));

// ---- POST /api/directory/:id/switch-to-account { userId } ----
// Replace this contact with a real Coach account as head coach on every team
// they coach. The contact stays in the directory.
router.post('/:id/switch-to-account', ah(async (req, res) => {
  const existing = await one('SELECT * FROM directory_contacts WHERE id = ?', [req.params.id]);
  if (!existing) throw notFound('Contact');
  assertCanManageProgram(req, existing.programId);
  const user = await one("SELECT id, first_name, last_name, program_id FROM users WHERE id = ? AND role = 'league_coach' AND is_active = 1", [req.body?.userId]);
  if (!user || user.programId !== existing.programId) throw badRequest('Choose an active Coach account in the same program.');
  const r = await run(`UPDATE teams SET head_coach_user_id = ?, head_coach_contact_id = NULL, updated_at = datetime('now') WHERE head_coach_contact_id = ?`, [user.id, existing.id]);
  await logActivity({ category: 'team', action: 'coach', actor: req.user, programId: existing.programId,
    details: `Made ${user.firstName} ${user.lastName}’s Coach account the head coach of ${r.rowsAffected} team${r.rowsAffected === 1 ? '' : 's'} (replacing the directory entry)` });
  res.json({ teamsUpdated: r.rowsAffected });
}));

export default router;

import { Router } from 'express';
import { one, all, run, newId } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, ROLES } from '../middleware/auth.js';
import { ah, badRequest, conflict, notFound } from '../utils/http.js';
import { hashPassword, tempPassword } from '../utils/security.js';
import { requireFields, assertEmail, trimOrNull, normalizePhone } from '../utils/validate.js';
import { generateUsername } from '../utils/username.js';
import { logActivity } from '../utils/activityLog.js';
import { publicUser } from './auth.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin'));

const PROGRAM_REQUIRED = ['program_director', 'league_coach'];
const PROGRAM_FORBIDDEN = ['super_admin'];
const ROLE_LABELS = {
  super_admin: 'System Admin',
  program_director: 'Program Director',
  league_coach: 'Coach',
  referee_assignor: 'Referee Assignor',
  referee: 'Referee',
};

async function validateRoleProgram(role, programId) {
  if (!ROLES.includes(role)) throw badRequest('Choose a valid role.');
  if (PROGRAM_REQUIRED.includes(role) && !programId) throw badRequest(`A ${ROLE_LABELS[role]} must belong to a program.`);
  if (PROGRAM_FORBIDDEN.includes(role) && programId) throw badRequest('System Admins are league-wide and can’t belong to a program.');
  if (programId && !(await one('SELECT 1 FROM programs WHERE id = ?', [programId]))) throw badRequest('That program doesn’t exist.');
}

async function activeAdminCount(excludingId) {
  const r = await one("SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin' AND is_active = 1 AND id != ?", [excludingId]);
  return Number(r.n);
}

const SELECT_USERS = `SELECT u.*, p.name AS program_name FROM users u LEFT JOIN programs p ON p.id = u.program_id`;

// ---- GET /api/users ----
router.get('/', ah(async (req, res) => {
  const rows = await all(`${SELECT_USERS} ORDER BY u.last_name COLLATE NOCASE, u.first_name COLLATE NOCASE`);
  res.json({ users: rows.map((u) => ({ ...publicUser(u), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt })) });
}));

// ---- POST /api/users ----
// Returns the generated username + temporary password exactly once.
router.post('/', ah(async (req, res) => {
  requireFields(req.body, ['firstName', 'lastName', 'email', 'role']);
  const { firstName, lastName, email, role } = req.body;
  const programId = trimOrNull(req.body.programId);
  assertEmail(email);
  await validateRoleProgram(role, programId);

  const id = newId();
  const username = await generateUsername(firstName, lastName);
  const password = tempPassword();
  await run(
    `INSERT INTO users (id, first_name, last_name, username, email, phone, password_hash, role, program_id, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [id, firstName.trim(), lastName.trim(), username, email.trim(), normalizePhone(req.body.phone), await hashPassword(password), role, programId]
  );
  await logActivity({ category: 'user', action: 'created', actor: req.user, programId, details: `Created ${ROLE_LABELS[role]} account ${username}` });
  const user = await one(`${SELECT_USERS} WHERE u.id = ?`, [id]);
  res.status(201).json({ user: publicUser(user), temporaryPassword: password });
}));

// ---- PUT /api/users/:id ----
router.put('/:id', ah(async (req, res) => {
  const existing = await one('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!existing) throw notFound('User');

  const next = {
    firstName: req.body.firstName?.trim() || existing.firstName,
    lastName: req.body.lastName?.trim() || existing.lastName,
    email: req.body.email?.trim() || existing.email,
    phone: req.body.phone !== undefined ? normalizePhone(req.body.phone, 'Phone number', existing.phone) : existing.phone,
    role: req.body.role || existing.role,
    programId: req.body.programId !== undefined ? trimOrNull(req.body.programId) : existing.programId,
    isActive: req.body.isActive !== undefined ? (req.body.isActive ? 1 : 0) : existing.isActive,
  };
  assertEmail(next.email);
  await validateRoleProgram(next.role, next.programId);

  const losingAdmin = existing.role === 'super_admin' && existing.isActive && (next.role !== 'super_admin' || !next.isActive);
  if (losingAdmin && req.params.id === req.user.id) throw badRequest('You can’t remove your own System Admin access.');
  if (losingAdmin && (await activeAdminCount(existing.id)) === 0) throw conflict('The league needs at least one active System Admin.');

  await run(
    `UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ?, role = ?, program_id = ?, is_active = ?, updated_at = datetime('now')
     WHERE id = ?`,
    [next.firstName, next.lastName, next.email, next.phone, next.role, next.programId, next.isActive, existing.id]
  );
  await logActivity({ category: 'user', action: 'edited', actor: req.user, programId: next.programId, details: `Updated account ${existing.username}` });
  res.json({ user: publicUser(await one(`${SELECT_USERS} WHERE u.id = ?`, [existing.id])) });
}));

// ---- POST /api/users/:id/reset-password ----
router.post('/:id/reset-password', ah(async (req, res) => {
  const existing = await one('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!existing) throw notFound('User');
  const password = tempPassword();
  await run("UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = datetime('now') WHERE id = ?", [await hashPassword(password), existing.id]);
  await logActivity({ category: 'user', action: 'password_reset', actor: req.user, programId: existing.programId, details: `Issued a temporary password for ${existing.username}` });
  res.json({ temporaryPassword: password });
}));

export default router;

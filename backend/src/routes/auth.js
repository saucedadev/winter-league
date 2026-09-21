import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { one, run, newId } from '../db/client.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { ah, badRequest, HttpError } from '../utils/http.js';
import { hashPassword, verifyPassword, signToken, randomToken, sha256 } from '../utils/security.js';
import { requireFields, assertStrongPassword } from '../utils/validate.js';
import { sendEmail } from '../utils/email.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProd ? 30 : 1000,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Wait a few minutes and try again.' },
});

export function publicUser(u) {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    email: u.email,
    phone: u.phone ?? null,
    role: u.role,
    programId: u.programId,
    programName: u.programName ?? null,
    isActive: !!u.isActive,
    mustChangePassword: !!u.mustChangePassword,
  };
}

async function loadUser(id) {
  return one(
    `SELECT u.*, p.name AS program_name FROM users u LEFT JOIN programs p ON p.id = u.program_id WHERE u.id = ?`,
    [id]
  );
}

// ---- POST /api/auth/login ----
router.post('/login', authLimiter, ah(async (req, res) => {
  requireFields(req.body, ['username', 'password']);
  const user = await one('SELECT * FROM users WHERE username = ?', [String(req.body.username).trim()]);
  const ok = user && (await verifyPassword(req.body.password, user.passwordHash));
  if (!ok) throw new HttpError(401, 'That username and password don’t match.');
  if (!user.isActive) throw new HttpError(403, 'This account is inactive. Contact your league administrator.');

  await run("UPDATE users SET last_login_at = datetime('now') WHERE id = ?", [user.id]);
  const full = await loadUser(user.id);
  res.json({ token: signToken(user), user: publicUser(full) });
}));

// ---- GET /api/auth/me ----
router.get('/me', requireAuth, ah(async (req, res) => {
  res.json({ user: publicUser(await loadUser(req.user.id)) });
}));

// ---- POST /api/auth/change-password ----
// Works during the forced first-login change (no requirePasswordCurrent).
router.post('/change-password', requireAuth, ah(async (req, res) => {
  requireFields(req.body, ['currentPassword', 'newPassword']);
  const user = await one('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!(await verifyPassword(req.body.currentPassword, user.passwordHash))) {
    throw badRequest('Your current password is incorrect.');
  }
  assertStrongPassword(req.body.newPassword);
  if (req.body.newPassword === req.body.currentPassword) throw badRequest('Choose a password different from your current one.');

  await run(
    "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?",
    [await hashPassword(req.body.newPassword), user.id]
  );
  res.json({ user: publicUser(await loadUser(user.id)) });
}));

// ---- POST /api/auth/forgot-username ----
// Always responds the same way so the endpoint can't be used to discover
// which emails have accounts.
router.post('/forgot-username', authLimiter, ah(async (req, res) => {
  requireFields(req.body, ['email']);
  const email = String(req.body.email).trim();
  const r = await run('SELECT username, first_name FROM users WHERE email = ? AND is_active = 1', [email]);
  if (r.rows.length) {
    const names = r.rows.map((row) => `  • ${row.username}`).join('\n');
    await sendEmail({
      to: email,
      subject: 'Your Winter League username',
      text: `Hi ${r.rows[0].first_name},\n\nThe Winter League username${r.rows.length > 1 ? 's' : ''} for this email:\n${names}\n\nSign in at ${config.appUrls[0]}/login`,
    });
  }
  res.json({ message: 'If an account uses that email, we sent the username to it.' });
}));

// ---- POST /api/auth/forgot-password ----
router.post('/forgot-password', authLimiter, ah(async (req, res) => {
  requireFields(req.body, ['username']);
  const user = await one('SELECT * FROM users WHERE username = ? AND is_active = 1', [String(req.body.username).trim()]);
  if (user) {
    const token = randomToken();
    await run(
      "INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, datetime('now', '+1 hour'))",
      [newId(), user.id, sha256(token)]
    );
    await sendEmail({
      to: user.email,
      subject: 'Reset your Winter League password',
      text: `Hi ${user.firstName},\n\nUse this link within one hour to choose a new password:\n${config.appUrls[0]}/reset-password?token=${token}\n\nIf you didn’t ask for this, ignore this email — your password stays the same.`,
    });
  }
  res.json({ message: 'If that username exists, we emailed a reset link to the address on file.' });
}));

// ---- POST /api/auth/reset-password ----
router.post('/reset-password', authLimiter, ah(async (req, res) => {
  requireFields(req.body, ['token', 'newPassword']);
  assertStrongPassword(req.body.newPassword);
  const row = await one(
    "SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')",
    [sha256(req.body.token)]
  );
  if (!row) throw badRequest('This reset link has expired or was already used. Request a new one.');

  await run(
    "UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?",
    [await hashPassword(req.body.newPassword), row.userId]
  );
  await run("UPDATE password_reset_tokens SET used_at = datetime('now') WHERE user_id = ? AND used_at IS NULL", [row.userId]);
  res.json({ message: 'Password updated. Sign in with your new password.' });
}));

export default router;

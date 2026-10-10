import { Router } from 'express';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { one, run, newId } from '../db/client.js';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { ah, badRequest, HttpError } from '../utils/http.js';
import { hashPassword, verifyPassword, signToken, randomToken, sha256 } from '../utils/security.js';
import { generateUsername } from '../utils/username.js';
import { ROLES } from '../middleware/auth.js';
import { requireFields, assertStrongPassword } from '../utils/validate.js';
import { getBranding } from '../utils/branding.js';
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

// ---- POST /api/auth/sso ----
// Hub Portal single sign-on. The portal sends people here with a signed,
// one-time pass (see PORTAL-SSO.md); this checks it and starts an ordinary
// Winter League session, exactly as /login does.
router.post('/sso', authLimiter, ah(async (req, res) => {
  const { ssoSecret, appSlug, issuer } = config.portal;
  if (!ssoSecret) throw new HttpError(503, 'Signing in through the portal isn’t set up for this app yet.');

  // 1. Signature, expiry, issuer, and that the pass was made for this app.
  let pass;
  try {
    pass = jwt.verify(String(req.body?.token || ''), ssoSecret, { algorithms: ['HS256'], issuer, audience: appSlug });
  } catch (err) {
    // Each failure gets its own message, because the usual causes are set-up
    // mistakes an administrator has to fix, and a vague message hides which.
    // Nothing secret is revealed: only which check failed.
    const msg = String(err?.message || '');
    let reason;
    if (err?.name === 'TokenExpiredError') {
      reason = 'That sign-in link has expired (they last one minute). Open Winter League from the portal again.';
    } else if (msg.includes('signature')) {
      reason = 'The portal and Winter League don’t share the same secret, so the sign-in couldn’t be checked. An administrator needs to make PORTAL_SSO_SECRET here match SSO_SECRET_WINTER_LEAGUE on the portal.';
    } else if (msg.includes('audience')) {
      reason = `That sign-in link was made for a different app. In the portal, this app's ID must be "${appSlug}" (or set PORTAL_APP_SLUG to match it).`;
    } else if (msg.includes('issuer')) {
      reason = 'That sign-in link didn’t come from the expected portal. Check PORTAL_SSO_ISSUER.';
    } else {
      reason = 'That sign-in link isn’t valid. Open Winter League from the portal again.';
    }
    console.warn(`[portal sign-in] refused: ${msg || err?.name}`);
    throw new HttpError(401, reason);
  }
  const email = String(pass.email || '').trim().toLowerCase();
  if (!ROLES.includes(pass.role)) {
    console.warn(`[portal sign-in] refused: unknown role "${pass.role}"`);
    throw new HttpError(401, `The portal gave you the role "${pass.role}", which Winter League doesn’t have. In the portal's Admin > Apps, Winter League's role values must be: ${ROLES.join(', ')}.`);
  }
  if (!pass.jti || !email) {
    throw new HttpError(401, 'That sign-in link isn’t valid for Winter League. Open it from the portal again.');
  }

  // 2. Each pass works once: a second insert of the same ID fails.
  await run("DELETE FROM sso_used_passes WHERE expires_at < datetime('now')");
  try {
    await run("INSERT INTO sso_used_passes (jti, expires_at) VALUES (?, datetime(?, 'unixepoch'))", [pass.jti, pass.exp]);
  } catch {
    throw new HttpError(401, 'That sign-in link was already used. Open Winter League from the portal again.');
  }

  // 3. Find the person's Winter League account. Accounts are matched by
  //    email; Winter League allows several accounts per email, so when there
  //    is more than one, the one with the portal username wins, then the one
  //    with the portal role. Anything still ambiguous is refused rather than
  //    guessed, because accounts belong to different programs.
  const portalUsername = String(pass.username || '').trim().toLowerCase();
  const matches = (await run('SELECT id, username, role, is_active FROM users WHERE email = ? ORDER BY created_at', [email])).rows;
  let match = null;
  if (matches.length === 1) match = matches[0];
  else if (matches.length > 1) {
    const byUsername = matches.filter((u) => String(u.username).toLowerCase() === portalUsername);
    const byRole = matches.filter((u) => u.role === pass.role);
    match = byUsername.length === 1 ? byUsername[0] : byRole.length === 1 ? byRole[0] : null;
    if (!match) {
      throw new HttpError(409, 'More than one Winter League account uses your email address. Ask the league administrator to give one of them your portal username.');
    }
  }

  let userId;
  if (match) {
    if (!match.is_active) throw new HttpError(403, 'This account is inactive. Contact your league administrator.');
    userId = match.id;
    // The portal decides the role. Passwords now live in the portal, so a
    // pending "change your temporary password" no longer applies here.
    await run(
      "UPDATE users SET role = ?, must_change_password = 0, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [pass.role, userId],
    );
  } else {
    // First visit: create the account. Its password is random and never
    // used (sign-in goes through the portal). Program directors and coaches
    // still need a program assigned under Users before they see their teams.
    userId = newId();
    const first = String(pass.first_name || '').trim() || email.split('@')[0];
    const last = String(pass.last_name || '').trim() || '-';
    let username = /^[a-z0-9][a-z0-9._-]{2,29}$/.test(portalUsername) ? portalUsername : await generateUsername(first, last);
    if (await one('SELECT 1 FROM users WHERE username = ?', [username])) username = await generateUsername(first, last);
    await run(
      `INSERT INTO users (id, first_name, last_name, username, email, phone, password_hash, role, is_active, must_change_password, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0, datetime('now'))`,
      [userId, first, last, username, email, String(pass.phone || '').replace(/\D/g, '') || null, await hashPassword(randomToken()), pass.role],
    );
  }

  // 4. From here on it is an ordinary Winter League session.
  const user = await loadUser(userId);
  res.json({ token: signToken(user), user: publicUser(user) });
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
    const { appName } = await getBranding();
    await sendEmail({
      to: email,
      subject: `Your ${appName} username`,
      text: `Hi ${r.rows[0].first_name},\n\nThe ${appName} username${r.rows.length > 1 ? 's' : ''} for this email:\n${names}\n\nIf you didn’t ask for this, you can ignore this email.`,
      action: { label: 'Sign in', url: '/login' },
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
    const { appName } = await getBranding();
    await sendEmail({
      to: user.email,
      subject: `Reset your ${appName} password`,
      text: `Hi ${user.firstName},\n\nSomeone asked to reset the password for the username ${user.username}. Use the button within one hour to choose a new password.\n\nIf you didn’t ask for this, ignore this email — your password stays the same.`,
      action: { label: 'Choose a new password', url: `/reset-password?token=${token}` }, role: user.role,
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

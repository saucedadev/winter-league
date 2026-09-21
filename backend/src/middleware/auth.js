import { one } from '../db/client.js';
import { verifyToken } from '../utils/security.js';
import { forbidden, HttpError } from '../utils/http.js';

export const ROLES = ['super_admin', 'program_director', 'league_coach', 'referee_assignor', 'referee'];

// Bearer token in the Authorization header (not a cookie). Same approach
// Gym Hive landed on: Vercel and Render are different sites, and Safari's
// tracking prevention blocks cross-site cookies, which silently breaks
// cookie sessions on iPhones.
export async function requireAuth(req, res, next) {
  try {
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw new HttpError(401, 'Sign in to continue.');

    let payload;
    try {
      payload = verifyToken(token);
    } catch {
      throw new HttpError(401, 'Your session has expired. Sign in again.');
    }

    // Re-read the user every request so deactivation or a role change
    // takes effect immediately rather than when the token expires.
    const user = await one(
      `SELECT id, first_name, last_name, username, email, role, program_id, is_active, must_change_password
       FROM users WHERE id = ?`,
      [payload.sub]
    );
    if (!user || !user.isActive) throw new HttpError(401, 'This account is inactive. Contact your league administrator.');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

// Blocks everything except the change-password flow until a forced
// password change is complete.
export function requirePasswordCurrent(req, res, next) {
  if (req.user?.mustChangePassword) return next(new HttpError(403, 'Change your temporary password to continue.', { code: 'MUST_CHANGE_PASSWORD' }));
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
  next();
};

export const isSuperAdmin = (user) => user?.role === 'super_admin';

// ---------------------------------------------------------------------
// Program scoping — the core multi-tenant rule, enforced server-side on
// every program-owned record regardless of what the UI shows:
//   super_admin      -> any program (optionally filtered by ?programId=)
//   program_director -> only their own program, always
// ---------------------------------------------------------------------
export function readScope(req) {
  const requested = req.query.programId || null;
  if (isSuperAdmin(req.user)) return requested;
  if (!req.user.programId) throw forbidden('Your account is not assigned to a program yet.');
  if (requested && requested !== req.user.programId) throw forbidden('You can only view your own program.');
  return req.user.programId;
}

export function assertCanManageProgram(req, programId) {
  if (isSuperAdmin(req.user)) return;
  if (req.user.role !== 'program_director' || req.user.programId !== programId) {
    throw forbidden('You can only manage records for your own program.');
  }
}

// For creates: PDs are pinned to their program no matter what they send.
export function resolveWriteProgram(req, bodyProgramId) {
  if (isSuperAdmin(req.user)) {
    if (!bodyProgramId) throw new HttpError(400, 'Choose a program.');
    return bodyProgramId;
  }
  if (req.user.role !== 'program_director' || !req.user.programId) throw forbidden();
  return req.user.programId;
}

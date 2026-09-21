import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';

export const hashPassword = (pw) => bcrypt.hash(pw, 10);
export const verifyPassword = (pw, hash) => bcrypt.compare(pw, hash);

// `aud` pins tokens to this app: a Gym Hive token can never be replayed
// against the Winter League API even if the secrets were ever reused.
const AUDIENCE = 'winter-league';

export const signToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwtSecret, { expiresIn: config.jwtExpiresIn, audience: AUDIENCE });

export const verifyToken = (token) => jwt.verify(token, config.jwtSecret, { audience: AUDIENCE });

export const randomToken = () => crypto.randomBytes(32).toString('hex');
export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Readable temporary password for new accounts / admin resets:
// e.g. "Frost-4821-Court". Always satisfies the password rule.
const WORDS = ['Frost', 'Court', 'Rebound', 'Pivot', 'Glacier', 'Assist', 'Timber', 'Summit', 'Harbor', 'Baseline', 'Cedar', 'Tipoff'];
export function tempPassword() {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${crypto.randomInt(1000, 9999)}-${pick()}`;
}

// Production-safe, idempotent seed: only creates what's missing.
//   By default: ONLY the first System Admin (League Admin), from the
//   SEED_ADMIN_* settings. Nothing else: the league sets up its own season,
//   divisions, programs and branding in the app.
//   --with-divisions: also a starter set of divisions (4th–8th grade boys and
//   girls), only if there are none yet.
// Run locally:  npm run seed      Against Turso:  npm run seed:prod
import { config } from '../config.js';
import { db, one, run, newId, isLocalDb } from '../db/client.js';
import { hashPassword } from '../utils/security.js';
import { generateUsername } from '../utils/username.js';

const DEFAULT_DIVISIONS = [
  ['4th Grade Boys', '4', 'boys'], ['5th Grade Boys', '5', 'boys'], ['6th Grade Boys', '6', 'boys'],
  ['7th Grade Boys', '7', 'boys'], ['8th Grade Boys', '8', 'boys'],
  ['4th Grade Girls', '4', 'girls'], ['5th Grade Girls', '5', 'girls'], ['6th Grade Girls', '6', 'girls'],
  ['7th Grade Girls', '7', 'girls'], ['8th Grade Girls', '8', 'girls'],
];

// The first System Admin, from the SEED_ADMIN_* settings. A hosted (Turso)
// database is a real one: it never gets the built-in placeholder email or the
// well-known development password, so those are reported as problems there.
export function adminSettings({ hosted = false } = {}) {
  const env = process.env;
  const first = (env.SEED_ADMIN_FIRST_NAME || 'League').trim();
  const last = (env.SEED_ADMIN_LAST_NAME || 'Admin').trim();
  const email = (env.SEED_ADMIN_EMAIL || 'admin@example.com').trim();
  const password = env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const problems = [];
  if (hosted) {
    if (!env.SEED_ADMIN_EMAIL || /@(example\.com|yourdomain\.com)$/i.test(email) || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) problems.push('SEED_ADMIN_EMAIL must be the admin’s real email address.');
    if (!env.SEED_ADMIN_PASSWORD || password === 'ChangeMe123!' || password.length < 10 || /^<.*>$/.test(password)) problems.push('SEED_ADMIN_PASSWORD must be a temporary password of at least 10 characters (not ChangeMe123!).');
    if (!env.SEED_ADMIN_FIRST_NAME || !env.SEED_ADMIN_LAST_NAME || /^<.*>$/.test(first) || /^<.*>$/.test(last)) problems.push('SEED_ADMIN_FIRST_NAME and SEED_ADMIN_LAST_NAME must be the admin’s name (the username is made from it).');
  }
  return { first, last, email, password, problems };
}

export async function seedBase({ quiet = false, divisions = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const hasSchema = await one("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  if (!hasSchema) throw new Error('Tables not found. Run the migration first (npm run migrate / migrate:prod).');

  if (divisions && !(await one('SELECT 1 FROM divisions LIMIT 1'))) {
    await db.batch(DEFAULT_DIVISIONS.map(([name, grade, gender], i) => ({
      sql: 'INSERT INTO divisions (id, name, grade, gender, sort_order) VALUES (?, ?, ?, ?, ?)',
      args: [newId(), name, grade, gender, (i + 1) * 10],
    })), 'write');
    log(`   Added ${DEFAULT_DIVISIONS.length} starter divisions (edit them under League setup).`);
  }

  const admin = await one("SELECT username FROM users WHERE role = 'super_admin' LIMIT 1");
  if (admin) {
    log(`   A System Admin already exists (${admin.username}) — left unchanged.`);
    return null;
  }
  const { first, last, email, password, problems } = adminSettings({ hosted: !isLocalDb });
  if (problems.length) throw new Error(`Not creating the System Admin on a hosted database:\n   - ${problems.join('\n   - ')}\n   Set these in your env file (e.g. .env.production.local) and run it again.`);
  const username = await generateUsername(first, last);
  await run(
    `INSERT INTO users (id, first_name, last_name, username, email, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, 'super_admin', 1)`,
    [newId(), first, last, username, email, await hashPassword(password)]
  );
  log(`\n   🔑 System Admin created\n      name:     ${first} ${last} <${email}>\n      username: ${username}\n      password: ${config.isProd ? '(the SEED_ADMIN_PASSWORD you set)' : password}\n      You'll be asked to change it on first sign-in.\n`);
  return { username, password };
}

if (process.argv[1]?.endsWith('seed.js')) {
  const withDivisions = process.argv.includes('--with-divisions');
  console.log(withDivisions ? '🌱 Creating the System Admin and starter divisions…' : '🌱 Creating the System Admin…');
  try {
    await seedBase({ divisions: withDivisions });
    console.log('✅ Seed complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

// Production-safe, idempotent seed: only creates what's missing.
//   • the first System Admin (from SEED_ADMIN_* env vars)
//   • a starter set of divisions (only if there are none yet)
//   • the default theme setting
// Run locally:  npm run seed      Against Turso:  npm run seed:prod
import { config } from '../config.js';
import { db, one, run, newId } from '../db/client.js';
import { hashPassword } from '../utils/security.js';
import { generateUsername } from '../utils/username.js';

const DEFAULT_DIVISIONS = [
  ['4th Grade Boys', '4', 'boys'], ['5th Grade Boys', '5', 'boys'], ['6th Grade Boys', '6', 'boys'],
  ['7th Grade Boys', '7', 'boys'], ['8th Grade Boys', '8', 'boys'],
  ['4th Grade Girls', '4', 'girls'], ['5th Grade Girls', '5', 'girls'], ['6th Grade Girls', '6', 'girls'],
  ['7th Grade Girls', '7', 'girls'], ['8th Grade Girls', '8', 'girls'],
];

export async function seedBase({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const hasSchema = await one("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'");
  if (!hasSchema) throw new Error('Tables not found. Run the migration first (npm run migrate / migrate:prod).');

  await run("INSERT INTO app_settings (key, value) VALUES ('theme', 'light') ON CONFLICT(key) DO NOTHING");

  if (!(await one('SELECT 1 FROM divisions LIMIT 1'))) {
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
  const first = process.env.SEED_ADMIN_FIRST_NAME || 'League';
  const last = process.env.SEED_ADMIN_LAST_NAME || 'Admin';
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'ChangeMe123!';
  const username = await generateUsername(first, last);
  await run(
    `INSERT INTO users (id, first_name, last_name, username, email, password_hash, role, must_change_password)
     VALUES (?, ?, ?, ?, ?, ?, 'super_admin', 1)`,
    [newId(), first, last, username, email, await hashPassword(password)]
  );
  log(`\n   🔑 System Admin created\n      username: ${username}\n      password: ${config.isProd ? '(the SEED_ADMIN_PASSWORD you set)' : password}\n      You'll be asked to change it on first sign-in.\n`);
  return { username, password };
}

if (process.argv[1]?.endsWith('seed.js')) {
  console.log('🌱 Seeding base data...');
  try {
    await seedBase();
    console.log('✅ Seed complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

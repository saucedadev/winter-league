// DEMO ONLY: sign off the shared draft for every program still waiting, so a
// demo can show one or two directors signing off live and then publish
// without signing in as every director.
//
//   npm run demo:signoff                                   local database
//   node src/scripts/demoSignOff.js --env=.env.demo.local --force   hosted demo database
//
// Each sign-off is recorded under that program's director (or the System
// Admin, on behalf of a program without one) with the note "Signed off by the
// demo script", so the record never pretends a person clicked it. It refuses
// to run against a non-local database unless --force is given, and never
// touches a draft that isn't shared.
import { config } from '../config.js';
import { one, all, db } from '../db/client.js';
import { logActivity } from '../utils/activityLog.js';

if (!config.databaseUrl.startsWith('file:') && !process.argv.includes('--force')) {
  console.error('❌ demo:signoff only runs against a local database. For the hosted DEMO database add --force (never on the real league).');
  process.exit(1);
}

const season = await one('SELECT * FROM seasons WHERE is_active = 1');
const run = season && await one("SELECT * FROM schedule_runs WHERE season_id = ? AND status = 'draft' AND shared_at IS NOT NULL", [season.id]);
if (!run) {
  console.error('❌ There’s no shared draft. Generate a draft and click “Share with directors” in the Schedule builder first.');
  process.exit(1);
}
const waiting = await all(`SELECT r.id, r.program_id, p.name,
    (SELECT u.id FROM users u WHERE u.program_id = r.program_id AND u.role = 'program_director' AND u.is_active = 1 ORDER BY u.created_at LIMIT 1) AS director_id
  FROM draft_reviews r JOIN programs p ON p.id = r.program_id WHERE r.run_id = ? AND r.status != 'signed_off' ORDER BY p.name`, [run.id]);
if (!waiting.length) {
  console.log('✅ Every program has already signed off. Publish from the Schedule builder.');
  process.exit(0);
}
const admin = await one("SELECT id, first_name, last_name, role, program_id FROM users WHERE role = 'super_admin' AND is_active = 1 ORDER BY created_at LIMIT 1");
const NOTE = 'Signed off by the demo script';
const stmts = [];
for (const w of waiting) {
  const by = w.directorId || admin.id;
  stmts.push({ sql: `UPDATE draft_reviews SET status = 'signed_off', decided_by = ?, decided_at = datetime('now'), on_behalf = ?, note = ?, reset_reason = NULL, updated_at = datetime('now') WHERE id = ?`,
    args: [by, w.directorId ? 0 : 1, NOTE, w.id] });
  stmts.push({ sql: `UPDATE draft_flags SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now'), resolution_note = ? WHERE run_id = ? AND program_id = ? AND status = 'open'`,
    args: [by, NOTE, run.id, w.programId] });
}
await db.batch(stmts, 'write');
await logActivity({ category: 'schedule', action: 'signed off', actor: admin, details: `Demo script signed off the draft for ${waiting.map((w) => w.name).join(', ')}` });
console.log(`✅ Signed off for ${waiting.length} program${waiting.length === 1 ? '' : 's'}: ${waiting.map((w) => w.name).join(', ')}. You can publish now.`);
process.exit(0);

// LOCAL ONLY: deletes the SQLite file and rebuilds it from scratch
// (migrate -> seed -> seed:demo). Refuses to touch a Turso database.
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { config } from '../config.js';

if (!config.databaseUrl.startsWith('file:')) {
  console.error('❌ db:reset only works on a local SQLite database. It will never reset Turso.');
  process.exit(1);
}
const file = path.resolve(config.databaseUrl.replace(/^file:/, ''));
for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) if (fs.existsSync(f)) fs.rmSync(f);
console.log(`🧹 Removed ${file}`);
for (const s of ['migrate', 'seed', 'seed:demo']) execSync(`npm run --silent ${s}`, { stdio: 'inherit' });
console.log('⚠️  If `npm run dev` was already running, restart it now — it still points at the deleted database file.\n');

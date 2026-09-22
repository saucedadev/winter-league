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
// Check the demo data first (e.g. the spreadsheet), so a mistake in the file
// stops the reset before the current database is deleted.
const passArgs = process.argv.slice(2).filter((x) => /^--(dataset|file)=|^--(real-emails|no-schedule)$/.test(x)).map((x) => JSON.stringify(x)).join(' ');
try {
  execSync(`node src/scripts/seedDemo.js --check ${passArgs}`, { stdio: 'inherit' });
} catch {
  console.error('\n❌ Reset stopped: fix the demo data above and run it again. Your current database was not touched.');
  process.exit(1);
}
const file = path.resolve(config.databaseUrl.replace(/^file:/, ''));
for (const f of [file, `${file}-wal`, `${file}-shm`, `${file}-journal`]) if (fs.existsSync(f)) fs.rmSync(f);
console.log(`🧹 Removed ${file}`);
// Pass demo options through, e.g. npm run db:reset -- --dataset=test
for (const s of ['migrate', 'seed', 'seed:demo']) {
  execSync(`npm run --silent ${s}${s === 'seed:demo' && passArgs ? ` -- ${passArgs}` : ''}`, { stdio: 'inherit' });
}
console.log('⚠️  If `npm run dev` was already running, restart it now — it still points at the deleted database file.\n');

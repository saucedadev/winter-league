// Start a hosted (Turso) database over for go-live: delete ALL league data —
// users, programs, teams, venues, gym slots, schedules, referees, requests,
// activity, settings — then create only the System Admin (League Admin) from
// the SEED_ADMIN_* settings. The tables themselves stay, so nothing needs
// re-migrating, and any pending database updates are applied afterwards.
//
//   npm run db:reset:prod                          shows what would be deleted, changes nothing
//   npm run db:reset:prod -- --confirm=<db name>   does it
//   … --keep-branding                              keeps the app name, logo and theme
//   … --with-divisions                             also adds the starter divisions
//
// <db name> is the first part of DATABASE_URL's host, e.g. winter-league-myorg
// for libsql://winter-league-myorg.turso.io, so it can't be run against the
// wrong database by accident. Uses .env.production.local (see package.json).
import path from 'node:path';
import { config } from '../config.js';
import { isLocalDb } from '../db/client.js';
import { migrate } from '../db/migrator.js';
import { dataTables, rowCounts, clearAllData } from '../db/wipe.js';
import { seedBase, adminSettings } from './seed.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const keepBranding = process.argv.includes('--keep-branding');
const withDivisions = process.argv.includes('--with-divisions');

const name = isLocalDb ? path.basename(config.databaseUrl.replace(/^file:/, ''), '.db') : new URL(config.databaseUrl).host.split('.')[0];
const where = isLocalDb ? config.databaseUrl : new URL(config.databaseUrl).host;

try {
  console.log(`🗄️  Database: ${where}`);
  // Bring the schema up to date first, so every current table is counted and cleared.
  const { applied } = await migrate();
  if (applied) console.log(`   Applied ${applied} pending database update${applied === 1 ? '' : 's'}.`);
  const tables = await dataTables();
  const counts = await rowCounts(tables);
  const filled = tables.filter((t) => counts[t] > 0);
  const show = ['users', 'programs', 'teams', 'venues', 'gym_slots', 'games', 'referee_assignments', 'change_requests', 'rule_requests', 'activity_log'];
  console.log('\n   Currently in it:');
  for (const t of show.filter((x) => x in counts)) console.log(`     ${t.padEnd(22)} ${counts[t]}`);
  const others = filled.filter((t) => !show.includes(t)).length;
  if (others) console.log(`     …and rows in ${others} other table${others === 1 ? '' : 's'}`);

  const early = adminSettings({ hosted: !isLocalDb }).problems;
  if (early.length && arg('confirm') !== name) console.log(`\n   ⚠️  Before running it for real, fix these in your env file:\n     - ${early.join('\n     - ')}`);
  if (arg('confirm') !== name) {
    if (arg('confirm') != null) console.log(`\n❌ --confirm=${arg('confirm')} doesn’t match this database (${name}). Nothing was changed.`);
    console.log(`\n   Nothing has been changed. To delete ALL of the data above and keep only a new System Admin, run:\n\n     npm run db:reset:prod -- --confirm=${name}${keepBranding ? ' --keep-branding' : ''}${withDivisions ? ' --with-divisions' : ''}\n`);
    console.log('   Add --keep-branding to keep the app name, logo and theme. Take a backup first if you might need any of it (see DEPLOYMENT.md).');
    process.exit(arg('confirm') != null ? 1 : 0);
  }

  // Check the admin settings BEFORE deleting anything, so a missing password can't leave an empty database.
  const { problems } = adminSettings({ hosted: !isLocalDb });
  if (problems.length) throw new Error(`Fix these in your env file first. Nothing was changed.\n   - ${problems.join('\n   - ')}`);
  console.log(`\n🧹 Deleting all league data${keepBranding ? ' (keeping branding)' : ''}…`);
  await clearAllData({ keepBranding });
  const after = await rowCounts(await dataTables());
  const left = Object.entries(after).filter(([t, n]) => n > 0 && !(keepBranding && t === 'app_settings'));
  if (left.length) throw new Error(`Some data was not deleted: ${left.map(([t, n]) => `${t} (${n})`).join(', ')}`);
  await seedBase({ divisions: withDivisions });
  console.log(`✅ Done. The database is empty apart from the System Admin above${withDivisions ? ' and the starter divisions' : ''}${keepBranding ? ' and your branding' : ''}. Sign in, change the password, then set up the season under League setup.`);
  process.exit(0);
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}

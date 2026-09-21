import { config } from '../config.js';
import { migrate } from '../db/migrator.js';

const target = config.databaseUrl.startsWith('file:') ? config.databaseUrl : config.databaseUrl.replace(/\?.*$/, '');
console.log(`🗄️  Migrating ${target}`);
try {
  const { applied, total } = await migrate();
  console.log(applied ? `✅ Migration complete — ${applied} new, ${total} total.` : `✅ Already up to date (${total} migrations).`);
  process.exit(0);
} catch (err) {
  console.error('❌ Migration failed:', err.message);
  process.exit(1);
}

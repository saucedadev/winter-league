import { db } from './client.js';

// Every table that holds league data: everything except the record of which
// database updates have run (schema_migrations) and SQLite/libSQL internals.
// Read from the database itself, so tables added by later updates are always
// included without editing a list here.
export async function dataTables() {
  const r = await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'libsql_%' AND name NOT LIKE '_litestream%' AND name <> 'schema_migrations'
    ORDER BY name`);
  return r.rows.map((x) => x.name);
}

// How many rows each table has, for the confirmation summary.
export async function rowCounts(tables) {
  const out = {};
  for (const t of tables) out[t] = Number((await db.execute(`SELECT COUNT(*) AS n FROM "${t}"`)).rows[0].n);
  return out;
}

// Empty every data table; the tables themselves (the schema) stay.
// keepBranding: keep the app name, logo and sitewide theme (app_settings
// 'branding' and 'theme'); every other setting goes back to its default.
// Foreign-key checks are switched off for the duration so the order of the
// deletes doesn't matter, and switched back on afterwards.
export async function clearAllData({ keepBranding = false } = {}) {
  const tables = await dataTables();
  const deletes = tables.map((t) => (t === 'app_settings' && keepBranding
    ? "DELETE FROM app_settings WHERE key NOT IN ('branding', 'theme');"
    : `DELETE FROM "${t}";`));
  await db.executeMultiple(['PRAGMA foreign_keys = OFF;', ...deletes, 'PRAGMA foreign_keys = ON;'].join('\n'));
  return tables;
}

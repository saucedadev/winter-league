import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './client.js';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

// Remove "-- comment" text before splitting on ';' so a semicolon inside a
// comment can't break a statement in half.
function splitStatements(sql) {
  return sql
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Versioned, idempotent migrations. Each file in ./migrations runs exactly
// once per database (tracked in schema_migrations), inside one atomic
// batch — a failing migration leaves the database untouched. Safe to run
// on every deploy, which is what `npm run start:render` does.
export async function migrate({ log = console.log } = {}) {
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  await db.execute('PRAGMA foreign_keys = ON');

  const applied = new Set((await db.execute('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const statements = splitStatements(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    log(`  → applying ${file} (${statements.length} statements)`);
    await db.batch(
      [...statements, { sql: 'INSERT INTO schema_migrations (name) VALUES (?)', args: [file] }],
      'write'
    );
    count++;
  }
  return { applied: count, total: files.length };
}

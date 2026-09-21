import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

// One client, two targets:
//   file:./data/winter-league.db   -> local SQLite file (development)
//   libsql://...turso.io           -> hosted Turso (production)
// Nothing else in the codebase knows or cares which one is active.
if (config.databaseUrl.startsWith('file:')) {
  const filePath = config.databaseUrl.replace(/^file:/, '');
  fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
}

export const db = createClient({
  url: config.databaseUrl,
  authToken: config.databaseAuthToken,
});

export const isLocalDb = config.databaseUrl.startsWith('file:');

// libSQL returns rows keyed by column name; convert snake_case -> camelCase
// so API responses match the frontend's conventions.
export function toCamel(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  }
  return out;
}

export async function one(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] ? toCamel(r.rows[0]) : null;
}

export async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows.map(toCamel);
}

export async function run(sql, args = []) {
  return db.execute({ sql, args });
}

export const newId = () => crypto.randomUUID();

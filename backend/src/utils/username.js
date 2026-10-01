import { one } from '../db/client.js';

import { badRequest, conflict } from './http.js';

// A username the System Admin types: 3–30 characters, lowercase letters,
// numbers, dots, dashes or underscores, starting with a letter or number.
export const USERNAME_RULE = 'Usernames are 3–30 characters: lowercase letters, numbers, and . _ - (starting with a letter or number).';
export function normalizeUsername(value) {
  const u = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(u)) throw badRequest(USERNAME_RULE);
  return u;
}
export async function assertUsernameFree(username, excludeId = '') {
  if (await one('SELECT 1 FROM users WHERE username = ? AND id != ?', [username, excludeId])) {
    throw conflict(`The username “${username}” is already taken. Try another, e.g. with a number on the end.`);
  }
}

// first initial + last name, lowercased, letters only: "Dana Whitfield" -> "dwhitfield".
// Collisions get a number: dwhitfield2, dwhitfield3, ...
export async function generateUsername(firstName, lastName) {
  const clean = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  const base = (clean(firstName).slice(0, 1) + clean(lastName)).slice(0, 20) || 'user';
  let candidate = base;
  for (let n = 2; await one('SELECT 1 FROM users WHERE username = ?', [candidate]); n++) {
    candidate = `${base}${n}`;
  }
  return candidate;
}

import { one } from '../db/client.js';

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

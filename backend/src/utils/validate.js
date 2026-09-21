import { badRequest } from './http.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function requireFields(body, fields) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || String(body[f]).trim() === '');
  if (missing.length) throw badRequest(`Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`);
}

export function isValidDate(s) {
  if (!DATE_RE.test(s || '')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function assertDate(s, label = 'Date') {
  if (!isValidDate(s)) throw badRequest(`${label} must be a real date in YYYY-MM-DD format.`);
}

export function assertTime(s, label = 'Time') {
  if (!TIME_RE.test(s || '')) throw badRequest(`${label} must be in 24-hour HH:MM format.`);
}

export function assertEmail(s) {
  if (!EMAIL_RE.test(s || '')) throw badRequest('Enter a valid email address.');
}

export function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatTime12(t) {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${suffix}`;
}

export const trimOrNull = (v) => (v === undefined || v === null || String(v).trim() === '' ? null : String(v).trim());

export const PASSWORD_RULE = 'Password must be at least 10 characters and include a letter and a number.';
export function assertStrongPassword(pw) {
  if (typeof pw !== 'string' || pw.length < 10 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw badRequest(PASSWORD_RULE);
  }
}

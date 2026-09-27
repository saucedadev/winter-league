// Guest (non-conference) programs — see migration 009.
import { one, all } from '../db/client.js';
import { badRequest } from './http.js';

export async function isGuestProgram(programId) {
  if (!programId) return false;
  const p = await one('SELECT is_guest FROM programs WHERE id = ?', [programId]);
  return !!p?.isGuest;
}

// Guests are visitors: no gyms, game slots, blackouts, directors or coaches.
export async function assertLeagueProgram(programId, what, why = 'Guest games are played at the league team’s gym.') {
  if (await isGuestProgram(programId)) throw badRequest(`Guest programs don’t have ${what}. ${why}`);
}

export async function guestProgramIds() {
  return new Set((await all('SELECT id FROM programs WHERE is_guest = 1')).map((p) => p.id));
}

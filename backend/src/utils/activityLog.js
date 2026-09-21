import { db, newId } from '../db/client.js';

// Categories: program, season, division, venue, team, slot, blackout, user,
// schedule, request, referee.
//
//   programId:  the entry's main program (optional)
//   programIds: every program the entry involves (e.g. both programs in a
//               change request). A Program Director sees an entry if their
//               program is any of these. programId is always included.
//   actor:      who did it. Their own program and role are recorded as they
//               are right now, so the Activity screen shows e.g.
//               "Misty Sauceda · GYB" regardless of which program the entry is about.
//
// Logging must never break the action being logged, so failures are
// reported to the console and swallowed.
export async function logActivity({ category, action, actor, programId = null, programIds = [], details }) {
  try {
    const id = newId();
    const involved = [...new Set([programId, ...programIds].filter(Boolean))];
    await db.batch([
      {
        sql: `INSERT INTO activity_log (id, category, action, actor_id, actor_name, actor_program_id, actor_role, program_id, details)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [id, category, action, actor?.id || null, actor ? `${actor.firstName} ${actor.lastName}` : 'System',
          actor?.programId || null, actor?.role || null, programId || involved[0] || null, details],
      },
      ...involved.map((p) => ({ sql: 'INSERT OR IGNORE INTO activity_log_programs (activity_id, program_id) VALUES (?, ?)', args: [id, p] })),
    ], 'write');
  } catch (err) {
    console.error('activity log write failed:', err.message);
  }
}

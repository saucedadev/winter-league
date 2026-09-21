import { run, newId } from '../db/client.js';

// Categories: program, season, division, venue, team, slot, blackout, user.
// Logging must never break the action being logged, so failures are
// reported to the console and swallowed.
export async function logActivity({ category, action, actor, programId = null, details }) {
  try {
    await run(
      `INSERT INTO activity_log (id, category, action, actor_id, actor_name, program_id, details)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), category, action, actor?.id || null, actor ? `${actor.firstName} ${actor.lastName}` : 'System', programId, details]
    );
  } catch (err) {
    console.error('activity log write failed:', err.message);
  }
}

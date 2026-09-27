// Draft sharing and director sign-off (migration 010).
//
//   share ─▶ each program with teams in the draft: waiting
//   director signs off ─▶ signed_off        director flags a game ─▶ flagged
//   admin changes a game ─▶ the two teams' programs go back to waiting
//   publish ─▶ needs every program signed off, or (after the deadline) an
//              override that's recorded on the schedule
// A program without an active director can be signed off by the System
// Admin on its behalf; that's recorded too.
import { one, all, db, newId } from '../db/client.js';
import { leagueToday } from '../utils/leagueTime.js';
import { formatTime12 } from '../utils/validate.js';
import { notifyUsers } from '../referees/data.js';
import { logActivity } from '../utils/activityLog.js';

export const REVIEW_LABELS = { waiting: 'Waiting', signed_off: 'Signed off', flagged: 'Flagged' };

export const deadlinePassed = (run) => !!run?.reviewDeadline && leagueToday() > run.reviewDeadline;

export const gameLabel = (g) => `${g.homeTeamName} vs ${g.awayTeamName}${g.date ? `, ${g.date} at ${formatTime12(g.startTime)}` : ' (not placed)'}`;

// League programs (not guests) with at least one team in the run.
async function programsInRun(runId) {
  return all(`SELECT DISTINCT p.id, p.name FROM games g
    JOIN teams t ON t.id IN (g.home_team_id, g.away_team_id) JOIN programs p ON p.id = t.program_id
    WHERE g.run_id = ? AND p.is_guest = 0 ORDER BY p.name COLLATE NOCASE`, [runId]);
}

// Everything the builder's review panel shows.
export async function reviewState(run) {
  const reviews = await all(`SELECT r.*, p.name AS program_name, p.short_code,
      u.first_name || ' ' || u.last_name AS decided_by_name,
      (SELECT GROUP_CONCAT(d.first_name || ' ' || d.last_name, ', ') FROM users d
        WHERE d.program_id = r.program_id AND d.role = 'program_director' AND d.is_active = 1) AS director_names
    FROM draft_reviews r JOIN programs p ON p.id = r.program_id LEFT JOIN users u ON u.id = r.decided_by
    WHERE r.run_id = ? ORDER BY p.name COLLATE NOCASE`, [run.id]);
  const flags = await all(`SELECT f.*, p.name AS program_name, cu.first_name || ' ' || cu.last_name AS created_by_name,
      ru.first_name || ' ' || ru.last_name AS resolved_by_name
    FROM draft_flags f JOIN programs p ON p.id = f.program_id
    LEFT JOIN users cu ON cu.id = f.created_by LEFT JOIN users ru ON ru.id = f.resolved_by
    WHERE f.run_id = ? ORDER BY f.status = 'resolved', f.created_at DESC`, [run.id]);
  const shaped = reviews.map((r) => ({ ...r, onBehalf: !!r.onBehalf, hasDirector: !!r.directorNames, statusLabel: REVIEW_LABELS[r.status],
    openFlags: flags.filter((f) => f.programId === r.programId && f.status === 'open').length }));
  const pending = shaped.filter((r) => r.status !== 'signed_off');
  return {
    shared: !!run.sharedAt, sharedAt: run.sharedAt, deadline: run.reviewDeadline, deadlinePassed: deadlinePassed(run),
    reviews: shaped, flags,
    counts: { total: shaped.length, signedOff: shaped.length - pending.length, waiting: pending.filter((r) => r.status === 'waiting').length, flagged: pending.filter((r) => r.status === 'flagged').length },
    allSignedOff: !!run.sharedAt && pending.length === 0,
    pending: pending.map((r) => ({ programId: r.programId, programName: r.programName, status: r.status })),
  };
}

// Share a draft (or, if it's already shared, just change the deadline).
export async function shareDraft(run, { deadline = null, actor }) {
  if (run.sharedAt) {
    await db.execute({ sql: 'UPDATE schedule_runs SET review_deadline = ? WHERE id = ?', args: [deadline, run.id] });
    await logActivity({ category: 'schedule', action: 'review deadline', actor, details: deadline ? `Set the draft review deadline to ${deadline}` : 'Removed the draft review deadline' });
    return { changedDeadline: true };
  }
  const programs = await programsInRun(run.id);
  const stmts = [{ sql: "UPDATE schedule_runs SET shared_at = datetime('now'), shared_by = ?, review_deadline = ? WHERE id = ?", args: [actor.id, deadline, run.id] }];
  for (const p of programs) {
    stmts.push({ sql: 'INSERT OR IGNORE INTO draft_reviews (id, run_id, program_id) VALUES (?, ?, ?)', args: [newId(), run.id, p.id] });
  }
  await db.batch(stmts, 'write');
  await logActivity({ category: 'schedule', action: 'shared', actor, programIds: programs.map((p) => p.id),
    details: `Shared the draft schedule with Program Directors for sign-off${deadline ? ` (deadline ${deadline})` : ''}` });
  await notifyUsers(`role = 'program_director' AND program_id IN (${programs.map(() => '?').join(',') || "''"})`, programs.map((p) => p.id),
    'The draft schedule is ready for your review',
    `The league has shared the draft schedule. Please review your program's games and sign off, or flag any game that doesn't work, under Draft review.${deadline ? `\nPlease respond by ${deadline}.` : ''}\nIt isn't published yet: coaches and referees can't see it.`);
  return { programs: programs.length };
}

// The admin changed games in a shared draft: the programs involved must
// review again (only those that had already signed off or flagged).
export async function draftChanged(runId, programIds, reason, actor) {
  const run = await one('SELECT id, shared_at FROM schedule_runs WHERE id = ? AND status = ?', [runId, 'draft']);
  if (!run?.sharedAt || !programIds.length) return;
  const ids = [...new Set(programIds.filter(Boolean))];
  const ph = ids.map(() => '?').join(',');
  const guests = new Set((await all(`SELECT id FROM programs WHERE is_guest = 1 AND id IN (${ph})`, ids)).map((p) => p.id));
  const affected = ids.filter((id) => !guests.has(id));
  if (!affected.length) return;
  const existing = await all(`SELECT program_id, status FROM draft_reviews WHERE run_id = ? AND program_id IN (${affected.map(() => '?').join(',')})`, [runId, ...affected]);
  const have = new Map(existing.map((r) => [r.programId, r.status]));
  const stmts = [];
  const reset = [];
  for (const pid of affected) {
    if (!have.has(pid)) {
      // A program that had no games when the draft was shared (a game was added).
      stmts.push({ sql: 'INSERT INTO draft_reviews (id, run_id, program_id, reset_reason) VALUES (?, ?, ?, ?)', args: [newId(), runId, pid, reason] });
      reset.push(pid);
    } else if (have.get(pid) !== 'waiting') {
      stmts.push({ sql: `UPDATE draft_reviews SET status = 'waiting', decided_by = NULL, decided_at = NULL, on_behalf = 0, note = NULL, reset_reason = ?, updated_at = datetime('now')
        WHERE run_id = ? AND program_id = ?`, args: [reason, runId, pid] });
      reset.push(pid);
    } else {
      // Already waiting to re-review: keep the latest change as the reason.
      stmts.push({ sql: "UPDATE draft_reviews SET reset_reason = ?, updated_at = datetime('now') WHERE run_id = ? AND program_id = ? AND reset_reason IS NOT NULL", args: [reason, runId, pid] });
    }
  }
  if (stmts.length) await db.batch(stmts, 'write');
  if (reset.length) {
    await notifyUsers(`role = 'program_director' AND program_id IN (${reset.map(() => '?').join(',')})`, reset,
      'The draft schedule changed: please review again',
      `The league changed a game involving your program in the draft schedule:\n${reason}\nPlease review your games again and sign off under Draft review.`);
  }
}

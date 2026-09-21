import { Router } from 'express';
import { one, all } from '../db/client.js';
import { config } from '../config.js';
import { requireAuth, requirePasswordCurrent, isSuperAdmin } from '../middleware/auth.js';
import { ah } from '../utils/http.js';
import { GAME_SELECT, shapeGame } from '../scheduling/data.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent);

// One call powers the home screen for every role. Directors only ever see
// numbers for their own program.
router.get('/', ah(async (req, res) => {
  const u = req.user;
  const season = await one('SELECT * FROM seasons WHERE is_active = 1');
  const programId = isSuperAdmin(u) ? null : u.programId;
  const scoped = (col) => (programId ? `AND ${col} = ?` : '');
  const args = programId ? [programId] : [];
  const today = new Date().toISOString().slice(0, 10);

  const counts = await one(`SELECT
      (SELECT COUNT(*) FROM programs WHERE is_active = 1 ${programId ? 'AND id = ?' : ''}) AS programs,
      (SELECT COUNT(*) FROM venues WHERE is_active = 1 ${scoped('program_id')}) AS venues,
      (SELECT COUNT(*) FROM teams WHERE is_active = 1 ${scoped('program_id')}) AS teams,
      (SELECT COUNT(*) FROM divisions WHERE is_active = 1) AS divisions,
      (SELECT COUNT(*) FROM users WHERE is_active = 1 ${scoped('program_id')}) AS users`,
    [...args, ...args, ...args, ...args]);

  let slotsByCategory = [];
  let upcomingBlackouts = [];
  if (season && (isSuperAdmin(u) || u.role === 'program_director')) {
    slotsByCategory = await all(`SELECT category, COUNT(*) AS n,
        SUM((julianday('2000-01-01 ' || end_time) - julianday('2000-01-01 ' || start_time)) * 24) AS hours
      FROM gym_slots WHERE season_id = ? ${scoped('program_id')} GROUP BY category`, [season.id, ...args]);
    upcomingBlackouts = await all(`SELECT b.*, p.short_code, v.name AS venue_name FROM blackout_dates b
      JOIN programs p ON p.id = b.program_id LEFT JOIN venues v ON v.id = b.venue_id
      WHERE b.end_date >= ? ${scoped('b.program_id')} ORDER BY b.start_date LIMIT 5`, [today, ...args]);
  }

  // Programs still missing setup — the System Admin's onboarding view.
  let programReadiness = [];
  if (isSuperAdmin(u) && season) {
    programReadiness = await all(`SELECT p.id, p.name, p.short_code,
        (SELECT COUNT(*) FROM users x WHERE x.program_id = p.id AND x.role = 'program_director' AND x.is_active = 1) AS directors,
        (SELECT COUNT(*) FROM venues v WHERE v.program_id = p.id AND v.is_active = 1) AS venues,
        (SELECT COUNT(*) FROM teams t WHERE t.program_id = p.id AND t.is_active = 1) AS teams,
        (SELECT COUNT(*) FROM gym_slots g WHERE g.program_id = p.id AND g.season_id = ?) AS slots
      FROM programs p WHERE p.is_active = 1 ORDER BY p.name COLLATE NOCASE`, [season.id]);
  }

  // Phase 2: schedule status + the next few games that matter to this user.
  let schedule = null;
  if (season) {
    const pub = await one("SELECT id, published_at FROM schedule_runs WHERE season_id = ? AND status = 'published'", [season.id]);
    const draft = isSuperAdmin(u) ? await one("SELECT id, created_at FROM schedule_runs WHERE season_id = ? AND status = 'draft'", [season.id]) : null;
    schedule = { published: !!pub, publishedAt: pub?.publishedAt || null, hasDraft: !!draft, draftCreatedAt: draft?.createdAt || null, upcoming: [], gameCount: 0, openRequests: 0 };
    if (pub) {
      const mine = u.role === 'league_coach' ? ['(ht.head_coach_user_id = ? OR at.head_coach_user_id = ?)', [u.id, u.id]]
        : programId ? ['(ht.program_id = ? OR at.program_id = ?)', [programId, programId]] : ['1 = 1', []];
      schedule.upcoming = (await all(`${GAME_SELECT} WHERE g.run_id = ? AND g.status = 'scheduled' AND g.date >= ? AND ${mine[0]}
        ORDER BY g.date, g.start_time LIMIT 6`, [pub.id, today, ...mine[1]])).map(shapeGame);
      schedule.gameCount = Number((await one(`SELECT COUNT(*) AS n FROM games g JOIN teams ht ON ht.id = g.home_team_id JOIN teams at ON at.id = g.away_team_id
        WHERE g.run_id = ? AND g.status = 'scheduled' AND ${mine[0]}`, [pub.id, ...mine[1]])).n);
      if (isSuperAdmin(u) || programId) {
        schedule.openRequests = Number((await one(`SELECT COUNT(*) AS n FROM change_requests r WHERE r.status IN ('pending_director', 'pending_counterpart', 'pending_admin')
          ${programId ? 'AND (r.requesting_program_id = ? OR EXISTS (SELECT 1 FROM change_request_steps s WHERE s.request_id = r.id AND s.program_id = ?))' : ''}`,
        programId ? [programId, programId] : [])).n);
      }
    }
  }

  res.json({
    schedule,
    season: season ? { ...season, isActive: true } : null,
    counts,
    maxPrograms: config.maxPrograms,
    slotsByCategory,
    upcomingBlackouts,
    programReadiness,
  });
}));

export default router;

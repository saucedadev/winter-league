import { Router } from 'express';
import { one, all } from '../db/client.js';
import { config } from '../config.js';
import { requireAuth, requirePasswordCurrent, isSuperAdmin } from '../middleware/auth.js';
import { ah } from '../utils/http.js';
import { GAME_SELECT, shapeGame } from '../scheduling/data.js';
import { currentPublishedRun, syncSlots, leagueNow } from '../referees/data.js';

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
  const today = leagueNow().date; // league time zone, not UTC

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
      // Played games still waiting for a final score (for people who can enter them).
      if (['super_admin', 'program_director', 'league_coach'].includes(u.role)) {
        const now = leagueNow();
        const hhmm = `${String(Math.floor(now.minutes / 60)).padStart(2, '0')}:${String(now.minutes % 60).padStart(2, '0')}`;
        schedule.scoresNeeded = Number((await one(`SELECT COUNT(*) AS n FROM games g JOIN teams ht ON ht.id = g.home_team_id JOIN teams at ON at.id = g.away_team_id
          WHERE g.run_id = ? AND g.status = 'scheduled' AND (g.home_score IS NULL OR g.away_score IS NULL)
            AND (g.date < ? OR (g.date = ? AND g.start_time <= ?)) AND ${mine[0]}`, [pub.id, now.date, now.date, hhmm, ...mine[1]])).n);
      }
      if (isSuperAdmin(u) || programId) {
        schedule.openRequests = Number((await one(`SELECT COUNT(*) AS n FROM change_requests r WHERE r.status IN ('pending_director', 'pending_counterpart', 'pending_admin')
          ${programId ? 'AND (r.requesting_program_id = ? OR EXISTS (SELECT 1 FROM change_request_steps s WHERE s.request_id = r.id AND s.program_id = ?))' : ''}`,
        programId ? [programId, programId] : [])).n);
      }
    }
  }

  // Phase 3: referee coverage for the assignor (and System Admin).
  let referees = null;
  if (['super_admin', 'referee_assignor'].includes(u.role)) {
    const pubRun = await currentPublishedRun();
    const t = leagueNow().date;
    const soon = new Date(`${t}T00:00:00Z`); soon.setUTCDate(soon.getUTCDate() + 14);
    referees = { published: !!pubRun, roster: Number((await one("SELECT COUNT(*) AS n FROM users WHERE role = 'referee' AND is_active = 1")).n) };
    if (pubRun) {
      await syncSlots(pubRun.id);
      const c = await one(`SELECT
          SUM(g.date >= ?) AS slots,
          SUM(a.referee_id IS NULL AND g.date >= ?) AS open,
          SUM(a.referee_id IS NULL AND g.date BETWEEN ? AND ?) AS open_soon,
          SUM(a.referee_id IS NOT NULL AND a.status = 'assigned' AND g.date < ?) AS unconfirmed
        FROM referee_assignments a JOIN games g ON g.id = a.game_id
        WHERE g.run_id = ? AND g.status = 'scheduled'`,
      [t, t, t, soon.toISOString().slice(0, 10), t, pubRun.id]);
      Object.assign(referees, { slots: Number(c.slots || 0), open: Number(c.open || 0), openSoon: Number(c.openSoon || 0), unconfirmed: Number(c.unconfirmed || 0) });
    }
  }

  // Phase 3 rollout: a setup checklist for Program Directors.
  let setup = null;
  if (u.role === 'program_director' && programId) {
    setup = await one(`SELECT
        (SELECT COUNT(*) FROM venues WHERE program_id = ? AND is_active = 1) AS venues,
        (SELECT COUNT(*) FROM venues WHERE program_id = ? AND is_active = 1 AND (latitude IS NULL OR longitude IS NULL)) AS venues_missing_coords,
        (SELECT COUNT(*) FROM teams WHERE program_id = ? AND is_active = 1) AS teams,
        (SELECT COUNT(*) FROM teams WHERE program_id = ? AND is_active = 1 AND head_coach_user_id IS NULL) AS teams_without_coach,
        (SELECT COUNT(*) FROM gym_slots WHERE program_id = ? AND category IN ('WEEKNIGHT_GAME', 'WEEKEND_GAME_BLOCK') ${season ? 'AND season_id = ?' : ''}) AS game_slots,
        (SELECT COUNT(*) FROM blackout_dates WHERE program_id = ?) AS blackouts`,
    [programId, programId, programId, programId, programId, ...(season ? [season.id] : []), programId]);
  }

  res.json({
    schedule,
    referees,
    setup,
    season: season ? { ...season, isActive: true } : null,
    counts,
    maxPrograms: config.maxPrograms,
    slotsByCategory,
    upcomingBlackouts,
    programReadiness,
  });
}));

export default router;

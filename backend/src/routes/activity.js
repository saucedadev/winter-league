import { Router } from 'express';
import { all } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope, isSuperAdmin } from '../middleware/auth.js';
import { ah } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director'));

const CATEGORIES = ['program', 'season', 'division', 'venue', 'team', 'slot', 'blackout', 'user', 'schedule', 'request', 'referee'];

// ---- GET /api/activity?category=&before=&limit=&programId= ----
// A Program Director sees entries that involve their program (e.g. both
// programs in a change request). A System Admin sees everything, or one
// program's entries with ?programId=. User-account entries are System Admin only.
router.get('/', ah(async (req, res) => {
  const programId = readScope(req);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const where = [];
  const args = [];
  if (programId) {
    where.push('EXISTS (SELECT 1 FROM activity_log_programs ap WHERE ap.activity_id = a.id AND ap.program_id = ?)');
    args.push(programId);
  }
  if (!isSuperAdmin(req.user)) where.push("a.category != 'user'");
  if (CATEGORIES.includes(req.query.category)) { where.push('a.category = ?'); args.push(req.query.category); }
  if (req.query.before) { where.push('a.created_at < ?'); args.push(req.query.before); }
  const rows = await all(`SELECT a.id, a.category, a.action, a.actor_id, a.actor_name, a.actor_role, a.details, a.created_at,
      ap.short_code AS actor_program_code, ap.name AS actor_program_name
    FROM activity_log a LEFT JOIN programs ap ON ap.id = a.actor_program_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`, [...args, limit + 1]);
  const entries = rows.slice(0, limit);

  // The programs each entry involves, for the "Involves" line.
  const involved = new Map(entries.map((e) => [e.id, []]));
  if (entries.length) {
    const links = await all(`SELECT l.activity_id, p.id, p.name, p.short_code FROM activity_log_programs l JOIN programs p ON p.id = l.program_id
      WHERE l.activity_id IN (${entries.map(() => '?').join(',')}) ORDER BY p.name COLLATE NOCASE`, entries.map((e) => e.id));
    for (const l of links) involved.get(l.activityId).push({ id: l.id, name: l.name, shortCode: l.shortCode });
  }
  res.json({ entries: entries.map((e) => ({ ...e, programs: involved.get(e.id) })), hasMore: rows.length > limit, categories: CATEGORIES });
}));

export default router;

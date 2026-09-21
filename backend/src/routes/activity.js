import { Router } from 'express';
import { all } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole, readScope } from '../middleware/auth.js';
import { ah } from '../utils/http.js';

const router = Router();
router.use(requireAuth, requirePasswordCurrent, requireRole('super_admin', 'program_director'));

const CATEGORIES = ['program', 'season', 'division', 'venue', 'team', 'slot', 'blackout', 'user', 'schedule', 'request', 'referee'];

// ---- GET /api/activity?category=&before=&limit= ----
// Directors see only their own program's entries; user-account entries
// are System Admin only.
router.get('/', ah(async (req, res) => {
  const programId = readScope(req);
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const where = [];
  const args = [];
  if (programId) { where.push("a.program_id = ? AND a.category != 'user'"); args.push(programId); }
  if (CATEGORIES.includes(req.query.category)) { where.push('a.category = ?'); args.push(req.query.category); }
  if (req.query.before) { where.push('a.created_at < ?'); args.push(req.query.before); }
  const rows = await all(`SELECT a.*, p.short_code FROM activity_log a LEFT JOIN programs p ON p.id = a.program_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.created_at DESC, a.rowid DESC LIMIT ?`, [...args, limit + 1]);
  res.json({ entries: rows.slice(0, limit), hasMore: rows.length > limit, categories: CATEGORIES });
}));

export default router;

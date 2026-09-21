import { Router } from 'express';
import { one, run } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest } from '../utils/http.js';

const router = Router();
// Same four themes as Gym Hive so the two apps look like siblings.
const VALID_THEMES = ['light', 'dark', 'regalOpulence', 'midnightNoir'];

// Public: the login page renders in the sitewide theme before sign-in.
router.get('/theme', ah(async (req, res) => {
  const row = await one("SELECT value FROM app_settings WHERE key = 'theme'");
  res.json({ theme: row?.value || 'light' });
}));

router.put('/theme', requireAuth, requirePasswordCurrent, requireRole('super_admin'), ah(async (req, res) => {
  if (!VALID_THEMES.includes(req.body.theme)) throw badRequest(`Theme must be one of: ${VALID_THEMES.join(', ')}.`);
  await run("INSERT INTO app_settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [req.body.theme]);
  res.json({ theme: req.body.theme });
}));

export default router;

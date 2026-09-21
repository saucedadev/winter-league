import { Router } from 'express';
import { one, run } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest } from '../utils/http.js';
import { getBranding, validateBranding, DEFAULT_BRANDING } from '../utils/branding.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
// Gym Hive's four themes (so the two apps look like siblings), plus the
// league's own Pacific Youth Conference theme.
const VALID_THEMES = ['light', 'dark', 'regalOpulence', 'pacificYouthConference', 'midnightNoir'];

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

// ---- Branding (app name + logo) ----
// Public, like the theme: the sign-in page shows the conference's name and logo.
router.get('/branding', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ branding: await getBranding(), defaults: DEFAULT_BRANDING });
}));

router.put('/branding', requireAuth, requirePasswordCurrent, requireRole('super_admin'), ah(async (req, res) => {
  let branding;
  try { branding = validateBranding(req.body || {}); } catch (e) { throw badRequest(e.message); }
  const before = await getBranding();
  await run("INSERT INTO app_settings (key, value) VALUES ('branding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(branding)]);
  const changes = [];
  if (before.appName !== branding.appName) changes.push(`name “${before.appName}” → “${branding.appName}”`);
  if (!!before.logo !== !!branding.logo || (before.logo && before.logo !== branding.logo)) changes.push(branding.logo ? 'uploaded a new logo' : 'went back to the built-in logo');
  if (changes.length) await logActivity({ category: 'program', action: 'branding', actor: req.user, details: `Branding: ${changes.join('; ')}` });
  res.json({ branding });
}));

export default router;

import { Router } from 'express';
import { config } from '../config.js';
import { one, run } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest } from '../utils/http.js';
import { getBranding, validateBranding, publicBranding, DEFAULT_BRANDING } from '../utils/branding.js';
import { buildEmail, sendEmail, clearEmailBrandCache } from '../utils/email.js';
import { inlineImages } from '../utils/emailTemplate.js';
import { makeEmailLogo, cachedEmailLogo } from '../utils/emailLogo.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
// Gym Hive's four themes (so the two apps look like siblings), plus the
// league's own Pacific Energy and Midnight Pacific themes.
const VALID_THEMES = ['light', 'dark', 'regalOpulence', 'pacificEnergy', 'midnightPacific', 'midnightNoir'];

// Public: the login page renders in the sitewide theme before sign-in.
router.get('/theme', ah(async (req, res) => {
  const row = await one("SELECT value FROM app_settings WHERE key = 'theme'");
  res.json({ theme: row?.value || 'light' });
}));

router.put('/theme', requireAuth, requirePasswordCurrent, requireRole('super_admin'), ah(async (req, res) => {
  if (!VALID_THEMES.includes(req.body.theme)) throw badRequest(`Theme must be one of: ${VALID_THEMES.join(', ')}.`);
  await run("INSERT INTO app_settings (key, value) VALUES ('theme', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [req.body.theme]);
  clearEmailBrandCache(); // emails use the theme's colors
  res.json({ theme: req.body.theme });
}));

// ---- Branding (app name + logo) ----
// Public, like the theme: the sign-in page shows the conference's name and logo.
router.get('/branding', ah(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  // timezone: the league's clock, so every browser shows "today" and times the same way.
  res.json({ branding: publicBranding(await getBranding()), defaults: publicBranding(DEFAULT_BRANDING), timezone: config.leagueTimezone });
}));

router.put('/branding', requireAuth, requirePasswordCurrent, requireRole('super_admin'), ah(async (req, res) => {
  let branding;
  try { branding = validateBranding(req.body || {}); } catch (e) { throw badRequest(e.message); }
  const before = await getBranding();
  // The PNG copy for emails (reused if the logo didn't change).
  branding.emailLogo = !branding.logo ? null : branding.logo === before.logo && before.emailLogo ? before.emailLogo : await makeEmailLogo(branding.logo);
  await run("INSERT INTO app_settings (key, value) VALUES ('branding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(branding)]);
  const changes = [];
  if (before.appName !== branding.appName) changes.push(`name “${before.appName}” → “${branding.appName}”`);
  if (!!before.logo !== !!branding.logo || (before.logo && before.logo !== branding.logo)) changes.push(branding.logo ? 'uploaded a new logo' : 'went back to the built-in logo');
  if (changes.length) await logActivity({ category: 'program', action: 'branding', actor: req.user, details: `Branding: ${changes.join('; ')}` });
  clearEmailBrandCache();
  res.json({ branding: publicBranding(branding) });
}));

// ---- Emails: preview and test ----
// A sample email, so the System Admin can see how emails look with the
// branding and theme (and, for the test, check that sending works).
const SAMPLE_TEXT = (firstName) => `Hi ${firstName},

This is a sample of the emails the app sends. A schedule change, for example, looks like this:
7th Grade Boys · Northside Hawks vs Eastview Comets
Was: Sat Jan 10 · 9:00 AM · Lincoln Middle School, Court 1
Now: Sun Jan 11 · 1:30 PM · Ridgeway Community Center, Court 2

The name, logo, and colors come from Branding & Theme.`;
const SAMPLE_ACTION = { label: 'Open {app}', url: '/' };

// POST /api/settings/email-preview { appName, logo }  (unsaved form values; the theme is the current one)
router.post('/email-preview', requireAuth, requirePasswordCurrent, requireRole('super_admin'), ah(async (req, res) => {
  let b;
  try { b = validateBranding({ appName: req.body?.appName || DEFAULT_BRANDING.appName, logo: req.body?.logo }); } catch (e) { throw badRequest(e.message); }
  b.emailLogo = await cachedEmailLogo(b.logo);
  const themeRow = await one("SELECT value FROM app_settings WHERE key = 'theme'");
  const mail = await buildEmail({ text: SAMPLE_TEXT(req.user.firstName), action: SAMPLE_ACTION, brand: { ...b, themeId: themeRow?.value || 'light' } });
  res.json({ html: inlineImages(mail.html, mail.attachments) });
}));

// POST /api/settings/email-test: send the sample to the signed-in admin.
router.post('/email-test', requireAuth, requirePasswordCurrent, requireRole('super_admin'), ah(async (req, res) => {
  const me = await one('SELECT email, first_name FROM users WHERE id = ?', [req.user.id]);
  if (!me?.email) throw badRequest('Your account has no email address. Add one to your account under Users first.');
  clearEmailBrandCache();
  const { appName } = await getBranding();
  try {
    await sendEmail({ to: me.email, subject: `Test email from ${appName}`, text: SAMPLE_TEXT(me.firstName), action: SAMPLE_ACTION });
  } catch (err) {
    throw badRequest(`The email couldn’t be sent: ${err.message}. Check the email settings on the server (see EMAIL-SETUP.md).`);
  }
  await logActivity({ category: 'user', action: 'test email', actor: req.user, details: `Sent a test email to ${me.email}` });
  res.json({ sentTo: me.email, provider: config.email.provider === 'brevo' ? 'brevo' : 'console' });
}));

export default router;

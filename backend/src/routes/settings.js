import { Router } from 'express';
import { config } from '../config.js';
import { one, run } from '../db/client.js';
import { requireAuth, requirePasswordCurrent, requireRole } from '../middleware/auth.js';
import { ah, badRequest } from '../utils/http.js';
import { getBranding, validateBranding, publicBranding, DEFAULT_BRANDING } from '../utils/branding.js';
import { buildEmail, sendEmail, clearEmailBrandCache } from '../utils/email.js';
import { makeEmailLogo, cachedEmailLogo, EMAIL_LOGO_VERSION } from '../utils/emailLogo.js';
import { publishEmailLogo, isCurrentLogoUrl, logoHosting, logoHash, resetBlobBackoff, blobStatus, urlKind, checkImage } from '../utils/emailLogoHost.js';
import { emailImages } from '../utils/emailTemplate.js';
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
  // (A stored copy is reused only if it was made the current way.)
  const reuse = branding.logo === before.logo && before.emailLogo && before.emailLogoVersion === EMAIL_LOGO_VERSION;
  branding.emailLogo = !branding.logo ? null : reuse ? before.emailLogo : await makeEmailLogo(branding.logo);
  branding.emailLogoVersion = branding.emailLogo ? EMAIL_LOGO_VERSION : null;
  // ...and its public web address, which emails load it from.
  branding.emailLogoUrl = !branding.emailLogo ? null
    : isCurrentLogoUrl(before.emailLogoUrl, branding.emailLogo) ? before.emailLogoUrl : await publishEmailLogo(branding.emailLogo);
  await run("INSERT INTO app_settings (key, value) VALUES ('branding', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [JSON.stringify(branding)]);
  const changes = [];
  if (before.appName !== branding.appName) changes.push(`name “${before.appName}” → “${branding.appName}”`);
  if (!!before.logo !== !!branding.logo || (before.logo && before.logo !== branding.logo)) changes.push(branding.logo ? 'uploaded a new logo' : 'went back to the built-in logo');
  if (changes.length) await logActivity({ category: 'program', action: 'branding', actor: req.user, details: `Branding: ${changes.join('; ')}` });
  clearEmailBrandCache();
  res.json({ branding: publicBranding(branding) });
}));

// ---- The logo for emails, when the API serves it (no Vercel Blob) ----
// Public, like the logo itself: email apps load it without signing in. The
// hash in the name changes with the logo, so it can be cached for a year.
router.get('/email-logo/:file', ah(async (req, res) => {
  const { emailLogo } = await getBranding();
  const m = /^([0-9a-f]{16})\.png$/.exec(req.params.file);
  if (!emailLogo || !m || m[1] !== logoHash(emailLogo)) return res.status(404).end();
  res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=31536000, immutable', 'Cross-Origin-Resource-Policy': 'cross-origin' });
  res.send(Buffer.from(emailLogo.split(',')[1], 'base64'));
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
  const mail = await buildEmail({ text: SAMPLE_TEXT(req.user.firstName), action: SAMPLE_ACTION, brand: { ...b, themeId: themeRow?.value || 'light' }, inline: true });
  res.json({ html: mail.html });
}));

// POST /api/settings/email-test: send the sample to the signed-in admin.
router.post('/email-test', requireAuth, requirePasswordCurrent, requireRole('super_admin'), ah(async (req, res) => {
  const me = await one('SELECT email, first_name FROM users WHERE id = ?', [req.user.id]);
  if (!me?.email) throw badRequest('Your account has no email address. Add one to your account under Users first.');
  clearEmailBrandCache();
  resetBlobBackoff(); // try Vercel Blob again now, in case its settings were just fixed
  const { appName } = await getBranding();
  try {
    await sendEmail({ to: me.email, subject: `Test email from ${appName}`, text: SAMPLE_TEXT(me.firstName), action: SAMPLE_ACTION });
  } catch (err) {
    const msg = String(err.message || err);
    const hint = /timeout|ETIMEDOUT|ECONNREFUSED|ENETUNREACH/i.test(msg)
      ? (config.email.brevoPort === 2525
        ? 'The server couldn’t reach Brevo on port 2525. Check the Render log; if the host blocks that port too, try BREVO_SMTP_PORT=587 (works on Render’s paid plans).'
        : `The server couldn’t reach Brevo on port ${config.email.brevoPort}. Render’s free plan blocks it: remove BREVO_SMTP_PORT (the app then uses 2525).`)
      : /auth|535|login/i.test(msg)
        ? 'Brevo rejected the sign-in: check BREVO_SMTP_USER (the SMTP login) and BREVO_SMTP_PASS (the SMTP key).'
        : /sender|from/i.test(msg)
          ? 'Brevo rejected the sender: the address in EMAIL_FROM must be a verified sender in Brevo.'
          : 'Check the email settings on the server (see EMAIL-SETUP.md).';
    console.error('test email failed:', msg);
    throw badRequest(`The email couldn’t be sent (${msg}). ${hint}`);
  }
  await logActivity({ category: 'user', action: 'test email', actor: req.user, details: `Sent a test email to ${me.email}` });
  // Where the logo in that email loads from, and whether it actually loads
  // from the internet, so problems can be fixed without reading server logs.
  const b = await getBranding();
  const themeRow = await one("SELECT value FROM app_settings WHERE key = 'theme'");
  const img = emailImages(b, themeRow?.value || 'light', { assetBase: (config.appUrls[0] || '').replace(/\/$/, '') }).header;
  const logo = {
    kind: !b.logo ? 'built-in' : !b.emailLogoUrl || img.url !== b.emailLogoUrl ? 'none' : urlKind(b.emailLogoUrl),
    url: img.url,
    blobConfigured: logoHosting() === 'vercel-blob',
    blobError: logoHosting() === 'vercel-blob' ? blobStatus()?.message || null : null,
    ...(await checkImage(img.url)),
  };
  res.json({ sentTo: me.email, provider: config.email.provider === 'brevo' ? 'brevo' : 'console', logo });
}));

export default router;

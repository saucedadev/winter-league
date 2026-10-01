import nodemailer from 'nodemailer';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { one, run } from '../db/client.js';
import { getBranding } from './branding.js';
import { makeEmailLogo } from './emailLogo.js';
import { publishEmailLogo, isCurrentLogoUrl } from './emailLogoHost.js';
import { renderEmail, contactFor } from './emailTemplate.js';

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: config.email.brevoPort,
      requireTLS: true, // upgrade to an encrypted connection before signing in, or don't send
      auth: { user: config.email.brevoUser, pass: config.email.brevoPass },
      // Fail in seconds, not minutes, when the connection is blocked.
      connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
    });
  }
  return transport;
}

// The address part of EMAIL_FROM. The name shown in inboxes is the app name
// from Branding, so renaming the app renames the sender too.
export function fromAddress(from = config.email.from) {
  const m = /<([^>]+)>/.exec(from);
  return (m ? m[1] : from).trim();
}

// Branding + theme are read once per few seconds, not once per recipient.
let brandCache = null;
export function clearEmailBrandCache() { brandCache = null; }
async function emailBrand() {
  if (brandCache && Date.now() - brandCache.at < 10_000) return brandCache;
  const [branding, themeRow] = await Promise.all([getBranding(), one("SELECT value FROM app_settings WHERE key = 'theme'")]);
  // A logo saved earlier may have no email copy yet, or no web address for it
  // (or one from before Vercel Blob was set up): make and publish it once.
  if (branding.logo) {
    let changed = false;
    if (!branding.emailLogo) { branding.emailLogo = await makeEmailLogo(branding.logo); changed = !!branding.emailLogo; }
    if (branding.emailLogo && !isCurrentLogoUrl(branding.emailLogoUrl, branding.emailLogo)) {
      const url = await publishEmailLogo(branding.emailLogo);
      if (url && url !== branding.emailLogoUrl) { branding.emailLogoUrl = url; changed = true; }
    }
    if (changed) await run("UPDATE app_settings SET value = ? WHERE key = 'branding'", [JSON.stringify(branding)]).catch(() => {});
  }
  brandCache = { at: Date.now(), branding, themeId: themeRow?.value || 'light' };
  return brandCache;
}

/**
 * Build an email in the app's design without sending it.
 *   text     plain-text message, greeting included (see emailTemplate.js for the layout rules)
 *   action   optional { label, url } button; a url starting with "/" is made absolute
 *   role     the recipient's role, to pick who they should contact instead of replying
 *   contact  overrides that sentence
 *   brand    optional { appName, logo, emailLogo, themeId } (Branding page preview)
 *   inline   true: images as data: URLs, for viewing in a browser (previews)
 */
export async function buildEmail({ text, action = null, role = null, contact = null, brand = null, inline = false }) {
  const b = brand ? { branding: brand, themeId: brand.themeId } : await emailBrand();
  const appUrl = config.appUrls[0] || '';
  const act = action ? { label: action.label.replace('{app}', b.branding.appName), url: action.url.startsWith('/') ? `${appUrl}${action.url}` : action.url } : null;
  return {
    appName: b.branding.appName,
    ...renderEmail({ appName: b.branding.appName, themeId: b.themeId, branding: b.branding, appUrl, text, action: act, contact: contact || contactFor(role), inline }),
  };
}

// EMAIL_PROVIDER=console (default) prints the message to the server log,
// so every email flow can be tested locally without a Brevo account. Set
// EMAIL_PREVIEW_DIR as well to save each email as an .html file you can open.
export async function sendEmail({ to, subject, text, action, role, contact }) {
  const mail = await buildEmail({ text, action, role, contact });
  if (config.email.provider !== 'brevo') {
    console.log(`\n📧 [email:console] To: ${to}\n   Subject: ${subject}\n   ${mail.text.replace(/\n/g, '\n   ')}\n`);
    if (process.env.EMAIL_PREVIEW_DIR) {
      try {
        mkdirSync(process.env.EMAIL_PREVIEW_DIR, { recursive: true });
        const file = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(to).replace(/[^a-z0-9@.]/gi, '_')}.html`;
        const preview = await buildEmail({ text, action, role, contact, inline: true });
        writeFileSync(path.join(process.env.EMAIL_PREVIEW_DIR, file), preview.html.replace('<title>', `<title>${subject.replace(/</g, '&lt;')} · `));
      } catch (err) { console.error('email preview failed:', err.message); }
    }
    return;
  }
  await getTransport().sendMail({
    from: { name: mail.appName, address: fromAddress() },
    to, subject, text: mail.text, html: mail.html,
  });
}

import nodemailer from 'nodemailer';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { one, run } from '../db/client.js';
import { getBranding } from './branding.js';
import { makeEmailLogo } from './emailLogo.js';
import { renderEmail, contactFor, inlineImages } from './emailTemplate.js';

let transport = null;
function getTransport() {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com',
      port: 587,
      auth: { user: config.email.brevoUser, pass: config.email.brevoPass },
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
  // A logo saved before emails were branded has no email copy yet: make it once.
  if (branding.logo && !branding.emailLogo) {
    branding.emailLogo = await makeEmailLogo(branding.logo);
    if (branding.emailLogo) {
      await run("UPDATE app_settings SET value = ? WHERE key = 'branding'", [JSON.stringify(branding)]).catch(() => {});
    }
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
 */
export async function buildEmail({ text, action = null, role = null, contact = null, brand = null }) {
  const b = brand ? { branding: brand, themeId: brand.themeId } : await emailBrand();
  const appUrl = config.appUrls[0] || '';
  const act = action ? { label: action.label.replace('{app}', b.branding.appName), url: action.url.startsWith('/') ? `${appUrl}${action.url}` : action.url } : null;
  return {
    appName: b.branding.appName,
    ...renderEmail({ appName: b.branding.appName, themeId: b.themeId, branding: b.branding, appUrl, text, action: act, contact: contact || contactFor(role) }),
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
        writeFileSync(path.join(process.env.EMAIL_PREVIEW_DIR, file), inlineImages(mail.html, mail.attachments).replace('<title>', `<title>${subject.replace(/</g, '&lt;')} · `));
      } catch (err) { console.error('email preview failed:', err.message); }
    }
    return;
  }
  await getTransport().sendMail({
    from: { name: mail.appName, address: fromAddress() },
    to, subject, text: mail.text, html: mail.html, attachments: mail.attachments,
  });
}

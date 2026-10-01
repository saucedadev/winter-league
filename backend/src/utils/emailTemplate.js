// The look of every email the app sends: a band across the top with the app
// name and logo (from Branding), the message, an optional button, and a footer
// saying the inbox isn't monitored and who to contact instead.
//
// Colors follow the sitewide theme (Branding & Theme). Images go out as inline
// attachments (cid:), because Gmail and Outlook block images embedded as data:
// URLs and don't show SVG at all:
//   - an uploaded logo: the PNG copy made when it was saved (branding.emailLogo),
//     or the logo itself if it's already a PNG;
//   - otherwise the built-in hexagon mark, pre-rendered per theme in assets/email.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ASSETS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../assets/email');

// Accent + text-on-accent per theme. Mirrors frontend/src/theme/palette.js; keep the two in step.
export const EMAIL_THEMES = {
  light: { accent: '#2F6A87', accentContrast: '#FFFFFF' },
  dark: { accent: '#2F6A87', accentContrast: '#FFFFFF' },
  regalOpulence: { accent: '#D4AF37', accentContrast: '#0F5257' },
  pacificEnergy: { accent: '#007A7A', accentContrast: '#FFFFFF' },
  midnightPacific: { accent: '#64FFDA', accentContrast: '#0A192F' },
  midnightNoir: { accent: '#B22222', accentContrast: '#F5F5F7' },
};

// ---- color helpers ----
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

// Link text sits on white, so a pale accent (gold, electric teal) uses the
// theme's dark contrast color instead.
export function themeColors(themeId) {
  const t = EMAIL_THEMES[themeId] || EMAIL_THEMES.light;
  const link = contrast(t.accent, '#FFFFFF') >= 4.5 ? t.accent : t.accentContrast;
  return { ...t, link, id: EMAIL_THEMES[themeId] ? themeId : 'light' };
}

// ---- PNG size (from the IHDR chunk) ----
export function pngSize(buf) {
  if (!buf || buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}
const dataUrlBuffer = (u) => { const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(u || ''); return m ? Buffer.from(m[1], 'base64') : null; };

// The images for this branding + theme: { header, footer } each { cid, content, width, height, onTile }.
const markCache = new Map();
function builtInMark(kind, themeId) {
  const key = `${kind}-${themeId}`;
  if (!markCache.has(key)) markCache.set(key, readFileSync(path.join(ASSETS, `mark-${kind}-${themeId}.png`)));
  return markCache.get(key);
}
export function emailImages(branding, themeId) {
  const logo = dataUrlBuffer(branding.emailLogo) || dataUrlBuffer(branding.logo); // a PNG logo works as is
  if (branding.logo && logo) {
    const size = pngSize(logo) || { width: 1, height: 1 };
    const ratio = size.width / size.height;
    // h px tall, at most 4× as wide; a wider logo gets shorter instead of squashed.
    const fit = (h) => (ratio > 4 ? { width: h * 4, height: Math.max(1, Math.round((h * 4) / ratio)) } : { height: h, width: Math.max(1, Math.round(ratio * h)) });
    return {
      header: { cid: 'brand-logo@email', content: logo, ...fit(30), onTile: true },
      footer: { cid: 'brand-logo@email', content: logo, ...fit(26) },
    };
  }
  return {
    header: { cid: 'brand-mark-header@email', content: builtInMark('header', themeId), width: 30, height: 30 },
    footer: { cid: 'brand-mark-footer@email', content: builtInMark('footer', themeId), width: 24, height: 24 },
  };
}

// ---- text to HTML ----
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Escape a line, link any URLs, and bold a leading "Label: ".
function line(s, link) {
  let h = esc(s).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)]/g, (u) => `<a href="${u}" style="color:${link};">${u}</a>`);
  h = h.replace(/^([A-Z][A-Za-z ]{1,18}):(\s)/, '<strong>$1:</strong>$2');
  return h;
}

// Plain-text body rules (the text version is sent as well):
//   - a blank line starts a new paragraph;
//   - a paragraph whose first line ends with ":" shows its other lines as a
//     details box (the game, the new username, ...).
export function bodyHtml(text, c) {
  const P = 'margin:0 0 14px;';
  return String(text).trim().split(/\n\s*\n/).map((para) => {
    const lines = para.split('\n').map((l) => l.replace(/\s+$/, '')).filter((l) => l.trim());
    if (lines.length > 1 && lines[0].endsWith(':')) {
      return `<p style="${P}">${line(lines[0], c.link)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;"><tr>
<td style="background:#F3F6F9;border-left:4px solid ${c.accent};border-radius:4px;padding:12px 16px;font-size:15px;line-height:1.55;color:#1F2D3A;">${lines.slice(1).map((l) => line(l.trim(), c.link)).join('<br>')}</td></tr></table>`;
    }
    return `<p style="${P}">${lines.map((l) => line(l.trim(), c.link)).join('<br>')}</p>`;
  }).join('\n');
}

// Who to contact instead of replying, by the recipient's role.
export function contactFor(role) {
  switch (role) {
    case 'league_coach': return 'For questions or game-day changes, contact your program director.';
    case 'referee': return 'For questions about your games, contact your referee assignor.';
    case 'program_director':
    case 'referee_assignor': return 'For questions, contact the league administrator.';
    case 'super_admin': return 'Details are in the app’s Activity log.';
    default: return 'Need help? Contact your program director or the league administrator.';
  }
}

/**
 * Build both versions of an email.
 * @param {object} o
 *   appName, themeId, branding (for the logo), appUrl
 *   text     the message (greeting included)
 *   action   optional { label, url } shown as a button
 *   contact  the "who to contact" sentence in the footer
 * @returns {{ html, text, attachments }}
 */
export function renderEmail({ appName, themeId, branding = {}, appUrl = '', text, action = null, contact }) {
  const c = themeColors(themeId);
  const img = emailImages(branding, c.id);
  const name = esc(appName);
  const host = appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const notice = `This is an automated message from ${appName} and this inbox is not monitored — please don’t reply. ${contact}`;

  const headerImg = `<img src="cid:${img.header.cid}" width="${img.header.width}" height="${img.header.height}" alt="" style="display:block;border:0;">`;
  const headerLogo = img.header.onTile
    ? `<td style="padding-right:12px;" valign="middle"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#FFFFFF;border-radius:6px;padding:4px 6px;">${headerImg}</td></tr></table></td>`
    : `<td style="padding-right:10px;" valign="middle">${headerImg}</td>`;
  const button = action ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:4px 0 16px;"><tr>
<td style="background:${c.accent};border-radius:6px;"><a href="${esc(action.url)}" style="display:inline-block;padding:11px 20px;font-size:15px;font-weight:bold;color:${c.accentContrast};text-decoration:none;border-radius:6px;">${esc(action.label)}</a></td></tr></table>` : '';

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${name}</title></head>
<body style="margin:0;padding:0;background:#EEF1F4;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF1F4;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#FFFFFF;border:1px solid #DFE5EA;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">
<tr><td style="background:${c.accent};padding:16px 24px;">
<table role="presentation" cellpadding="0" cellspacing="0"><tr>${headerLogo}
<td valign="middle" style="font-size:20px;font-weight:bold;color:${c.accentContrast};letter-spacing:.2px;">${name}</td></tr></table>
</td></tr>
<tr><td style="padding:24px;font-size:15px;line-height:1.55;color:#1F2D3A;">
${bodyHtml(text, c)}
${button}
</td></tr>
<tr><td align="center" style="background:#F6F8FA;border-top:1px solid #E3E8ED;padding:18px 24px;font-size:12.5px;line-height:1.5;color:#5B7285;">
<img src="cid:${img.footer.cid}" width="${img.footer.width}" height="${img.footer.height}" alt="" style="display:block;border:0;margin:0 auto 8px;">
<p style="margin:0 0 6px;">${esc(notice)}</p>
<p style="margin:0;font-size:11px;color:#8A99A6;">${host ? `${esc(host)} · ` : ''}You’re receiving this because you have a ${name} account.</p>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  const plain = `${String(text).trim()}${action ? `\n\n${action.label}: ${action.url}` : ''}\n\n--\n${notice}`;
  const seen = new Set();
  const attachments = [img.header, img.footer].filter((i) => !seen.has(i.cid) && seen.add(i.cid))
    .map((i) => ({ filename: i.cid.startsWith('brand-logo') ? 'logo.png' : 'mark.png', content: i.content, cid: i.cid, contentType: 'image/png', contentDisposition: 'inline' }));
  return { html, text: plain, attachments };
}

// For the Branding page preview and console mode: the same HTML with the
// images inlined, so a browser can show it.
export function inlineImages(html, attachments) {
  return attachments.reduce((h, a) => h.split(`cid:${a.cid}`).join(`data:image/png;base64,${a.content.toString('base64')}`), html);
}

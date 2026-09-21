import { one } from '../db/client.js';

// Sitewide branding, stored per deployment (each conference runs its own
// deployment + database, so each sets its own name and logo).
//   appName: shown in the header, sign-in page, browser tab, and emails.
//   logo:    optional data: URL (PNG, JPEG, WebP, or SVG). null = built-in mark.
export const DEFAULT_BRANDING = Object.freeze({ appName: 'Winter League', logo: null });

export const LOGO_MAX_BYTES = 300 * 1024;
const LOGO_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/;

export async function getBranding() {
  const row = await one("SELECT value FROM app_settings WHERE key = 'branding'");
  try { return { ...DEFAULT_BRANDING, ...(row ? JSON.parse(row.value) : {}) }; } catch { return { ...DEFAULT_BRANDING }; }
}

// Returns a clean branding object or throws a plain-English message.
export function validateBranding(input = {}) {
  const appName = String(input.appName ?? '').trim().replace(/\s+/g, ' ');
  if (appName.length < 2 || appName.length > 60) throw new Error('The app name must be 2 to 60 characters.');
  let logo = null;
  if (input.logo) {
    const m = LOGO_RE.exec(String(input.logo));
    if (!m) throw new Error('The logo must be a PNG, JPEG, WebP, or SVG image.');
    const bytes = Math.floor((m[2].length * 3) / 4);
    if (bytes > LOGO_MAX_BYTES) throw new Error(`The logo must be under ${LOGO_MAX_BYTES / 1024} KB. Try exporting it smaller.`);
    logo = input.logo;
  }
  return { appName, logo };
}

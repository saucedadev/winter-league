import { createHash } from 'node:crypto';
import { put } from '@vercel/blob';

// Where emails load the uploaded logo from. Brevo doesn't deliver images
// attached inside an email, so the PNG copy of the logo needs a public web
// address:
//   1. Vercel Blob (recommended): set BLOB_READ_WRITE_TOKEN on the API. The
//      logo is uploaded once per change and served from Vercel's CDN, which is
//      always on.
//   2. Otherwise the API serves it (GET /api/settings/email-logo/<hash>.png) at
//      API_PUBLIC_URL, or RENDER_EXTERNAL_URL, which Render sets by itself. On
//      Render's free plan the API sleeps, so an email opened while it's asleep
//      may show the logo late or not at all.
//   3. Neither: emails use the built-in mark.

export const apiPublicBase = () => (process.env.API_PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
export const logoHosting = () => (process.env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : apiPublicBase() ? 'api' : 'none');

// The file name carries a hash of the image, so a new logo gets a new address
// and inboxes never show a cached old one.
export const logoHash = (pngDataUrl) => createHash('sha256').update(pngDataUrl).digest('hex').slice(0, 16);
const BLOB_HOST = /^https:\/\/[^/]+\.blob\.vercel-storage\.com\//;

// Is this saved address what the current settings would produce?
export function isCurrentLogoUrl(url, pngDataUrl) {
  if (!url || !pngDataUrl || !url.includes(logoHash(pngDataUrl))) return false;
  const mode = logoHosting();
  if (mode === 'vercel-blob') return BLOB_HOST.test(url);
  if (mode === 'api') return url.startsWith(`${apiPublicBase()}/`);
  return false;
}

// After a failed upload, wait before trying Vercel Blob again, so a bad token
// doesn't slow every email down.
let blobFailedAt = 0;
let lastBlobError = null; // { at, message } from the most recent failed upload
export const blobStatus = () => lastBlobError;
// The test email retries straight away, so a fixed token works without waiting.
export function resetBlobBackoff() { blobFailedAt = 0; }

// Where a logo address points: 'vercel-blob', 'api', or 'other'.
export const urlKind = (url) => (BLOB_HOST.test(url || '') ? 'vercel-blob' : apiPublicBase() && String(url).startsWith(`${apiPublicBase()}/`) ? 'api' : 'other');

// Can the outside world load this image? (What an email app's image proxy does.)
export async function checkImage(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    const type = r.headers.get('content-type') || '';
    return { ok: r.ok && type.startsWith('image/'), status: r.status, type };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

// Publish the PNG copy; returns its public address, or null.
export async function publishEmailLogo(pngDataUrl) {
  if (!pngDataUrl) return null;
  const hash = logoHash(pngDataUrl);
  if (process.env.BLOB_READ_WRITE_TOKEN && Date.now() - blobFailedAt > 10 * 60_000) {
    try {
      const abort = new AbortController();
      let timer;
      // Never hold up saving Branding for long (the library keeps retrying otherwise).
      const timeout = new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(new Error('timed out after 20 seconds')); }, 20_000); });
      try {
        const { url } = await Promise.race([
          put(`email/logo-${hash}.png`, Buffer.from(pngDataUrl.split(',')[1], 'base64'), {
            access: 'public', contentType: 'image/png', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 31_536_000, abortSignal: abort.signal,
          }),
          timeout,
        ]);
        lastBlobError = null;
        return url;
      } finally { clearTimeout(timer); }
    } catch (err) {
      blobFailedAt = Date.now();
      lastBlobError = { at: new Date().toISOString(), message: err.message };
      console.error('could not upload the email logo to Vercel Blob (check BLOB_READ_WRITE_TOKEN and that the store is Public):', err.message);
    }
  }
  const base = apiPublicBase();
  return base ? `${base}/api/settings/email-logo/${hash}.png` : null;
}

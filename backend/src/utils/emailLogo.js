import sharp from 'sharp';

// Emails can't show SVG or WebP reliably (and never images embedded as data:
// URLs), so the server keeps a small PNG copy of the uploaded logo to attach to
// emails. It's made here rather than in the browser: browsers with
// anti-fingerprinting protection (e.g. Firefox's) block reading back a canvas,
// which made the browser-made copy blank or hung the save.
//
// Returns a PNG data URL, or null if the logo can't be converted (emails then
// use the built-in mark).
const HEIGHTS = [120, 90, 60];     // shown 30 px tall; extra pixels keep it sharp
const MAX_BYTES = 150 * 1024;

export async function makeEmailLogo(logo) {
  const m = /^data:image\/(png|jpeg|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(logo || '');
  if (!m) return null;
  const isSvg = m[1] === 'svg+xml';
  const input = Buffer.from(m[2], 'base64');
  try {
    for (const height of HEIGHTS) {
      const png = await sharp(input, { density: isSvg ? 300 : undefined, limitInputPixels: 40_000_000 })
        // At most 4× as wide as tall; a wider logo gets shorter instead of squashed.
        .resize({ height, width: height * 4, fit: 'inside', withoutEnlargement: !isSvg })
        .png({ compressionLevel: 9 })
        .toBuffer();
      if (png.length <= MAX_BYTES) return `data:image/png;base64,${png.toString('base64')}`;
    }
  } catch (err) {
    console.error('could not make the email copy of the logo:', err.message);
  }
  return null;
}

// The Branding page preview asks on every edit; don't convert the same logo twice.
let last = { logo: null, png: null };
export async function cachedEmailLogo(logo) {
  if (!logo) return null;
  if (last.logo !== logo) last = { logo, png: await makeEmailLogo(logo) };
  return last.png;
}

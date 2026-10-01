// Emails can't show SVG (or images embedded as data: URLs), so when the logo is
// saved we also send a small PNG copy for the server to attach to emails.
// Returns a PNG data URL, or null if this browser couldn't draw the logo (the
// emails then use the logo itself if it's a PNG, or the built-in mark).
const TARGET_HEIGHTS = [120, 90, 60]; // shown 30 px tall in emails; extra pixels keep it sharp
const MAX_BYTES = 140 * 1024;          // the server allows 150 KB

// An SVG with only a viewBox has no size of its own, and some browsers then
// draw nothing. Give it one.
function sizedSvg(dataUrl) {
  try {
    const svg = atob(dataUrl.split(',')[1]);
    const open = /<svg\b[^>]*>/i.exec(svg)?.[0];
    if (!open || /\swidth\s*=/.test(open)) return dataUrl;
    const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(open);
    const [w, h] = vb ? [Number(vb[1]), Number(vb[2])] : [300, 150];
    const fixed = svg.replace(open, open.replace(/<svg\b/i, `<svg width="${(w / h) * 240}" height="240"`));
    return `data:image/svg+xml;base64,${btoa(fixed)}`;
  } catch { return dataUrl; }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function makeEmailLogo(logo) {
  if (!logo) return null;
  try {
    const img = await loadImage(logo.startsWith('data:image/svg') ? sizedSvg(logo) : logo);
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) return null;
    for (const target of TARGET_HEIGHTS) {
      // Never wider than 4× the height (a very wide logo gets shorter instead of squashed).
      let h = logo.startsWith('data:image/svg') ? target : Math.min(target, h0);
      if ((w0 / h0) * h > target * 4) h = Math.max(1, Math.round((target * 4 * h0) / w0));
      const w = Math.max(1, Math.round((w0 / h0) * h));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, w, h);
      const png = canvas.toDataURL('image/png');
      if (png.length * 0.75 <= MAX_BYTES) return png;
    }
  } catch { /* fall back to the server's choice */ }
  return null;
}

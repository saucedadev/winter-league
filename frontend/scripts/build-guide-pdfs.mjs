// Builds the downloadable PDF of every user guide into public/guides/.
//
//   npm run guides:pdf                              name printed in the guides: "Winter League"
//   npm run guides:pdf -- --name="Pacific Youth Conference"
//
// It builds the app, serves it locally, prints each guide's print-ready page
// (/help-print/<id>) with headless Chromium, then stops. Run it after editing
// any guide in src/help/ and commit the updated PDFs.
// One-time setup on a new machine: npx playwright install chromium
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const appName = arg('name') || 'Winter League';
const outDir = path.join(root, 'public', 'guides');

// The guide list comes from src/help/guides.js, so new guides are picked up automatically.
const registry = fs.readFileSync(path.join(root, 'src', 'help', 'guides.js'), 'utf8');
const guides = [...registry.matchAll(/\{ id: '([a-z-]+)', title: '([^']+)'/g)].map(([, id, title]) => ({ id, title }));
if (!guides.length) { console.error('❌ No guides found in src/help/guides.js'); process.exit(1); }

let chromium;
try { ({ chromium } = await import('playwright')); } catch {
  console.error('❌ Playwright is not installed. In frontend/, run: npm install, then npx playwright install chromium');
  process.exit(1);
}

console.log('🔨 Building the app…');
await build({ root, logLevel: 'warn' });
const server = await preview({ root, preview: { port: 4179, strictPort: true, open: false }, logLevel: 'warn' });
const base = server.resolvedUrls.local[0];

let browser;
try {
  browser = await chromium.launch();
} catch (e) {
  console.error(`❌ Couldn't start Chromium (${e.message.split('\n')[0]}).\n   Run once: npx playwright install chromium`);
  await server.close();
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
try {
  for (const g of guides) {
    const page = await browser.newPage();
    await page.goto(`${base}help-print/${g.id}?name=${encodeURIComponent(appName)}`, { waitUntil: 'load' });
    await page.waitForSelector('.guide h1');
    // Every screenshot must be loaded before printing.
    await page.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? null : new Promise((r) => { i.onload = r; i.onerror = r; })))));
    const broken = await page.evaluate(() => [...document.images].filter((i) => !i.naturalWidth).map((i) => i.getAttribute('src')));
    if (broken.length) throw new Error(`${g.id}: images failed to load: ${broken.join(', ')}`);
    const file = path.join(outDir, `${g.id}.pdf`);
    await page.pdf({
      path: file, format: 'Letter', printBackground: true,
      margin: { top: '0.6in', bottom: '0.75in', left: '0.65in', right: '0.65in' },
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font-family: system-ui, sans-serif; font-size: 8px; color: #666; width: 100%; padding: 0 0.65in; display: flex; justify-content: space-between;">
        <span>${esc(appName)} · ${esc(g.title)}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
    });
    await page.close();
    console.log(`✅ ${path.relative(root, file)}  (${Math.round(fs.statSync(file).size / 1024)} KB)`);
  }
} finally {
  await browser?.close();
  // Don't wait on idle keep-alive connections when shutting the local server down.
  server.httpServer.closeAllConnections?.();
  await new Promise((r) => server.httpServer.close(r));
}
console.log(`\nDone: ${guides.length} guides for "${appName}". Commit public/guides/ so the app's Download PDF buttons serve them.`);
process.exit(0);

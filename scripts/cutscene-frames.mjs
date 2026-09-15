// Capture the establishing frames the video cutscenes start and end on: one 1280×720 still per section at the
// rail's ESTABLISH key (journey.ts), UI hidden, reduced motion (no rig bob/parallax, no animated signs) so the
// clip's first/last frames match what nav.ts parks the canvas on.
// Usage: node scripts/cutscene-frames.mjs [url=http://[::1]:4321/] [outDir=design/night/cutscenes/frames] [ids…]
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'node:fs';

const [,, url = 'http://[::1]:4321/', outDir = 'design/night/cutscenes/frames', ...only] = process.argv;
const FALLBACK = { city: 0, education: 0.19, work: 0.275, projects: 0.74, contact: 0.96 };
const HIDE = '.nav,#hud,#hero-copy,.sheet,.contact,.skip,.css3d,.boot,#cine{display:none!important}';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`.slice(0, 300)); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 600)));

const open = async (p) => {
  await page.goto(`${url}?p=${p}&dpr=1&q=med&nocine&nolanding`, { waitUntil: 'load' });
  await page.waitForSelector('html.is-booted', { timeout: 180_000 });
  await page.waitForTimeout(2500);
};

// The table comes from the running app (nav.ts exposes journey.ts ESTABLISH); the plan's values are the fallback.
await open(0);
let table = await page.evaluate(() => (window.__nav && window.__nav.establish) || null);
if (!table) { table = FALLBACK; console.log('window.__nav.establish not exposed — using the plan\'s fallback table'); }
else console.log('ESTABLISH from window.__nav.establish:', JSON.stringify(table));
const ids = only.length ? only : Object.keys(table);

for (const id of ids) {
  const p = table[id];
  if (p === undefined) { console.log(`skip ${id}: not in the table`); continue; }
  if (id !== ids[0] || p !== 0) await open(p);
  // The blimp cruises a loop over downtown, so wherever it is live it will not be where a still froze it: keep it out of
  // the stills (its p-window keeps it out of the wide shots anyway; this makes sure).
  await page.evaluate(() => { const g = window.__content?.carriers?.['amd-dc']?.group; if (g) g.traverse((o) => { if (o !== g) o.visible = false; }); });
  await page.addStyleTag({ content: HIDE });
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => ({
    p: window.__nav?.p, mode: window.__mode, backend: document.documentElement.dataset.backend, tier: document.documentElement.dataset.tier,
    cam: window.__camera ? window.__camera.position.toArray().map((v) => +v.toFixed(2)) : null,
  }));
  const out = `${outDir}/${id}.png`;
  await page.screenshot({ path: out });
  console.log(`${out}  p=${p}  ${JSON.stringify(info)}`);
}
if (logs.length) console.log(logs.filter((l, i) => logs.indexOf(l) === i).slice(0, 20).join('\n'));
await browser.close();

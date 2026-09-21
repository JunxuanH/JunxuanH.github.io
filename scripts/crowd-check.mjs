// Walker separation probe: pedestrians must not walk through one another.
//
// characters.ts only slowed a walker behind another going the *same* way, and ignored stalled walkers
// entirely, so on a closed two-way loop (the campus plaza) walkers met head-on and passed through each other.
// This samples every crowd for a while and reports the closest two bodies ever got.
//   node scripts/crowd-check.mjs [url] [section=education]
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4399/';
const section = process.argv[3] || 'education';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
/** Two walkers closer than this are interpenetrating: the rigs are about 0.5 u across the shoulders. */
const FLOOR = 0.45;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?nolanding`);
await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'), null, { timeout: 180000 });
await page.waitForTimeout(5000);
await page.$eval(`.nav a[data-section="${section}"]`, (el) => el.click());
await page.waitForTimeout(4000);
const r = await page.evaluate(() => new Promise((resolve) => {
  let min = Infinity, worst = null, frames = 0, pairs = 0;
  const step = () => {
    for (const c of window.__crowds ?? []) {
      const ws = c.walkers.filter((w) => w.root.visible);
      for (let i = 0; i < ws.length; i++) for (let j = i + 1; j < ws.length; j++) {
        const a = ws[i].root.position, b = ws[j].root.position;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        pairs++;
        if (d < min) { min = d; worst = [+a.x.toFixed(1), +a.z.toFixed(1)]; }
      }
    }
    if (++frames < 1800) requestAnimationFrame(step); else resolve({ min: +min.toFixed(2), worst, pairs, frames });
  };
  requestAnimationFrame(step);
}));
await browser.close();
console.log(`${section}: closest approach ${r.min} u at ${r.worst} over ${r.frames} frames (${r.pairs} pair samples)`);
console.log(r.min < FLOOR ? `FAIL: walkers overlap (floor ${FLOOR})` : 'PASS: no walker overlap');
process.exit(r.min < FLOOR ? 1 : 0);

// Hitch probe: scrolls the journey end to end over N seconds and reports frame-time spikes.
//   node scripts/scrub.mjs [query] [seconds]   e.g. node scripts/scrub.mjs "q=med" 20
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const [,, q = 'q=med', secs = '20'] = process.argv;
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => { if (m.text().startsWith('[slow]')) console.log('  ', m.text()); });
await page.goto(`${process.env.URL || 'http://localhost:4321/'}?${q}&nolanding`); // no landing overlay (landing.ts)
await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'), null, { timeout: 60000 });
await page.waitForTimeout(Number(process.env.IDLE) || 1500);
const passes = Number(process.env.PASSES || 1);
for (let pass = 1; pass <= passes; pass++) {
const r = await page.evaluate((secs) => new Promise((res) => {
  const max = document.body.scrollHeight - innerHeight; const t0 = performance.now(); let last = t0; const d = []; const spikes = [];
  const f = (t) => {
    const k = Math.min(1, (t - t0) / (secs * 1000)); window.scrollTo(0, k * max);
    const dt = t - last; last = t; d.push(dt); if (dt > 50) spikes.push([k.toFixed(3), Math.round(dt)]);
    if (k < 1) requestAnimationFrame(f); else { d.sort((a, b) => a - b); res({ frames: d.length, median: d[d.length >> 1].toFixed(1), p95: d[Math.floor(d.length * 0.95)].toFixed(1), max: Math.round(d[d.length - 1]), over50: spikes.length, spikes: spikes.slice(0, 14) }); }
  };
  requestAnimationFrame(f);
}), Number(secs));
console.log(q, passes > 1 ? `pass ${pass}` : '', JSON.stringify(r));
if (pass < passes) { await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(1500); }
}
await browser.close();

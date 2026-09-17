// Frame-time probe for the Night City pages.
//   node scripts/night-fps.mjs [path] [query ...]
//   e.g. node scripts/night-fps.mjs /lab/characters "crowd=1&count=10"   (base URL from $URL, default http://localhost:4324)
//        URL=http://localhost:4325 node scripts/night-fps.mjs /lab/characters "crowd=1&count=10"
// Reads window.__perf (cpu ms per frame + renderer.info) when the page exposes it, else plain rAF deltas.
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const [path = '/lab/characters', ...queries] = process.argv.slice(2);
const qs = queries.length ? queries : ['q=high', 'q=med', 'q=low'];
const base = (process.env.URL || 'http://localhost:4324').replace(/\/$/, '');
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const q of qs) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const url = `${base}${path}${q ? `?${q}` : ''}`;
  await page.goto(url);
  await page.waitForTimeout(8000);
  const r = await page.evaluate(() => new Promise((res) => {
    const ts = [];
    const p = window.__perf; const cpu0 = p ? p.cpu : 0, fr0 = p ? p.frames : 0;
    const f = (t) => { ts.push(t); if (ts.length < 150) requestAnimationFrame(f); else {
      const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      const cpu = p && p.frames > fr0 ? ((p.cpu - cpu0) / (p.frames - fr0)).toFixed(1) : '?';
      const info = p?.renderer?.info?.render;
      res({ median: d[d.length >> 1].toFixed(1), p95: d[Math.floor(d.length * 0.95)].toFixed(1), cpu, draws: info?.drawCalls, tris: info?.triangles });
    } };
    requestAnimationFrame(f);
  }));
  console.log(url.padEnd(70), 'median', r.median, 'p95', r.p95, 'cpu', r.cpu, 'draws', r.draws ?? '-', 'tris', r.tris ?? '-');
  await page.close();
}
await browser.close();

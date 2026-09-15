// Frame-time probe: node scripts/fps.mjs [query ...]   e.g. node scripts/fps.mjs "q=high" "q=high&nocsm"
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const queries = process.argv.length > 2 ? process.argv.slice(2) : ['q=high', 'q=med', 'q=low'];
const base = process.env.URL || 'http://localhost:4321/';
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
for (const q of queries) {
  const [vw, vh] = (process.env.VIEW || '1600x900').split('x').map(Number);
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: Number(process.env.DPR) || 1 });
  await page.goto(`${base}?${q}&nolanding`); // the warp landing throttles the render to ~4 fps under its overlay
  await page.waitForTimeout(Number(process.env.WAIT) || 12000);
  const r = await page.evaluate(() => new Promise((res) => {
    const ts = [];
    const p = window.__perf; const cpu0 = p ? p.cpu : 0, fr0 = p ? p.frames : 0;
    const f = (t) => { ts.push(t); if (ts.length < 150) requestAnimationFrame(f); else {
      const d = ts.slice(1).map((t, i) => t - ts[i]).sort((a, b) => a - b);
      const cpu = p && p.frames > fr0 ? ((p.cpu - cpu0) / (p.frames - fr0)).toFixed(1) : '?';
      const info = p?.renderer?.info?.render;
      res({ median: d[d.length >> 1].toFixed(1), p95: d[Math.floor(d.length * 0.95)].toFixed(1), cpu, draws: info?.drawCalls, tris: info?.triangles, dpr: p?.dpr?.toFixed(2) });
    } };
    requestAnimationFrame(f);
  }));
  console.log(q.padEnd(40), 'median', r.median, 'p95', r.p95, 'cpu', r.cpu, 'draws', r.draws, 'tris', r.tris, 'dpr', r.dpr);
  await page.close();
}
await browser.close();

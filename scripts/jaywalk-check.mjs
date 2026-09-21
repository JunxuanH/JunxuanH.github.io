// Jaywalking probe: a pedestrian may only be in a roadway when the signals allow it.
//
// characters.ts asks crossing-logic.ts's `pedestrianMustWait` before stepping off a kerb, but nothing
// checked that the answer is obeyed once they are moving. This samples every visible walker against the
// live signal phase and reports anyone standing in traffic's path while that traffic has the green.
//   node scripts/jaywalk-check.mjs [url] [section]
import { createRequire } from 'node:module';
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
// The authoritative answer to "is this a carriageway" lives in streets.ts, and it excludes the market's
// pedestrian lane — which otherwise looks exactly like the cross street at z −228.
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const { build } = createRequire(astroRequire.resolve('vite'))('esbuild');
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
const streets = await build({ entryPoints: ['src/scene/night/streets.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { isRoad } = await import(`data:text/javascript;base64,${Buffer.from(streets.outputFiles[0].text).toString('base64')}`);
const base = process.argv[2] || 'http://127.0.0.1:4399/';
const section = process.argv[3] || 'work';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const AVENUE_HALF = 10, CROSS_HALF = 8, CROSS_Z = [-60, -144, -228];
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?nolanding`);
await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'), null, { timeout: 180000 });
await page.waitForTimeout(5000);
await page.$eval(`.nav a[data-section="${section}"]`, (el) => el.click());
await page.waitForTimeout(4000);
const samples = await page.evaluate(() => new Promise((resolve) => {
  const out = []; let frames = 0;
  const step = () => {
    const sig = window.__signals;
    if (sig) for (const c of window.__crowds ?? []) for (const w of c.walkers) {
      if (!w.root.visible || w.state !== 'walk') continue;
      const p = w.root.position;
      out.push({ x: +p.x.toFixed(2), z: +p.z.toFixed(2), avenue: sig.avenue, cross: sig.cross, walk: sig.walk, t: +sig.t.toFixed(1), speed: +w.speed.toFixed(2) });
    }
    if (++frames < 2400) requestAnimationFrame(step); else resolve(out);
  };
  requestAnimationFrame(step);
}));
await browser.close();
// A walker is exposed when they stand on a carriageway whose traffic is not stopped.
const bad = samples.filter((s) => {
  if (!isRoad(s.x, s.z)) return false;                        // pavement, plaza or the market's own lane
  const onAvenue = Math.abs(s.x) < AVENUE_HALF;
  const onCross = CROSS_Z.some((cz) => Math.abs(s.z - cz) < CROSS_HALF);
  if (onAvenue && s.avenue !== 'red') return true;
  if (onCross && !onAvenue && s.cross !== 'red') return true;
  return false;
});
const where = new Map();
for (const b of bad) { const k = `${Math.round(b.x)},${Math.round(b.z)}`; where.set(k, (where.get(k) ?? 0) + 1); }
console.log(`${section}: ${samples.length} walker-frames sampled, ${bad.length} of them in live traffic`);
for (const [k, n] of [...where.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`   at ${k}: ${n} frames`);
console.log(bad.length ? 'FAIL: pedestrians walk into moving traffic' : 'PASS: pedestrians stay out of live carriageways');
process.exit(bad.length ? 1 : 0);

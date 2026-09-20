// Traffic continuity probe: no car may teleport where anyone can see it.
//
// traffic.ts advances a car's progress with `t = (t + …) % 1`, so every lane has a seam where a car jumps
// from the end of its curve back to the start. Until the tunnel portal (bay.ts createTunnelPortal) the two
// avenue lanes seamed at z −24, in the open, in front of the seawall — cars popped in and out of existence.
// This asserts that every jump now happens inside the tunnel throat.
//   node scripts/tunnel-check.mjs [url]
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const base = process.argv[2] || 'http://127.0.0.1:4399/';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
/** The throat: inside here a jump is invisible from the street. */
const THROAT = { x: 10, z0: -33, z1: -22.4 }; // behind the blackout wall (bay.ts TUNNEL.blackout)
/** The dressed footprint. Beyond it the haze does the hiding: at 450 u the fog (density 0.0032, sky.ts)
 *  leaves a quarter of a car's contrast, and it is a few pixels tall. */
const FOOTPRINT = { x: 260, z0: -450, z1: 480 };
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?p=0&nolanding`);
await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'), null, { timeout: 180000 });
await page.waitForTimeout(4000);
const jumps = await page.evaluate(() => new Promise((resolve) => {
  const seen = new Map(), out = [];
  let frames = 0;
  const step = () => {
    for (const [i, c] of (window.__traffic?.cars ?? []).entries()) {
      const p = c.root.position, prev = seen.get(i);
      if (prev) {
        const d = Math.hypot(p.x - prev.x, p.y - prev.y, p.z - prev.z);
        // A wrap is a jump of hundreds of units; a fast hover car covers a few per frame on a slow frame.
        if (d > 20) out.push({ lane: c.lane, d: +d.toFixed(1), from: [+prev.x.toFixed(1), +prev.z.toFixed(1)], to: [+p.x.toFixed(1), +p.z.toFixed(1)] });
      }
      seen.set(i, { x: p.x, y: p.y, z: p.z });
    }
    if (++frames < 900) requestAnimationFrame(step); else resolve(out);
  };
  requestAnimationFrame(step);
}));
const inThroat = (p) => Math.abs(p[0]) <= THROAT.x && p[1] >= THROAT.z0 && p[1] <= THROAT.z1;
const onStage = (p) => Math.abs(p[0]) <= FOOTPRINT.x && p[1] >= FOOTPRINT.z0 && p[1] <= FOOTPRINT.z1;
// A wrap moves a car between the two ends of its lane. Each end has to be unobservable on its own — hidden
// inside the tunnel throat, or far enough out that the haze covers it.
const hidden = (p) => inThroat(p) || !onStage(p);
const visible = jumps.filter((j) => !hidden(j.from) || !hidden(j.to));
console.log(`${jumps.length} lane wraps sampled, ${visible.length} of them in the open`);
for (const v of visible.slice(0, 8)) console.log('  lane', v.lane, v.from, '→', v.to, `(${v.d} u)`);
await browser.close();
if (visible.length) { console.error('FAIL: cars still teleport where they can be seen'); process.exit(1); }
console.log('PASS: every lane wrap happens inside the tunnel throat');

// Crowd probe: pedestrians must move, and must not walk through one another.
//
// Both halves matter. Giving walkers their own side of the path once broke the gate that advances them along
// it -- the check compared their position to the centre-line while they stood 0.5 u to the side, so the
// distance never closed, `t` never advanced, and every NPC in the city played its walk clip on the spot. A
// separation-only probe passed that with flying colours: frozen walkers never collide.
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
  let min = Infinity, worst = null, frames = 0, pairs = 0, huddle = 0, huddleAt = null, last = performance.now();
  // Per walker: how far it meant to travel (speed integrated while walking) against how far it actually did.
  // A walker parked at a stall or held at a red signal accrues no intent, so neither counts as stuck.
  const want = new Map(), went = new Map(), prev = new Map();
  const step = (now) => {
    const dt = Math.min((now - last) / 1000, 0.05); last = now;
    for (const c of window.__crowds ?? []) {
      const ws = c.walkers.filter((w) => w.root.visible);
      for (const w of ws) {
        const p = w.root.position, was = prev.get(w);
        if (was) went.set(w, (went.get(w) ?? 0) + Math.hypot(p.x - was.x, p.z - was.z));
        prev.set(w, { x: p.x, z: p.z });
        if (w.state === 'walk') want.set(w, (want.get(w) ?? 0) + w.speed * dt);
      }
      // Closest pair, and the worst huddle: how many walkers crowd within HUDDLE of one of them. A pile-up
      // of four shows here even when no single pair is closer than the overlap floor.
      for (let i = 0; i < ws.length; i++) {
        let near = 0;
        for (let j = 0; j < ws.length; j++) {
          if (i === j) continue;
          const a = ws[i].root.position, b = ws[j].root.position;
          const d = Math.hypot(a.x - b.x, a.z - b.z);
          if (j > i) { pairs++; if (d < min) { min = d; worst = [+a.x.toFixed(1), +a.z.toFixed(1)]; } }
          if (d < 1.4) near++;
        }
        if (near > huddle) { huddle = near; huddleAt = [+ws[i].root.position.x.toFixed(1), +ws[i].root.position.z.toFixed(1)]; }
      }
    }
    if (++frames < 1800) requestAnimationFrame(step);
    else {
      const rows = [...want.entries()].filter(([, w]) => w > 3).map(([k, w]) => [k, w, went.get(k) ?? 0]);
      const stuck = rows.filter(([, w, g]) => g < w * 0.35);
      resolve({ min: +min.toFixed(2), worst, pairs, frames, tracked: rows.length, stuck: stuck.length, huddle, huddleAt,
        travel: +Math.max(0, ...rows.map(([, , g]) => g)).toFixed(1) });
    }
  };
  requestAnimationFrame(step);
}));
await browser.close();
console.log(`${section}: closest approach ${r.min} u at ${r.worst}, worst huddle ${r.huddle} within 1.4 u at ${r.huddleAt}, furthest travelled ${r.travel} u, ${r.stuck} of ${r.tracked} stuck`);
const bad = [r.min < FLOOR && `walkers overlap (floor ${FLOOR})`, r.stuck > 0 && `${r.stuck} walkers animate on the spot`,
  r.huddle >= 3 && `${r.huddle + 1} walkers piled within 1.4 u`].filter(Boolean);
console.log(bad.length ? `FAIL: ${bad.join('; ')}` : 'PASS: walkers move and keep apart');
process.exit(bad.length ? 1 : 0);

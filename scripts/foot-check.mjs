// Foot-plant probe: a walker's feet must sit on the surface under them, not in it.
//
// Crowd walkers take their height from the path they follow (paths.ts `y`), never from the ground, so any
// lateral drift — a lane offset, a push from a neighbour, a stall release — can leave one standing in a
// surface that is not at the path's height. This samples every visible NPC in the browser and compares its
// root against `groundY` from walkable.ts, evaluated here in node (the same trick world-collision-check uses).
//   node scripts/foot-check.mjs [url] [section]
import { createRequire } from 'node:module';
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const { build } = createRequire(astroRequire.resolve('vite'))('esbuild');
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
const bundled = await build({ entryPoints: ['src/scene/night/walkable.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildAreas, buildWorldArea, groundY } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const area = buildWorldArea(buildAreas(), []);

const base = process.argv[2] || 'http://127.0.0.1:4399/';
const section = process.argv[3] || 'work';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
/** Sunk deeper than this and the ankles go into the pavement. */
const FLOOR = -0.12;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?nolanding`);
await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'), null, { timeout: 180000 });
await page.waitForTimeout(5000);
await page.$eval(`.nav a[data-section="${section}"]`, (el) => el.click());
await page.waitForTimeout(5000);
const npcs = await page.evaluate(() => {
  const out = (window.__crowds ?? []).flatMap((c) => c.walkers
    .filter((w) => w.root.visible)
    .map((w) => ({ kind: 'walker', name: w.name, x: w.root.position.x, y: w.root.position.y, z: w.root.position.z })));
  // The scene's other inhabitants: shopkeepers behind their counters and the office staff in the lobbies.
  for (const group of ['Market shopkeepers', 'Downtown office residents']) {
    const g = window.__scene.getObjectByName(group);
    if (!g) continue;
    for (const child of g.children) {
      const p = new window.__three.Vector3();
      child.getWorldPosition(p);
      out.push({ kind: group.split(' ')[0].toLowerCase(), name: child.name || '(rig)', x: p.x, y: p.y, z: p.z });
    }
  }
  return out.map((n) => ({ ...n, x: +n.x.toFixed(2), y: +n.y.toFixed(3), z: +n.z.toFixed(2) }));
});
await browser.close();
const rows = npcs.map((n) => ({ ...n, ground: +groundY(area, n.x, n.z).toFixed(3) })).map((n) => ({ ...n, gap: +(n.y - n.ground).toFixed(3) }));
rows.sort((a, b) => a.gap - b.gap);
console.log(`${section}: ${rows.length} characters sampled`);
for (const r of rows.slice(0, 8)) console.log(`  ${r.kind.padEnd(8)} ${String(r.name).padEnd(14)} y ${String(r.y).padStart(6)} ground ${String(r.ground).padStart(6)} gap ${String(r.gap).padStart(7)} at ${[r.x, r.z]}`);
const sunk = rows.filter((r) => r.gap < FLOOR);
console.log(sunk.length ? `FAIL: ${sunk.length} walkers stand below their ground` : 'PASS: every walker stands on its ground');
process.exit(sunk.length ? 1 : 0);

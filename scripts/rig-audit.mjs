// Rig audit driver: runs /lab/characters?audit=… headless (Chrome for Testing, WebGPU) and writes
// design/night/characters/audit.json, prints a flag table, saves the contact sheets
// (design/night/characters/sheet-{walk,run,idle}-{front,side}.png) and a turntable strip for every rig
// that has none. The numbers come from src/scene/night/rigaudit.ts; rigs.ts is filled from them.
//
//   node scripts/rig-audit.mjs                  raw rigs (before the table), all three outputs
//   node scripts/rig-audit.mjs --fixed          audit the runtime pivot (after rigs.ts) → audit-fixed.json
//   node scripts/rig-audit.mjs --names a,b      subset
//   node scripts/rig-audit.mjs --no-sheets --no-turntables --out path.json --url http://[::1]:4321
//   node scripts/rig-audit.mjs --turntables=all re-shoot every turntable
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (n) => args.includes(`--${n}`);
const opt = (n, d) => { const i = args.findIndex((a) => a === `--${n}` || a.startsWith(`--${n}=`)); if (i < 0) return d; const a = args[i]; return a.includes('=') ? a.slice(a.indexOf('=') + 1) : args[i + 1]; };
const base = opt('url', 'http://[::1]:4321');
const fixed = flag('fixed');
const names = opt('names', 'all');
const out = resolve(opt('out', `design/night/characters/${fixed ? 'audit-fixed' : 'audit'}.json`));
const sheets = !flag('no-sheets');
const turntables = opt('turntables', flag('no-turntables') ? 'none' : 'missing');
const dir = resolve('design/night/characters');
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const errors = [];
const open = async (url, vw = 1600, vh = 900) => {
  const page = await browser.newPage({ viewport: { width: vw, height: vh }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(`[pageerror ${url}] ${String(e).slice(0, 300)}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[console ${url}] ${m.text().slice(0, 300)}`); });
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__view?.ready, null, { timeout: 120000 });
  return page;
};

// ---------- 1. audit
const page = await open(`${base}/lab/characters?audit=${names}${fixed ? '&fixed=1' : ''}`);
await page.waitForFunction(() => window.__audit?.done, null, { timeout: 600000 });
const audit = await page.evaluate(() => JSON.parse(JSON.stringify(window.__audit, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v))));
await page.close();
audit.generated = new Date().toISOString();
mkdirSync(dir, { recursive: true });
writeFileSync(out, JSON.stringify(audit, null, 1));
const f = (v, d = 2) => (v === null || v === undefined ? '  –  ' : Number(v).toFixed(d));
console.log(`\n${fixed ? 'runtime pivot' : 'raw'} audit → ${out}\n`);
console.log(['rig'.padEnd(18), 'h'.padStart(5), 'yaw°'.padStart(6), 'wyaw°'.padStart(6), 'M', 'ground'.padStart(7), 'disp'.padStart(5), 'stray%'.padStart(6), 'strch'.padStart(5), 'stride'.padStart(6), 'run'.padStart(5), 'trk', 'flags'].join(' '));
for (const [n, a] of Object.entries(audit.rigs)) {
  console.log([n.padEnd(18), f(a.bboxRest.height).padStart(5), f(a.yawErr, 1).padStart(6), f(a.clips.walk?.walkYawErr, 0).padStart(6), a.mirrored ? 'M' : '·', f(a.groundOffset, 3).padStart(7), f(a.maxDisp).padStart(5), f(a.strayWeights * 100, 1).padStart(6), f(a.stretch).padStart(5), f(a.clips.walk?.stride).padStart(6), f(a.clips.run?.stride).padStart(5), `${a.redundantTracks}/${a.totalTracks}`.padStart(6), a.flags.join(', ') || 'ok'].join(' '));
}
for (const [n, e] of Object.entries(audit.errors)) console.log(`${n.padEnd(18)} ERROR ${e}`);

// ---------- 2. contact sheets
if (sheets) {
  for (const clip of ['walk', 'run', 'idle']) for (const view of ['front', 'side']) {
    const t = clip === 'idle' ? 0.8 : 0.3;
    const p = await open(`${base}/lab/characters?sheet=${names}&clip=${clip}&view=${view}&t=${t}${fixed ? '' : '&raw=1'}&flags=1`, 1750, 1000);
    await p.waitForTimeout(1500);
    const file = resolve(dir, `sheet-${clip}-${view}${fixed ? '-fixed' : ''}.png`);
    await p.screenshot({ path: file });
    console.log(`sheet ${file}`);
    await p.close();
  }
}

// ---------- 3. turntables
if (turntables !== 'none') {
  const list = Object.keys(audit.rigs).filter((n) => turntables === 'all' || !existsSync(resolve(dir, n, 'turntable.png')));
  for (const n of list) {
    const p = await open(`${base}/lab/characters?turntable=${n}&clip=idle&t=0.4`, 1200, 600);
    await p.waitForTimeout(1200);
    mkdirSync(resolve(dir, n), { recursive: true });
    const file = resolve(dir, n, 'turntable.png');
    await p.screenshot({ path: file });
    console.log(`turntable ${file}`);
    await p.close();
  }
}
await browser.close();
if (errors.length) { console.log('\npage errors:'); for (const e of [...new Set(errors)].slice(0, 20)) console.log(' ', e); }

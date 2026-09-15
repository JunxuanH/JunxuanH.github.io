import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const [,, url = 'http://localhost:4321/', out = 'shot.png', wait = '9000', scroll = '0', w = '1600', h = '900'] = process.argv;
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`.slice(0, 400)));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`.slice(0, 600)));
// The warp landing (landing.ts) covers the city until a tap: skip it unless LANDING=1.
const target = process.env.LANDING || /[?&](nolanding|flat|p=)/.test(url) ? url : url + (url.includes('?') ? '&' : '?') + 'nolanding';
await page.goto(target, { waitUntil: 'load' });
if (+scroll) { await page.waitForTimeout(1500); await page.evaluate((s) => window.scrollTo(0, s * (document.body.scrollHeight - innerHeight)), +scroll); }
await page.waitForTimeout(+wait);
console.log(await page.evaluate(() => ({ backend: document.documentElement.dataset.backend, tier: document.documentElement.dataset.tier, classes: document.documentElement.className, gpu: !!navigator.gpu })));
await page.screenshot({ path: out });
console.log(logs.filter((l, i) => logs.indexOf(l) === i).slice(0, 40).join('\n'));
await browser.close();

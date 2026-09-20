// Luminance probe: nothing in the dressed world should render as a black hole.
//
// The scene has no shadow maps and a fixed-size point-light pool (lights.ts), so a surface that no light
// reaches renders at its ambient floor — which is how a 780 u seawall and a lobby forecourt both shipped as
// pure black. No probe measured light before this one. It parks the player at fixed viewpoints, samples the
// frame, and reports the darkest band of each; `--assert` fails if a sample is below FLOOR.
//   node scripts/lumen-check.mjs [url] [--assert]
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const args = process.argv.slice(2);
const base = args.find((a) => a.startsWith('http')) || 'http://127.0.0.1:4399/';
const strict = args.includes('--assert');
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
/** section, name, x, z, yaw°, and the band of the frame that holds the surface under test (fractions of height). */
const SPOTS = [
  ['contact', 'seawall', 0, -30, 0, 0.42, 0.72],
  ['contact', 'quay-east', -40, -26, 90, 0.30, 0.60],
  ['contact', 'tunnel-mouth', 0, -46, 0, 0.35, 0.70],
  ['work', 'lobby-forecourt', 17, -178, 250, 0.55, 0.95],
  ['projects', 'market-street', 40, -228, 90, 0.45, 0.85],
];
/** Below this a surface reads as a hole rather than as night. Measured: the old seawall sat at 3. */
const FLOOR = 12;
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(`${base}?nolanding`);
await page.waitForFunction(() => document.documentElement.classList.contains('is-booted'), null, { timeout: 180000 });
await page.waitForTimeout(6000);
let worst = [];
for (const section of [...new Set(SPOTS.map((s) => s[0]))]) {
  await page.$eval(`.nav a[data-section="${section}"]`, (el) => el.click());
  await page.waitForTimeout(4500);
  for (const [sec, name, x, z, yaw, b0, b1] of SPOTS.filter((s) => s[0] === section)) {
    await page.evaluate(([x, z, yaw]) => window.__player.teleport(x, 0, z, yaw), [x, z, (yaw * Math.PI) / 180]);
    await page.waitForTimeout(1600);
    const shot = await page.screenshot({ type: 'png' });
    const lum = await page.evaluate(async ([b64, b0, b1]) => {
      const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
      const c = new OffscreenCanvas(img.width, img.height), g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const y0 = Math.round(img.height * b0), y1 = Math.round(img.height * b1);
      // Ignore the middle third: the player and the HUD live there, and they are always lit.
      const d = g.getImageData(0, y0, img.width, y1 - y0).data;
      let sum = 0, n = 0;
      for (let i = 0; i < d.length; i += 4) {
        const px = (i / 4) % img.width;
        if (px > img.width * 0.35 && px < img.width * 0.65) continue;
        sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; n++;
      }
      return +(sum / n).toFixed(1);
    }, [shot.toString('base64'), b0, b1]);
    console.log(`${name.padEnd(18)} mean luminance ${String(lum).padStart(6)}${lum < FLOOR ? '   ← reads as a hole' : ''}`);
    if (lum < FLOOR) worst.push([name, lum]);
  }
}
await browser.close();
if (strict && worst.length) { console.error('FAIL:', worst.map(([n, l]) => `${n} ${l}`).join(', ')); process.exit(1); }
console.log(worst.length ? 'dark surfaces remain' : 'PASS: no sampled surface is a hole');

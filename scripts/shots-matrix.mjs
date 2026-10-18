// Screenshot every surface at phone/tablet/desktop widths: `node scripts/shots-matrix.mjs [baseUrl] [outDir]`.
// Needs the dev server running. Uses playwright-core + CHROME (path to a Chromium/Chrome for Testing binary).
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const [,, base = 'http://localhost:4321', out = 'shots'] = process.argv;
const exe = process.env.CHROME || process.env.PLAYWRIGHT_BROWSERS_PATH && `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`;
const pages = { resume: '/resume', flat: '/?flat&nolanding', city: '/?nolanding&p=0.1' };
const sizes = { phone: [375, 812], tablet: [768, 1024], desktop: [1440, 900] };
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: exe || undefined, headless: true, args: ['--use-gl=swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, path] of Object.entries(pages)) for (const [sz, [width, height]] of Object.entries(sizes)) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(name === 'city' ? 6000 : 800);
  await page.screenshot({ path: `${out}/${name}-${sz}.png`, fullPage: name !== 'city' });
  await page.close();
}
await browser.close();
console.log(`wrote ${Object.keys(pages).length * Object.keys(sizes).length} screenshots to ${out}/`);

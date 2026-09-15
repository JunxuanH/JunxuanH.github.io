// Original artwork must remain planar: capture side margins and reject panorama/depth-map requests.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const base = process.argv[2] || 'http://127.0.0.1:4336/';
const out = 'design/night/shots/panel-edges'; mkdirSync(out, { recursive: true });
try {
  for (const phone of [true, false]) {
    const name = phone ? 'phone' : 'desktop';
    const page = await browser.newPage({ viewport: phone ? { width: 393, height: 700 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone });
    const errors = [], forbidden = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/backdrop\/.*(pano|depth)/.test(r.url())) forbidden.push(r.url()); });
    await page.goto(base + '?nolanding');
    await page.waitForFunction(() => window.__player && document.documentElement.classList.contains('is-landed'), null, { timeout: 120000 });
    await page.screenshot({ path: `${out}/${name}-vista.png` });
    await page.locator('#hero-copy .neon-btn.primary').click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__nav.mode === 'walk' && !window.__nav.cutscene, null, { timeout: 60000 });
    for (const [label, angle] of [['west-edge', -Math.PI / 4], ['west-center', -Math.PI / 2], ['east-edge', Math.PI / 4]]) {
      await page.evaluate(a => window.__player.teleport(-96, .22, -78, a), angle);
      await page.waitForTimeout(2500);
      assert.ok(await page.evaluate(() => {
        const panels = window.__scene.getObjectByName('backdrop');
        return panels?.children.length === 3 && panels.children.every(m => m.geometry.type === 'PlaneGeometry' && !m.material.positionNode && m.position.z <= -560);
      }), 'keep the three flat north panels');
      await page.screenshot({ path: `${out}/${name}-${label}.png` });
    }
    assert.deepEqual(forbidden, [], 'no panorama or depth displacement');
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: three flat north panels, no panorama/depth, side-angle screenshots, no runtime errors`);
    await page.close();
  }
} finally { await browser.close(); }

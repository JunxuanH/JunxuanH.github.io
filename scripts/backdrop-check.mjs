// Regression: skyline must remain continuous and centered during movement and district changes.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const base = process.argv[2] || 'http://127.0.0.1:4334/';
const out = 'design/night/shots/backdrop-check'; mkdirSync(out, { recursive: true });
try {
  for (const phone of [true, false]) {
    const name = phone ? 'phone' : 'desktop';
    const page = await browser.newPage({ viewport: phone ? { width: 393, height: 700 } : { width: 1440, height: 900 }, isMobile: phone, hasTouch: phone });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '?nolanding&nocine');
    await page.waitForFunction(() => window.__player && document.documentElement.classList.contains('is-landed'), null, { timeout: 120000 });
    await page.screenshot({ path: `${out}/${name}-vista.png` });
    await page.locator('#hero-copy .neon-btn.primary').click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__nav.mode === 'walk' && !window.__nav.cutscene, null, { timeout: 60000 });
    for (let i = 0; i < 8; i++) {
      await page.evaluate(i => window.__player.teleport(-80, .22, -80, i * Math.PI / 4), i);
      await page.waitForTimeout(1800);
      const state = await page.evaluate(() => {
        const dome = window.__scene.getObjectByName('skyline-panorama');
        const center = dome?.matrixWorld.elements.slice(12, 15);
        return { exists: !!dome, displaced: !!dome?.material.positionNode, plates: window.__scene.children.some(c => c.userData.ring), error: center ? Math.hypot(...center.map((v, i) => v - window.__camera.position.toArray()[i])) : Infinity };
      });
      assert.ok(state.exists && !state.displaced && !state.plates, 'continuous undisplaced panorama, no old plates');
      assert.ok(state.error < .001, 'sky follows camera without translational parallax');
      await page.screenshot({ path: `${out}/${name}-campus-${i}.png` });
    }
    await page.locator('.nav a[data-section="contact"]').click(); await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.__nav.section === 'contact' && window.__nav.mode === 'walk' && !window.__nav.cutscene, null, { timeout: 60000 });
    await page.waitForTimeout(1800); await page.screenshot({ path: `${out}/${name}-harbor.png` });
    assert.deepEqual(errors, []);
    console.log(`PASS ${name}: 8 campus angles, centered undisplaced skyline, vista and harbor`);
    await page.close();
  }
} finally { await browser.close(); }

// Production acceptance checks: live GLB through loading, departure, reduced motion, fallback, and every district.
// PLAYWRIGHT_MODULE may point at an existing Playwright installation. Run against `npm run preview`.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs');
const url = process.argv[2] || 'http://127.0.0.1:4331/';
const cases = process.argv.slice(3);
const out = 'design/night/shots/live-landing'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const results = [];
try {
  for (const name of cases.length ? cases : ['desktop', 'phone', 'reduced', 'missing', 'flat', 'nolanding']) {
    const phone = name === 'phone';
    const page = await browser.newPage({ viewport: phone ? { width: 393, height: 852 } : { width: 1440, height: 900 }, hasTouch: phone, isMobile: phone,
      reducedMotion: name === 'reduced' ? 'reduce' : 'no-preference' });
    const errors = [], videos = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/\/night\/landing\/.*\.mp4/.test(r.url())) videos.push(r.url()); });
    if (name === 'missing') await page.route('**/landing-hovercar.glb', route => route.abort());
    // Observe the real world object's lifetime across the handoff, without modifying the animation.
    await page.addInitScript(() => {
      window.__flightSamples = [];
      setInterval(() => { const o = window.__scene?.getObjectByName('landing-flyby');
        if (o?.visible) window.__flightSamples.push({ p: o.position.toArray(), distance: o.position.distanceTo(window.__camera.position), t: performance.now() });
      }, 30);
    });
    await page.goto(url + (['flat', 'nolanding'].includes(name) ? `?${name}` : ''));
    if (name === 'flat') {
      await page.waitForFunction(() => document.documentElement.classList.contains('no-3d'));
      assert.equal(await page.locator('#gate').count(), 0);
    } else {
      if (name !== 'nolanding') {
        await page.locator('.gate-car[data-model="ready"]').waitFor({ timeout: 30000 });
        assert.equal(await page.locator('#stage canvas').count(), 0, 'city must wait for Enter');
        if (name === 'reduced') assert.equal(await page.locator('.gate-car').getAttribute('data-motion'), 'reduced');
        await page.screenshot({ path: `${out}/${name}-gate.png` });
        await page.getByRole('button', { name: 'Enter the city', exact: true }).click();
        await page.locator('#boot .gate-car canvas').waitFor({ timeout: 10000 });
        await page.locator(`#boot .gate-car[data-phase="${name === 'reduced' ? 'still' : 'hyperspace'}"]`).waitFor({ timeout: 10000 });
        if (['desktop', 'phone'].includes(name)) {
          await page.waitForTimeout(1800);
          await page.screenshot({ path: `${out}/${name}-hyperspace.png` });
        }
      }
      await page.waitForFunction(() => document.documentElement.classList.contains('is-landed'), null, { timeout: 120000 });
      assert.equal(await page.locator('#boot').count(), 0);
      if (!['reduced', 'missing', 'nolanding'].includes(name)) {
        await page.waitForFunction(() => window.__flightSamples.length > 2, null, { timeout: 10000 });
        await page.screenshot({ path: `${out}/${name}-departure.png` });
        await page.waitForFunction(() => !window.__scene.getObjectByName('landing-flyby').visible, null, { timeout: 15000 });
        const flight = await page.evaluate(() => window.__flightSamples);
        assert.ok(flight.at(-1).distance > flight[0].distance + 100, 'car must travel into the distance');
        writeFileSync(`${out}/${name}-flight.json`, JSON.stringify(flight));
      } else if (name === 'reduced') assert.equal(await page.evaluate(() => window.__flightSamples.length), 0);
      await page.screenshot({ path: `${out}/${name}-city.png` });
      if (['desktop', 'phone'].includes(name)) {
        await page.locator('#hero-copy .neon-btn.primary').click();
        await page.waitForFunction(() => window.__nav.mode === 'walk', null, { timeout: 30000 });
        for (const section of ['education', 'work', 'projects', 'contact']) {
          await page.locator(`.nav a[data-section="${section}"]`).click();
          await page.waitForFunction(s => window.__nav.section === s && window.__nav.mode === 'walk' && !window.__nav.inFlight, section, { timeout: 30000 });
          // The follow camera damps to the player after walk mode begins.
          await page.waitForTimeout(2200);
          await page.screenshot({ path: `${out}/${name}-${section}.png` });
        }
      }
    }
    assert.deepEqual(videos, [], 'intro must not fetch videos');
    assert.deepEqual(errors, [], 'no uncaught runtime errors');
    console.log(`PASS ${name}: ${name === 'flat' ? 'text page' : 'car/scene handoff'}, no intro videos, no runtime errors`);
    results.push({ name, passed: true }); await page.close();
  }
} finally { await browser.close(); writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2)); }

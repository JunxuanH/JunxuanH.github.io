// Probes for the video cutscenes (cutscene.ts + the cover beats in nav.ts). Needs the dev server and encoded clips
// in public/night/cutscenes/. Usage: node scripts/cutscene-check.mjs [url=http://[::1]:4321/]
// Screenshots go to design/night/shots/cine/. Exit 1 when an assertion fails.
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
import { mkdirSync } from 'node:fs';

const url = process.argv[2] || 'http://[::1]:4321/';
const SHOTS = 'design/night/shots/cine';
mkdirSync(SHOTS, { recursive: true });
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const ARGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'];
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const fmt = (n, d = 2) => (typeof n === 'number' ? n.toFixed(d) : String(n));

/** Per-rAF sampler installed in the page: cutscene beat, the cine layer, the video, the camera, dt. */
const SAMPLER = () => {
  const S = (window.__samples = []);
  let last = performance.now();
  const tick = () => {
    const now = performance.now(); const dt = now - last; last = now;
    const c = window.__nav?.cutscene, cam = window.__camera?.position, el = document.getElementById('cine'), v = el?.querySelector('video');
    S.push({
      t: now, dt, beat: c ? c.beat : null, bt: c ? c.t : null, mode: window.__mode, p: window.__nav?.p,
      op: el ? +getComputedStyle(el).opacity : -1, on: !!el?.classList.contains('is-on'),
      src: v?.getAttribute('src') || '', ct: v ? v.currentTime : -1, rs: v ? v.readyState : -1, paused: v ? v.paused : null,
      x: cam?.x ?? 0, y: cam?.y ?? 0, z: cam?.z ?? 0,
    });
    if (window.__sampling) requestAnimationFrame(tick);
  };
  window.__sampling = true;
  requestAnimationFrame(tick);
};
const startSampling = (page) => page.evaluate(SAMPLER);
const stopSampling = (page) => page.evaluate(() => { window.__sampling = false; return window.__samples; });
const click = (page, id) => page.evaluate((id) => { window.__t0 = performance.now(); document.querySelector(`.nav a[data-section="${id}"]`).click(); return window.__t0; }, id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const beatsOf = (S) => S.map((s) => s.beat).filter((b, i, a) => i === 0 || b !== a[i - 1]);

function trackRequests(page) {
  const reqs = [];
  let live = 0, peak = 0;
  page.on('request', (r) => { if (r.url().includes('/night/cutscenes/')) { const e = { url: r.url(), t: performance.now(), done: false }; reqs.push(e); if (e.url.includes('.mp4')) { live++; peak = Math.max(peak, live); } } });
  const done = (r) => { const e = reqs.find((x) => x.url === r.url() && !x.done); if (e) { e.done = true; if (e.url.includes('.mp4')) live--; } };
  page.on('requestfinished', done);
  page.on('requestfailed', done);
  return { reqs, get peak() { return peak; }, mp4: () => reqs.filter((r) => r.url.includes('.mp4')), reset() { reqs.length = 0; live = 0; peak = 0; } };
}
let reloads = 0, onLoad = null;
async function boot(page, q = '?q=med&dpr=1') {
  if (onLoad) page.off('load', onLoad); // our own navigation is not a reload
  await page.goto(url + q, { waitUntil: 'load' });
  await page.waitForSelector('html.is-booted', { timeout: 180_000 });
  await page.waitForTimeout(1500);
  // A dev-server HMR full reload mid-probe (someone saved a file) puts the page back on the hero: flag it.
  onLoad = () => { reloads++; console.log('WARN  page reloaded mid-probe (dev-server HMR?) — the checks that follow may cover a different transition'); };
  page.once('load', onLoad);
}
const waitCached = (page, pair, ms = 20_000) => page.waitForFunction((p) => window.__cine?.cached(p), pair, { timeout: ms }).then(() => true, () => false);
const waitLanded = (page, ms = 20_000) => page.waitForFunction(() => window.__mode === 'walk' && !window.__nav.cutscene, null, { timeout: ms }).then(() => true, () => false);

/** dt > 50 ms inside ±500 ms of `at`, ignoring the covered p-jump (the frame where p changed, and the one after). */
const spikes = (S, at) => S.filter((s, i) => Math.abs(s.t - at) <= 500 && s.dt > 50 && !(i > 0 && S[i - 1].p !== s.p) && !(i > 1 && S[i - 2].p !== S[i - 1].p));

// ---------- 1. desktop: covered transition (Campus → Downtown), skip, mid-play error, payload
async function desktop() {
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const net = trackRequests(page);
  await boot(page);
  const enabled = await page.evaluate(() => window.__cine?.enabled);
  check('desktop: __cine.enabled', enabled === true, String(enabled));
  const manifest = await page.evaluate(() => window.__cine?.manifest ? Object.keys(window.__cine.manifest.clips) : null);
  check('desktop: manifest fetched', manifest && manifest.length > 0, manifest ? `${manifest.length} clips` : 'none');
  await page.waitForTimeout(6000); // idle preload of the four hops out of the city
  const idleMp4 = net.mp4();
  check('desktop: payload after idle ≤ 4 clips', idleMp4.length <= 4, `${idleMp4.length} mp4 requests`);
  check('desktop: ≤ 2 concurrent clip fetches', net.peak <= 2, `peak ${net.peak}`);
  const manifestReqs = net.reqs.filter((r) => r.url.includes('manifest.json')).length;
  check('desktop: one manifest request', manifestReqs === 1, String(manifestReqs));

  // City → Campus (its own cover when cached), then wait for the Campus → Downtown clip.
  await waitCached(page, 'city-education', 15_000);
  await click(page, 'education');
  check('desktop: arrived on the campus', await waitLanded(page, 25_000));
  const cached = await waitCached(page, 'education-work', 20_000);
  check('desktop: education-work cached before the click', cached);
  const duration = await page.evaluate(() => window.__cine.manifest.clips['education-work']?.duration ?? 0);

  await startSampling(page);
  const t0 = await click(page, 'work');
  // Mid-cover screenshot, away from both fades (≈ 3 s in).
  await page.waitForTimeout(3000);
  const midBeat = await page.evaluate(() => window.__nav.cutscene?.beat);
  await page.screenshot({ path: `${SHOTS}/desktop-cover.png` });
  check('desktop: mid-clip beat is cover', midBeat === 'cover', String(midBeat));
  const landed = await waitLanded(page, 20_000);
  const S = await stopSampling(page);
  await page.screenshot({ path: `${SHOTS}/desktop-arrive.png` });
  check('desktop: hold → handoff → walk', landed);
  const beats = beatsOf(S).filter(Boolean);
  check('desktop: beat order establish → cover → hold → handoff', beats.join(',') === 'establish,cover,hold,handoff', beats.join(','));

  const est = S.filter((s) => s.beat === 'establish');
  const estLen = est.length ? est[est.length - 1].t - est[0].t + est[est.length - 1].dt : 0;
  check('desktop: establish ≥ 0.8 s', estLen >= 780, `${fmt(estLen, 0)} ms`);
  check('desktop: establish at opacity 0', est.every((s) => s.op < 0.01), `max op ${fmt(Math.max(...est.map((s) => s.op)))}`);
  check('desktop: blob: src during establish', est.some((s) => s.src.startsWith('blob:')), est.at(-1)?.src.slice(0, 40));
  const firstOn = S.find((s) => s.on);
  check('desktop: .is-on only after readyState ≥ 2', firstOn && firstOn.rs >= 2 && S.filter((s) => s.on).every((s) => s.rs >= 2), `first on rs=${firstOn?.rs}`);
  const firstFull = S.find((s) => s.op >= 0.99);
  check('desktop: opacity 1 within 1400 ms of the click', firstFull && firstFull.t - t0 <= 1400, firstFull ? `${fmt(firstFull.t - t0, 0)} ms` : 'never');
  const cov = S.filter((s) => s.beat === 'cover' && s.op >= 0.99);
  const hold0 = S.find((s) => s.beat === 'hold');
  const parked = cov.length > 10 ? Math.max(...cov.slice(5).map((s) => dist(s, hold0 ?? cov.at(-1)))) : Infinity;
  check('desktop: canvas parked during the cover (≤ 0.2 u drift)', parked <= 0.2, `${fmt(parked, 3)} u across ${cov.length} frames`);
  const off = S.findIndex((s, i) => i > 0 && S[i - 1].on && !s.on);
  const ctOff = off > 0 ? Math.max(S[off - 1].ct, S[off].ct) : -1;
  check('desktop: fade-out at currentTime ≥ duration − 0.35', off > 0 && ctOff >= duration - 0.35 && ctOff <= duration + 0.05, `ct ${fmt(ctOff)} / ${fmt(duration)} s`);
  const after = S.filter((s) => s.beat === null && s.mode === 'walk');
  check('desktop: src released after the cutscene', after.length > 0 && after.at(-1).src === '', after.at(-1)?.src || 'released');
  const sp = [...spikes(S, firstOn?.t ?? 0), ...(off > 0 ? spikes(S, S[off].t) : [])];
  check('desktop: no frame > 50 ms around the fades', sp.length === 0, sp.map((s) => `${fmt(s.dt, 0)}ms@${s.beat}`).join(' ') || 'clean');
  // The one allowed jump is the covered one: the frame that first paints the destination shot must be at opacity 1
  // (the sampler runs after the render loop's rAF, so a sample's camera and opacity belong to the same painted frame).
  const jumps = S.filter((s, i) => i > 0 && dist(s, S[i - 1]) > 3 && s.op < 0.99);
  check('desktop: no uncovered camera jump > 3 u', jumps.length === 0, jumps.map((s) => `${fmt(dist(s, S[S.indexOf(s) - 1]), 1)}u op=${fmt(S[S.indexOf(s) - 1].op)}→${fmt(s.op)} ${s.beat}`).join(' ') || 'none');

  // Skip: Downtown → Market, Space 1.5 s after the click (inside the cover).
  await waitCached(page, 'work-projects', 20_000);
  await startSampling(page);
  const t1 = await click(page, 'projects');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Space');
  const tSkip = await page.evaluate(() => performance.now());
  check('skip: landed', await waitLanded(page, 20_000));
  const K = await stopSampling(page);
  await page.screenshot({ path: `${SHOTS}/skip-arrive.png` });
  const kb = beatsOf(K).filter(Boolean);
  const wasOn = K.some((s) => s.on && s.t < tSkip);
  const offAfter = K.find((s) => s.t > tSkip && !s.on && s.op < 0.01);
  check('skip: cover was showing at the Space press', wasOn, kb.join(','));
  check('skip: layer off within 400 ms of Space', offAfter && offAfter.t - tSkip <= 400, offAfter ? `${fmt(offAfter.t - tSkip, 0)} ms` : 'never');
  check('skip: ends in walk with hold → handoff', kb.slice(-2).join(',') === 'hold,handoff', kb.join(','));
  check('skip: whole transition shorter than the clip', K.at(-1).t - t1 < 1500 + 400 + 2200 + 800, `${fmt(K.at(-1).t - t1, 0)} ms`);

  // Mid-play error: Market → Harbor, dispatch `error` on the video ≈ 1 s into the clip.
  await waitCached(page, 'projects-contact', 20_000);
  await startSampling(page);
  await click(page, 'contact');
  const playing = await page.waitForFunction(() => { const v = document.querySelector('#cine video'); return v && document.getElementById('cine').classList.contains('is-on') && v.currentTime > 0.6; }, null, { timeout: 6000 }).then(() => true, () => false);
  const tErr = await page.evaluate(() => { document.querySelector('#cine video').dispatchEvent(new Event('error')); return performance.now(); });
  check('error: landed', await waitLanded(page, 20_000));
  const E = await stopSampling(page);
  const offErr = E.find((s) => s.t > tErr && s.op < 0.01);
  check('error: cover was playing before the dispatch', playing);
  check('error: opacity 0 within 300 ms of the error', offErr && offErr.t - tErr <= 300 + 20, offErr ? `${fmt(offErr.t - tErr, 0)} ms` : 'never');
  check('error: beats end hold → handoff', beatsOf(E).filter(Boolean).slice(-2).join(',') === 'hold,handoff', beatsOf(E).filter(Boolean).join(','));
  check('desktop: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  // Reference pose: what the frame capture parks on (reduced motion, ?p=ESTABLISH.work) vs the cover's parked camera.
  const p = await page.evaluate(() => window.__nav.establish.work);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await boot(page, `?q=med&dpr=1&p=${p}&nocine`);
  const ref = await page.evaluate(() => { const c = window.__camera.position; return { x: c.x, y: c.y, z: c.z }; });
  const covPose = cov.length ? cov[Math.floor(cov.length / 2)] : null;
  check('desktop: parked camera matches the establishing frame (≤ 0.2 u)', covPose && dist(covPose, ref) <= 0.2, covPose ? `${fmt(dist(covPose, ref), 3)} u` : 'no cover samples');
  await browser.close();
}

// ---------- 2. fallback: clips blocked → 3D beats, never .is-on, no jumps, no errors
async function fallback() {
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ARGS });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route(/\/night\/cutscenes\/[^/]*\.mp4/, (route) => route.abort()); // the clips carry a ?v=sha query
  await boot(page);
  await page.waitForTimeout(4000);
  await startSampling(page);
  await click(page, 'education');
  check('fallback: landed', await waitLanded(page, 25_000));
  const S = await stopSampling(page);
  await page.screenshot({ path: `${SHOTS}/fallback-arrive.png` });
  const beats = beatsOf(S).filter(Boolean);
  check('fallback: #cine never .is-on', S.every((s) => !s.on && s.op < 0.01));
  check('fallback: 3D beats ran', beats.includes('travel') && beats.includes('hold'), beats.join(','));
  const jumps = S.filter((s, i) => i > 0 && dist(s, S[i - 1]) > 3);
  check('fallback: per-frame camera jump < 3 u', jumps.length === 0, `${jumps.length}`);
  check('fallback: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  await browser.close();
}

// ---------- 3. phone portrait + reduced motion + data saver: never enabled, never fetches
async function phone() {
  const browser = await chromium.launch({ executablePath: exe, headless: true, args: ARGS });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await context.addInitScript(() => { Object.defineProperty(navigator, 'connection', { value: { saveData: true, effectiveType: '4g' }, configurable: true }); });
  const page = await context.newPage();
  const net = trackRequests(page);
  await boot(page);
  const enabled = await page.evaluate(() => window.__cine?.enabled);
  check('phone: __cine.enabled === false', enabled === false, String(enabled));
  await page.waitForTimeout(4000);
  await click(page, 'education');
  await waitLanded(page, 20_000);
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${SHOTS}/phone-arrive.png` });
  check('phone: zero requests to /night/cutscenes/', net.reqs.length === 0, `${net.reqs.length}`);
  await browser.close();
}

await desktop();
await fallback();
await phone();
const failed = results.filter((r) => !r.ok);
if (reloads) console.log(`WARN  ${reloads} mid-probe page reload(s)`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

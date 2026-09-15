// Probes for the landing gate + warp landing (src/scene/night/gate.ts, landing.ts, #gate / #boot in index.astro,
// public/night/landing/). Needs the dev server and the landing media.
// Usage: node scripts/landing-check.mjs [url=http://[::1]:4321/] [scenario…]
// Scenarios: flat nolanding reduced desktop phone slow delayed (default: all). Screenshots: design/night/shots/landing/.
// Desktop 1440×900 and phone 393×852 (touch, mobile). Exit 1 when a check fails.
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const url = process.argv[2] || 'http://[::1]:4321/';
const only = process.argv.slice(3);
const SHOTS = 'design/night/shots/landing';
const CITY = 'design/night/cutscenes/frames/city.png'; // 1280×720, the vista the arrival clip ends on
const FF = process.env.FFMPEG || '/opt/homebrew/bin/ffmpeg';
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const ARGS = ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'];
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const PHONE = { viewport: { width: 393, height: 852 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true };
/** A screenshot is a black frame when even its 90th-percentile luma (0–255, limited range: 16 is black) stays under this;
 *  dark footage (the arrival's tunnel exit averages ~22) still has bright streaks and lights. */
const BLACK_Y = 32;
/** ms from navigation within which the gate must be interactive (its module handler attached). */
const GATE_MS = 1000;

mkdirSync(SHOTS, { recursive: true });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const info = (s) => console.log(`      ${s}`);
const fmt = (n, d = 1) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : String(n));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const want = (s) => !only.length || only.includes(s);
const pct = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * q))] : NaN; };
const base = (f) => f.split('/').pop();

// ---- image math through ffmpeg
const ff = (args) => spawnSync(FF, ['-hide_banner', '-nostats', ...args], { encoding: 'utf8' }).stderr || '';
/** 90th-percentile luma of a screenshot (signalstats YHIGH). */
const luma = (file) => { const m = ff(['-i', file, '-vf', 'scale=320:-2,signalstats,metadata=print:key=lavfi.signalstats.YHIGH', '-f', 'null', '-']).match(/YHIGH=([\d.]+)/); return m ? +m[1] : NaN; };
/**
 * SSIM of a screenshot against the centre of city.png that a cover-fit clip shows at the viewport's aspect, at 360 px tall.
 * `blur` (gaussian sigma) discounts what is live in the vista and frozen in the still (rain, ripples, traffic) while a
 * misaligned camera still scores low; `dx` shifts the crop (px of city.png) for the control.
 */
const ssimCity = (file, aspect, { blur = 0, dx = 0 } = {}) => {
  const cw = Math.min(1280, Math.round((720 * aspect) / 2) * 2), ch = aspect > 16 / 9 ? Math.round(1280 / aspect / 2) * 2 : 720;
  const W = Math.round((360 * cw) / ch / 2) * 2, H = 360, B = blur ? `,gblur=sigma=${blur}` : '';
  const x = Math.round((1280 - cw) / 2) + dx, y = Math.round((720 - ch) / 2);
  const m = ff(['-i', file, '-i', CITY, '-lavfi', `[0:v]scale=${W}:${H},format=gray${B}[a];[1:v]crop=${cw}:${ch}:${x}:${y},scale=${W}:${H},format=gray${B}[b];[a][b]ssim`, '-f', 'null', '-']).match(/All:([\d.]+)/);
  return m ? +m[1] : NaN;
};

// ---- page instrumentation (before any page script): video samples every 250 ms, long tasks, a rAF sampler on demand
const INIT = () => {
  const lc = (window.__lc = { samples: [], frames: [], sampling: false, longtasks: [], videoPlayedBeforeClick: false });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) lc.longtasks.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  const iv = setInterval(() => {
    const v = document.querySelector('.warp-loop'), b = document.getElementById('boot'), g = document.getElementById('gate');
    const q = v && v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : null;
    const playing = [...document.querySelectorAll('video')].some((x) => !x.paused || x.currentTime > 0);
    const gateOpen = !!g && g.dataset.state === 'open';
    if (gateOpen && playing) lc.videoPlayedBeforeClick = true;
    lc.samples.push({
      t: performance.now(), ct: v ? v.currentTime : -1, total: q ? q.totalVideoFrames : -1, dropped: q ? q.droppedVideoFrames : -1,
      mode: b ? b.dataset.landing : 'gone', gate: gateOpen, booted: document.documentElement.classList.contains('is-booted'),
      started: !!window.__perf, canvas: !!document.querySelector('#stage canvas'),
    });
    if (!b && lc.samples.length > 4) clearInterval(iv);
  }, 250);
  window.__lcFrames = (on) => {
    if (!on) { lc.sampling = false; return lc.frames; }
    lc.frames = []; lc.sampling = true;
    const f = (t) => { lc.frames.push(t); if (lc.sampling) requestAnimationFrame(f); };
    requestAnimationFrame(f);
    return null;
  };
};
/** iOS motion permission stub: resolves 'granted' 1.5 s after the request. */
const TILT_STUB = () => {
  const DOE = window.DeviceOrientationEvent;
  if (!DOE) return;
  DOE.requestPermission = () => { window.__tiltReq = { at: performance.now(), started: !!window.__perf }; return new Promise((r) => setTimeout(() => { window.__tiltResAt = performance.now(); r('granted'); }, 1500)); };
};

function watch(page, tag) {
  const w = { landing: [], landingTypes: [], errors: [], prewarm: null };
  page.on('request', (r) => { if (r.url().includes('/night/landing/')) { w.landing.push(r.url().replace(/^.*\/night\/landing\//, '')); w.landingTypes.push(r.resourceType()); } });
  page.on('pageerror', (e) => w.errors.push(e.message.slice(0, 200)));
  page.on('console', (m) => {
    const t = m.text(), pw = t.match(/\[night\] pre-warm (\d+) ms/);
    if (pw) w.prewarm = +pw[1];
    if (/\[landing\]/.test(t)) info(`[${tag} console] ${t.slice(0, 160)}`);
  });
  return w;
}
const state = (page) => page.evaluate(() => ({
  mode: window.__landing?.mode, arriving: window.__landing?.arriving, leaving: window.__landing?.leaving, arrivalReady: window.__landing?.arrivalReady,
  times: window.__landing?.times ?? {}, booted: document.documentElement.classList.contains('is-booted'),
  landed: document.documentElement.classList.contains('is-landed'), boot: !!document.getElementById('boot'),
}));
const timesOf = (page) => page.evaluate(() => window.__landing?.times ?? {});
const clickAt = (page) => page.evaluate(() => { window.__clickAt = performance.now(); });

/** Open the page on the gate: timing, nothing started, nothing playing, the pre-selected choice. */
async function gatePhase(page, tag, { hold = 3000, shot = true } = {}) {
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForFunction(() => window.__gate?.times?.moduleReady != null, null, { timeout: 60_000 });
  await sleep(hold);
  const g = await page.evaluate(() => {
    const el = document.getElementById('gate'), primary = el?.querySelector('.gate-enter.primary');
    return {
      open: el?.dataset.state === 'open', pre: el?.dataset.pre, returning: !!el?.classList.contains('is-returning'),
      primary: primary?.dataset.choice, focus: document.activeElement?.dataset?.choice ?? document.activeElement?.tagName,
      moduleReady: window.__gate.times.moduleReady, dcl: Math.round(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd ?? NaN),
      started: !!window.__perf || !!document.querySelector('#stage canvas') || document.documentElement.classList.contains('is-3d'),
      played: window.__lc.videoPlayedBeforeClick, videos: [...document.querySelectorAll('video')].map((v) => ({ paused: v.paused, t: v.currentTime, src: v.getAttribute('src') })),
      longest: Math.max(0, ...window.__lc.longtasks.filter(([s]) => s < 3000).map(([, d]) => d)),
    };
  });
  if (shot) await page.screenshot({ path: `${SHOTS}/${tag}-gate.png` });
  return g;
}

/** After Enter: screenshots through the load (~0.5 s apart; they wait on the main thread) and then every ~100 ms through
 *  the arrival and the fade; the live vista with the overlay hidden when the fade starts; the end state. */
async function journey(page, tag, aspect) {
  const dir = `${SHOTS}/${tag}-series`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(SHOTS)) if (f.startsWith(`${tag}-load-`)) rmSync(`${SHOTS}/${f}`);
  const t0 = Date.now();
  const load = [], series = [];
  let vista = null, st = await state(page), midLoad = false;
  for (let i = 0; Date.now() - t0 < 180_000; i++) {
    st = await state(page).catch(() => st);
    if (!st.booted) {
      const f = `${SHOTS}/${tag}-load-${String(i).padStart(2, '0')}.jpg`;
      await page.screenshot({ path: f, type: 'jpeg', quality: 70 }).catch(() => null);
      load.push(f);
      if (!midLoad && Date.now() - t0 > 1500) { midLoad = true; await page.screenshot({ path: `${SHOTS}/${tag}-loop-midload.png` }).catch(() => null); }
      await sleep(400);
      continue;
    }
    const f = `${dir}/${String(i).padStart(3, '0')}.jpg`;
    await page.screenshot({ path: f, type: 'jpeg', quality: 70 });
    st = await state(page);
    series.push({ f, arriving: st.arriving, leaving: st.leaving, landed: st.landed });
    if (st.times.arrivalFirstFrame != null && !series.arrivalShot) {
      series.arrivalShot = true;
      await sleep(1200);
      await page.screenshot({ path: `${SHOTS}/${tag}-arrival.png` });
    }
    if (st.leaving && !vista && st.boot) {
      await page.evaluate(() => { const s = document.createElement('style'); s.id = 'lc-hide'; s.textContent = '#boot,#hero-copy,.nav{visibility:hidden!important}'; document.head.appendChild(s); });
      vista = `${SHOTS}/${tag}-vista-live.png`;
      await page.screenshot({ path: vista });
      await page.evaluate(() => document.getElementById('lc-hide')?.remove());
    }
    if (st.landed && series.filter((s) => s.landed).length >= 6) break;
    await sleep(60);
  }
  return { load, series, vista };
}

function loopChecks(tag, samples, w, loadShots) {
  const start = samples.findIndex((s) => s.total > 0);
  const booted = samples.findIndex((s) => s.booted);
  const pre = samples.slice(Math.max(0, start), booted >= 0 ? booted : samples.length);
  let rate = NaN, maxGap = 0, dropped = NaN, total = NaN, stuck = 0, startDrops = 0;
  if (pre.length > 1) {
    const a = pre[0], b = pre[pre.length - 1];
    rate = (b.total - a.total) / 30 / ((b.t - a.t) / 1000);
    dropped = b.dropped - a.dropped; total = b.total - a.total; startDrops = a.dropped;
    for (let i = 1; i < pre.length; i++) {
      maxGap = Math.max(maxGap, pre[i].t - pre[i - 1].t);
      if (pre[i].mode === 'video' && pre[i].ct === pre[i - 1].ct && pre[i].total === pre[i - 1].total) stuck++;
    }
  }
  const drops = pre.slice(1).map((s, i) => ({ t: s.t, d: s.dropped - pre[i].dropped, gap: s.t - pre[i].t })).filter((x) => x.d > 0);
  info(`${tag}: pre-warm ${w.prewarm ?? '?'} ms, ${pre.length} samples from the loop's first frame to the city's (largest main-thread gap ${Math.round(maxGap)} ms)${drops.length ? `; drops at ${drops.map((x) => `${Math.round(x.t)} ms +${x.d}`).join(', ')}` : ''}`);
  check(`1 ${tag}: the loop keeps playing through the load and pre-warm`, pre.length > 1 && rate > 0.85 && stuck === 0, `playback ${fmt(rate, 2)}× real time from video frame counts, ${stuck} frozen samples`);
  check(`1 ${tag}: few dropped video frames`, total > 0 && dropped / total < 0.05, `${dropped} dropped / ${total} frames (${startDrops} more at decoder start-up)`);
  const ys = loadShots.map((f) => ({ f, y: luma(f) }));
  const minY = ys.reduce((m, s) => (s.y < m.y ? s : m), { y: Infinity, f: '' });
  check(`1 ${tag}: no black screenshot during the load`, ys.length > 0 && minY.y >= BLACK_Y, `${ys.length} shots, min p90 luma ${fmt(minY.y)} (${base(minY.f)})`);
}

async function endChecks(page, tag, aspect, { series, vista }) {
  const ys = series.map((s) => ({ ...s, y: luma(s.f) }));
  const minY = ys.reduce((m, s) => (s.y < m.y ? s : m), { y: Infinity, f: '' });
  check(`3 ${tag}: no black frame through the swap and the fade`, ys.length > 3 && minY.y >= BLACK_Y, `${ys.length} shots from the first render to the end, min p90 luma ${fmt(minY.y)} at ${base(minY.f)}`);
  await sleep(1000);
  const end = await page.evaluate(() => {
    const cam = window.__camera, a = cam.position.clone(), b = cam.position.clone();
    window.__nav.samplePath(a, b);
    return {
      landed: document.documentElement.classList.contains('is-landed'), boot: !!document.getElementById('boot'), gate: !!document.getElementById('gate'),
      p: window.__nav.p, est: window.__nav.establish.city, dist: a.distanceTo(cam.position), fov: cam.fov, zoom: cam.zoom,
      hero: +getComputedStyle(document.getElementById('hero-copy')).opacity,
      label: document.querySelector('#hero-copy .neon-btn.primary')?.textContent, times: window.__landing.times,
    };
  });
  await page.screenshot({ path: `${SHOTS}/${tag}-landed.png` });
  const t = end.times;
  info(`${tag}: first render → arrival play ${fmt(t.arrivalPlay - t.ready, 0)} ms (loop at ${t.loopTimeAtArrival} s → cut at ${t.loopTimeAtCut} s), play → first frame ${fmt(t.arrivalFirstFrame - t.arrivalPlay, 0)} ms, → fade ${fmt(t.fadeStart - t.arrivalFirstFrame, 0)} ms, fade → landed ${fmt(t.landed - t.fadeStart, 0)} ms`);
  const dur = 5.033; // warp-loop duration (public/night/landing/manifest.json)
  const cutOff = Math.min(Math.abs(t.loopTimeAtCut - dur), Math.abs(t.loopTimeAtCut));
  check(`2 ${tag}: arrival starts after the first render, on the loop's wrap, with no second tap`, t.arrivalPlay >= t.ready && t.arrivalPlay - t.ready <= 6500 && cutOff <= 0.15 && t.landReason === 'ended',
    `play ${fmt(t.arrivalPlay - t.ready, 0)} ms after the first render, loop ${fmt(cutOff * 1000, 0)} ms from its wrap at the cut, reason ${t.landReason}`);
  check(`3 ${tag}: end state (is-landed, #boot and #gate removed, relabelled)`, end.landed && !end.boot && !end.gate && /Start the tour/.test(end.label || ''), `label "${end.label}"`);
  check(`3 ${tag}: camera on the vista's establishing pose`, end.p === end.est && end.dist < 2, `p ${end.p} (establish ${end.est}), ${fmt(end.dist, 2)} u from poseAt, fov ${fmt(end.fov)} zoom ${fmt(end.zoom, 2)}`);
  check(`3 ${tag}: hero card visible 1 s after landing`, end.hero > 0.9, `opacity ${fmt(end.hero, 2)}`);
  const s = vista ? ssimCity(vista, aspect, { blur: 1.5 }) : NaN;
  const raw = vista ? ssimCity(vista, aspect) : NaN, shifted = vista ? ssimCity(vista, aspect, { blur: 1.5, dx: aspect < 1 ? 8 : 24 }) : NaN;
  check(`3 ${tag}: live vista matches city.png${aspect < 1 ? ' (centre crop)' : ''}`, s >= 0.8,
    `SSIM ${fmt(s, 3)} (σ1.5 blur; unblurred ${fmt(raw, 3)}; control with the crop shifted 2 %: ${fmt(shifted, 3)}) — ${vista ? base(vista) : 'no shot'}`);
}

function gateChecks(tag, g, { pre, returning = false, gateMs = GATE_MS }) {
  check(`G ${tag}: gate open with "${pre}" pre-selected${returning ? ' (returning visitor)' : ''}`, g.open && g.pre === pre && g.primary === pre && g.focus === pre && g.returning === returning,
    `pre ${g.pre}, primary ${g.primary}, focus ${g.focus}, returning ${g.returning}`);
  check(`G ${tag}: interactive within ${gateMs} ms of navigation`, g.moduleReady <= gateMs, `inline handler by DOMContentLoaded ${g.dcl} ms, module handler ${g.moduleReady} ms, longest task in the first 3 s ${g.longest} ms`);
  check(`G ${tag}: no start() and no video playing behind the gate`, !g.started && !g.played && g.videos.every((v) => v.paused && v.t === 0 && !v.src), `started ${g.started}, played ${g.played}`);
}

const browser = await chromium.launch({ executablePath: exe, headless: true, args: ARGS });
try {
  // ---- ?flat: nothing from /night/landing/, no gate
  if (want('flat')) {
    console.log('\n== ?flat');
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    const w = watch(page, 'flat');
    await page.goto(url + '?flat', { waitUntil: 'load' });
    await sleep(3000);
    const s = await page.evaluate(() => ({ boot: !!document.getElementById('boot'), gate: !!document.getElementById('gate'), no3d: document.documentElement.classList.contains('no-3d') }));
    check('7 ?flat: no /night/landing/ requests', w.landing.length === 0, w.landing.join(', ') || '0 requests');
    check('7 ?flat: text page, no gate, no overlay', s.no3d && !s.boot && !s.gate);
    await ctx.close();
  }

  // ---- ?nolanding: straight into the city as before (probes)
  if (want('nolanding')) {
    console.log('\n== ?nolanding');
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    const w = watch(page, 'nolanding');
    await page.goto(url + '?nolanding', { waitUntil: 'commit' });
    const booted = await page.waitForSelector('html.is-booted', { timeout: 180_000 }).then(() => true, () => false);
    await sleep(1500);
    const s = await page.evaluate(() => ({ boot: !!document.getElementById('boot'), gate: !!document.getElementById('gate'), landed: document.documentElement.classList.contains('is-landed'), hero: +getComputedStyle(document.getElementById('hero-copy')).opacity }));
    check('G ?nolanding: no gate, boots straight into the city', booted && !s.gate && !s.boot && s.landed && s.hero > 0.9, `gate ${s.gate}, overlay ${s.boot}, hero ${fmt(s.hero, 2)}`);
    check('G ?nolanding: nothing from /night/landing/', w.landing.length === 0, w.landing.join(', ') || '0 requests');
    await ctx.close();
  }

  // ---- OS reduced motion: the reduced choice pre-selected; poster, no clips, the session flag on; a returning visit
  if (want('reduced')) {
    console.log('\n== reduced motion (OS preference, desktop)');
    const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: 'reduce' });
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const w = watch(page, 'reduced');
    const g = await gatePhase(page, 'reduced', { hold: 1500 });
    gateChecks('reduced', g, { pre: 'reduced' });
    await clickAt(page);
    await page.click('.gate-enter[data-choice="reduced"]');
    await sleep(1500);
    const early = await page.evaluate(() => {
      const b = document.getElementById('boot');
      return { mode: b.dataset.landing, src: b.querySelector('.warp-loop').getAttribute('src'), bg: getComputedStyle(b.querySelector('.boot-media')).backgroundImage,
        warp: getComputedStyle(b.querySelector('.boot-warp')).display, flag: window.__gate.reduced, cls: document.documentElement.classList.contains('reduce-motion') };
    });
    await page.screenshot({ path: `${SHOTS}/reduced-poster-midload.png` });
    const y = luma(`${SHOTS}/reduced-poster-midload.png`);
    check('6 reduced: poster + HUD, no video source, no CSS warp', early.mode === 'poster' && !early.src && /warp-poster\.jpg/.test(early.bg) && early.warp === 'none' && y >= BLACK_Y,
      `mode ${early.mode}, src ${early.src}, CSS warp ${early.warp}, p90 luma ${fmt(y)}`);
    check('6 reduced: session reduced-motion flag on', early.flag === true && early.cls, `reducedMotion ${early.flag}, html.reduce-motion ${early.cls}`);
    await page.waitForSelector('html.is-landed', { timeout: 180_000 }).catch(() => null);
    const t = await timesOf(page);
    const mp4 = w.landing.filter((u) => u.endsWith('.mp4'));
    check('6 reduced: poster crossfades straight to the vista', t.landReason === 'direct' && t.landed - t.ready < 1000, `reason ${t.landReason}, first render → landed ${fmt(t.landed - t.ready, 0)} ms`);
    check('6 reduced: no clip downloads or playback', mp4.length === 0, mp4.join(', ') || '0 mp4 requests');
    await sleep(800);
    await page.screenshot({ path: `${SHOTS}/reduced-landed.png` });
    // Returning visit (no OS preference now): the remembered reduced choice is still pre-selected, the notice collapsed.
    const ctx2 = await browser.newContext({ ...DESKTOP, storageState: await ctx.storageState() });
    await ctx2.addInitScript(INIT);
    const page2 = await ctx2.newPage();
    const g2 = await gatePhase(page2, 'returning', { hold: 800 });
    check('G returning visitor: remembered choice pre-selected, notice on one line', g2.pre === 'reduced' && g2.primary === 'reduced' && g2.returning && g2.focus === 'reduced',
      `pre ${g2.pre}, primary ${g2.primary}, returning ${g2.returning}`);
    await ctx2.close();
    check('reduced: no page errors', w.errors.length === 0, w.errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- desktop full motion: gate, loop through the load, auto arrival → vista; reload: frame times; reload: skip
  if (want('desktop')) {
    console.log('\n== desktop 1440×900, full motion');
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const w = watch(page, 'desktop');
    const g = await gatePhase(page, 'desktop');
    gateChecks('desktop', g, { pre: 'full' });
    const warmed = await page.evaluate(() => window.__landing.times);
    info(`desktop: behind the gate — clips as blobs by ${warmed.arrivalBlob ?? '?'} ms, scene prefetch done by ${await page.evaluate(() => window.__gate.times.prefetched ?? '?')} ms; landing requests ${w.landing.map((u, i) => `${u} (${w.landingTypes[i]})`).join(', ')}`);
    await clickAt(page);
    await page.click('.gate-enter[data-choice="full"]');
    const j = await journey(page, 'desktop', 1440 / 900);
    const samples = await page.evaluate(() => window.__lc.samples);
    loopChecks('desktop', samples, w, j.load);
    await endChecks(page, 'desktop', 1440 / 900, j);

    console.log('\n== desktop, returning visitor: frame times around the crossfade');
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => window.__gate?.times?.moduleReady != null, null, { timeout: 60_000 });
    await sleep(500);
    const g2 = await page.evaluate(() => ({ pre: document.getElementById('gate').dataset.pre, returning: document.getElementById('gate').classList.contains('is-returning') }));
    check('G desktop returning visitor: full motion pre-selected', g2.pre === 'full' && g2.returning, `pre ${g2.pre}, returning ${g2.returning}`);
    await page.click('.gate-enter[data-choice="full"]');
    await page.waitForSelector('html.is-booted', { timeout: 180_000 });
    await page.evaluate(() => window.__lcFrames(true));
    await page.waitForSelector('html.is-landed', { timeout: 30_000 });
    await sleep(2300);
    const frames = await page.evaluate(() => window.__lcFrames(false));
    let t = await timesOf(page);
    const dts = [];
    for (let i = 1; i < frames.length; i++) if (frames[i] >= t.fadeStart - 2000 && frames[i] <= t.fadeStart + 2000) dts.push(frames[i] - frames[i - 1]);
    const p95 = pct(dts, 0.95), max = Math.max(...dts);
    check('4 desktop: frame times ±2 s around the crossfade', dts.length > 60 && p95 < 25 && max <= 100,
      `${dts.length} frames, median ${fmt(pct(dts, 0.5))} ms, p95 ${fmt(p95)} ms, max ${fmt(max)} ms (reason ${t.landReason})`);

    console.log('\n== desktop: skip');
    await page.reload({ waitUntil: 'commit' });
    await page.waitForFunction(() => window.__gate?.times?.moduleReady != null, null, { timeout: 60_000 });
    await sleep(300);
    await page.click('.gate-enter[data-choice="full"]');
    const started = await page.waitForFunction(() => window.__landing.times.arrivalFirstFrame != null, null, { timeout: 180_000 }).then(() => true, () => false);
    await sleep(1000);
    await page.evaluate(() => { window.__pressAt = performance.now(); });
    await page.keyboard.press('Escape');
    await page.waitForSelector('html.is-landed', { timeout: 5000 }).catch(() => null);
    const sk = await page.evaluate(() => ({ at: window.__pressAt, t: window.__landing.times }));
    check('5 desktop: Esc 1 s into the arrival lands within 600 ms', started && sk.t.landReason === 'skip' && sk.t.landed - sk.at <= 600,
      `arrival started ${started}, reason ${sk.t.landReason}, Esc → is-landed ${fmt(sk.t.landed - sk.at, 0)} ms`);
    check('desktop: no page errors', w.errors.length === 0, w.errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- phone full motion with the iOS tilt stub
  if (want('phone')) {
    console.log('\n== phone 393×852 (touch, iOS tilt stub), full motion');
    const ctx = await browser.newContext(PHONE);
    await ctx.addInitScript(INIT);
    await ctx.addInitScript(TILT_STUB);
    const page = await ctx.newPage();
    const w = watch(page, 'phone');
    const g = await gatePhase(page, 'phone');
    gateChecks('phone', g, { pre: 'full', gateMs: 1500 });
    await clickAt(page);
    await page.tap('.gate-enter[data-choice="full"]');
    const j = await journey(page, 'phone', 393 / 852);
    const variant = w.landing.filter((u) => u.endsWith('.mp4'));
    check('phone: fetches only the phone variants', variant.length > 0 && variant.every((u) => /-p\.mp4/.test(u)), [...new Set(variant)].join(', '));
    const samples = await page.evaluate(() => window.__lc.samples);
    loopChecks('phone', samples, w, j.load);
    await endChecks(page, 'phone', 393 / 852, j);
    const tl = await page.evaluate(() => ({ req: window.__tiltReq, res: window.__tiltResAt, click: window.__clickAt, chip: document.querySelector('.hero-tilt')?.textContent, begin: window.__gate.times.chosen }));
    check('9 phone: tilt asked inside the Enter tap, before start(); main.ts adopts the answer', tl.req && !tl.req.started && Math.abs(tl.req.at - tl.begin) < 50 && /Tilt on/.test(tl.chip || ''),
      `request ${fmt(tl.req?.at - tl.begin, 0)} ms from the choice, start() running at the request: ${tl.req?.started}, chip "${tl.chip}"`);
    check('phone: no page errors', w.errors.length === 0, w.errors.slice(0, 3).join(' | '));
    await ctx.close();
  }

  // ---- slow network: the clips not warmed, Fast 3G from Enter → poster + CSS warp, and it still lands
  if (want('slow')) {
    console.log('\n== slow network (Fast 3G from Enter; warm-up fetches held)');
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const w = watch(page, 'slow');
    await page.route(/\/night\/landing\/.*\.mp4/, async (route) => { if (route.request().resourceType() === 'fetch') { await sleep(60_000); } await route.continue().catch(() => {}); });
    await gatePhase(page, 'slow', { hold: 1000, shot: false });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1024 * 1024) / 8 * 0.9, uploadThroughput: (750 * 1024) / 8 * 0.9, connectionType: 'cellular3g' });
    await page.click('.gate-enter[data-choice="full"]');
    await page.waitForFunction(() => document.getElementById('boot')?.dataset.landing === 'poster' && window.__landing.times.posterReason, null, { timeout: 12_000 }).catch(() => null);
    await sleep(600);
    const s = await page.evaluate(() => {
      const b = document.getElementById('boot');
      return { mode: b?.dataset.landing, src: b?.querySelector('.warp-loop').getAttribute('src'), reason: window.__landing.times.posterReason, at: performance.now() - 600, begin: window.__landing.times.begin,
        warp: document.getAnimations().filter((a) => a.animationName === 'warp-zoom' && a.playState === 'running').length };
    });
    await page.screenshot({ path: `${SHOTS}/slow-poster.png` });
    check('8 slow: poster + CSS warp', s.mode === 'poster' && !s.src && s.warp === 3, `mode ${s.mode}, poster because ${s.reason} (${fmt(s.at - s.begin, 0)} ms after Enter), ${s.warp} warp layers running`);
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.waitForSelector('html.is-landed', { timeout: 240_000 }).catch(() => null);
    const t = await timesOf(page);
    check('8 slow: lands with a straight crossfade', t.landed != null && t.landReason === 'direct', `reason ${t.landReason}, first render → landed ${fmt(t.landed - t.ready, 0)} ms`);
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await ctx.close();
  }

  // ---- the arrival clip held back: the landing gives up on it and crossfades
  if (want('delayed')) {
    console.log('\n== delayed arrival clip');
    const ctx = await browser.newContext(DESKTOP);
    await ctx.addInitScript(INIT);
    const page = await ctx.newPage();
    const w = watch(page, 'delayed');
    let held = 0;
    await page.route(/\/night\/landing\/warp-arrival(-p)?\.mp4/, async (route) => { held++; await sleep(60_000); await route.continue().catch(() => {}); });
    await gatePhase(page, 'delayed', { hold: 1000, shot: false });
    await page.click('.gate-enter[data-choice="full"]');
    await page.waitForSelector('html.is-booted', { timeout: 180_000 });
    const mode = (await state(page)).mode;
    await page.waitForSelector('html.is-landed', { timeout: 20_000 }).catch(() => null);
    const t = await timesOf(page);
    check('8 delayed arrival: still lands (crossfade after the wait)', mode === 'video' && t.landReason === 'direct' && t.landed - t.ready < 8000,
      `loop ${mode}, ${held} held request(s), reason ${t.landReason}, first render → landed ${fmt(t.landed - t.ready, 0)} ms`);
    await page.unrouteAll({ behavior: 'ignoreErrors' }).catch(() => {});
    await ctx.close();
  }
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? ' — failed: ' + failed.map((f) => f.name).join('; ') : ''}`);
process.exit(failed.length ? 1 : 0);

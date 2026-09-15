/**
 * "Warp to Neon Harbor": the `#boot` overlay (index.astro) between the gate (gate.ts) and the live city.
 *
 * Behind the gate nothing plays: `warm()` fetches the chosen variant's clips as blobs (desktop 16:9 or the phone
 * 9:16 crop). The gate's Enter calls `begin(full)`: full motion plays the looping light-speed clip (a muted <video>
 * keeps decoding while the shader pre-warm holds the main thread); reduced motion, data-saver, slower-than-4g links,
 * no H.264, a failed / stalled / late loop show the poster instead (+ a CSS warp unless reduced). When the first frame
 * is up (`boot.done` → `ready`), full motion waits for the loop's pass to end and cuts to the arrival on its first
 * frame (the arrival's first frame is the loop's first frame, its last the bay vista); ~0.35 s before its end the
 * overlay fades onto the live vista, which main.ts has been rendering underneath at ~4 fps at the clip's lens. The
 * poster crossfades straight to the vista. Esc / Space / Enter / a tap skips to the fade.
 * `data-landing`: pending (gate open) · poster · video · off (`?flat`, `?nolanding`, `?p=`: the plain boot screen).
 */
import { reducedMotion } from './palette';

const el = typeof document !== 'undefined' ? document.getElementById('boot') : null;
const loop = el?.querySelector<HTMLVideoElement>('.warp-loop') ?? null;
const arrival = el?.querySelector<HTMLVideoElement>('.warp-arrival') ?? null;
const sr = el?.querySelector<HTMLElement>('.boot-sr') ?? null;

/** ms: the loop must fire `playing` within this after Enter, or the poster takes over. */
const PLAY_MAX = 3000;
/** ms of buffering (network-sourced loop) before the poster takes over. */
const LOOP_STALL = 1200;
/** s: a streamed loop whose buffer ahead of the playhead drops under this before the file is in is on a link slower than
 *  its bitrate — it would freeze soon, so the poster takes over first. */
const MIN_AHEAD = 1.0;
/** ms after the first frame the arrival clip may still take to be ready before the overlay fades without it. */
const ARRIVAL_WAIT = 6000;
/** s before the arrival's end at which the overlay fade starts (the fade lands on the held vista). */
const END_EARLY = 0.35;
/** ms without `playing` after `waiting` before the arrival is abandoned for the crossfade. */
const STALL_MS = 600;
/** ms: the overlay's opacity transition (night.css `.boot.is-leaving`); the fallback timer adds 200. */
const FADE_MS = 450;
/** s: inside this much of the loop's end, the arrival's play() is timed off the clock (the frame callbacks are coarse
 *  while the city renders underneath) to land on the wrap, allowing LATENCY for play() → first frame from a blob. */
const PRE_ROLL = 0.6;
const LATENCY = 0.04;
/** ms: the arrival's first frame must show within this after play(). */
const FIRST_FRAME_MAX = 1200;

const enabled = !!el && !!el.dataset.landing && el.dataset.landing !== 'off';
const phone = typeof matchMedia !== 'undefined' && matchMedia('(max-width: 760px)').matches;
const conn = typeof navigator !== 'undefined' ? (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection : undefined;
/** Clips are allowed on this device and link (the full-motion choice still shows the poster otherwise). */
const canVideo = enabled && !conn?.saveData && (conn?.effectiveType ?? '4g') === '4g' && !!loop?.canPlayType('video/mp4; codecs="avc1.640028"');
const SFX = phone ? '-p' : '';
export const LANDING_SRC = { loop: `/night/landing/warp-loop${SFX}.mp4`, arrival: `/night/landing/warp-arrival${SFX}.mp4` };

type Rvfc = (cb: (now: number, meta: { mediaTime: number }) => void) => number;
/** Next presented video frame (rVFC) or the next animation frame: `cb(mediaTime)`. */
const onFrame = (v: HTMLVideoElement, cb: (mediaTime: number) => void) => {
  const r = (v as HTMLVideoElement & { requestVideoFrameCallback?: Rvfc }).requestVideoFrameCallback;
  if (r) r.call(v, (_, meta) => cb(meta.mediaTime));
  else requestAnimationFrame(() => cb(v.currentTime));
};
const store = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch { /* private mode */ } };

let covering = enabled;   // the overlay (or the gate over it) is still up
let arriving = false;     // the arrival is on screen or the fade began: render at full rate
let started = false;      // the arrival's play() was called
let leaving = false;      // the overlay fade has started
let begun = false, isReady = false;
let arrivalReady = false, arrivalFailed = false;
let onLand: (() => void) | null = null;
const times: Record<string, number | string> = {};
const mark = (k: string) => { times[k] ??= Math.round(performance.now()); };

// ---- clips as blobs (warm-up behind the gate, or from Enter)
const mkCtrl = () => (typeof AbortController !== 'undefined' ? new AbortController() : null);
const ctrls = { loop: mkCtrl(), arrival: mkCtrl() };
const abortAll = () => { ctrls.loop?.abort(); ctrls.arrival?.abort(); };
const blobUrls: string[] = [];
const got: { loop?: string } = {};
const inflight: { loop?: Promise<string | null>; arrival?: Promise<string | null> } = {};
const fetchBlob = (src: string, key: 'loop' | 'arrival') => inflight[key] ??= fetch(src, { signal: ctrls[key]?.signal })
  .then((r) => { if (!r.ok) throw new Error(`${r.status} ${src}`); return r.blob(); })
  .then((b) => { const u = URL.createObjectURL(b); blobUrls.push(u); mark(`${key}Blob`); if (key === 'loop') got.loop = u; return u; })
  .catch((e) => { if ((e as Error).name !== 'AbortError') console.warn('[landing] clip fetch failed', src, e); return null; });

/** Behind the gate (full motion pre-selected): fetch both clips so Enter starts instantly and the arrival is ready. */
function warm() {
  if (!canVideo || begun) return;
  mark('warm');
  fetchBlob(LANDING_SRC.loop, 'loop');
  fetchBlob(LANDING_SRC.arrival, 'arrival');
}

function prepareArrival() {
  if (!arrival) return;
  fetchBlob(LANDING_SRC.arrival, 'arrival').then((u) => {
    if (!u) { arrivalFailed = true; return; }
    if (leaving || !el?.isConnected) return;
    // loadeddata = first frame decoded. iOS may hold that back until play(); from a local blob metadata is close enough
    // there (the first-frame watchdog guards the swap).
    const ok = () => { if (!arrivalReady) { arrivalReady = true; mark('arrivalReady'); } };
    arrival.addEventListener('loadeddata', ok, { once: true });
    arrival.addEventListener('loadedmetadata', () => { if (/iP(hone|ad|od)/.test(navigator.userAgent)) ok(); }, { once: true });
    arrival.addEventListener('error', () => { arrivalFailed = true; }, { once: true });
    arrival.src = u;
    arrival.load();
  });
}

// ---- Enter
function toPoster(reason: string) {
  if (!el || !loop || el.dataset.landing === 'off' || leaving) return;
  times.posterReason ??= reason;
  el.dataset.landing = 'poster';
  if (loop.getAttribute('src')) { loop.pause(); loop.removeAttribute('src'); loop.load(); }
}

/** The gate's Enter (inside the click): show the overlay; full motion starts the loop. */
function begin(full: boolean) {
  if (!enabled || !el || begun) return;
  begun = true;
  mark('begin');
  times.choice = full ? 'full' : 'reduced';
  el.dataset.landing = 'poster';
  if (sr) sr.textContent = 'Loading Neon Harbor';
  if (!full || !canVideo || !loop) { if (!full) abortAll(); return; }
  // The warmed blob when it is in; otherwise stream the file (and drop the half-fetched blob rather than download twice).
  const src = got.loop ?? LANDING_SRC.loop;
  const streamed = !got.loop;
  if (streamed) ctrls.loop?.abort();
  let settled = false, stall: ReturnType<typeof setTimeout> | undefined;
  const late = setTimeout(() => { if (!settled) { settled = true; toPoster('late'); } }, PLAY_MAX);
  loop.addEventListener('playing', () => {
    clearTimeout(stall);
    if (settled) return;
    settled = true; clearTimeout(late);
    if (el.dataset.landing === 'poster') el.dataset.landing = 'video';
    mark('loopPlaying');
  });
  loop.addEventListener('waiting', () => {
    // A loop that keeps buffering would freeze on one frame: the poster reads better (a blob never buffers).
    if (!streamed || loop.readyState >= 4 || el.dataset.landing !== 'video') return;
    clearTimeout(stall); stall = setTimeout(() => toPoster('stall'), LOOP_STALL);
  });
  loop.addEventListener('error', () => { clearTimeout(late); settled = true; toPoster('error'); }, { once: true });
  if (streamed) {
    const watch = setInterval(() => {
      if (el.dataset.landing !== 'video' || leaving) { if (el.dataset.landing !== 'poster' || settled) clearInterval(watch); return; }
      const b = loop.buffered, end = b.length ? b.end(b.length - 1) : 0, dur = loop.duration;
      if (Number.isFinite(dur) && end >= dur - 0.1) return clearInterval(watch); // all in: loops from cache
      if (end - loop.currentTime < MIN_AHEAD) { clearInterval(watch); toPoster('slow'); }
    }, 500);
  }
  loop.src = src;
  loop.play().catch(() => { if (!settled) { settled = true; clearTimeout(late); toPoster('play-rejected'); } });
  prepareArrival();
}

// ---- first frame: auto-transition
async function ready() {
  if (!enabled || !el || isReady) return;
  isReady = true;
  mark('ready');
  addEventListener('keydown', onSkipKey, true);
  el.addEventListener('pointerdown', skip);
  if (el.dataset.landing !== 'video' || reducedMotion || !loop || !arrival) return land('direct');
  if (sr) sr.textContent = 'Dropping out of warp.';
  const t0 = performance.now();
  const dur = Number.isFinite(loop.duration) && loop.duration > 0 ? loop.duration : 5;
  let last = loop.currentTime;
  // Start the arrival just before the loop wraps: its first frame (= the loop's first frame) then replaces the wrap.
  const tick = (mt: number) => {
    if (leaving || started) return;
    if (el.dataset.landing !== 'video') return land('direct'); // the loop fell back to the poster
    const late = performance.now() - t0 > ARRIVAL_WAIT;
    if (arrivalFailed || (late && !arrivalReady)) return land('direct');
    const wrapped = mt < last - 0.5;
    last = mt;
    if (arrivalReady && (wrapped || mt >= dur - PRE_ROLL)) {
      const wait = wrapped ? 0 : Math.max(0, (dur - loop.currentTime - LATENCY) * 1000);
      setTimeout(() => playArrival(arrival, loop), wait);
      return;
    }
    onFrame(loop, tick);
  };
  onFrame(loop, tick);
  // rVFC stops with a paused / starved loop: don't wait on it forever.
  setTimeout(() => { if (!started && !leaving && !document.hidden) land('direct'); }, ARRIVAL_WAIT + (dur + 1) * 1000);
}

const onSkipKey = (e: KeyboardEvent) => {
  if (e.repeat || !(e.key === 'Escape' || e.code === 'Space' || e.key === 'Enter')) return;
  e.preventDefault();
  e.stopPropagation();
  skip();
};
function skip() { mark('skip'); land('skip'); }

let stall: ReturnType<typeof setTimeout> | undefined;
const onVis = () => {
  if (!arrival) return;
  if (document.hidden) arrival.pause();
  else land('hidden');
};

function playArrival(a: HTMLVideoElement, l: HTMLVideoElement) {
  if (leaving || started) return;
  started = true;
  const dur = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 5;
  document.addEventListener('visibilitychange', onVis);
  a.addEventListener('error', () => land('error'), { once: true });
  a.addEventListener('ended', () => land('ended'), { once: true });
  a.addEventListener('waiting', () => { clearTimeout(stall); stall = setTimeout(() => land('stall'), STALL_MS); });
  a.addEventListener('playing', () => clearTimeout(stall));
  if (a.currentTime !== 0) a.currentTime = 0;
  mark('arrivalPlay');
  times.loopTimeAtArrival = Math.round(l.currentTime * 1000) / 1000;
  const watchdog = setTimeout(() => { if (times.arrivalFirstFrame == null) land('noframe'); }, FIRST_FRAME_MAX);
  a.play().catch(() => land('play-rejected'));
  onFrame(a, () => {
    clearTimeout(watchdog);
    if (leaving) return;
    mark('arrivalFirstFrame');
    times.loopTimeAtCut = Math.round(l.currentTime * 1000) / 1000;
    a.classList.add('is-on', 'is-cut');
    l.pause();
    arriving = true; // full-rate render from here (the throttle kept the GPU for the decode until now)
    el?.classList.add('is-arriving');
    const poll = (mt: number) => {
      if (leaving) return;
      if (mt >= dur - END_EARLY) return land('ended');
      onFrame(a, poll);
    };
    onFrame(a, poll);
  });
}

// ---- fade the overlay onto the live vista
function land(reason: string) {
  if (leaving || !el) return;
  leaving = true;
  arriving = true;
  times.landReason = reason;
  mark('fadeStart');
  removeEventListener('keydown', onSkipKey, true);
  el.removeEventListener('pointerdown', skip);
  document.removeEventListener('visibilitychange', onVis);
  clearTimeout(stall);
  onLand?.();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    el.removeEventListener('transitionend', onEnd);
    for (const v of [loop, arrival]) { if (v) { v.pause(); v.removeAttribute('src'); v.load(); } }
    abortAll();
    for (const u of blobUrls) URL.revokeObjectURL(u);
    el.remove();
    covering = false;
    mark('landed');
    document.documentElement.classList.add('is-landed');
    store('nh-landed', '1');
    const hero = document.querySelector<HTMLAnchorElement>('#hero-copy .neon-btn.primary');
    if (hero) {
      hero.textContent = 'Start the tour →';
      hero.focus({ preventScroll: true });
    }
  };
  const onEnd = (e: TransitionEvent) => { if (e.target === el && e.propertyName === 'opacity') finish(); };
  el.addEventListener('transitionend', onEnd);
  setTimeout(finish, FADE_MS + 200);
  // Two frames so the class change lands after a style flush and the transition runs (not a jump).
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-leaving')));
}

export const landing = {
  enabled,
  canVideo,
  /** The overlay is still on screen (main.ts throttles the render and holds the landing lens). */
  get covering() { return covering; },
  /** The arrival (or the fade) is under way: render at full rate. */
  get arriving() { return arriving; },
  /** main.ts: put the camera on the vista's establishing pose when the fade starts. */
  configure(o: { onLand?: () => void }) { if (o.onLand) onLand = o.onLand; },
  warm,
  begin,
  /** boot.done(): the first frame is up. */
  ready,
  /** boot.fail(): stop the videos and downloads; boot shows the error and the text page takes over. */
  fail() {
    for (const v of [loop, arrival]) v?.pause();
    abortAll();
    covering = false;
  },
};

if (typeof window !== 'undefined') {
  (window as unknown as { __landing: unknown }).__landing = {
    enabled,
    canVideo,
    src: LANDING_SRC,
    times,
    get covering() { return covering; },
    get arriving() { return arriving; },
    get leaving() { return leaving; },
    get arrivalReady() { return arrivalReady; },
    get mode() { return el?.dataset.landing ?? 'gone'; },
    skip,
  };
}

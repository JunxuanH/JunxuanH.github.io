/**
 * "Warp to Neon Harbor": the `#boot` overlay (index.astro) between the gate (gate.ts) and the live city.
 *
 * Behind the gate nothing plays: `warm()` fetches the chosen variant's clips as blobs (desktop 16:9 or the phone
 * 9:16 crop). The gate shows the hovering car (hover.jpg). The gate's Enter calls `begin(full)`: full motion plays the
 * launch once (hover still → light speed; its last frame is the loop's first), cuts to the looping light-speed clip on
 * the launch's last presented frame (a muted <video> keeps decoding while the shader pre-warm holds the main thread);
 * reduced motion shows the hover still; data-saver, slower-than-4g links, no H.264, a failed / stalled / late loop show
 * the warp poster + a CSS warp. A launch that fails goes straight to the loop. When the first frame is up
 * (`boot.done` → `ready`), full motion waits for the loop's pass to end (or for the launch to finish, then goes
 * straight on) and cuts to the arrival on its first frame (the arrival's first frame is the loop's first frame, its
 * last the bay vista); ~0.35 s before its end the
 * overlay fades onto the live vista, which main.ts has been rendering underneath at ~4 fps at the clip's lens. The
 * poster crossfades straight to the vista. Esc / Space / Enter / a tap skips to the fade.
 * `data-landing`: pending (gate open) · poster · video · off (`?flat`, `?nolanding`, `?p=`: the plain boot screen).
 */
import { reducedMotion } from './palette';

const el = typeof document !== 'undefined' ? document.getElementById('boot') : null;
const loop = el?.querySelector<HTMLVideoElement>('.warp-loop') ?? null;
const launch = el?.querySelector<HTMLVideoElement>('.warp-launch') ?? null;
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
export const LANDING_SRC = { launch: `/night/landing/warp-launch${SFX}.mp4`, loop: `/night/landing/warp-loop${SFX}.mp4`, arrival: `/night/landing/warp-arrival${SFX}.mp4` };
/** s: a frame's duration in the 30 fps clips; a mediaTime within 1.5 frames of the end is the last frame. */
const FRAME = 1 / 30;

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
/** What is on screen after Enter: the launch clip, then the loop. */
let phase: 'none' | 'launch' | 'loop' = 'none';
let arrivalReady = false, arrivalFailed = false;
let onLand: (() => void) | null = null;
const times: Record<string, number | string> = {};
const mark = (k: string) => { times[k] ??= Math.round(performance.now()); };

// ---- clips as blobs (warm-up behind the gate, or from Enter)
const mkCtrl = () => (typeof AbortController !== 'undefined' ? new AbortController() : null);
type Clip = 'launch' | 'loop' | 'arrival';
const ctrls: Record<Clip, AbortController | null> = { launch: mkCtrl(), loop: mkCtrl(), arrival: mkCtrl() };
const abortAll = () => { for (const c of Object.values(ctrls)) c?.abort(); };
const blobUrls: string[] = [];
const got: Partial<Record<Clip, string>> = {};
const inflight: Partial<Record<Clip, Promise<string | null>>> = {};
const fetchBlob = (src: string, key: Clip) => inflight[key] ??= fetch(src, { signal: ctrls[key]?.signal })
  .then((r) => { if (!r.ok) throw new Error(`${r.status} ${src}`); return r.blob(); })
  .then((b) => { const u = URL.createObjectURL(b); blobUrls.push(u); mark(`${key}Blob`); got[key] = u; return u; })
  .catch((e) => { if ((e as Error).name !== 'AbortError') console.warn('[landing] clip fetch failed', src, e); return null; });

/** Behind the gate (full motion pre-selected): fetch both clips so Enter starts instantly and the arrival is ready. */
function warm() {
  if (!canVideo || begun) return;
  mark('warm');
  if (launch) fetchBlob(LANDING_SRC.launch, 'launch');
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
  el.dataset.poster = 'warp';
  for (const v of [launch, loop]) if (v?.getAttribute('src')) { v.pause(); v.classList.remove('is-on'); v.removeAttribute('src'); v.load(); }
  phase = 'loop';
}

/** The gate's Enter (inside the click): show the overlay; full motion plays the launch, then the loop. */
function begin(full: boolean) {
  if (!enabled || !el || begun) return;
  begun = true;
  mark('begin');
  times.choice = full ? 'full' : 'reduced';
  el.dataset.landing = 'poster';
  el.dataset.poster = full && !canVideo ? 'warp' : 'hover'; // the hover still (the launch's first frame) until a clip shows
  if (sr) sr.textContent = 'Loading Neon Harbor';
  if (!full || !canVideo || !loop) { if (!full) abortAll(); return; }
  prepareArrival();
  loadLoop(loop);
  if (launch) playLaunch(launch, loop);
  else playLoop(loop, null);
}

/** The warmed blob when it is in; otherwise stream the file (dropping the half-fetched blob rather than download twice). */
function srcOf(key: Clip) {
  const u = got[key];
  if (!u) ctrls[key]?.abort();
  return { src: u ?? LANDING_SRC[key], streamed: !u };
}

let loopStreamed = false;
/** Set the loop's source and decode its first frame (paused): it waits under the launch for the cut. */
function loadLoop(l: HTMLVideoElement) {
  const { src, streamed } = srcOf('loop');
  loopStreamed = streamed;
  l.preload = 'auto';
  l.addEventListener('error', () => toPoster('error'), { once: true });
  l.src = src;
  l.load();
}

/** Launch once; cut to the loop (or the arrival, when the city is already up) on its last presented frame. */
function playLaunch(v: HTMLVideoElement, l: HTMLVideoElement) {
  phase = 'launch';
  const { src, streamed } = srcOf('launch');
  let shown = false, stall: ReturnType<typeof setTimeout> | undefined;
  const skipLaunch = (reason: string) => {
    if (phase !== 'launch' || leaving) return;
    times.launchSkipped = reason;
    clearTimeout(late); clearTimeout(stall);
    v.pause();
    if (!shown) { v.removeAttribute('src'); v.load(); }
    phase = 'loop';
    playLoop(l, shown ? v : null);
  };
  const late = setTimeout(() => { if (!shown) skipLaunch('late'); }, PLAY_MAX);
  v.addEventListener('error', () => skipLaunch('error'), { once: true });
  v.addEventListener('waiting', () => { if (streamed && v.readyState < 4) { clearTimeout(stall); stall = setTimeout(() => skipLaunch('stall'), LOOP_STALL); } });
  v.addEventListener('playing', () => clearTimeout(stall));
  v.addEventListener('play', () => { times.launchPlays = (Number(times.launchPlays) || 0) + 1; });
  v.addEventListener('ended', () => launchDone(v, l), { once: true });
  v.src = src;
  mark('launchPlay');
  v.play().catch(() => skipLaunch('play-rejected'));
  onFrame(v, () => {
    if (phase !== 'launch' || leaving) return;
    shown = true;
    clearTimeout(late);
    mark('launchFirstFrame');
    v.classList.add('is-on');
    el!.dataset.landing = 'video';
    const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 3;
    const poll = (mt: number) => {
      if (phase !== 'launch' || leaving) return;
      if (mt >= dur - 1.5 * FRAME) return launchDone(v, l);
      onFrame(v, poll);
    };
    onFrame(v, poll);
  });
}

function launchDone(v: HTMLVideoElement, l: HTMLVideoElement) {
  if (phase !== 'launch' || leaving) return;
  phase = 'loop';
  mark('launchLastFrame');
  times.launchTimeAtEnd = Math.round(v.currentTime * 1000) / 1000;
  // The city finished during the launch: straight on to the arrival (its first frame is the launch's last too).
  if (isReady && arrivalReady && arrival) return playArrival(arrival, v);
  playLoop(l, v);
}

/** Start the loop; `from` (the launch, holding its last frame) is hidden once the loop's first frame is on screen. */
function playLoop(l: HTMLVideoElement, from: HTMLVideoElement | null) {
  phase = 'loop';
  const streamed = loopStreamed;
  let settled = false, stall: ReturnType<typeof setTimeout> | undefined;
  const late = setTimeout(() => { if (!settled) { settled = true; toPoster('late'); } }, PLAY_MAX);
  l.addEventListener('playing', () => {
    clearTimeout(stall);
    if (settled) return;
    settled = true; clearTimeout(late);
    if (el!.dataset.landing === 'poster') el!.dataset.landing = 'video';
    mark('loopPlaying');
  });
  l.addEventListener('waiting', () => {
    // A loop that keeps buffering would freeze on one frame: the poster reads better (a blob never buffers).
    if (!streamed || l.readyState >= 4 || el!.dataset.landing !== 'video') return;
    clearTimeout(stall); stall = setTimeout(() => toPoster('stall'), LOOP_STALL);
  });
  if (streamed) {
    const watch = setInterval(() => {
      if (el!.dataset.landing !== 'video' || leaving) { if (el!.dataset.landing !== 'poster' || settled) clearInterval(watch); return; }
      const b = l.buffered, end = b.length ? b.end(b.length - 1) : 0, dur = l.duration;
      if (Number.isFinite(dur) && end >= dur - 0.1) return clearInterval(watch); // all in: loops from cache
      if (end - l.currentTime < MIN_AHEAD) { clearInterval(watch); toPoster('slow'); }
    }, 500);
  }
  mark('loopPlay');
  l.play().catch(() => { if (!settled) { settled = true; clearTimeout(late); toPoster('play-rejected'); } });
  onFrame(l, () => {
    mark('loopFirstFrame');
    if (from && !leaving) {
      times.loopReadyAtCut = l.readyState;
      from.classList.remove('is-on');
      from.pause();
      mark('launchHidden');
    }
    if (isReady && !started && !leaving) waitForWrap(l);
  });
}

// ---- first frame: auto-transition
async function ready() {
  if (!enabled || !el || isReady) return;
  isReady = true;
  mark('ready');
  addEventListener('keydown', onSkipKey, true);
  el.addEventListener('pointerdown', skip);
  if (phase === 'launch' && !reducedMotion) { if (sr) sr.textContent = 'Dropping out of warp.'; return; } // launchDone goes on from here
  if (el.dataset.landing !== 'video' || reducedMotion || !loop || !arrival) return land('direct');
  if (sr) sr.textContent = 'Dropping out of warp.';
  waitForWrap(loop);
}

let waiting = false;
/** Start the arrival just before the loop wraps: its first frame (= the loop's first frame) then replaces the wrap. */
function waitForWrap(l: HTMLVideoElement) {
  if (waiting || !arrival || !el) return;
  waiting = true;
  const a = arrival;
  const t0 = performance.now();
  const dur = Number.isFinite(l.duration) && l.duration > 0 ? l.duration : 5;
  let last = l.currentTime;
  const tick = (mt: number) => {
    if (leaving || started) return;
    if (el.dataset.landing !== 'video') return land('direct'); // the loop fell back to the poster
    const late = performance.now() - t0 > ARRIVAL_WAIT;
    if (arrivalFailed || (late && !arrivalReady)) return land('direct');
    const wrapped = mt < last - 0.5;
    last = mt;
    if (arrivalReady && (wrapped || mt >= dur - PRE_ROLL)) {
      const wait = wrapped ? 0 : Math.max(0, (dur - l.currentTime - LATENCY) * 1000);
      setTimeout(() => playArrival(a, l), wait);
      return;
    }
    onFrame(l, tick);
  };
  onFrame(l, tick);
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
  times.arrivalFrom = l === loop ? 'loop' : 'launch';
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
    for (const v of [launch, loop, arrival]) { if (v) { v.pause(); v.removeAttribute('src'); v.load(); } }
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
  /**
   * Let the loading video breathe between blocking chunks of work (the shader pre-warm): resolves once the loop has
   * presented a new frame, or after `maxMs` when no video is playing / the frame never comes. Cheap no-op otherwise.
   */
  breathe(maxMs = 80): Promise<void> {
    const v = phase === 'launch' ? launch : loop;
    const playing = !!v && el?.dataset.landing === 'video' && !v.paused;
    if (!playing) return new Promise((r) => setTimeout(r, 0));
    return new Promise((r) => {
      let done = false;
      const finish = () => { if (!done) { done = true; r(); } };
      onFrame(v!, () => onFrame(v!, finish)); // two presented frames: the compositor really got a turn
      setTimeout(finish, maxMs);
    });
  },
  /** boot.done(): the first frame is up. */
  ready,
  /** boot.fail(): stop the videos and downloads; boot shows the error and the text page takes over. */
  fail() {
    for (const v of [launch, loop, arrival]) v?.pause();
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
    get phase() { return phase; },
    skip,
  };
}

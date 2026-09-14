/**
 * Generated video cutscenes. Each nav transition between two sections can be covered by a short clip (Kling O1,
 * first→last frame from the rail's establishing shots, see scripts/cutscene-*.{mjs,sh}) that plays in a fixed
 * layer over the canvas: nav.ts parks the camera on the source's wide shot while the clip loads (`establish`),
 * fades the video in, jumps the canvas to the destination's wide shot behind it, plays, and fades back (`cover`).
 * The clip's first and last frames are those two wide shots, so both crossfades land on the same picture.
 *
 * Desktop only: phones, lite tiers, reduced motion, `?nocine`, data-saver and slow connections never fetch a clip
 * (nav plays the 3D beats). Clips are fetched as blobs once per session (the four hops out of the current section,
 * two at a time) so a cover is ready within nav's 1.2 s establishing beat; an uncached hop still tries, and gives up
 * cleanly if the fetch does not make it in time.
 */
import { params, reducedMotion } from './palette';
import type { SectionId } from './journey';
import type { Cover, CoverResult } from './nav';

export interface ClipMeta { src: string; duration: number; bytes: number; sha: string; model?: string; request?: string; reverseOf?: string | null }
export interface Manifest { v: number; clips: Record<string, ClipMeta> }

const ORDER: SectionId[] = ['city', 'education', 'work', 'projects', 'contact'];
const MANIFEST = '/night/cutscenes/manifest.json';
/** ms: the CSS opacity transition is 250 ms; show/hide resolve on its `transitionend`, or on this timer if the event never comes. */
const FADE_MAX = 350;
/** ms: nav gives the cover CUT.establishMax (1.2 s) to become ready. */
const READY_MS = 1200;
/** ms without `playing` after `waiting` before the cover reports failure (the canvas is parked right behind it). */
const STALL_MS = 600;
/** s before the clip's end at which `play` resolves, so the 250 ms fade-out lands on the last frame. */
const END_EARLY = 0.3;
const PRELOAD_N = 4;
const CONCURRENCY = 2;

export const pairOf = (from: SectionId, to: SectionId) => `${from}-${to}`;
/** The hops out of `s`, loop-next first (city → education → work → projects → contact → city), then the rest in loop order. */
export const hopsFrom = (s: SectionId) => {
  const i = ORDER.indexOf(s);
  return [...ORDER.slice(i + 1), ...ORDER.slice(0, i)].slice(0, PRELOAD_N).map((o) => pairOf(s, o));
};

export function createCine({ lite, narrow }: { lite: boolean; narrow: boolean }) {
  const conn = (navigator as unknown as { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
  const probe = document.createElement('video');
  const enabled = !lite && !narrow && !reducedMotion && !params.has('nocine') && !conn?.saveData
    && (conn?.effectiveType ?? '4g') === '4g' && !!probe.canPlayType('video/mp4; codecs="avc1.640028"');

  let manifest: Manifest | null = null;
  let manifestP: Promise<Manifest | null> | null = null;
  const blobs = new Map<string, string>();                 // pair → blob: URL, for the session
  const inflight = new Map<string, Promise<string | null>>();
  let queue: string[] = [];
  let running = 0;
  let bytes = 0;
  let active = false;
  let wanted: SectionId | null = null;

  // ---- the layer (mounted up front so its opacity: 0 is laid out long before the first fade)
  let box: HTMLDivElement | null = null, video: HTMLVideoElement | null = null;
  if (enabled) {
    box = document.createElement('div');
    box.id = 'cine';
    box.setAttribute('aria-hidden', 'true');
    video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.preload = 'auto'; video.disablePictureInPicture = true;
    video.setAttribute('muted', ''); video.setAttribute('playsinline', ''); video.setAttribute('disablepictureinpicture', '');
    box.appendChild(video);
    document.body.appendChild(box);
  }

  // ---- manifest: after the first frame is up, when the main thread is idle (2 s at most)
  const idle = () => new Promise<void>((resolve) => {
    const go = () => {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => void }).requestIdleCallback;
      if (ric) ric(() => resolve(), { timeout: 2000 }); else setTimeout(resolve, 2000);
    };
    const tick = () => (document.documentElement.classList.contains('is-booted') ? go() : requestAnimationFrame(tick));
    tick();
  });
  const ensureManifest = () => manifestP ??= idle()
    .then(() => fetch(MANIFEST))
    .then((r) => (r.ok ? (r.json() as Promise<Manifest>) : null))
    .then((m) => { manifest = m && m.clips ? m : null; plan(); return manifest; })
    .catch(() => null);

  // ---- session cache: fetch → blob URL, two at a time
  const load = (pair: string): Promise<string | null> => {
    const hit = blobs.get(pair);
    if (hit) return Promise.resolve(hit);
    const inf = inflight.get(pair);
    if (inf) return inf;
    const meta = manifest?.clips[pair];
    if (!meta) return Promise.resolve(null);
    running++;
    const p = fetch(`${meta.src}?v=${meta.sha}`)
      .then((r) => { if (!r.ok) throw new Error(`${r.status} ${meta.src}`); return r.blob(); })
      .then((b) => { const u = URL.createObjectURL(b); blobs.set(pair, u); bytes += b.size; return u; })
      .catch(() => null)
      .finally(() => { running--; inflight.delete(pair); pump(); });
    inflight.set(pair, p);
    return p;
  };
  const pump = () => {
    while (running < CONCURRENCY && queue.length) {
      const pair = queue.shift()!;
      if (!blobs.has(pair) && !inflight.has(pair)) load(pair);
    }
  };
  const plan = () => {
    if (!manifest || !wanted) return;
    queue = hopsFrom(wanted).filter((p) => manifest!.clips[p] && !blobs.has(p) && !inflight.has(p));
    pump();
  };
  /** Warm the clips out of `section`: the next stop on the loop first, then the other three. */
  function preload(section: SectionId) {
    wanted = section;
    if (!enabled) return;
    if (manifest) plan(); else ensureManifest();
  }

  // ---- one cover
  function cover(from: SectionId, to: SectionId): Cover | null {
    if (!enabled || !manifest || active || document.hidden || from === to || !box || !video) return null;
    const pair = pairOf(from, to);
    const meta = manifest.clips[pair];
    if (!meta) return null;
    const v = video, layer = box;
    active = true;
    let shown = false, released = false, skipped = false;
    let settle: ((r: CoverResult) => void) | null = null;
    let stall: ReturnType<typeof setTimeout> | undefined;
    const listeners: [string, EventListener][] = [];
    const on = (name: string, fn: EventListener) => { v.addEventListener(name, fn); listeners.push([name, fn]); };
    const unlisten = () => {
      for (const [n, f] of listeners) v.removeEventListener(n, f);
      listeners.length = 0;
      document.removeEventListener('visibilitychange', onVis);
      clearTimeout(stall);
    };
    const onVis = () => { if (document.hidden) finish('failed'); };
    const finish = (r: CoverResult) => { const s = settle; settle = null; unlisten(); s?.(r); };
    /** Drop the clip and free the element (the blob stays cached for the session). */
    const release = () => {
      if (released) return;
      released = true;
      finish('failed');
      layer.classList.remove('is-on');
      v.pause();
      v.removeAttribute('src');
      v.load();
      active = false;
    };
    const duration = meta.duration;
    /** Toggle `.is-on` and resolve once the opacity transition has ended (nav jumps the canvas / releases the clip only then). */
    const fade = (on: boolean) => new Promise<void>((resolve) => {
      const opacity = () => Number(getComputedStyle(layer).opacity);
      if (layer.classList.contains('is-on') === on && (on ? opacity() >= 1 : opacity() <= 0)) return resolve();
      let done = false, timer: ReturnType<typeof setTimeout>;
      const end = () => { if (done) return; done = true; layer.removeEventListener('transitionend', onEnd); clearTimeout(timer); resolve(); };
      const onEnd = (e: Event) => { if (e.target === layer && (e as TransitionEvent).propertyName === 'opacity') end(); };
      layer.addEventListener('transitionend', onEnd);
      timer = setTimeout(end, FADE_MAX);
      layer.classList.toggle('is-on', on);
    });

    // Ready: the blob (cached, in flight, or fetched now) set as src and its first frame decoded, within READY_MS.
    const ready = (async () => {
      const t0 = performance.now();
      queue = queue.filter((p) => p !== pair);
      const url = await Promise.race([load(pair), new Promise<null>((r) => setTimeout(() => r(null), READY_MS))]);
      if (!url || released) return false;
      v.src = url;
      const left = Math.max(0, READY_MS - (performance.now() - t0));
      const ok = await new Promise<boolean>((resolve) => {
        if (v.readyState >= 2) return resolve(true);
        let timer: ReturnType<typeof setTimeout>;
        const done = (b: boolean) => { v.removeEventListener('loadeddata', yes); v.removeEventListener('error', no); clearTimeout(timer); resolve(b); };
        const yes = () => done(true), no = () => done(false);
        v.addEventListener('loadeddata', yes);
        v.addEventListener('error', no);
        timer = setTimeout(() => done(false), left);
      });
      return ok && !released;
    })();

    return {
      duration,
      ready,
      show: () => {
        if (released) return Promise.resolve();
        shown = true;
        return fade(true);
      },
      play: () => new Promise<CoverResult>((resolve) => {
        if (released) return resolve('failed');
        if (skipped) return resolve('skipped');
        settle = resolve;
        const dur = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : duration;
        on('error', () => finish('failed'));
        on('ended', () => finish('ended'));
        on('waiting', () => { clearTimeout(stall); stall = setTimeout(() => finish('failed'), STALL_MS); });
        on('playing', () => clearTimeout(stall));
        on('stalled', () => { if (stall === undefined) stall = setTimeout(() => finish('failed'), STALL_MS); });
        document.addEventListener('visibilitychange', onVis);
        const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
        const schedule = rvfc ? (cb: () => void) => { rvfc.call(v, cb); } : (cb: () => void) => { requestAnimationFrame(cb); };
        const poll = () => {
          if (!settle) return;
          if (v.currentTime >= dur - END_EARLY) return finish('ended');
          schedule(poll);
        };
        v.play().then(() => schedule(poll), () => finish('failed'));
      }),
      hide: () => {
        if (released) return Promise.resolve();
        if (settle) finish('skipped');
        if (!shown) { release(); return Promise.resolve(); }
        return fade(false).then(release); // the last 0.3 s keep playing under the fade
      },
      skip: () => { skipped = true; finish('skipped'); },
      dispose: () => {
        if (released) return;
        if (settle) finish('skipped');
        if (!shown) { release(); return; }
        v.pause();
        fade(false).then(release);
      },
    };
  }

  const cine = {
    enabled,
    cover,
    preload,
    get active() { return active; },
    get bytes() { return bytes; },
    get manifest() { return manifest; },
    cached: (pair: string) => blobs.has(pair),
  };
  (window as unknown as { __cine: unknown }).__cine = {
    enabled,
    cached: cine.cached,
    preload,
    get active() { return active; },
    get bytes() { return bytes; },
    get inflight() { return running; },
    get queued() { return queue.length; },
    get manifest() { return manifest; },
    get src() { return video?.currentSrc || video?.getAttribute('src') || ''; },
  };
  return cine;
}

export type Cine = ReturnType<typeof createCine>;

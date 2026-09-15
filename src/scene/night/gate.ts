/**
 * The landing gate (`#gate` in index.astro): a static page on first paint — name, title, résumé links, the
 * photosensitivity notice and two ways in, **Enter the city** / **Enter with reduced motion**. Nothing 3D runs behind
 * it: index.astro calls `start()` only once `wait()` resolves. Meanwhile the network warms up (the chosen variant's
 * warp clips as blobs, then the heaviest scene assets into the HTTP cache at low priority).
 *
 * The inline script right after the markup opens it before first paint (off for `?flat`, `?nolanding`, `?p=`), picks
 * the pre-selected choice (localStorage `nh-gate`, else the OS reduced-motion preference) and catches a click that lands
 * before this module has loaded (then the tilt prompt / audio unlock are skipped; the hero's tilt chip remains).
 * The click itself — one gesture — sets the session's reduced-motion flag, asks iOS for tilt, unlocks audio, starts the
 * warp loop (landing.ts) and the boot HUD, and closes the gate.
 */
import { setReducedMotion, reducedMotion } from './palette';
import { askTilt } from './main';
import { primeAudio } from './audio';
import { landing } from './landing';
import { boot } from './boot';

export type GateChoice = 'full' | 'reduced';
const STORAGE_KEY = 'nh-gate';

const el = typeof document !== 'undefined' ? document.getElementById('gate') : null;
const w = window as unknown as { __gateModule?: boolean; __gateChoice?: GateChoice; __gate?: unknown };
const early = w.__gateChoice; // chosen before this module loaded (the inline fallback)
const enabled = !!el && (el.dataset.state === 'open' || !!early);
w.__gateModule = true;

let chosen: GateChoice | null = null;
let resolveChoice: (c: GateChoice) => void = () => {};
const choice = new Promise<GateChoice>((r) => { resolveChoice = r; });
const times: Record<string, number> = { moduleReady: Math.round(performance.now()) };
const inertEls: HTMLElement[] = [];

function choose(c: GateChoice, gesture: boolean) {
  if (chosen || !el) return;
  chosen = c;
  times.chosen = Math.round(performance.now());
  setReducedMotion(c === 'reduced');
  try { localStorage.setItem(STORAGE_KEY, c); } catch { /* storage blocked */ }
  if (gesture) {
    void askTilt();   // synchronously in the gesture (iOS); main.ts adopts the answer
    primeAudio();
  }
  landing.begin(c === 'full');
  boot.begin();
  for (const n of inertEls) n.inert = false;
  el.dataset.state = 'closing';
  setTimeout(() => el.remove(), 350);
  resolveChoice(c);
}

/** Low-priority prefetch into the HTTP cache of what the build fetches first and heaviest (phones: the lite set). */
function prefetchScene() {
  const narrow = matchMedia('(max-width: 760px)').matches;
  const lite = (u: string) => (narrow ? u.replace('/night/', '/night-lite/') : u);
  const urls = [
    ...['asphalt', 'pavers', 'plaza', 'planks'].flatMap((n) => [lite(`/night/ground/${n}.jpg`), lite(`/night/ground/${n}-n.jpg`)]),
    lite('/night/facades/facade-mix.jpg'), lite('/night/facades/storefronts.jpg'), lite('/night/ads/screens-atlas.jpg'),
    ...['a', 'b', 'c', 'd'].map((t) => lite(`/night/models/tower-${t}.glb`)),
    ...['01', '02', '03', '04', '05', '06'].map((t) => `/night/models/tower-${t}.glb`),
    '/night/characters/soldier/meta.json', '/night/characters/soldier/rigged.glb',
  ];
  let i = 0, live = 0;
  const pump = () => {
    while (live < 3 && i < urls.length && !chosen) {
      live++;
      fetch(urls[i++], { priority: 'low' } as RequestInit).then((r) => r.arrayBuffer()).catch(() => null).finally(() => { live--; pump(); });
    }
    if (i >= urls.length) times.prefetched = Math.round(performance.now());
  };
  pump();
}

if (el && enabled) {
  if (early) choose(early, false);
  else {
    // Everything behind the gate is out of the tab order while it is open.
    for (let n = document.body.firstElementChild as HTMLElement | null; n; n = n.nextElementSibling as HTMLElement | null) {
      if (n !== el && n.tagName !== 'SCRIPT' && !n.inert) { n.inert = true; inertEls.push(n); }
    }
    el.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>('.gate-enter');
      if (b) choose(b.dataset.choice === 'reduced' ? 'reduced' : 'full', true);
    });
    const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection;
    if (el.dataset.pre === 'full') landing.warm();
    if (!conn?.saveData) {
      const ric = (window as unknown as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => void }).requestIdleCallback;
      if (ric) ric(prefetchScene, { timeout: 1500 }); else setTimeout(prefetchScene, 800);
    }
  }
}

export const gate = {
  enabled,
  /** Resolves with the visitor's choice once Enter was clicked (the choice is already applied). */
  wait: () => choice,
  get chosen() { return chosen; },
};
w.__gate = { enabled, times, get chosen() { return chosen; }, get reduced() { return reducedMotion; } };

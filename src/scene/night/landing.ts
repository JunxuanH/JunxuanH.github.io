/** Live-car loading overlay. The gate moves its canvas here on Enter; the first city frame starts a crossfade,
 * then the same GLB departs inside the world. No landing video downloads or decoder-dependent timing. */
import { reducedMotion } from './palette';

const el = typeof document !== 'undefined' ? document.getElementById('boot') : null;
const enabled = !!el?.dataset.landing && el.dataset.landing !== 'off';
let covering = enabled, arriving = false, leaving = false, begun = false;
let onLand: (() => void) | undefined;
let cleanup: (() => void) | undefined;
const times: Record<string, number | string> = {};

export const landing = {
  enabled,
  get covering() { return covering; },
  get arriving() { return arriving; },
  configure(o: { onLand?: () => void }) { onLand = o.onLand; },
  attachCar(dispose: () => void) { cleanup = dispose; },
  warm() {},
  begin(full: boolean) {
    if (!enabled || !el || begun) return;
    begun = true;
    times.begin = performance.now();
    times.choice = full ? 'full' : 'reduced';
    el.dataset.landing = 'live';
  },
  breathe(): Promise<void> { return new Promise((resolve) => setTimeout(resolve, 16)); },
  ready() {
    if (!enabled || !el || leaving) return;
    times.ready = performance.now();
    leaving = arriving = true;
    el.classList.add('is-arriving');
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-leaving')));
    setTimeout(() => {
      cleanup?.(); cleanup = undefined;
      el.remove(); covering = false;
      document.documentElement.classList.add('is-landed');
      times.landed = performance.now();
      try { sessionStorage.setItem('nh-landed', '1'); } catch { /* private mode */ }
      onLand?.();
      const hero = document.querySelector<HTMLAnchorElement>('#hero-copy .neon-btn.primary');
      if (hero) { hero.textContent = 'Start the tour →'; hero.focus({ preventScroll: true }); }
    }, reducedMotion ? 0 : 500);
  },
  fail() { cleanup?.(); cleanup = undefined; covering = false; },
};
if (typeof window !== 'undefined') (window as any).__landing = {
  enabled, times,
  get covering() { return covering; }, get arriving() { return arriving; },
  get leaving() { return leaving; }, get mode() { return el?.isConnected ? el.dataset.landing : 'gone'; },
};

/**
 * Boot screen: the `#boot` overlay in index.astro is visible from first paint; main.ts reports
 * milestones (`phase`) while it builds the city, three's DefaultLoadingManager nudges the bar
 * between them, and `done()` hands the overlay to the landing (landing.ts: the hovercar crossfades onto the live vista)
 * after the first rendered frame — or, with the landing off (`?nolanding`, `?p=`), glitches it away.
 * Every method is a no-op when the overlay is absent (lab pages, flat page).
 */
import * as THREE from 'three/webgpu';
import { landing } from './landing';
import { reducedMotion } from './palette';

const el = typeof document !== 'undefined' ? document.getElementById('boot') : null;
const bar = el?.querySelector<HTMLElement>('.boot-bar i') ?? null;
const pct = el?.querySelector<HTMLElement>('.boot-pct') ?? null;
const log = el?.querySelector<HTMLElement>('.boot-log') ?? null;
const sr = el?.querySelector<HTMLElement>('.boot-sr') ?? null; // the polite live region (the visual log is aria-hidden)

let target = 0;      // last milestone
let shown = bar ? parseFloat(bar.style.width || '0') / 100 : 0; // continue from the inline pre-script's value
if (bar) bar.dataset.owned = '1';
let loaded = 0, total = 0;
let finished = false;
let raf = 0;

function paint() {
  if (!bar || !pct) return;
  // Creep toward the next milestone using the loader's item count so the bar never sits still.
  const within = total > 0 ? loaded / total : 0;
  // Asset completion is not shader completion. Reserve the final portion for actual warm-up milestones.
  const goal = finished ? 1 : target >= .86 ? target : Math.min(target + 0.03 + within * 0.1, .85);
  shown = Math.max(shown, Math.min(goal, shown + (goal - shown) * (reducedMotion ? 1 : 0.06)));
  bar.style.width = `${(shown * 100).toFixed(1)}%`;
  pct.textContent = `${Math.round(shown * 100).toString().padStart(2, '0')}%`;
  if (!finished || shown < 0.999) raf = requestAnimationFrame(paint);
}

if (el) {
  const m = THREE.DefaultLoadingManager;
  const prevProgress = m.onProgress;
  m.onProgress = (url, l, t) => { loaded = l; total = t; prevProgress?.(url, l, t); };
}
let begun = false;

export const boot = {
  /** The load starts (right away with the landing off, on the gate's Enter otherwise): run the bar. */
  begin() {
    if (!el || begun) return;
    begun = true;
    shown = bar ? parseFloat(bar.style.width || '0') / 100 : 0;
    raf = requestAnimationFrame(paint);
  },
  /** A milestone: `label` is what is being built now, `f` the overall fraction reached. */
  phase(label: string, f: number) {
    if (!el) return;
    target = Math.max(target, f);
    if (log) {
      log.lastElementChild?.classList.remove('is-live');
      const li = document.createElement('li');
      li.className = 'is-live';
      li.textContent = label;
      log.appendChild(li);
      while (log.children.length > 6) log.removeChild(log.firstElementChild!);
    }
    if (sr) sr.textContent = `Loading Neon Harbor: ${label}`;
  },
  /** Within-stage progress without repeating announcements to screen readers. */
  progress(f: number) { target = Math.max(target, Math.min(.97, f)); },
  /** First frame is on screen: fill the bar; the landing takes the overlay from here (or it glitches out and goes). */
  done() {
    if (!el || finished) return;
    finished = true;
    log?.lastElementChild?.classList.remove('is-live');
    document.documentElement.classList.add('is-booted'); // the inline boot-bar script and probes wait for this
    el.setAttribute('aria-busy', 'false');
    if (landing.enabled) { landing.ready(); return; }
    el.classList.add('is-done');
    setTimeout(() => { el.remove(); cancelAnimationFrame(raf); document.documentElement.classList.add('is-landed'); }, reducedMotion ? 0 : 700);
  },
  /** The scene could not start: say so and point at the flat page (index.astro switches to it). */
  fail(message = 'render failed') {
    if (!el) return;
    finished = true;
    landing.fail();
    el.classList.add('is-failed');
    const m = el.querySelector<HTMLElement>('.boot-msg');
    if (m) m.textContent = `${message} — loading the text version`;
    setTimeout(() => { el.remove(); cancelAnimationFrame(raf); }, 1200);
  },
  /** Flat page / no scene: drop the overlay immediately. */
  hide() {
    el?.remove();
    cancelAnimationFrame(raf);
  },
};

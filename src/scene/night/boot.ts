/**
 * Boot screen: the `#boot` overlay in index.astro is visible from first paint; main.ts reports
 * milestones (`phase`) while it builds the city, three's DefaultLoadingManager nudges the bar
 * between them, and `done()` glitches the overlay away after the first rendered frame.
 * Every method is a no-op when the overlay is absent (lab pages, flat page).
 */
import * as THREE from 'three/webgpu';

const el = typeof document !== 'undefined' ? document.getElementById('boot') : null;
const bar = el?.querySelector<HTMLElement>('.boot-bar i') ?? null;
const pct = el?.querySelector<HTMLElement>('.boot-pct') ?? null;
const log = el?.querySelector<HTMLElement>('.boot-log') ?? null;
const reduced = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  const goal = finished ? 1 : Math.min(target + 0.06 + within * 0.04, 0.985);
  shown = Math.max(shown, Math.min(goal, shown + (goal - shown) * (reduced ? 1 : 0.06)));
  bar.style.width = `${(shown * 100).toFixed(1)}%`;
  pct.textContent = `${Math.round(shown * 100).toString().padStart(2, '0')}%`;
  if (!finished || shown < 0.999) raf = requestAnimationFrame(paint);
}

if (el) {
  const m = THREE.DefaultLoadingManager;
  const prevProgress = m.onProgress;
  m.onProgress = (url, l, t) => { loaded = l; total = t; prevProgress?.(url, l, t); };
  raf = requestAnimationFrame(paint);
  // The escape hatch shows itself after a few seconds; on phones it is on from the start.
  setTimeout(() => el.classList.add('is-slow'), 6000);
}

export const boot = {
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
  },
  /** First frame is on screen: fill the bar, glitch out, remove. */
  done() {
    if (!el || finished) return;
    finished = true;
    log?.lastElementChild?.classList.remove('is-live');
    el.classList.add('is-done');
    document.documentElement.classList.add('is-booted');
    el.setAttribute('aria-busy', 'false');
    setTimeout(() => { el.remove(); cancelAnimationFrame(raf); }, reduced ? 0 : 700);
  },
  /** The scene could not start: say so and point at the flat page (index.astro switches to it). */
  fail(message = 'render failed') {
    if (!el) return;
    finished = true;
    el.classList.add('is-failed');
    const m = el.querySelector<HTMLElement>('.boot-msg');
    if (m) m.textContent = `${message} — loading the text version`;
    setTimeout(() => { el.remove(); cancelAnimationFrame(raf); }, 1200);
  },
  /** Show the skip link now (the shader pre-warm can hold the main thread for seconds at a time). */
  allowSkip() { el?.classList.add('is-slow'); },
  /** Flat page / no scene: drop the overlay immediately. */
  hide() {
    el?.remove();
    cancelAnimationFrame(raf);
  },
};

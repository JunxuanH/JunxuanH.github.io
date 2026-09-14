/**
 * Small helpers shared by the carriers' dock-mode interactions (`Carrier.interact`, see index.ts): the key → action
 * mapping, the `.is-sel` cursor, the one-line hint that hangs under the docked slab, and the glitch veil (a child
 * whose clip-path animates, so the slab itself never gets a transform / opacity / filter — CSS3DRenderer owns those).
 * Styles: styles/carriers/interact.css.
 */
import type { Carrier } from './index';

export type DockActions = NonNullable<NonNullable<Carrier['interact']>['actions']>;

/** ↑ ↓ ← → Enter / E → the matching action; true when one ran (key repeats never re-fire `confirm`). */
export function keyToAction(e: KeyboardEvent, a: DockActions): boolean {
  const confirm = e.key === 'Enter' || e.code === 'KeyE';
  const fn = e.key === 'ArrowUp' ? a.up : e.key === 'ArrowDown' ? a.down : e.key === 'ArrowLeft' ? a.left : e.key === 'ArrowRight' ? a.right : confirm ? a.confirm : undefined;
  if (!fn) return false;
  if (!(confirm && e.repeat)) fn();
  return true;
}

/** Move the `.is-sel` cursor to row `i` (−1 clears it). */
export function setSel(rows: HTMLElement[], i: number) {
  rows.forEach((r, k) => r.classList.toggle('is-sel', k === i));
}

/** One-line control hint under the slab; `html` may carry <kbd> tags (static strings only). */
export function hint(el: HTMLElement, html: string) {
  let h = el.querySelector<HTMLElement>(':scope > .dock-hint');
  if (!h) { h = document.createElement('div'); h.className = 'dock-hint'; h.setAttribute('aria-hidden', 'true'); el.appendChild(h); }
  h.innerHTML = html;
  return h;
}
export function clearHint(el: HTMLElement) {
  el.querySelector(':scope > .dock-hint')?.remove();
}

/** Re-run a CSS animation bound to `cls` on `el` (remove → reflow → add). */
export function retrigger(el: HTMLElement, cls: string) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/**
 * Glitch: the slab gets `is-glitch` and a `.dock-veil` child whose clip-path bands animate (interact.css picks the
 * look per carrier); both go away when the animation ends.
 */
export function glitch(el: HTMLElement) {
  let veil = el.querySelector<HTMLElement>(':scope > .dock-veil');
  if (!veil) { veil = document.createElement('div'); veil.className = 'dock-veil'; veil.setAttribute('aria-hidden', 'true'); el.appendChild(veil); }
  const done = () => { el.classList.remove('is-glitch'); veil?.remove(); };
  veil.addEventListener('animationend', done, { once: true });
  retrigger(el, 'is-glitch');
  // Reduced motion (or no animation defined): drop the veil on the next frame instead of waiting forever.
  requestAnimationFrame(() => { if (veil && getComputedStyle(veil).animationName === 'none') done(); });
}
export function clearGlitch(el: HTMLElement) {
  el.classList.remove('is-glitch');
  el.querySelector(':scope > .dock-veil')?.remove();
}

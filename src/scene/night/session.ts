/**
 * The dock overlay: a 2D "terminal session" (index.astro `<aside class="sheet">`, styles/carriers/terminal-ui.css)
 * with the same chrome for every section on every device — header `NEON HARBOR // <node> — <section>`, the section's
 * own DOM element as the body, key hints in the footer (desktop; the HUD chip bar covers phones). Every `[data-slab]`
 * element is adopted into the body at start (hidden) and the docked one is shown with a CRT switch-on and a typed
 * reveal. Desktop: centred over the dimmed city; phones: a bottom panel — hud.ts measures this element's height
 * (`.sheet` → `--sheet-h`) to park the chip bar on its top edge, so the container keeps that class.
 */
import { reducedMotion } from './palette';

/** Elements that type in, in document order (`--i` staggers them; terminal-ui.css caps the delay). */
const LINES = '.kicker, h2, .meta > span, .team, h3, .bullets li, .chips li, .lede, .actions a, .card, .term-tabs li, .sys > div, .sys-note, .ad-brand, .ad-line';

export function createSession() {
  const sheet = document.querySelector<HTMLElement>('.sheet');
  const q = <T extends HTMLElement>(sel: string) => sheet?.querySelector<T>(sel) ?? null;
  const body = q('.term-body'), node = q('.term-node'), tty = q('.term-tty');
  let shown: HTMLElement | null = null;

  /** Move a section element into the overlay body, hidden until docked. */
  const adopt = (el: HTMLElement) => { (body ?? sheet)?.appendChild(el); el.hidden = true; };

  function open(el: HTMLElement, meta: { node: string; section: string; index: number }) {
    if (!sheet) return;
    if (shown && shown !== el) shown.hidden = true;
    shown = el;
    if (node) node.textContent = `NEON HARBOR // ${meta.node} — ${meta.section}`.toUpperCase();
    if (tty) tty.textContent = `TTY0${meta.index + 1}`;
    el.querySelectorAll<HTMLElement>(LINES).forEach((n, i) => n.style.setProperty('--i', String(i)));
    el.hidden = false;
    sheet.hidden = false;
    sheet.scrollTop = 0;
    sheet.classList.remove('is-on');
    if (!reducedMotion) { void sheet.offsetWidth; sheet.classList.add('is-on'); }
  }
  function close() {
    if (!sheet) return;
    if (shown) shown.hidden = true;
    shown = null;
    sheet.classList.remove('is-on');
    sheet.hidden = true;
  }
  /** Keep the cursor row (or the line an action just typed / the open project) in view. */
  function reveal() {
    if (!sheet || sheet.hidden) return;
    const t = sheet.querySelector<HTMLElement>('.term-out.is-typing') ?? sheet.querySelector<HTMLElement>('.card.is-open') ?? sheet.querySelector<HTMLElement>('.is-sel');
    t?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  }

  return { el: sheet, adopt, open, close, reveal, get shown() { return shown; } };
}

export type Session = ReturnType<typeof createSession>;

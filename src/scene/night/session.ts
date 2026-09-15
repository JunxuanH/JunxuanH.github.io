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
  let returnFocus: HTMLElement | null = null;
  const jobs: HTMLElement[] = [];
  const workTabs = document.createElement('nav');
  workTabs.className = 'terminal-employers'; workTabs.setAttribute('aria-label', 'Work experience'); workTabs.hidden = true;
  body?.before(workTabs);
  const selectJob = (el: HTMLElement) => {
    if (shown) shown.hidden = true;
    shown = el; el.hidden = false;
    workTabs.querySelectorAll<HTMLButtonElement>('button').forEach((button, i) => button.setAttribute('aria-pressed', String(jobs[i] === el)));
    if (sheet) sheet.scrollTop = 0;
  };

  /** Move a section element into the overlay body, hidden until docked. */
  const adopt = (el: HTMLElement) => {
    (body ?? sheet)?.appendChild(el); el.hidden = true;
    if (el.classList.contains('job')) {
      jobs.push(el);
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = el.querySelector('.kicker')?.textContent ?? 'Experience';
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => selectJob(el)); workTabs.append(button);
    }
    for (const row of el.querySelectorAll<HTMLElement>('[data-detail]')) {
      const detail = document.createElement('details'); const summary = document.createElement('summary');
      summary.textContent = row.textContent; const text = document.createElement('p'); text.textContent = row.dataset.detail ?? '';
      detail.append(summary, text); row.replaceChildren(detail);
    }
    for (const card of el.querySelectorAll<HTMLElement>('.card')) {
      card.removeAttribute('tabindex');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'terminal-project-toggle';
      const name = card.querySelector('h3')?.firstChild?.textContent?.trim() ?? 'project';
      button.textContent = `View ${name}`; button.setAttribute('aria-expanded', 'false');
      button.addEventListener('click', () => {
        const open = card.classList.toggle('is-open'); button.setAttribute('aria-expanded', String(open));
        button.textContent = open ? 'Close project details' : `View ${name}`;
      });
      card.append(button);
    }
  };

  function open(el: HTMLElement, meta: { node: string; section: string; index: number }) {
    if (!sheet) return;
    returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (shown && shown !== el) shown.hidden = true;
    shown = el;
    if (node) node.textContent = `NEON HARBOR // ${meta.node}${jobs.includes(el) ? '' : ` — ${meta.section}`}`.toUpperCase();
    if (tty) tty.textContent = `TTY0${meta.index + 1}`;
    el.querySelectorAll<HTMLElement>(LINES).forEach((n, i) => n.style.setProperty('--i', String(i)));
    el.hidden = false;
    workTabs.hidden = !jobs.includes(el);
    if (jobs.includes(el)) selectJob(el);
    sheet.hidden = false;
    sheet.scrollTop = 0;
    sheet.classList.remove('is-on');
    if (!reducedMotion) { void sheet.offsetWidth; sheet.classList.add('is-on'); }
    sheet.tabIndex = -1; sheet.focus({ preventScroll: true });
  }
  function close() {
    if (!sheet) return;
    if (shown) shown.hidden = true;
    shown = null;
    sheet.classList.remove('is-on');
    sheet.hidden = true;
    workTabs.hidden = true;
    returnFocus?.focus({ preventScroll: true }); returnFocus = null;
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

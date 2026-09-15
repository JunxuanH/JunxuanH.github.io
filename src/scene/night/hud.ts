/**
 * Walk-mode HUD (DOM in index.astro, styles in styles/hud.css): the interaction prompt pill, the controls
 * hint shown on the first walk, the "Back" chip in dock mode, the section title toast on arrival, and the
 * touch controls (joystick zone, run / E buttons) that only appear for coarse pointers. `data-mode` on the
 * root and on <html> gates everything in CSS.
 *
 * Phones: the prompt pill becomes a label on the E button (which pulses), and in dock mode a chip bar
 * (▲ ▼ ◀ ▶ ✓) sits on the top edge of the bottom sheet and drives the docked carrier's `interact.actions`
 * (content.ts announces them with the `nh:dock` / `nh:undock` events). The sheet's and the nav's measured
 * edges are published as `--sheet-h` / `--nav-b` on the root so the CSS can stack chips, toast and hint
 * around them.
 *
 * Transition cutscenes (nav.ts beats → `cutscene`): letterbox bars slide in for the move and the arrival hold,
 * a "Skip ▸" chip (bottom right, a second in; a button on touch) appears while the move can be cut short, and
 * under reduced motion a black overlay fades through instead of any camera motion. `is-cutscene` on the root
 * and `data-cutscene` on <html> let the CSS dim the nav (it floats over the top bar and stays clickable).
 */
import type { Mode, CutsceneState } from './nav';
import { reducedMotion } from './palette';
import type { DockActions } from './carriers/dock';

const HINT_KEY = 'nh-hint-seen';
/** Document events from content.ts: detail `{ id, actions }` on dock; nothing on undock. */
export const DOCK_EVENT = 'nh:dock', UNDOCK_EVENT = 'nh:undock';
export interface DockEventDetail { id: string; actions: DockActions | null }
const CHIP_KEYS: (keyof DockActions)[] = ['up', 'down', 'left', 'right', 'confirm'];
/** Touch label budget: ellipsis beyond 22 characters, cut on a word when that keeps most of it. */
const LABEL_MAX = 22;
const short = (s: string) => {
  if (s.length <= LABEL_MAX) return s;
  const cut = s.slice(0, LABEL_MAX - 1), sp = cut.lastIndexOf(' ');
  return (sp >= LABEL_MAX - 9 ? cut.slice(0, sp) : cut).trimEnd() + '…';
};

export function createHud() {
  const el = document.getElementById('hud');
  const q = <T extends HTMLElement>(sel: string) => el?.querySelector<T>(sel) ?? null;
  const prompt = q('.hud-prompt'), promptKey = q('.hud-prompt kbd'), promptLabel = q('.hud-prompt-label');
  const hint = q('.hud-hint');
  const backBtn = q<HTMLButtonElement>('.hud-back');
  const toastEl = q('.hud-toast'), toastName = q('.hud-toast-name'), toastSub = q('.hud-toast-sub');
  const eBtn = q<HTMLButtonElement>('.hud-btn-e'), eLabel = q('.hud-elabel');
  const chips = q('.hud-chips');
  const bars = q('.hud-bars'), skipBtn = q<HTMLButtonElement>('.hud-skip'), fadeEl = q('.hud-fade');
  const sheet = document.querySelector<HTMLElement>('.sheet');
  const navEl = document.querySelector<HTMLElement>('.nav');
  const coarse = matchMedia('(pointer: coarse)').matches;
  let hintTimer = 0, toastTimer = 0;
  let mode: Mode = 'ride';
  let promptText: string | null = null;
  let actions: DockActions | null = null;

  const setMode = (m: Mode) => {
    mode = m;
    if (el) el.dataset.mode = m;
    document.documentElement.dataset.mode = m;
    if (backBtn) backBtn.hidden = m !== 'dock';
    if (m !== 'walk') showPrompt(null);
    if (m !== 'dock') setActions(null);
    if (m !== 'walk') hideHint();
  };

  function showPrompt(label: string | null, key = coarse ? 'TAP' : 'E') {
    if (label === promptText && (!label || promptKey?.textContent === key)) return;
    promptText = label;
    // Touch: the label rides on the E button, which pulses while something is in range.
    if (eBtn) eBtn.classList.toggle('is-hot', !!label);
    if (eLabel) { eLabel.textContent = label ? short(label) : ''; eLabel.classList.toggle('is-on', !!label); }
    if (!prompt) return;
    if (!label) { prompt.classList.remove('is-on'); prompt.hidden = true; return; }
    if (promptLabel) promptLabel.textContent = label;
    if (promptKey) promptKey.textContent = key;
    prompt.hidden = false;
    prompt.classList.remove('is-on'); void prompt.offsetWidth; prompt.classList.add('is-on');
  }

  /** Controls card, once per visitor (localStorage), auto-hides after 6 s. */
  function showHintOnce() {
    if (!hint) return;
    try { if (localStorage.getItem(HINT_KEY)) return; } catch { /* storage blocked */ }
    hint.hidden = false;
    hint.classList.add('is-on');
    clearTimeout(hintTimer);
    hintTimer = window.setTimeout(hideHint, 6000);
  }
  function hideHint() {
    if (!hint || hint.hidden) return;
    hint.classList.remove('is-on');
    hint.hidden = true;
    try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
  }

  /** Section title on arrival: "CAMPUS · EDUCATION". */
  function toast(name: string, sub: string) {
    if (!toastEl) return;
    if (toastName) toastName.textContent = name;
    if (toastSub) toastSub.textContent = sub;
    toastEl.hidden = false;
    toastEl.classList.remove('is-on'); void toastEl.offsetWidth; toastEl.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { toastEl.classList.remove('is-on'); toastEl.hidden = true; }, 2800);
  }

  const onBack = (cb: () => void) => backBtn?.addEventListener('click', cb);

  // ---- transition cutscene chrome (nav.ts calls this on every beat change, null when the cutscene ends)
  function cutscene(state: CutsceneState | null) {
    const beat = state?.beat ?? null;
    const on = beat === 'establish' || beat === 'cover' || beat === 'depart' || beat === 'travel' || beat === 'glide' || beat === 'hold' || beat === 'fade';
    el?.classList.toggle('is-cutscene', on);
    if (on) document.documentElement.setAttribute('data-cutscene', beat!); else document.documentElement.removeAttribute('data-cutscene');
    bars?.classList.toggle('is-on', on && beat !== 'fade');
    // The skip chip: while the move can still be cut short (the CSS delays its fade-in by a second); never under reduced motion.
    skipBtn?.classList.toggle('is-on', !reducedMotion && (beat === 'establish' || beat === 'cover' || beat === 'depart' || beat === 'travel'));
    fadeEl?.classList.toggle('is-on', beat === 'fade');
  }
  // Native click covers touch, mouse, Enter, Space, and assistive-technology activation.
  const onSkip = (cb: () => void) => skipBtn?.addEventListener('click', cb);

  // ---- phone layout: the sheet's height (chips / Back sit on its top edge) and the nav's bottom edge (toast / hint stack under it)
  if (el && 'ResizeObserver' in window) {
    const measure = () => {
      const h = sheet && !sheet.hidden ? sheet.getBoundingClientRect().height : 0;
      el.style.setProperty('--sheet-h', `${Math.round(h)}px`);
      el.classList.toggle('has-sheet', h > 0);
      if (navEl) el.style.setProperty('--nav-b', `${Math.round(navEl.getBoundingClientRect().bottom)}px`);
    };
    const ro = new ResizeObserver(measure);
    if (sheet) ro.observe(sheet);
    if (navEl) ro.observe(navEl);
    addEventListener('resize', measure);
  }

  // ---- chip bar: only the chips the docked carrier defines; a tap runs the action, then keeps the cursor row in view
  function setActions(a: DockActions | null) {
    actions = a;
    if (!chips) return;
    let any = false;
    for (const b of chips.querySelectorAll<HTMLElement>('[data-chip]')) {
      const on = !!a?.[b.dataset.chip as keyof DockActions] && CHIP_KEYS.includes(b.dataset.chip as keyof DockActions);
      b.hidden = !on;
      any ||= on;
    }
    chips.hidden = !any;
  }
  /** Scroll the sheet so the selection cursor (or the line an action just typed) is visible under the chip row. */
  function revealSel() {
    if (!sheet || sheet.hidden) return;
    const t = sheet.querySelector<HTMLElement>('.term-out.is-typing') ?? sheet.querySelector<HTMLElement>('.is-sel');
    if (!t) return;
    const r = t.getBoundingClientRect(), s = sheet.getBoundingClientRect();
    const top = s.top + (parseFloat(getComputedStyle(sheet).scrollPaddingTop) || 0), bottom = s.bottom - 8;
    let dy = 0;
    if (r.top < top) dy = r.top - top;
    else if (r.bottom > bottom) dy = Math.min(r.bottom - bottom, r.top - top);
    if (Math.abs(dy) > 1) sheet.scrollBy({ top: dy, behavior: reducedMotion ? 'auto' : 'smooth' });
  }
  chips?.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-chip]');
    if (!b) return;
    e.preventDefault(); // no focus, no ghost click on the sheet underneath
    const fn = actions?.[b.dataset.chip as keyof DockActions];
    if (!fn) return;
    b.classList.add('is-held');
    const up = () => { b.classList.remove('is-held'); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); };
    addEventListener('pointerup', up); addEventListener('pointercancel', up);
    fn();
    revealSel();
  });
  document.addEventListener(DOCK_EVENT, (e) => setActions((e as CustomEvent<DockEventDetail>).detail?.actions ?? null));
  document.addEventListener(UNDOCK_EVENT, () => setActions(null));

  return {
    el,
    get mode() { return mode; },
    setMode, prompt: showPrompt, showHintOnce, hideHint, toast, onBack, setActions, cutscene, onSkip,
    /** Touch control elements for input.ts. */
    touch: { zone: q('.stick-zone'), stick: q('.stick'), knob: q('.stick-knob'), buttons: q('.hud-btns') },
  };
}

export type Hud = ReturnType<typeof createHud>;

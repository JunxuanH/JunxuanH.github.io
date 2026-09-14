/**
 * Device layer for walk mode. Keyboard (WASD / arrows, Shift = run, E / Enter = interact, Esc = back),
 * pointer drag on the stage = orbit, and for coarse pointers a virtual joystick (any touch on the left
 * half of the HUD's stick zone) plus E / run buttons. Pointer events only, no touch API. `poll()` returns
 * the frame's snapshot and clears the edge flags and drag deltas. Keys are never intercepted while the
 * focus is in a form field, link or button, so the nav stays keyboard-usable.
 */
import * as THREE from 'three/webgpu';

export interface InputState {
  /** Camera-relative move: x = right, y = forward, |v| ≤ 1. */
  move: THREE.Vector2;
  run: boolean;
  /** Edge flags: true only on the frame the key/button went down. */
  interact: boolean;
  back: boolean;
  /** Orbit drag accumulated since the last poll (CSS pixels). */
  orbitX: number;
  orbitY: number;
  /** A deliberate walk input (WASD or the joystick, not arrows) — used to leave dock mode. */
  walkIntent: boolean;
  /** The joystick is being held. */
  stick: boolean;
}

export interface TouchDom {
  zone?: HTMLElement | null;
  stick?: HTMLElement | null;
  knob?: HTMLElement | null;
  buttons?: HTMLElement | null;
}

export interface InputOptions {
  /** The 3D stage: drags on it orbit the camera. */
  stage: HTMLElement;
  touch?: TouchDom;
  /** Called first for every keydown; return true to consume it (dock-mode routing). */
  onKey?: (e: KeyboardEvent) => boolean | void;
  /** Keys move the player only while this returns true (arrows are then prevented from scrolling). */
  enabled?: () => boolean;
}

const MOVE_KEYS: Record<string, [number, number, boolean]> = {
  KeyW: [0, 1, true], KeyS: [0, -1, true], KeyA: [-1, 0, true], KeyD: [1, 0, true],
  ArrowUp: [0, 1, false], ArrowDown: [0, -1, false], ArrowLeft: [-1, 0, false], ArrowRight: [1, 0, false],
};
const STICK_R = 48, DEAD = 0.15;

function inField(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n || !(n instanceof HTMLElement)) return false;
  const tag = n.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'A' || tag === 'BUTTON' || n.isContentEditable;
}

export function createInput(opts: InputOptions) {
  const held = new Set<string>();
  let run = false, runBtn = false;
  let interact = false, back = false;
  let orbitX = 0, orbitY = 0;
  const stickV = new THREE.Vector2();
  let stickOn = false;
  const state: InputState = { move: new THREE.Vector2(), run: false, interact: false, back: false, orbitX: 0, orbitY: 0, walkIntent: false, stick: false };
  const enabled = () => opts.enabled?.() ?? true;

  // ---- keyboard
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (inField(e.target) || inField(document.activeElement)) return;
    if (opts.onKey?.(e)) { e.preventDefault(); return; }
    if (e.code in MOVE_KEYS) { held.add(e.code); if (enabled()) e.preventDefault(); return; }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { run = true; return; }
    if (e.repeat) return;
    if (e.code === 'KeyE' || e.code === 'Enter') { interact = true; e.preventDefault(); return; }
    if (e.code === 'Escape') { back = true; return; }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    held.delete(e.code);
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') run = false;
  };
  const clear = () => { held.clear(); run = false; };
  addEventListener('keydown', onKeyDown);
  addEventListener('keyup', onKeyUp);
  addEventListener('blur', clear);

  // ---- orbit drag on the stage (mouse or the right-hand side of a touch screen; the stick zone captures its own pointers)
  let dragId: number | null = null, lastX = 0, lastY = 0;
  const stage = opts.stage;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || dragId !== null) return;
    if (inField(document.activeElement)) (document.activeElement as HTMLElement).blur(); // a clicked nav link keeps focus otherwise
    dragId = e.pointerId; lastX = e.clientX; lastY = e.clientY;
    try { stage.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
  });
  stage.addEventListener('pointermove', (e) => {
    if (e.pointerId !== dragId) return;
    orbitX += e.clientX - lastX; orbitY += e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
  });
  const endDrag = (e: PointerEvent) => { if (e.pointerId === dragId) dragId = null; };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---- virtual joystick: the stick appears where the finger lands and follows it within STICK_R
  const zone = opts.touch?.zone, stick = opts.touch?.stick, knob = opts.touch?.knob;
  if (zone) {
    let id: number | null = null, ox = 0, oy = 0;
    const place = (x: number, y: number) => {
      if (!stick) return;
      const r = zone.getBoundingClientRect();
      stick.style.left = `${x - r.left}px`; stick.style.top = `${y - r.top}px`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId; ox = e.clientX; oy = e.clientY;
      try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic or already-released pointer */ }
      stickOn = true; stickV.set(0, 0);
      place(ox, oy);
      stick?.classList.add('is-on');
      if (knob) knob.style.transform = 'translate(0px, 0px)';
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = (e.clientX - ox) / STICK_R, dy = (e.clientY - oy) / STICK_R;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      if (knob) knob.style.transform = `translate(${(dx * STICK_R).toFixed(1)}px, ${(dy * STICK_R).toFixed(1)}px)`;
      const l = Math.min(1, len);
      const k = l < DEAD ? 0 : (l - DEAD) / (1 - DEAD) / (l || 1); // dead zone, rescaled to 0…1
      stickV.set(dx * k, -dy * k);
    });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = null; stickOn = false; stickV.set(0, 0);
      stick?.classList.remove('is-on');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }
  // ---- HUD buttons (pointerdown so the tap never focuses the button or waits for click)
  let lastInteractTap = 0;
  opts.touch?.buttons?.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!b) return;
    e.preventDefault();
    const act = b.dataset.act;
    // E only while walking (dock mode has the chip bar), and a double-tap counts once: with nothing in range it is a no-op.
    if (act === 'interact') { if (enabled() && e.timeStamp - lastInteractTap > 250) interact = true; lastInteractTap = e.timeStamp; }
    else if (act === 'back') back = true;
    else if (act === 'run') { runBtn = true; b.classList.add('is-held'); const up = () => { runBtn = false; b.classList.remove('is-held'); removeEventListener('pointerup', up); removeEventListener('pointercancel', up); }; addEventListener('pointerup', up); addEventListener('pointercancel', up); }
  });

  /** The frame's input; edge flags and drag deltas reset. */
  function poll(): InputState {
    const m = state.move.set(0, 0);
    let wasd = false;
    if (stickOn) { m.copy(stickV); wasd = stickV.lengthSq() > 0.25; }
    else {
      for (const code of held) { const k = MOVE_KEYS[code]; if (!k) continue; m.x += k[0]; m.y += k[1]; if (k[2]) wasd = true; }
      if (m.lengthSq() > 1) m.normalize();
    }
    state.run = run || runBtn;
    state.interact = interact; state.back = back;
    state.orbitX = orbitX; state.orbitY = orbitY;
    state.walkIntent = wasd && m.lengthSq() > 0.01;
    state.stick = stickOn;
    interact = back = false; orbitX = orbitY = 0;
    return state;
  }

  /** Programmatic edge (HUD chips, tests). */
  const press = (what: 'interact' | 'back') => { if (what === 'interact') interact = true; else back = true; };

  return {
    poll, press,
    dispose() { removeEventListener('keydown', onKeyDown); removeEventListener('keyup', onKeyUp); removeEventListener('blur', clear); },
  };
}

export type Input = ReturnType<typeof createInput>;

/**
 * Harbor departures board (contact). A split-flap board on two legs at the pier end, between the
 * LinkedIn / GitHub neon poles, facing −z toward the arriving camera at (134.6, 5, 14.5); the contact
 * board shows the links as departure rows and the cue shuffles their letters (board repaints) as the
 * car lands. ~5 draws.
 */
import * as THREE from 'three/webgpu';
import { glowMaterial } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEMES } from '../theme';
import { neonText } from '../signs';
import { sfx } from '../audio';
import { keyToAction, setSel, hint, clearHint, retrigger, type DockActions } from './dock';
import type {Carrier, CarrierCtx } from './index';

const DECK_Y = 2.9;        // pier deck (districts/pier.ts)
const BX = 140, BZ = 32.1; // board centre
const BOTTOM = 5.9;        // board bottom edge: the landed car stays below it
const FRAME_H = 5.4;


export function create(ctx: CarrierCtx): Carrier {
  const T = THEMES.contact;
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x0b0c12, roughness: 0.5, metalness: 0.6 });
  const yellow = glowMaterial(T.secondary, 1.2);

  // Two legs from the deck to the board bottom, merged.
  group.add(new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(0.24, 3.0, 0.24).translate(BX - 4.4, DECK_Y + 1.5, BZ),
    new THREE.BoxGeometry(0.24, 3.0, 0.24).translate(BX + 4.4, DECK_Y + 1.5, BZ),
  ], false)!, dark));
  // Frame with a yellow bezel behind it (both re-sized in fit()), header cap + neon on top.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(10.6, FRAME_H, 0.35), dark);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(10.8, FRAME_H + 0.2, 0.2), yellow);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.5, 0.4), dark);
  const header = neonText('PIER 9 · DEPARTURES', T.signGlow, 6, { gain: 1.1 });
  header.rotation.y = Math.PI;
  const mount = new THREE.Object3D();
  mount.rotation.y = Math.PI; // local +z → world −z, toward the quay
  group.add(frame, bezel, cap, header, mount);

  /** Lay the frame out around a board of height h with its bottom edge pinned at BOTTOM. */
  const place = (h: number) => {
    const H = h + 0.5, cy = BOTTOM + h / 2;
    frame.scale.y = H / FRAME_H;
    bezel.scale.y = (H + 0.2) / (FRAME_H + 0.2);
    frame.position.set(BX, cy, BZ);
    bezel.position.set(BX, cy, BZ + 0.25);
    cap.position.set(BX, cy + H / 2 + 0.25, BZ);
    header.position.set(BX, cy + H / 2 + 0.55, BZ - 0.22);
    mount.position.set(BX, cy, BZ - 0.2);
  };
  place(4.8); // frame centred at 8.3 until the board is painted

  // Driven from update() (frame time) rather than timers, which background tabs throttle to seconds.

  // ---- dock: the three links are departure rows; ↑/↓ move the cursor, Enter flaps the row's status to BOARDED
  // (clacks) and opens the link in a new tab half a second later. Statuses go back to normal on undock.
  let rows: HTMLAnchorElement[] = [], sel = 0, docked = false;
  const timers: number[] = [];
  const move = (d: number) => { if (!rows.length) return; sel = (sel + d + rows.length) % rows.length; setSel(rows, sel); sfx.select(); };
  const board = () => {
    const row = rows[sel];
    if (!row) return;
    row.dataset.statusHome ??= row.dataset.status ?? '';
    row.dataset.status = 'BOARDED';
    retrigger(row, 'is-flip');
    sfx.clack(6);
    timers.push(window.setTimeout(() => { if (docked) window.open(row.href, '_blank', 'noopener'); }, 500));
  };
  const actions: DockActions = { up: () => move(-1), down: () => move(1), confirm: board };

  return {
    group, mount, width: 10, px: 640, style: 'flap-board', node: 'PIER 9 DEPARTURES', range: [0.8, 1.01],
    lights: [[140, 5.0, 28, 0xffb000, 45, 10]],
    fit: place,
    update(_t, dt) {
    },
    cue: {
      p: 0.975,
      run() { if (!ctx.reducedMotion) ctx.onFlap?.(); },
    },
    interact: {
      onEnter(el) {
        docked = true;
        rows = [...el.querySelectorAll<HTMLAnchorElement>('.actions a')];
        sel = 0; setSel(rows, sel);
        hint(el, '<kbd>↑</kbd><kbd>↓</kbd> select · <kbd>Enter</kbd> board · <kbd>Esc</kbd> back');
      },
      onExit(el) {
        docked = false;
        timers.splice(0).forEach(clearTimeout);
        for (const a of rows) {
          a.classList.remove('is-flip');
          if (a.dataset.statusHome !== undefined) { a.dataset.status = a.dataset.statusHome; delete a.dataset.statusHome; }
        }
        setSel(rows, -1); rows = [];
        clearHint(el);
      },
      onKey: (e) => keyToAction(e, actions),
      actions,
    },
  };
}

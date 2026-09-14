/**
 * Harbor departures board (contact). A split-flap board on two legs at the pier end, between the
 * LinkedIn / GitHub neon poles, facing −z toward the arriving camera at (134.6, 5, 14.5); the
 * `flap-board` slab restyles the contact links as departure rows and the cue shuffles their letters
 * as the car lands. ~5 draws.
 */
import * as THREE from 'three/webgpu';
import { color } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEMES } from '../theme';
import { neonText } from '../signs';
import type { Carrier, CarrierCtx } from './index';

const DECK_Y = 2.9;        // pier deck (districts/pier.ts)
const BX = 140, BZ = 32.1; // board centre
const BOTTOM = 5.9;        // slab bottom edge: the landed car stays below it
const FRAME_H = 5.4;

const scramble = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');

export function create(ctx: CarrierCtx): Carrier {
  const T = THEMES.contact;
  const group = new THREE.Group();
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x0b0c12, roughness: 0.5, metalness: 0.6 });
  const yellow = new THREE.MeshBasicNodeMaterial();
  yellow.colorNode = color(T.secondary).mul(1.2);

  // Two legs from the deck to the board bottom, merged.
  group.add(new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(0.24, 3.0, 0.24).translate(BX - 4.4, DECK_Y + 1.5, BZ),
    new THREE.BoxGeometry(0.24, 3.0, 0.24).translate(BX + 4.4, DECK_Y + 1.5, BZ),
  ], false)!, dark));
  // Frame with a yellow bezel behind it (both re-sized in fit()), header cap + neon on top.
  const frame = new THREE.Mesh(new THREE.BoxGeometry(10.6, FRAME_H, 0.35), dark);
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(10.8, FRAME_H + 0.2, 0.2), yellow);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(10.6, 0.5, 0.4), dark);
  const header = neonText('PIER 9 · DEPARTURES', T.signGlow, 6, { gain: 2 });
  header.rotation.y = Math.PI;
  const mount = new THREE.Object3D();
  mount.rotation.y = Math.PI; // local +z → world −z, toward the quay
  group.add(frame, bezel, cap, header, mount);

  /** Lay the board out around a slab of height h with its bottom edge pinned at BOTTOM. */
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
  place(4.8); // frame centred at 8.3 until the slab is measured

  // Letter shuffle: 8 ticks × 70 ms of random capitals on the three rows, then the labels come back.
  // Driven from update() (frame time) rather than timers, which background tabs throttle to seconds.
  let shuffleRows: HTMLElement[] = [], shuffleTicks = 0, shuffleAcc = 0;
  const restore = (rows: HTMLElement[]) => rows.forEach((a) => { if (a.dataset.label !== undefined) a.textContent = a.dataset.label; });

  return {
    group, mount, width: 10, px: 680, style: 'flap-board', range: [0.8, 1.01],
    lights: [[140, 6.5, 30.5, 0xffb000, 350, 14]],
    fit: place,
    update(_t, dt) {
      if (!shuffleTicks) return;
      shuffleAcc += dt;
      if (shuffleAcc < 0.07) return;
      shuffleAcc = 0;
      for (const a of shuffleRows) a.textContent = scramble(a.dataset.label!.length);
      if (--shuffleTicks === 0) restore(shuffleRows);
    },
    prepare(el) {
      el.querySelectorAll<HTMLElement>('.actions a').forEach((a, i) => a.style.setProperty('--i', String(i)));
    },
    cue: {
      p: 0.975,
      run(el) {
        if (ctx.reducedMotion) return;
        const rows = [...el.querySelectorAll<HTMLElement>('.actions a')];
        if (shuffleTicks) restore(shuffleRows);
        for (const a of rows) a.dataset.label ??= a.textContent ?? '';
        ctx.onFlap?.();
        shuffleRows = rows; shuffleTicks = 8; shuffleAcc = 0.07; // first tick this frame
      },
    },
  };
}

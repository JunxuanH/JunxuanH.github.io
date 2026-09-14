import * as THREE from 'three/webgpu';
import { color, float, fract, floor, hash, length, smoothstep, step, time, uv, vec2, abs } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeBlock } from '../districts/shared';
import { THEMES } from '../theme';
import { PAL } from '../palette';
import type { Carrier, CarrierCtx } from './index';

/*
 * Megascreen — the KIOXIA slab as a giant LED wall on a dedicated media tower east of the Downtown avenue.
 * The tower box spans x 27…41, z −129…−107 (main.ts keeps the kitbash out of [34, −118] r 17); the wall hangs
 * on its −x face from y 14 up, and the camera cranes up to (4, 15, −113) → (27, 22, −118). The DOM slab is
 * opaque, so the LED backing is the lit halo around it (0.5 u margin) and what the wall shows while the slab
 * is off; fit() stretches backing + frame to the measured slab height.
 */

const TOWER = new THREE.Vector3(34, 0, -118);
const FACE_X = 27;                    // tower −x face (TOWER.x − 7)
const WALL_BOTTOM = 14;               // y of the backing's lower edge; the catwalk runs just below it
const BACK_W = 21, BACK_H = 17.3;     // backing plane (fit → h + 1.0)
const FRAME_W = 21.6, FRAME_H = 17.9; // cyan frame box (fit → h + 1.6)

/** Dark LED matrix: the createBillboard dot/scanline modulation on a near-black base plus a slow glitch band. */
function ledBackingMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  // 240 × 200 cells over 21 × 17.3 u → ≈ 0.087 u square pixels
  const dots = float(1).sub(smoothstep(0.34, 0.5, length(fract(uv().mul(vec2(240, 200))).sub(0.5)))).mul(0.55).add(0.45);
  const scan = step(0.5, fract(uv().y.mul(128).add(time.mul(4)))).mul(0.1).add(0.9);
  // Once a second, a 40 % chance of a thin bright band at a random row.
  const sec = floor(time);
  const band = step(abs(uv().y.sub(hash(sec.add(7)))), 0.02).mul(step(0.6, hash(sec)));
  m.colorNode = color(0x0a1220).mul(dots).mul(scan).add(color(PAL.cyan).mul(band).mul(0.3)).mul(1.2);
  return m;
}

export function create(ctx: CarrierCtx): Carrier {
  const group = new THREE.Group();

  // Media tower: façade atlas block with the storefront strip and cyan roof strips on the wall side.
  const tower = facadeBlock(14, 46, 22, ctx.tex, 5, 'nx', THEMES.work.secondary);
  tower.position.copy(TOWER);
  group.add(tower);

  // LED wall on the −x face: backing plane (normal → −x), cyan frame just behind it so only a 0.3 u rim shows.
  const wallY = WALL_BOTTOM + BACK_H / 2;
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(BACK_W, BACK_H), ledBackingMaterial());
  backing.position.set(FACE_X - 0.15, wallY, TOWER.z);
  backing.rotation.y = -Math.PI / 2;
  const frameMat = new THREE.MeshBasicNodeMaterial();
  frameMat.colorNode = color(PAL.cyan).mul(2.0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.4, FRAME_H, FRAME_W), frameMat);
  frame.position.set(FACE_X + 0.1, wallY, TOWER.z);
  group.add(backing, frame);

  // Dark metal, one draw: catwalk under the wall with a thin rail, and the rooftop mast.
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x141826, roughness: 0.55, metalness: 0.5 });
  const parts: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(1.2, 0.2, FRAME_W).translate(FACE_X - 0.6, WALL_BOTTOM - 0.8, TOWER.z),
    new THREE.BoxGeometry(0.05, 0.05, FRAME_W).translate(FACE_X - 1.15, WALL_BOTTOM + 0.2, TOWER.z),
    new THREE.CylinderGeometry(0.2, 0.3, 6, 8).translate(TOWER.x, 46 + 3, TOWER.z),
  ];
  for (let k = 0; k <= 6; k++) parts.push(new THREE.BoxGeometry(0.05, 1.0, 0.05).translate(FACE_X - 1.15, WALL_BOTTOM - 0.2, TOWER.z - FRAME_W / 2 + (k * FRAME_W) / 6));
  group.add(new THREE.Mesh(mergeGeometries(parts, false)!, metal));

  // Red aviation blinker on the mast tip (0.8 Hz).
  const blinkMat = new THREE.MeshBasicNodeMaterial();
  blinkMat.colorNode = color(0xff2030).mul(step(0.5, fract(time.mul(0.8))).mul(3.0).add(0.15));
  const blinker = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), blinkMat);
  blinker.position.set(TOWER.x, 46 + 6.25, TOWER.z);
  group.add(blinker);

  // Slab mount 0.05 u in front of the backing. rotation.y = −π/2 maps local +Z to (sin −π/2, 0, cos −π/2) =
  // (−1, 0, 0): the screen normal points west, at the craned camera (4, 15, −113), which sits 23 u to −x.
  const mount = new THREE.Object3D();
  mount.position.set(FACE_X - 0.2, 22.2, TOWER.z);
  mount.rotation.y = -Math.PI / 2;
  group.add(mount);

  return {
    group,
    mount,
    width: 20,
    px: 760,
    style: 'led-wall',
    range: [0.3, 0.5],
    lights: [[20, 22, -118, PAL.cyan, 600, 40]],
    fit(h) {
      // Backing = slab + 1.0, frame = slab + 1.6; everything re-centred so the wall's lower edge stays at y 14.
      const cy = WALL_BOTTOM + h / 2;
      backing.scale.y = (h + 1.0) / BACK_H;
      frame.scale.y = (h + 1.6) / FRAME_H;
      backing.position.y = frame.position.y = mount.position.y = cy;
    },
  };
}

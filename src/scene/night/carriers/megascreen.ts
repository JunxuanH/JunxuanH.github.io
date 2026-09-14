import * as THREE from 'three/webgpu';
import { color, float, fract, floor, hash, length, smoothstep, step, time, uv, vec2, abs, glowMaterial } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { facadeBlock } from '../districts/shared';
import { THEMES } from '../theme';
import { PAL } from '../palette';
import { sfx } from '../audio';
import { keyToAction, hint, clearHint, glitch, clearGlitch, tabs, clearTabs, type DockActions } from './dock';
import type { Carrier, CarrierCtx } from './index';

/*
 * Megascreen — the KIOXIA board as a giant LED wall on a dedicated media tower east of the Downtown avenue.
 * The tower box spans x 27…41, z −129…−107 (main.ts keeps the kitbash out of [34, −118] r 17); the wall hangs
 * on its −x face from y 14 up, and the camera cranes up to (4, 15, −113) → (27, 22, −118). The board is
 * opaque, so the LED backing is the lit halo around it (0.5 u margin) and what the wall shows while the board
 * is off; fit() stretches backing + frame to the board's height.
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
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.4, FRAME_H, FRAME_W), glowMaterial(PAL.cyan, 2.0));
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

  // Board mount 0.05 u in front of the backing. rotation.y = −π/2 maps local +Z to (sin −π/2, 0, cos −π/2) =
  // (−1, 0, 0): the screen normal points west, at the craned camera (4, 15, −113), which sits 23 u to −x.
  const mount = new THREE.Object3D();
  mount.position.set(FACE_X - 0.2, 22.2, TOWER.z);
  mount.rotation.y = -Math.PI / 2;
  group.add(mount);

  // ---- dock: three channels as tabs — JOB (the section as is), AD (a mock ad, index.astro `.ch-ad`), SYSTEM: the live
  // fps / draw calls / triangles / pixel ratio read from window.__perf (main.ts) four times a second.
  interface PerfHook { frames: number; dpr: number; renderer?: { info?: { render?: { drawCalls?: number; calls?: number; triangles?: number } } } }
  const CHANNELS = ['JOB', 'AD', 'SYSTEM'];
  let ch = 1, slab: HTMLElement | null = null, timer = 0, lastFrames = 0, lastT = 0;
  const fmt = (n: number | undefined) => n === undefined ? '—' : n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : String(n);
  const readout = () => {
    if (!slab) return;
    const set = (k: string, v: string) => { const dd = slab!.querySelector<HTMLElement>(`[data-sys="${k}"]`); if (dd) dd.textContent = v; };
    const perf = (window as any).__perf as PerfHook | undefined;
    if (!perf) { for (const k of ['fps', 'draws', 'tris', 'dpr']) set(k, '—'); return; }
    const now = performance.now();
    if (lastT) set('fps', String(Math.round(((perf.frames - lastFrames) * 1000) / Math.max(1, now - lastT))));
    lastFrames = perf.frames; lastT = now;
    const r = perf.renderer?.info?.render;
    set('draws', fmt(r?.drawCalls ?? r?.calls));
    set('tris', fmt(r?.triangles));
    set('dpr', perf.dpr.toFixed(2));
  };
  const tune = (d: number) => {
    if (!slab) return;
    ch = ((ch - 1 + d + 3) % 3) + 1;
    slab.dataset.ch = String(ch);
    tabs(slab, CHANNELS, ch - 1);
    glitch(slab);
    sfx.static();
    clearInterval(timer); timer = 0;
    if (ch === 3) { lastT = 0; readout(); timer = window.setInterval(readout, 250); }
  };
  const actions: DockActions = { left: () => tune(-1), right: () => tune(1) };

  return {
    group,
    mount,
    width: 20,
    px: 600,
    style: 'led-wall',
    node: 'MEDIA TOWER',
    range: [0.3, 0.5],
    lights: [[20, 22, -118, PAL.cyan, 600, 40]],
    fit(h) {
      // Backing = board + 1.0, frame = board + 1.6; everything re-centred so the wall's lower edge stays at y 14.
      const cy = WALL_BOTTOM + h / 2;
      backing.scale.y = (h + 1.0) / BACK_H;
      frame.scale.y = (h + 1.6) / FRAME_H;
      backing.position.y = frame.position.y = mount.position.y = cy;
    },
    interact: {
      onEnter(el) {
        slab = el; ch = 1;
        el.dataset.ch = '1';
        tabs(el, CHANNELS, 0);
        hint(el, '<kbd>◀</kbd><kbd>▶</kbd> channel · <b>JOB</b> · <b>AD</b> · <b>SYSTEM</b> · <kbd>Esc</kbd> back');
      },
      onExit(el) {
        clearInterval(timer); timer = 0;
        delete el.dataset.ch;
        clearGlitch(el); clearHint(el); clearTabs(el);
        slab = null; ch = 1;
      },
      onKey: (e) => keyToAction(e, actions),
      actions,
    },
  };
}

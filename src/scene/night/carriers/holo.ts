import * as THREE from 'three/webgpu';
import { color, float, floor, hash, length, mix, smoothstep, step, time, uv, glowMaterial } from '../tsl';
import { PAL } from '../palette';
import gsap from 'gsap';
import { sfx } from '../audio';
import { keyToAction, hint, clearHint, glitch, clearGlitch, type DockActions } from './dock';
import type { Carrier, CarrierCtx } from './index';

/*
 * Holo — the Apple slab as a hologram thrown up from a projector disc on the +x lobby forecourt (center.ts:
 * the lobby at z −196 puts its black-marble slab centred on x 18.6 with its top at y 0.44). An additive open
 * cone fans from the disc to the slab's lower edge at y 2.6 and flickers in TSL; the camera dwells at
 * (9, 3.2, −186) looking at the slab centre.
 */

const DISC = new THREE.Vector3(18.6, 0.44, -196);
const SLAB_BOTTOM = 2.6;   // world y; the mount is re-centred above it in fit()
const DISC_H = 0.3;
const CONE_R = 4.7;        // covers the 9 u slab's lower corners (±4.5)

/** Normally 1; in ~10 % of 1.4 s windows a 30 Hz random buzz — the flicker lives in the shader. */
const buzz = () => mix(float(1), hash(floor(time.mul(30))), step(0.9, hash(floor(time.mul(0.7)))));

function additive() {
  return new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
}

export function create(_ctx: CarrierCtx): Carrier {
  const group = new THREE.Group();
  group.position.copy(DISC);

  // Projector disc (truncated cone, dark metal), emissive ring on its top face, three emitter lenses.
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, DISC_H, 32).translate(0, DISC_H / 2, 0),
    new THREE.MeshStandardNodeMaterial({ color: 0x141826, roughness: 0.35, metalness: 0.6 }));
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.06, 8, 48).rotateX(Math.PI / 2), glowMaterial(PAL.cyan, 2.5));
  ring.position.y = DISC_H;
  const lenses = new THREE.InstancedMesh(new THREE.SphereGeometry(0.1, 8, 6), glowMaterial(PAL.cyan, 4.0), 3);
  const m = new THREE.Matrix4();
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    lenses.setMatrixAt(k, m.makeTranslation(Math.cos(a) * 0.75, DISC_H + 0.02, Math.sin(a) * 0.75));
  }
  lenses.frustumCulled = false; // instance bounds aren't computed; the r 0.1 sphere at the origin would cull early
  group.add(disc, ring, lenses);

  // Beam: unit-height open cone, apex down at y 0 (rotateX(π) flips ConeGeometry's +y apex), base at y 1, scaled
  // to reach the slab bottom. After the flip uv.y is 1 at the apex and 0 at the base, so the beam is brightest at
  // the disc and dies out under the slab.
  const coneMat = additive();
  coneMat.colorNode = color(PAL.cyan);
  coneMat.opacityNode = uv().y.mul(0.22).mul(buzz());
  const cone = new THREE.Mesh(new THREE.ConeGeometry(CONE_R, 1, 40, 1, true).rotateX(Math.PI).translate(0, 0.5, 0), coneMat);
  cone.position.y = DISC_H;
  cone.scale.y = SLAB_BOTTOM - DISC.y - DISC_H;
  cone.renderOrder = 4; // after the lobby glass (3)
  group.add(cone);

  // Ground pool on the forecourt: radial cyan wash, breathing with the same buzz.
  const poolMat = additive();
  poolMat.colorNode = color(PAL.cyan);
  poolMat.opacityNode = float(1).sub(smoothstep(0.12, 0.5, length(uv().sub(0.5)))).mul(0.28).mul(buzz().mul(0.4).add(0.6));
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2), poolMat);
  pool.position.y = 0.02;
  pool.renderOrder = 4;
  group.add(pool);

  // Slab mount. rotation.y = −0.76 maps local +Z to (sin −0.76, 0, cos −0.76) = (−0.689, 0, 0.725); the dwell camera
  // (9, 3.2, −186) seen from the disc is (−9.6, ·, +10) → (−0.693, 0.721) horizontally, so the screen faces it.
  const mount = new THREE.Object3D();
  mount.position.set(0, 5.15 - DISC.y, 0);
  mount.rotation.y = -0.76;
  group.add(mount);

  // ---- dock: the mount spins a full turn with a glitch on arrival (E re-triggers it); ←/→ turn it ±0.15 rad,
  // clamped to ±1.2 so the pane never shows its (culled) back face.
  const YAW = mount.rotation.y;
  let off = 0, slab: HTMLElement | null = null;
  const spin = () => {
    if (!slab) return;
    glitch(slab);
    gsap.killTweensOf(mount.rotation);
    if (_ctx.reducedMotion) { mount.rotation.y = YAW + off; return; }
    gsap.fromTo(mount.rotation, { y: YAW + off }, { y: YAW + off + Math.PI * 2, duration: 1.2, ease: 'power2.inOut', onComplete: () => { mount.rotation.y = YAW + off; } });
  };
  const turn = (d: number) => {
    off = THREE.MathUtils.clamp(off + d, -1.2, 1.2);
    gsap.killTweensOf(mount.rotation);
    if (_ctx.reducedMotion) mount.rotation.y = YAW + off;
    else gsap.to(mount.rotation, { y: YAW + off, duration: 0.35, ease: 'power2.out' });
    sfx.select();
  };
  const actions: DockActions = { left: () => turn(0.15), right: () => turn(-0.15), confirm: () => { spin(); sfx.confirm(); } };

  return {
    group,
    mount,
    width: 9,
    px: 760,
    style: 'hologram',
    range: [0.55, 0.72],
    lights: [[18.6, 2.5, -195, PAL.cyan, 500, 16]],
    fit(h) {
      // Slab bottom stays on the cone's base at y 2.6; only the centre moves with the measured height.
      mount.position.y = SLAB_BOTTOM - DISC.y + h / 2;
    },
    interact: {
      onEnter(el) {
        slab = el; off = 0;
        hint(el, '<kbd>◀</kbd><kbd>▶</kbd> turn · <kbd>E</kbd> respin');
        spin();
      },
      onExit(el) {
        clearGlitch(el); clearHint(el);
        slab = null; off = 0;
        gsap.killTweensOf(mount.rotation);
        if (_ctx.reducedMotion) mount.rotation.y = YAW;
        else gsap.to(mount.rotation, { y: YAW, duration: 0.5, ease: 'power2.out' });
      },
      onKey: (e) => keyToAction(e, actions),
      actions,
    },
  };
}

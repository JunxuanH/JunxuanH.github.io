import * as THREE from 'three/webgpu';
import { color, fract, mix, positionLocal, smoothstep, step, time, uv, abs, atan, max } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createBillboard } from '../bay';
import { THEMES } from '../theme';
import { PAL } from '../palette';
import type { Carrier, CarrierCtx } from './index';

/*
 * Blimp — the AMD data-center slab as a banner on an airship cruising a closed loop over the Downtown avenue at
 * y ≈ 40. The camera flies in formation on its port side (journey FOLLOW adds `displacement()` to pos + look), so
 * the DOM slab hangs on the local +x panel and a canvas LED billboard on −x keeps the far side lit. `t = 0` is
 * HOME; reduced motion parks the blimp there.
 */

export const HOME = new THREE.Vector3(-2.5, 40, -158);
const LOOP: [number, number, number][] = [
  [-2.5, 40, -158], [0, 41, -178], [2.5, 42, -186], [5, 41, -178], [7.5, 40, -158], [5, 41, -138], [2.5, 42, -130], [0, 41, -138],
];
const CRUISE = 2.6;          // u/s; main.ts eases this down with setSpeedScale() while the camera follows
const HULL = new THREE.Vector3(4, 4, 15);
const UP = THREE.Object3D.DEFAULT_UP;
const ROTOR_AT = [new THREE.Vector3(-1.5, -4.6, -3.0), new THREE.Vector3(1.5, -4.6, -3.0)];

/** Cyan-rimmed dark panel; the rim is read from the box's own local extents so both frames can share one draw. */
function frameMaterial(halfH: number, halfW: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  const edge = max(smoothstep(halfH - 0.45, halfH - 0.1, abs(positionLocal.y)), smoothstep(halfW - 0.45, halfW - 0.1, abs(positionLocal.z)));
  m.colorNode = mix(color(0x0b0e18), color(PAL.cyan).mul(1.8), edge);
  return m;
}

export function create(ctx: CarrierCtx): Carrier & { setSpeedScale(s: number): void } {
  const group = new THREE.Group();
  const root = new THREE.Group();
  group.add(root);

  // Hull: sphere with the scale baked so positionLocal is in hull units (z ±15); faint cyan panel seams every 2.5 u.
  const hullMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.5, metalness: 0.3 });
  hullMat.colorNode = color(0x0e1220);
  hullMat.emissiveNode = color(PAL.cyan).mul(step(0.975, fract(positionLocal.z.mul(0.4))).mul(0.5));
  root.add(new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18).scale(HULL.x, HULL.y, HULL.z), hullMat));

  // Dark metal in one draw: four tail fins (roots buried in the hull, radius ≈ 1.7 at z −13.5), gondola, engine pods.
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x141826, roughness: 0.55, metalness: 0.45 });
  const finGeo = () => new THREE.BoxGeometry(0.12, 3.2, 4.6);
  const podGeo = () => new THREE.CylinderGeometry(0.35, 0.35, 1.4, 12).rotateX(Math.PI / 2);
  root.add(new THREE.Mesh(mergeGeometries([
    finGeo().translate(0, 2.4, -13.5), finGeo().translate(0, -2.4, -13.5),
    finGeo().rotateZ(Math.PI / 2).translate(2.4, 0, -13.5), finGeo().rotateZ(Math.PI / 2).translate(-2.4, 0, -13.5),
    new THREE.BoxGeometry(2.4, 1.4, 6).translate(0, -4.6, 0),
    podGeo().translate(-1.5, -4.6, -2.2), podGeo().translate(1.5, -4.6, -2.2),
  ], false)!, dark));

  // Gondola window strip (pokes 0.05 u out of both sides).
  const winMat = new THREE.MeshBasicNodeMaterial();
  winMat.colorNode = color(THEMES.work.warm).mul(2.2);
  const win = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.3, 5), winMat);
  win.position.set(0, -4.5, 0);
  root.add(win);

  // Rotor discs behind the pods: translucent with a three-blade pattern so the spin reads; matrices rebuilt in update.
  const rotorMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const blades = step(0.5, fract(atan(uv().y.sub(0.5), uv().x.sub(0.5)).mul(3 / (2 * Math.PI))));
  rotorMat.colorNode = color(0x9aa4b8);
  rotorMat.opacityNode = blades.mul(0.35).add(0.12);
  const rotors = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.7, 0.7, 0.04, 16).rotateX(Math.PI / 2), rotorMat, 2);
  rotors.frustumCulled = false; // instanced bounds aren't computed; hull + fins keep culling on
  root.add(rotors);

  // Nav lights. Travelling along local +z with +y up, local +x is the LEFT (port) side — see the heading note below —
  // so port red sits at +x and starboard green at −x. Two white strobes (tail, belly) blink at 1.3 Hz.
  const navGeo = new THREE.SphereGeometry(0.18, 8, 6);
  const navMat = new THREE.MeshBasicNodeMaterial();
  navMat.colorNode = color(0xffffff).mul(3.0); // × per-instance colour
  const nav = new THREE.InstancedMesh(navGeo, navMat, 2);
  const im = new THREE.Matrix4();
  nav.setMatrixAt(0, im.makeTranslation(HULL.x + 0.05, 0, 2)); nav.setColorAt(0, new THREE.Color(0xff2030));
  nav.setMatrixAt(1, im.makeTranslation(-HULL.x - 0.05, 0, 2)); nav.setColorAt(1, new THREE.Color(0x30ff60));
  const strobeMat = new THREE.MeshBasicNodeMaterial();
  strobeMat.colorNode = color(0xffffff).mul(step(0.9, fract(time.mul(1.3))).mul(4.0).add(0.1));
  const strobe = new THREE.InstancedMesh(navGeo, strobeMat, 2);
  strobe.setMatrixAt(0, im.makeTranslation(0, 0, -HULL.z - 0.1));
  strobe.setMatrixAt(1, im.makeTranslation(0, -5.4, 0));
  nav.frustumCulled = strobe.frustumCulled = false;
  root.add(nav, strobe);

  // Banner frames on both flanks (one merged draw). +x carries the DOM slab; −x the canvas billboard.
  const frames = new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(0.2, 6.9, 16.6).translate(4.25, 0, 0),
    new THREE.BoxGeometry(0.2, 6.9, 16.6).translate(-4.25, 0, 0),
  ], false)!, frameMaterial(3.45, 8.3));
  root.add(frames);
  // rotation.y = −π/2 turns the billboard's +z normal to local −x (sin −π/2, 0, cos −π/2).
  const billboard = createBillboard('AMD', 'DATA CENTER GPU PERF', 16, 6.3);
  billboard.position.x = -4.37;
  billboard.rotation.y = -Math.PI / 2;
  root.add(billboard);

  // Slab mount flush with the +x frame face. rotation.y = π/2 maps the mount's local +Z to (sin π/2, 0, cos π/2) =
  // root-local +x — the camera side (see heading note).
  const mount = new THREE.Object3D();
  mount.position.set(4.35, 0, 0);
  mount.rotation.y = Math.PI / 2;
  root.add(mount);

  const light = new THREE.PointLight(PAL.cyan, 300, 40, 2);
  light.position.set(0, -5.6, 0);
  root.add(light);

  // Loop + heading. Matrix4.lookAt(eye, target, up) builds a frame whose +Z axis is (eye − target), so
  // lookAt(ahead, pos) points the root's local +Z along the direction of travel (drones.ts idiom; the hull nose is
  // at +z). Its +X axis is up × Z. At HOME the next waypoint is (0, 41, −178), i.e. travel ≈ −z, so
  // +X = (0,1,0) × (0,0,−1) = (−1, 0, 0): root-local +x faces world −x, toward the formation camera at
  // (−15, 39, −146), which is 12.5 u to −x of HOME. Hence the DOM slab hangs on the +x panel.
  const curve = new THREE.CatmullRomCurve3(LOOP.map((p) => new THREE.Vector3(...p)), true, 'centripetal');
  const length = curve.getLength();
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3(), disp = new THREE.Vector3();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), rm = new THREE.Matrix4();
  const headingAt = (u: number) => {
    curve.getPointAt((u + 0.01) % 1, ahead);
    m4.lookAt(ahead, pos, UP);
    q.setFromRotationMatrix(m4);
  };
  curve.getPointAt(0, pos); // = HOME (closed Catmull-Rom starts at points[0])
  headingAt(0);
  root.position.copy(pos);
  root.quaternion.copy(q);
  rotors.setMatrixAt(0, rm.makeTranslation(ROTOR_AT[0].x, ROTOR_AT[0].y, ROTOR_AT[0].z));
  rotors.setMatrixAt(1, rm.makeTranslation(ROTOR_AT[1].x, ROTOR_AT[1].y, ROTOR_AT[1].z));

  let u = 0, speedScale = 1, spin = 0;
  const update = (t: number, dt: number) => {
    u = (u + (CRUISE * speedScale * dt) / length) % 1;
    curve.getPointAt(u, pos);
    disp.subVectors(pos, HOME); // before the bob, so the camera follow stays level
    root.position.copy(pos);
    root.position.y += Math.sin(t * 0.5) * 0.4;
    headingAt(u);
    root.quaternion.slerp(q, 1 - Math.pow(0.95, dt * 60)); // 0.05 per frame at 60 fps, frame-rate independent
    spin += dt * 30;
    for (let k = 0; k < 2; k++) {
      rm.makeRotationZ(k ? -spin : spin).setPosition(ROTOR_AT[k]);
      rotors.setMatrixAt(k, rm);
    }
    rotors.instanceMatrix.needsUpdate = true;
  };

  return {
    group,
    mount,
    width: 16,
    px: 760,
    style: 'banner',
    range: [0.22, 0.78],
    update: ctx.reducedMotion ? undefined : update,
    displacement: (out) => (ctx.reducedMotion ? out.set(0, 0, 0) : out.copy(disp)),
    setSpeedScale: (s) => { speedScale = s; },
  };
}

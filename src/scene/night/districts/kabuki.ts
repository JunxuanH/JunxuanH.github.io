import * as THREE from 'three/webgpu';
import { color, positionLocal, mix, step, fract, texture, uv, float, smoothstep, time, hash, floor } from 'three/tsl';
import { PAL, rng } from '../palette';
import { ANCHORS } from '../journey';
import { neonText, createKeyedSigns, signMat } from '../signs';
import { CURB_H, SIDEWALK, CROSS_HALF } from '../streets';
import { THEMES } from '../theme';
import { facadeBlock, stringLights, type DistrictBuild, type DistrictCtx } from './shared';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

/*
 * Projects district — Kabuki night-market alley. Overhangs and awnings close the street in, red
 * paper lanterns hang across it, stalls with menu boards and noren, crates, a parked tuk-tuk,
 * the Flip-3D holo stack at the end. Steam and sparks come from particles.ts.
 */

/** Corrugated overhang with an emissive strip underneath (procedural, one per façade row). */
function overhang(w: number, tint: number) {
  const group = new THREE.Group();
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w, 0.25, 3.4), new THREE.MeshStandardNodeMaterial({ color: 0x1a1a22, roughness: 0.6, metalness: 0.5 }));
  roof.position.set(0, 0, 1.7);
  const stripMat = new THREE.MeshBasicNodeMaterial();
  const buzz = mix(float(1), hash(floor(time.mul(20))), step(0.9, hash(floor(time.mul(0.4)))));
  stripMat.colorNode = color(tint).mul(1.8).mul(buzz.mul(0.4).add(0.6));
  const strip = new THREE.Mesh(new THREE.BoxGeometry(w - 0.6, 0.1, 0.1), stripMat);
  strip.position.set(0, -0.18, 3.2);
  const brace = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.08), new THREE.MeshStandardNodeMaterial({ color: 0x0c0d14 }));
  brace.position.set(0, -0.6, 2.6);
  group.add(roof, strip, brace);
  return group;
}

/** Instanced red paper lanterns along a catenary: sphere + inner glow tint, slight sway in update(). */
function lanternString(from: THREE.Vector3, to: THREE.Vector3, n: number, sag: number) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
  mat.colorNode = color(0x6a1010);
  mat.emissiveNode = mix(color(0xff3a2a), color(0xffa040), smoothstep(-0.2, 0.2, positionLocal.y)).mul(0.8);
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    mats.push(new THREE.Matrix4().makeTranslation(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * sag, from.z + (to.z - from.z) * t));
  }
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 10, 8).scale(1, 1.3, 1), mat, mats.length);
  mats.forEach((m, k) => im.setMatrixAt(k, m));
  group.add(im);
  group.add(stringLights(from, to, n * 3, sag, 0.05, 0x101010, 0.3)); // the cord
  return group;
}

export async function create(ctx: DistrictCtx): Promise<DistrictBuild> {
  const T = THEMES.projects;
  const group = new THREE.Group();
  const r = rng(707);
  const m = ANCHORS.market;
  const rowZ = (side: number) => m.z + side * (CROSS_HALF + SIDEWALK + 8.5); // façade rows

  // Backdrop blocks with storefronts facing the alley, overhangs along both rows.
  for (const [dx, side, w, h, seed] of [[-14, 1, 30, 14, 2], [18, 1, 26, 11, 3], [-10, -1, 34, 12, 1], [24, -1, 22, 16, 0]] as const) {
    const d = 16;
    const b = facadeBlock(w, h, d, ctx.tex, seed, side > 0 ? 'nz' : 'pz', seed % 2 ? T.primary : T.secondary);
    b.position.set(m.x + dx, CURB_H, rowZ(side));
    group.add(b);
    const oh = overhang(w, seed % 2 ? T.primary : T.secondary);
    oh.position.set(m.x + dx, CURB_H + 5.6, rowZ(side) - side * (d / 2));
    oh.rotation.y = side > 0 ? Math.PI : 0;
    group.add(oh);
  }

  // Stalls with menu boards / noren, crates beside them.
  const stallGeo = new THREE.BoxGeometry(3.2, 2.2, 2.4).translate(0, 1.1, 0);
  const stallMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1e2c, roughness: 0.6 });
  const stallTop = new THREE.MeshBasicNodeMaterial();
  stallTop.colorNode = mix(color(T.primary), color(T.warm), step(0.5, fract(positionLocal.x.mul(0.5)))).mul(2.0);
  const crateMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2418, roughness: 0.9 });
  const menuSpots: { x: number; y: number; z: number; yaw: number; w?: number }[] = [];
  const stallMats: THREE.Matrix4[] = [], stripMats: THREE.Matrix4[] = [], crateMats: THREE.Matrix4[] = [];
  const yq = new THREE.Quaternion(), yAxis = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const x = m.x - 26 + (i % 4) * 14, z = m.z + side * (CROSS_HALF + 3);
    stallMats.push(new THREE.Matrix4().makeTranslation(x, CURB_H, z));
    stripMats.push(new THREE.Matrix4().makeTranslation(x, CURB_H + 2.3, z - side * 1.25));
    menuSpots.push({ x: x + 1.2, y: CURB_H + 2.9, z: z - side * 1.3, yaw: side > 0 ? Math.PI : 0, w: 1.6 });
    for (let k = 0; k < 2 + Math.floor(r() * 3); k++) {
      yq.setFromAxisAngle(yAxis, r() * 0.5);
      crateMats.push(new THREE.Matrix4().compose(new THREE.Vector3(x + 2.4 + (r() - 0.5) * 0.6, CURB_H + 0.35 + k * 0.7, z + (r() - 0.5) * 0.8), yq, one));
    }
  }
  const inst = (geo: THREE.BufferGeometry, mat: THREE.Material, list: THREE.Matrix4[]) => {
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, k) => im.setMatrixAt(k, mm));
    return im;
  };
  group.add(inst(stallGeo, stallMat, stallMats), inst(new THREE.BoxGeometry(3.4, 0.12, 0.12), stallTop, stripMats), inst(new THREE.BoxGeometry(0.9, 0.7, 0.9), crateMat, crateMats));
  group.add(await createKeyedSigns(menuSpots, ['lantern-3', 'lantern-4', 'lantern-3', 'lantern-4']));

  // Lantern strings across the alley + a few hanging lantern cutouts under the overhangs.
  for (let k = 0; k < 6; k++) {
    const x = m.x - 30 + k * 12;
    if (Math.abs(x - 68) < 3) continue; // the holo stall's cards sit here (carriers/stall.ts)
    group.add(lanternString(new THREE.Vector3(x, 6.4, m.z - CROSS_HALF - 3), new THREE.Vector3(x, 6.4, m.z + CROSS_HALF + 3), 9, 1.1));
  }
  const hanging = [];
  for (let i = 0; i < 6; i++) hanging.push({ x: m.x - 28 + i * 11 + 5, y: 4.6, z: m.z + (i % 2 ? 1 : -1) * (CROSS_HALF + SIDEWALK - 1.2), yaw: i % 2 ? Math.PI : 0, w: 1.4 });
  group.add(await createKeyedSigns(hanging, ['lantern-1', 'lantern-2']));

  // Tuk-tuk parked at the alley mouth (fal GLB if present).
  try {
    const gl = new GLTFLoader();
    gl.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));
    const g = await gl.loadAsync('/night/models/tuktuk.glb');
    const box = new THREE.Box3().setFromObject(g.scene);
    const size = box.getSize(new THREE.Vector3());
    const k = 3.2 / Math.max(size.x, size.z);
    g.scene.scale.setScalar(k);
    g.scene.position.set(m.x - 34, CURB_H - box.min.y * k, m.z + CROSS_HALF - 1.5);
    g.scene.rotation.y = -0.4;
    group.add(g.scene);
  } catch { /* not generated yet */ }

  // (The Flip-3D project cards are CSS3D objects mounted here by content.ts.)
  const lbl = neonText('SIDE PROJECTS', T.signGlow, 9, { font: '"IBM Plex Mono", ui-monospace, monospace', gain: 1.3 });
  lbl.position.set(m.x + 4, 8.5, m.z - CROSS_HALF - SIDEWALK - 0.4);
  group.add(lbl);
  const title = neonText('歌舞伎横丁', '#ff3a2a', 10, { gain: 2.4 });
  title.position.set(m.x - 30, 9.5, m.z - CROSS_HALF - SIDEWALK - 8.3);
  group.add(title);

  const props: DistrictBuild['props'] = [];
  for (let i = 0; i < 8; i++) {
    const side = i < 4 ? -1 : 1;
    const x = m.x - 26 + (i % 4) * 14, z = m.z + side * (CROSS_HALF + 3);
    props.push({ kind: 'parasol', x: x + 2.4, z, yaw: i * 0.7, s: 1.1 });
    props.push({ kind: 'awning', x, z: z + side * 2.2, yaw: side > 0 ? Math.PI : 0, y: 3.2 });
  }
  props.push({ kind: 'lamp', x: m.x - 36, z: m.z + CROSS_HALF + 1.2, yaw: 0 }, { kind: 'lamp', x: m.x + 30, z: m.z - CROSS_HALF - 1.2, yaw: Math.PI });
  props.push({ kind: 'barrier', x: m.x - 36, z: m.z - CROSS_HALF + 1, yaw: 0.2 }, { kind: 'cone', x: m.x - 35, z: m.z - 2, yaw: 0 }, { kind: 'dumpster', x: m.x + 34, z: m.z + CROSS_HALF + 1.5, yaw: 0.8 });

  const lights: DistrictBuild['lights'] = [
    [36, 6, -228, T.warm, 900], [64, 6, -228, T.warm, 900], [50, 9, -238, PAL.magenta, 500], [50, 4, -232, T.primary, 450], [70, 5, -224, T.secondary, 400],
  ];
  void texture; void uv; void signMat;
  return { group, props, lights };
}

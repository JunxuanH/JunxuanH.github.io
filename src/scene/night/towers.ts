import * as THREE from 'three/webgpu';
import {
  attribute, positionLocal, normalLocal, uv, float, vec2, vec3, color, mix, step, smoothstep, fract, floor,
  abs, hash, time, instanceIndex, texture, luminance, max, positionWorld, cameraPosition, length,
 uniform, normalMap } from './tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import type { WallSets } from './streets';
import { PAL, rng, type Tier } from './palette';
import { streetLot } from './building-layout';

/*
 * Kitbash city. Four archetypes × three heights = 12 variant geometries, each built from real-size
 * boxes with thin LED "strip" boxes along tier edges (attribute aStrip = 1) and a tier index
 * (aTier). Instances use near-uniform scale so strip thickness and window pitch stay in world units.
 */

interface Box { w: number; h: number; d: number; x: number; y: number; z: number }
interface Variant { name: string; height: number; geo: THREE.BufferGeometry; base: { w: number; d: number }; screen?: { y: number; w: number; h: number; z: number } }

const STRIP = 0.2;

function boxAttr(g: THREE.BufferGeometry, strip: number, tier: number) {
  const n = g.attributes.position.count;
  g.setAttribute('aStrip', new THREE.Float32BufferAttribute(new Float32Array(n).fill(strip), 1));
  g.setAttribute('aTier', new THREE.Float32BufferAttribute(new Float32Array(n).fill(tier), 1));
  return g;
}

function tierBoxes(b: Box, tier: number, corners: boolean, out: THREE.BufferGeometry[]) {
  out.push(boxAttr(new THREE.BoxGeometry(b.w, b.h, b.d).translate(b.x, b.y + b.h / 2, b.z), 0, tier));
  const top = b.y + b.h;
  // Top-edge strips (four), slightly proud of the face.
  out.push(boxAttr(new THREE.BoxGeometry(b.w + STRIP, STRIP, STRIP).translate(b.x, top, b.z + b.d / 2), 1, tier));
  out.push(boxAttr(new THREE.BoxGeometry(b.w + STRIP, STRIP, STRIP).translate(b.x, top, b.z - b.d / 2), 1, tier));
  out.push(boxAttr(new THREE.BoxGeometry(STRIP, STRIP, b.d + STRIP).translate(b.x + b.w / 2, top, b.z), 1, tier));
  out.push(boxAttr(new THREE.BoxGeometry(STRIP, STRIP, b.d + STRIP).translate(b.x - b.w / 2, top, b.z), 1, tier));
  if (corners) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      out.push(boxAttr(new THREE.BoxGeometry(STRIP, b.h, STRIP).translate(b.x + sx * b.w / 2, b.y + b.h / 2, b.z + sz * b.d / 2), 1, tier));
    }
  }
}

function buildVariant(name: string, kind: number, height: number, seed: number): Variant {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const w = 9 + r() * 6, d = 8 + r() * 6;
  let screen: Variant['screen'];
  if (kind === 0) { // slab
    tierBoxes({ w, h: height, d, x: 0, y: 0, z: 0 }, 0, true, parts);
    screen = { y: height * 0.62, w: w * 0.7, h: height * 0.22, z: d / 2 };
  } else if (kind === 1) { // tiered3
    const hs = [0.5, 0.3, 0.2].map((f) => f * height);
    let y = 0, cw = w, cd = d;
    hs.forEach((h, i) => {
      tierBoxes({ w: cw, h, d: cd, x: 0, y, z: 0 }, i, i === 0, parts);
      if (i === 1) screen = { y: y + h * 0.5, w: cw * 0.72, h: h * 0.7, z: cd / 2 };
      y += h; cw *= 0.85 - r() * 0.06; cd *= 0.85 - r() * 0.06;
    });
  } else if (kind === 2) { // tiered4 + crown + mast
    const hs = [0.4, 0.25, 0.2, 0.15].map((f) => f * height);
    let y = 0, cw = w, cd = d;
    hs.forEach((h, i) => {
      tierBoxes({ w: cw, h, d: cd, x: 0, y, z: 0 }, i, i < 2, parts);
      if (i === 1) screen = { y: y + h * 0.5, w: cw * 0.72, h: h * 0.7, z: cd / 2 };
      y += h; cw *= 0.82; cd *= 0.82;
    });
    // crown ring (four bars above the last tier) + mast
    const ring = { w: cw * 1.25, d: cd * 1.25 };
    parts.push(boxAttr(new THREE.BoxGeometry(ring.w, STRIP, STRIP).translate(0, y + 1.2, ring.d / 2), 1, 4));
    parts.push(boxAttr(new THREE.BoxGeometry(ring.w, STRIP, STRIP).translate(0, y + 1.2, -ring.d / 2), 1, 4));
    parts.push(boxAttr(new THREE.BoxGeometry(STRIP, STRIP, ring.d).translate(ring.w / 2, y + 1.2, 0), 1, 4));
    parts.push(boxAttr(new THREE.BoxGeometry(STRIP, STRIP, ring.d).translate(-ring.w / 2, y + 1.2, 0), 1, 4));
    parts.push(boxAttr(new THREE.BoxGeometry(0.4, height * 0.16, 0.4).translate(0, y + height * 0.08, 0), 0, 5));
    parts.push(boxAttr(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate(0, y + height * 0.16, 0), 2, 5)); // red blinker (aStrip 2)
  } else { // stepped-L
    const hA = height * 0.6, hB = height;
    tierBoxes({ w, h: hA, d, x: -w * 0.25, y: 0, z: 0 }, 0, false, parts);
    tierBoxes({ w: w * 0.55, h: hB, d: d * 0.8, x: w * 0.3, y: 0, z: d * 0.05 }, 1, true, parts);
    screen = { y: hB * 0.6, w: w * 0.45, h: hB * 0.2, z: d * 0.05 + d * 0.4 };
  }
  const geo = mergeGeometries(parts, false)!;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { name, height, geo, base: { w: kind === 3 ? w * 1.1 : w, d }, screen };
}

export interface KitbashOptions {
  tier: Tier;
  /** Optional façade atlas (2×2 seamless tiles); windows come from the TSL grid when absent. */
  atlas?: THREE.Texture | null;
  /** Screens atlas: 4 columns × 2 rows of vertical ads. */
  screens?: THREE.Texture | null;
  /** Storefront atlas (2×2 tiles) for ground floors facing a street. */
  storefronts?: THREE.Texture | null;
  /** Generated wall sets: concrete grain for the towers, gravel for their roofs. */
  walls?: WallSets;
  /** Keep-out discs [x, z, radius] for districts and hero towers. */
  keepOut: [number, number, number][];
  /** Which ground positions count as street-adjacent (x, z of the building) → face direction or null. */
  streetSide?: (x: number, z: number, halfW: number, halfD: number) => 'px' | 'nx' | 'pz' | 'nz' | null;
  /** Returns false when a footprint would overlap a road or sidewalk. */
  clear?: (x: number, z: number, halfW: number, halfD: number) => boolean;
}

export function createKitbash(opts: KitbashOptions) {
  const group = new THREE.Group();
  const count = { high: 1500, med: 900, low: 400 }[opts.tier];
  const variants: Variant[] = [];
  const heights = [28, 50, 82];
  let seed = 100;
  for (let kind = 0; kind < 4; kind++) for (const h of heights) variants.push(buildVariant(`k${kind}h${h}`, kind, h, seed++));

  // ---- shared material (kitbash)
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.25 });
  const aStrip = attribute('aStrip', 'float');
  const aTier = attribute('aTier', 'float');
  const bId = float(instanceIndex);
  const isStrip = step(0.5, aStrip).mul(step(aStrip, 1.5));
  const isBlink = step(1.5, aStrip);
  const stripCol = mix(color(PAL.cyan), color(PAL.magenta), step(0.5, hash(bId.mul(1.7))));
  const stripColY = mix(stripCol, color(PAL.yellow), step(0.92, hash(bId.mul(2.9))));
  const stripsOn = step(0.65, hash(bId.mul(3.3))); // ~35 % of buildings have lit edges (the rest read as concrete)
  const stripFlick = mix(float(1), hash(floor(time.mul(8)).add(bId)), step(0.97, hash(bId.mul(4.3).add(floor(time.mul(0.3))))));
  const stripE = stripColY.mul(1.9).mul(isStrip).mul(stripsOn).mul(stripFlick);
  const blinkE = color(0xff2030).mul(step(0.5, fract(time.mul(0.8).add(hash(bId))))).mul(isBlink).mul(4.0);

  // Windows in local space (instances are ~uniformly scaled).
  const wall = float(1).sub(smoothstep(0.4, 0.6, abs(normalLocal.y)));
  const across = mix(positionLocal.x, positionLocal.z, abs(normalLocal.x));
  const pitch = hash(bId.mul(0.731)).mul(0.5).add(0.45); // cells per unit: 0.45–0.95
  const pitchY = pitch.mul(0.85);
  const occupancy = hash(bId.mul(0.413)).mul(0.42).add(0.4); // 0.40–0.82 of cells lit, was 0.30–0.70
  const cx = floor(across.mul(pitch)), cy = floor(positionLocal.y.mul(pitchY));
  const seedN = cx.mul(13.1).add(cy.mul(7.3)).add(bId.mul(0.37));
  const lit = step(float(1).sub(occupancy), hash(seedN));
  const band = step(0.7, hash(bId.mul(6.3))).mul(step(fract(cy.mul(1 / 6)), 0.17)); // every 6th row fully lit on 30 %
  const fx = fract(across.mul(pitch)), fy = fract(positionLocal.y.mul(pitchY));
  const inset = step(0.2, fx).mul(step(fx, 0.8)).mul(step(0.25, fy)).mul(step(fy, 0.75));
  const winFlick = float(1).sub(step(0.975, hash(seedN.add(floor(time.mul(2.0)).mul(3.1)))));
  const warm = hash(seedN.add(99.0));
  const winCol = mix(color(PAL.sodium), mix(color(PAL.cyan), color(0xdfe8ff), step(0.5, warm)), step(0.35, warm));
  const bright = hash(seedN.add(7.0)).mul(0.8).add(0.6);
  const dark = step(0.08, hash(bId.mul(5.1))); // 8 % fully dark buildings, was 15 %
  let winE = winCol.mul(max(lit, band)).mul(inset).mul(wall).mul(winFlick).mul(bright).mul(2.6).mul(dark);
  let albedo: any = color(0x0c0d16);

  if (opts.atlas) {
    // Façade atlas on the near half: albedo from the sheet, emissive from its bright pixels.
    const cell = floor(hash(bId.mul(3.1)).mul(4.0));
    const cellUV = vec2(fract(cell.mul(0.5)), floor(cell.mul(0.5)).mul(0.5));
    const rep = vec2(across.mul(0.08), positionLocal.y.mul(0.08));
    const auv = fract(rep).mul(0.5).add(cellUV);
    const a = texture(opts.atlas, auv);
    const near = float(1).sub(smoothstep(140.0, 200.0, length(positionWorld.xz.sub(cameraPosition.xz))));
    const useAtlas = near.mul(wall); // every near building wears the sheet; the grid takes over far away
    // The sheet is painted near-black; lift it so hemisphere light shows panel structure.
    albedo = mix(albedo, a.rgb.mul(1.4).add(0.2), useAtlas);
    const atlasE = a.rgb.mul(smoothstep(0.26, 0.56, luminance(a.rgb))).mul(2.7).mul(dark);
    winE = mix(winE, atlasE, useAtlas);
  }
  mat.colorNode = mix(albedo, mix(color(0x1a1c26), stripColY.mul(0.25), stripsOn), isStrip);
  mat.emissiveNode = winE.mul(float(1).sub(isStrip)).add(stripE).add(blinkE);

  // Surface relief on the 1500 kitbash instances. Reuses the same local-position UV the windows are
  // built from, so no new attribute and no merged-UV problem, and it is one material either way.
  // Walls get concrete, up-facing roofs get gravel, chosen by the same normal term the windows use.
  const cset = opts.walls?.['wall-concrete'], gset = opts.walls?.['roof-gravel'];
  if (cset?.map || gset?.map) {
    const wuv = vec2(across.mul(0.14), positionLocal.y.mul(0.14));
    const ruv = vec2(positionLocal.x.mul(0.1), positionLocal.z.mul(0.1));
    const roof = float(1).sub(wall);
    if (cset?.normal && gset?.normal) {
      mat.normalNode = normalMap(mix(texture(gset.normal, ruv), texture(cset.normal, wuv), wall), uniform(new THREE.Vector2(0.45, 0.45)));
    } else if (cset?.normal) {
      mat.normalNode = normalMap(texture(cset.normal, wuv), uniform(new THREE.Vector2(0.45, 0.45)));
    }
    if (cset?.rough) {
      const grain = gset?.rough ? mix(texture(gset.rough, ruv).r, texture(cset.rough, wuv).r, wall) : texture(cset.rough, wuv).r;
      mat.roughnessNode = grain.sub(0.5).mul(uniform(0.35)).add(uniform(0.55)).clamp(0.1, 1);
    }
    // Roof gravel is albedo too: rooftops were the same flat colour as the walls from every fly-over.
    if (gset?.map) albedo = mix(albedo, texture(gset.map, ruv).rgb.mul(0.32), roof.mul(float(1).sub(isStrip)));
    // Windows stay unoccluded; they are the light sources on the tower.
    if (cset?.ao) {
      const occ = texture(cset.ao, wuv).r;
      mat.aoNode = mix(float(1), occ, wall.mul(float(1).sub(isStrip)).mul(float(1).sub(max(lit, band).mul(inset))));
    }
    mat.colorNode = mix(albedo, mix(color(0x1a1c26), stripColY.mul(0.25), stripsOn), isStrip);
  }

  // ---- placement
  const r = rng(7);
  const perVariant: THREE.Matrix4[][] = variants.map(() => []);
  const obstacles: { kind: 'obb'; x: number; z: number; hw: number; hd: number; yaw: number; h: number }[] = [];
  const screensAt: { m: THREE.Matrix4 }[] = [];
  const props: THREE.Matrix4[] = [];
  const fronts: THREE.Matrix4[] = [];
  const yawOf = { px: Math.PI / 2, nx: -Math.PI / 2, pz: 0, nz: Math.PI } as const;
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  let n = 0, guard = 0;
  while (n < count && guard++ < count * 30) {
    const gx = Math.round((r() * 2 - 1) * 19), gz = -Math.round(r() * 38) - 3;
    const x = gx * 14 + (r() - 0.5) * 3, z = gz * 14 + (r() - 0.5) * 3;
    if (Math.abs(x) < 12) continue; // the avenue
    if (opts.keepOut.some(([kx, kz, kr]) => Math.hypot(x - kx, z - kz) < kr)) continue;
    const dist = Math.hypot(x, z + 120);
    const want = 24 + r() * r() * 60 + Math.max(0, 50 - dist * 0.35); // tallest cluster near the centre
    const hi = want > 66 ? 2 : want > 40 ? 1 : 0;
    const kind = Math.floor(r() * 4);
    const vi = kind * 3 + hi;
    const v = variants[vi];
    const s = want / v.height;
    // Keep footprints clear of the roads and sidewalks (streets.ts zones).
    const yaw = (r() - 0.5) * 0.1 + (r() < 0.5 ? 0 : Math.PI);
    q.setFromAxisAngle(up, yaw);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s));
    const bounds = v.geo.boundingBox!.clone().applyMatrix4(m);
    const centre = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    if (opts.clear && !opts.clear(centre.x, centre.z, size.x / 2, size.z / 2)) continue;
    const localCentre = v.geo.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m);
    const localSize = v.geo.boundingBox!.getSize(new THREE.Vector3()).multiplyScalar(s);
    obstacles.push({ kind: 'obb', x: localCentre.x, z: localCentre.z, hw: localSize.x / 2, hd: localSize.z / 2, yaw, h: size.y });
    perVariant[vi].push(m);
    // Ground-floor storefront on the face that looks onto a street.
    const hw = v.base.w * s / 2, hd = v.base.d * s / 2;
    const side = opts.streetSide?.(x, z, hw, hd) ?? null;
    if (side) {
      const faceW = (side === 'px' || side === 'nx') ? hd * 2 : hw * 2;
      const off = side === 'px' ? [hw + 0.06, 0] : side === 'nx' ? [-hw - 0.06, 0] : side === 'pz' ? [0, hd + 0.06] : [0, -hd - 0.06];
      const fq = new THREE.Quaternion().setFromAxisAngle(up, yawOf[side]);
      fronts.push(new THREE.Matrix4().compose(new THREE.Vector3(x + off[0], 2.6, z + off[1]), fq, new THREE.Vector3(Math.min(faceW, 16), 5.2, 1)));
    }
    if (v.screen && r() < 0.18) {
      const sm = new THREE.Matrix4().compose(
        new THREE.Vector3(0, v.screen.y, v.screen.z + 0.15), new THREE.Quaternion(), new THREE.Vector3(v.screen.w, v.screen.h, 1),
      );
      screensAt.push({ m: m.clone().multiply(sm) });
    }
    if (r() < 0.6) {
      const pm = new THREE.Matrix4().compose(new THREE.Vector3(0, v.height, 0), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      props.push(m.clone().multiply(pm));
    }
    n++;
  }
  variants.forEach((v, i) => {
    const list = perVariant[i];
    if (!list.length) return;
    const im = new THREE.InstancedMesh(v.geo, mat, list.length);
    list.forEach((m, k) => im.setMatrixAt(k, m));
    im.frustumCulled = false;
    group.add(im);
  });

  // ---- LED screens (one instanced plane; atlas 4×2 of vertical ads)
  if (opts.screens && screensAt.length) {
    const smat = new THREE.MeshBasicNodeMaterial();
    const sid = float(instanceIndex);
    const cell = floor(hash(sid.mul(2.3)).mul(8.0));
    const col = fract(cell.mul(0.25)).mul(4.0), row = floor(cell.mul(0.25));
    const scroll = step(0.6, hash(sid.mul(4.1))).mul(time.mul(0.04));
    const u = uv().x.mul(0.25).add(col.mul(0.25));
    const vv = fract(uv().y.add(scroll)).mul(0.5).add(row.mul(0.5));
    const glitch = step(0.96, hash(floor(time.mul(5)).add(sid))).mul(hash(floor(uv().y.mul(20)).add(time)).sub(0.5)).mul(0.03);
    const s = texture(opts.screens, vec2(u.add(glitch), vv));
    const scan = step(0.5, fract(uv().y.mul(70).add(time.mul(6)))).mul(0.12).add(0.88);
    smat.colorNode = s.rgb.mul(scan).mul(2.5);
    const screens = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), smat, screensAt.length);
    screensAt.forEach((sa, k) => screens.setMatrixAt(k, sa.m));
    screens.frustumCulled = false;
    group.add(screens);
  }

  // ---- storefronts (ground floors facing streets): albedo from the sheet, neon from its bright pixels
  if (opts.storefronts && fronts.length) {
    const fmat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.1, side: THREE.DoubleSide });
    const fid = float(instanceIndex);
    const cell = floor(hash(fid.mul(1.9)).mul(4.0));
    const cellUV = vec2(fract(cell.mul(0.5)), floor(cell.mul(0.5)).mul(0.5));
    const fuv = vec2(fract(uv().x.mul(hash(fid.mul(2.7)).mul(0.6).add(0.9))).mul(0.5), uv().y.mul(0.5)).add(cellUV);
    const s = texture(opts.storefronts, fuv);
    fmat.colorNode = s.rgb.mul(1.0);
    fmat.emissiveNode = s.rgb.mul(smoothstep(0.45, 0.7, luminance(s.rgb))).mul(2.0);
    const fim = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), fmat, fronts.length);
    fronts.forEach((m, k) => fim.setMatrixAt(k, m));
    fim.frustumCulled = false;
    group.add(fim);
  }

  // ---- rooftop props (mast + tanks + dish)
  if (props.length) {
    const cluster = mergeGeometries([
      new THREE.CylinderGeometry(0.12, 0.18, 6, 6).translate(0, 3, 0),
      new THREE.CylinderGeometry(1.1, 1.1, 1.8, 10).translate(2.4, 0.9, 1.2),
      new THREE.CylinderGeometry(0.8, 0.8, 1.4, 10).translate(-2.2, 0.7, -1.0),
      new THREE.SphereGeometry(1.0, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(-1.5, 0.2, 2.0),
    ], false)!;
    const pmat = new THREE.MeshStandardNodeMaterial({ color: 0x14161f, roughness: 0.8, metalness: 0.4 });
    const pim = new THREE.InstancedMesh(cluster, pmat, props.length);
    props.forEach((m, k) => pim.setMatrixAt(k, m));
    pim.frustumCulled = false;
    group.add(pim);
  }

  return { group, obstacles, count: n, screens: screensAt.length, storefronts: fronts.length };
}

// ---------------------------------------------------------------------------------------------
// GLB towers (fal signature towers + the playweave set): lit windows from the albedo + tier lines.

const gltf = new GLTFLoader();
gltf.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));

export interface GlbTower { file: string; x: number; z: number; height: number; yaw?: number; tint?: number }

function towerMaterial(map: THREE.Texture | null, bboxH: number, tint: number) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.15 });
  const base = map ? texture(map, uv()).rgb : vec3(0.08, 0.09, 0.13);
  const glow = smoothstep(0.42, 0.62, luminance(base));
  // Tier lines: four emissive bands up the height plus a roof strip. Height and tint are uniforms so every
  // tower shares one program (each mesh has its own height).
  const yn = positionLocal.y.div(uniform(bboxH));
  const bands = smoothstep(0.012, 0.0, abs(fract(yn.mul(4.0)).sub(0.97)));
  const roof = smoothstep(0.975, 0.99, yn);
  const tierE = uniform(new THREE.Color(tint)).mul(max(bands, roof)).mul(3.0);
  m.colorNode = base.mul(0.5);
  m.emissiveNode = base.mul(glow).mul(2.4).add(tierE);
  return m;
}

export async function loadGlbTowers(list: GlbTower[], onEach?: (t: GlbTower, obj: THREE.Object3D) => void) {
  const group = new THREE.Group();
  await Promise.all(list.map(async (t) => {
    try {
      const g = await gltf.loadAsync(`/night/models/${t.file}.glb`);
      const box = new THREE.Box3().setFromObject(g.scene);
      const h = box.max.y - box.min.y;
      const k = t.height / h;
      g.scene.scale.setScalar(k);
      g.scene.position.set(t.x, -box.min.y * k, t.z);
      g.scene.rotation.y = t.yaw ?? 0;
      g.scene.updateMatrixWorld(true);
      // Generated models have different pivots and proportions. Measure AFTER rotation,
      // then relocate the whole model before publishing its collision bounds.
      const measured = new THREE.Box3().setFromObject(g.scene);
      const size = measured.getSize(new THREE.Vector3());
      const lot = streetLot(t.x, t.z, size.x, size.z);
      g.scene.scale.multiplyScalar(lot.scale);
      g.scene.updateMatrixWorld(true);
      const fitted = new THREE.Box3().setFromObject(g.scene);
      const centre = fitted.getCenter(new THREE.Vector3());
      g.scene.position.add(new THREE.Vector3(lot.x - centre.x, -fitted.min.y, lot.z - centre.z));
      g.scene.updateMatrixWorld(true);
      g.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        o.geometry.computeBoundingBox();
        const bh = o.geometry.boundingBox.max.y - o.geometry.boundingBox.min.y || 1;
        o.material = towerMaterial(o.material?.map ?? null, bh, t.tint ?? PAL.cyan);
      });
      group.add(g.scene);
      onEach?.(t, g.scene);
    } catch (e) { console.warn('[night] tower load failed', t.file, e); }
  }));
  return group;
}

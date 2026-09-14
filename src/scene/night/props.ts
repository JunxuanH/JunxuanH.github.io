import * as THREE from 'three/webgpu';
import { attribute, vec3, color, uniform } from './tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL, rng } from './palette';
import { AVENUE_HALF, SIDEWALK, CROSS_Z, CROSS_HALF, CURB_H, isRoad, isSidewalk } from './streets';

/*
 * Street furniture from the Kenney City Kits (CC0): lamps, dumpsters, barriers, cones, fences,
 * power poles + wires, hanging signs, traffic lights, awnings, parasols. Each kit GLB is merged
 * into one geometry with its palette colours baked per vertex (the kits use one colormap texture),
 * repainted for night (dark albedo, emissive lamp heads) and instanced along the sidewalks.
 */
const gltf = new GLTFLoader();
const CITY = '/night/cc0/city/'; // roads/ and commercial/ each carry their own Textures/colormap.png

export type PropKind = 'lamp' | 'lamp2' | 'dumpster' | 'barrier' | 'cone' | 'fence' | 'pole' | 'sign' | 'hanging' | 'awning' | 'parasol' | 'traffic';
const FILES: Record<PropKind, string> = {
  lamp: 'roads/light-curved', lamp2: 'roads/light-square-double', dumpster: 'roads/dumpster', barrier: 'roads/construction-barrier',
  cone: 'roads/construction-cone', fence: 'roads/construction-fence', pole: 'roads/electricity-pole',
  sign: 'roads/road-sign-street', hanging: 'roads/road-sign-empty-hanging', awning: 'commercial/detail-awning-wide',
  parasol: 'commercial/detail-parasol-a', traffic: 'roads/traffic-light-hanging',
};
/** Target world height per kind (Kenney kits are ~1 u = 1 tile). */
const HEIGHT: Record<PropKind, number> = {
  lamp: 6.5, lamp2: 7, dumpster: 1.6, barrier: 1.1, cone: 0.8, fence: 1.4, pole: 8,
  sign: 3.2, hanging: 4.5, awning: 1.2, parasol: 2.6, traffic: 6.5,
};
const GLOW: Record<PropKind, [number, number]> = {
  lamp: [3.2, 0xffc887], lamp2: [3.0, 0xd8e6ff], dumpster: [0, 0], barrier: [1.2, PAL.sodium], cone: [1.0, PAL.sodium],
  fence: [0, 0], pole: [0, 0], sign: [0.8, PAL.cyan], hanging: [1.6, PAL.magenta], awning: [0.4, PAL.magenta],
  parasol: [0, 0], traffic: [2.5, 0xff3030],
};

/** Reads the kit's colormap once so vertex tints can be baked from UVs. */
const imageCache = new Map<any, { data: Uint8ClampedArray; w: number; h: number }>();
function sampler(map: THREE.Texture | null) {
  const img = map?.image;
  if (!img) return null;
  if (!imageCache.has(img)) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d')!;
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height);
    imageCache.set(img, { data: d.data, w: c.width, h: c.height });
  }
  const { data, w, h } = imageCache.get(img)!;
  return (u: number, v: number) => {
    const x = Math.min(w - 1, Math.max(0, Math.floor((u % 1 + 1) % 1 * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor((1 - ((v % 1 + 1) % 1)) * h)));
    const o = (y * w + x) * 4;
    return [data[o] / 255, data[o + 1] / 255, data[o + 2] / 255] as const;
  };
}

async function loadKind(kind: PropKind) {
  const g = await gltf.loadAsync(`${CITY}${FILES[kind]}.glb`);
  const geos: THREE.BufferGeometry[] = [];
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o: any) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone().applyMatrix4(o.matrixWorld) as THREE.BufferGeometry;
    const n = geo.attributes.position.count;
    const tint = new Float32Array(n * 3);
    const lit = new Float32Array(n);
    const sample = sampler(o.material?.map ?? null);
    const uvA = geo.attributes.uv as THREE.BufferAttribute | undefined;
    const base = o.material?.color ?? new THREE.Color(1, 1, 1);
    for (let i = 0; i < n; i++) {
      let [r, gg, b] = sample && uvA ? sample(uvA.getX(i), uvA.getY(i)) : [base.r, base.g, base.b];
      r *= base.r; gg *= base.g; b *= base.b;
      tint[i * 3] = r; tint[i * 3 + 1] = gg; tint[i * 3 + 2] = b;
      // Lamp glass / warning stripes in the Kenney palette are bright and warm.
      lit[i] = r + gg + b > 2.2 || (r > 0.85 && gg > 0.6 && b < 0.4) ? 1 : 0;
    }
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
    geo.setAttribute('aTint', new THREE.Float32BufferAttribute(tint, 3));
    geo.setAttribute('aLit', new THREE.Float32BufferAttribute(lit, 1));
    geos.push(geo);
  });
  const merged = mergeGeometries(geos, false)!;
  merged.computeBoundingBox();
  const bb = merged.boundingBox!;
  const h = bb.max.y - bb.min.y || 1;
  const k = HEIGHT[kind] / h;
  merged.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
  merged.scale(k, k, k);
  return merged;
}

function propMaterial(glow: number, glowTint: number) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.25 });
  const aLit = attribute('aLit', 'float');
  const aTint = attribute('aTint', 'vec3');
  m.colorNode = aTint.mul(vec3(0.3, 0.31, 0.36)); // night repaint: dark, slightly blue
  m.emissiveNode = uniform(new THREE.Color(glowTint)).mul(aLit).mul(uniform(glow));
  return m;
}

export interface PropPlacement { kind: PropKind; x: number; z: number; yaw?: number; s?: number; y?: number }
export interface PropsOptions { tier: 'high' | 'med' | 'low'; extra?: PropPlacement[] }

export async function createProps({ tier, extra = [] }: PropsOptions) {
  const group = new THREE.Group();
  const r = rng(77);
  const kinds = Object.keys(FILES) as PropKind[];
  const geos: Partial<Record<PropKind, THREE.BufferGeometry>> = {};
  await Promise.all(kinds.map(async (k) => { try { geos[k] = await loadKind(k); } catch (e) { console.warn('[night] prop load failed', k, e); } }));

  const place: Partial<Record<PropKind, THREE.Matrix4[]>> = {};
  const add = (k: PropKind, x: number, z: number, yaw = 0, s = 1, y = CURB_H) => {
    (place[k] ??= []).push(new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(s, s, s),
    ));
  };
  const density = { high: 1, med: 0.7, low: 0.4 }[tier];
  // Catenary cables (thin dark tubes) — between power poles and across the avenue.
  const cableMat = new THREE.MeshStandardNodeMaterial({ color: 0x05060a, roughness: 0.9 });
  const cableGeos: THREE.BufferGeometry[] = [];
  const cable = (a: THREE.Vector3, b: THREE.Vector3, sag: number) => {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(a.clone().lerp(b, t).setY(a.y + (b.y - a.y) * t - Math.sin(t * Math.PI) * sag)); }
    cableGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.05, 4));
  };

  // Avenue sidewalks: lamps every 14 u alternating sides, clutter in between.
  const inner = AVENUE_HALF + 1.2, outer = AVENUE_HALF + SIDEWALK - 1.0;
  for (let z = -26; z > -620; z -= 14) {
    if (isRoad(0, z) && !isSidewalk(inner, z)) continue;
    if (!isSidewalk(inner, z)) continue;
    const side = ((z / 14) | 0) % 2 ? 1 : -1;
    add('lamp', side * inner, z, side > 0 ? Math.PI : 0);
    if (r() < 0.55 * density) add(r() < 0.5 ? 'dumpster' : 'barrier', -side * outer, z + (r() - 0.5) * 8, r() * Math.PI);
    if (r() < 0.35 * density) add('cone', side * (inner + 1.5), z + 5, r() * Math.PI, 0.9);
    if (r() < 0.25 * density) add('hanging', -side * inner, z - 6, side > 0 ? 0 : Math.PI);
    if (r() < 0.2 * density) add('sign', side * outer, z + 3, 0);
  }
  // Cross streets: power poles with wires along them, corner lamps, hanging traffic lights over the avenue.
  for (const cz of CROSS_Z) {
    for (let x = -280; x <= 280; x += 28) {
      if (Math.abs(x) < AVENUE_HALF + SIDEWALK + 2) continue;
      add('pole', x, cz + CROSS_HALF + 2, Math.PI / 2);
      // Two wires to the next pole (skipping the avenue gap).
      if (x + 28 <= 280 && Math.abs(x + 28) >= AVENUE_HALF + SIDEWALK + 2) for (const dy of [0, -0.5]) cable(new THREE.Vector3(x, 7.4 + dy, cz + CROSS_HALF + 2.3), new THREE.Vector3(x + 28, 7.4 + dy, cz + CROSS_HALF + 2.3), 1.2);
      if (r() < 0.4 * density) add('lamp2', x + 8, cz - CROSS_HALF - 2, 0);
      if (r() < 0.3 * density) add('fence', x + (r() - 0.5) * 10, cz - CROSS_HALF - 4, r() < 0.5 ? 0 : Math.PI / 2);
    }
    for (const side of [-1, 1]) add('traffic', side * (AVENUE_HALF + 0.8), cz + side * (CROSS_HALF + 0.8), side > 0 ? Math.PI : 0, 1.1, 0);
  }
  for (const p of extra) add(p.kind, p.x, p.z, p.yaw ?? 0, p.s ?? 1, p.y ?? CURB_H);

  // Street-light glow: a warm bulb at each lamp head and a light pool on the pavement beneath it.
  const lampHeads: THREE.Matrix4[] = [];
  const pools: THREE.Matrix4[] = [];
  for (const k of ['lamp', 'lamp2'] as const) {
    for (const m of place[k] ?? []) {
      const p = new THREE.Vector3().setFromMatrixPosition(m);
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      const arm = new THREE.Vector3(k === 'lamp' ? 1.6 : 0, HEIGHT[k] - 0.35, 0).applyQuaternion(q);
      lampHeads.push(new THREE.Matrix4().makeTranslation(p.x + arm.x, p.y + arm.y, p.z + arm.z));
      pools.push(new THREE.Matrix4().compose(new THREE.Vector3(p.x + arm.x, p.y + 0.04, p.z + arm.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), new THREE.Vector3(9, 9, 1)));
    }
  }
  if (lampHeads.length) {
    const bulbMat = new THREE.MeshBasicNodeMaterial();
    bulbMat.colorNode = color(0xffc887).mul(3.5);
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), bulbMat, lampHeads.length);
    lampHeads.forEach((m, i) => bulbs.setMatrixAt(i, m));
    bulbs.frustumCulled = false;
    group.add(bulbs);
    const poolMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const { uv, float, smoothstep } = await import('three/tsl');
    const d = uv().sub(0.5).length();
    poolMat.colorNode = color(0xffb870).mul(0.9);
    poolMat.opacityNode = float(1).sub(smoothstep(0.08, 0.5, d)).mul(0.5);
    const poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), poolMat, pools.length);
    pools.forEach((m, i) => poolMesh.setMatrixAt(i, m));
    poolMesh.frustumCulled = false;
    group.add(poolMesh);
  }

  let total = 0;
  for (const k of kinds) {
    const geo = geos[k], list = place[k];
    if (!geo || !list?.length) continue;
    const [glow, tint] = GLOW[k];
    const im = new THREE.InstancedMesh(geo, propMaterial(glow, tint || 0x000000), list.length);
    list.forEach((m, i) => im.setMatrixAt(i, m));
    im.frustumCulled = false;
    group.add(im);
    total += list.length;
  }
  // Overhead cables across the avenue every 42 u.
  for (let z = 10; z > -600; z -= 42) {
    if (CROSS_Z.some((cz) => Math.abs(z - cz) < CROSS_HALF + 4)) continue;
    for (let k = 0; k < 2; k++) cable(new THREE.Vector3(-(AVENUE_HALF + SIDEWALK), 9 + k * 1.2, z + k * 0.6), new THREE.Vector3(AVENUE_HALF + SIDEWALK, 9 + k * 1.2, z + k * 0.6), 1.6);
  }
  // One draw for every cable in the city (same material, static).
  if (cableGeos.length) { const m = new THREE.Mesh(mergeGeometries(cableGeos, false)!, cableMat); m.frustumCulled = false; group.add(m); }
  return { group, count: total };
}

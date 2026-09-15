import * as THREE from 'three/webgpu';
import { color, smoothstep, fract, mix, uv, float, texture, luminance, vec2, normalLocal, abs, uniform, glowMaterial } from '../tsl';
import { PAL } from '../palette';
import type { PropPlacement } from '../props';
import type { PathDef } from '../paths';

import type { GroundTextures } from '../streets';
export interface DistrictTextures { facade: THREE.Texture | null; storefronts: THREE.Texture | null; ground?: GroundTextures }

/** A point light the district wants: [x, y, z, colour, intensity, distance?] */
export type LightSpec = [number, number, number, number, number, number?];

export interface DistrictBuild {
  group: THREE.Group;
  props: PropPlacement[];
  lights: LightSpec[];
  /** Optional crowd/patrol path overrides for paths.ts consumers. */
  paths?: PathDef[];
}

export interface DistrictContent {
  jobs: { label: string; rows: number }[];
  projects: { name: string }[];
}

export interface DistrictCtx { content: DistrictContent; tex: DistrictTextures; tier: 'high' | 'med' | 'low' }

/**
 * Mid-rise block textured with the façade atlas on its walls (albedo lifted, windows emissive) and an
 * optional storefront strip on one face. Used for campus buildings and alley backdrops.
 * Size and atlas cell go in as uniforms so every block (eight across the city) shares two programs.
 */
export function facadeBlock(w: number, h: number, d: number, tex: DistrictTextures, seed: number, front: 'pz' | 'nz' | 'px' | 'nx' | null, stripTint?: number) {
  const group = new THREE.Group();
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7, metalness: 0.15 });
  const cell = seed % 4;
  const cellUV = uniform(new THREE.Vector2(cell % 2 * 0.5, Math.floor(cell / 2) * 0.5));
  const wall = float(1).sub(smoothstep(0.4, 0.6, abs(normalLocal.y)));
  if (tex.facade) {
    const rep = uv().mul(uniform(new THREE.Vector2(w / 9, h / 9)));
    const s = texture(tex.facade, fract(rep).mul(0.5).add(cellUV));
    m.colorNode = mix(color(0x1a1c26), s.rgb.mul(1.4).add(0.2), wall);
    m.emissiveNode = s.rgb.mul(smoothstep(0.35, 0.65, luminance(s.rgb))).mul(2.2).mul(wall);
  } else {
    m.colorNode = color(0x1a1c26);
  }
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), m);
  group.add(box);
  // Roof-edge strip
  const stripMat = glowMaterial(stripTint ?? (seed % 2 ? PAL.cyan : PAL.magenta), 1.8);
  for (const [sx, sz, lw, ld] of [[0, d / 2, w, 0.18], [0, -d / 2, w, 0.18], [w / 2, 0, 0.18, d], [-w / 2, 0, 0.18, d]] as const) {
    const s = new THREE.Mesh(new THREE.BoxGeometry(lw + 0.18, 0.18, ld + 0.18), stripMat);
    s.position.set(sx, h, sz);
    group.add(s);
  }
  if (front && tex.storefronts) {
    const fm = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, side: THREE.DoubleSide });
    const fcell = (seed * 7) % 4;
    const fcellUV = uniform(new THREE.Vector2(fcell % 2 * 0.5, Math.floor(fcell / 2) * 0.5));
    const fuv = vec2(fract(uv().x.mul(uniform(w / 14))).mul(0.5), uv().y.mul(0.5)).add(fcellUV);
    const s = texture(tex.storefronts, fuv);
    fm.colorNode = s.rgb.mul(1.0);
    fm.emissiveNode = s.rgb.mul(smoothstep(0.45, 0.7, luminance(s.rgb))).mul(2.0);
    const fw = front === 'pz' || front === 'nz' ? w : d;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(fw, 5.2), fm);
    plane.position.y = 2.6;
    if (front === 'pz') plane.position.z = d / 2 + 0.06;
    if (front === 'nz') { plane.position.z = -d / 2 - 0.06; plane.rotation.y = Math.PI; }
    if (front === 'px') { plane.position.x = w / 2 + 0.06; plane.rotation.y = Math.PI / 2; }
    if (front === 'nx') { plane.position.x = -w / 2 - 0.06; plane.rotation.y = -Math.PI / 2; }
    group.add(plane);
  }
  return group;
}

/** Instanced emissive spheres along a catenary between two points (string lights / lanterns). */
export function stringLights(from: THREE.Vector3, to: THREE.Vector3, n: number, sag: number, radius: number, tint: number, gain = 2.6) {
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    mats.push(new THREE.Matrix4().makeTranslation(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t - Math.sin(t * Math.PI) * sag, from.z + (to.z - from.z) * t));
  }
  const im = new THREE.InstancedMesh(new THREE.SphereGeometry(radius, 6, 4), glowMaterial(tint, gain), mats.length);
  mats.forEach((m, k) => im.setMatrixAt(k, m));
  return im;
}

/** Canvas "H" landing-pad texture. */
export function padTexture(col = '#f2ff3d') {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.strokeStyle = col; g.lineWidth = 22;
  g.beginPath(); g.arc(256, 256, 220, 0, Math.PI * 2); g.stroke();
  g.fillStyle = col; g.font = '700 300px "Rajdhani", "Impact", sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('H', 256, 270);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * Replace plain (non-TSL) materials that are configured identically with one shared instance. Every
 * material instance costs a shader build (~10–20 ms of JS, twice when the water reflects it), so the
 * district builders' habit of `new MeshStandardNodeMaterial({ color })` per element adds seconds to boot.
 * Materials with node overrides (colorNode/emissiveNode/opacityNode/positionNode) are left alone.
 */
export function dedupeMaterials(root: THREE.Object3D) {
  const pool = new Map<string, THREE.Material>();
  let before = 0, after = 0;
  const seen = new Set<string>();
  root.traverse((o: any) => {
    const m: any = o.material;
    if (!m || Array.isArray(m) || !o.isMesh) return;
    if (!seen.has(m.uuid)) { seen.add(m.uuid); before++; }
    if (m.colorNode || m.emissiveNode || m.opacityNode || m.positionNode || m.normalNode || m.roughnessNode || m.metalnessNode || m.map || m.userData?.keep) return;
    const key = [m.type, m.color?.getHex(), m.emissive?.getHex(), m.emissiveIntensity, m.roughness, m.metalness, m.transparent, m.opacity, m.side, m.depthWrite, m.depthTest, m.blending, m.vertexColors, m.wireframe, m.flatShading].join('|');
    const shared = pool.get(key);
    if (shared) o.material = shared; else pool.set(key, m);
  });
  const left = new Set<string>();
  root.traverse((o: any) => { if (o.isMesh && o.material && !Array.isArray(o.material)) left.add(o.material.uuid); });
  after = left.size;
  return { before, after };
}

import * as THREE from 'three/webgpu';
import {
  positionWorld, step, fract, smoothstep, hash, floor, mix, color, float, texture, abs, max, min, vec2, normalMap, vec3,
} from 'three/tsl';
import { loader, rng } from './palette';

/*
 * Street level. One big ground plane zoned in the shader: the avenue (|x| < AVENUE_HALF) and three
 * cross streets are asphalt with lane paint and crosswalks; SIDEWALK-wide paver bands flank them;
 * everything else is plaza concrete. Surfaces use the fal ground textures (albedo + derived normal
 * maps) when present, else canvas fallbacks. CPU helpers (isRoad / isSidewalk) let props, curbs,
 * traffic and people agree with the shader.
 */
export const AVENUE_HALF = 12;
export const SIDEWALK = 6;
export const CROSS_Z = [-60, -144, -228];
export const CROSS_HALF = 8;

export const isRoad = (x: number, z: number) => Math.abs(x) < AVENUE_HALF || CROSS_Z.some((cz) => Math.abs(z - cz) < CROSS_HALF);
export const isSidewalk = (x: number, z: number) =>
  !isRoad(x, z) && (Math.abs(x) < AVENUE_HALF + SIDEWALK || CROSS_Z.some((cz) => Math.abs(z - cz) < CROSS_HALF + SIDEWALK));
export const CURB_H = 0.22;
/** Waterfront edge: streets stop here, the bay begins. */
export const QUAY_Z = -20;

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number, r: () => number) => void, seed: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size, rng(seed));
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Grainy asphalt fallback. */
const asphaltFallback = () => canvasTex(512, (g, s, r) => {
  g.fillStyle = '#16171d';
  g.fillRect(0, 0, s, s);
  for (let i = 0; i < 9000; i++) {
    const v = 14 + r() * 26;
    g.fillStyle = `rgb(${v},${v + 1},${v + 5})`;
    g.fillRect(r() * s, r() * s, 1 + r() * 2, 1 + r() * 2);
  }
}, 21);

/** Concrete pavers fallback. */
const paverFallback = () => canvasTex(512, (g, s, r) => {
  g.fillStyle = '#23242c';
  g.fillRect(0, 0, s, s);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
    const v = 30 + r() * 14;
    g.fillStyle = `rgb(${v},${v + 1},${v + 6})`;
    g.fillRect(i * s / 4 + 3, j * s / 4 + 3, s / 4 - 6, s / 4 - 6);
  }
}, 22);

export interface GroundTextures {
  asphalt: THREE.Texture; asphaltN: THREE.Texture | null;
  pavers: THREE.Texture; paversN: THREE.Texture | null;
  plaza: THREE.Texture | null; plazaN: THREE.Texture | null;
  planks: THREE.Texture | null; planksN: THREE.Texture | null;
}

const rep = (t: THREE.Texture, srgb = true) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
const tryLoad = (p: string, srgb = true) => loader.loadAsync(p).then((t) => rep(t, srgb)).catch(() => null);

/** Loads the fal ground set (public/night/ground/*.jpg + *-n.jpg), falling back to canvas textures. */
export async function loadGroundTextures(): Promise<GroundTextures> {
  const [asphalt, asphaltN, pavers, paversN, plaza, plazaN, planks, planksN] = await Promise.all([
    tryLoad('/night/ground/asphalt.jpg'), tryLoad('/night/ground/asphalt-n.jpg', false),
    tryLoad('/night/ground/pavers.jpg'), tryLoad('/night/ground/pavers-n.jpg', false),
    tryLoad('/night/ground/plaza.jpg'), tryLoad('/night/ground/plaza-n.jpg', false),
    tryLoad('/night/ground/planks.jpg'), tryLoad('/night/ground/planks-n.jpg', false),
  ]);
  return {
    asphalt: asphalt ?? asphaltFallback(), asphaltN, pavers: pavers ?? paverFallback(), paversN, plaza, plazaN, planks, planksN,
  };
}

/** Standard "wet surface" material from an albedo + normal pair, tiled per world unit. */
export function groundMaterial(map: THREE.Texture, normal: THREE.Texture | null, tile: number, opts: { roughness?: number; tint?: number; normalScale?: number; rotate?: boolean } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: opts.roughness ?? 0.55, metalness: 0.08 });
  // `rotate` swaps the tiling axes so a directional texture (planks) runs along world X instead of Z.
  const uvw = (opts.rotate ? positionWorld.zx : positionWorld.xz).mul(1 / tile);
  m.colorNode = texture(map, uvw).rgb.mul(opts.tint !== undefined ? color(opts.tint) : vec3(1, 1, 1));
  if (normal) m.normalNode = normalMap(texture(normal, uvw), vec2(opts.normalScale ?? 0.8, opts.normalScale ?? 0.8));
  return m;
}

export function createStreets(tex: GroundTextures) {
  const group = new THREE.Group();
  const tileA = 9, tileP = 6;
  const uvA = positionWorld.xz.mul(1 / tileA), uvP = positionWorld.xz.mul(1 / tileP);
  const asphalt = texture(tex.asphalt, uvA);
  const pave = texture(tex.pavers, uvP);
  const x = positionWorld.x, z = positionWorld.z;

  // Zones
  const ax = abs(x);
  const nearest = CROSS_Z.map((cz) => abs(z.sub(cz))).reduce((a, b) => min(a, b));
  const road = max(step(ax, AVENUE_HALF), step(nearest, CROSS_HALF));
  const walk = max(step(ax, AVENUE_HALF + SIDEWALK), step(nearest, CROSS_HALF + SIDEWALK)).mul(float(1).sub(road));

  // Lane paint (avenue: yellow centre dashes + white edges; cross streets: white dashes) and crosswalks.
  const centreDash = step(ax, 0.18).mul(step(fract(z.mul(1 / 6)), 0.5));
  const edgeLine = step(abs(ax.sub(AVENUE_HALF - 0.5)), 0.12);
  const crossDash = step(nearest, 0.18).mul(step(fract(x.mul(1 / 6)), 0.5));
  const nearX = step(ax, AVENUE_HALF).mul(step(abs(nearest.sub(CROSS_HALF + 2.2)), 1.4));
  const zebra = nearX.mul(step(fract(x.mul(1 / 1.6)), 0.55));
  const paintY = centreDash.mul(road);
  const paintW = max(edgeLine.mul(step(ax, AVENUE_HALF)), max(crossDash, zebra)).mul(road);

  // Wet puddles on the asphalt (hash cells, cheap).
  const cell = floor(positionWorld.xz.mul(0.18));
  const puddle = smoothstep(0.55, 0.75, hash(cell.x.mul(11.3).add(cell.y.mul(7.7)))).mul(road);

  const m = new THREE.MeshStandardNodeMaterial({ metalness: 0.1 });
  const plazaC = pave.rgb.mul(0.6);
  const walkC = pave.rgb.mul(0.95);
  const roadC = mix(asphalt.rgb, asphalt.rgb.mul(0.55), puddle);
  let col: any = mix(plazaC, walkC, walk);
  col = mix(col, roadC, road);
  col = mix(col, color(0xd9c56a), paintY.mul(0.9));
  col = mix(col, color(0xd8dde8), paintW.mul(0.85));
  m.colorNode = col;
  m.roughnessNode = mix(mix(float(0.8), float(0.45), road), float(0.06), puddle);
  m.emissiveNode = mix(color(0xd9c56a).mul(paintY), color(0xd8dde8).mul(paintW), paintW).mul(0.25);
  if (tex.asphaltN && tex.paversN) {
    const nA = texture(tex.asphaltN, uvA), nP = texture(tex.paversN, uvP);
    m.normalNode = normalMap(mix(nP, nA, road), vec2(0.9, 0.9));
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(760, QUAY_Z + 640), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, (QUAY_Z - 640) / 2);
  group.add(mesh);

  // Sidewalk slabs (raised by the curb height) so walkers and props sit above the road.
  const walkMat = groundMaterial(tex.pavers, tex.paversN, tileP, { roughness: 0.7 });
  const addWalk = (w: number, d: number, cx: number, cz: number) => {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(w, CURB_H, d), walkMat);
    slab.position.set(cx, CURB_H / 2, cz);
    group.add(slab);
  };
  const zStart = QUAY_Z - 1, zEnd = -640;
  let segStart = zStart;
  for (const cz of [...CROSS_Z, zEnd - CROSS_HALF]) {
    const segEnd = cz + CROSS_HALF;
    const len = segStart - segEnd;
    if (len > 0) for (const side of [-1, 1]) addWalk(SIDEWALK, len, side * (AVENUE_HALF + SIDEWALK / 2), (segStart + segEnd) / 2);
    segStart = cz - CROSS_HALF;
  }
  for (const cz of CROSS_Z) for (const side of [-1, 1]) {
    for (const half of [-1, 1]) addWalk(300, SIDEWALK, half * (AVENUE_HALF + SIDEWALK + 150), cz + side * (CROSS_HALF + SIDEWALK / 2));
  }
  return group;
}

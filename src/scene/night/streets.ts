import * as THREE from 'three/webgpu';
import {
  positionWorld, step, fract, smoothstep, hash, floor, mix, color, float, texture, abs, max, min, vec2, normalMap, uniform,
} from './tsl';
import { loader, params, rng } from './palette';
import { MARKET, isMarketLane } from './market-layout';

/*
 * Street level. One big ground plane zoned in the shader: the avenue (|x| < AVENUE_HALF) and three
 * cross streets are asphalt with lane paint and crosswalks; SIDEWALK-wide paver bands flank them;
 * everything else is plaza concrete. Surfaces use the fal ground textures (albedo + derived normal
 * maps) when present, else canvas fallbacks. CPU helpers (isRoad / isSidewalk) let props, curbs,
 * traffic and people agree with the shader.
 */
export const AVENUE_HALF = 10;
export const SIDEWALK = 6;
export const CROSS_Z = [-60, -144, -228];
export const CROSS_HALF = 8;

export const isRoad = (x: number, z: number) => !isMarketLane(x,z) && (Math.abs(x) < AVENUE_HALF || CROSS_Z.some((cz) => Math.abs(z - cz) < CROSS_HALF));
export const isSidewalk = (x: number, z: number) =>
  !isRoad(x, z) && (Math.abs(x) < AVENUE_HALF + SIDEWALK || CROSS_Z.some((cz) => Math.abs(z - cz) < CROSS_HALF + SIDEWALK));
export const CURB_H = 0.22;
/**
 * District ground patches (the campus plaza, the lobby forecourts) that overlap the sidewalk slabs are built this much
 * taller, so their top faces sit just above the slabs' instead of coplanar with them (coplanar faces z-fight into
 * blocky interleaved patches, worst on phones). 1.5 cm: invisible as a step, far above depth-buffer resolution.
 */
export const PATCH_LIFT = 0.015;
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
  asphalt: THREE.Texture; asphaltN: THREE.Texture | null; asphaltR: THREE.Texture | null; asphaltAO: THREE.Texture | null;
  pavers: THREE.Texture; paversN: THREE.Texture | null; paversR: THREE.Texture | null; paversAO: THREE.Texture | null;
  plaza: THREE.Texture | null; plazaN: THREE.Texture | null; plazaR: THREE.Texture | null; plazaAO: THREE.Texture | null;
  planks: THREE.Texture | null; planksN: THREE.Texture | null; planksR: THREE.Texture | null; planksAO: THREE.Texture | null;
}

/** Tiling + sRGB, and 4× anisotropy: the ground is seen at grazing angles from the follow camera (a sampler setting, no new program). */
const rep = (t: THREE.Texture, srgb = true) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
const tryLoad = (p: string, srgb = true) => loader.loadAsync(p).then((t) => rep(t, srgb)).catch(() => null);

/**
 * Loads the fal ground set (public/night/ground/*.jpg + *-n/-r/-ao.jpg), falling back to canvas
 * textures. The roughness and occlusion maps are derived from the albedo by scripts/texture-maps.py
 * and ship at half its resolution; `?norough` and `?noao` drop them for A/B comparison.
 */
export async function loadGroundTextures(): Promise<GroundTextures> {
  const wantR = !params.has('norough'), wantAO = !params.has('noao');
  const data = (p: string, want: boolean) => (want ? tryLoad(p, false) : Promise.resolve(null));
  const [asphalt, asphaltN, asphaltR, asphaltAO, pavers, paversN, paversR, paversAO,
    plaza, plazaN, plazaR, plazaAO, planks, planksN, planksR, planksAO] = await Promise.all([
    tryLoad('/night/ground/asphalt.jpg'), tryLoad('/night/ground/asphalt-n.jpg', false),
    data('/night/ground/asphalt-r.jpg', wantR), data('/night/ground/asphalt-ao.jpg', wantAO),
    tryLoad('/night/ground/pavers.jpg'), tryLoad('/night/ground/pavers-n.jpg', false),
    data('/night/ground/pavers-r.jpg', wantR), data('/night/ground/pavers-ao.jpg', wantAO),
    tryLoad('/night/ground/plaza.jpg'), tryLoad('/night/ground/plaza-n.jpg', false),
    data('/night/ground/plaza-r.jpg', wantR), data('/night/ground/plaza-ao.jpg', wantAO),
    tryLoad('/night/ground/planks.jpg'), tryLoad('/night/ground/planks-n.jpg', false),
    data('/night/ground/planks-r.jpg', wantR), data('/night/ground/planks-ao.jpg', wantAO),
  ]);
  return {
    asphalt: asphalt ?? asphaltFallback(), asphaltN, asphaltR, asphaltAO,
    pavers: pavers ?? paverFallback(), paversN, paversR, paversAO,
    plaza, plazaN, plazaR, plazaAO, planks, planksN, planksR, planksAO,
  };
}

/** How far a derived roughness map may swing a surface either side of its authored value. */
const ROUGH_VARIATION = 0.55;

/**
 * Standard "wet surface" material from an albedo + normal pair, tiled per world unit. Tile, axis swap,
 * tint and normal scale are uniforms, so every ground surface in the city shares one program.
 */
export function groundMaterial(
  map: THREE.Texture,
  normal: THREE.Texture | null,
  tile: number,
  opts: { roughness?: number; tint?: number; normalScale?: number; rotate?: boolean; rough?: THREE.Texture | null; ao?: THREE.Texture | null } = {},
) {
  const base = opts.roughness ?? 0.55;
  const m = new THREE.MeshStandardNodeMaterial({ roughness: base, metalness: 0.08 });
  // `rotate` swaps the tiling axes so a directional texture (planks) runs along world X instead of Z.
  const uvw = mix(positionWorld.xz, positionWorld.zx, uniform(opts.rotate ? 1 : 0)).mul(uniform(1 / tile));
  m.colorNode = texture(map, uvw).rgb.mul(color(opts.tint ?? 0xffffff));
  const ns = opts.normalScale ?? 0.8;
  if (normal) m.normalNode = normalMap(texture(normal, uvw), uniform(new THREE.Vector2(ns, ns)));
  // The derived map modulates the per-surface roughness around its own midpoint rather than
  // replacing it, so each call site keeps the look it was tuned for and only gains variation.
  if (opts.rough) m.roughnessNode = texture(opts.rough, uvw).r.sub(0.5).mul(uniform(ROUGH_VARIATION)).add(uniform(base)).clamp(0.04, 1);
  if (opts.ao) m.aoNode = texture(opts.ao, uvw).r;
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
  const market = step(MARKET.x0,x).mul(step(x,MARKET.x1)).mul(step(abs(z.sub(MARKET.z)),MARKET.halfWidth));
  const road = max(step(ax, AVENUE_HALF), step(nearest, CROSS_HALF)).mul(float(1).sub(market));
  const walk = max(market,max(step(ax, AVENUE_HALF + SIDEWALK), step(nearest, CROSS_HALF + SIDEWALK))).mul(float(1).sub(road));

  // Lane paint (avenue: yellow centre dashes + white edges; cross streets: white dashes) and crosswalks.
  const centreDash = step(ax, 0.18).mul(step(fract(z.mul(1 / 6)), 0.5));
  const edgeLine = step(abs(ax.sub(AVENUE_HALF - 0.5)), 0.12);
  const crossDash = step(nearest, 0.18).mul(step(fract(x.mul(1 / 6)), 0.5));
  const nearX = step(ax, AVENUE_HALF).mul(step(abs(nearest.sub(CROSS_HALF + 2.2)), 1.4));
  const nearZ=step(nearest,CROSS_HALF).mul(step(abs(ax.sub(AVENUE_HALF+3.8)),2.6));
  const zebra = max(nearX.mul(step(fract(x.mul(1 / 1.6)), 0.55)),nearZ.mul(step(fract(z.mul(1 / 1.6)),.55)));
  const paintY = centreDash.mul(road);
  const stopBars=max(step(ax,AVENUE_HALF).mul(step(abs(nearest.sub(CROSS_HALF+SIDEWALK+1)),.18)),
    step(nearest,CROSS_HALF).mul(step(abs(ax.sub(AVENUE_HALF+SIDEWALK+1)),.18)));
  const paintW = max(stopBars,max(edgeLine.mul(step(ax, AVENUE_HALF)), max(crossDash, zebra))).mul(road);

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
  // Zone roughness stays authored (plaza 0.8 → road 0.45 → puddle 0.06). The derived maps only add
  // grain on top of it, and the puddle term is applied last so standing water stays a mirror.
  const zoneRough = mix(float(0.8), float(0.45), road);
  let roughN: any = zoneRough;
  if (tex.asphaltR && tex.paversR) {
    const grain = mix(texture(tex.paversR, uvP).r, texture(tex.asphaltR, uvA).r, road).sub(0.5);
    roughN = zoneRough.add(grain.mul(ROUGH_VARIATION)).clamp(0.12, 1);
  }
  m.roughnessNode = mix(roughN, float(0.06), puddle);
  // Occlusion darkens grout and pits, but never the lane paint or the wet patches that read as light.
  if (tex.asphaltAO && tex.paversAO) {
    const occ = mix(texture(tex.paversAO, uvP).r, texture(tex.asphaltAO, uvA).r, road);
    m.aoNode = mix(occ, float(1), max(puddle, max(paintY, paintW)));
  }
  m.emissiveNode = mix(color(0xd9c56a).mul(paintY), color(0xd8dde8).mul(paintW), paintW).mul(0.25);
  if (tex.asphaltN && tex.paversN) {
    const nA = texture(tex.asphaltN, uvA), nP = texture(tex.paversN, uvP);
    m.normalNode = normalMap(mix(nP, nA, road), vec2(0.9, 0.9));
  }
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(760, QUAY_Z + 640), m);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, 0, (QUAY_Z - 640) / 2);
  group.add(mesh);

  // Visible map perimeter: the ground ends against retaining walls, never an invisible district fence.
  const boundaryMat = new THREE.MeshStandardNodeMaterial({ color: 0x252935, roughness: .85 });
  for (const x of [-380, 380]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(1.2, 4, 620), boundaryMat);
    wall.position.set(x, 2, -330); group.add(wall);
  }
  const northWall = new THREE.Mesh(new THREE.BoxGeometry(760, 4, 1.2), boundaryMat);
  northWall.position.set(0, 2, -640); group.add(northWall);

  // Sidewalk slabs (raised by the curb height) so walkers and props sit above the road.
  const walkMat = groundMaterial(tex.pavers, tex.paversN, tileP, { roughness: 0.7, rough: tex.paversR, ao: tex.paversAO });
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
  // Fill the former road to sidewalk height; no markings or curb down the shopping lane.
  const marketPaving = new THREE.Mesh(new THREE.BoxGeometry(MARKET.x1-MARKET.x0,CURB_H,CROSS_HALF*2),
    groundMaterial(tex.pavers,tex.paversN,3,{roughness:.65,rough:tex.paversR,ao:tex.paversAO}));
  marketPaving.position.set((MARKET.x0+MARKET.x1)/2,CURB_H/2,MARKET.z);
  group.add(marketPaving);
  return group;
}

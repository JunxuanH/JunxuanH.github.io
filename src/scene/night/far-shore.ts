import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { color, mix, smoothstep, positionWorld, vec3, dot, sin, fract, step, float } from './tsl';

/**
 * The far shore: a low silhouette of city on the far side of the bay, east and west.
 *
 * The painted plate (backdrop.ts) is a north wall, and the city fills the south, so on foot at the pier
 * the two open directions had nothing in them at all — measured from the pier looking west, 42 % of the
 * frame was sky whose luminance changed by 0.1 from the horizon to the top of frame, with the bay's own
 * far edge cutting across it as a line. A second painting was the obvious answer and the wrong one: the
 * repo's note is that side plates read as nearby wallpaper from the streets, which is why they were
 * removed. This is real geometry instead, so it holds still against the camera the way distance does.
 *
 * Two straight banks rather than a ring. Flat, like the plate's panels, so nothing warps; far enough out
 * (±880 u, against a bay that ends at ±500) that they read as another shore and not as a wall; and they
 * fade into the horizon mist before they reach the plate, rather than ending on a corner. Merged to one
 * draw per bank, no textures.
 */

/** Distance out to each bank, and the stretch of z they cover. */
const BANK_X = 880, Z_FROM = -620, Z_TO = 1000;
/**
 * The banks do not stop, they dissolve. North they fade out before z −560, where the painted plate takes
 * over: the backdrop writes no depth, so a silhouette drawn there would land on top of the painting.
 * South they fade behind the city. The fade is in colour, toward the mist the dome paints on the horizon,
 * rather than in alpha — one opaque draw, and nothing to sort.
 */
const N_OUT = -560, N_IN = -250, S_IN = 840, S_OUT = 1000;
/** Silhouette heights. A bank at this distance subtends ~2°, which is a strip, which is the point. */
const H_MIN = 14, H_MAX = 62;

/** Deterministic so the shore is the same city on every load (and in every screenshot). */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function bank(x: number, seed: number) {
  const rand = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  for (let z = Z_FROM; z < Z_TO; ) {
    const w = 16 + rand() * 46;          // along the shore
    const d = 14 + rand() * 30;          // into it: the bank has a little depth at grazing angles
    const h = H_MIN + Math.pow(rand(), 1.7) * (H_MAX - H_MIN); // mostly low, a few towers
    parts.push(new THREE.BoxGeometry(d, h, w).translate(x + (rand() - 0.5) * 34, h / 2 - 3, z + w / 2));
    z += w + rand() * 12;
  }
  return mergeGeometries(parts, false)!;
}

export function createFarShore() {
  const group = new THREE.Group();
  group.name = 'far-shore';
  const mat = new THREE.MeshBasicNodeMaterial();
  // Baked mist, not scene fog: at this range the haze would swallow the shore whole.
  mat.fog = false;
  // Bases dissolve into the horizon band the dome paints (sky.ts), tops darken — the shape reads as
  // distance rather than as a cut-out, and it never competes with the city's own neon.
  const lift = smoothstep(-3.0, 46.0, positionWorld.y);
  const solid = mix(color(0x6a5570), color(0x2a2536), lift);
  const near = smoothstep(N_OUT, N_IN, positionWorld.z).mul(smoothstep(S_OUT, S_IN, positionWorld.z));
  const mist = color(0x6d5573);
  const body = mix(mist, solid, near);
  // Sparse windows on a coarse grid: at ~1000 u a cell of 7 u is about five pixels, which stays still
  // instead of crawling. Density is low on purpose; this is a shore at night, not a lit skyline.
  const cell = positionWorld.mul(vec3(1 / 7.0, 1 / 6.5, 1 / 7.0)).floor();
  const hash = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))).mul(43758.5453));
  const windows = step(float(0.955), hash).mul(smoothstep(-2.0, 8.0, positionWorld.y)).mul(near);
  mat.colorNode = body.add(color(0xffb473).mul(windows).mul(0.75));
  for (const [x, seed] of [[BANK_X, 12345], [-BANK_X, 987654]] as const) {
    const mesh = new THREE.Mesh(bank(x, seed), mat);
    mesh.name = `far-shore:${x > 0 ? 'east' : 'west'}`;
    mesh.frustumCulled = true;
    group.add(mesh);
  }
  return group;
}

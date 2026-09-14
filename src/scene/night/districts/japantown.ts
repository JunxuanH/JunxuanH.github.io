import * as THREE from 'three/webgpu';
import { color, positionLocal, positionWorld, smoothstep, mix, pow, sin, time, length, float, uv, step, fract } from '../tsl';
import { rng } from '../palette';
import { ANCHORS } from '../journey';
import { neonText, createKeyedSigns } from '../signs';
import { CURB_H, CROSS_Z, groundMaterial } from '../streets';
import { THEMES } from '../theme';
import { facadeBlock, stringLights, type DistrictBuild, type DistrictCtx } from './shared';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Education district — Japantown / Sakura campus. Pagoda-roofed campus blocks around a paved plaza,
 * a vermilion torii on the approach from the z −60 cross street, stone lanterns, paper-lantern
 * strings, holographic sakura trees, a koi pond, kanji neon. Petals come from particles.ts.
 */

const VERMILION = 0xc8351f;

/** Square pagoda roof tier: a 4-sided lathe with a concave profile, rotated so its edges align with the block. */
function pagodaRoof(w: number, d: number, tiers: number, tint: number) {
  const group = new THREE.Group();
  const tileMat = new THREE.MeshStandardNodeMaterial({ color: 0x14131c, roughness: 0.6, metalness: 0.3 });
  const eaveMat = new THREE.MeshBasicNodeMaterial();
  eaveMat.colorNode = color(tint).mul(2.0);
  const profile: THREE.Vector2[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    profile.push(new THREE.Vector2(Math.pow(1 - t, 1.7) * (1 - 0.02) + 0.02, t)); // concave slope, r 1→0
  }
  for (let k = 0; k < tiers; k++) {
    const shrink = Math.pow(0.78, k);
    const hw = (w / 2 + 1.6) * shrink, hd = (d / 2 + 1.6) * shrink;
    const y = k * 4.2;
    const roof = new THREE.Mesh(new THREE.LatheGeometry(profile, 4).rotateY(Math.PI / 4), tileMat);
    roof.scale.set(hw * Math.SQRT2, 3.0 * shrink, hd * Math.SQRT2);
    roof.position.y = y;
    group.add(roof);
    // Eave light: a thin square ring at the roof lip.
    for (const [sx, sz, lw, ld] of [[0, hd, hw * 2, 0.16], [0, -hd, hw * 2, 0.16], [hw, 0, 0.16, hd * 2], [-hw, 0, 0.16, hd * 2]] as const) {
      const e = new THREE.Mesh(new THREE.BoxGeometry(lw + 0.16, 0.16, ld + 0.16), eaveMat);
      e.position.set(sx, y + 0.1, sz);
      group.add(e);
    }
    if (k < tiers - 1) {
      // Upper storey wall between tiers
      const wall = new THREE.Mesh(new THREE.BoxGeometry(hw * 2 * 0.72, 4.2, hd * 2 * 0.72), new THREE.MeshStandardNodeMaterial({ color: 0x1a1620, roughness: 0.7 }));
      wall.position.y = y + 2.1 + 1.2;
      group.add(wall);
    }
  }
  return group;
}

function torii(h = 9, w = 9) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.55, metalness: 0.1 });
  mat.colorNode = color(VERMILION);
  mat.emissiveNode = color(0xff5a3a).mul(0.7);
  for (const x of [-w / 2 + 0.6, w / 2 - 0.6]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, h, 10).translate(0, h / 2, 0), mat);
    post.position.x = x;
    group.add(post);
  }
  const kasagi = new THREE.Mesh(new THREE.BoxGeometry(w + 1.6, 0.55, 0.7), mat);
  kasagi.position.y = h;
  const shimaki = new THREE.Mesh(new THREE.BoxGeometry(w + 0.6, 0.35, 0.55), mat);
  shimaki.position.y = h - 0.55;
  const nuki = new THREE.Mesh(new THREE.BoxGeometry(w, 0.32, 0.45), mat);
  nuki.position.y = h - 2.0;
  // Upturned kasagi ends
  for (const s of [-1, 1]) {
    const tip = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.55, 0.7), mat);
    tip.position.set(s * (w / 2 + 1.2), h + 0.28, 0);
    tip.rotation.z = s * -0.28;
    group.add(tip);
  }
  const plaque = neonText('学園', '#ffffff', 1.6, { gain: 1.8 });
  plaque.position.set(0, h - 1.2, 0.3);
  group.add(kasagi, shimaki, nuki, plaque);
  return group;
}

/** Stone lanterns: one merged stone mesh + one instanced glow for all of them. */
function stoneLanterns(positions: [number, number, number][], tint: number) {
  const stoneGeo = mergeGeometries([
    new THREE.BoxGeometry(0.9, 0.35, 0.9).translate(0, 0.175, 0),
    new THREE.CylinderGeometry(0.16, 0.2, 1.3, 8).translate(0, 0.35 + 0.65, 0),
    new THREE.BoxGeometry(0.7, 0.6, 0.7).translate(0, 1.65 + 0.3, 0),
    new THREE.ConeGeometry(0.7, 0.45, 4).rotateY(Math.PI / 4).translate(0, 2.25 + 0.22, 0),
  ], false)!;
  const stone = new THREE.MeshStandardNodeMaterial({ color: 0x2a2c34, roughness: 0.9 });
  const glowMat = new THREE.MeshBasicNodeMaterial();
  glowMat.colorNode = color(tint).mul(2.4);
  const stones = new THREE.InstancedMesh(stoneGeo, stone, positions.length);
  const glows = new THREE.InstancedMesh(new THREE.BoxGeometry(0.5, 0.4, 0.5).translate(0, 1.95, 0), glowMat, positions.length);
  positions.forEach(([x, y, z], i) => { const m = new THREE.Matrix4().makeTranslation(x, y, z); stones.setMatrixAt(i, m); glows.setMatrixAt(i, m); });
  const group = new THREE.Group();
  group.add(stones, glows);
  return group;
}

/** Holographic cherry trees: one merged trunk mesh + one merged canopy mesh for the whole grove. */
function sakuraGrove(spots: [number, number, number, number][], tint: number) {
  const trunks: THREE.BufferGeometry[] = [], lumps: THREE.BufferGeometry[] = [];
  for (const [x, y, z, seed] of spots) {
    const r = rng(seed);
    trunks.push(new THREE.CylinderGeometry(0.16, 0.3, 3.2, 7).translate(x, y + 1.6, z));
    for (let i = 0; i < 12; i++) {
      const rad = 0.55 + r() * 0.6;
      const ang = r() * Math.PI * 2, dist = r() * 2.2;
      lumps.push(new THREE.SphereGeometry(rad, 8, 6).translate(x + Math.cos(ang) * dist, y + 3.4 + r() * 2.6, z + Math.sin(ang) * dist));
    }
  }
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.8 });
  mat.colorNode = color(0x3a1440);
  // Height above the plaza drives the gradient (world y − plaza y).
  mat.emissiveNode = mix(color(0x7a2a70), color(tint), pow(smoothstep(2.0, 6.5, positionWorld.y.sub(CURB_H)), 1.2)).mul(0.8);
  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergeGeometries(trunks, false)!, new THREE.MeshStandardNodeMaterial({ color: 0x1a1420, roughness: 0.9 })));
  group.add(new THREE.Mesh(mergeGeometries(lumps, false)!, mat));
  return group;
}

/** Koi pond: dark disc with concentric emissive ripples (koi sprites are particles). */
function koiPond(radius: number, tint: number) {
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0.2 });
  const d = length(positionLocal.xy);
  const ripple = pow(sin(d.mul(2.6).sub(time.mul(1.6))).mul(0.5).add(0.5), 6.0);
  const edge = smoothstep(radius, radius - 0.6, d);
  mat.colorNode = color(0x061018);
  mat.emissiveNode = color(tint).mul(ripple).mul(0.35).mul(edge);
  const pond = new THREE.Mesh(new THREE.CircleGeometry(radius, 40), mat);
  pond.rotation.x = -Math.PI / 2;
  return pond;
}

export async function create(ctx: DistrictCtx): Promise<DistrictBuild> {
  const T = THEMES.education;
  const group = new THREE.Group();
  const r = rng(303);
  const c = ANCHORS.campus;
  const streetZ = CROSS_Z[0]; // −60: the approach street north of the plaza

  // Plaza paving (slightly warm stone) and a stepped approach from the street.
  const g = ctx.tex.ground;
  const plazaMat = g?.plaza ? groundMaterial(g.plaza, g.plazaN, 7, { roughness: 0.5 }) : new THREE.MeshStandardNodeMaterial({ color: T.ground, roughness: 0.8 });
  const plaza = new THREE.Mesh(new THREE.BoxGeometry(84, CURB_H, 62), plazaMat);
  plaza.position.set(c.x, CURB_H / 2, c.z);
  group.add(plaza);
  const approach = new THREE.Mesh(new THREE.BoxGeometry(18, CURB_H, 18), plazaMat);
  approach.position.set(c.x, CURB_H / 2, streetZ - 9 - 0.5);
  group.add(approach);

  // Campus blocks with pagoda roofs: two flanking the plaza, one main hall at the back.
  const blocks: [number, number, number, number, number, 'pz' | 'nz' | 'px' | 'nx', number, number][] = [
    // dx, dz, w, h, d, front, seed, roof tiers
    [0, -20, 34, 14, 18, 'pz', 1, 3],
    [-30, 4, 16, 11, 22, 'px', 2, 2],
    [30, 6, 16, 12, 20, 'nx', 3, 2],
  ];
  for (const [dx, dz, w, h, d, front, seed, tiers] of blocks) {
    const b = facadeBlock(w, h, d, ctx.tex, seed, front, T.primary);
    b.position.set(c.x + dx, CURB_H, c.z + dz);
    group.add(b);
    const roof = pagodaRoof(w, d, tiers, T.primary);
    roof.position.set(c.x + dx, CURB_H + h, c.z + dz);
    group.add(roof);
  }
  // Main hall signage
  const sign = neonText('UC BERKELEY', T.signGlow, 16, { gain: 1.3 });
  sign.position.set(c.x, CURB_H + 11.0, c.z - 20 + 9.05);
  group.add(sign);

  // Torii on the approach, stone lanterns lining the path from the street to the plaza.
  const gate = torii(9, 10);
  gate.position.set(c.x, CURB_H, streetZ - 12);
  group.add(gate);
  const lanternSpots: [number, number, number][] = [];
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) lanternSpots.push([c.x + s * 6.5, CURB_H, streetZ - 14 - i * 5]);
  group.add(stoneLanterns(lanternSpots, T.warm));

  // Sakura trees around the plaza, koi pond in the middle-left, lantern strings across.
  const grove: [number, number, number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + r() * 0.3;
    grove.push([c.x + Math.cos(ang) * (26 + r() * 8), CURB_H, c.z + 4 + Math.sin(ang) * (18 + r() * 6), 50 + i]);
  }
  group.add(sakuraGrove(grove, T.primary));
  const pond = koiPond(6.5, T.secondary);
  pond.position.set(c.x - 12, CURB_H + 0.03, c.z + 10);
  group.add(pond);
  for (let k = 0; k < 4; k++) {
    const z = c.z - 10 + k * 8;
    group.add(stringLights(new THREE.Vector3(c.x - 24, 6.4, z), new THREE.Vector3(c.x + 24, 6.4, z), 14, 1.0, 0.34, k % 2 ? 0xff6a7a : 0xffb070, 2.2));
  }

  // Kanji neon cutouts on the flanking blocks (JP sheet if keyed, else the generic set).
  const jp = await createKeyedSigns([
    { x: c.x - 30 + 8.1, y: CURB_H + 7, z: c.z + 4 - 6, yaw: Math.PI / 2, w: 5 },
    { x: c.x - 30 + 8.1, y: CURB_H + 7, z: c.z + 4 + 6, yaw: Math.PI / 2, w: 5 },
    { x: c.x + 30 - 8.1, y: CURB_H + 7, z: c.z + 6 - 5, yaw: -Math.PI / 2, w: 5 },
    { x: c.x + 30 - 8.1, y: CURB_H + 7, z: c.z + 6 + 5, yaw: -Math.PI / 2, w: 5 },
  ], ['jp-1', 'jp-2', 'jp-3', 'jp-4']);
  group.add(jp);

  const props: DistrictBuild['props'] = [];
  for (const [dx, dz] of [[-24, -6], [24, -6], [-24, 22], [24, 22]] as const) props.push({ kind: 'lamp', x: c.x + dx, z: c.z + dz, yaw: Math.PI / 2 });
  for (const [dx, dz] of [[-38, 26], [38, -14]] as const) props.push({ kind: 'dumpster', x: c.x + dx, z: c.z + dz, yaw: 0.4 });
  for (let i = 0; i < 6; i++) props.push({ kind: 'fence', x: c.x - 40 + i * 16, z: c.z + 30.5, yaw: 0 });

  const lights: DistrictBuild['lights'] = [
    [c.x, 7, streetZ - 14, T.warm, 700],                 // torii approach
    [c.x - 12, 5, c.z + 10, T.secondary, 500],            // pond
    [c.x + 4, 9, c.z - 6, T.primary, 700],                // plaza centre, pink
    [c.x - 26, 8, c.z + 2, 0xff7ab8, 500], [c.x + 26, 8, c.z + 2, T.warm, 500],
  ];
  // Unused-import guards for tree-shaken TSL helpers referenced conditionally above.
  void positionWorld; void float; void uv; void step; void fract;
  return { group, props, lights };
}

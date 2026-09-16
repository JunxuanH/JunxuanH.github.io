/**
 * Walkable ground for the playable character: per district a list of rectangles the player may stand in
 * (each with a fixed ground height, or the kerb/road height from streets.ts) and the obstacles inside them
 * (circles, axis-aligned boxes, yawed boxes). Pure data + math, no physics library: `resolve` slides along
 * rect edges and pushes out of obstacles, `groundY` gives the foot height, `limitCamera` keeps the follow
 * camera out of buildings. Positions mirror the district builders (districts/*.ts, carriers/*.ts, props.ts).
 */
import * as THREE from 'three/webgpu';
import { TERMINALS } from './terminal-layout';
import { DOWNTOWN_LOBBIES } from './building-layout';
import { DOWNTOWN_PROPS, DOWNTOWN_ASSETS } from './downtown-layout';
import { MARKET_STALLS, MARKET_BOLLARDS, MARKET_BUILDINGS } from './market-layout';
import { rng } from './palette';
import { ANCHORS, type SectionId } from './journey';
import { CURB_H, CROSS_Z, AVENUE_HALF, SIDEWALK, QUAY_Z, isRoad, isSidewalk } from './streets';
import type { PropKind, PropPlacement } from './props';

export type WalkSection = Exclude<SectionId, 'city'>;

export interface Rect { x0: number; x1: number; z0: number; z1: number; /** Fixed ground height; omitted = kerb or road from streets.ts. */ y?: number }
export type Obstacle =
  | { kind: 'circle'; x: number; z: number; r: number; /** Height (u); tall shapes also block the camera. */ h?: number }
  | { kind: 'box'; x0: number; x1: number; z0: number; z1: number; h?: number }
  | { kind: 'obb'; x: number; z: number; hw: number; hd: number; yaw: number; h?: number };
export interface Area { section: WalkSection; rects: Rect[]; obstacles: Obstacle[]; connected?: boolean }

export const PLAYER_RADIUS = 0.4;
export const DECK_Y = 2.9;
/** The follow camera may leave the walkable rects by this much (the boom is 5.5 u). */
const CAMERA_MARGIN = 6;
/** Obstacles at least this tall stop the camera boom. */
const CAMERA_BLOCK_H = 2.2;

const circle = (x: number, z: number, r: number, h?: number): Obstacle => ({ kind: 'circle', x, z, r, h });
const box = (x0: number, x1: number, z0: number, z1: number, h?: number): Obstacle => ({ kind: 'box', x0, x1, z0, z1, h });
const centred = (cx: number, cz: number, w: number, d: number, h?: number) => box(cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2, h);

/** Collision radius per Kenney prop kind (props.ts); overhead kinds are omitted. */
const PROP_RADIUS: Partial<Record<PropKind, number>> = {
  lamp: 0.3, lamp2: 0.3, dumpster: 1.1, barrier: 0.8, cone: 0.35, fence: 0.9, pole: 0.3, sign: 0.25, hanging: 0.3, parasol: 0.3, traffic: 0.3,
};

// ---------- campus (education)
function campus(): Area {
  const c = ANCHORS.campus; // (−80, 0, −102)
  const streetZ = CROSS_Z[0]; // −60
  const rects: Rect[] = [
    { x0: c.x - 42, x1: c.x + 42, z0: c.z - 31, z1: c.z + 31, y: CURB_H },   // plaza slab (japantown.ts)
    { x0: c.x - 9, x1: c.x + 9, z0: c.z + 31, z1: streetZ - 8, y: CURB_H }, // approach ends at the curb, not in the road
    { x0: c.x + 9, x1: c.x + 24, z0: streetZ - 14, z1: streetZ - 6 },        // cross-street pavement to the taxi pad
  ];
  const obstacles: Obstacle[] = [
    // Campus blocks (dx, dz, w, d, h) and the terminal kiosk housing (carriers/kiosk.ts).
    centred(c.x, c.z - 20, 34, 18, 14), centred(c.x - 30, c.z + 4, 16, 22, 11), centred(c.x + 30, c.z + 6, 16, 20, 12),
    box(-81.7, -78.3, -100.65, -99.35, 3.4),
    circle(-81.6, -97.4, 0.45), // the hacker at the screen
    circle(c.x - 4.4, streetZ - 12, 0.5, 9), circle(c.x + 4.4, streetZ - 12, 0.5, 9), // torii posts
    circle(c.x - 12, c.z + 10, 6.5, 0.1), // koi pond
    circle(-118, -76, 1.1, 1.6), circle(-42, -116, 1.1, 1.6), // dumpsters
  ];
  for (let i = 0; i < 4; i++) for (const s of [-1, 1]) obstacles.push(circle(c.x + s * 6.5, streetZ - 14 - i * 5, 0.5, 2.7)); // stone lanterns
  for (const [dx, dz] of [[-24, -6], [24, -6], [-24, 22], [24, 22]] as const) obstacles.push(circle(c.x + dx, c.z + dz, 0.35, 6.5)); // lamps
  // Sakura trunks: same seeded sequence as japantown.ts's grove.
  const r = rng(303);
  for (let i = 0; i < 10; i++) {
    const ang = (i / 10) * Math.PI * 2 + r() * 0.3;
    const x = c.x + Math.cos(ang) * (26 + r() * 8), z = c.z + 4 + Math.sin(ang) * (18 + r() * 6);
    obstacles.push(circle(x, z, 0.45, 3.2));
  }
  return { section: 'education', rects, obstacles };
}

// ---------- downtown (work)
function downtown(placed: boolean): Area {
  const rects: Rect[] = [
    { x0: -(AVENUE_HALF + SIDEWALK), x1: -AVENUE_HALF, z0: -210, z1: -60 }, // west sidewalk
    { x0: AVENUE_HALF, x1: AVENUE_HALF + SIDEWALK, z0: -210, z1: -60 },     // east sidewalk
  ];
  // Lobby forecourts (center.ts: black marble in front of each glass lobby), w + 6 along the avenue.
  for (const [side, z, w] of DOWNTOWN_LOBBIES) {
    const x0 = side < 0 ? -21.6 : 15.6;
    rects.push({ x0, x1: x0 + 6, z0: z - (w + 6) / 2, z1: z + (w + 6) / 2 });
  }
  // Crosswalk bands at the two cross streets inside the avenue stretch.
  for (const cz of [CROSS_Z[0], CROSS_Z[1]]) {
    rects.push({ x0: -30, x1: 30, z0: cz - 14, z1: cz - 8 });
    if (cz !== CROSS_Z[0]) rects.push({ x0: -30, x1: 30, z0: cz + 8, z1: cz + 14 });
  }
  const obstacles: Obstacle[] = [
    box(-17.9, -16.1, -98.9, -90.9, 3.1),      // bus shelter (carriers/busstop.ts)
    circle(-16.4, -89.6, 0.12, 2.9),           // stop pole
    circle(-16.4, -100.3, 0.45),               // the bouncer
    circle(18.6, -196, 1.5, 0.3),              // hologram projector disc
    box(27, 41, -129, -107, 46),               // media tower (carriers/megascreen.ts)
  ];
  // Glass lobbies (center.ts): outside the rects, but they bound the camera.
  for (const s of DOWNTOWN_PROPS) obstacles.push(centred(s.x,s.z,s.w,s.d,s.h));
  for (const s of DOWNTOWN_ASSETS) obstacles.push({kind:'obb',x:s.x,z:s.z,hw:s.w/2,hd:s.d/2,yaw:s.yaw,h:s.h});
  for (const [side, z, w] of DOWNTOWN_LOBBIES) {
    const x0 = side < 0 ? -33.6 : 21.6;
    obstacles.push(box(x0, x0 + 12, z - w / 2, z + w / 2, 34));
    for (const offset of [-w*.32,w*.32]) obstacles.push(centred(side*21,z+offset,.8,3,3.3));
  }
  for (const cz of [CROSS_Z[0], CROSS_Z[1]]) {
    obstacles.push(circle(-(AVENUE_HALF + 0.8), cz - (8 + 0.8), 0.3, 6.5), circle(AVENUE_HALF + 0.8, cz + (8 + 0.8), 0.3, 6.5)); // traffic-light posts
    obstacles.push(circle(-28, cz + 10, 0.3, 8), circle(28, cz + 10, 0.3, 8)); // power poles
  }
  if (!placed) {
    // Fallback replicas of the deterministic placement rules (props.ts avenue lamps, center.ts signs and cones).
    const inner = AVENUE_HALF + 1.2;
    for (let z = -26; z > -212; z -= 14) {
      if (isRoad(0, z) && !isSidewalk(inner, z)) continue;
      if (!isSidewalk(inner, z)) continue;
      const side = ((z / 14) | 0) % 2 ? 1 : -1;
      obstacles.push(circle(side * inner, z, 0.3, 6.5));
    }
    for (const [side, z] of DOWNTOWN_LOBBIES) {
      if (side > 0 && z === -202) continue;
      obstacles.push(circle(side * inner, z + 9, 0.3, 4.5));
      for (let k = -2; k <= 2; k++) obstacles.push(circle(side * (AVENUE_HALF + SIDEWALK - 0.6), z + k * 3.2, 0.3, 0.6));
    }
  }
  return { section: 'work', rects, obstacles };
}

// ---------- market (projects)
function market(placed: boolean): Area {
  const m = ANCHORS.market; // (50, 0, −228)
  const rects: Rect[] = [{ x0: 14, x1: 86, z0: m.z - 14, z1: m.z + 14 }];
  const obstacles: Obstacle[] = MARKET_BUILDINGS.map(([x,z,w,h]) => centred(x,z,w,16,h));
  for (const s of MARKET_STALLS) {
    obstacles.push(centred(s.x, s.z, 6.3, 3.8, 3.8));
    if(s.kind==='food') for(const dx of [-1.9,0,1.9]) obstacles.push(circle(s.x+dx,s.z+2.7,.32,.85));
  }
  for(const b of MARKET_BOLLARDS) obstacles.push(circle(b.x,b.z,.18,1));
  for(const z of [-234.5,-221.5]) obstacles.push(centred(79,z,1.3,3,1.2));
  for(const z of [-234,-222]) obstacles.push(circle(81,z,.12,7));
  return { section: 'projects', rects, obstacles };
}

// ---------- harbor (contact)
function harbor(): Area {
  const p = ANCHORS.pad; // (140, 0, 20)
  const rects: Rect[] = [{ x0: p.x - 5.6, x1: p.x + 5.6, z0: -19, z1: 33, y: DECK_Y }];
  const obstacles: Obstacle[] = [
    circle(p.x - 4.4, 32.1, 0.25, 3), circle(p.x + 4.4, 32.1, 0.25, 3), // departures board legs
    circle(p.x - 5.4, 32.5, 0.2, 10), circle(p.x + 5.4, 32.5, 0.2, 10),  // LinkedIn / GitHub neon poles
    circle(p.x, p.z, 2.6, 1.8),                                          // the landed hover car
  ];
  return { section: 'contact', rects, obstacles };
}

/**
 * Build the four areas. `placements` (props.ts's instanced street furniture, when it exports them) replaces the
 * fallback replicas: every placed prop that lands inside a district's rects becomes a circle obstacle.
 */
export function buildAreas(placements?: PropPlacement[] | null): Record<WalkSection, Area> {
  const placed = !!placements?.length;
  const areas: Record<WalkSection, Area> = { education: campus(), work: downtown(placed), projects: market(placed), contact: harbor() };
  if (placements) {
    for (const pl of placements) {
      const r = PROP_RADIUS[pl.kind];
      if (!r) continue;
      for (const a of Object.values(areas)) {
        if (a.rects.some((rc) => pl.x >= rc.x0 - 1 && pl.x <= rc.x1 + 1 && pl.z >= rc.z0 - 1 && pl.z <= rc.z1 + 1)) a.obstacles.push(circle(pl.x, pl.z, r * (pl.s ?? 1), 1.5));
      }
    }
  }
  return areas;
}

/** Entire rendered dry-land plane, raised quay and existing piers; no district fences. */
export function buildWorldArea(areas: Record<WalkSection, Area>, buildings: Obstacle[], placements: PropPlacement[] = []): Area {
  const rects: Rect[] = [
    { x0: -379, x1: 379, z0: -639, z1: QUAY_Z - 2.4 },
    { x0: -379, x1: 379, z0: QUAY_Z - 2.4, z1: QUAY_Z - .4, y: 3 },
    { x0: 134.4, x1: 145.6, z0: QUAY_Z - 2.4, z1: 33.6, y: DECK_Y },
    ...[-130, 70, 210].map((x) => ({ x0: x - 2.6, x1: x + 2.6, z0: QUAY_Z - 2.4, z1: 13.6, y: 2.85 })),
  ];
  const obstacles = buildings; // shared: late GLB loads append their actual bounds here too
  obstacles.push(...Object.values(areas).flatMap((a) => a.obstacles));
  for (const [id, terminal] of Object.entries(TERMINALS)) {
    if (id === 'education') continue; // original Campus kiosk is already included
    const [x, , z] = terminal.pos;
    const sideways = Math.abs(Math.sin(terminal.yaw)) > 0.5;
    obstacles.push(centred(x, z, sideways ? 1.2 : 3.6, sideways ? 3.6 : 1.2, 3.4));
  }
  // Add every placed prop, including those outside the former district pockets.
  for (const pl of placements) {
    const r = PROP_RADIUS[pl.kind];
    if (r) obstacles.push(circle(pl.x, pl.z, r * (pl.s ?? 1), 1.5));
  }
  return { section: 'work', rects, obstacles, connected: true };
}

/** Spatial ownership changes content on foot without teleporting or resetting the camera. */
export function sectionAt(x: number, z: number): WalkSection {
  if (z > -45) return 'contact';
  if (x < -38 && z > -150 && z < -55) return 'education';
  if (x > 10 && z < -195 && z > -275) return 'projects';
  return 'work';
}

// ---------- queries

export function rectAt(area: Area, x: number, z: number, grow = 0): Rect | undefined {
  return area.rects.find((r) => x >= r.x0 - grow && x <= r.x1 + grow && z >= r.z0 - grow && z <= r.z1 + grow);
}

/** Foot height at (x, z): the rect's fixed height, else the kerb (0.22) or the road (0). */
export function groundY(area: Area, x: number, z: number): number {
  if (area.connected) {
    // Visible harbor access ramp rises from street to quay top; deck joins with a 10cm step.
    if (x >= 134 && x <= 146 && z >= -34.4 && z <= -22.4) return CURB_H + (3 - CURB_H) * (z + 34.4) / 12;
    if (z >= -22.4) {
      if (z <= -20.4) return 3;
      if (x >= 134 && x <= 146) return DECK_Y;
      return 2.85;
    }
    return isRoad(x, z) ? 0 : CURB_H;
  }
  const r = rectAt(area, x, z, 2);
  if (r?.y !== undefined) return r.y;
  return isRoad(x, z) ? 0 : CURB_H;
}

const tmp = new THREE.Vector2();
/** Push (x, z) out of one obstacle, expanded by `radius`. Returns true when it moved. */
function pushOut(o: Obstacle, p: THREE.Vector2, radius: number): boolean {
  if (o.kind === 'circle') {
    tmp.set(p.x - o.x, p.y - o.z);
    const d = tmp.length(), R = o.r + radius;
    if (d >= R) return false;
    if (d < 1e-4) tmp.set(1, 0); else tmp.divideScalar(d);
    p.set(o.x + tmp.x * R, o.z + tmp.y * R);
    return true;
  }
  if (o.kind === 'box') {
    const x0 = o.x0 - radius, x1 = o.x1 + radius, z0 = o.z0 - radius, z1 = o.z1 + radius;
    if (p.x <= x0 || p.x >= x1 || p.y <= z0 || p.y >= z1) return false;
    const dx0 = p.x - x0, dx1 = x1 - p.x, dz0 = p.y - z0, dz1 = z1 - p.y;
    const m = Math.min(dx0, dx1, dz0, dz1);
    if (m === dx0) p.x = x0; else if (m === dx1) p.x = x1; else if (m === dz0) p.y = z0; else p.y = z1;
    return true;
  }
  // Yawed box: solve in the box's local frame.
  const c = Math.cos(-o.yaw), s = Math.sin(-o.yaw);
  const lx = (p.x - o.x) * c - (p.y - o.z) * s, lz = (p.x - o.x) * s + (p.y - o.z) * c;
  const hw = o.hw + radius, hd = o.hd + radius;
  if (Math.abs(lx) >= hw || Math.abs(lz) >= hd) return false;
  let nx = lx, nz = lz;
  const dx = hw - Math.abs(lx), dz = hd - Math.abs(lz);
  if (dx < dz) nx = Math.sign(lx || 1) * hw; else nz = Math.sign(lz || 1) * hd;
  const c2 = Math.cos(o.yaw), s2 = Math.sin(o.yaw);
  p.set(o.x + nx * c2 - nz * s2, o.z + nx * s2 + nz * c2);
  return true;
}

const cand = new THREE.Vector2();
/**
 * Constrain a step from `prev` to `next` (both world positions; `next` is mutated): slide along the rect edges
 * when the step would leave every rect (x-only, then z-only), push out of obstacles, and set the ground height.
 */
export function resolve(area: Area, next: THREE.Vector3, prev: THREE.Vector3, radius = PLAYER_RADIUS) {
  const wantedX = next.x, wantedZ = next.z;
  // A raised quay is a physical wall unless approached via its access ramp.
  if (area.connected && Math.abs(groundY(area, next.x, next.z) - groundY(area, prev.x, prev.z)) > .35) {
    next.x = prev.x; next.z = prev.z;
  }
  if (!rectAt(area, next.x, next.z)) {
    if (rectAt(area, next.x, prev.z)) next.z = prev.z;
    else if (rectAt(area, prev.x, next.z)) next.x = prev.x;
    else { next.x = prev.x; next.z = prev.z; }
  }
  cand.set(next.x, next.z);
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const o of area.obstacles) moved = pushOut(o, cand, radius) || moved;
    if (!moved) break;
  }
  if (rectAt(area, cand.x, cand.y) && (!area.connected || Math.abs(groundY(area, cand.x, cand.y) - groundY(area, prev.x, prev.z)) <= .35)) { next.x = cand.x; next.z = cand.y; }
  else { next.x = prev.x; next.z = prev.z; }
  next.y = groundY(area, next.x, next.z);
  return Math.hypot(next.x - wantedX, next.z - wantedZ) > .001;
}

const probe = new THREE.Vector2();
/** True when (x, z) is inside a camera-blocking obstacle (tall shapes only, slightly padded). */
function blocksCamera(area: Area, x: number, z: number, y: number): boolean {
  for (const o of area.obstacles) {
    if ((o.h ?? 0) < CAMERA_BLOCK_H || (o.h ?? 0) + 0.3 < y) continue;
    probe.set(x, z);
    if (pushOut(o, probe, 0.3)) return true;
  }
  return false;
}

/**
 * Shorten the camera boom: walk from `pivot` toward `desired` and stop before the segment leaves the rects
 * (expanded by CAMERA_MARGIN) or enters a tall obstacle. `desired` is mutated; the boom never gets shorter than `minLen`.
 */
export function limitCamera(area: Area, pivot: THREE.Vector3, desired: THREE.Vector3, minLen = 1.2) {
  const len = pivot.distanceTo(desired);
  if (len <= minLen) return;
  const steps = Math.ceil(len / 0.4);
  let ok = 0; // no segment is clear until sampled (the first sample can already hit a wall)
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = pivot.x + (desired.x - pivot.x) * t, z = pivot.z + (desired.z - pivot.z) * t, y = pivot.y + (desired.y - pivot.y) * t;
    const ground = groundY(area, x, z);
    if (!rectAt(area, x, z, CAMERA_MARGIN) || blocksCamera(area, x, z, y - ground)) break;
    ok = t;
  }
  if (ok < 1) {
    const t = Math.max(minLen / len, ok - 0.05);
    desired.lerpVectors(pivot, desired, t);
  }
}

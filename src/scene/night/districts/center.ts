import * as THREE from 'three/webgpu';
import { color, positionLocal, smoothstep, abs, mix, float, glowMaterial } from '../tsl';
import { PAL } from '../palette';
import { ANCHORS } from '../journey';
import { createKeyedSigns } from '../signs';
import { AVENUE_HALF, SIDEWALK, CURB_H } from '../streets';
import { THEMES } from '../theme';
import { createFlameSign, createConduit, type DistrictBuild, type DistrictCtx } from './shared';

/*
 * Work district — City Center corporate avenue: glass lobbies spilling white-cyan light onto the
 * sidewalk, black-marble forecourts, fictional corporate holo-logos above the four employer
 * flame-graph signs, cold blue lamps. Punks stay out; corpos and the security patrol own it.
 */

// Lobbies with the same height and tint share their glass; every lobby shares the lit floor (one node
// build each instead of one per lobby).
const glassCache = new Map<string, THREE.MeshStandardNodeMaterial>();
let lobbyFloor: THREE.MeshStandardNodeMaterial | null = null;
function lobbyGlass(h: number, tint: number) {
  const key = `${h}|${tint}`;
  let glass = glassCache.get(key);
  if (!glass) {
    glass = new THREE.MeshStandardNodeMaterial({ transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.6, depthWrite: false });
    glass.colorNode = color(0xdfe8ff);
    const edge = smoothstep(0.03, 0.0, abs(abs(positionLocal.y.div(h / 2)).sub(1.0)));
    glass.emissiveNode = color(tint).mul(edge).mul(1.4).add(color(0x8fb0ff).mul(0.06));
    glassCache.set(key, glass);
  }
  return glass;
}

/** Glass lobby: translucent box (no transmission), bright interior floor, dark columns, a desk. */
function glassLobby(w: number, h: number, d: number, tint: number) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), lobbyGlass(h, tint));
  box.renderOrder = 3;
  if (!lobbyFloor) {
    lobbyFloor = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0.4 });
    lobbyFloor.colorNode = color(0x0a0c14);
    lobbyFloor.emissiveNode = color(0xdfe8ff).mul(0.9);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.2, d - 0.4).translate(0, 0.1, 0), lobbyFloor);
  const colMat = new THREE.MeshStandardNodeMaterial({ color: 0x080a12, roughness: 0.3, metalness: 0.5 });
  for (const [x, z] of [[-w / 3, -d / 3], [w / 3, -d / 3], [-w / 3, d / 3], [w / 3, d / 3]] as const) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.9).translate(0, h / 2, 0), colMat);
    col.position.set(x, 0, z);
    group.add(col);
  }
  const desk = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.1, 1.2).translate(0, 0.55, 0), colMat);
  desk.position.set(0, 0.2, -d * 0.25);
  const deskGlow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.06, 0.06), glowMaterial(tint, 2.2));
  deskGlow.position.set(0, 1.32, -d * 0.25 + 0.62);
  // Forecourt: black marble slab in front of the lobby.
  const forecourt = new THREE.Mesh(new THREE.BoxGeometry(w + 6, CURB_H, 6), new THREE.MeshStandardNodeMaterial({ color: 0x0a0b12, roughness: 0.12, metalness: 0.5 }));
  forecourt.position.set(0, CURB_H / 2, d / 2 + 3);
  group.add(box, floor, desk, deskGlow, forecourt);
  void float; void mix;
  return group;
}

export async function create(ctx: DistrictCtx): Promise<DistrictBuild> {
  const T = THEMES.work;
  const group = new THREE.Group();
  const tints = [PAL.cyan, T.warm, 0xdfe8ff, PAL.cyan];
  const pts: THREE.Vector3[] = [];
  ANCHORS.workSigns.forEach((p, i) => {
    const job = ctx.content.jobs[i] ?? { label: `JOB ${i + 1}`, rows: 3 };
    const sign = createFlameSign(job.label, job.rows, 40 + i * 7, tints[i], 14, 8.0, T.primary);
    sign.position.copy(p);
    sign.rotation.y = p.x < 0 ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35;
    group.add(sign);
    pts.push(p.clone().add(new THREE.Vector3(0, -3.4, 0)));
  });
  // One conduit per side of the avenue, hugging the façades between the signs on that side.
  for (const side of [-1, 1]) {
    const mine = pts.filter((q) => Math.sign(q.x) === side);
    if (mine.length < 2) continue;
    const run: THREE.Vector3[] = [];
    mine.forEach((q, i) => {
      run.push(q.clone());
      if (i < mine.length - 1) run.push(new THREE.Vector3(q.x + side * 1.2, 4.5, (q.z + mine[i + 1].z) / 2));
    });
    group.add(createConduit(run, T.secondary));
  }

  // Fictional corporate holo-logos above each employer sign, facing the road.
  const logos = await createKeyedSigns(
    ANCHORS.workSigns.map((p) => ({ x: p.x + (p.x < 0 ? 0.3 : -0.3), y: p.y + 6.5, z: p.z, yaw: p.x < 0 ? Math.PI / 2 : -Math.PI / 2, w: 4.2 })),
    ['corp-1', 'corp-2', 'corp-3', 'corp-4'],
  );
  group.add(logos);

  // Glass lobbies on both sides of the avenue, set back behind the sidewalk.
  const setback = AVENUE_HALF + SIDEWALK + 0.6;
  for (const [side, z, w] of [[-1, -110, 22], [1, -140, 20], [-1, -172, 22], [1, -196, 18]] as const) {
    const d = 12;
    const lobby = glassLobby(w, 7, d, side < 0 ? T.secondary : 0xdfe8ff);
    lobby.position.set(side * (setback + d / 2 + 3), CURB_H, z);
    lobby.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(lobby);
  }

  const props: DistrictBuild['props'] = [];
  for (const [side, z] of [[-1, -110], [1, -140], [-1, -172], [1, -196]] as const) {
    if (!(side > 0 && z === -196)) props.push({ kind: 'hanging', x: side * (AVENUE_HALF + 1.2), z: z + 9, yaw: side > 0 ? 0 : Math.PI }); // the hologram forecourt stays clear
    if (!(side > 0 && z === -196)) for (let k = -2; k <= 2; k++) props.push({ kind: 'cone', x: side * (AVENUE_HALF + SIDEWALK - 0.6), z: z + k * 3.2, yaw: 0, s: 0.7 });
  }
  const lights: DistrictBuild['lights'] = [
    [-10, 7, -80, 0xffb070, 700], [0, 14, -120, 0xdfe8ff, 700], [8, 9, -125, T.secondary, 500],
    [-8, 9, -158, T.warm, 600], [0, 14, -180, 0xdfe8ff, 600], [6, 7, -190, T.warm, 600],
  ];
  return { group, props, lights };
}

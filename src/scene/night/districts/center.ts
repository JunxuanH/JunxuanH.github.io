import * as THREE from 'three/webgpu';
import { color, positionLocal, positionWorld, normalWorld, cameraPosition, normalize, dot, pow, texture, smoothstep, abs, mix, float, glowMaterial } from '../tsl';
import { PAL } from '../palette';
import { ANCHORS } from '../journey';
import { createKeyedSigns } from '../signs';
import { AVENUE_HALF, SIDEWALK, CURB_H, PATCH_LIFT } from '../streets';
import { THEMES } from '../theme';
import { DOWNTOWN_LOBBIES, DOWNTOWN_DEPTH, DOWNTOWN_CENTER_X } from '../building-layout';
import { downtownDetail } from './downtown-detail';
import { officeCore } from './office-core';
import { type DistrictBuild, type DistrictCtx } from './shared';

/*
 * Work district — City Center corporate avenue: glass lobbies spilling white-cyan light onto the
 * sidewalk, black-marble forecourts, fictional corporate holo-logos above the four employer
 * flame-graph signs, cold blue lamps. Punks stay out; corpos and the security patrol own it.
 */

// Lobbies with the same height and tint share their glass; every lobby shares the lit floor (one node
// build each instead of one per lobby).
const glassCache = new Map<string, THREE.MeshStandardNodeMaterial>();
let lobbyFloor: THREE.MeshStandardNodeMaterial | null = null;
function lobbyGlass(h: number, tint: number, grime?: THREE.Texture | null) {
  const key = `${h}|${tint}`;
  let glass = glassCache.get(key);
  if (!glass) {
    glass = new THREE.MeshStandardNodeMaterial({ transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0.6, depthWrite: false });
    glass.colorNode = color(0xdfe8ff);
    const edge = smoothstep(0.03, 0.0, abs(abs(positionLocal.y.div(h / 2)).sub(1.0)));
    glass.emissiveNode = color(tint).mul(edge).mul(1.4).add(color(0x8fb0ff).mul(0.06));
    // Grazing angles go opaque and bright, head-on stays clear: the fresnel term real glass has and
    // a flat alpha does not. Dried rain and dust break up the reflection so the pane reads as a
    // surface rather than a tinted hole. Cheaper than transmission, which would cost a second
    // render of everything behind the pane for a lobby the camera never enters.
    const fres = pow(float(1).sub(abs(dot(normalize(cameraPosition.sub(positionWorld)), normalWorld))).clamp(0, 1), 3.0);
    let dirt: any = float(0);
    if (grime) dirt = texture(grime, positionWorld.xy.mul(1 / 9)).r.sub(0.5).mul(2).clamp(0, 1);
    glass.opacityNode = float(0.22).add(fres.mul(0.5)).add(dirt.mul(0.22)).clamp(0, 0.92);
    glass.roughnessNode = float(0.06).add(dirt.mul(0.35));
    glassCache.set(key, glass);
  }
  return glass;
}

/** Glass perimeter around a solid elevator/service core and reception area. */
function glassLobby(w: number, h: number, d: number, tint: number, grime?: THREE.Texture | null) {
  const group = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), lobbyGlass(h, tint, grime));
  box.renderOrder = 3;
  if (!lobbyFloor) {
    lobbyFloor = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0.4 });
    lobbyFloor.colorNode = color(0x0a0c14);
    lobbyFloor.emissiveNode = color(0xdfe8ff).mul(0.25);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(w - 0.4, 0.2, d - 0.4).translate(0, 0.1, 0), lobbyFloor);
  const colMat = new THREE.MeshStandardNodeMaterial({ color: 0x080a12, roughness: 0.3, metalness: 0.5 });
  for (const [x, z] of [[-w / 3, -d / 3], [w / 3, -d / 3], [-w / 3, d / 3], [w / 3, d / 3]] as const) {
    const col = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.9).translate(0, h / 2, 0), colMat);
    col.position.set(x, 0, z);
    group.add(col);
  }
  const desk = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 1.1, 1.2).translate(0, 0.55, 0), colMat);
  desk.position.set(0, 0.2, d * 0.25);
  const deskGlow = new THREE.Mesh(new THREE.BoxGeometry(w * 0.4, 0.06, 0.06), glowMaterial(tint, 2.2));
  deskGlow.position.set(0, 1.32, d * 0.25 + 0.62);
  // Forecourt: black marble slab in front of the lobby. PATCH_LIFT taller than the avenue sidewalk it overlaps by
  // 2.4 u, so the two top faces are not coplanar (streets.ts).
  const forecourt = new THREE.Mesh(new THREE.BoxGeometry(w + 6, CURB_H + PATCH_LIFT, 6), new THREE.MeshStandardNodeMaterial({ color: 0x0a0b12, roughness: 0.12, metalness: 0.5 }));
  forecourt.position.set(0, (CURB_H + PATCH_LIFT) / 2, d / 2 + 3);
  group.add(box, floor, desk, deskGlow, forecourt,officeCore(w,h,d));
  void float; void mix;
  return group;
}

export async function create(ctx: DistrictCtx): Promise<DistrictBuild> {
  const T = THEMES.work;
  const group = new THREE.Group();
  group.add(await downtownDetail(ctx));
  // Employer content now lives in the kiosk. Remove the four obsolete 14×8
  // panels and their connecting cables so they no longer obscure the product ads.
  // One small facade sign replaces the west-side display. Its left arrow points
  // south (+Z), toward the Downtown terminal at z=-87.
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = 320;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#08121d'; c.fillRect(0, 0, 1024, 320);
  c.strokeStyle = '#68cbd9'; c.lineWidth = 5; c.strokeRect(8, 8, 1008, 304);
  c.fillStyle = '#dce5ef'; c.font = 'bold 65px monospace';
  c.fillText('← DOWNTOWN TERMINAL', 42, 143);
  c.fillStyle = '#76bdc8'; c.font = '30px monospace';
  c.fillText('WORK / EXPERIENCE · PUBLIC ACCESS', 48, 226);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const wayfinding = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 1.6875),
    new THREE.MeshBasicNodeMaterial({ map: texture }));
  wayfinding.name = 'Downtown terminal wayfinding';
  wayfinding.position.set(-17.5, 5.5, -158);
  wayfinding.rotation.y = Math.PI / 2;
  group.add(wayfinding);

  // Fictional corporate holo-logos above each employer sign, facing the road.
  const logos = await createKeyedSigns(
    ANCHORS.workSigns.map((p) => ({ x: p.x + (p.x < 0 ? 0.3 : -0.3), y: p.y + 6.5, z: p.z, yaw: p.x < 0 ? Math.PI / 2 : -Math.PI / 2, w: 4.2 })),
    ['corp-1', 'corp-2', 'corp-3', 'corp-4'],
  );
  group.add(logos);

  // Glass lobbies on both sides of the avenue, set back behind the sidewalk.
  for (const [side, z, w] of DOWNTOWN_LOBBIES) {
    const d = DOWNTOWN_DEPTH;
    const lobby = glassLobby(w, 7, d, side < 0 ? T.secondary : 0xdfe8ff, ctx.tex.walls?.['glass-grime']?.map);
    lobby.position.set(side * DOWNTOWN_CENTER_X, CURB_H, z);
    lobby.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    group.add(lobby);
  }

  const props: DistrictBuild['props'] = [];
  for (const [side, z] of DOWNTOWN_LOBBIES) {
    if (!(side > 0 && z === -202)) props.push({ kind: 'hanging', x: side * (AVENUE_HALF + 1.2), z: z + 9, yaw: side > 0 ? 0 : Math.PI });
    if (!(side > 0 && z === -202)) for (let k = -2; k <= 2; k++) props.push({ kind: 'cone', x: side * (AVENUE_HALF + SIDEWALK - 0.6), z: z + k * 3.2, yaw: 0, s: 0.7 });
  }
  const lights: DistrictBuild['lights'] = [
    [-10, 7, -80, 0xffb070, 700], [0, 14, -120, 0xdfe8ff, 700], [8, 9, -125, T.secondary, 500],
    [-8, 9, -158, T.warm, 600], [0, 14, -180, 0xdfe8ff, 600], [6, 7, -190, T.warm, 600],
  ];
  return { group, props, lights };
}

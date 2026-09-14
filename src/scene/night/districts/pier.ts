import * as THREE from 'three/webgpu';
import { time, color, uv, smoothstep, mix, positionLocal, hash, floor, fract, step, glowMaterial, beamMaterial } from '../tsl';
import { PAL, rng } from '../palette';
import { ANCHORS } from '../journey';
import { neonText, signMat, createKeyedSigns } from '../signs';
import { QUAY_Z, groundMaterial } from '../streets';
import { THEMES } from '../theme';
import { padTexture, type DistrictBuild, type DistrictCtx } from './shared';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Contact district — waterfront pier. A plank boardwalk on pilings runs from the quay out over the
 * bay; the landing pad sits at its end with a lighthouse beside it, boat lights drift beyond,
 * harbour neon on a shack at the quay, LinkedIn / GitHub neon on poles by the pad.
 */

const DECK_Y = 2.9;

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const r = rng(5);
  g.fillStyle = '#1a1712';
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 16; i++) {
    const v = 26 + r() * 18;
    g.fillStyle = `rgb(${v + 6},${v},${v - 6})`;
    g.fillRect(0, i * 32 + 2, 512, 28);
    g.fillStyle = 'rgba(0,0,0,0.35)';
    for (let k = 0; k < 6; k++) g.fillRect(r() * 512, i * 32 + 4 + r() * 22, 40 + r() * 80, 1);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(2, 12);
  return t;
}

function lighthouse(tint: number) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(1.8, 2.4, 14, 14).translate(0, 7, 0), new THREE.MeshStandardNodeMaterial({ color: 0x22242c, roughness: 0.7 }));
  const stripeMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
  stripeMat.colorNode = mix(color(0x8a1a1a), color(0xdcdcdc), step(0.5, fract(positionLocal.y.mul(0.5))));
  const stripes = new THREE.Mesh(new THREE.CylinderGeometry(1.86, 2.46, 14, 14, 1, true).translate(0, 7, 0), stripeMat);
  const lampRoom = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 2.2, 12).translate(0, 15.1, 0), glowMaterial(0xfff2c0, 1));
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.9, 1.6, 12).translate(0, 17, 0), new THREE.MeshStandardNodeMaterial({ color: 0x14161c }));
  // Rotating beam: an additive cone that sweeps. Narrow, faint and fading along its length: a wide bright
  // wedge read as a solid white shape from the pier.
  // Apex at the lamp, widening 90 u out along −z (it was rotated the other way: wide at the lamp). v flipped so the
  // beam shader (bright at uv.y 0) is brightest at the lamp.
  const beamGeo = new THREE.ConeGeometry(3.2, 90, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, -45);
  const bu = beamGeo.attributes.uv;
  for (let i = 0; i < bu.count; i++) bu.setY(i, 1 - bu.getY(i));
  const beam = new THREE.Mesh(beamGeo, beamMaterial(tint, 0.14, 0.25, 0.9));
  beam.position.y = 15.1;
  const pivot = new THREE.Group();
  pivot.add(beam);
  pivot.position.y = 0;
  group.add(body, stripes, lampRoom, cap, pivot);
  return { group, pivot };
}

export async function create(_ctx: DistrictCtx): Promise<DistrictBuild & { padRing: THREE.Object3D; update: (t: number) => void }> {
  const T = THEMES.contact;
  const group = new THREE.Group();
  const r = rng(909);
  const p = ANCHORS.pad; // (140, 0, 20): pad centre at the pier end
  const x0 = p.x, zStart = QUAY_Z, zEnd = p.z + 14;
  const len = zEnd - zStart;

  // Deck + pilings + railings
  const gt = _ctx.tex.ground;
  // Planks run across the deck (world X) on three stringers; bolt heads pin every plank to each stringer.
  const deckMat = gt?.planks ? groundMaterial(gt.planks, gt.planksN, 5, { roughness: 0.6, rotate: true }) : new THREE.MeshStandardNodeMaterial({ roughness: 0.75, map: plankTexture() });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(12, 0.5, len), deckMat);
  deck.position.set(x0, DECK_Y - 0.25, (zStart + zEnd) / 2);
  group.add(deck);
  const PLANK = 5 / 7; // plank pitch in the texture (7 planks per 5 u tile)
  const boltGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.03, 6).translate(0, 0.015, 0);
  const boltMat = new THREE.MeshStandardNodeMaterial({ color: 0x3a2a1c, roughness: 0.35, metalness: 0.9 });
  const bolts: THREE.Matrix4[] = [];
  for (let z = zStart + PLANK / 2; z < zEnd; z += PLANK) for (const dx of [-4.9, 0, 4.9]) bolts.push(new THREE.Matrix4().makeTranslation(x0 + dx, DECK_Y, z));
  const boltMesh = new THREE.InstancedMesh(boltGeo, boltMat, bolts.length);
  bolts.forEach((m, i) => boltMesh.setMatrixAt(i, m));
  group.add(boltMesh);
  const pileGeo = new THREE.CylinderGeometry(0.34, 0.4, 7, 8).translate(0, 3.5, 0);
  const pileMat = new THREE.MeshStandardNodeMaterial({ color: 0x0f1016, roughness: 0.9 });
  const piles: THREE.Matrix4[] = [];
  const pilePositions: [number, number, number][] = [];
  for (let z = zStart + 3; z < zEnd; z += 6) for (const dx of [-5.2, 5.2]) {
    piles.push(new THREE.Matrix4().makeTranslation(x0 + dx, -4.2, z));
    pilePositions.push([x0 + dx, -0.5, z]);
  }
  const pim = new THREE.InstancedMesh(pileGeo, pileMat, piles.length);
  piles.forEach((m, i) => pim.setMatrixAt(i, m));
  group.add(pim);
  const postGeo = new THREE.BoxGeometry(0.22, 1.2, 0.22).translate(0, 0.6, 0);
  const postMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2620, roughness: 0.8 });
  const ropeMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a3f30, roughness: 0.9 });
  const ropeGeos: THREE.BufferGeometry[] = [];
  const posts: THREE.Matrix4[] = [];
  for (const dx of [-5.6, 5.6]) {
    const pts: THREE.Vector3[] = [];
    for (let z = zStart + 1; z <= zEnd - 1; z += 4) { posts.push(new THREE.Matrix4().makeTranslation(x0 + dx, DECK_Y, z)); pts.push(new THREE.Vector3(x0 + dx, DECK_Y + 1.05, z)); }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mid = a.clone().lerp(b, 0.5).setY(a.y - 0.25);
      ropeGeos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 6, 0.05, 4));
    }
  }
  const posim = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  posts.forEach((m, i) => posim.setMatrixAt(i, m));
  group.add(posim, new THREE.Mesh(mergeGeometries(ropeGeos, false)!, ropeMat));
  // Rail lamps every 8 u (warm bulbs), instanced
  const bulbs: THREE.Matrix4[] = [];
  for (let z = zStart + 4; z < zEnd; z += 8) for (const dx of [-5.6, 5.6]) bulbs.push(new THREE.Matrix4().makeTranslation(x0 + dx, DECK_Y + 1.4, z));
  const bim = new THREE.InstancedMesh(new THREE.SphereGeometry(0.2, 8, 6), glowMaterial(T.warm, 2.6), bulbs.length);
  bulbs.forEach((m, i) => bim.setMatrixAt(i, m));
  group.add(bim);

  // Landing pad: ring torus (interact scales it in a pulse; the shared material is never touched) + "H"
  const padRing = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.16, 6, 48), glowMaterial(T.secondary, 1.8));
  padRing.rotation.x = Math.PI / 2;
  padRing.position.set(p.x, DECK_Y + 0.06, p.z);
  group.add(padRing);
  const hm = signMat(padTexture(), 900, 0xffffff, 1.2, 1); // breathing "H": the sign program with its pulse uniform on
  const hMesh = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), hm);
  hMesh.rotation.x = -Math.PI / 2;
  hMesh.position.set(p.x, DECK_Y + 0.03, p.z);
  group.add(hMesh);

  // Lighthouse on a rock beside the pier end
  const lh = lighthouse(T.primary);
  lh.group.position.set(x0 + 16, 0.5, zEnd + 6);
  group.add(lh.group);
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(4.5, 1), new THREE.MeshStandardNodeMaterial({ color: 0x14161c, roughness: 0.95 }));
  rock.position.set(x0 + 16, -1.5, zEnd + 6);
  rock.scale.set(1.4, 0.6, 1.2);
  group.add(rock);

  // Boats + buoys drifting on the bay
  const boats: { m: THREE.Object3D; base: THREE.Vector3; ph: number }[] = [];
  const boatMat = new THREE.MeshStandardNodeMaterial({ color: 0x0c0e14, roughness: 0.8 });
  const boatLight = glowMaterial(0xffd8a0, 2.4);
  const boatGeo = mergeGeometries([new THREE.BoxGeometry(6, 1.2, 2.2), new THREE.BoxGeometry(2, 1.4, 1.8).translate(-0.8, 1.3, 0)], false)!;
  for (let i = 0; i < 6; i++) {
    const b = new THREE.Group();
    const hull = new THREE.Mesh(boatGeo, boatMat);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 4), boatLight);
    light.position.set(-0.8, 2.3, 0);
    b.add(hull, light);
    const base = new THREE.Vector3(x0 - 60 + r() * 140, 0.2, zEnd + 30 + r() * 110);
    b.position.copy(base);
    b.rotation.y = r() * Math.PI * 2;
    group.add(b);
    boats.push({ m: b, base, ph: r() * 6 });
  }
  const buoyMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6 });
  buoyMat.colorNode = color(0xa8261a);
  buoyMat.emissiveNode = color(0xff3020).mul(step(0.5, fract(time.mul(0.7)))).mul(1.5).mul(smoothstep(0.6, 1.0, uv().y));
  for (let i = 0; i < 5; i++) {
    const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.7, 10, 8), buoyMat);
    const base = new THREE.Vector3(x0 - 30 + r() * 70, 0.3, zEnd + 12 + r() * 50);
    buoy.position.copy(base);
    group.add(buoy);
    boats.push({ m: buoy, base, ph: r() * 6 });
  }

  // Harbour shack at the quay end with keyed neon, PIER 9 in canvas neon, contact neon on poles.
  const shack = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 8).translate(0, 3, 0), new THREE.MeshStandardNodeMaterial({ color: 0x1a1c24, roughness: 0.8 }));
  shack.position.set(x0 - 16, 0.2, zStart - 10);
  group.add(shack);
  // Signs face the city (−z): the camera arrives from the quay side.
  const pier9 = neonText('PIER 9', T.signGlow, 9, { gain: 2.0 });
  pier9.position.set(x0 - 16, 7.2, zStart - 10 - 4.05);
  pier9.rotation.y = Math.PI;
  group.add(pier9);
  const harbour = await createKeyedSigns([
    { x: x0 - 22, y: 4.2, z: zStart - 10 - 4.05, yaw: Math.PI, w: 3 }, { x: x0 - 10, y: 4.2, z: zStart - 10 - 4.05, yaw: Math.PI, w: 3 },
    { x: x0 + 8, y: 5, z: zStart - 6, yaw: Math.PI - 0.6, w: 3 },
  ], ['harbour-2', 'harbour-3', 'harbour-4']);
  group.add(harbour);
  const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1c26, roughness: 0.6, metalness: 0.5 });
  // Poles flank the departures board (carriers/flapboard.ts); the neon sits above its top edge.
  for (const [dx, txt, col] of [[-5.4, 'LINKEDIN', '#00e5ff'], [5.4, 'GITHUB', '#ff2bd6']] as const) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 10.6, 6).translate(0, 5.3, 0), poleMat);
    pole.position.set(p.x + dx, DECK_Y, zEnd - 1.5);
    const s = neonText(txt, col, 7);
    s.position.set(p.x + dx, DECK_Y + 10.2, zEnd - 1.5);
    s.rotation.y = Math.PI; // faces the pier (camera comes from the quay side)
    group.add(pole, s);
  }

  const props: DistrictBuild['props'] = [
    { kind: 'lamp2', x: x0 - 9, z: zStart - 4, yaw: 0 }, { kind: 'lamp2', x: x0 + 9, z: zStart - 4, yaw: Math.PI },
    { kind: 'dumpster', x: x0 - 26, z: zStart - 6, yaw: 0.3 }, { kind: 'barrier', x: x0 + 14, z: zStart - 8, yaw: 0.2 },
    { kind: 'fence', x: x0 + 20, z: zStart - 10, yaw: Math.PI / 2 }, { kind: 'cone', x: x0 - 3, z: zStart - 3, yaw: 0, s: 0.8 },
  ];
  const lights: DistrictBuild['lights'] = [
    [p.x, DECK_Y + 5, p.z, PAL.yellow, 700, 40], [x0 - 12, 7, zStart - 4, T.primary, 500], [x0, DECK_Y + 4, zStart + 18, T.warm, 500, 40],
  ];
  const update = (t: number) => {
    lh.pivot.rotation.y = t * 0.6;
    for (const b of boats) {
      b.m.position.y = b.base.y + Math.sin(t * 0.8 + b.ph) * 0.25;
      b.m.rotation.z = Math.sin(t * 0.7 + b.ph) * 0.04;
    }
  };
  void hash; void floor;
  return { group, props, lights, padRing, update };
}

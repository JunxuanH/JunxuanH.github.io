import * as THREE from 'three/webgpu';
import {
  add, sub, div, vec2, vec3, float, time, texture, normalize, cameraPosition, positionWorld, positionLocal,
  transformNormalToView, sin, cos, max, dot, pow, length, mix, reflector, color, uv, step, fract, floor, hash,
  smoothstep, abs, reflect,
} from './tsl';
import { PAL, loader } from './palette';
import { groundMaterial } from './streets';

/**
 * Hero bay: dark water with a planar reflection of the skyline, a cable-stayed bridge the camera
 * flies over, and the "IVAN HE" LED billboard on the central tower.
 */
/**
 * Bay water: a subdivided plane displaced by a sum of sines (real swell, analytic normals so the
 * moon and neon catch the wave faces), a lit dark body, and a fresnel-weighted planar reflection
 * that stays dim head-on and only brightens at grazing angles.
 */
export function createWater(resolutionScale: number) {
  const tex = loader.load('/textures/waternormals.jpg');
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const normals = texture(tex);
  const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.18, metalness: 0.15 }); // glossy: moon/neon glints on wave faces
  const mirror = reflector({ resolutionScale, generateMipmaps: true });

  // Swell in the mesh's local XY (world XZ after the −90° tilt); displacement along local Z (world up).
  const px = positionLocal.x, py = positionLocal.y, t = time;
  const waves: [number, number, number, number, number][] = [
    // amplitude, kx, ky, speed, phase
    [0.42, 0.30, 0.10, 1.1, 0.0], [0.28, 0.22, 0.42, -0.9, 1.7], [0.18, -0.05, 0.85, 1.6, 0.4], [0.12, 0.9, -0.9, 2.2, 2.9], [0.07, 1.6, 1.2, 3.1, 1.3],
  ];
  let h: any = float(0), dhx: any = float(0), dhy: any = float(0);
  for (const [a, kx, ky, sp, ph] of waves) {
    const arg = px.mul(kx).add(py.mul(ky)).add(t.mul(sp)).add(ph);
    h = h.add(sin(arg).mul(a));
    dhx = dhx.add(cos(arg).mul(a * kx));
    dhy = dhy.add(cos(arg).mul(a * ky));
  }
  mat.positionNode = positionLocal.add(vec3(0, 0, h));

  const getNoise = (p: any) => {
    const o = time.mul(0.6);
    const uv0 = add(div(p, 103), vec2(div(o, 17), div(o, 29)));
    const uv1 = div(p, 107).sub(vec2(div(o, -19), div(o, 31)));
    const uv2 = add(div(p, vec2(897.0, 983.0)), vec2(div(o, 101), div(o, 97)));
    return normals.sample(uv0).add(normals.sample(uv1)).add(normals.sample(uv2)).mul(0.6667).sub(1);
  };
  // World-space normal = swell slope + fine ripples from the normal map.
  const ripple = getNoise(positionWorld.xz.mul(3.0)).xzy.mul(vec3(0.5, 1.0, 0.5));
  const nWorld = normalize(vec3(dhx.negate(), 1.0, dhy.negate()).add(ripple.mul(vec3(1, 0, 1)).mul(1.1)));
  mat.normalNode = transformNormalToView(nWorld);

  const worldToEye = cameraPosition.sub(positionWorld);
  const eye = normalize(worldToEye);
  const dist = length(worldToEye);
  const distortion = nWorld.xz.mul(float(0.001).add(float(1.0).div(dist))).mul(3.0);
  mirror.uvNode = mirror.uvNode!.add(distortion.mul(0.35));
  const theta = max(dot(eye, nWorld), 0.0);
  const reflectance = pow(float(1.0).sub(theta), 4.0).mul(0.5).add(0.1); // 0.1 head-on … 0.6 grazing
  mat.colorNode = color(0x08131f);
  mat.emissiveNode = mirror.rgb.mul(0.65).mul(reflectance);

  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1000, 640, 220, 140), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(0, -0.5, 190);
  mesh.add(mirror.target);
  return mesh;
}

/** Seawall where the city meets the bay: concrete quay with a cyan edge strip, bollard lights, three jetties on pilings. */
export function createQuay(quayZ: number, ground?: { planks: THREE.Texture | null; planksN: THREE.Texture | null }) {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1c24, roughness: 0.85 });
  const wall = new THREE.Mesh(new THREE.BoxGeometry(780, 3.2, 2.4), wallMat);
  wall.position.set(0, 1.4, quayZ - 1.2);
  group.add(wall);
  const edgeMat = new THREE.MeshBasicNodeMaterial();
  edgeMat.colorNode = color(PAL.cyan).mul(1.5);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(780, 0.12, 0.12), edgeMat);
  edge.position.set(0, 3.05, quayZ - 2.35);
  group.add(edge);
  // Bollard lights every 8 u along the quay edge.
  const bollardGeo = new THREE.CylinderGeometry(0.18, 0.22, 1.1, 6).translate(0, 0.55, 0);
  const bollardMat = new THREE.MeshBasicNodeMaterial();
  bollardMat.colorNode = mix(color(0x1a1c24), color(0xffd8a0).mul(2.4), step(0.8, uv().y));
  const bollards: THREE.Matrix4[] = [];
  for (let x = -384; x <= 384; x += 8) bollards.push(new THREE.Matrix4().makeTranslation(x, 3.0, quayZ - 1.6));
  const bim = new THREE.InstancedMesh(bollardGeo, bollardMat, bollards.length);
  bollards.forEach((m, i) => bim.setMatrixAt(i, m));
  group.add(bim);
  // Jetties: dark plank slabs on pilings reaching into the water (the avenue itself ends at the wall).
  const deckMat = ground?.planks ? groundMaterial(ground.planks, ground.planksN, 5, { roughness: 0.65, rotate: true }) : new THREE.MeshStandardNodeMaterial({ color: 0x141620, roughness: 0.8 });
  const pileGeo = new THREE.CylinderGeometry(0.35, 0.4, 5, 7).translate(0, 2.5, 0);
  const pileMat = new THREE.MeshStandardNodeMaterial({ color: 0x0c0d14, roughness: 0.9 });
  const piles: THREE.Matrix4[] = [];
  for (const jx of [-130, 70, 210]) {
    const len = 36;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.5, len), deckMat);
    deck.position.set(jx, 2.6, quayZ + len / 2 - 2);
    group.add(deck);
    for (let z = quayZ + 2; z < quayZ + len; z += 6) for (const dx of [-2.4, 2.4]) piles.push(new THREE.Matrix4().makeTranslation(jx + dx, -2.0, z));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 6), bollardMat);
    lamp.position.set(jx, 5.6, quayZ + len - 3);
    group.add(lamp);
    const light = new THREE.PointLight(0xffd8a0, 260, 30, 2);
    light.position.set(jx, 5.2, quayZ + len - 3);
    group.add(light);
  }
  const pim = new THREE.InstancedMesh(pileGeo, pileMat, piles.length);
  piles.forEach((m, i) => pim.setMatrixAt(i, m));
  group.add(pim);
  return group;
}

/** Cable-stayed bridge across the bay mouth (z = BRIDGE_Z); the camera flies over it around p ≈ 0.09. */
export const BRIDGE_Z = 70;
export function createBridge() {
  const group = new THREE.Group();
  const Z = BRIDGE_Z;
  const deckMat = new THREE.MeshStandardNodeMaterial({ color: 0x101420, roughness: 0.6, metalness: 0.3 });
  const deck = new THREE.Mesh(new THREE.BoxGeometry(360, 1.6, 8), deckMat);
  deck.position.set(0, 12, Z);
  group.add(deck);
  const pylonGeo = new THREE.BoxGeometry(1.8, 46, 1.8);
  const pylonMat = new THREE.MeshStandardNodeMaterial({ color: 0x0e1018, roughness: 0.7 });
  const pylonEdge = new THREE.MeshBasicNodeMaterial();
  pylonEdge.colorNode = color(PAL.cyan).mul(1.8);
  for (const px of [-62, 62]) {
    for (const dz of [-4, 4]) {
      const p = new THREE.Mesh(pylonGeo, pylonMat);
      p.position.set(px, 23, Z + dz);
      group.add(p);
      const e = new THREE.Mesh(new THREE.BoxGeometry(0.2, 46, 0.2), pylonEdge);
      e.position.set(px + 1.0, 23, Z + dz + 1.0);
      group.add(e);
    }
    const cross = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.8, 10), pylonMat);
    cross.position.set(px, 45, Z);
    group.add(cross);
  }
  // Cables: instanced thin cylinders from pylon tops to deck points (dim, so they read as structure).
  const cableGeo = new THREE.CylinderGeometry(0.06, 0.06, 1, 4).translate(0, 0.5, 0);
  const cableMat = new THREE.MeshBasicNodeMaterial();
  cableMat.colorNode = color(PAL.cyan).mul(0.7);
  const cables: THREE.Matrix4[] = [];
  const from = new THREE.Vector3(), to = new THREE.Vector3(), dir = new THREE.Vector3(), q = new THREE.Quaternion(), upv = new THREE.Vector3(0, 1, 0);
  for (const px of [-62, 62]) for (const dz of [-4, 4]) for (let i = 0; i < 8; i++) {
    for (const side of [-1, 1]) {
      const dx = side * (10 + i * 9);
      from.set(px, 44 - i * 1.6, Z + dz);
      to.set(px + dx, 12.8, Z + dz);
      dir.subVectors(to, from);
      const len = dir.length();
      q.setFromUnitVectors(upv, dir.normalize());
      cables.push(new THREE.Matrix4().compose(from.clone(), q.clone(), new THREE.Vector3(1, len, 1)));
    }
  }
  const cim = new THREE.InstancedMesh(cableGeo, cableMat, cables.length);
  cables.forEach((m, k) => cim.setMatrixAt(k, m));
  group.add(cim);
  // Deck edge lights every 6 u, alternating magenta / cyan.
  const lightGeo = new THREE.SphereGeometry(0.3, 8, 6);
  const lightMat = new THREE.MeshBasicNodeMaterial();
  lightMat.colorNode = mix(color(PAL.magenta), color(PAL.cyan), step(0.5, fract(float(0).add(hash(floor(positionWorld.x.mul(1 / 6))))))).mul(3.0);
  const lights: THREE.Matrix4[] = [];
  for (let x = -180; x <= 180; x += 6) for (const dz of [-4.3, 4.3]) {
    lights.push(new THREE.Matrix4().makeTranslation(x, 13.1, Z + dz));
  }
  const lim = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
  lights.forEach((m, k) => lim.setMatrixAt(k, m));
  group.add(lim);
  return group;
}

/** Big LED billboard: canvas text → LED-dot mask, chromatic offset, scanlines, rare glitch band. */
export function createBillboard(name: string, subtitle: string, w = 36, h = 18) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, c.width, c.height);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#eafcff';
  g.font = '700 400px "Rajdhani", "Chakra Petch", "Impact", sans-serif';
  g.fillText(name.toUpperCase(), c.width / 2, c.height * 0.42);
  g.fillStyle = '#00e5ff';
  g.font = '500 92px "IBM Plex Mono", ui-monospace, monospace';
  g.fillText(subtitle.toUpperCase(), c.width / 2, c.height * 0.78);
  // corner brackets
  g.strokeStyle = '#00e5ff'; g.lineWidth = 12;
  const b = 90, m = 60;
  for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const x0 = sx > 0 ? m : c.width - m, y0 = sy > 0 ? m : c.height - m;
    g.beginPath(); g.moveTo(x0, y0 + sy * b); g.lineTo(x0, y0); g.lineTo(x0 + sx * b, y0); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;

  const mat = new THREE.MeshBasicNodeMaterial();
  const glitch = step(0.985, hash(floor(time.mul(7)))).mul(hash(floor(uv().y.mul(18)).add(floor(time.mul(7)))).sub(0.5)).mul(0.05);
  const u = uv().add(vec2(glitch, 0));
  const r = texture(tex, u.add(vec2(0.0022, 0))).r;
  const gg = texture(tex, u).g;
  const bb = texture(tex, u.sub(vec2(0.0022, 0))).b;
  const dots = float(1).sub(smoothstep(0.34, 0.5, length(fract(uv().mul(vec2(256, 128))).sub(0.5)))).mul(0.55).add(0.45);
  const scan = step(0.5, fract(uv().y.mul(128).add(time.mul(4)))).mul(0.1).add(0.9);
  mat.colorNode = vec3(r, gg, bb).mul(dots).mul(scan).mul(3.0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  // Glowing frame
  const frameMat = new THREE.MeshBasicNodeMaterial();
  frameMat.colorNode = color(PAL.cyan).mul(2.0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.3), frameMat);
  frame.position.z = -0.2;
  const group = new THREE.Group();
  group.add(frame, mesh);
  return group;
}

export const _unused = { sub, abs };

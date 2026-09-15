import * as THREE from 'three/webgpu';
import {
  add, sub, div, vec2, vec3, float, time, texture, normalize, cameraPosition, positionWorld, positionLocal,
  transformNormalToView, sin, cos, max, dot, pow, length, mix, reflector, color, uv, step, fract, floor, hash,
  smoothstep, abs, reflect, glowMaterial, uniform,
} from './tsl';
import { PAL, loader, params } from './palette';
import { groundMaterial } from './streets';

/**
 * Hero bay: dark water with a planar reflection of the skyline, a cable-stayed bridge the camera
 * flies over, and the LED billboard on the central tower (a cyberpunk ad, `createBillboard({ image })`).
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
  // Street-to-quay ramp, aligned with the harbor deck. Ground collision uses this same linear slope.
  const rise = 3 - 0.22, run = 12;
  const ramp = new THREE.Mesh(new THREE.BoxGeometry(12, .18, Math.hypot(run, rise)), wallMat);
  ramp.rotation.x = -Math.atan2(rise, run);
  ramp.position.set(140, (3 + .22) / 2 - .09 * Math.cos(ramp.rotation.x), -28.4);
  group.add(ramp);
  for (const x of [134, 146]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(.14, .14, Math.hypot(run, rise)), wallMat);
    rail.rotation.x = ramp.rotation.x; rail.position.set(x, 2.6, -28.4); group.add(rail);
  }
  const edge = new THREE.Mesh(new THREE.BoxGeometry(780, 0.12, 0.12), glowMaterial(PAL.cyan, 1.5));
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
  // The deck runs the full width of the bay (it used to stop mid-water, visible from the pier).
  const SPAN = 1400;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(SPAN, 1.6, 8), deckMat);
  deck.position.set(0, 12, Z);
  group.add(deck);
  const pylonGeo = new THREE.BoxGeometry(1.8, 46, 1.8);
  const pylonMat = new THREE.MeshStandardNodeMaterial({ color: 0x0e1018, roughness: 0.7 });
  const pylonEdge = glowMaterial(PAL.cyan, 1.8);
  // Main cable-stayed span at ±62; plain support pylons carry the approaches out to the shores.
  for (const px of [-62, 62, -300, 300, -540, 540]) {
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
  const cableMat = glowMaterial(PAL.cyan, 0.7);
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
  for (let x = -SPAN / 2; x <= SPAN / 2; x += 6) for (const dz of [-4.3, 4.3]) {
    lights.push(new THREE.Matrix4().makeTranslation(x, 13.1, Z + dz));
  }
  const lim = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
  lights.forEach((m, k) => lim.setMatrixAt(k, m));
  group.add(lim);
  return group;
}

/** Big LED billboard: canvas text → LED-dot mask, chromatic offset, scanlines, rare glitch band. */
export interface BillboardFace {
  image: string;
  /** Optional H.264 loop of the same panel: played as a VideoTexture in the same material (skipped under `?novideo`, i.e. lite tiers). */
  video?: string;
}
/**
 * LED billboard: a 2048×1024 canvas — either a name + subtitle in the site's type (the blimp's banner) or a full-bleed
 * image (`{ image, video? }`, cover-fit; the tower's ad) — behind one LED-dot / chromatic / scanline / glitch material,
 * so both faces share the program. The image loads through the default manager (lite URL rewrite, boot progress) over
 * a dark placeholder and stays as the poster until the loop's first frame. Procedural motion for every tier (the
 * `anim` uniform, 0 for the text face): a luminance-keyed glow pulse on the bright pixels and a soft light sweep
 * crossing the panel every ~6 s, on top of the rare glitch band.
 */
export function createBillboard(face: string | BillboardFace, subtitle = '', w = 36, h = 18) {
  const c = document.createElement('canvas');
  c.width = 2048; c.height = 1024;
  const g = c.getContext('2d')!;
  g.fillStyle = '#05060c';
  g.fillRect(0, 0, c.width, c.height);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const group = new THREE.Group();
  group.userData.face = typeof face === 'string' ? 'text' : 'image';
  if (typeof face === 'string') {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#eafcff';
    g.font = '700 400px "Rajdhani", "Chakra Petch", "Impact", sans-serif';
    g.fillText(face.toUpperCase(), c.width / 2, c.height * 0.42);
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
  } else {
    new THREE.ImageLoader(THREE.DefaultLoadingManager).load(face.image, (img) => {
      const k = Math.max(c.width / img.width, c.height / img.height); // cover-fit, centred
      const dw = img.width * k, dh = img.height * k;
      g.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
      tex.needsUpdate = true;
    }, undefined, () => console.warn('[night] billboard image failed', face.image));
  }

  const mat = new THREE.MeshBasicNodeMaterial();
  const glitch = step(0.985, hash(floor(time.mul(7)))).mul(hash(floor(uv().y.mul(18)).add(floor(time.mul(7)))).sub(0.5)).mul(0.05);
  const u = uv().add(vec2(glitch, 0));
  const taps = [texture(tex, u.add(vec2(0.0022, 0))), texture(tex, u), texture(tex, u.sub(vec2(0.0022, 0)))];
  const rgb = vec3(taps[0].r, taps[1].g, taps[2].b);
  // Procedural motion (uniform gain, so the still text face renders through the same program).
  const anim = uniform(typeof face === 'string' ? 0 : 1);
  const lum = dot(rgb, vec3(0.3, 0.59, 0.11));
  const pulse = sin(time.mul(1.3)).mul(0.5).add(0.5);
  const glow = smoothstep(0.35, 0.9, lum).mul(pulse).mul(0.28);
  const sweepX = fract(time.div(6)).mul(1.7).sub(0.35); // a diagonal bar crossing the panel every 6 s
  const sweep = smoothstep(0.09, 0, abs(uv().x.add(uv().y.mul(0.25)).sub(sweepX))).mul(0.07);
  const lit = rgb.mul(float(1).add(glow.mul(anim))).add(vec3(0.55, 0.9, 1.0).mul(sweep.mul(anim)));
  const dots = float(1).sub(smoothstep(0.34, 0.5, length(fract(uv().mul(vec2(256, 128))).sub(0.5)))).mul(0.55).add(0.45);
  const scan = step(0.5, fract(uv().y.mul(128).add(time.mul(4)))).mul(0.1).add(0.9);
  mat.colorNode = lit.mul(dots).mul(scan).mul(3.0);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  // Glowing frame
  const frame = new THREE.Mesh(new THREE.BoxGeometry(w + 0.8, h + 0.8, 0.3), glowMaterial(PAL.cyan, 2.0));
  frame.position.z = -0.2;
  group.add(frame, mesh);

  // The loop: a detached muted video swapped into the same texture taps once its first frame is decoded (the canvas
  // image is the poster until then). Lite tiers set `novideo` (main.ts), so phones keep the still + the procedural motion.
  if (typeof face !== 'string' && face.video && !params.has('novideo')) {
    const v = document.createElement('video');
    Object.assign(v, { src: face.video, muted: true, loop: true, playsInline: true, autoplay: true, preload: 'auto' });
    v.setAttribute('muted', ''); v.setAttribute('playsinline', '');
    group.userData.video = v;
    const swap = () => {
      const vt = new THREE.VideoTexture(v);
      vt.colorSpace = THREE.SRGBColorSpace;
      for (const t of taps) t.value = vt;
      group.userData.face = 'video';
    };
    const rvfc = (v as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }).requestVideoFrameCallback;
    if (rvfc) rvfc.call(v, swap); else v.addEventListener('loadeddata', swap, { once: true });
    v.addEventListener('error', () => console.warn('[night] billboard loop failed', face.video), { once: true });
    v.play().catch(() => { /* autoplay refused: the poster stays */ });
  }
  return group;
}

export const _unused = { sub, abs };

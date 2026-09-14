import * as THREE from 'three/webgpu';
import { texture, uv, vec3, color, mix, step, fract, smoothstep, luminance, positionLocal, float, pow, time, uniform } from './tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL, params, rng, type Tier } from './palette';

export interface Lane { pts: [number, number, number][]; speed: number; ground?: boolean }

const gltf = new GLTFLoader();

/** Bake a loaded model into one mesh per material bucket (a car is ~15 primitives otherwise → 15 draws each). */
function bakeModel(root: THREE.Object3D, bucket: (o: THREE.Mesh) => string, materialFor: (key: string, first: any) => THREE.Material) {
  root.updateMatrixWorld(true);
  const inv = root.matrixWorld.clone().invert();
  const groups = new Map<string, { geos: THREE.BufferGeometry[]; first: THREE.Mesh }>();
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    const key = bucket(o as THREE.Mesh);
    const e = groups.get(key) ?? { geos: [] as THREE.BufferGeometry[], first: o as THREE.Mesh };
    e.geos.push(g);
    groups.set(key, e);
  });
  const out = new THREE.Group();
  out.position.copy(root.position); out.quaternion.copy(root.quaternion); out.scale.copy(root.scale);
  for (const [key, e] of groups) {
    const merged = mergeGeometries(e.geos, false);
    if (merged) out.add(new THREE.Mesh(merged, materialFor(key, e.first)));
  }
  return out;
}

/** Night repaint for the Kenney cars: dark bodies, keep wheels, warm/cool light strips from the palette. */
function nightCar(scene: THREE.Object3D, tint: number) {
  return bakeModel(scene, (o) => (/wheel|tire/i.test(o.name) ? 'wheel' : 'body'), (key) => {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.6 });
    m.colorNode = key === 'wheel' ? color(0x0a0a0d) : mix(color(0x141826), uniform(new THREE.Color(tint)), 0.35);
    return m;
  });
}

/** Car bodies: the fal hover car (light strips → emissive) for flying lanes; Kenney cars for the street. */
async function loadCarModels() {
  const hover: THREE.Object3D[] = [];
  const ground: THREE.Object3D[] = [];
  if (!params.has('kenney')) {
    try {
      const g = await gltf.loadAsync('/night/models/hovercar.glb');
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3());
      const k = 4.5 / Math.max(size.x, size.z);
      g.scene.scale.setScalar(k);
      g.scene.position.y = -box.min.y * k;
      g.scene.rotation.y = size.x > size.z ? Math.PI / 2 : 0;
      for (const tint of [PAL.cyan, PAL.magenta]) {
        const body = bakeModel(g.scene, () => 'body', (_k, first: any) => {
          const map = first.material?.map;
          const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.7 });
          const base = map ? texture(map, uv()).rgb : vec3(0.12, 0.13, 0.18);
          const strip = smoothstep(0.45, 0.7, luminance(base));
          m.colorNode = base.mul(0.5);
          m.emissiveNode = mix(uniform(new THREE.Color(tint)), color(0xffffff), step(0.5, fract(positionLocal.z.mul(0.3)))).mul(strip).mul(3.0);
          return m;
        });
        const wrap = new THREE.Group();
        wrap.add(body);
        hover.push(wrap);
      }
    } catch { /* not generated yet */ }
  }
  const tints = [0x1a2a55, 0x552a1a, 0x2a2a2a, 0x1a4a3a, 0x4a1a4a];
  await Promise.all(['sedan', 'taxi', 'suv', 'hatchback-sports', 'delivery'].map(async (f, i) => {
    try {
      const g = await gltf.loadAsync(`/night/cc0/${f}.glb`);
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3());
      const k = 4.6 / Math.max(size.x, size.z);
      g.scene.scale.setScalar(k);
      g.scene.position.y = -box.min.y * k;
      g.scene.rotation.y = size.x > size.z ? Math.PI / 2 : 0;
      const wrap = new THREE.Group();
      wrap.add(nightCar(g.scene, tints[i % tints.length]));
      ground.push(wrap);
    } catch { /* missing */ }
  }));
  if (!hover.length) hover.push(...ground);
  return { hover, ground };
}

/** Cars on CatmullRom lanes: hover cars aloft with underglow + trails, street cars with headlight pools. */
export async function createTraffic(lanes: Lane[], tier: Tier) {
  const group = new THREE.Group();
  const curves = lanes.map((l) => new THREE.CatmullRomCurve3(l.pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'));
  const { hover, ground } = await loadCarModels();
  const cars: { root: THREE.Object3D; lane: number; t: number; speed: number; ground: boolean; extras: THREE.Object3D[] }[] = [];
  const perLane = { high: 9, med: 6, low: 3 }[tier];
  const r = rng(99);
  // Light quads share materials (one pipeline each) and are hidden beyond LIGHT_RANGE — from the vista they are sub-pixel.
  const LIGHT_RANGE2 = 140 * 140;
  const poolMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  { const d = uv().sub(vec2f(0.5, 0.15)); poolMat.colorNode = color(0xfff1d0).mul(1.6); poolMat.opacityNode = float(1).sub(smoothstep(0.1, 0.55, d.length())).mul(0.45).mul(step(0.15, uv().y)); }
  const glowMats = [PAL.cyan, PAL.magenta].map((tint) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const dd = uv().sub(0.5).length();
    m.colorNode = color(tint).mul(2.5);
    m.opacityNode = float(1).sub(smoothstep(0.15, 0.5, dd)).mul(0.6);
    return m;
  });
  const tailMat = new THREE.MeshBasicNodeMaterial({ color: 0xff2040 }), headMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff });
  const poolGeo = new THREE.PlaneGeometry(5, 9), glowGeo = new THREE.PlaneGeometry(4.5, 2.6), tailGeo = new THREE.PlaneGeometry(1.6, 0.22), headGeo = new THREE.PlaneGeometry(1.6, 0.18);
  lanes.forEach((lane, li) => {
    const models = lane.ground ? ground : hover;
    if (!models.length) return;
    const n = Math.round(perLane * (lane.ground ? 1.2 : 1));
    for (let k = 0; k < n; k++) {
      const root = new THREE.Group();
      root.add(models[(k + li) % models.length].clone(true));
      const extras: THREE.Object3D[] = [];
      if (lane.ground) {
        // Headlight pool on the asphalt ahead + red tail glow.
        const pool = new THREE.Mesh(poolGeo, poolMat);
        pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.06, -6.5);
        extras.push(pool);
      } else {
        const glow = new THREE.Mesh(glowGeo, glowMats[k % 2]);
        glow.rotation.x = -Math.PI / 2; glow.position.y = -0.2;
        extras.push(glow);
      }
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.position.set(0, 0.7, 2.2);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, 0.7, -2.2); head.rotation.y = Math.PI;
      extras.push(tail, head);
      root.add(...extras);
      cars.push({ root, lane: li, t: (k + r() * 0.5) / n, speed: lane.speed * (0.8 + r() * 0.5), ground: !!lane.ground, extras });
      group.add(root);
    }
  });
  curves.forEach((curve, i) => {
    if (lanes[i].ground) return;
    for (const [tint, off, dir] of [[0xff3050, 0.9, 1], [0xffffff, -0.9, -1]] as const) {
      const tube = new THREE.TubeGeometry(curve, 200, 0.12, 6);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const s = uv().x;
      const pulse = pow(fract(s.mul(28).sub(time.mul(0.9 * dir)).add(uniform(i * 0.3))), 6.0);
      m.colorNode = uniform(new THREE.Color(tint)).mul(pulse).mul(3.0);
      m.opacityNode = pulse.mul(0.9);
      const mesh = new THREE.Mesh(tube, m);
      mesh.position.x = off;
      group.add(mesh);
    }
  });
  const tmp = new THREE.Vector3(), ahead = new THREE.Vector3();
  const update = (dt: number, t: number, viewer?: THREE.Vector3) => {
    for (const c of cars) {
      c.t = (c.t + c.speed * dt) % 1;
      if (viewer) { const near = c.root.position.distanceToSquared(viewer) < LIGHT_RANGE2; if (c.extras[0].visible !== near) for (const e of c.extras) e.visible = near; }
      const curve = curves[c.lane];
      curve.getPointAt(c.t, tmp);
      curve.getPointAt((c.t + 0.005) % 1, ahead);
      c.root.position.copy(tmp);
      c.root.lookAt(ahead);
      if (!c.ground) c.root.position.y += Math.sin(t * 2 + c.t * 20) * 0.15;
    }
  };
  return { group, update, count: cars.length, models: { hover, ground } };
}

// TSL vec2 helper (avoid importing under the name used by three's Vector2 in this file)
import { vec2 as vec2f } from './tsl';

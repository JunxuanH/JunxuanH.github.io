import * as THREE from 'three/webgpu';
import { texture, uv, vec3, color, mix, step, fract, smoothstep, luminance, positionLocal, float, pow, time } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { PAL, params, rng, type Tier } from './palette';

export interface Lane { pts: [number, number, number][]; speed: number; ground?: boolean }

const gltf = new GLTFLoader();

/** Night repaint for the Kenney cars: dark bodies, keep wheels, warm/cool light strips from the palette. */
function nightCar(scene: THREE.Object3D, tint: number) {
  scene.traverse((o: any) => {
    if (!o.isMesh) return;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.6 });
    const base = /wheel|tire/i.test(o.name) ? color(0x0a0a0d) : mix(color(0x141826), color(tint), 0.35);
    m.colorNode = base;
    o.material = m;
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
        const body = g.scene.clone(true);
        body.traverse((o: any) => {
          if (!o.isMesh) return;
          const map = o.material?.map;
          const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.7 });
          const base = map ? texture(map, uv()).rgb : vec3(0.12, 0.13, 0.18);
          const strip = smoothstep(0.45, 0.7, luminance(base));
          m.colorNode = base.mul(0.5);
          m.emissiveNode = mix(color(tint), color(0xffffff), step(0.5, fract(positionLocal.z.mul(0.3)))).mul(strip).mul(3.0);
          o.material = m;
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
      nightCar(g.scene, tints[i % tints.length]);
      const wrap = new THREE.Group();
      wrap.add(g.scene);
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
  const cars: { root: THREE.Object3D; lane: number; t: number; speed: number; ground: boolean }[] = [];
  const perLane = { high: 9, med: 6, low: 3 }[tier];
  const r = rng(99);
  lanes.forEach((lane, li) => {
    const models = lane.ground ? ground : hover;
    if (!models.length) return;
    const n = Math.round(perLane * (lane.ground ? 1.2 : 1));
    for (let k = 0; k < n; k++) {
      const root = new THREE.Group();
      root.add(models[(k + li) % models.length].clone(true));
      if (lane.ground) {
        // Headlight pool on the asphalt ahead + red tail glow.
        const poolMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
        const d = uv().sub(vec2f(0.5, 0.15));
        poolMat.colorNode = color(0xfff1d0).mul(1.6);
        poolMat.opacityNode = float(1).sub(smoothstep(0.1, 0.55, d.length())).mul(0.45).mul(step(0.15, uv().y));
        const pool = new THREE.Mesh(new THREE.PlaneGeometry(5, 9), poolMat);
        pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.06, -6.5);
        root.add(pool);
      } else {
        const glowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
        const dd = uv().sub(0.5).length();
        glowMat.colorNode = color(k % 2 ? PAL.magenta : PAL.cyan).mul(2.5);
        glowMat.opacityNode = float(1).sub(smoothstep(0.15, 0.5, dd)).mul(0.6);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.6), glowMat);
        glow.rotation.x = -Math.PI / 2; glow.position.y = -0.2;
        root.add(glow);
      }
      const tail = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), new THREE.MeshBasicNodeMaterial({ color: 0xff2040 }));
      tail.position.set(0, 0.7, 2.2);
      const head = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.18), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }));
      head.position.set(0, 0.7, -2.2); head.rotation.y = Math.PI;
      root.add(tail, head);
      cars.push({ root, lane: li, t: (k + r() * 0.5) / n, speed: lane.speed * (0.8 + r() * 0.5), ground: !!lane.ground });
      group.add(root);
    }
  });
  curves.forEach((curve, i) => {
    if (lanes[i].ground) return;
    for (const [tint, off, dir] of [[0xff3050, 0.9, 1], [0xffffff, -0.9, -1]] as const) {
      const tube = new THREE.TubeGeometry(curve, 200, 0.12, 6);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const s = uv().x;
      const pulse = pow(fract(s.mul(28).sub(time.mul(0.9 * dir)).add(i * 0.3)), 6.0);
      m.colorNode = color(tint).mul(pulse).mul(3.0);
      m.opacityNode = pulse.mul(0.9);
      const mesh = new THREE.Mesh(tube, m);
      mesh.position.x = off;
      group.add(mesh);
    }
  });
  const tmp = new THREE.Vector3(), ahead = new THREE.Vector3();
  const update = (dt: number, t: number) => {
    for (const c of cars) {
      c.t = (c.t + c.speed * dt) % 1;
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
import { vec2 as vec2f } from 'three/tsl';

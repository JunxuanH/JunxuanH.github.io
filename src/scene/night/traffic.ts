import * as THREE from 'three/webgpu';
import { texture, uv, vec3, color, mix, step, fract, smoothstep, luminance, positionLocal, float, pow, time, uniform, glowMaterial, max as tslMax, min as tslMin } from './tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PAL, params, rng, type Tier } from './palette';
import { signalStopDistance } from './crossing-logic';
import { AVENUE_HALF,CROSS_HALF,CROSS_Z } from './streets';

export interface Lane { pts: [number, number, number][]; speed: number; ground?: boolean }

const gltf = new GLTFLoader();
gltf.setDRACOLoader(new DRACOLoader().setDecoderPath('/draco/'));

/**
 * Convention: a car's root +z is its nose and its direction of travel (`update` does `root.lookAt(ahead)`, which
 * points an Object3D's +z at the target). Every model is rotated at load so its own nose lands on +z, and the
 * light quads follow: white headlights + the road pool ahead at +z, red tail bar at −z.
 */
type Nose = '+z' | '-z' | '+x' | '-x';
const NOSE_YAW: Record<Nose, number> = { '+z': 0, '-z': Math.PI, '+x': -Math.PI / 2, '-x': Math.PI / 2 };

/**
 * The fal-generated fleet (design/night/cars/<name>: concept → hunyuan3d → gltf-transform → public/night/models/cars).
 * `nose`: the model's own forward axis (read off a contact sheet after generation). `length`: world length in u
 * (nose to tail). `hover`: ride height above the lane for wheel-less vehicles. `air`: also flies the hover lanes.
 */
interface CarSpec { file: string; nose: Nose; length: number; hover?: number; air?: boolean; head: number; tail: number }
const CARS: CarSpec[] = [
  { file: 'hover-sedan', nose: '+z', length: 5.0, hover: 0.4, air: true, head: 0.55, tail: 0.6 },   // first: the landing car on the pier (main.ts) hovers by nature
  { file: 'wedge', nose: '+z', length: 4.8, air: true, head: 0.45, tail: 0.5 },
  { file: 'taxi', nose: '+z', length: 5.2, head: 0.95, tail: 0.95 },
  { file: 'van', nose: '+z', length: 6.2, head: 1.1, tail: 1.1 },
];

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

/**
 * Night paint for the fal cars: the PBR base colour dimmed, and every saturated bright texel (the concept's light
 * strips, the taxi's amber roof light and yellow stripe, the van's blue status bar) re-emitted as light.
 */
function fleetCar(scene: THREE.Object3D) {
  return bakeModel(scene, () => 'body', (_k, first: any) => {
    const src = first.material;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.42, metalness: 0.55 });
    if (src?.map) {
      const base = texture(src.map, uv()).rgb;
      const hi = tslMax(base.r, tslMax(base.g, base.b)), lo = tslMin(base.r, tslMin(base.g, base.b));
      const sat = hi.sub(lo).div(hi.add(0.02));
      const lit = smoothstep(0.45, 0.75, sat).mul(smoothstep(0.45, 0.8, hi)); // saturated and bright = a light strip
      m.colorNode = base.mul(0.62);
      m.emissiveNode = base.mul(lit).mul(2.6);
    } else {
      m.colorNode = vec3(0.12, 0.13, 0.18);
    }
    if (src?.normalMap) { m.normalMap = src.normalMap; m.normalScale = new THREE.Vector2(0.6, 0.6); }
    return m;
  });
}

/** Night repaint for the Kenney cars (`?kenney`, or the fal fleet missing): dark bodies, shared wheel material. */
let wheelMat: THREE.MeshStandardNodeMaterial | null = null;
function nightCar(scene: THREE.Object3D, tint: number) {
  return bakeModel(scene, (o) => (/wheel|tire/i.test(o.name) ? 'wheel' : 'body'), (key) => {
    if (key === 'wheel') {
      if (!wheelMat) { wheelMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.6 }); wheelMat.colorNode = color(0x0a0a0d); }
      return wheelMat;
    }
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.6 });
    m.colorNode = mix(color(0x141826), uniform(new THREE.Color(tint)), 0.35);
    return m;
  });
}

/** Loaded, oriented (nose +z), scaled model plus where its lights go (u from the root, nose/tail at ±length/2). */
interface CarModel { root: THREE.Object3D; length: number; hover: number; head: number; tail: number; width: number }

/** Orient a loaded scene nose → +z, scale it to `length` along z, ground it at y = 0 (+ hover) and centre it on its root. */
function fit(scene: THREE.Object3D, nose: Nose, length: number, hover = 0) {
  scene.rotation.y = NOSE_YAW[nose];
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const k = length / Math.max(size.z, 1e-3);
  scene.scale.setScalar(k);
  scene.position.set(-c.x * k, -box.min.y * k + hover, -c.z * k);
  return { width: size.x * k, height: size.y * k };
}

/** Car bodies: the fal fleet for both the street and the hover lanes; the Kenney cars only as a fallback. */
async function loadCarModels(): Promise<{ hover: CarModel[]; ground: CarModel[] }> {
  const hover: CarModel[] = [];
  const ground: CarModel[] = [];
  if (!params.has('kenney')) {
    await Promise.all(CARS.map(async (spec, i) => {
      try {
        const g = await gltf.loadAsync(`/night/models/cars/${spec.file}.glb`);
        const { width } = fit(g.scene, spec.nose, spec.length, spec.hover ?? 0);
        const wrap = new THREE.Group();
        wrap.add(fleetCar(g.scene));
        const model: CarModel = { root: wrap, length: spec.length, hover: spec.hover ?? 0, head: spec.head, tail: spec.tail, width };
        ground[i] = model;
        if (spec.air) hover.push(model);
      } catch (e) { console.warn('[night] car', spec.file, e); }
    }));
  }
  const fleet = ground.filter(Boolean);
  ground.length = 0; ground.push(...fleet);
  if (!ground.length) {
    // Kenney fallback (nose +z as shipped: headlights on the +z face).
    const tints = [0x1a2a55, 0x552a1a, 0x2a2a2a, 0x1a4a3a, 0x4a1a4a];
    await Promise.all(['sedan', 'taxi', 'suv', 'hatchback-sports', 'delivery'].map(async (f, i) => {
      try {
        const g = await gltf.loadAsync(`/night/cc0/${f}.glb`);
        const box = new THREE.Box3().setFromObject(g.scene);
        const size = box.getSize(new THREE.Vector3());
        const { width } = fit(g.scene, size.x > size.z ? '+x' : '+z', 4.6);
        const wrap = new THREE.Group();
        wrap.add(nightCar(g.scene, tints[i % tints.length]));
        ground.push({ root: wrap, length: 4.6, hover: 0, head: 0.7, tail: 0.7, width });
      } catch { /* missing */ }
    }));
  }
  if (!hover.length) hover.push(...ground);
  return { hover, ground };
}

/** Cars on CatmullRom lanes: hover cars aloft with underglow + trails, street cars with headlight pools. */
export async function createTraffic(lanes: Lane[], tier: Tier) {
  const group = new THREE.Group();
  const curves = lanes.map((l) => new THREE.CatmullRomCurve3(l.pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'));
  const { hover, ground } = await loadCarModels();
  const cars: { root: THREE.Object3D; lane: number; t: number; speed: number; velocity:number; length:number; ground: boolean; hover: number; extras: THREE.Object3D[] }[] = [];
  const lengths=curves.map(c=>c.getLength());
  const perLane = { high: 9, med: 6, low: 3 }[tier];
  const r = rng(99);
  // Light quads share materials (one pipeline each) and are hidden beyond LIGHT_RANGE — from the vista they are sub-pixel.
  const LIGHT_RANGE2 = 140 * 140;
  const poolMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  { const d = uv().sub(vec2f(0.5, 0.85)); poolMat.colorNode = color(0xfff1d0).mul(1.6); poolMat.opacityNode = float(1).sub(smoothstep(0.1, 0.55, d.length())).mul(0.45).mul(step(uv().y, 0.85)); }
  const glowMats = [PAL.cyan, PAL.magenta].map((tint) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const dd = uv().sub(0.5).length();
    m.colorNode = color(tint).mul(2.5);
    m.opacityNode = float(1).sub(smoothstep(0.15, 0.5, dd)).mul(0.6);
    return m;
  });
  const tailMat = glowMaterial(0xff2040, 1), headMat = glowMaterial(0xffffff, 1);
  const poolGeo = new THREE.PlaneGeometry(5, 9), glowGeo = new THREE.PlaneGeometry(4.5, 2.6), tailGeo = new THREE.PlaneGeometry(1.6, 0.22), headGeo = new THREE.PlaneGeometry(1.6, 0.18);
  lanes.forEach((lane, li) => {
    const models = lane.ground ? ground : hover;
    if (!models.length) return;
    const n = Math.round(perLane * (lane.ground ? 1.2 : 1));
    for (let k = 0; k < n; k++) {
      const model = models[(k + li) % models.length];
      const root = new THREE.Group();
      root.add(model.root.clone(true));
      const extras: THREE.Object3D[] = [];
      const nose = model.length / 2, tailZ = -model.length / 2;
      if (lane.ground) {
        // Headlight pool on the asphalt ahead of the nose (+z) + red tail glow behind.
        const pool = new THREE.Mesh(poolGeo, poolMat);
        pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.06, nose + 4.2);
        extras.push(pool);
      } else {
        const glow = new THREE.Mesh(glowGeo, glowMats[k % 2]);
        glow.rotation.x = -Math.PI / 2; glow.position.y = -0.2;
        extras.push(glow);
      }
      // Tail bar faces −z (a plane faces +z by default: turn it round); the headlight bar faces +z, the way we drive.
      const tail = new THREE.Mesh(tailGeo, tailMat);
      tail.position.set(0, model.hover + model.tail, tailZ - 0.02); tail.rotation.y = Math.PI;
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.set(0, model.hover + model.head, nose + 0.02);
      extras.push(tail, head);
      root.add(...extras);
      cars.push({ root, lane: li, t: (k + r() * 0.5) / n, speed: lane.speed * (0.8 + r() * 0.5), velocity:0,length:model.length, ground: !!lane.ground, hover: model.hover, extras });
      group.add(root);
    }
  });
  curves.forEach((curve, i) => {
    if (lanes[i].ground) return;
    for (const [tint, off, dir] of [[0xff3050, 0.9, 1], [0xffffff, -0.9, -1]] as const) {
      const tube = new THREE.TubeGeometry(curve, 200, 0.12, 6);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const s = uv().x;
      const pulse = pow(fract(s.mul(28).sub(time.mul(uniform(0.9 * dir))).add(uniform(i * 0.3))), 6.0); // direction as a uniform: one program for both trails
      m.colorNode = uniform(new THREE.Color(tint)).mul(pulse).mul(3.0);
      m.opacityNode = pulse.mul(0.9);
      const mesh = new THREE.Mesh(tube, m);
      mesh.position.x = off;
      group.add(mesh);
    }
  });
  const tmp = new THREE.Vector3(), ahead = new THREE.Vector3(), otherPos=new THREE.Vector3(),otherDir=new THREE.Vector3();
  const update = (dt: number, t: number, viewer?: THREE.Vector3, pedestrians:readonly THREE.Vector3[]=[] ) => {
    dt=Math.min(dt,.1);
    for (const c of cars) {
      const curve = curves[c.lane];
      if(c.ground) {
        curve.getPointAt(c.t,tmp);curve.getTangentAt(c.t,ahead);
        let gap=signalStopDistance(tmp.x,tmp.z,ahead.x,ahead.z,c.length/2,t);
        // Same-lane following distance, including the route's wrap seam.
        for(const other of cars) if(other!==c && other.lane===c.lane) {
          const separation=((other.t-c.t+1)%1)*lengths[c.lane]-(c.length+other.length)/2-2;
          gap=Math.min(gap,Math.max(0,separation));
        }
        // A car held in the junction (for example yielding to the player) keeps
        // conflicting approaches at their stop line even after the timer changes.
        for(const other of cars) if(other!==c && other.ground && other.lane!==c.lane) {
          curves[other.lane].getPointAt(other.t,otherPos);
          curves[other.lane].getTangentAt(other.t,otherDir);
          if(Math.abs(otherDir.dot(ahead))>.5 || Math.abs(otherPos.y-tmp.y)>2) continue;
          if(Math.abs(otherPos.x)<AVENUE_HALF+4 && CROSS_Z.some(z=>Math.abs(otherPos.z-z)<CROSS_HALF+4))
            gap=Math.min(gap,signalStopDistance(tmp.x,tmp.z,ahead.x,ahead.z,c.length/2,44));
        }
        // Yield to the player on foot without putting an invisible barrier around roads. A car is ~2 u wide and
        // a walker on a crossing drifts, so the corridor is wider than the car and the car stops further back
        // than it needs to: at 2.5 u and 1.5 u a car would pass through someone standing just off the lane
        // centre, which on a zebra looks like being run over.
        for(const pedestrian of pedestrians) if(Math.abs(pedestrian.y-tmp.y)<2) {
          const dx=pedestrian.x-tmp.x,dz=pedestrian.z-tmp.z;
          const forward=dx*ahead.x+dz*ahead.z,lateral=Math.abs(dx*ahead.z-dz*ahead.x);
          if(forward>0 && lateral<3.4) gap=Math.min(gap,Math.max(0,forward-c.length/2-2.4));
        }
        const desired=Math.min(c.speed*lengths[c.lane],Math.sqrt(2*4*gap));
        c.velocity=Math.max(0,Math.min(desired,c.velocity+2.5*dt));
        c.t=(c.t+Math.min(c.velocity*dt,gap)/lengths[c.lane])%1;
      } else c.t = (c.t + c.speed * dt) % 1;
      if (viewer) { const near = c.root.position.distanceToSquared(viewer) < LIGHT_RANGE2; if (c.extras[0].visible !== near) for (const e of c.extras) e.visible = near; }
      curve.getPointAt(c.t, tmp);
      curve.getTangentAt(c.t,ahead).add(tmp);
      c.root.position.copy(tmp);
      c.root.lookAt(ahead); // +z (the nose) toward the next point on the lane
      if (!c.ground) c.root.position.y += Math.sin(t * 2 + c.t * 20) * 0.15;
      else if (c.hover > 0) c.root.position.y += Math.sin(t * 2.6 + c.t * 20) * 0.05; // a hover sedan on the street floats a little
    }
  };
  const models = { hover: hover.map((m) => m.root), ground: ground.map((m) => m.root) };
  (window as any).__traffic = { cars, lanes };
  return { group, update, count: cars.length, models };
}

// TSL vec2 helper (avoid importing under the name used by three's Vector2 in this file)
import { vec2 as vec2f } from './tsl';

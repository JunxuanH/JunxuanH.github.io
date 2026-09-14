import * as THREE from 'three/webgpu';
import { color, step, fract, time, float, uv, smoothstep, hash } from 'three/tsl';
import { gltfLoader, applySkin } from './characters';
import type { DroneLane } from './paths';

/**
 * Drones are unrigged props flown on closed lanes with a hover bob and banked turns. Police drones
 * carry a red/blue strobe bar and a searchlight cone; ad drones carry a small holo panel (any mesh
 * you pass in `adPanel`) that keeps facing the camera.
 */
export interface DronesOptions {
  lanes: DroneLane[];
  /** Model URLs by kind; defaults to the fal drone-police model for both. */
  models?: { police?: string; ad?: string };
  /** Factory for the ad panel mesh (e.g. from ads.ts); called per ad drone. */
  adPanel?: () => THREE.Object3D;
  searchlight?: boolean;
  /** Model size (longest side) in world units. */
  size?: number;
  tier?: 'high' | 'med' | 'low';
}

interface Drone {
  root: THREE.Object3D;
  lane: DroneLane;
  curve: THREE.CatmullRomCurve3;
  length: number;
  t: number;
  phase: number;
  rotors: THREE.Object3D[];
  panel?: THREE.Object3D;
  light?: THREE.SpotLight;
}

function strobeMaterial() {
  const m = new THREE.MeshBasicNodeMaterial();
  // Left half red, right half blue, alternating at 3 Hz.
  const phase = step(0.5, fract(time.mul(3)));
  const left = step(0.5, uv().x);
  const on = left.mul(phase).add(float(1).sub(left).mul(float(1).sub(phase)));
  m.colorNode = color(0xff2030).mul(left).add(color(0x2060ff).mul(float(1).sub(left))).mul(on.mul(3.5).add(0.3));
  return m;
}

function coneMaterial(tint: THREE.ColorRepresentation) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.colorNode = color(tint);
  m.opacityNode = float(1).sub(uv().y).mul(0.18).mul(smoothstep(0.0, 0.1, uv().y));
  return m;
}

export async function createDrones(opts: DronesOptions) {
  const group = new THREE.Group();
  const loader = gltfLoader();
  const urls = { police: opts.models?.police ?? '/night/characters/drone-police/model.glb', ad: opts.models?.ad ?? opts.models?.police ?? '/night/characters/drone-police/model.glb' };
  const cache = new Map<string, THREE.Group>();
  const load = async (u: string) => {
    if (!cache.has(u)) {
      try { cache.set(u, (await loader.loadAsync(u)).scene); }
      catch (e) {
        console.warn('[drones] model failed, using a placeholder', u, e);
        const g = new THREE.Group();
        g.add(new THREE.Mesh(new THREE.BoxGeometry(1, 0.3, 1.2), new THREE.MeshStandardNodeMaterial({ color: 0x30343c, roughness: 0.6 })));
        cache.set(u, g);
      }
    }
    return cache.get(u)!;
  };
  const size = opts.size ?? 1.6;
  const drones: Drone[] = [];
  const lanes = opts.tier === 'low' ? opts.lanes.slice(0, 2) : opts.lanes;

  for (let i = 0; i < lanes.length; i++) {
    const lane = lanes[i];
    const src = await load(lane.kind === 'ad' ? urls.ad : urls.police);
    const root = new THREE.Group();
    const body = src.clone(true);
    applySkin(body, { rim: lane.kind === 'ad' ? 0x00e5ff : 0xff9a3d, rimStrength: 0.5, glow: true, glowStrength: 3 });
    const box = new THREE.Box3().setFromObject(body);
    const s = size / (Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1);
    body.scale.setScalar(s);
    body.position.y = -((box.max.y + box.min.y) / 2) * s;
    root.add(body);

    // Rotor discs (spun in update) — four thin cylinders near the corners of the body footprint.
    const rotors: THREE.Object3D[] = [];
    const rot = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0.35 });
    rot.colorNode = color(0x9aa4b8);
    const hx = (box.max.x - box.min.x) * s * 0.42, hz = (box.max.z - box.min.z) * s * 0.42, top = (box.max.y - box.min.y) * s * 0.5;
    for (const [x, z] of [[-hx, -hz], [hx, -hz], [-hx, hz], [hx, hz]]) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(size * 0.16, size * 0.16, 0.01, 12), rot);
      disc.position.set(x, top + 0.02, z);
      root.add(disc); rotors.push(disc);
    }

    let light: THREE.SpotLight | undefined;
    let panel: THREE.Object3D | undefined;
    if (lane.kind === 'police') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(size * 0.5, 0.05, 0.12), strobeMaterial());
      bar.position.y = top + 0.06;
      root.add(bar);
      if (opts.searchlight !== false && opts.tier !== 'low') {
        light = new THREE.SpotLight(0xdff2ff, 30, 40, Math.PI / 12, 0.5, 1.1);
        light.position.set(0, -0.1, 0);
        light.target.position.set(0, -20, 6);
        root.add(light, light.target);
        const cone = new THREE.Mesh(new THREE.ConeGeometry(3.2, 18, 20, 1, true), coneMaterial(0xdff2ff));
        cone.rotation.x = Math.PI - 0.28;
        cone.position.set(0, -9, 2.6);
        root.add(cone);
      }
    } else {
      panel = opts.adPanel?.();
      if (!panel) {
        const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });
        m.colorNode = color(0x00e5ff).mul(step(0.5, fract(uv().y.mul(40).add(time.mul(4)))).mul(0.3).add(0.8));
        m.opacityNode = float(0.55);
        panel = new THREE.Mesh(new THREE.PlaneGeometry(size * 1.4, size * 0.8), m);
      }
      panel.position.y = -size * 0.75;
      root.add(panel);
    }
    const curve = new THREE.CatmullRomCurve3(lane.points.map((p) => new THREE.Vector3(...p)), true, 'centripetal');
    drones.push({ root, lane, curve, length: curve.getLength(), t: (i * 0.37) % 1, phase: i * 2.1, rotors, panel, light });
    group.add(root);
  }

  const tmp = new THREE.Vector3(), ahead = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  let elapsed = 0;
  const update = (dt: number, camera: THREE.Camera) => {
    elapsed += dt;
    for (const d of drones) {
      d.t = (d.t + (d.lane.speed * dt) / d.length) % 1;
      d.curve.getPointAt(d.t, tmp);
      d.curve.getPointAt((d.t + 0.02) % 1, ahead);
      const prev = d.root.position.clone();
      d.root.position.copy(tmp);
      d.root.position.y += Math.sin(elapsed * 2.5 + d.phase) * 0.3; // 0.4 Hz hover bob
      m4.lookAt(ahead, tmp, THREE.Object3D.DEFAULT_UP);
      q.setFromRotationMatrix(m4);
      d.root.quaternion.slerp(q, 0.08);
      // Bank into turns: roll from lateral velocity change.
      const lateral = new THREE.Vector3().subVectors(d.root.position, prev).cross(new THREE.Vector3(0, 1, 0)).length();
      d.root.rotateZ(THREE.MathUtils.clamp(-lateral * 0.15, -0.25, 0.25) * 0.2);
      for (const r of d.rotors) r.rotation.y += dt * 40;
      if (d.panel) d.panel.quaternion.copy(d.root.quaternion.clone().invert()).multiply(camera.quaternion);
      if (d.light) d.light.intensity = 24 + Math.sin(elapsed * 1.3 + d.phase) * 8;
    }
  };
  return { group, update, drones };
}

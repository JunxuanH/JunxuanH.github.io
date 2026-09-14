import * as THREE from 'three/webgpu';
import { uv, float, smoothstep, color, sin, time, fract, step, hash } from './tsl';
import { instantiate, strideOf, type CharacterAsset, type SkinOptions } from './characters';
import type { PathDef } from './paths';

/**
 * Bipedal security robots: walk a patrol loop, pause at stall points with an idle clip while the
 * shoulder searchlight sweeps. `asset` is the rigged `sec-bot` (or any humanoid rig as fallback).
 */
export interface RobotsOptions {
  asset: CharacterAsset;
  patrols: PathDef[];
  /** One robot per patrol by default; extra robots share loops with an offset. */
  count?: number;
  height?: number;
  speed?: number;
  strideSpeed?: number;
  searchlight?: boolean;
  /** Visor / accent colours cycled per robot (tint variants of one rig). */
  accents?: THREE.ColorRepresentation[];
  skin?: SkinOptions;
}

interface Robot {
  inst: ReturnType<typeof instantiate>;
  curve: THREE.CatmullRomCurve3;
  length: number;
  stalls: NonNullable<PathDef['stalls']>;
  t: number;
  state: 'walk' | 'stall';
  until: number;
  lastStall: number;
  light?: THREE.SpotLight;
  cone?: THREE.Mesh;
  phase: number;
}

function coneMaterial(tint: THREE.ColorRepresentation) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.colorNode = color(tint);
  // Fades toward the wide end and at the rim of the cone.
  m.opacityNode = float(1).sub(uv().y).mul(0.22).mul(smoothstep(0.0, 0.15, uv().y));
  return m;
}

export function createRobots(opts: RobotsOptions) {
  const group = new THREE.Group();
  const robots: Robot[] = [];
  const count = opts.count ?? opts.patrols.length;
  const accents = opts.accents ?? [0x00e5ff, 0xff2bd6];
  const speed = opts.speed ?? 1.1;
  const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();

  for (let i = 0; i < count; i++) {
    const path = opts.patrols[i % opts.patrols.length];
    const curve = new THREE.CatmullRomCurve3(path.points.map((p) => new THREE.Vector3(...p)), path.closed, 'centripetal');
    const accent = accents[i % accents.length];
    const inst = instantiate(opts.asset, { rim: accent, rimStrength: 0.9, glow: true, glowStrength: 2.6, height: opts.height, ...opts.skin });
    inst.play('walk', 0);
    const a = inst.actions.get('walk');
    if (a) a.timeScale = speed / (opts.strideSpeed ?? strideOf(inst)); // rigs.ts stride: no foot slide
    group.add(inst.root);
    const r: Robot = {
      inst, curve, length: curve.getLength(), stalls: path.stalls ?? [], t: (i / Math.max(1, count)) * 0.5, state: 'walk', until: 0, lastStall: -1, phase: i * 1.7,
    };
    if (opts.searchlight !== false) {
      const light = new THREE.SpotLight(accent, 40, 26, Math.PI / 9, 0.6, 1.2);
      light.position.set(0.35, inst.height * 0.82, 0.1);
      light.target.position.set(0.35, 0, 6);
      inst.root.add(light, light.target);
      // Apex at the head, wide end forward and down; v flipped so the cone is bright at the lamp (see drones.ts).
      const coneGeo = new THREE.ConeGeometry(2.2, 9, 20, 1, true);
      const cu = coneGeo.attributes.uv;
      for (let i = 0; i < cu.count; i++) cu.setY(i, 1 - cu.getY(i));
      const cone = new THREE.Mesh(coneGeo, coneMaterial(accent));
      cone.rotation.x = -Math.PI / 2 + 0.28;
      cone.position.set(0.35, inst.height * 0.82, 4.4);
      inst.root.add(cone);
      cone.visible = false;
      r.light = light; r.cone = cone;
      light.intensity = 0;
    }
    robots.push(r);
  }

  let elapsed = 0;
  const update = (dt: number, camera: THREE.Camera) => {
    elapsed += dt;
    for (const r of robots) {
      const root = r.inst.root;
      if (r.state === 'stall') {
        // Searchlight sweep while idle.
        const sweep = Math.sin(elapsed * 0.9 + r.phase) * 0.5;
        root.rotation.y += (sweep - (root.userData.sweep ?? 0)) * 0.02;
        root.userData.sweep = sweep;
        if (r.light) r.light.intensity = 40 + Math.sin(elapsed * 6) * 6;
        if (elapsed > r.until) {
          r.state = 'walk';
          r.inst.play('walk');
          if (r.light) { r.light.intensity = 0; r.cone!.visible = false; }
        }
      } else {
        r.t += (speed * dt) / r.length;
        if (r.curve.closed) r.t = ((r.t % 1) + 1) % 1; else if (r.t > 1) r.t = 0;
        r.curve.getPointAt(r.t, tmp);
        r.curve.getTangentAt(r.t, tan);
        root.position.copy(tmp);
        m4.lookAt(tan.clone().add(tmp), tmp, THREE.Object3D.DEFAULT_UP);
        q.setFromRotationMatrix(m4);
        root.quaternion.slerp(q, 0.12);
        r.stalls.forEach((s, si) => {
          if (r.state !== 'walk' || si === r.lastStall) return;
          if (tmp.distanceTo(new THREE.Vector3(...s.pos)) < 1.5) {
            r.state = 'stall'; r.until = elapsed + 6 + Math.random() * 6; r.lastStall = si;
            if (s.face) { m4.lookAt(new THREE.Vector3(...s.face), root.position, THREE.Object3D.DEFAULT_UP); root.quaternion.setFromRotationMatrix(m4); }
            r.inst.play(s.clip ?? 'idle');
            if (r.light) { r.light.intensity = 40; r.cone!.visible = true; }
          }
        });
        if (r.lastStall >= 0 && r.state === 'walk') {
          const s = r.stalls[r.lastStall];
          if (tmp.distanceTo(new THREE.Vector3(...s.pos)) > 4) r.lastStall = -1;
        }
      }
      const far = camera.position.distanceTo(root.getWorldPosition(tmp)) > 110;
      // Cull the body, never the light: a light leaving the visible set changes the lights hash of every
      // material in the scene and three regenerates all their shaders (multi-second hitches).
      for (const c of root.children) if (!(c as any).isLight && c !== r.light?.target && c !== r.cone) c.visible = !far;
      if (far) { if (r.cone) r.cone.visible = false; if (r.light) r.light.intensity = 0; }
      if (!far) r.inst.mixer.update(dt);
    }
  };
  return { group, update, robots };
}

/** Emissive visor flicker helper for any mesh named like a visor (call after applySkin if wanted). */
export function visorFlicker(mesh: THREE.Mesh, tint: THREE.ColorRepresentation) {
  const m = new THREE.MeshBasicNodeMaterial();
  const flick = step(0.9, hash(time.mul(18).floor())).mul(0.5).add(0.6);
  m.colorNode = color(tint).mul(flick).mul(sin(time.mul(2)).mul(0.1).add(2.4));
  mesh.material = m;
}

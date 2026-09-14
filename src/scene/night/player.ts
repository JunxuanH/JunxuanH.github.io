/**
 * The protagonist (netrunner rig) and the third-person camera that follows it. Movement is camera-relative
 * (yaw of the follow camera), walk 2.2 / run 4.2 u/s with 12 u/s² acceleration, the heading slerps toward
 * the move direction, and idle / walk / run are chosen by speed. Ground height and collisions come from
 * walkable.ts. The camera hangs 5.5 u behind and 2.4 u above the feet (orbit yaw/pitch from drag), looks at
 * the head + 2 u ahead, damps exponentially, shortens its boom against walls and bobs a little on the move.
 */
import * as THREE from 'three/webgpu';
import { instantiate, type CharacterAsset, type Instance } from './characters';
import { PAL } from './palette';
import { limitCamera, resolve, groundY, type Area } from './walkable';
import type { InputState } from './input';

export const WALK = 2.2, RUN = 4.2, ACCEL = 12, DECEL = 18;
const STRIDE_WALK = 1.2;   // clip stride speed at timeScale 1 (characters.ts walkers)
const STRIDE_RUN = 3.4;
const BOOM = 5.8, PITCH0 = Math.asin(1.8 / 5.8); // 5.5 back, 2.4 up at the default pitch (pivot 0.6 above the feet)
const PITCH_MIN = THREE.MathUtils.degToRad(-10), PITCH_MAX = THREE.MathUtils.degToRad(35);
const HEAD = 1.6;

export interface PlayerOptions {
  asset: CharacterAsset;
  height?: number;
  /** Footstep cue (stride phase). */
  onStep?: () => void;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createPlayer(opts: PlayerOptions) {
  const inst: Instance = instantiate(opts.asset, { height: opts.height ?? 1.75, rim: PAL.yellow, rimStrength: 0.9 });
  const root = inst.root;
  root.name = 'player';
  inst.play('idle', 0);

  let area: Area | null = null;
  const pos = root.position;                 // feet
  const prev = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const wish = new THREE.Vector3(), dir = new THREE.Vector3(), right = new THREE.Vector3();
  let yaw = 0, speed = 0, phase = 0, stepIdx = 0, bob = 0;
  let clip: 'idle' | 'walk' | 'run' = 'idle';

  // Follow camera state
  let camYaw = 0, pitch = PITCH0;
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  const desired = new THREE.Vector3(), pivot = new THREE.Vector3(), lookT = new THREE.Vector3();

  const camDir = () => dir.set(Math.sin(camYaw), 0, Math.cos(camYaw));
  const desiredCamera = () => {
    camDir();
    pivot.set(pos.x, pos.y + 0.6, pos.z);
    desired.set(-dir.x * Math.cos(pitch), Math.sin(pitch), -dir.z * Math.cos(pitch)).multiplyScalar(BOOM).add(pivot);
    if (area) limitCamera(area, pivot, desired);
    desired.y = Math.max(desired.y, pos.y + 0.5);
    lookT.set(pos.x + dir.x * 2, pos.y + HEAD, pos.z + dir.z * 2);
  };

  /** Drop the character at (x, y, z) facing `facing` (radians, +z = 0); the camera snaps behind it. */
  function teleport(x: number, y: number, z: number, facing: number) {
    pos.set(x, y, z);
    if (area) pos.y = groundY(area, x, z);
    prev.copy(pos);
    vel.set(0, 0, 0); speed = 0;
    yaw = camYaw = facing; pitch = PITCH0;
    root.rotation.y = yaw;
    desiredCamera();
    camPos.copy(desired); camLook.copy(lookT);
    if (clip !== 'idle') { clip = 'idle'; inst.play('idle', 0); }
    root.updateMatrixWorld(true);
  }

  /**
   * One frame. `control` = the player may move / orbit (walk mode); otherwise only the animation and the
   * damped camera keep running (dock, transitions).
   */
  function update(dt: number, input: InputState, control: boolean) {
    if (control) {
      camYaw -= input.orbitX * 0.005;
      pitch = THREE.MathUtils.clamp(pitch + input.orbitY * 0.004, PITCH_MIN, PITCH_MAX);
    }
    camDir();
    right.set(-dir.z, 0, dir.x); // right-handed: looking down +z, +x is to the left
    const mv = control ? input.move : null;
    const len = mv ? Math.min(1, mv.length()) : 0;
    wish.set(0, 0, 0);
    if (len > 0.001) wish.addScaledVector(dir, mv!.y).addScaledVector(right, mv!.x).normalize();
    const target = len * (input.run && control ? RUN : WALK);
    // Velocity approaches wish * target with a bounded change per frame (faster to stop than to start).
    const tx = wish.x * target, tz = wish.z * target;
    const dx = tx - vel.x, dz = tz - vel.z, dl = Math.hypot(dx, dz);
    const maxStep = (target < speed ? DECEL : ACCEL) * dt;
    if (dl > maxStep) { vel.x += (dx / dl) * maxStep; vel.z += (dz / dl) * maxStep; } else { vel.x = tx; vel.z = tz; }
    speed = Math.hypot(vel.x, vel.z);
    if (speed > 1e-3) {
      prev.copy(pos);
      pos.x += vel.x * dt; pos.z += vel.z * dt;
      if (area) resolve(area, pos, prev);
      // Sliding along a wall: keep the visible speed honest.
      speed = Math.min(speed, pos.distanceTo(prev) / Math.max(dt, 1e-4));
    }
    if (len > 0.05) {
      const want = Math.atan2(wish.x, wish.z);
      yaw = wrapAngle(yaw + wrapAngle(want - yaw) * (1 - Math.exp(-10 * dt)));
      root.rotation.y = yaw;
    }
    // Clips by speed, 0.2 s fades; stride keeps the feet from sliding.
    const next: typeof clip = speed < 0.25 ? 'idle' : speed < 3.1 ? 'walk' : 'run';
    if (next !== clip) { clip = next; inst.play(next, 0.2); }
    const walkA = inst.actions.get('walk'), runA = inst.actions.get('run');
    if (walkA) walkA.timeScale = clip === 'walk' ? THREE.MathUtils.clamp(speed / STRIDE_WALK, 0.6, 2.2) : 1;
    if (runA) runA.timeScale = clip === 'run' ? THREE.MathUtils.clamp(speed / STRIDE_RUN, 0.7, 1.5) : 1;
    inst.mixer.update(dt);
    if (speed > 0.3) {
      phase += (speed * dt) / (clip === 'run' ? 1.5 : 0.9);
      const i = Math.floor(phase);
      if (i !== stepIdx) { stepIdx = i; opts.onStep?.(); }
      bob += dt * (2.2 + speed * 1.6);
    }
    // Camera: damped toward the boom pose, bobbing with the stride.
    desiredCamera();
    camPos.lerp(desired, 1 - Math.exp(-8 * dt));
    camLook.lerp(lookT, 1 - Math.exp(-10 * dt));
    camPos.y += Math.sin(bob) * 0.05 * Math.min(1, speed / 2);
  }

  return {
    root, inst,
    get position() { return pos; },
    get yaw() { return yaw; },
    get speed() { return speed; },
    get camera() { return { pos: camPos, look: camLook }; },
    setArea(a: Area | null) { area = a; },
    teleport, update,
  };
}

export type Player = ReturnType<typeof createPlayer>;

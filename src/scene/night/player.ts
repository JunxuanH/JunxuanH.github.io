/**
 * The protagonist (the `agent` rig by default — main.ts picks it) and the third-person camera that follows
 * it. Movement is camera-relative (yaw of the follow camera), walk 2.4 / run 5.0 u/s with 12 u/s²
 * acceleration, the heading slerps toward the move direction, and idle / walk / run are chosen by speed.
 * Ground height and collisions come from walkable.ts. The camera hangs 5.5 u behind and 2.4 u above the
 * feet (orbit yaw/pitch from drag), looks at the head + 2 u ahead, damps exponentially, shortens its boom
 * against walls and bobs a little on the move. Height, head height, clip stride speeds and the footstep
 * length come from the rig's rigs.ts row (through the instance), so any audited rig can be the player.
 */
import * as THREE from 'three/webgpu';
import { instantiate, strideOf, type CharacterAsset, type Instance } from './characters';
import { PAL } from './palette';
import { limitCamera, resolve, groundY, type Area } from './walkable';
import type { InputState } from './input';

export const WALK = 2.4, RUN = 5.0, ACCEL = 12, DECEL = 18; // soldier: walk clip 1.54 u/s (timeScale 1.56), run clip 4.60 (1.09)
const BOOM = 5.8, PITCH0 = Math.asin(1.8 / 5.8); // 5.5 back, 2.4 up at the default pitch (pivot 0.6 above the feet)
const PITCH_MIN = THREE.MathUtils.degToRad(-10), PITCH_MAX = THREE.MathUtils.degToRad(35);

export interface PlayerOptions {
  asset: CharacterAsset;
  /** World height (default: the rig's rigs.ts height). */
  height?: number;
  /** Neon rim colour (default: the CTA yellow). */
  rim?: THREE.ColorRepresentation;
  /** Footstep cue (stride phase). */
  onStep?: () => void;
}

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

export function createPlayer(opts: PlayerOptions) {
  const inst: Instance = instantiate(opts.asset, { height: opts.height, rim: opts.rim ?? PAL.yellow, rimStrength: 0.9 });
  const root = inst.root;
  root.name = 'player';
  inst.play('idle', 0);
  // Rig-specific numbers (rigs.ts row scaled to the instance): clip stride speeds at timeScale 1 (u/s),
  // head height (camera focus) and the distance between footfalls (step cue).
  const STRIDE_WALK = strideOf(inst, 'walk'), STRIDE_RUN = strideOf(inst, 'run');
  const HEAD = inst.headY;
  const rigScale = inst.height / inst.meta.height;
  const STEP_WALK = inst.meta.stepLen * rigScale, STEP_RUN = inst.meta.stepLenRun * rigScale;

  let area: Area | null = null;
  const pos = root.position;                 // feet
  const prev = new THREE.Vector3();
  const vel = new THREE.Vector3();
  const wish = new THREE.Vector3(), dir = new THREE.Vector3(), right = new THREE.Vector3();
  let yaw = 0, speed = 0, phase = 0, stepIdx = 0, bob = 0;
  let clip: 'idle' | 'walk' | 'run' = 'idle';
  // Idle variety: after IDLE_VARIETY_AFTER s standing still play the rig's one-shot `lookaround` clip (when it
  // has one), hold its last frame and crossfade back to idle. Any movement cancels it.
  const IDLE_VARIETY_AFTER = 8;
  let idleFor = 0, variety = false;
  const lookA = inst.actions.get('lookaround') ?? null;
  if (lookA) { lookA.setLoop(THREE.LoopOnce, 1); lookA.clampWhenFinished = true; }
  inst.mixer.addEventListener('finished', (e: any) => {
    if (e.action !== lookA || !variety) return;
    variety = false; idleFor = 0;
    if (clip === 'idle') inst.play('idle', 0.35);
  });

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
    if (clip !== 'idle' || variety) { clip = 'idle'; variety = false; inst.play('idle', 0); }
    idleFor = 0;
    root.updateMatrixWorld(true);
  }

  /** Turn to face (x, z) now; the follow camera swings behind (so leaving a carrier resumes facing it). */
  function face(x: number, z: number) {
    const dx = x - pos.x, dz = z - pos.z;
    if (Math.hypot(dx, dz) < 0.05) return;
    yaw = camYaw = Math.atan2(dx, dz);
    root.rotation.y = yaw;
  }

  /**
   * Phone dock camera: over the character's shoulder, 4.2 u back (more for wide carriers) and 2.2 u up along the
   * line to `target` (a carrier's mount), nudged sideways so the character does not cover it. The bottom sheet hides the lower half
   * of the screen, so the look direction is pitched ~16° under the target: it lands in the upper quarter whether
   * it is a kiosk screen 2 u away or an LED wall 25 u up the tower.
   */
  function frame(target: THREE.Vector3, normal: THREE.Vector3 | null, width: number, outPos: THREE.Vector3, outLook: THREE.Vector3) {
    let dx = pos.x - target.x, dz = pos.z - target.z, l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l; // target → character
    // Mostly the screen's own facing direction (so a poster is never read edge-on), pulled toward where the character stands.
    if (normal && Math.hypot(normal.x, normal.z) > 0.2) { const nl = Math.hypot(normal.x, normal.z); dx = dx * 0.35 + (normal.x / nl) * 0.65; dz = dz * 0.35 + (normal.z / nl) * 0.65; const bl = Math.hypot(dx, dz) || 1; dx /= bl; dz /= bl; }
    const back = THREE.MathUtils.clamp(width * 1.5, 4.2, 16) + Math.min(l, 4); // a 3 u kiosk screen from ~7 u, a 10 u board from ~19 (portrait hFOV ≈ 31°)
    pivot.set(pos.x, pos.y + 0.6, pos.z);
    outPos.set(target.x + dx * back - dz * 1.1, pos.y + 2.2 + (back - 6) * 0.2, target.z + dz * back + dx * 1.1);
    if (area) limitCamera(area, pivot, outPos);
    outPos.y = Math.max(outPos.y, pos.y + 0.8);
    const tx = target.x - outPos.x, ty = target.y - outPos.y, tz = target.z - outPos.z;
    const h = Math.hypot(tx, tz) || 1, a = Math.atan2(ty, h) - 0.29;
    outLook.set(outPos.x + tx, outPos.y + Math.tan(a) * h, outPos.z + tz);
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
    const next: typeof clip = speed < 0.25 ? 'idle' : speed < 3.4 ? 'walk' : 'run';
    if (next !== clip) { clip = next; variety = false; idleFor = 0; inst.play(next, 0.2); }
    else if (clip === 'idle' && lookA && !variety && (idleFor += dt) > IDLE_VARIETY_AFTER) { variety = true; inst.play('lookaround', 0.3); }
    const walkA = inst.actions.get('walk'), runA = inst.actions.get('run');
    if (walkA) walkA.timeScale = clip === 'walk' ? THREE.MathUtils.clamp(speed / STRIDE_WALK, 0.6, 2.2) : 1;
    if (runA) runA.timeScale = clip === 'run' ? THREE.MathUtils.clamp(speed / STRIDE_RUN, 0.7, 1.5) : 1;
    inst.mixer.update(dt);
    if (speed > 0.3) {
      phase += (speed * dt) / (clip === 'run' ? STEP_RUN : STEP_WALK);
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
    teleport, face, frame, update,
  };
}

export type Player = ReturnType<typeof createPlayer>;

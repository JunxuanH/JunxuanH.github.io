/**
 * Navigation state machine. `journey.p` is still the camera's position on the rail (journey.ts), but it is
 * tweened by `panTo`, never scrolled. Modes: `ride` (on the rail: the hero vista, or a pan in flight),
 * `walk` (the protagonist walks a district, third-person camera), `dock` (camera parked on a carrier's
 * dwell pose, the slab is interactive). Every mode change blends the camera from where it is to the new
 * target over a short window; `resolveCamera` does the blend each frame from the poses main.ts computes.
 */
import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { NAV_TARGET, poseAt, sectionAt, rig, easeName, panDuration, pathTurn, flyover, isAdjacent, type SectionId } from './journey';
import { reducedMotion } from './palette';
import type { CarrierId } from './carriers/index';
import type { WalkSection } from './walkable';

export type Mode = 'ride' | 'walk' | 'dock';
export type DockId = CarrierId;
export interface Pose { pos: THREE.Vector3; look: THREE.Vector3 }

/** Where the protagonist appears on arrival (feet), facing `yaw` (radians, 0 = +z). */
export const SPAWN: Record<WalkSection, { pos: [number, number, number]; yaw: number }> = {
  education: { pos: [-80, 0.22, -90], yaw: Math.PI },              // on the plaza axis, facing the terminal
  work: { pos: [-14.5, 0.22, -84], yaw: Math.PI },                  // west sidewalk, facing down the avenue
  projects: { pos: [54, 0, -226], yaw: Math.PI / 2 },               // market street, facing the holo stall
  contact: { pos: [140, 2.9, 4], yaw: 0 },                          // pier deck, facing the departures board
};

/** Taxi pads: stepping on one pans to the next stop. `yaw` is the direction the sign faces. */
export const EXITS: Record<WalkSection, { pos: [number, number, number]; next: SectionId; label: string; yaw: number }> = {
  education: { pos: [-62, 0.22, -70], next: 'work', label: 'DOWNTOWN', yaw: -Math.PI / 2 },
  work: { pos: [-15, 0.22, -206], next: 'projects', label: 'MARKET', yaw: 0 },
  projects: { pos: [84, 0, -228], next: 'contact', label: 'HARBOR', yaw: Math.PI / 2 },
  contact: { pos: [140, 2.9, -14], next: 'city', label: 'CITY', yaw: 0 },
};

/** Dock poses are the rail's dwell poses (sampled from journey.ts so they stay in sync with KEYS). */
export const DOCK_P: Record<DockId, number> = {
  education: 0.228, 'amd-intern': 0.31, kioxia: 0.42, 'amd-dc': 0.535, apple: 0.66, projects: 0.82, contact: 0.99,
};
const dockCache = new Map<DockId, Pose>();
export function dockPose(id: DockId): Pose {
  let p = dockCache.get(id);
  if (!p) { p = { pos: new THREE.Vector3(), look: new THREE.Vector3() }; poseAt(DOCK_P[id], p.pos, p.look); dockCache.set(id, p); }
  return p;
}

export interface NavOptions {
  journey: { p: number };
  onMode?(mode: Mode, prev: Mode): void;
  onSection?(id: SectionId): void;
  onEnterWalk?(id: WalkSection): void;
  onLeaveWalk?(): void;
  onDock?(id: DockId): void;
  onUndock?(id: DockId): void;
  /** Per-frame offset added to a dock pose (the blimp's displacement while docked on it). */
  dockOffset?(id: DockId, out: THREE.Vector3): THREE.Vector3;
  /** A carrier's own full dock pose (Carrier.dockPose); return false to fall back to the dwell pose + offset. */
  dockPoseOf?(id: DockId, pos: THREE.Vector3, look: THREE.Vector3): boolean;
}

const smooth = (t: number) => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };

export function createNav(opts: NavOptions) {
  const { journey } = opts;
  let mode: Mode = 'ride';
  let section: SectionId = sectionAt(journey.p);
  let docked: DockId | null = null;
  let inFlight = false;
  let tween: gsap.core.Tween | null = null;
  // Non-adjacent jumps leave the rail: a fly-over (journey.ts) climbs over the skyline and settles on the target pose.
  let flight: { from: number; to: number; pose(t: number, pos: THREE.Vector3, look: THREE.Vector3): void } | null = null;
  const flightState = { t: 0 };

  // Camera blend: from the pose the camera had at the last mode change toward the current mode's target.
  const from: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const last: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const target: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const off = new THREE.Vector3();
  let blendT = 0, blendDur = 0, started = false;

  /** Glide from wherever the camera is now to the current target over `dur` s (mode changes, redirected pans). */
  const blendFromCurrent = (dur: number) => {
    from.pos.copy(last.pos); from.look.copy(last.look);
    blendT = 0; blendDur = reducedMotion || !started ? 0 : dur;
  };
  const setMode = (m: Mode, dur: number) => {
    if (m === mode) return;
    const prev = mode;
    mode = m;
    blendFromCurrent(dur);
    (window as any).__mode = m;
    opts.onMode?.(m, prev);
  };
  const setSection = (id: SectionId) => {
    if (id === section) return;
    section = id;
    opts.onSection?.(id);
  };

  function enterWalk(id: WalkSection) {
    setMode('walk', 1.2);
    opts.onEnterWalk?.(id);
  }
  function arrive(id: SectionId) {
    inFlight = false;
    if (flight) rig.reset(); // the rig saw a constant p during the flight: forget that history before p lands on the target
    rig.navFlight = false;   // after reset, so the parallax springs back in instead of snapping
    tween = null;
    flight = null;
    if (id !== 'city') enterWalk(id);
  }

  /**
   * Cinematic move to a section's dwell; arrival hands over to the character (except the hero). Neighbouring sections
   * pan along the rail (duration floored by the path's turn rate); farther jumps fly over the skyline instead of
   * retracing the rail. Reduced motion cuts.
   */
  function panTo(id: SectionId) {
    if (mode === 'dock') undock();
    if (mode === 'walk' && id === section) return; // already there
    const fromId = section, fromP = journey.p, to = NAV_TARGET[id];
    setSection(id);
    tween?.kill();
    flight = null;
    inFlight = true;
    rig.navFlight = true;
    if (mode !== 'ride') { setMode('ride', 0.8); opts.onLeaveWalk?.(); rig.reset(); }
    else if (tween || started) blendFromCurrent(0.8); // redirected mid-pan: glide onto the new move instead of snapping
    if (reducedMotion || Math.abs(to - fromP) < 1e-4) { journey.p = to; arrive(id); return; }
    if (isAdjacent(fromId, id)) {
      const duration = Math.max(panDuration(fromP, to), pathTurn(fromP, to) / 150);
      tween = gsap.to(journey, { p: to, duration, ease: easeName, onComplete: () => arrive(id) });
    } else {
      const f = flyover(fromP, to);
      flight = { from: fromP, to, pose: f.pose };
      flightState.t = 0;
      // The flight carries its own easing (tween t linearly). p-gated visibility (districts, slabs, water, audio) switches
      // from the source to the destination at the apex, where both are far below.
      tween = gsap.to(flightState, {
        t: 1, duration: f.duration, ease: 'none',
        onUpdate: () => { journey.p = flightState.t < 0.5 ? fromP : to; },
        onComplete: () => { journey.p = to; arrive(id); },
      });
    }
  }

  /**
   * Rail pose for this frame (or the fly-over's) into pos/look. Returns the p to feed rig.update: the real p on the
   * rail, a constant during a fly-over so no rail-derived look-ahead or banking leaks into the flight.
   */
  function samplePath(pos: THREE.Vector3, look: THREE.Vector3): number {
    if (flight) { flight.pose(THREE.MathUtils.clamp(flightState.t, 0, 1), pos, look); return flight.from; }
    poseAt(journey.p, pos, look);
    return journey.p;
  }

  function dock(id: DockId) {
    if (mode !== 'walk') return;
    docked = id;
    setMode('dock', 1.0);
    opts.onDock?.(id);
  }
  function undock() {
    if (mode !== 'dock' || !docked) return;
    const id = docked;
    docked = null;
    setMode('walk', 1.0);
    opts.onUndock?.(id);
  }

  /**
   * Camera pose for this frame. `rail` is the rail pose (with the blimp offset and rig feel applied), `follow`
   * the character's follow camera (null before the character exists). Returns true when the caller must apply
   * `outPos`/`outLook` (a blend is running or the mode is not `ride`); false = leave the rail camera untouched.
   */
  function resolveCamera(dt: number, rail: Pose, follow: Pose | null, outPos: THREE.Vector3, outLook: THREE.Vector3): boolean {
    if (mode === 'dock' && docked) {
      if (!opts.dockPoseOf?.(docked, target.pos, target.look)) {
        const d = dockPose(docked);
        target.pos.copy(d.pos); target.look.copy(d.look);
        if (opts.dockOffset) { opts.dockOffset(docked, off); target.pos.add(off); target.look.add(off); }
      }
    } else if (mode === 'walk' && follow) {
      target.pos.copy(follow.pos); target.look.copy(follow.look);
    } else {
      target.pos.copy(rail.pos); target.look.copy(rail.look);
    }
    if (!started) { started = true; last.pos.copy(target.pos); last.look.copy(target.look); from.pos.copy(target.pos); from.look.copy(target.look); blendDur = 0; }
    blendT += dt;
    const blending = blendDur > 0 && blendT < blendDur;
    const k = blending ? smooth(blendT / blendDur) : 1;
    outPos.lerpVectors(from.pos, target.pos, k);
    outLook.lerpVectors(from.look, target.look, k);
    last.pos.copy(outPos); last.look.copy(outLook);
    return blending || mode !== 'ride';
  }

  const nav = {
    get mode() { return mode; },
    get section() { return section; },
    get docked() { return docked; },
    get inFlight() { return inFlight; },
    get blending() { return blendDur > 0 && blendT < blendDur; },
    get flying() { return flight !== null; },
    get flightT() { return flight ? flightState.t : null; },
    panTo, enterWalk, dock, undock, resolveCamera, samplePath,
    /** Initial state from a `?p=` override: ride at that p, no character. */
    start() { section = sectionAt(journey.p); opts.onSection?.(section); (window as any).__mode = mode; opts.onMode?.(mode, mode); },
  };
  (window as any).__nav = nav;
  (window as any).__mode = mode;
  return nav;
}

export type Nav = ReturnType<typeof createNav>;

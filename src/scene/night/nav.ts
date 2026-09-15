/**
 * Navigation state machine. `journey.p` is the camera's position on the rail (journey.ts); it only jumps, it is
 * never scrolled or animated. Modes: `ride` (on the rail: the hero vista), `walk` (the protagonist walks a
 * district, third-person camera), `dock` (camera parked on a terminal, the section is open in the session).
 * Walk ↔ dock blends the camera from where it is to the new target over a short window; `resolveCamera` does the
 * blend each frame from the poses main.ts computes.
 *
 * Every location change is a fade through black (`Beat`, reported through `onBeat` for the HUD overlay):
 * `fade` → the jump (rail, section, character, title toast via `onArrive`) → `reveal`.
 */
import * as THREE from 'three/webgpu';
import { NAV_TARGET, poseAt, sectionAt, rig, type SectionId } from './journey';
import { reducedMotion } from './palette';
import type { CarrierId } from './carriers/index';
import type { WalkSection } from './walkable';

export type Mode = 'ride' | 'walk' | 'dock';
export type DockId = CarrierId;
export interface Pose { pos: THREE.Vector3; look: THREE.Vector3 }

/** Where the protagonist appears on arrival (feet), facing `yaw` (radians, 0 = +z). */
export const SPAWN: Record<WalkSection, { pos: [number, number, number]; yaw: number }> = {
  education: { pos: [-80, 0.22, -90], yaw: Math.PI },              // on the plaza axis, facing the terminal
  work: { pos: [-18, 0.22, -83], yaw: Math.PI },                    // aligned with the kiosk, clear of avenue lamps
  projects: { pos: [25, 0.22, -225], yaw: Math.PI / 2 },           // pedestrian entrance, kiosk on the right
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

// ---------- location-change fade
/** `fade` (to black; the jump happens at its end) → `reveal` (back from black). */
export type Beat = 'fade' | 'reveal';
export interface CutsceneState {
  beat: Beat;
  /** Seconds into the beat. */
  t: number;
  /** The beat's planned length in seconds. */
  duration: number;
  to: SectionId;
}
/** Timings (seconds): each half of the fade; `tickMax` caps a frame's dt so a hitch cannot swallow a beat. */
export const CUT = { fade: 0.3, tickMax: 0.029 };

export interface NavOptions {
  journey: { p: number };
  onMode?(mode: Mode, prev: Mode): void;
  onSection?(id: SectionId): void;
  onEnterWalk?(id: WalkSection): void;
  onLeaveWalk?(): void;
  onDock?(id: DockId): void;
  onUndock?(id: DockId): void;
  /** The jump happened behind the black (the reveal starts): show the title. */
  onArrive?(id: SectionId): void;
  /** Fade beat changes (the black overlay, the dimmed nav); null when the fade ends. */
  onBeat?(state: CutsceneState | null): void;
  /** Per-frame offset added to a dock pose (the blimp's displacement while docked on it). */
  dockOffset?(id: DockId, out: THREE.Vector3): THREE.Vector3;
  /** A carrier's own full dock pose (Carrier.dockPose); return false to fall back to the dwell pose + offset. */
  dockPoseOf?(id: DockId, pos: THREE.Vector3, look: THREE.Vector3): boolean;
}

const smooth = (t: number) => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const dA = new THREE.Vector3(), dB = new THREE.Vector3();

export function createNav(opts: NavOptions) {
  const { journey } = opts;
  let mode: Mode = 'ride';
  let section: SectionId = sectionAt(journey.p);
  let docked: DockId | null = null;
  let inFlight = false;
  let cut: { beat: Beat; t: number; to: SectionId } | null = null;

  // Camera blend: from the pose the camera had at the last mode change toward the current mode's target.
  const from: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const last: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const target: Pose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const off = new THREE.Vector3();
  let blendT = 0, blendDur = 0, started = false;

  /** Glide from wherever the camera is now to the current target over `dur` s (walk ↔ dock). */
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

  // ---- fade bookkeeping
  const state = (): CutsceneState | null => (cut ? { beat: cut.beat, t: cut.t, duration: CUT.fade, to: cut.to } : null);
  const setBeat = (beat: Beat) => { if (!cut) return; cut.beat = beat; cut.t = 0; opts.onBeat?.(state()); };
  const endCut = () => { cut = null; opts.onBeat?.(null); };

  /**
   * Go to a section: fade to black, cut everything at once behind it (leave the carrier / the walk, jump the rail,
   * place the character), fade back. Arrival hands the district to the character (except the hero vista). A second
   * call mid-fade restarts the fade toward the new destination.
   */
  function panTo(id: SectionId) {
    if (mode === 'walk' && id === section && !cut) return; // already there (unless cancelling a pending fade)
    if (cut && id === cut.to) return;                     // already on the way there
    inFlight = true;
    rig.navFlight = true;
    cut = { beat: 'fade', t: 0, to: id };
    opts.onBeat?.(state());
  }

  /** Advance the fade by the frame's dt (main.ts, before the camera is sampled). */
  function tick(dt: number) {
    if (!cut) return;
    dt = Math.min(dt, CUT.tickMax);
    cut.t += dt;
    if (cut.t < CUT.fade) return;
    if (cut.beat === 'reveal') { endCut(); return; }
    // Behind the black: leave the carrier / the walk, jump the rail, place the character, all in one frame.
    const id = cut.to;
    if (mode === 'dock') undock();
    if (mode !== 'ride') { setMode('ride', 0); opts.onLeaveWalk?.(); }
    setSection(id); // switch districts behind black, not at the start of the fade
    journey.p = NAV_TARGET[id];
    rig.reset(); rig.navFlight = false; inFlight = false;
    opts.onArrive?.(id);
    if (id !== 'city') { setMode('walk', 0); opts.onEnterWalk?.(id); }
    setBeat('reveal');
  }

  /** Rail pose for this frame into pos/look; returns the p to feed rig.update. */
  function samplePath(pos: THREE.Vector3, look: THREE.Vector3): number {
    poseAt(journey.p, pos, look);
    return journey.p;
  }

  function dock(id: DockId) {
    if (mode !== 'walk' || cut) return;
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
    // The heading turns through the blend (view direction and aim distance, not the aim point): a camera sliding past
    // a lerped aim point would whip around it.
    dA.subVectors(from.look, from.pos); dB.subVectors(target.look, target.pos);
    const la = dA.length(), lb = dB.length();
    if (blending && la > 1e-4 && lb > 1e-4 && dA.dot(dB) > -0.98 * la * lb) {
      dA.divideScalar(la); dB.divideScalar(lb);
      outLook.copy(dA).lerp(dB, k).normalize().multiplyScalar(la + (lb - la) * k).add(outPos);
    } else outLook.lerpVectors(from.look, target.look, k);
    last.pos.copy(outPos); last.look.copy(outLook);
    return blending || mode !== 'ride';
  }

  const nav = {
    get mode() { return mode; },
    get section() { return section; },
    get docked() { return docked; },
    get inFlight() { return inFlight; },
    get blending() { return blendDur > 0 && blendT < blendDur; },
    get cutscene() { return state(); },
    get p() { return journey.p; },
    panTo, dock, undock, resolveCamera, samplePath, tick,
    exploreSection(id: WalkSection) {
      if (mode !== 'walk' || cut || section === id) return;
      setSection(id); journey.p = NAV_TARGET[id];
    },
    /** Initial state from a `?p=` override: ride at that p, no character. */
    start() { section = sectionAt(journey.p); opts.onSection?.(section); (window as any).__mode = mode; opts.onMode?.(mode, mode); },
  };
  (window as any).__nav = nav;
  (window as any).__mode = mode;
  return nav;
}

export type Nav = ReturnType<typeof createNav>;

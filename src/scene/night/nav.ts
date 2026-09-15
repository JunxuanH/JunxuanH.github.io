/**
 * Navigation state machine. `journey.p` is still the camera's position on the rail (journey.ts), but it is
 * advanced by a paced cutscene (`tick`), never scrolled. Modes: `ride` (on the rail: the hero vista, or a move
 * in flight), `walk` (the protagonist walks a district, third-person camera), `dock` (camera parked on a carrier's
 * dwell pose, the slab is interactive). Every mode change blends the camera from where it is to the new
 * target over a short window; `resolveCamera` does the blend each frame from the poses main.ts computes.
 *
 * Every section transition is a cutscene of beats (`Beat`, reported through `onBeat` for the letterbox bars and
 * the skip hint): `depart` (the move eases in from rest) → `travel` (speed- and turn-capped, journey.ts `pace`)
 * → `hold` (the establishing shot, the title toast via `onArrive`) → `handoff` (blend to the follow camera, the
 * character takes over). Esc / Enter / Space / a tap (`skip`) glides to the hold instead. A video cover
 * (`NavOptions.cover`, cutscene.ts) inserts `establish` (park on the source's wide shot while it loads) and
 * `cover` (the clip plays over a canvas already parked on the destination's wide shot) before the hold; if it
 * fails to load in time the 3D move plays from wherever the camera is. Reduced motion: `fade` → cut → `reveal`.
 */
import * as THREE from 'three/webgpu';
import { NAV_TARGET, ESTABLISH, poseAt, sectionAt, rig, planPan, flyover, still, isAdjacent, PACE, type SectionId, type Move } from './journey';
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

// ---------- cutscene beats
export type Beat = 'establish' | 'cover' | 'depart' | 'travel' | 'glide' | 'hold' | 'handoff' | 'fade' | 'reveal';
export interface CutsceneState {
  beat: Beat;
  /** Seconds into the beat. */
  t: number;
  /** The beat's planned length in seconds (Infinity while a cover plays or a still holds). */
  duration: number;
  to: SectionId;
  /** The move's speed cap (u/s) in force this frame; null off the move. */
  cap: number | null;
  skipped: boolean;
  /** The move kind under the camera, when there is one. */
  move: Move['kind'] | null;
}
/** Beat timings (seconds). `depart` is journey.ts PACE.easeIn; a cover's hold is the shorter `coverHold`. */
export const CUT = { hold: 0.9, coverHold: 0.5, handoff: 1.6, skipGlide: 0.5, fade: 0.3, establishMin: 0.8, establishMax: 1.2, blendMin: 0.8, blendMax: 1.8, blendLead: 0.7, tickMax: 0.029 };

/** How a generated video cutscene ended: played through, cut short by the visitor, or never played. */
export type CoverResult = 'ended' | 'skipped' | 'failed';
/**
 * A video cover for one transition (cutscene.ts). `ready` resolves true once the clip can play (false = give up);
 * `show` fades it over the canvas, `play` resolves when it ends (or `skip` cut it short, or it failed), `hide`
 * crossfades back to the canvas; `dispose` tears it down at once (a redirect, a skip before it showed).
 */
export interface Cover {
  readonly duration: number;
  ready: Promise<boolean>;
  show(): Promise<void>;
  play(): Promise<CoverResult>;
  hide(): Promise<void>;
  skip(): void;
  dispose(): void;
}

export interface NavOptions {
  journey: { p: number };
  /** Location changes fade by default; cinematic paths are retained only for explicit tooling. */
  transition?: 'fade' | 'cinematic';
  onMode?(mode: Mode, prev: Mode): void;
  onSection?(id: SectionId): void;
  onEnterWalk?(id: WalkSection): void;
  onLeaveWalk?(): void;
  onDock?(id: DockId): void;
  onUndock?(id: DockId): void;
  /** The camera has settled on a section's establishing shot (the arrival hold starts): show the title. */
  onArrive?(id: SectionId): void;
  /** Cutscene beat changes (letterbox bars, skip hint, the reduced-motion fade); null when the cutscene ends. */
  onBeat?(state: CutsceneState | null): void;
  /** A video cover for the transition, or null to play the 3D move (consulted only from rest, never under reduced motion). */
  cover?(from: SectionId, to: SectionId): Cover | null;
  /** Per-frame offset added to a dock pose (the blimp's displacement while docked on it). */
  dockOffset?(id: DockId, out: THREE.Vector3): THREE.Vector3;
  /** A carrier's own full dock pose (Carrier.dockPose); return false to fall back to the dwell pose + offset. */
  dockPoseOf?(id: DockId, pos: THREE.Vector3, look: THREE.Vector3): boolean;
}

const smooth = (t: number) => { const x = THREE.MathUtils.clamp(t, 0, 1); return x * x * (3 - 2 * x); };
const tmpPos = new THREE.Vector3(), tmpLook = new THREE.Vector3(), dA = new THREE.Vector3(), dB = new THREE.Vector3();

export function createNav(opts: NavOptions) {
  const { journey } = opts;
  let mode: Mode = 'ride';
  let section: SectionId = sectionAt(journey.p);
  let docked: DockId | null = null;
  let inFlight = false;
  // The move under the camera: a rail pan (journey.p carries it), a fly-over, or a still (parked on a wide shot).
  let move: Move | null = null;
  let moveT = 0;
  interface Cut { beat: Beat; t: number; to: SectionId; from: SectionId; skipped: boolean; cover: Cover | null; coverOk: boolean | null; covered: boolean; moveDelay: number }
  let cut: Cut | null = null;
  /** Probes: `__nav.coverHook = (from, to) => Cover | null` stands in for NavOptions.cover. */
  let coverHook: NavOptions['cover'] | null = null;

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
  /** Blend length for a glide from the camera's current pose to `pos`/`look`: 0.8-1.8 s, sized so neither the travel nor the heading swing outruns the caps. */
  const blendFor = (pos: THREE.Vector3, look: THREE.Vector3) => {
    if (!started) return 0;
    dA.subVectors(last.look, last.pos).normalize(); dB.subVectors(look, pos).normalize();
    const deg = THREE.MathUtils.radToDeg(dA.angleTo(dB));
    return THREE.MathUtils.clamp(Math.max(last.pos.distanceTo(pos) / 30, (1.5 * deg) / PACE.turn), CUT.blendMin, CUT.blendMax);
  };
  /** How long the move waits for a running blend (its ramp starts as the glide's velocity is fading, so the two never add up to a streak). */
  const moveDelayFor = (pos: THREE.Vector3) => (started && blendDur > 0 && last.pos.distanceTo(pos) > 2 ? blendDur * CUT.blendLead : 0);
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

  // ---- cutscene bookkeeping
  const state = (): CutsceneState | null => {
    if (!cut) return null;
    const onMove = move && move.kind !== 'still' && (cut.beat === 'depart' || cut.beat === 'travel');
    const duration = cut.beat === 'depart' ? cut.moveDelay + PACE.easeIn : cut.beat === 'travel' ? (move?.duration ?? 0) : cut.beat === 'glide' ? CUT.skipGlide
      : cut.beat === 'hold' ? (cut.covered ? CUT.coverHold : CUT.hold) : cut.beat === 'handoff' ? CUT.handoff : cut.beat === 'fade' || cut.beat === 'reveal' ? CUT.fade
      : cut.beat === 'establish' ? CUT.establishMax : Infinity;
    return { beat: cut.beat, t: cut.t, duration, to: cut.to, cap: onMove ? move!.capAt(moveT) : null, skipped: cut.skipped, move: move?.kind ?? null };
  };
  const setBeat = (beat: Beat) => { if (!cut) return; cut.beat = beat; cut.t = 0; opts.onBeat?.(state()); };
  const beginCut = (beat: Beat, fromId: SectionId, to: SectionId, cover: Cover | null) => {
    cut = { beat, t: 0, to, from: fromId, skipped: false, cover, coverOk: null, covered: false, moveDelay: 0 };
    opts.onBeat?.(state());
  };
  const endCut = () => { cut = null; opts.onBeat?.(null); };
  const dropCover = () => { if (cut?.cover) { cut.cover.dispose(); cut.cover = null; } };

  function enterWalk(id: WalkSection, blend = CUT.handoff) {
    setMode('walk', blend);
    opts.onEnterWalk?.(id);
  }
  /** The move has ended: park on the destination and start the hold (the title shows). */
  function beginHold(id: SectionId) {
    if (move && move.kind === 'flyover') rig.reset(); // the rig saw a constant p during the flight: forget that history before p lands on the target
    if (!move || move.kind !== 'still') move = null;   // a cover's parked wide shot stays under the hold and the hand-over
    journey.p = NAV_TARGET[id];
    setBeat('hold');
    opts.onArrive?.(id);
  }
  /** The hold is over: hand the district to the character (the hero vista just comes back). */
  function land(id: SectionId) {
    rig.navFlight = false;   // after any reset, so the parallax springs back in instead of snapping
    inFlight = false;
    move = null;             // the walk camera (or the rail at NAV_TARGET) takes over; a cover's still is only ever a wide shot of the same section
    if (id === 'city') { endCut(); return; }
    enterWalk(id);
    setBeat('handoff');
  }
  /** Start the paced 3D move toward `to` from the current camera, and the depart beat. */
  function startMove(fromId: SectionId, id: SectionId, to: number, wasFlying: boolean) {
    const fromP = journey.p;
    let m: Move | null = null;
    if (isAdjacent(fromId, id) && !wasFlying) {
      m = planPan(fromP, to);
      if (m.duration > PACE.maxRail) m = null; // a redirect across several dwells: fly instead of retracing the rail
    }
    if (!m) m = flyover(fromP, to, wasFlying || move?.kind === 'still' ? { pos: last.pos, look: last.look } : undefined);
    move = m; moveT = 0;
  }

  /**
   * Cinematic move to a section's dwell; arrival hands over to the character (except the hero). Neighbouring sections
   * pan along the rail, farther jumps (and redirects mid-air) fly over the skyline; both are paced by journey.ts.
   * Redirecting mid-cutscene glides onto the new move. Reduced motion fades through black instead.
   */
  function panTo(id: SectionId) {
    const fadeOnly = opts.transition !== 'cinematic' || reducedMotion;
    if (mode === 'dock' && !fadeOnly) undock();
    if (mode === 'walk' && id === section && !cut) return;       // already there (unless cancelling a pending fade)
    if (cut && id === cut.to) return;                             // already on the way there
    const fromId = section, to = NAV_TARGET[id];
    const wasFlying = move?.kind === 'flyover';
    const redirect = cut !== null;
    dropCover();
    inFlight = true;
    rig.navFlight = true;
    if (fadeOnly) {
      // No camera motion at all: fade to black, cut everything at once behind it, fade back (tick).
      move = null;
      beginCut('fade', fromId, id, null);
      return;
    }
    setSection(id);
    const cover = !redirect && fromId !== id ? ((coverHook ?? opts.cover)?.(fromId, id) ?? null) : null;
    // Where the new move starts: the source's wide shot (cover), the camera itself (a redirect mid-air or off a parked
    // shot: the fly-over departs from `last`), or the rail at the current p.
    const fromCamera = !cover && (wasFlying || move?.kind === 'still');
    if (cover) { move = still(journey.p, ESTABLISH[fromId]); moveT = 0; poseAt(ESTABLISH[fromId], tmpPos, tmpLook); }
    else if (fromCamera) { tmpPos.copy(last.pos); tmpLook.copy(last.look); }
    else poseAt(journey.p, tmpPos, tmpLook);
    if (mode !== 'ride') { setMode('ride', blendFor(tmpPos, tmpLook)); opts.onLeaveWalk?.(); rig.reset(); }
    else if (started) {
      // Redirected mid-move (or from rest): glide onto the new move only when the camera is off its start; a move that
      // starts where the camera is just eases in from there (a glide toward a moving target would add a catch-up streak).
      if (last.pos.distanceTo(tmpPos) > 2) blendFromCurrent(blendFor(tmpPos, tmpLook)); else blendDur = 0;
    }
    if (cover) {
      beginCut('establish', fromId, id, cover);
      const me = cut;
      cover.ready.then((ok) => { if (cut === me) me!.coverOk = ok; }, () => { if (cut === me) me!.coverOk = false; });
      return;
    }
    if (Math.abs(to - journey.p) < 1e-4 && !wasFlying) { move = null; beginCut('hold', fromId, id, null); journey.p = to; opts.onArrive?.(id); return; }
    startMove(fromId, id, to, wasFlying);
    beginCut('depart', fromId, id, null);
    if (move!.kind === 'rail') cut!.moveDelay = moveDelayFor(tmpPos); // a fly-over from the camera's own pose needs no glide first
  }

  /** The cover is ready: fade it in, park the canvas on the destination's wide shot behind it, play, fade back. */
  function runCover(me: Cut) {
    const c = me.cover!;
    const id = me.to;
    me.covered = true;
    setBeat('cover');
    c.show().then(() => {
      if (cut !== me) return;
      journey.p = NAV_TARGET[id];
      move = still(journey.p, ESTABLISH[id]); moveT = 0;
      rig.reset();
      blendDur = 0; // the canvas is covered: no glide from the source shot to the destination shot
      return c.play();
    }).then((r) => {
      if (cut !== me || r === undefined) return;
      return c.hide().then(() => { if (cut === me) { me.cover = null; c.dispose(); beginHold(id); } });
    }).catch(() => { if (cut === me) { me.cover = null; c.dispose(); beginHold(id); } });
  }
  /** The cover never became ready: play the 3D move from where the camera is (the canvas was never covered). */
  function coverFallback(me: Cut) {
    dropCover();
    poseAt(journey.p, tmpPos, tmpLook);
    startMove(me.from, me.to, NAV_TARGET[me.to], false);
    // Re-base the running blend on the camera's current pose: a fly-over starts right there, a rail pan at the dwell (a short glide onto it).
    blendFromCurrent(move!.kind === 'rail' ? THREE.MathUtils.clamp(last.pos.distanceTo(tmpPos) / 30, CUT.skipGlide, CUT.blendMax) : CUT.blendMin);
    setBeat('depart');
    me.moveDelay = move!.kind === 'rail' ? moveDelayFor(tmpPos) : 0;
  }

  /** Advance the cutscene by the frame's dt (main.ts, before the camera is sampled): journey.p, beats, the hand-over. */
  function tick(dt: number) {
    if (!cut) return;
    dt = Math.min(dt, CUT.tickMax); // a hitch frame dilates time instead of jumping the camera (≤ cap × tickMax per frame)
    cut.t += dt;
    const id = cut.to;
    switch (cut.beat) {
      case 'establish':
        if (cut.t >= CUT.establishMin && cut.coverOk === true) runCover(cut);
        else if (cut.coverOk === false || cut.t >= CUT.establishMax) coverFallback(cut);
        break;
      case 'cover':
        break; // runCover's promise chain moves on
      case 'depart':
      case 'travel': {
        if (!move) { beginHold(id); break; }
        if (cut.t < cut.moveDelay) break; // the glide from the walk camera onto the rail is still at speed: the rail waits
        moveT += dt;
        journey.p = move.pAt(moveT);
        if (moveT >= move.duration) beginHold(id);
        else if (cut.beat === 'depart' && moveT >= PACE.easeIn) setBeat('travel');
        break;
      }
      case 'glide':
        if (cut.t >= CUT.skipGlide) beginHold(id);
        break;
      case 'hold':
        if (cut.t >= (cut.covered ? CUT.coverHold : CUT.hold)) land(id);
        break;
      case 'handoff':
        if (cut.t >= CUT.handoff) endCut();
        break;
      case 'fade':
        if (cut.t >= CUT.fade) {
          // Behind the black: leave the carrier / the walk, jump the rail, place the character, all in one frame.
          if (mode === 'dock') undock();
          if (mode !== 'ride') { setMode('ride', 0); opts.onLeaveWalk?.(); }
          setSection(id); // switch districts behind black, not at the start of the fade
          journey.p = NAV_TARGET[id]; move = null;
          rig.reset(); rig.navFlight = false; inFlight = false;
          opts.onArrive?.(id);
          if (id !== 'city') enterWalk(id, 0);
          setBeat('reveal');
        }
        break;
      case 'reveal':
        if (cut.t >= CUT.fade) endCut();
        break;
    }
  }

  /** Esc / Enter / Space / a tap on the stage: glide to the arrival shot instead of finishing the move. */
  function skip() {
    if (!cut) return;
    const id = cut.to;
    if (cut.beat === 'cover') { cut.cover?.skip(); return; }
    if (cut.beat === 'establish') { dropCover(); /* fall through to the glide */ }
    else if (cut.beat !== 'depart' && cut.beat !== 'travel') return;
    else if (move && move.duration - moveT <= CUT.skipGlide) return; // arriving anyway
    rig.reset(); // p jumps to the target: forget the move's dp/dt history (navFlight is still on, so the parallax stays out until the hand-over)
    journey.p = NAV_TARGET[id]; move = null;
    blendFromCurrent(CUT.skipGlide);
    cut.skipped = true;
    setBeat('glide');
  }

  /**
   * Rail pose for this frame (or the move's) into pos/look. Returns the p to feed rig.update: the real p on the
   * rail, a constant during a fly-over or a parked shot so no rail-derived look-ahead or banking leaks in.
   */
  function samplePath(pos: THREE.Vector3, look: THREE.Vector3): number {
    if (move && !move.rail) { move.pose(moveT, pos, look); return move.from; }
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
    get flying() { return move?.kind === 'flyover'; },
    /** 0..1 through a fly-over, else null. */
    get flightT() { return move?.kind === 'flyover' ? THREE.MathUtils.clamp(moveT / move.duration, 0, 1) : null; },
    get cutscene() { return state(); },
    get p() { return journey.p; },
    get establish() { return ESTABLISH; },
    get coverHook() { return coverHook; },
    set coverHook(fn: NavOptions['cover'] | null) { coverHook = fn; },
    panTo, enterWalk, dock, undock, resolveCamera, samplePath, tick, skip,
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

import * as THREE from 'three/webgpu';

/**
 * Scroll → camera. One `.journey` element drives progress p ∈ [0,1]; sections map p to districts,
 * and `KEYS` are camera poses interpolated with dwell (a key repeated = the camera holds).
 * The hero is the bay vista; the flight lands on the avenue and stays at street level.
 */
export interface Key { p: number; pos: [number, number, number]; look: [number, number, number] }

export const SECTIONS = [
  { id: 'city', start: 0, end: 0.10 },
  { id: 'education', start: 0.10, end: 0.22 },
  { id: 'work', start: 0.22, end: 0.68 },
  { id: 'projects', start: 0.68, end: 0.92 },
  { id: 'contact', start: 0.92, end: 1.0 },
] as const;

export type SectionId = (typeof SECTIONS)[number]['id'];

/** World anchors shared by districts / towers / people so the keyframes and props agree. */
export const ANCHORS = {
  towerA: new THREE.Vector3(0, 0, -40),
  campus: new THREE.Vector3(-80, 0, -102), // south of the z −60 cross street, which leads to its gate
  /** Employer signs: brackets on the buildings flanking the avenue, facing the road. */
  workSigns: [
    new THREE.Vector3(-17.5, 12, -95), new THREE.Vector3(17.5, 11.5, -125),
    new THREE.Vector3(-17.5, 12, -158), new THREE.Vector3(17.5, 11.5, -190),
  ],
  /** Night market along the east branch of the z = −228 cross street. */
  market: new THREE.Vector3(50, 0, -228),
  /** Landing pad at the end of the waterfront pier (deck at y ≈ 2.9). */
  pad: new THREE.Vector3(140, 0, 20),
};

const S = ANCHORS.workSigns;
/** The pose the original piecewise-smoothstep interpolation framed at p between two keys (kept bit-exact as a key). */
function pinned(p: number, pos0: number[], look0: number[], pos1: number[], look1: number[], p0: number, p1: number) {
  const t = (p - p0) / (p1 - p0), s = t * t * (3 - 2 * t);
  const mix = (a: number[], b: number[]) => a.map((v, i) => v + (b[i] - v) * s) as [number, number, number];
  return { pos: mix(pos0, pos1), look: mix(look0, look1) };
}
/**
 * Exit key for a close-up dwell: dolly straight back along the dwell's heading with the aim pushed out to `aim` units,
 * so the turn that follows happens at distance (an aim 3.5 u from the camera made leaving the kiosk a 11°-per-step whip).
 */
function backOut(pos: [number, number, number], look: [number, number, number], back: number, aim: number) {
  const d = new THREE.Vector3().fromArray(look).sub(new THREE.Vector3().fromArray(pos)).normalize();
  const q = new THREE.Vector3().fromArray(pos).addScaledVector(d, -back);
  return { pos: q.toArray() as [number, number, number], look: q.clone().addScaledVector(d, aim).toArray() as [number, number, number] };
}
const signCam = (s: THREE.Vector3): [number, number, number] => [-Math.sign(s.x) * 2, 7, s.z + 10];
const v = (a: THREE.Vector3, dy = 0): [number, number, number] => [a.x, a.y + dy, a.z];

export const KEYS: Key[] = [
  { p: 0.00, pos: [0, 22, 250], look: [0, 45, -40] },
  { p: 0.06, pos: [0, 26, 190], look: [0, 44, -40] },
  { p: 0.10, pos: [0, 20, 100], look: [0, 22, -20] },
  { p: 0.13, pos: [-10, 7, 4], look: [-40, 8, -60] },
  { p: 0.16, pos: [-38, 6, -60], look: [-80, 8, -84] },            // west along the cross street, torii ahead
  // Campus: wide on the plaza, then close on the terminal screen (typing dwell).
  { p: 0.19, pos: [-66, 4.2, -82], look: [-80, 2.4, -100] },
  { p: 0.22, pos: [-80, 2.25, -96.6], look: [-80, 2.05, -100.1] },
  { p: 0.235, pos: [-80, 2.25, -96.6], look: [-80, 2.05, -100.1] },
  // Exit arc: dolly back with the aim pushed out, then swing the aim through SE at 12–20 u so the 100° turn to the street is
  // uniform instead of a whip around a subject 3.5 u away.
  { p: 0.238, ...backOut([-80, 2.25, -96.6], [-80, 2.05, -100.1], 1.5, 10) },
  { p: 0.245, pos: [-79, 2.7, -88], look: [-68.3, 2.5, -97] },   // yaw 50°, 14 u
  { p: 0.25, pos: [-77, 3.0, -80], look: [-57.2, 3.2, -82.8] },  // yaw 82°, 20 u (0.255 is 100°)
  { p: 0.255, pos: [-74, 3.4, -70], look: [-30, 4, -62] },          // back out under the torii
  // Downtown: bus shelter (eye level), LED wall (crane up), blimp (formation), hologram (forecourt).
  { p: 0.275, pos: [-20, 2.2, -66], look: [-17.6, 2.0, -94.6] },
  { p: 0.31, pos: [-12.2, 1.9, -92.6], look: [-17.6, 2.0, -94.6] },
  { p: 0.345, pos: [-12.2, 1.9, -92.6], look: [-17.6, 2.0, -94.6] },
  // Exit arc: back into the avenue, then swing the aim through S at 14–18 u (the straight aim path to the LED wall would
  // pass through the camera itself: a 180° flip).
  { p: 0.348, ...backOut([-12.2, 1.9, -92.6], [-17.6, 2.0, -94.6], 1.2, 10) },
  { p: 0.356, pos: [-9.2, 2.1, -96.8], look: [-14, 1.8, -110] },  // yaw −20°, 14 u
  { p: 0.364, pos: [-7, 2.3, -99.8], look: [2, 3, -115.4] },      // yaw 30°, 18 u (0.375 is 66°)
  { p: 0.375, pos: [-4, 2.5, -104], look: [27, 12, -118] },
  { p: 0.42, pos: [-10, 12, -108], look: [27, 22, -118] },
  { p: 0.465, pos: [-10, 12, -108], look: [27, 22, -118] },
  { p: 0.50, pos: [-18, 40.3, -156], look: [-2.5, 40, -158] },      // square on the banner; FOLLOW adds the blimp's displacement
  { p: 0.57, pos: [-18, 40.3, -156], look: [-2.5, 40, -158] },
  { p: 0.61, pos: [6, 5, -168], look: [18.6, 5, -196] },          // east of tower-d's footprint
  { p: 0.64, pos: [9, 3.2, -186], look: [18.6, 5.15, -196] },
  { p: 0.68, pos: [9, 3.2, -186], look: [18.6, 5.15, -196] },
  // Market: turn east into the street, dwell at the holo stall.
  { p: 0.74, pos: [22, 5, -224], look: [52, 4, -228] },
  { p: 0.79, pos: [58, 5.4, -224], look: [72, 6.4, -227.5] },
  { p: 0.86, pos: [58, 5.4, -224], look: [72, 6.4, -227.5] },
  // Harbor: climb out of the market, cruise high over the rooftops, drop onto the pier from the quay side.
  { p: 0.88, pos: [56, 38, -226], look: [90, 30, -160] },
  { p: 0.90, pos: [96, 78, -150], look: [136, 20, -10] },
  { p: 0.94, pos: [128, 16, -48], look: [140, 6, 16] },
  { p: 0.99, ...pinned(0.99, [128, 16, -48], [140, 6, 16], [134.6, 5.0, 14.5], [140, 8.2, 32.1], 0.94, 1.0) }, // the board shot (NAV_TARGET.contact)
  { p: 1.00, pos: [134.6, 5.0, 14.5], look: [140, 8.2, 32.1] },
];

/** Blimp formation window: the camera pose is offset by the blimp's displacement from its home pose. */
export const FOLLOW = { from: 0.50, to: 0.57, feather: 0.025 };
export function followWeight(p: number) {
  const sm = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
  return sm((p - (FOLLOW.from - FOLLOW.feather)) / FOLLOW.feather) * (1 - sm((p - FOLLOW.to) / FOLLOW.feather));
}

// ---------- camera path
// Each coordinate stream of KEYS (positions, look targets) is a centripetal Catmull-Rom spline through its *distinct*
// points, so direction is continuous through every pass-through key instead of kinking at chord boundaries. A key
// repeated in a stream is a hold: that stream sits perfectly still on the point for the whole window (the résumé
// carriers are placed for those poses). Progress along each spline is a monotone cubic in p (Fritsch–Butland slopes)
// whose rate is continuous through pass-through keys and zero at every hold edge and at both ends of the journey, so
// speed never jumps and arrivals settle instead of stopping dead. Every key is still hit exactly at its p.
const hermite01 = (t: number, a: number, b: number) => a * (t * t * t - 2 * t * t + t) + (3 * t * t - 2 * t * t * t) + b * (t * t * t - t * t);

class Track {
  private readonly curve: THREE.CatmullRomCurve3;
  private readonly pts: THREE.Vector3[] = [];
  private readonly from: number[] = []; // p at which point j is reached
  private readonly to: number[] = [];   // p at which the stream leaves point j (== from[j] for a pass-through key)
  private readonly a: number[] = [];    // Hermite slopes of the local weight over segment j (start / end)
  private readonly b: number[] = [];

  constructor(keys: Key[], pick: (k: Key) => [number, number, number]) {
    for (const k of keys) {
      const v = new THREE.Vector3().fromArray(pick(k));
      const last = this.pts[this.pts.length - 1];
      if (last && last.distanceToSquared(v) < 1e-8) { this.to[this.to.length - 1] = k.p; continue; }
      this.pts.push(v); this.from.push(k.p); this.to.push(k.p);
    }
    this.curve = new THREE.CatmullRomCurve3(this.pts, false, 'centripetal');
    const n = this.pts.length;
    // Segment j runs from to[j] to from[j+1]. Its length in the spline's own (centripetal) parameter is √chord, the
    // same dt the curve uses internally, so matching ds/dp across a knot makes the world-space speed continuous.
    const h: number[] = [], sig: number[] = [];
    for (let j = 0; j < n - 1; j++) {
      h[j] = this.from[j + 1] - this.to[j];
      sig[j] = Math.sqrt(this.pts[j].distanceTo(this.pts[j + 1])) / h[j];
    }
    const m: number[] = []; // ds/dp at each knot
    for (let j = 0; j < n; j++) {
      if (j === 0 || j === n - 1 || this.to[j] > this.from[j]) m[j] = 0; // journey ends and holds: ease to rest
      else m[j] = (3 * (h[j - 1] + h[j])) / ((2 * h[j] + h[j - 1]) / sig[j - 1] + (h[j] + 2 * h[j - 1]) / sig[j]); // ≤ 3·min(σ): monotone
    }
    for (let j = 0; j < n - 1; j++) { this.a[j] = m[j] / sig[j]; this.b[j] = m[j + 1] / sig[j]; }
  }

  at(p: number, out: THREE.Vector3) {
    const n = this.pts.length;
    let j = 0;
    while (j < n - 1 && this.from[j + 1] <= p) j++;
    if (j === n - 1 || p <= this.to[j]) return out.copy(this.pts[j]); // on a knot or inside a hold: exact
    const w = hermite01((p - this.to[j]) / (this.from[j + 1] - this.to[j]), this.a[j], this.b[j]);
    return this.curve.getPoint((j + w) / (n - 1), out);
  }
}

const POS = new Track(KEYS, (k) => k.pos);
const LOOK = new Track(KEYS, (k) => k.look);

/** Camera pose at progress p (see Track). Exact at every key; still inside dwell windows. */
export function poseAt(p: number, pos: THREE.Vector3, look: THREE.Vector3) {
  const q = THREE.MathUtils.clamp(p, 0, 1);
  POS.at(q, pos);
  LOOK.at(q, look);
}

const va = new THREE.Vector3(), vb = new THREE.Vector3(), vl = new THREE.Vector3();
/** dPos/dp of the path (world units per unit progress); zero inside dwells. Central difference, one-sided at the ends. */
export function pathVelocity(p: number, out: THREE.Vector3) {
  const h = 5e-4;
  const p0 = Math.max(0, p - h), p1 = Math.min(1, p + h);
  if (p1 <= p0) return out.set(0, 0, 0);
  POS.at(p0, va); POS.at(p1, vb);
  return out.subVectors(vb, va).divideScalar(p1 - p0);
}

// ---------- camera feel (main.ts's animation loop calls rig.update after the path pose and the blimp offset)
/** One critically damped spring step (settles without overshoot). `s` holds [x, v]. */
function spring(s: [number, number], target: number, omega: number, dt: number) {
  const e = Math.exp(-omega * dt), dx = s[0] - target, k = (s[1] + omega * dx) * dt;
  s[0] = target + (dx + k) * e;
  s[1] = (s[1] - k * omega) * e;
  return s[0];
}

const LEAD = { max: 2.6, frac: 0.06, v0: 60 };    // look-ahead: ≤ 2.6 u or ≤ ~3.4° of heading, saturating with world speed (u/s)
const BANK = { max: THREE.MathUtils.degToRad(1.5), v0: 150 }; // banking roll vs lateral world speed (u/s)
const PARALLAX = { x: 1.2, y: 0.5 };                // pointer parallax amplitude (world units), as before
const dir = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
const par = { x: [0, 0] as [number, number], y: [0, 0] as [number, number], gain: [1, 0] as [number, number] };
const bank: [number, number] = [0, 0];
let prevP: number | null = null, pRate = 0;

export const rig = {
  /** Parallax amplitude multiplier (phones driving it by device tilt use more). */
  parallaxScale: 1,
  /** True while a nav pan is in flight: the pointer parallax fades out so the shot reads as one camera move. */
  navFlight: false,
  /** Forget motion history (call when entering ride mode after a walk or a teleport, so no stale dp/dt leaks into the bank/lead). */
  reset() {
    prevP = null; pRate = 0;
    bank[0] = bank[1] = 0;
    par.x[1] = par.y[1] = 0;
    par.gain[0] = this.navFlight ? 0 : 1; par.gain[1] = 0;
  },
  /**
   * Finish the camera from the path pose: look slightly ahead along travel during transits, critically damped pointer
   * parallax (suppressed during nav pans), the subtle bob, and a tiny banking roll from lateral velocity.
   * `pos`/`look` already include the blimp's follow offset; the bob keeps the CSS3D slabs' scale steady.
   */
  update(camera: THREE.Camera, p: number, pos: THREE.Vector3, look: THREE.Vector3, pointer: THREE.Vector2, t: number, dt: number, reduced = false) {
    dt = Math.max(dt, 1e-4);
    // Path direction and world speed (path velocity × dp/dt): the look-ahead and the bank only exist while the camera
    // is actually moving, so a camera at rest on a pass-through key (0.99, the board) frames exactly what the key says.
    const dp = prevP === null ? 0 : p - prevP;
    prevP = p;
    const rate = Math.abs(dp) > 0.05 ? 0 : dp / dt; // a jump (refresh, ?p=) is not a scroll or a pan
    pRate += (rate - pRate) * (1 - Math.exp(-dt / 0.12));
    pathVelocity(p, dir);
    const vp = dir.length(), speed = vp * Math.abs(pRate);
    if (vp > 1e-6) {
      dir.divideScalar(vp);
      if (pRate < 0) dir.negate(); // travelling backwards along the path: look ahead that way
      const x = speed / LEAD.v0, sat = x / Math.sqrt(1 + x * x);
      look.addScaledVector(dir, Math.min(LEAD.max, LEAD.frac * vl.subVectors(look, pos).length()) * sat);
    }

    // Pointer parallax with a critically damped feel; gain → 0 while a nav pan flies, back to 1 afterwards.
    spring(par.gain, this.navFlight ? 0 : 1, 5, dt);
    spring(par.x, pointer.x, 7, dt);
    spring(par.y, pointer.y, 7, dt);
    const g = par.gain[0] * this.parallaxScale;
    camera.position.set(pos.x + par.x[0] * PARALLAX.x * g, pos.y + Math.sin(t * 0.6) * 0.1 - par.y[0] * PARALLAX.y * g, pos.z);
    camera.lookAt(look);
    // Phones (parallaxScale > 1): the view also turns with the tilt, so the whole vista moves, not only its depth layers.
    if (this.parallaxScale > 1) { camera.rotateY(-par.x[0] * 0.035 * par.gain[0]); camera.rotateX(-par.y[0] * 0.025 * par.gain[0]); }

    // Banking: lateral world velocity (along camera right) → roll, soft-clamped to ±1.5°, smoothed.
    let target = 0;
    if (!reduced && vp > 1e-6) {
      right.crossVectors(vl.subVectors(look, pos).normalize(), up).normalize();
      const lateral = dir.dot(right) * speed;
      target = BANK.max * Math.tanh(lateral / BANK.v0);
    }
    camera.rotation.z += spring(bank, target, 6, dt);
  },
};

export function sectionAt(p: number): SectionId {
  return (SECTIONS.find((s) => p < s.end) ?? SECTIONS[SECTIONS.length - 1]).id;
}

export const sectionStart = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.start;
/** Where the nav (and the hero button) lands: the dwell of each section, not its boundary. */
export const NAV_TARGET: Record<SectionId, number> = { city: 0, education: 0.228, work: 0.31, projects: 0.82, contact: 0.99 };

/** Legacy GSAP pan timing (kept for reference; nav.ts paces every move with `planPan` / `flyover` below). */
export const easeName = 'power3.inOut';
/** 0.9 s next door, up to 2.6 s across the whole city (proportional to the distance in p). */
export const panDuration = (fromP: number, toP: number) => THREE.MathUtils.clamp(0.9 + Math.abs(toP - fromP) * 2.2, 0.9, 2.6);
export const isAdjacent = (a: SectionId, b: SectionId) => Math.abs(SECTIONS.findIndex((s) => s.id === a) - SECTIONS.findIndex((s) => s.id === b)) === 1;

/**
 * Establishing shots: a wide rail pose per section where the district reads at a glance (the plaza with the kiosk,
 * the avenue with the bus shelter, the market street, the pier from the quay side). The video cutscenes (cutscene.ts)
 * park the camera here on either side of a clip, and the clips' first/last frames were generated from these exact
 * poses (scripts/cutscene-frames.mjs): changing a value means re-capturing and re-generating that section's clips.
 * (0.265 for work and 0.95 for contact frame the district a little wider, if the clips are ever redone.)
 */
export const ESTABLISH: Record<SectionId, number> = { city: 0, education: 0.19, work: 0.275, projects: 0.74, contact: 0.96 };

// ---------- cutscene pacing: every nav move is walked at a capped, even speed (nav.ts drives it with the frame's dt)
/**
 * Speed caps for the transition cutscenes. A move is re-timed by arc length so the world never streaks: `street` u/s
 * at street level rising to `aloft` u/s once the camera is well above the roofs (over the `aloftY` height band), with
 * up to +`forward` when it moves along its own view direction (little optical flow) but never over `aloft`; heading
 * changes are held to `turn` °/s. Velocity ramps from rest over `easeIn` s, settles over `easeOut` s and is constant
 * in between; a move never takes less than `min` s. A rail pan that would take longer than `maxRail` s (a redirect
 * across several dwells) flies over the skyline instead.
 */
export const PACE = { street: 55, aloft: 100, aloftY: [8, 40] as [number, number], forward: 0.5, turn: 100, min: 2.6, easeIn: 0.6, easeOut: 1.0, maxRail: 7 };

/** A paced camera move (nav.ts advances `t` in seconds with the frame's dt). */
export interface Move {
  kind: 'rail' | 'flyover' | 'still';
  /** True for a pan along the rail (journey.p carries the camera through `poseAt`); false when `pose` does. */
  rail: boolean;
  from: number;
  to: number;
  /** Seconds (Infinity for a `still`). */
  duration: number;
  /** Rail progress at time t (a fly-over switches from `from` to `to` at the apex, for the p-gated systems). */
  pAt(t: number): number;
  /** Camera pose at time t. */
  pose(t: number, pos: THREE.Vector3, look: THREE.Vector3): void;
  /** The speed cap (u/s) in force at time t (probes). */
  capAt(t: number): number;
  /** Metric length (u-equivalent, see `pace`) and the cruise speed the plan settled on. */
  length: number;
  speed: number;
}

const sm01 = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
/** Speed cap (u/s) for a camera at height y whose velocity makes |cos| = `along` with its view direction. */
export function speedCap(y: number, along: number) {
  const base = PACE.street + (PACE.aloft - PACE.street) * sm01((y - PACE.aloftY[0]) / (PACE.aloftY[1] - PACE.aloftY[0]));
  return Math.min(PACE.aloft, base * (1 + PACE.forward * along * along));
}

/**
 * Re-time a camera path. `sample(u)` gives the pose at u ∈ [0,1] in any parameterisation; the path is measured in a
 * metric that charges distance against the local speed cap and heading change against the turn cap (Euclidean sum,
 * so each cap holds on its own), then walked at constant metric speed with smoothstep velocity ramps at both ends
 * (speed and its derivative continuous, zero at rest). Returns the timing and the inverse map t → u.
 */
function pace(sample: (u: number, pos: THREE.Vector3, look: THREE.Vector3) => void, n = 400) {
  const P = new THREE.Vector3(), L = new THREE.Vector3(), P0 = new THREE.Vector3(), L0 = new THREE.Vector3();
  const d0 = new THREE.Vector3(), d1 = new THREE.Vector3(), v = new THREE.Vector3();
  const M = new Float64Array(n + 1), cap = new Float64Array(n + 1);
  sample(0, P0, L0); d0.subVectors(L0, P0).normalize();
  cap[0] = speedCap(P0.y, 1);
  for (let i = 1; i <= n; i++) {
    sample(i / n, P, L); d1.subVectors(L, P).normalize();
    v.subVectors(P, P0);
    const d = v.length();
    const along = d > 1e-6 ? Math.abs(v.divideScalar(d).dot(d1)) : 1;
    const c = speedCap((P.y + P0.y) / 2, along);
    const ang = THREE.MathUtils.radToDeg(d0.angleTo(d1));
    cap[i] = c;
    M[i] = M[i - 1] + Math.hypot((d * PACE.street) / c, (ang * PACE.street) / PACE.turn);
    P0.copy(P); L0.copy(L); d0.copy(d1);
  }
  const total = M[n], a = PACE.easeIn, b = PACE.easeOut, ramps = (a + b) / 2;
  const duration = Math.max(PACE.min, total / PACE.street + ramps);
  const speed = total / (duration - ramps); // metric speed on the even middle (≤ PACE.street)
  /** Metric distance covered by time t: the integral of the trapezoid profile (∫ smoothstep = x³ − x⁴/2). */
  const sAt = (t: number) => {
    if (t <= 0) return 0;
    if (t >= duration) return total;
    if (t < a) { const x = t / a; return speed * a * (x * x * x - (x * x * x * x) / 2); }
    if (t <= duration - b) return speed * (a / 2 + t - a);
    const y = (t - (duration - b)) / b;
    return speed * (a / 2 + (duration - b - a) + b * (y - (y * y * y - (y * y * y * y) / 2)));
  };
  /** Fractional sample index at metric distance s (binary search on the cumulative metric). */
  const iAt = (s: number) => {
    if (s <= 0) return 0;
    if (s >= total) return n;
    let lo = 0, hi = n;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (M[mid] <= s) lo = mid; else hi = mid; }
    const seg = M[hi] - M[lo];
    return lo + (seg > 0 ? (s - M[lo]) / seg : 0);
  };
  return {
    duration, length: total, speed,
    uAt: (t: number) => iAt(sAt(t)) / n,
    capAt: (t: number) => cap[Math.min(n, Math.round(iAt(sAt(t))))],
  };
}

/** A paced pan along the rail from `fromP` to `toP` (neighbouring sections): journey.p ← pAt(t) each frame. */
export function planPan(fromP: number, toP: number): Move {
  const pl = pace((u, pos, look) => poseAt(fromP + (toP - fromP) * u, pos, look));
  const pAt = (t: number) => fromP + (toP - fromP) * pl.uAt(t);
  return { kind: 'rail', rail: true, from: fromP, to: toP, duration: pl.duration, length: pl.length, speed: pl.speed, pAt, pose: (t, pos, look) => poseAt(pAt(t), pos, look), capAt: pl.capAt };
}

/** A parked camera: journey.p stays at `p` (for the gating) while the camera holds the rail pose at `at`. */
export function still(p: number, at: number): Move {
  return { kind: 'still', rail: false, from: p, to: p, duration: Infinity, length: 0, speed: 0, pAt: () => p, pose: (_t, pos, look) => poseAt(at, pos, look), capAt: () => 0 };
}

// ---------- fly-overs (non-adjacent nav jumps): climb, cruise above the skyline, settle exactly on the target pose
/** floor: above tower-a (84) and the tallest kitbash variant (82). climb: cruise height over the higher end pose. far: aim rays. */
const FLYOVER = { floor: 95, climb: 40, far: 30, sweepY: 14 };
/**
 * Paced camera flight from poseAt(fromP) — or from an explicit `start` pose, for a redirect mid-air — to poseAt(toP)
 * over the city, ending bit-exact on the target pose. Position: centripetal Catmull-Rom through the departure pose,
 * two cruise points at height H (20 % / 80 % of the way), and the arrival pose. Aim: the departure ray pushed far, a
 * sweep point low over the city mid-way, the arrival ray pushed far, then the arrival look — so the heading never
 * whips near a close-up subject. Both curves are walked by `pace` (speed and turn caps, ramps at both ends).
 */
export function flyover(fromP: number, toP: number, start?: { pos: THREE.Vector3; look: THREE.Vector3 }): Move {
  const P0 = new THREE.Vector3(), L0 = new THREE.Vector3(), P1 = new THREE.Vector3(), L1 = new THREE.Vector3();
  poseAt(fromP, P0, L0); poseAt(toP, P1, L1);
  if (start) { P0.copy(start.pos); L0.copy(start.look); }
  const stillPose = P0.distanceTo(P1) < 1e-3;
  // Cruise height: over the roofs and above the higher end pose; a start already aloft (redirect) does not climb again.
  const H = Math.max(FLYOVER.floor, P1.y + FLYOVER.climb, Math.min(P0.y + FLYOVER.climb, Math.max(P0.y, FLYOVER.floor)));
  const lift = (k: number) => new THREE.Vector3().lerpVectors(P0, P1, k).setY(H);
  const ray = (p: THREE.Vector3, l: THREE.Vector3) => { const d = new THREE.Vector3().subVectors(l, p); const n = d.length(); return n < 1e-6 ? p.clone().add(new THREE.Vector3(0, 0, -FLYOVER.far)) : p.clone().addScaledVector(d, Math.max(FLYOVER.far, n) / n); };
  const F0 = ray(P0, L0), F1 = ray(P1, L1);
  const posCurve = new THREE.CatmullRomCurve3([P0.clone(), lift(0.2), lift(0.8), P1.clone()], false, 'centripetal');
  const lookCurve = new THREE.CatmullRomCurve3([L0.clone(), F0, new THREE.Vector3().lerpVectors(F0, F1, 0.5).setY(FLYOVER.sweepY), F1, L1.clone()], false, 'centripetal');
  posCurve.arcLengthDivisions = lookCurve.arcLengthDivisions = 600;
  const raw = (u: number, pos: THREE.Vector3, look: THREE.Vector3) => {
    if (stillPose || u <= 0) { pos.copy(P0); look.copy(L0); return; }
    if (u >= 1) { pos.copy(P1); look.copy(L1); return; }
    posCurve.getPointAt(u, pos);
    lookCurve.getPointAt(u, look);
  };
  const pl = pace(raw);
  return {
    kind: 'flyover', rail: false, from: fromP, to: toP, duration: pl.duration, length: pl.length, speed: pl.speed,
    pAt: (t) => (pl.uAt(t) < 0.5 ? fromP : toP), // p-gated visibility (districts, slabs, water, audio) switches at the apex, where both are far below
    pose: (t, pos, look) => raw(t >= pl.duration ? 1 : pl.uAt(t), pos, look),
    capAt: pl.capAt,
  };
}

const ta = new THREE.Vector3(), tb = new THREE.Vector3(), tf = new THREE.Vector3(), tg = new THREE.Vector3();
/**
 * Total heading rotation (degrees) the camera makes along the path between two progress values. The path zigzags
 * through the districts (leaving the kiosk alone turns ~120°), so a pan that crosses several keys should be given
 * time for its turn as well as its distance, e.g. `Math.max(panDuration(a, b), pathTurn(a, b) / 150)` for ≤ 150°/s.
 */
export function pathTurn(fromP: number, toP: number, steps = 400) {
  const p0 = Math.min(fromP, toP), p1 = Math.max(fromP, toP);
  let deg = 0;
  poseAt(p0, ta, tb); tf.subVectors(tb, ta).normalize();
  for (let i = 1; i <= steps; i++) {
    poseAt(p0 + ((p1 - p0) * i) / steps, ta, tb);
    tg.subVectors(tb, ta).normalize();
    deg += THREE.MathUtils.radToDeg(tf.angleTo(tg));
    tf.copy(tg);
  }
  return deg;
}

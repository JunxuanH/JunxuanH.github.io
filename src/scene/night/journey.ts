import * as THREE from 'three/webgpu';

/**
 * The camera rail. Progress p ∈ [0,1] maps to districts (`SECTIONS`), and `KEYS` are camera poses interpolated
 * with dwell (a key repeated = the camera holds). nav.ts jumps p to a section's `NAV_TARGET` behind a fade; `?p=`
 * starts the ride anywhere. The hero is the bay vista at p = 0.
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
    if (this.parallaxScale > 1) { camera.rotateY(-par.x[0] * 0.07 * par.gain[0]); camera.rotateX(-par.y[0] * 0.045 * par.gain[0]); }

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

/** Where the nav (and the hero button) lands: the dwell of each section, not its boundary. */
export const NAV_TARGET: Record<SectionId, number> = { city: 0, education: 0.228, work: 0.31, projects: 0.82, contact: 0.99 };

/**
 * Establishing shots: a wide rail pose per section where the district reads at a glance (the plaza with the kiosk,
 * the avenue with the bus shelter, the market street, the pier from the quay side). `?capture=<section>` (main.ts)
 * renders a UI-free still from here; the landing parks the vista on `city` when the overlay lifts.
 */
export const ESTABLISH: Record<SectionId, number> = { city: 0, education: 0.19, work: 0.275, projects: 0.74, contact: 0.96 };

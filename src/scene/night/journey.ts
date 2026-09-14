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
  { p: 0.255, pos: [-74, 3.4, -70], look: [-30, 4, -62] },          // back out under the torii
  // Downtown: bus shelter (eye level), LED wall (crane up), blimp (formation), hologram (forecourt).
  { p: 0.275, pos: [-20, 2.2, -66], look: [-17.6, 2.0, -94.6] },
  { p: 0.31, pos: [-12.2, 1.9, -92.6], look: [-17.6, 2.0, -94.6] },
  { p: 0.345, pos: [-12.2, 1.9, -92.6], look: [-17.6, 2.0, -94.6] },
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
  { p: 1.00, pos: [134.6, 5.0, 14.5], look: [140, 8.2, 32.1] },
];

/** Blimp formation window: the camera pose is offset by the blimp's displacement from its home pose. */
export const FOLLOW = { from: 0.50, to: 0.57, feather: 0.025 };
export function followWeight(p: number) {
  const sm = (x: number) => { const t = THREE.MathUtils.clamp(x, 0, 1); return t * t * (3 - 2 * t); };
  return sm((p - (FOLLOW.from - FOLLOW.feather)) / FOLLOW.feather) * (1 - sm((p - FOLLOW.to) / FOLLOW.feather));
}

const smooth = (t: number) => t * t * (3 - 2 * t);
const a = new THREE.Vector3(), b = new THREE.Vector3();

/** Camera pose at progress p: piecewise smoothstep between keys (repeated keys = dwell). */
export function poseAt(p: number, pos: THREE.Vector3, look: THREE.Vector3) {
  const q = THREE.MathUtils.clamp(p, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].p <= q) i++;
  const k0 = KEYS[i], k1 = KEYS[i + 1];
  const t = k1.p > k0.p ? smooth((q - k0.p) / (k1.p - k0.p)) : 0;
  pos.copy(a.fromArray(k0.pos)).lerp(b.fromArray(k1.pos), t);
  look.copy(a.fromArray(k0.look)).lerp(b.fromArray(k1.look), t);
}

export function sectionAt(p: number): SectionId {
  return (SECTIONS.find((s) => p < s.end) ?? SECTIONS[SECTIONS.length - 1]).id;
}

export const sectionStart = (id: SectionId) => SECTIONS.find((s) => s.id === id)!.start;

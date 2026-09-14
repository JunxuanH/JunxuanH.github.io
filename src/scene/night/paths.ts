/**
 * Sidewalk loops, stall points, patrol loops and drone lanes per district — street level, matching
 * streets.ts (avenue |x| < 12, sidewalks to |x| 18, cross streets at z −60/−144/−228) and the
 * district anchors in journey.ts (campus (−80,0,−80), market street z −228 east of the avenue,
 * plaza (106,0,−228)). Plain data so districts.ts / main.ts can adjust it.
 */
export type Vec3 = [number, number, number];

export interface Stall {
  pos: Vec3;
  /** Point to face while stalled (a stall, a partner, the camera path). */
  face?: Vec3;
  /**
   * Clip to play while stalled: idle | talk | wave | sit. Every rig has idle; talk + wave ship with vendor,
   * punk, salaryman and geisha-bot (rigs.ts / README). A stall asking for a clip waits for a walker whose
   * rig owns it (characters.ts createCrowd), then falls back to idle after 20 s.
   */
  clip?: string;
}

export interface PathDef {
  id: string;
  points: Vec3[];
  closed: boolean;
  stalls?: Stall[];
  /** Ground height for props placed along it. */
  y?: number;
}

const Y = 0.22; // sidewalk / plaza slab height (streets.ts CURB_H)

export const EDUCATION_PLAZA: PathDef = {
  id: 'education-plaza', closed: true, y: Y,
  // Japantown campus: plaza centred (−80, −102); the torii approach runs north to the z −60 street.
  points: [[-80, Y, -70], [-66, Y, -80], [-58, Y, -96], [-64, Y, -118], [-84, Y, -124], [-100, Y, -114], [-104, Y, -96], [-94, Y, -78]],
  stalls: [
    { pos: [-80, Y, -76], face: [-80, Y, -60], clip: 'idle' },   // under the torii, looking out
    { pos: [-70, Y, -104], face: [-68, Y, -102], clip: 'talk' },
    { pos: [-68, Y, -102], face: [-70, Y, -104], clip: 'talk' },
    { pos: [-92, Y, -92], face: [-92, Y, -92], clip: 'idle' },   // by the koi pond
  ],
};

export const WORK_WALK_LEFT: PathDef = {
  id: 'work-walk-left', closed: false, y: Y,
  points: [[-13.4, Y, -50], [-13.4, Y, -100], [-13.6, Y, -140], [-13.4, Y, -184]],
  stalls: [{ pos: [-17.0, Y, -92.0], face: [-12, Y, -92], clip: 'idle' }], // waiting inside the bus shelter
};

export const WORK_WALK_RIGHT: PathDef = {
  id: 'work-walk-right', closed: false, y: Y,
  points: [[15, Y, -184], [15, Y, -140], [15.5, Y, -100], [15, Y, -50]],
  stalls: [{ pos: [15, Y, -140], face: [12, Y, -140], clip: 'idle' }],
};

export const PROJECTS_MARKET: PathDef = {
  id: 'projects-market', closed: true, y: Y,
  points: [[24, Y, -217], [48, Y, -216], [76, Y, -217], [80, Y, -228], [76, Y, -239], [48, Y, -240], [24, Y, -239], [20, Y, -228]],
  stalls: [
    { pos: [36, Y, -242], face: [36, Y, -230], clip: 'wave' },   // vendor behind a stall
    { pos: [58, Y, -215], face: [60, Y, -215], clip: 'talk' },
    { pos: [60, Y, -215], face: [58, Y, -215], clip: 'talk' },
    { pos: [66, Y, -234], face: [72, Y, -228], clip: 'idle' },   // watching the holo stall (off the camera sightline)
  ],
};

/** Long sidewalk walks so the avenue is never empty between districts, and the campus cross street. */
export const AVENUE_WALK_LEFT: PathDef = {
  id: 'avenue-walk-left', closed: false, y: Y,
  // Starts south of the bus shelter (z −99…−91) so nobody crosses the poster's sightline.
  points: [[-15.5, Y, -104], [-15.8, Y, -140], [-15.5, Y, -180], [-15.5, Y, -215]],
};
export const AVENUE_WALK_RIGHT: PathDef = {
  id: 'avenue-walk-right', closed: false, y: Y,
  points: [[13.4, Y, -215], [13.4, Y, -170], [13.6, Y, -120], [13.4, Y, -70], [13.4, Y, -30]],
};
export const CAMPUS_STREET: PathDef = {
  id: 'campus-street', closed: false, y: Y,
  points: [[-110, Y, -50], [-80, Y, -50.5], [-60, Y, -50], [-40, Y, -50.5]],
};

const DECK = 2.9; // pier deck height (districts/pier.ts DECK_Y)
export const CONTACT_PAD: PathDef = {
  id: 'contact-pad', closed: false, y: DECK,
  // Along the pier deck from the quay to the pad and back.
  points: [[137, DECK, -16], [137, DECK, 4], [136, DECK, 26], [144, DECK, 28], [143, DECK, 6], [143, DECK, -16]],
  stalls: [{ pos: [144.5, DECK, 14], face: [160, DECK, 14], clip: 'idle' }, { pos: [136, DECK, 30], face: [140, DECK, 20], clip: 'idle' }],
};

/** Security-robot patrol loops (walk, pause + searchlight sweep at stalls). */
export const PATROLS: PathDef[] = [
  { id: 'patrol-work', closed: true, y: Y, points: [[-15, Y, -64], [15, Y, -64], [15, Y, -180], [-15, Y, -180]],
    stalls: [{ pos: [0, Y, -64], face: [0, Y, -120], clip: 'idle' }, { pos: [0, Y, -180], face: [0, Y, -120], clip: 'idle' }] },
  { id: 'patrol-education-gate', closed: true, y: Y, points: [[-76, Y, -66], [-84, Y, -66], [-84, Y, -72], [-76, Y, -72]],
    stalls: [{ pos: [-80, Y, -68], face: [-80, Y, -50], clip: 'idle' }] },
];

/** Drone lanes: closed loops flown with a hover bob; `y` is the cruise altitude. */
export interface DroneLane { id: string; points: Vec3[]; speed: number; kind: 'police' | 'ad'; }
export const DRONE_LANES: DroneLane[] = [
  // figure-8 over the Work avenue
  { id: 'police-avenue', kind: 'police', speed: 9,
    points: [[-18, 24, -70], [0, 26, -95], [18, 24, -120], [0, 28, -145], [-18, 24, -170], [0, 30, -145], [18, 26, -120], [0, 26, -95]] },
  { id: 'ad-education', kind: 'ad', speed: 5,
    points: [[-104, 16, -80], [-60, 18, -78], [-58, 20, -118], [-104, 18, -120]] },
  { id: 'ad-market', kind: 'ad', speed: 5,
    points: [[28, 14, -214], [72, 15, -214], [74, 16, -242], [30, 15, -242]] },
  { id: 'police-pad', kind: 'police', speed: 4,
    points: [[126, 18, 0], [154, 19, 4], [156, 18, 34], [126, 20, 30]] },
];

/** Suggested placement (which rigs where) — main.ts can override counts per tier. */
export const DISTRICT_CROWDS = [
  { path: EDUCATION_PLAZA, assets: ['geisha-bot', 'ronin', 'netrunner', 'oni-bouncer', 'skater', 'maid-bot', 'geisha-bot', 'salaryman'], count: { high: 9, med: 5, low: 2 } },
  { path: CAMPUS_STREET, assets: ['ronin', 'schoolgirl-hacker', 'skater', 'maid-bot'], count: { high: 5, med: 2, low: 1 } },
  { path: WORK_WALK_LEFT, assets: ['corpo', 'mech-pilot', 'salaryman', 'medic', 'idol'], count: { high: 7, med: 4, low: 1 } },
  { path: WORK_WALK_RIGHT, assets: ['corpo', 'idol', 'patrol-bot', 'mech-pilot', 'salaryman'], count: { high: 7, med: 4, low: 1 } },
  { path: AVENUE_WALK_LEFT, assets: ['netrunner', 'cat-courier', 'salaryman', 'punk', 'dj'], count: { high: 8, med: 4, low: 1 } },
  { path: AVENUE_WALK_RIGHT, assets: ['corpo', 'medic', 'idol', 'patrol-bot', 'mech-pilot'], count: { high: 8, med: 4, low: 1 } },
  { path: PROJECTS_MARKET, assets: ['chef', 'vendor', 'noodle-cook', 'dj', 'skater', 'cat-courier', 'maid-bot', 'punk'], count: { high: 10, med: 6, low: 2 } },
  { path: CONTACT_PAD, assets: ['nomad', 'cat-courier', 'medic', 'mech-pilot'], count: { high: 4, med: 2, low: 1 } },
] as const;

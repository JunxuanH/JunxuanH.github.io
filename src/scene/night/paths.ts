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
  oneWay?: boolean;
  stalls?: Stall[];
  /** Ground height for props placed along it. */
  y?: number;
}

const Y = 0.22; // sidewalk / plaza slab height (streets.ts CURB_H)

export const EDUCATION_PLAZA: PathDef = {
  id: 'education-plaza', closed: true, y: Y,
  // Japantown campus: plaza centred (−80, −102); the torii approach runs north to the z −60 street.
  // Inner promenade: outside the pond, kiosk and the three campus building footprints.
  points: [[-80, Y, -82], [-69, Y, -85], [-65, Y, -96], [-68, Y, -109], [-82, Y, -109], [-84, Y, -102], [-83, Y, -90]],
  stalls: [
    { pos: [-80, Y, -82], face: [-80, Y, -60], clip: 'idle' },
    { pos: [-65, Y, -96], face: [-68, Y, -96], clip: 'talk' },
    { pos: [-68, Y, -109], face: [-80, Y, -109], clip: 'talk' },
    { pos: [-83, Y, -90], face: [-92, Y, -92], clip: 'idle' },
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
  id: 'projects-market', closed: true, oneWay: true, y: Y,
  points: [[29, Y, -222], [48, Y, -221], [68, Y, -221], [76, Y, -225], [76, Y, -231], [68, Y, -235], [48, Y, -234.5], [29, Y, -233.5], [27, Y, -228]],
  stalls: [
    { pos: [34, Y, -220.5], face: [34, Y, -217], clip: 'idle' },
    { pos: [52, Y, -220.5], face: [52, Y, -217], clip: 'talk' },
    { pos: [70, Y, -220.5], face: [70, Y, -217], clip: 'idle' },
    { pos: [52, Y, -235.5], face: [52, Y, -239], clip: 'idle' },
    { pos: [70, Y, -235.5], face: [70, Y, -239], clip: 'talk' },
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
  // Rosters are filtered by what main.ts actually loaded (RIGS_ALL on desktop, RIGS_LITE on phones), so every
  // district lists ≥ 4 rigs that are in the lite roster; batch-3 rigs are placed by theme (rider → market,
  // shaman/nurse → campus, dock worker → harbor, yakuza/bouncer → downtown, tagger → avenue, courier anywhere; the tourist was dropped).
  { path: EDUCATION_PLAZA, assets: ['geisha-bot', 'ronin', 'netrunner', 'oni-bouncer', 'skater', 'maid-bot', 'tech-shaman', 'salaryman', 'nurse', 'schoolgirl-hacker'], count: { high: 10, med: 6, low: 2 } },
  { path: CAMPUS_STREET, assets: ['ronin', 'schoolgirl-hacker', 'skater', 'maid-bot', 'nurse', 'tech-shaman', 'delivery-rider'], count: { high: 6, med: 3, low: 1 } },
  { path: WORK_WALK_LEFT, assets: ['corpo', 'mech-pilot', 'salaryman', 'medic', 'idol', 'yakuza-boss', 'exo-courier'], count: { high: 8, med: 4, low: 1 } },
  { path: WORK_WALK_RIGHT, assets: ['corpo', 'idol', 'patrol-bot', 'mech-pilot', 'salaryman', 'medic', 'bouncer-android', 'yakuza-boss'], count: { high: 8, med: 4, low: 1 } },
  { path: AVENUE_WALK_LEFT, assets: ['netrunner', 'cat-courier', 'salaryman', 'punk', 'dj', 'tagger', 'yakuza-boss', 'delivery-rider'], count: { high: 9, med: 5, low: 1 } },
  { path: AVENUE_WALK_RIGHT, assets: ['corpo', 'medic', 'idol', 'patrol-bot', 'mech-pilot', 'salaryman', 'tagger', 'bouncer-android', 'exo-courier'], count: { high: 9, med: 5, low: 1 } },
  { path: PROJECTS_MARKET, assets: ['skater', 'cat-courier', 'maid-bot', 'punk', 'delivery-rider', 'exo-courier', 'ronin'], count: { high: 12, med: 8, low: 6 } },
  { path: CONTACT_PAD, assets: ['nomad', 'cat-courier', 'medic', 'mech-pilot', 'dock-worker', 'exo-courier'], count: { high: 6, med: 3, low: 1 } },
] as const;

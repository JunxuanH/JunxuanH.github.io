/**
 * Where the campus plaza's furniture stands, in world units.
 *
 * Shared so the geometry (districts/japantown.ts) and the collision proxies (walkable.ts `campus`) cannot
 * drift apart, the same arrangement market-layout.ts uses for the stalls.
 *
 * Everything here is placed around two things that must stay clear: the crowd's loop through the plaza
 * (paths.ts EDUCATION_PLAZA, roughly x −84…−65, z −109…−82, and `scripts/scene-review.mjs` asserts the
 * walkers' route hits no static obstacle), and the walk from the arrival spawn at (−80, −90) to the terminal
 * kiosk at (−80, −100). The rest of the floor was bare paving.
 */

/** Centre of the raised planter, which carries its own cherry tree. */
export const PLAZA_DAIS: [number, number] = [-95, -108];

/** Benches: x, z, yaw. All on the pond's far side — the near side is where the crowd walks. */
export const PLAZA_BENCHES: [number, number, number][] = [
  [-100, -92, 0],
  [-96, -99.5, Math.PI / 4],
  [-96, -84.5, -Math.PI / 4],
];

/** Vending machines: x, z, yaw. Backed against the east block's west face (x −58), lit fronts to the plaza. */
export const PLAZA_VENDORS: [number, number, number][] = [
  [-58.9, -100, -Math.PI / 2],
  [-58.9, -96.6, -Math.PI / 2],
  [-58.9, -93.2, -Math.PI / 2],
];

/** Stone lanterns: four flanking the kiosk approach, four around the planter. */
export const PLAZA_LANTERNS: [number, number][] = [
  [-86, -94], [-74, -94], [-86, -106], [-74, -106],
  [-100.2, -113.2], [-89.8, -113.2], [-100.2, -102.8], [-89.8, -102.8],
];

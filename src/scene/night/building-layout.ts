import { AVENUE_HALF, SIDEWALK, CROSS_Z, CROSS_HALF, QUAY_Z } from './streets';

// Include pavements and a one-unit buffer for facade trim, not just asphalt.
export const BUILDING_SETBACK = SIDEWALK + 1;
export function clearStreetFootprint(x: number, z: number, hw: number, hd: number) {
  return Math.abs(x) - hw >= AVENUE_HALF + BUILDING_SETBACK &&
    CROSS_Z.every(cz => Math.abs(z - cz) - hd >= CROSS_HALF + BUILDING_SETBACK);
}

/** Fit a measured, rotated footprint into the nearest dry city block. */
export function streetLot(x: number, z: number, width: number, depth: number) {
  const edge = CROSS_HALF + BUILDING_SETBACK;
  const rows = [
    [CROSS_Z[0] + edge, QUAY_Z - 1],
    ...CROSS_Z.slice(1).map((cz, i) => [cz + edge, CROSS_Z[i] - edge]),
    [-639, CROSS_Z[CROSS_Z.length - 1] - edge],
  ];
  const scale = Math.min(1, 54 / depth, 160 / width);
  const hw = width * scale / 2, hd = depth * scale / 2;
  const candidates = rows.filter(([lo, hi]) => hi - lo >= hd * 2)
    .map(([lo, hi]) => Math.max(lo + hd, Math.min(hi - hd, z)));
  const cz = candidates.reduce((best, next) => Math.abs(next-z) < Math.abs(best-z) ? next : best);
  return { x: (x < 0 ? -1 : 1) * Math.max(Math.abs(x), AVENUE_HALF + BUILDING_SETBACK + hw), z: cz, scale };
}

// side, centre z, frontage width. Shared by meshes, forecourts, props and collisions.
export const DOWNTOWN_LOBBIES = [[-1, -110, 22], [1, -174, 20], [-1, -174, 22], [1, -202, 18]] as const;

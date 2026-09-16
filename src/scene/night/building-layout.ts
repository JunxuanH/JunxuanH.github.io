import { AVENUE_HALF, SIDEWALK, CROSS_Z, CROSS_HALF, QUAY_Z } from './streets';

// Include pavements and a one-unit buffer for facade trim, not just asphalt.
export const BUILDING_SETBACK = SIDEWALK + 1;
// Authored district architecture, plazas and interaction space are not skyline lots.
// Test the ENTIRE footprint, not the model pivot or a centre-only keep-out disc.
export const DISTRICT_RESERVES = [
  { x0: -134, x1: -26, z0: -136, z1: -69 }, // campus including roof eaves and plaza
  { x0: 18, x1: 94, z0: -270, z1: -190 }, // market storefronts and customers
  { x0: -43, x1: -18, z0: -216, z1: -75 }, // downtown west lobbies and terminal
  { x0: 18, x1: 46, z0: -216, z1: -75 }, // downtown east lobbies and media tower
] as const;
export function clearDistrictFootprint(x: number, z: number, hw: number, hd: number) {
  return DISTRICT_RESERVES.every(b => x + hw <= b.x0 || x - hw >= b.x1 || z + hd <= b.z0 || z - hd >= b.z1);
}
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
  const side = x < 0 ? -1 : 1;
  const baseX = side * Math.max(Math.abs(x), AVENUE_HALF + BUILDING_SETBACK + hw);
  const xs = [baseX, ...DISTRICT_RESERVES.flatMap(b => [b.x0-hw-1, b.x1+hw+1])];
  const zs = [z, ...DISTRICT_RESERVES.flatMap(b => [b.z0-hd-1, b.z1+hd+1])];
  const candidates: { x: number; z: number }[] = [];
  for (const [lo, hi] of rows) {
    if (hi-lo < hd*2) continue;
    for (const cx of xs) for (const desiredZ of zs) {
      const cz = Math.max(lo+hd, Math.min(hi-hd, desiredZ));
      if (Math.sign(cx) !== side || Math.abs(cx)+hw > 379) continue;
      if (!clearStreetFootprint(cx,cz,hw-1e-8,hd-1e-8) || !clearDistrictFootprint(cx,cz,hw,hd)) continue;
      candidates.push({x:cx,z:cz});
    }
  }
  if (!candidates.length) throw new Error('No clear skyline lot');
  const best = candidates.reduce((a,b) => Math.hypot(b.x-x,b.z-z) < Math.hypot(a.x-x,a.z-z) ? b : a);
  return { ...best, scale };
}

// side, centre z, frontage width. Shared by meshes, forecourts, props and collisions.
export const DOWNTOWN_LOBBIES = [[-1, -110, 22], [1, -174, 20], [-1, -174, 22], [1, -202, 18]] as const;

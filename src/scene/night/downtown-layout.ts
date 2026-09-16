/** x/z footprints shared by geometry, collision and placement tests. */
export const DOWNTOWN_PROPS = [
  { kind: 'bench', x: -22, z: -80, w: 1.1, d: 4, h: 1 },
  { kind: 'planter', x: -22, z: -76.5, w: 1.6, d: 1.6, h: 1.4 },
  { kind: 'planter', x: -22, z: -91, w: 1.6, d: 1.6, h: 1.4 },
  { kind: 'lockers', x: 20.5, z: -99, w: 1.5, d: 4.2, h: 2.6 },
  { kind: 'utility', x: -20, z: -120, w: 1.2, d: 2, h: 1.8 },
  { kind: 'utility', x: 20, z: -186, w: 1.2, d: 2, h: 1.8 },
] as const;
export const DOWNTOWN_ASSETS = [
  { file: 'entrance', x: 20.2, z: -174, w: 8, h: 5, d: 2.8, yaw: -Math.PI/2 },
  { file: 'shelter', x: 21, z: -90, w: 6, h: 3.2, d: 3, yaw: -Math.PI/2 },
] as const;

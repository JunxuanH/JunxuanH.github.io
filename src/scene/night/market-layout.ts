/** Shared market layout: geometry, crowds and collision must agree. */
export const MARKET = { x0: 20, x1: 84, z: -228, halfWidth: 14 } as const;
/** x, z, width, height, facade seed, side; also used for precise wall collisions. */
export const MARKET_BUILDINGS = [
  [36,-205.5,30,14,2,1], [68,-205.5,26,11,3,1],
  [40,-250.5,34,12,1,-1], [74,-250.5,22,16,0,-1],
] as const;
export const MARKET_STALLS = [
  { x: 34, z: -239, yaw: 0, kind: 'food', name: 'MIDNIGHT RAMEN', accent: 0xffb35c, rig: 'noodle-cook' },
  { x: 52, z: -239, yaw: 0, kind: 'repair', name: 'PATCH / REPAIR', accent: 0x65e0ed, rig: 'vendor' },
  { x: 70, z: -239, yaw: 0, kind: 'games', name: 'NEON DECK', accent: 0xc971ed, rig: 'dj' },
  { x: 34, z: -217, yaw: Math.PI, kind: 'audio', name: 'SYNAPSE AUDIO', accent: 0xdb67ca, rig: 'dj' },
  { x: 52, z: -217, yaw: Math.PI, kind: 'wear', name: 'AFTERHOURS / GEAR', accent: 0x79d9cb, rig: 'punk' },
  { x: 70, z: -217, yaw: Math.PI, kind: 'drinks', name: 'NEO / CHROMA', accent: 0xebdc56, rig: 'vendor' },
] as const;
export const MARKET_BOLLARDS = [22, 82].flatMap(x => [-234, -230, -226, -222].map(z => ({ x, z })));
export const isMarketLane = (x: number, z: number) => x >= MARKET.x0 && x <= MARKET.x1 && Math.abs(z - MARKET.z) <= MARKET.halfWidth;

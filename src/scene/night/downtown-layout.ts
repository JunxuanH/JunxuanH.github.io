import { DOWNTOWN_LOBBIES, DOWNTOWN_FRONT_X } from './building-layout';

/** Windowed upper floors only: ground-floor entrances and signs keep their original scale. */
export const DOWNTOWN_UPPER_HEIGHTS = [54,70,62,78] as const;
export const downtownTowerHeight = (index:number) => 7+DOWNTOWN_UPPER_HEIGHTS[index]+5+.4;

/** Local lobby coordinates: between the elevator core (front z=1.3) and desk (back z=2.9). */
export const OFFICE_RESIDENTS = [
  {lobby:0,role:'Receptionist',rig:'corpo',x:0,z:2.15,yaw:0},
  {lobby:0,role:'Elevator visitor',rig:'salaryman',x:3.2,z:2.1,yaw:Math.PI},
] as const;

/** Rear-lot infill stays inside the reserved corporate blocks, behind existing lobbies. */
export const DOWNTOWN_INFILL = DOWNTOWN_LOBBIES.filter(([,z])=>z===-174).map(([side,z,w],i)=>({
  x:side*39,z,w:8,d:w-4,h:92+i*12,
}));
/** Mounts track the same frontage layout as the buildings, never old tower positions. */
export const DOWNTOWN_ADS = DOWNTOWN_LOBBIES.map(([side,z],i)=>({
  x:side*(DOWNTOWN_FRONT_X-.12),y:19+i*2,z,yaw:side<0?Math.PI/2:-Math.PI/2,h:12,mounted:true,
}));

/** x/z footprints shared by geometry, collision and placement tests. */
export const DOWNTOWN_PROPS = [
  { kind: 'bench', x: -22, z: -80, w: 1.1, d: 4, h: 1 },
  { kind: 'planter', x: -22, z: -76.5, w: 1.6, d: 1.6, h: 1.4 },
  { kind: 'planter', x: -22, z: -91, w: 1.6, d: 1.6, h: 1.4 },
  { kind: 'lockers', x: 20.5, z: -99, w: 1.5, d: 4.2, h: 2.6 },
  { kind: 'utility', x: -18, z: -120, w: 1.2, d: 2, h: 1.8 },
  { kind: 'utility', x: 18, z: -186, w: 1.2, d: 2, h: 1.8 },
] as const;
export const DOWNTOWN_ASSETS = [
  { file: 'entrance', x: 18.2, z: -174, w: 8, h: 5, d: 2.8, yaw: -Math.PI/2 },
  { file: 'shelter', x: 21, z: -90, w: 6, h: 3.2, d: 3, yaw: -Math.PI/2 },
] as const;

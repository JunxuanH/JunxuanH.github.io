import { AVENUE_HALF, CROSS_HALF, CROSS_Z, SIDEWALK } from './streets';

export type Signal = 'red' | 'amber' | 'green';
export const SIGNAL_CYCLE = 84;
export function crossingPhase(seconds: number) {
  const t=((seconds%SIGNAL_CYCLE)+SIGNAL_CYCLE)%SIGNAL_CYCLE;
  return {
    avenue:(t<14?'green':t<17?'amber':'red') as Signal,
    cross:(t>=22&&t<36?'green':t>=36&&t<39?'amber':'red') as Signal,
    walk:t>=44&&t<52,
  };
}
let clock=0;
export function setCrossingTime(t:number) { clock=t; }
export const SIGNAL_POSTS=CROSS_Z.flatMap(z=>[-1,1].flatMap(sx=>[-1,1].map(sz=>({
  x:sx*(AVENUE_HALF+1),z:z+sz*(CROSS_HALF+1),sx,sz,
}))));

/** Distance from vehicle nose to the red/amber stop line; cars already committed clear it. */
export function signalStopDistance(x:number,z:number,dx:number,dz:number,nose:number,t:number) {
  const phase=crossingPhase(t);
  let distance=Infinity;
  if(Math.abs(dz)>.8 && Math.abs(x)<AVENUE_HALF && phase.avenue!=='green') {
    for(const cz of CROSS_Z) {
      const d=(cz-Math.sign(dz)*(CROSS_HALF+SIDEWALK+1)-z)*Math.sign(dz)-nose;
      if(d>=-.05) distance=Math.min(distance,Math.max(0,d));
    }
  } else if(Math.abs(dx)>.8 && CROSS_Z.some(cz=>Math.abs(z-cz)<CROSS_HALF) && phase.cross!=='green') {
    const d=(-Math.sign(dx)*(AVENUE_HALF+SIDEWALK+1)-x)*Math.sign(dx)-nose;
    if(d>=-.05) distance=Math.max(0,d);
  }
  return distance;
}

/** Wait at the curb, never freeze a pedestrian already crossing the asphalt. */
export function pedestrianMustWait(x:number,z:number,dx:number,dz:number,t=clock) {
  if(crossingPhase(t).walk) return false;
  if(Math.abs(dz)>.5 && Math.abs(x)<=AVENUE_HALF+SIDEWALK) {
    return CROSS_Z.some(cz=>{
      const d=(cz-Math.sign(dz)*(CROSS_HALF+.7)-z)*Math.sign(dz);
      return d>=0 && d<1;
    });
  }
  if(Math.abs(dx)>.5 && CROSS_Z.some(cz=>Math.abs(z-cz)<CROSS_HALF+SIDEWALK)) {
    const d=(-Math.sign(dx)*(AVENUE_HALF+.7)-x)*Math.sign(dx);
    return d>=0 && d<1;
  }
  return false;
}

/**
 * Seconds until this axis next changes aspect. Drives the countdown panels: a driver or a walker
 * wants to know how long the current state lasts, which is the one number a real signal shows.
 */
export function secondsUntilChange(axis:'avenue'|'cross',seconds:number) {
  const t=((seconds%SIGNAL_CYCLE)+SIGNAL_CYCLE)%SIGNAL_CYCLE;
  const edges=axis==='avenue'?[14,17,SIGNAL_CYCLE]:[22,36,39,SIGNAL_CYCLE];
  for(const e of edges) if(t<e) return Math.max(1,Math.ceil(e-t));
  return 1;
}

/** Seconds left of the walk window, or until it opens. The number a pedestrian actually wants. */
export function walkCountdown(seconds:number) {
  const t=((seconds%SIGNAL_CYCLE)+SIGNAL_CYCLE)%SIGNAL_CYCLE;
  if(t>=44&&t<52) return {secs:Math.max(1,Math.ceil(52-t)),walk:true};
  return {secs:Math.max(1,Math.ceil(t<44?44-t:SIGNAL_CYCLE+44-t)),walk:false};
}

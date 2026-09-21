import { AVENUE_HALF, CROSS_HALF, CROSS_Z, SIDEWALK } from './streets';

export type Signal = 'red' | 'amber' | 'green';
/**
 * The old cycle spent 45 of its 84 seconds with both directions red, so traffic stood still for more
 * than half the time and the walk window was a narrow 8 seconds. Movement now fills most of the
 * cycle, with two all-red scrambles: a short clearance and a longer pedestrian window.
 *   0-18 avenue  · 18-21 amber · 21-26 all red
 *   26-44 cross  · 44-47 amber · 47-60 all red (the long walk window)
 */
export const SIGNAL_CYCLE = 60;
export function crossingPhase(seconds: number) {
  const t=((seconds%SIGNAL_CYCLE)+SIGNAL_CYCLE)%SIGNAL_CYCLE;
  return {
    avenue:(t<18?'green':t<21?'amber':'red') as Signal,
    cross:(t>=26&&t<44?'green':t>=44&&t<47?'amber':'red') as Signal,
    walk:(t>=47&&t<57)||(t>=21&&t<24),
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

/**
 * Wait at the curb, never freeze a pedestrian already crossing the asphalt.
 *
 * A walker only conflicts with the traffic on the road they are stepping into, so the old rule of
 * "cross only during the all-red scramble" kept them standing through phases that were no threat to
 * them: someone crossing a side street beside the avenue was held while the avenue, which they never
 * touch, ran green. Each direction now watches its own conflicting axis, and only steps off with
 * enough of the red left to finish.
 */
/**
 * A pedestrian may only step off if the traffic they would cross stays stopped long enough to clear the
 * carriageway. The old rule asked for 3 seconds of red — but the crowd walks at 0.9–1.4 u/s
 * (characters.ts), so the 16 u cross street takes up to 20 s and the 20 u avenue up to 24 s. Walkers
 * stepped off during the short 21–24 scramble and were still in the road when the cross street went green
 * at 26. Sized for the slowest walker, plus a kerb's grace at each end.
 */
const WALK_SPEED_MIN = 0.9;
/** Walkers step out at this multiple of their pace while on a carriageway (characters.ts HURRY). */
const HURRY = 1.5;
export const CLEARANCE = {
  avenue: (AVENUE_HALF * 2 + 2) / (WALK_SPEED_MIN * HURRY),
  cross: (CROSS_HALF * 2 + 2) / (WALK_SPEED_MIN * HURRY),
};

/**
 * Seconds until this axis next shows green. `secondsUntilChange` answers with the next *edge*, which at
 * t 50 is the end of the cycle — three seconds away — even though the cross street then stays red for
 * another 26. Stepping off needs to know when the cars actually move.
 */
export function secondsUntilGreen(axis: 'avenue' | 'cross', t = clock) {
  const GREEN_AT = { avenue: 0, cross: 26 };
  const now = ((t % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  return (((GREEN_AT[axis] - now) % SIGNAL_CYCLE) + SIGNAL_CYCLE) % SIGNAL_CYCLE;
}

export function pedestrianMustWait(x:number,z:number,dx:number,dz:number,t=clock) {
  // Which traffic would they be stepping in front of, and are they at that kerb right now?
  let conflict: 'avenue' | 'cross' | null = null;
  if(Math.abs(dz)>.5 && Math.abs(x)<=AVENUE_HALF+SIDEWALK) {
    const atKerb=CROSS_Z.some(cz=>{
      const d=(cz-Math.sign(dz)*(CROSS_HALF+.7)-z)*Math.sign(dz);
      return d>=0 && d<1;
    });
    if(atKerb) conflict='cross';
  } else if(Math.abs(dx)>.5 && CROSS_Z.some(cz=>Math.abs(z-cz)<CROSS_HALF+SIDEWALK)) {
    const d=(-Math.sign(dx)*(AVENUE_HALF+.7)-x)*Math.sign(dx);
    if(d>=0 && d<1) conflict='avenue';
  }
  if(!conflict) return false;                      // mid-crossing or nowhere near a kerb: keep going
  if(crossingPhase(t)[conflict]!=='red') return true;
  // Red is not an invitation on its own: it has to last long enough to walk the whole carriageway. This
  // also covers the all-red scramble, which used to be a blanket yes and is what put walkers in front of
  // the cross street's green.
  return secondsUntilGreen(conflict,t) < CLEARANCE[conflict];
}

/**
 * Seconds until this axis next changes aspect. Drives the countdown panels: a driver or a walker
 * wants to know how long the current state lasts, which is the one number a real signal shows.
 */
export function secondsUntilChange(axis:'avenue'|'cross',seconds:number) {
  const t=((seconds%SIGNAL_CYCLE)+SIGNAL_CYCLE)%SIGNAL_CYCLE;
  const edges=axis==='avenue'?[18,21,SIGNAL_CYCLE]:[26,44,47,SIGNAL_CYCLE];
  for(const e of edges) if(t<e) return Math.max(1,Math.ceil(e-t));
  return 1;
}

/** Seconds left of the walk window, or until it opens. The number a pedestrian actually wants. */
export function walkCountdown(seconds:number) {
  const walk=crossingPhase(seconds).walk;
  for(let i=1;i<=SIGNAL_CYCLE;i++) if(crossingPhase(seconds+i).walk!==walk) return {secs:i,walk};
  return {secs:1,walk};
}

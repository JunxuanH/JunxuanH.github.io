import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ar=createRequire(require.resolve('astro/package.json'));
const {build}=createRequire(ar.resolve('vite'))('esbuild');
globalThis.location={search:''};globalThis.matchMedia=()=>({matches:false});
const bundled=await build({entryPoints:['src/scene/night/crossing-logic.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {crossingPhase,signalStopDistance,pedestrianMustWait,SIGNAL_POSTS,walkCountdown}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
for(let t=0;t<168;t+=.1) {
  const p=crossingPhase(t);
  assert(!(p.avenue!=='red' && p.cross!=='red'),'conflicting vehicle phases');
  if(p.walk) assert(p.avenue==='red' && p.cross==='red','walk must stop both traffic directions');
}
assert.equal(SIGNAL_POSTS.length,12);
for(const p of SIGNAL_POSTS) assert(Math.abs(p.x)>10);
// Times named by what the phase is doing, so a retimed cycle does not silently invert a test.
const AVE_GREEN=5, CROSS_GREEN=30, ALL_RED=50, AVE_AMBER=19, RED_ENDING=59;
assert.equal(crossingPhase(AVE_GREEN).avenue,'green');
assert.equal(crossingPhase(CROSS_GREEN).cross,'green');
assert.equal(crossingPhase(ALL_RED).avenue,'red');assert.equal(crossingPhase(ALL_RED).cross,'red');

assert.equal(signalStopDistance(-5,-110,0,-1,3,AVE_GREEN),Infinity);
assert.equal(signalStopDistance(-5,-110,0,-1,3,ALL_RED),16);
assert.equal(signalStopDistance(-5,-126,0,-1,3,ALL_RED),0);
assert.equal(signalStopDistance(5,-162,0,1,3,ALL_RED),0);
assert.equal(signalStopDistance(-20,-148,1,0,3,ALL_RED),0);
assert.equal(signalStopDistance(20,-140,-1,0,3,ALL_RED),0);
assert.equal(signalStopDistance(-22,-148,1,0,3,CROSS_GREEN),Infinity);
assert.equal(signalStopDistance(0,-148,1,0,3,ALL_RED),Infinity,'committed car must clear junction');

// Pedestrians watch the road they are stepping into, not the whole junction.
assert(!pedestrianMustWait(15,-134.8,0,-1,AVE_GREEN),'side-street kerb is clear while the avenue runs');
assert(pedestrianMustWait(15,-134.8,0,-1,CROSS_GREEN),'must wait for the traffic they would step in front of');
assert(!pedestrianMustWait(15,-134.8,0,-1,ALL_RED),'cross street stays red for another 36 s: step off');
assert(!pedestrianMustWait(15,-140,0,-1,ALL_RED),'pedestrian already crossing must clear');
assert(pedestrianMustWait(-11,-133.8,1,0,AVE_GREEN),'avenue kerb waits while the avenue runs');
assert(pedestrianMustWait(-11,-133.8,1,0,AVE_AMBER),'amber is not an invitation');
assert(pedestrianMustWait(-11,-133.8,1,0,RED_ENDING),'do not step off into a red about to end');
// A red long enough to *reach the far kerb* is the test, not a red that merely exists. At t 50 the avenue
// turns green in 10 s and the crossing takes 16 at a hurried pace, so this kerb waits — it used to step off
// and was still on the carriageway when the traffic moved, which is what Ivan saw. Its window is the cross
// street's green, when the avenue is red for a full half-cycle.
assert(pedestrianMustWait(-11,-133.8,1,0,ALL_RED),'10 s of red is not enough to cross 20 u');
assert(!pedestrianMustWait(-11,-133.8,1,0,CROSS_GREEN),'the avenue is red for 30 s here: step off');
assert(!pedestrianMustWait(0,-133.8,1,0,ALL_RED),'mid-crossing is not a kerb');

// Simulate a red approach at multiple frame rates: nose never crosses the stop line.
for(const dt of [1/30,1/60,.1]) {
  let z=-100,v=12;
  for(let i=0;i<300;i++) {
    const gap=signalStopDistance(-5,z,0,-1,3,ALL_RED);
    v=Math.min(12,Math.sqrt(8*gap),v+2.5*dt);
    z-=Math.min(v*dt,gap);
    assert(z>=-126-1e-7);
  }
  assert(Math.abs(z+126)<.01);
}
// The walk countdown must agree with the phase it reports, at every second of the cycle.
for(let t=0;t<120;t++) {
  const w=walkCountdown(t);
  assert.equal(w.walk,crossingPhase(t).walk,'countdown disagrees with the walk phase');
  assert(w.secs>=1&&w.secs<=60);
  assert.equal(crossingPhase(t+w.secs).walk,!w.walk,'countdown must end at the change');
}
console.log('PASS signal phases, all-red clearance, curb waiting, committed crossings, and stop lines at 10/30/60 FPS');

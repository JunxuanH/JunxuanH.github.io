import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ar=createRequire(require.resolve('astro/package.json'));
const {build}=createRequire(ar.resolve('vite'))('esbuild');
globalThis.location={search:''};globalThis.matchMedia=()=>({matches:false});
const bundled=await build({entryPoints:['src/scene/night/crossing-logic.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {crossingPhase,signalStopDistance,pedestrianMustWait,SIGNAL_POSTS}=await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
for(let t=0;t<168;t+=.1) {
  const p=crossingPhase(t);
  assert(!(p.avenue!=='red' && p.cross!=='red'),'conflicting vehicle phases');
  if(p.walk) assert(p.avenue==='red' && p.cross==='red','walk must stop both traffic directions');
}
assert.equal(SIGNAL_POSTS.length,12);
for(const p of SIGNAL_POSTS) assert(Math.abs(p.x)>10);
assert.equal(signalStopDistance(-5,-110,0,-1,3,0),Infinity);
assert.equal(signalStopDistance(-5,-110,0,-1,3,44),16);
assert.equal(signalStopDistance(-5,-126,0,-1,3,44),0);
assert.equal(signalStopDistance(5,-162,0,1,3,44),0);
assert.equal(signalStopDistance(-20,-148,1,0,3,44),0);
assert.equal(signalStopDistance(20,-140,-1,0,3,44),0);
assert.equal(signalStopDistance(-22,-148,1,0,3,25),Infinity);
assert.equal(signalStopDistance(0,-148,1,0,3,44),Infinity,'committed car must clear junction');
assert(pedestrianMustWait(15,-134.8,0,-1,0));
assert(!pedestrianMustWait(15,-134.8,0,-1,45));
assert(!pedestrianMustWait(15,-140,0,-1,60),'pedestrian already crossing must clear');
assert(pedestrianMustWait(-11,-133.8,1,0,0));
assert(!pedestrianMustWait(0,-133.8,1,0,60));
// Simulate a red approach at multiple frame rates: nose never crosses the stop line.
for(const dt of [1/30,1/60,.1]) {
  let z=-100,v=12;
  for(let i=0;i<300;i++) {
    const gap=signalStopDistance(-5,z,0,-1,3,44);
    v=Math.min(12,Math.sqrt(8*gap),v+2.5*dt);
    z-=Math.min(v*dt,gap);
    assert(z>=-126-1e-7);
  }
  assert(Math.abs(z+126)<.01);
}
console.log('PASS signal phases, all-red clearance, curb waiting, committed crossings, and stop lines at 10/30/60 FPS');

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { Vector3, CatmullRomCurve3 } from 'three';
const require=createRequire(import.meta.url);
const ar=createRequire(require.resolve('astro/package.json'));
const vr=createRequire(ar.resolve('vite'));
const {build}=vr('esbuild');
globalThis.location={search:''};
globalThis.matchMedia=()=>({matches:false});
async function load(path) {
  const b=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});
  return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
}
const {MARKET_STALLS,MARKET_BOLLARDS}=await load('src/scene/night/market-layout.ts');
const {PROJECTS_MARKET}=await load('src/scene/night/paths.ts');
const {buildAreas,buildWorldArea,resolve,groundY}=await load('src/scene/night/walkable.ts');
const {TERMINALS}=await load('src/scene/night/terminal-layout.ts');
const area=buildWorldArea(buildAreas(),[]);
assert.equal(MARKET_STALLS.length,6);
assert.equal(new Set(MARKET_STALLS.map(s=>s.kind)).size,6);
for(const s of MARKET_STALLS) {
  assert(Math.abs(s.z+228)>8,'stalls stay beside the central lane');
  const prev=new Vector3(s.x,.22,s.z+4*Math.cos(s.yaw));
  const next=new Vector3(s.x,.22,s.z);
  assert(resolve(area,next,prev),'counter collision exists');
}
for(const b of MARKET_BOLLARDS) {
  const prev=new Vector3(b.x-1,.22,b.z), next=new Vector3(b.x,.22,b.z);
  assert(resolve(area,next,prev),'visible bollards have collision');
}
for(const z of [-231,-225]) {
let p=new Vector3(19,.22,z);
for(let i=0;i<330;i++) {
  const prev=p.clone(); p.x+=.2;
  assert(!resolve(area,p,prev),'both sides of the central terminal stay open');
}
}
const curve=new CatmullRomCurve3(PROJECTS_MARKET.points.map(p=>new Vector3(...p)),true,'centripetal');
for(let i=0;i<500;i++) {
  const p=curve.getPointAt(i/500), next=p.clone();
  assert(!resolve(area,next,p),'customer route must not intersect stall, seat or kiosk at '+p.toArray().join(',')+' -> '+next.toArray().join(','));
  assert(Math.abs(p.y-groundY(area,p.x,p.z))<.01,'customers stand on the paving');
}
assert(PROJECTS_MARKET.oneWay,'one-way browsing circulation avoids head-on walkers');
assert.deepEqual([...TERMINALS.projects.pos],[52,.22,-228],'reader is in the market centre');
assert.equal(TERMINALS.projects.yaw,0,'screen faces the arrival');
for(let z=-224;z>-227;z-=.1) {
  const p=new Vector3(52,.22,z);
  assert(!resolve(area,p,p.clone()),'terminal approach is clear');
}
const main=readFileSync('src/scene/night/main.ts','utf8');
assert(!main.includes('[300, 0.1, -224]')&&!main.includes('[-300, 0.1, -232]'),'no market vehicle lanes');
console.log('PASS six shops, physical counters/bollards, open through-route, customer clearance, ground heights and traffic exclusion');

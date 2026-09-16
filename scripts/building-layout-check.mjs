import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Matrix4 } from 'three';
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const { build } = createRequire(astroRequire.resolve('vite'))('esbuild');
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
async function bundled(file) {
  const result = await build({ entryPoints: [file], bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.url': JSON.stringify(import.meta.url) } });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { clearStreetFootprint, clearDistrictFootprint, streetLot, DOWNTOWN_LOBBIES, DOWNTOWN_FRONT_X, DOWNTOWN_DEPTH } = await bundled('src/scene/night/building-layout.ts');
const { createKitbash } = await bundled('src/scene/night/towers.ts');
for (const tier of ['low', 'med', 'high']) {
  const kit = createKitbash({ tier, keepOut: [], clear: (x,z,hw,hd) => clearStreetFootprint(x,z,hw,hd) && clearDistrictFootprint(x,z,hw,hd) });
  let checked = 0;
  for (const mesh of kit.group.children) {
    if (!mesh.geometry.attributes.aStrip) continue;
    mesh.geometry.computeBoundingBox();
    for (let i = 0; i < mesh.count; i++) {
      const m = new Matrix4(); mesh.getMatrixAt(i, m);
      const b = mesh.geometry.boundingBox.clone().applyMatrix4(m);
      // Instanced matrices use float32, so tolerate only rounding, not visible overlap.
      const epsilon = 0.0001;
      assert(clearStreetFootprint((b.min.x+b.max.x)/2, (b.min.z+b.max.z)/2,
        (b.max.x-b.min.x)/2-epsilon, (b.max.z-b.min.z)/2-epsilon), `${tier} tower ${i} overlaps street`);
      assert(clearDistrictFootprint((b.min.x+b.max.x)/2, (b.min.z+b.max.z)/2,
        (b.max.x-b.min.x)/2-epsilon, (b.max.z-b.min.z)/2-epsilon), `${tier} tower ${i} intrudes into a district`);
      checked++;
    }
  }
  assert.equal(checked, kit.count);
  console.log(`PASS ${tier}: ${checked} transformed tower bounds clear roads and sidewalks`);
}
for (const x of [-96, -48, -22, 0, 30, 90]) for (const z of [-40, -60, -95, -140, -190, -228, -260]) {
  for (const [width, depth] of [[12,18], [38,42], [80,100], [300,250]]) {
    const lot = streetLot(x,z,width,depth);
    assert(clearStreetFootprint(lot.x,lot.z,width*lot.scale/2-1e-8,depth*lot.scale/2-1e-8));
    assert(clearDistrictFootprint(lot.x,lot.z,width*lot.scale/2-1e-8,depth*lot.scale/2-1e-8), 'relocated tower intrudes into district');
    assert(lot.z+depth*lot.scale/2 <= -21, 'tower stays off waterfront');
    assert(lot.scale <= 1 && lot.scale > 0);
  }
}
assert(!clearDistrictFootprint(-62,-102,12,20), 'campus intrusion is rejected');
assert(!clearDistrictFootprint(-145,-102,20,12), 'off-centre tower clipping campus edge is rejected');
for (const [side,z,w] of DOWNTOWN_LOBBIES) {
  // The forecourt extends 3 units beyond each end of the lobby frontage.
  assert([-60,-144,-228].every(cz => Math.abs(z-cz) - (w+6)/2 >= 8), 'lobby/forecourt crosses asphalt');
}
const { buildAreas } = await bundled('src/scene/night/walkable.ts');
const work = buildAreas().work;
for (const [side,z,w] of DOWNTOWN_LOBBIES) {
  assert(work.obstacles.some(o => o.kind === 'box' && o.x0 === (side<0?-(DOWNTOWN_FRONT_X+DOWNTOWN_DEPTH):DOWNTOWN_FRONT_X) && o.z0 === z-w/2 && Math.abs(o.x1-o.x0-DOWNTOWN_DEPTH)<1e-8), 'lobby collision follows expanded mesh');
  assert(DOWNTOWN_DEPTH===14 && DOWNTOWN_FRONT_X>=19,'reclaimed width expands buildings without taking sidewalk');
}
console.log('PASS imported-tower lot fitting, lobby forecourts and synchronized collisions');
const { DOWNTOWN_PROPS, DOWNTOWN_ASSETS, DOWNTOWN_INFILL, DOWNTOWN_ADS } = await bundled('src/scene/night/downtown-layout.ts');
for(const t of DOWNTOWN_INFILL) {
  assert(clearStreetFootprint(t.x,t.z,t.w/2,t.d/2), 'infill clips a road or sidewalk');
  assert(t.z-t.d/2 > -190 && t.z+t.d/2 < -144, 'infill enters market or campus');
  assert(Math.abs(t.x)-t.w/2>33.6, 'infill intersects a lobby');
  assert(work.obstacles.some(o=>o.kind==='box' && o.x0===t.x-t.w/2 && o.z0===t.z-t.d/2 && o.h===t.h), 'infill missing collider');
}
for(const [i,a] of DOWNTOWN_ADS.entries()) {
  const [side,z,w]=DOWNTOWN_LOBBIES[i];
  assert.equal(a.z,z);assert.equal(a.yaw,side<0?Math.PI/2:-Math.PI/2);
  assert(Math.abs(Math.abs(a.x)-DOWNTOWN_FRONT_X)<.2 && a.mounted, 'ad detached from facade');
  assert(a.h*9/16<w && a.y-a.h/2>7 && a.y+a.h/2<37+i*3, 'ad exceeds upper facade');
}
console.log('PASS fixed facade ad mounts and rear infill with synchronized collisions');
const footprints = [...DOWNTOWN_PROPS.map(s=>({...s,hw:s.w/2,hd:s.d/2})),
  ...DOWNTOWN_ASSETS.map(s=>({...s,hw:s.d/2,hd:s.w/2}))];
for(const s of footprints) {
  for(const [side,z,w] of DOWNTOWN_LOBBIES) {
    const cx=side*(DOWNTOWN_FRONT_X+DOWNTOWN_DEPTH/2);
    assert(Math.abs(s.x-cx)>=s.hw+DOWNTOWN_DEPTH/2-1e-8 || Math.abs(s.z-z)>=s.hd+w/2-1e-8,
      'expanded lobby intersects a frontage prop');
  }
  assert(Math.abs(s.x)-s.hw >= 16, 'downtown addition blocks through sidewalk');
  assert([-60,-144,-228].every(cz=>Math.abs(s.z-cz)-s.hd>=14), 'downtown addition clips crosswalk');
  assert(Math.hypot(s.x+18,s.z+84)>s.hw+2, 'terminal approach blocked');
  for(const other of footprints) {
    if(s===other) continue;
    assert(Math.abs(s.x-other.x)>=s.hw+other.hw || Math.abs(s.z-other.z)>=s.hd+other.hd, 'new downtown objects overlap');
  }
}
for(const a of DOWNTOWN_ASSETS) {
  const data=readFileSync(`public/night/downtown/${a.file}.glb`);
  assert(data.length<150000);assert.equal(data.toString('utf8',0,4),'glTF');
  const json=JSON.parse(data.toString('utf8',20,20+data.readUInt32LE(12)));
  assert(!json.images?.length, 'asset unexpectedly includes large textures');
  const triangles=json.meshes.flatMap(m=>m.primitives).reduce((n,p)=>n+json.accessors[p.indices].count/3,0);
  assert(triangles>0 && triangles<6000);
  assert(work.obstacles.some(o=>o.kind==='obb' && o.x===a.x && o.z===a.z && o.hw===a.w/2 && o.hd===a.d/2));
  console.log(`PASS ${a.file}: ${triangles} triangles, ${data.length} bytes, collision envelope matches`);
}
console.log('PASS downtown additions leave sidewalks, crosswalks and terminal approach clear');

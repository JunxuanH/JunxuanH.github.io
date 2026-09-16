import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
let total=0;
for(const name of ['mask','headphones','console']) {
  const bytes=readFileSync(`public/night/shop-models/${name}.glb`);
  assert.equal(bytes.readUInt32LE(0),0x46546c67);
  assert.equal(bytes.readUInt32LE(4),2);
  assert.equal(bytes.readUInt32LE(8),bytes.length);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  assert(!gltf.images?.length,'colour should not require texture downloads');
  assert(gltf.buffers.every(b=>!b.uri),'self-contained GLB');
  let triangles=0;
  for(const mesh of gltf.meshes)for(const p of mesh.primitives) {
    const a=gltf.accessors[p.attributes.POSITION];
    assert(a.count>0 && a.min.every(Number.isFinite) && a.max.every(Number.isFinite));
    triangles+=(gltf.accessors[p.indices]?.count??a.count)/3;
  }
  assert(triangles>0 && triangles<6000,'bounded geometry complexity');
  assert(bytes.length<150000,'small mobile download');total+=bytes.length;
  console.log(`${name}: ${triangles} triangles, ${bytes.length} bytes`);
}
assert(total<350000);console.log('PASS bounded, self-contained shop models');

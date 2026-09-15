import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { lightBeamGeometry, aimLightBeam } from '../src/scene/night/light-beam.ts';

for (const [name, source, target, radius] of [
  ['drone', [0, -.1, 0], [0, -20, 6], 5.5],
  ['robot', [.35, 1.476, .1], [.35, 0, 6], 2.2],
  ['lighthouse', [0, 15.1, 0], [0, 15.1, -90], 3.2],
]) {
  const s = new THREE.Vector3(...source), t = new THREE.Vector3(...target);
  const g = lightBeamGeometry(radius, s.distanceTo(t));
  const mesh = new THREE.Mesh(g);
  aimLightBeam(mesh, s, t); mesh.updateMatrixWorld(true);
  const p = g.attributes.position, uv = g.attributes.uv;
  const apex = new THREE.Vector3(), base = new THREE.Vector3(); let n = 0;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld);
    if (uv.getY(i) === 0) assert(v.distanceTo(s) < 1e-5, `${name}: apex is not at lamp`);
    if (uv.getY(i) === 1 && i < p.count - 1) { base.add(v); n++; }
  }
  // Verify the cone's local centre axis, independent of the duplicate seam vertex.
  apex.set(0, 0, 0).applyMatrix4(mesh.matrixWorld);
  base.set(0, -s.distanceTo(t), 0).applyMatrix4(mesh.matrixWorld);
  assert(apex.distanceTo(s) < 1e-6);
  assert(base.distanceTo(t) < 1e-6, `${name}: beam and spotlight point different ways`);
  g.dispose();
  console.log(`PASS ${name}: apex, target and UV fade direction`);
}

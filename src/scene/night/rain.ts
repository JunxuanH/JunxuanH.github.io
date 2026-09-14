import * as THREE from 'three/webgpu';
import { attribute, vec3, fract, time, positionLocal, cameraPosition, color, float } from 'three/tsl';
import { rng } from './palette';

/** Rain streaks: instanced thin quads falling inside a camera-relative box (all on the GPU). */
export function createRain(count: number) {
  const geo = new THREE.PlaneGeometry(0.03, 0.9);
  const igeo = new THREE.InstancedBufferGeometry().copy(geo as any) as THREE.InstancedBufferGeometry;
  const seeds = new Float32Array(count * 3);
  const r = rng(11);
  for (let i = 0; i < count; i++) { seeds[i * 3] = r(); seeds[i * 3 + 1] = r(); seeds[i * 3 + 2] = r(); }
  igeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  igeo.instanceCount = count;
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const s = attribute('aSeed', 'vec3');
  const box = vec3(90, 40, 90);
  const fall = fract(s.y.add(time.mul(0.55).mul(s.z.mul(0.5).add(0.8))));
  const off = vec3(s.x.mul(box.x).sub(box.x.mul(0.5)), box.y.sub(fall.mul(box.y)), s.z.mul(box.z).sub(box.z.mul(0.5)));
  m.positionNode = positionLocal.add(off).add(vec3(cameraPosition.x, cameraPosition.y.sub(20), cameraPosition.z.sub(35)));
  m.colorNode = color(0xa9c8ff);
  m.opacityNode = float(0.13);
  const mesh = new THREE.InstancedMesh(igeo as any, m, count);
  mesh.frustumCulled = false;
  return mesh;
}

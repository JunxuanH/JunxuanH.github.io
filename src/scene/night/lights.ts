/**
 * Fixed-size pool of point lights. three bakes the number of active lights into every material's
 * shader, so toggling a district's lights on and off regenerates every shader in the scene (multi-second
 * freezes). The pool keeps the count constant: districts and carriers hand in their light specs each
 * frame and the nearest ones take the slots; the rest sit at intensity 0.
 */
import * as THREE from 'three/webgpu';
import type { LightSpec } from './districts/shared';

export function createLightPool(scene: THREE.Scene, size: number) {
  const slots: THREE.PointLight[] = [];
  for (let i = 0; i < size; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 40, 2);
    l.position.set(0, -1000, 0);
    scene.add(l);
    slots.push(l);
  }
  const scored: { spec: LightSpec; d: number }[] = [];
  const tmp = new THREE.Vector3();
  const update = (specs: LightSpec[], viewer: THREE.Vector3) => {
    scored.length = 0;
    for (const spec of specs) {
      const d = tmp.set(spec[0], spec[1], spec[2]).distanceTo(viewer);
      // Rank by how much of the light could reach the viewer: intensity over distance, capped by its range.
      const reach = spec[5] ?? 55;
      scored.push({ spec, d: d > reach * 2.5 ? Infinity : d / Math.sqrt(spec[4]) });
    }
    scored.sort((a, b) => a.d - b.d);
    for (let i = 0; i < size; i++) {
      const l = slots[i], s = scored[i];
      if (!s || s.d === Infinity) { l.intensity = 0; continue; }
      const [x, y, z, c, intensity, distance] = s.spec;
      l.position.set(x, y, z);
      l.color.set(c);
      l.intensity = intensity;
      l.distance = distance ?? 55;
    }
  };
  return { slots, update };
}

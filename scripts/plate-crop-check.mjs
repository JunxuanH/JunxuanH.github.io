import assert from 'node:assert/strict';
import { croppedPlateGeometry } from '../src/scene/night/plate-geometry.ts';
for (const margin of [.08, .28]) for (const mirror of [false, true]) {
  const g = croppedPlateGeometry(1000, 500, margin, mirror);
  g.computeBoundingBox();
  assert(Math.abs(g.boundingBox.max.x - g.boundingBox.min.x - 1000 * (1 - 2 * margin)) < .001);
  const local = g.attributes.uv, source = g.attributes.uv1;
  for (let i = 0; i < source.count; i++) {
    const u = source.getX(i);
    assert(u >= margin - 1e-6 && u <= 1 - margin + 1e-6, 'discarded source edge sampled');
    assert(Math.abs(u - (mirror ? 1 - margin - local.getX(i) * (1 - 2 * margin) : margin + local.getX(i) * (1 - 2 * margin))) < 1e-6);
  }
  g.dispose();
}
assert.throws(() => croppedPlateGeometry(1, 1, .5), RangeError);
console.log('PASS panel crop: removed margins, mirrored UVs, unchanged artwork scale');

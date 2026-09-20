import * as THREE from 'three/webgpu';
import { float, vec2, vec3, color, mix, step, smoothstep, fract, floor, hash, time, instanceIndex, positionLocal, uv } from './tsl';
import { PAL } from './palette';

/**
 * Aerial traffic over the far skyline: light streaks crossing the lanes between the painted plate and the city.
 *
 * The plate is a painting, so its own flying cars are frozen where the artist left them. Animating the painting
 * itself was the obvious answer and it did not survive contact: conditioning a video model on the plate as both
 * first and last frame froze the clouds solid (sky pixels moved 1.1 of 255 over 2.5 s), and dropping the end frame
 * bought motion at the cost of the plate's identity — the camera drifted, the grade warmed and a red sun appeared
 * that is not in the painting. These are geometry instead: they move exactly as told, cost one draw, and they sit
 * in front of the plate where real parallax makes them read as traffic rather than as paint.
 *
 * The whole animation lives in the vertex shader, driven by `time`, so there is nothing to update per frame —
 * and reduced motion freezes it for free, since `time` is held at 0 there (tsl.ts).
 */

/** Lanes live between the plate (z −560) and the city, high enough to clear the tallest towers. */
const COUNT = 26, SPAN = 620, Y_LO = 86, Y_HI = 330, Z_NEAR = -380, Z_FAR = -545;
/** Streak size in world units: about a dozen pixels wide from the bay vista. */
const LEN = 9, THICK = 0.85;

export function createAirTraffic() {
  const geo = new THREE.PlaneGeometry(LEN, THICK);
  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  // Fog off, like the plate: at 900 u the haze would erase these entirely, and they belong to the painting's distance.
  mat.fog = false;

  const id = float(instanceIndex);
  const lane = hash(id.mul(1.37));
  const y = mix(float(Y_LO), float(Y_HI), lane);
  const z = mix(float(Z_NEAR), float(Z_FAR), hash(id.mul(2.11)));
  // Half fly each way. Speed varies so the lanes never fall into step with each other.
  const dir = step(0.5, hash(id.mul(3.07))).mul(2).sub(1);
  const speed = mix(float(0.012), float(0.03), hash(id.mul(4.51)));
  const x = fract(time.mul(speed).add(hash(id.mul(5.93)))).sub(0.5).mul(SPAN * 2).mul(dir);
  // Taper both ends of the quad so a streak reads as a light with a trail, not as a bar.
  const taper = smoothstep(0.0, 0.16, uv().x).mul(smoothstep(1.0, 0.84, uv().x));
  const head = smoothstep(0.55, 1.0, uv().x);

  const tint = mix(color(PAL.cyan), color(PAL.magenta), step(0.55, hash(id.mul(6.73))));
  const warm = step(0.86, hash(id.mul(7.19)));
  const lit = mix(tint, color(0xffd2a0), warm);
  mat.positionNode = positionLocal.add(vec3(x, y, z));
  mat.colorNode = lit.mul(float(0.9).add(head.mul(2.2)));
  // Distance keeps them faint; the bloom threshold does the rest of the work.
  mat.opacityNode = taper.mul(0.55);

  const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
  mesh.name = 'air-traffic';
  // Every instance is placed in the shader, so the CPU-side matrices are identity and the bounds are meaningless.
  mesh.frustumCulled = false;
  mesh.renderOrder = -9; // after the plate (−10), before the city
  const dummy = new THREE.Object3D();
  for (let i = 0; i < COUNT; i++) mesh.setMatrixAt(i, dummy.matrix);
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

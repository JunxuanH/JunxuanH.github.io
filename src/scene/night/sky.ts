import * as THREE from 'three/webgpu';
import {
  positionLocal, normalize, mix, color, smoothstep, float, uv, sin,
  fog, densityFogFactor, positionWorld,
} from './tsl';
import { PAL } from './palette';

/**
 * Night sky: gradient dome (plum horizon → near-black zenith) and a small moon.
 * The city haze provides atmosphere without opaque cloud cutouts.
 * Everything is `fog: false`; the scene fog handles the haze between towers.
 */
export function createSky(_tier: 'high' | 'med' | 'low') {
  const group = new THREE.Group();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide }));
  const mat = dome.material as THREE.MeshBasicNodeMaterial;
  mat.fog = false;
  mat.depthWrite = false;
  const dir = normalize(positionLocal);
  // A phone in portrait looks much higher up the dome than a desktop window does: the top of that
  // frame sits around 0.58 on this axis, which the old ramp had already taken to 0x08070f, i.e.
  // black. The ramp shape is unchanged; only the zenith colour is lifted to a dark navy, so this is
  // a rainy, light-polluted sky with a visible cloud base rather than a hole.
  const up = smoothstep(-0.05, 0.55, dir.y);
  // The dome also has to meet the plate, not sit half its brightness below it: where the painting
  // ends, the sky it dissolves into is what decides whether you see a boundary. The plate's own band
  // measures 88, the old plum 41.
  const grad = mix(color(0x58405a), color(0x0e1322), up);
  // Warm city glow just above the horizon, strongest toward -z (the skyline).
  const glow = smoothstep(0.25, 0.0, dir.y).mul(smoothstep(-0.3, -1.0, dir.z).mul(0.5).add(0.5));
  // East and west over the bay the painted plate does not reach, and there the dome was doing all the
  // work alone: measured from the pier looking west, 42 % of the frame was sky whose luminance changed
  // by 0.1 from the horizon to the top of frame — a flat wall, with the bay's far edge cutting across it.
  // Two cheap additions give that half of the sky something to be, without a second painting.
  // Mist on the horizon itself, in every direction, so the water ends in air rather than on a line.
  const mist = smoothstep(0.14, -0.03, dir.y);
  // Cloud strata: two long sine layers crossed, low contrast, gone by ~30° up. Not weather — just enough
  // structure that the eye reads depth instead of paint. Kept under the plate's own cloud contrast so the
  // vista, where the painting covers the sky, does not gain a second set of bands behind the first.
  const strata = sin(dir.y.mul(26.0).add(dir.x.mul(3.1))).mul(0.5).add(0.5)
    .mul(sin(dir.y.mul(15.0).sub(dir.z.mul(2.4)).add(1.7)).mul(0.5).add(0.5))
    .mul(smoothstep(0.5, 0.05, dir.y));
  const lit = grad.add(color(0x5a2a3c).mul(glow).mul(0.6));
  mat.colorNode = mix(lit, color(0x6d5573), mist.mul(0.5)).add(color(0x35263f).mul(strata).mul(0.7));
  group.add(dome);

  // Moon
  const moonMat = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
  moonMat.fog = false;
  const md = uv().sub(0.5).length();
  moonMat.colorNode = mix(color(0xdfe6ff), color(0xb9c4ff), md.mul(2.0));
  moonMat.opacityNode = float(1).sub(smoothstep(0.42, 0.5, md)).mul(0.9);
  const moon = new THREE.Sprite(moonMat);
  moon.position.set(-620, 520, -1100);
  moon.scale.setScalar(70);
  group.add(moon);

  return group;
}

/**
 * Height-tinted haze: warm near the streets, cool up high.
 *
 * The colour matters more than the density. Distant geometry fades toward this, while the painted
 * skyline behind it is drawn with fog off, so if the two do not agree the rendered towers turn into
 * black cut-outs against a bright painting. Measured against the plate, the old navy and plum were
 * luminance 17 and 41 where the plate's own mid band is 88, which is exactly the mismatch that made
 * the middle of the skyline read as unlit. These sit just under the plate, so distance still reads as
 * depth, but a far tower now washes into the city glow the way it would in real air.
 */
export function createHaze(density = 0.0032) {
  const c = mix(color(0x434a63), color(0x624455), smoothstep(40.0, 0.0, positionWorld.y));
  return fog(c, densityFogFactor(density));
}


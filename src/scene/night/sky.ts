import * as THREE from 'three/webgpu';
import {
  positionLocal, normalize, mix, color, smoothstep, float, uv,
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
  mat.colorNode = grad.add(color(0x5a2a3c).mul(glow).mul(0.6));
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


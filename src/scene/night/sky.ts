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
  const up = smoothstep(-0.05, 0.45, dir.y);
  const grad = mix(color(PAL.plum), color(0x08070f), up);
  // Warm city glow just above the horizon, strongest toward -z (the skyline).
  const glow = smoothstep(0.25, 0.0, dir.y).mul(smoothstep(-0.3, -1.0, dir.z).mul(0.5).add(0.5));
  // The old quantized-direction star hash formed diagonal dotted bands near the side panels.
  // Keep this rainy, light-polluted sky clean; moon and the original skyline remain.
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

/** Height-tinted haze: magenta/orange near the streets, navy up high. */
export function createHaze(density = 0.0032) {
  const c = mix(color(PAL.navy), color(PAL.plum), smoothstep(40.0, 0.0, positionWorld.y));
  return fog(c, densityFogFactor(density));
}


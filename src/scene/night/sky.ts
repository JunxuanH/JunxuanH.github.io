import * as THREE from 'three/webgpu';
import {
  positionLocal, normalize, mix, color, smoothstep, step, hash, floor, float, uv, texture, vec3,
  fog, densityFogFactor, positionWorld, equirectUV, vec2,
} from './tsl';
import { PAL, loadSRGB, loader } from './palette';

/**
 * Night sky. Main scene uses an undisplaced 360° river-city panorama. The legacy plate preview
 * uses the gradient dome, star field, clouds and moon.
 * Everything is `fog: false`; the scene fog handles the haze between towers.
 */
export function createSky(tier: 'high' | 'med' | 'low', pano?: { url: string; rotation?: number; gain?: number }) {
  const group = new THREE.Group();
  if (pano) {
    // Treat distant skyline imagery as sky, not nearby geometry. Depth displacement and a fixed
    // world-space dome both warp the painted buildings as the visitor moves away from the origin.
    // Textures are handed to the material before they load (one program, no rebuild when the images arrive).
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 256, 128), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide }));
    const mat = dome.material as THREE.MeshBasicNodeMaterial;
    mat.fog = false;
    mat.depthWrite = false;
    dome.name = 'skyline-panorama';
    const eye = new THREE.Vector3();
    dome.onBeforeRender = (_renderer, _scene, camera) => {
      // Preserve rotation, but center the dome on the actual render camera (including cutscenes).
      dome.matrixWorld.setPosition(camera.getWorldPosition(eye));
    };
    dome.rotation.y = THREE.MathUtils.degToRad(pano.rotation ?? 0);
    dome.frustumCulled = false;
    const tex = loader.load(pano.url, undefined, undefined, () => console.warn('[night] pano image failed', pano.url));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.anisotropy = 8;
    const dir = normalize(positionLocal);
    const puv = equirectUV(dir);
    mat.colorNode = texture(tex, puv).rgb.mul(pano.gain ?? 1.15);
    group.add(dome);
    return group;
  }

  const dome = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide }));
  const mat = dome.material as THREE.MeshBasicNodeMaterial;
  mat.fog = false;
  mat.depthWrite = false;
  const dir = normalize(positionLocal);
  const up = smoothstep(-0.05, 0.45, dir.y);
  const grad = mix(color(PAL.plum), color(0x08070f), up);
  // Warm city glow just above the horizon, strongest toward -z (the skyline).
  const glow = smoothstep(0.25, 0.0, dir.y).mul(smoothstep(-0.3, -1.0, dir.z).mul(0.5).add(0.5));
  const cell = floor(dir.mul(900.0));
  const starHash = hash(cell.x.mul(1.3).add(cell.y.mul(7.7)).add(cell.z.mul(13.1)));
  const stars = step(0.9985, starHash).mul(smoothstep(0.1, 0.4, dir.y)).mul(hash(cell.x.add(cell.z)).mul(0.6).add(0.4));
  mat.colorNode = grad.add(color(0x5a2a3c).mul(glow).mul(0.6)).add(stars.mul(0.9));
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

  // Low cloud band: cumulus cutouts lit from below by the city.
  const cloudLayout: [number, number, number, number][] = [
    // azimuth (deg from -z), elevation (deg), width, texture index
    [-38, 9, 420, 2], [22, 7, 380, 4], [-70, 11, 300, 3], [58, 10, 340, 1], [0, 13, 260, 2],
  ];
  const count = tier === 'low' ? 3 : cloudLayout.length;
  for (const [az, el, w, idx] of cloudLayout.slice(0, count)) {
    loadSRGB(`/clouds/cloud-${idx}.webp`).then((tex) => {
      const m = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false });
      m.fog = false;
      const s = texture(tex, uv());
      // Dark plum tops, warm underside lit by the city.
      m.colorNode = mix(color(0x7a3a2a), color(0x2a0f2a), uv().y).mul(s.r.mul(0.6).add(0.4));
      m.opacityNode = s.a.mul(0.85);
      const sp = new THREE.Sprite(m);
      const R = 1200;
      const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
      sp.position.set(Math.sin(a) * R * Math.cos(e), Math.sin(e) * R, -Math.cos(a) * R * Math.cos(e));
      sp.scale.set(w, w * 0.68, 1);
      group.add(sp);
    }).catch(() => {});
  }

  return group;
}

/** Height-tinted haze: magenta/orange near the streets, navy up high. */
export function createHaze(density = 0.0032, cool = false) {
  // `cool` (panorama preview): navy up high, teal at street level, matching the panorama's horizon haze.
  const c = mix(color(PAL.navy), color(cool ? 0x10303a : PAL.plum), smoothstep(40.0, 0.0, positionWorld.y));
  return fog(c, densityFogFactor(density));
}

export const HAZE_COLOR = new THREE.Color(PAL.navy);
export const _v3 = vec3;

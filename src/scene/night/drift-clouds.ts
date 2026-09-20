import * as THREE from 'three/webgpu';
import { texture, uv, vec2, color, mix, smoothstep, float, time, luminance } from './tsl';
import { loadSRGB } from './palette';

/**
 * Weather in front of the painted skyline: two sheets of cloud that actually travel.
 *
 * The plate's own clouds are pixels and cannot move, and modulating their density in the plate shader only makes
 * banks thicken and thin in place — it is translation that reads as weather. Animating the painting itself was the
 * obvious answer and did not survive contact: conditioning a video model on the plate as both first and last frame
 * froze the clouds solid, and dropping the end frame bought motion at the cost of the plate's identity (see
 * air-traffic.ts). So the painting stays a painting, and the weather passes in front of it.
 *
 * The cloud band (`/night/backdrop/clouds.webp`, nano-banana-2, prompt design/night/prompts/cloud-band.txt) is
 * painted on black and keyed by its own luminance — no alpha channel to ship, and the black between banks costs
 * nothing. It was generated 4:1 and made to tile by cross-fading its right edge onto its left, so scrolling never
 * shows a seam (measured: 1.18 of 255 between the first and last column). Two layers at different depths, scales
 * and speeds give the sky parallax for two draws. Reduced motion holds `time` at 0, so they stand still.
 *
 * Kept faint on purpose. This is passing weather over the painting, not a replacement for it.
 */

/** Sheets span well past the frame at the bay vista and hang in the plate's sky band. */
const SHEETS = [
  { w: 2200, h: 520, y: 330, z: -545, repeat: 0.8, speed: 0.0022, density: 0.30, tint: 0x8c7d99 },
  { w: 1800, h: 420, y: 268, z: -496, repeat: 1.2, speed: 0.0038, density: 0.24, tint: 0xa08b9c },
];

export async function createDriftClouds() {
  const group = new THREE.Group();
  group.name = 'drift-clouds';
  const band = await loadSRGB('/night/backdrop/clouds.webp');
  band.wrapS = THREE.RepeatWrapping;
  band.wrapT = THREE.ClampToEdgeWrapping;
  for (const s of SHEETS) {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.fog = false;
    const scroll = vec2(uv().x.mul(s.repeat).add(time.mul(s.speed)), uv().y);
    const c = texture(band, scroll);
    // Feather every edge of the sheet, or its rectangle shows against the dome.
    const edge = smoothstep(0.0, 0.14, uv().x).mul(smoothstep(1.0, 0.86, uv().x))
      .mul(smoothstep(0.0, 0.22, uv().y)).mul(smoothstep(1.0, 0.8, uv().y));
    mat.colorNode = mix(c.rgb, color(s.tint), 0.35);
    // Black is sky, bright is cloud: the band keys itself.
    mat.opacityNode = luminance(c.rgb).mul(float(1.7)).clamp(0, 1).mul(edge).mul(s.density);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
    mesh.position.set(0, s.y, s.z);
    mesh.renderOrder = -9; // after the plate (−10), before the city
    group.add(mesh);
  }
  return group;
}

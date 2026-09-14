import * as THREE from 'three/webgpu';
import { rng } from './palette';

/**
 * Environment map for wet-surface reflections: a small procedural equirect (dark sky, a warm city
 * glow band at the horizon and a scatter of neon blobs) run through PMREM. Cheap, and it is what
 * makes puddles, glass and metal read as wet/glossy instead of flat.
 */
export function createEnvironment(renderer: THREE.WebGPURenderer) {
  const W = 512, H = 256;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#05060c');
  sky.addColorStop(0.42, '#0b0d1c');
  sky.addColorStop(0.5, '#3a1130');
  sky.addColorStop(0.56, '#1a0c1a');
  sky.addColorStop(1, '#040408');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);
  const r = rng(77);
  const tints = ['#00e5ff', '#ff2bd6', '#ff9a3d', '#f2ff3d', '#dfe8ff'];
  for (let i = 0; i < 90; i++) {
    const x = r() * W, y = H * (0.36 + r() * 0.2), rad = 2 + r() * 10;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const t = tints[Math.floor(r() * tints.length)];
    grad.addColorStop(0, t);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = 0.35 + r() * 0.5;
    g.fillStyle = grad;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromEquirectangular(tex).texture;
  pmrem.dispose();
  return env;
}

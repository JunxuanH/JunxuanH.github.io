import * as THREE from 'three/webgpu';
import { texture, uv, float, mix, step, hash, floor, time, color } from 'three/tsl';
import { loadSRGB } from './palette';

/** Neon sign material: buzzing brightness (fast hash gated by a slow one), alpha from the cutout. */
export function signMat(tex: THREE.Texture, id: number, tint = 0xffffff, gain = 3.2) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
  const t = texture(tex, uv());
  const slow = hash(float(id).add(floor(time.mul(0.5))));
  const buzz = mix(float(1), hash(float(id).add(floor(time.mul(30)))), step(0.88, slow));
  m.colorNode = t.rgb.mul(color(tint)).mul(gain).mul(buzz.mul(0.6).add(0.4));
  m.opacityNode = t.a;
  return m;
}

/** Canvas-rendered neon text (Rajdhani), white core with a coloured glow. */
export function canvasSign(text: string, col: string, w = 512, h = 160, font = '"Rajdhani", "Chakra Petch", "Impact", sans-serif') {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  let px = h * 0.55;
  g.font = `700 ${px}px ${font}`;
  const maxW = w * 0.88;
  if (g.measureText(text).width > maxW) { px *= maxW / g.measureText(text).width; g.font = `700 ${px}px ${font}`; }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = col; g.shadowBlur = h * 0.18;
  g.strokeStyle = col; g.lineWidth = h * 0.05;
  g.strokeText(text, w / 2, h / 2);
  g.shadowBlur = h * 0.06;
  g.fillStyle = '#ffffff';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let signId = 0;
/** Every neon mesh made here, so interact.ts can raycast/flicker them without a shared parent. */
export const signRegistry: THREE.Mesh[] = [];
/** Group-like view over the registry (interact.ts only needs `traverse`). */
export const signRegistryGroup = { traverse: (fn: (o: any) => void) => signRegistry.forEach(fn) } as unknown as THREE.Group;

/** A neon text sign mesh, `w` world units wide. */
export function neonText(text: string, col: string, w = 12, opts: { font?: string; gain?: number } = {}) {
  const t = canvasSign(text, col, 1024, 320, opts.font);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.3125), signMat(t, signId++, 0xffffff, opts.gain ?? 3.2));
  signRegistry.push(mesh);
  return mesh;
}

export interface SignSpot { x: number; y: number; z: number; yaw: number; w?: number }

/** Keyed cutout signs from public/night/signs at the given spots (skips any that fail to load).
 *  `files` are numbers (→ `sign-N.webp`) or names (→ `<name>.webp`). */
export async function createKeyedSigns(spots: SignSpot[], files: (number | string)[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) {
  const group = new THREE.Group();
  await Promise.all(spots.map(async (s, i) => {
    const f = files[i % files.length];
    try {
      const t = await loadSRGB(`/night/signs/${typeof f === 'number' ? `sign-${f}` : f}.webp`);
      const a = t.image.width / t.image.height;
      const w = s.w ?? 8;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w * a, w), signMat(t, 100 + i));
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.yaw;
      group.add(mesh);
      signRegistry.push(mesh);
    } catch { /* not generated */ }
  }));
  return group;
}

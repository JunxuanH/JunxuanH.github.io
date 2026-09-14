import * as THREE from 'three/webgpu';

/** Neon Harbor palette: blue-black ground, cyan holo UI, magenta signage, acid-yellow CTA, sodium haze. */
export const PAL = {
  cyan: 0x00e5ff,
  magenta: 0xff2bd6,
  yellow: 0xf2ff3d,
  sodium: 0xff9a3d,
  asphalt: 0x07070c,
  navy: 0x0b0d1c,
  plum: 0x3a1130,
} as const;

export type Tier = 'high' | 'med' | 'low';

export const params = new URLSearchParams(location.search);
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Deterministic LCG so the city is identical on every load. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pick<T>(tier: Tier, v: { high: T; med: T; low: T }) {
  return v[tier];
}

export const loader = new THREE.TextureLoader();
export const loadSRGB = (p: string) => loader.loadAsync(p).then((t) => { t.colorSpace = THREE.SRGBColorSpace; return t; });

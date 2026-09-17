import * as THREE from 'three/webgpu';
import { TERMINALS, type TerminalId } from './terminal-layout';

const ADS: Record<string, string> = {
  education: 'headphones',
  'amd-intern': 'headphones',
  kioxia: 'computer',
  'amd-dc': 'console',
  apple: 'camera',
  projects: 'console',
  // No `contact`: the departures board paints its own face (carriers/flapboard.ts).
};

/** Complete illustrated posters; preserve their lettering without an extra caption overlay. */
export function adCanvas(id: string, aspect = 0.65) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = Math.max(256, Math.round(1024 * aspect));
  const ctx = canvas.getContext('2d')!;
  const asset = ADS[id] ?? 'camera';
  let image: HTMLImageElement | undefined;
  const paint = () => {
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#09111e'; ctx.fillRect(0, 0, w, h);
    if (image) {
      // Keep the complete border and typography on differently proportioned carriers.
      const k = Math.min(w / image.width, h / image.height);
      ctx.drawImage(image, (w - image.width * k) / 2, (h - image.height * k) / 2, image.width * k, image.height * k);
    }
  };
  paint();
  return { canvas, load(onLoad: () => void) {
    const img = new Image();
    img.onload = () => { image = img; paint(); onLoad(); };
    img.src = `/night/ads/product-${asset}-v2.webp`;
  } };
}

export function terminalScreen(id: TerminalId) {
  const spec = TERMINALS[id];
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#0a121b'; ctx.fillRect(0, 0, 768, 512);
  ctx.strokeStyle = spec.accent; ctx.lineWidth = 4; ctx.strokeRect(20, 20, 728, 472);
  ctx.fillStyle = spec.accent; ctx.font = '24px monospace'; ctx.fillText('NEON HARBOR / PUBLIC ACCESS', 48, 82);
  ctx.fillStyle = '#eef0e7'; ctx.font = 'bold 66px monospace'; ctx.fillText(spec.label, 48, 205);
  ctx.fillStyle = spec.accent; ctx.font = '30px monospace'; ctx.fillText(spec.subtitle, 48, 265);
  ctx.fillRect(48, 330, 672, 2); ctx.font = '28px monospace'; ctx.fillText('[ F ]  OPEN TERMINAL', 48, 408);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicNodeMaterial({ map: texture }));
}

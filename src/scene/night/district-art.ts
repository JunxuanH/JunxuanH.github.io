import * as THREE from 'three/webgpu';
import { TERMINALS, type TerminalId } from './terminal-layout';

const ADS: Record<string, [string, string, string]> = {
  education: ['research', 'NIGHT SCHOOL', 'IDEAS AFTER DARK'],
  'amd-intern': ['compute', 'VECTOR SYSTEMS', 'COMPUTE WITHOUT LIMITS'],
  kioxia: ['compute', 'MEMORY / CORE', 'BUILT FOR TOMORROW'],
  'amd-dc': ['harbor', 'ORBIT FREIGHT', 'CITY TO STRATOSPHERE'],
  apple: ['research', 'SYNTH LAB', 'ENGINEER THE NEXT'],
  projects: ['arcade', 'AFTER HOURS', 'PLAY / BUILD / REPEAT'],
  contact: ['harbor', 'PIER 9', 'THE NEXT HORIZON'],
};

/** Static, bounded-brightness art. Text stays code-rendered; no extra video or shader animation. */
export function adCanvas(id: string, aspect = 0.65) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024; canvas.height = Math.max(256, Math.round(1024 * aspect));
  const ctx = canvas.getContext('2d')!;
  const [asset, title, subtitle] = ADS[id] ?? ADS.contact;
  let image: HTMLImageElement | undefined;
  const paint = () => {
    const { width: w, height: h } = canvas;
    ctx.fillStyle = '#09111e'; ctx.fillRect(0, 0, w, h);
    if (image) {
      const k = Math.max(w / image.width, h / image.height);
      ctx.drawImage(image, (w - image.width * k) / 2, (h - image.height * k) / 2, image.width * k, image.height * k);
    }
    // Shade only the caption area; the old gradient darkened most of the illustration.
    const gradient = ctx.createLinearGradient(0, h * 0.72, 0, h);
    gradient.addColorStop(0, 'transparent'); gradient.addColorStop(1, 'rgba(5, 11, 24, 0.78)');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e3e8e8'; ctx.font = 'bold 64px monospace'; ctx.fillText(title, 44, h - 72);
    ctx.fillStyle = '#82d6da'; ctx.font = '22px monospace'; ctx.fillText(subtitle, 48, h - 32);
  };
  paint();
  return { canvas, load(onLoad: () => void) {
    const img = new Image();
    img.onload = () => { image = img; paint(); onLoad(); };
    img.src = `/night/ads/terminal-${asset}-v1.webp`;
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
  ctx.fillRect(48, 330, 672, 2); ctx.font = '28px monospace'; ctx.fillText('[ E ]  OPEN TERMINAL', 48, 408);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(3, 2), new THREE.MeshBasicNodeMaterial({ map: texture }));
}

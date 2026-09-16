import * as THREE from 'three/webgpu';
import { texture, uv, float, step, fract, hash, floor, time, vec2, uniform } from './tsl';
import { PAL, params, loadSRGB } from './palette';

export interface AdSpot { x: number; y: number; z: number; yaw?: number; h?: number; mounted?: boolean }

/** Holographic ad panel material: scanlines + occasional glitch offset, additive-looking brightness. */
export function adMaterial(t: THREE.Texture, id: number) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });
  const scan = step(0.5, fract(uv().y.mul(90).add(time.mul(8)))).mul(0.12).add(0.88);
  const glitch = step(0.97, hash(floor(time.mul(6)).add(uniform(id)))).mul(hash(floor(uv().y.mul(24)).add(time)).sub(0.5)).mul(0.04);
  const s = texture(t, uv().add(vec2(glitch, 0)));
  m.colorNode = s.rgb.mul(scan).mul(2.4);
  m.opacityNode = float(0.85);
  return m;
}

/** Hovering holo ads (9:16) with a cyan frame; bob and drift in update(). */
export async function createAds(spots: AdSpot[], files = ['ad-1', 'ad-2', 'ad-3', 'ad-4']) {
  const group = new THREE.Group();
  const items: { mesh: THREE.Mesh; base: THREE.Vector3; phase: number }[] = [];
  await Promise.all(spots.map(async (sp, i) => {
    const name = files[i % files.length];
    try {
      let t: THREE.Texture = await loadSRGB(`/night/ads/${name}.webp`);
      if (!params.has('novideo')) {
        // Only ad-3 shipped with a video loop; probing the others just logs 404s.
        const ok = name === 'ad-3' && await fetch(`/night/ads/${name}-loop.mp4`, { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
        if (ok) {
          const v = document.createElement('video');
          Object.assign(v, { src: `/night/ads/${name}-loop.mp4`, muted: true, loop: true, playsInline: true, autoplay: true });
          await v.play().catch(() => {});
          const vt = new THREE.VideoTexture(v);
          vt.colorSpace = THREE.SRGBColorSpace;
          t = vt;
        }
      }
      const h = sp.h ?? 14.4;
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(h * 9 / 16, h), adMaterial(t, i));
      frame.position.set(sp.x, sp.y, sp.z);
      frame.rotation.y = sp.yaw ?? (sp.x < 0 ? 0.35 : -0.35);
      const edge = new THREE.Mesh(
        new THREE.PlaneGeometry(h * 9 / 16 + 0.3, h + 0.3),
        new THREE.MeshBasicNodeMaterial({ color: PAL.cyan, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
      );
      edge.position.z = -0.02;
      frame.add(edge);
      group.add(frame);
      if(sp.mounted) {
        const backing=new THREE.Mesh(new THREE.BoxGeometry(h*9/16+.5,h+.5,.16),
          new THREE.MeshStandardNodeMaterial({color:0x111c27,roughness:.7,metalness:.3}));
        backing.position.z=-.1;frame.add(backing);
      } else items.push({ mesh: frame, base: frame.position.clone(), phase: i * 1.7 });
    } catch { /* not generated */ }
  }));
  const update = (t: number) => {
    for (const a of items) {
      a.mesh.position.y = a.base.y + Math.sin(t * 0.7 + a.phase) * 0.6;
      a.mesh.position.x = a.base.x + Math.sin(t * 0.3 + a.phase) * 0.4;
    }
  };
  return { group, update, count: group.children.length };
}

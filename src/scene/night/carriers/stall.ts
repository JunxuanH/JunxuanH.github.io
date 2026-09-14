/**
 * Market holo stall: a vendor's counter with a projector puck; the Flip-3D project cards (CSS3D, mounted
 * by content.ts under `mount`) rise out of its light cone when the projects window opens.
 * Stands at the east end of the market street, facing the camera's approach from the west.
 */
import * as THREE from 'three/webgpu';
import { color, uv, fract, step, float, mix, time, hash, floor, smoothstep } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { THEMES } from '../theme';
import { neonText } from '../signs';
import type { Carrier, CarrierCtx } from './index';

const POS = new THREE.Vector3(72, 0.22, -227);
const YAW = -Math.PI / 2 + 0.55;      // stack faces west-south-west, toward the dwell camera at (62.5, 4.6, -224.6)
const CARD_BOTTOM = 3.1;              // front card's lower edge (content.ts mounts cards at y 6.6 ± 3.5)

export function create(ctx: CarrierCtx): Carrier {
  const T = THEMES.projects;
  const group = new THREE.Group();
  group.position.copy(POS);
  group.rotation.y = YAW;

  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1a1e2c, roughness: 0.6, metalness: 0.4 });
  const neon = (tint: number, gain: number) => { const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = color(tint).mul(gain); return m; };

  // Counter + four posts + top rails (roofless so the cone passes through), crates beside it.
  const counter = new THREE.Mesh(new THREE.BoxGeometry(4.4, 1.0, 2.6).translate(0, 0.5, 0), dark);
  const postGeo = new THREE.CylinderGeometry(0.06, 0.06, 3.0, 8).translate(0, 1.5, 0);
  const posts = new THREE.InstancedMesh(postGeo, dark, 4);
  [[-2.1, -1.2], [2.1, -1.2], [-2.1, 1.2], [2.1, 1.2]].forEach(([x, z], i) => posts.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, 0, z)));
  const rails = mergeGeometries([
    new THREE.BoxGeometry(4.3, 0.08, 0.08).translate(0, 3.0, -1.2), new THREE.BoxGeometry(4.3, 0.08, 0.08).translate(0, 3.0, 1.2),
    new THREE.BoxGeometry(0.08, 0.08, 2.5).translate(-2.1, 3.0, 0), new THREE.BoxGeometry(0.08, 0.08, 2.5).translate(2.1, 3.0, 0),
    new THREE.BoxGeometry(4.6, 0.08, 0.08).translate(0, 1.02, 1.32), // warm counter lip
  ], false)!;
  const railMesh = new THREE.Mesh(rails, neon(T.primary, 1.6));
  const crateGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7).translate(0, 0.35, 0);
  const crates = new THREE.InstancedMesh(crateGeo, new THREE.MeshStandardNodeMaterial({ color: 0x2a2320, roughness: 0.9 }), 3);
  [[-2.9, 0.3, 0], [-2.9, 0.3, -0.75], [-2.85, 1.0, -0.35]].forEach(([x, z, y], i) => crates.setMatrixAt(i, new THREE.Matrix4().makeTranslation(x, y, z)));
  // Noren (red/white stripes) hung from the back rail.
  const norenMat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
  norenMat.colorNode = mix(color(0xb8281c), color(0xf2ece0), step(0.5, fract(uv().x.mul(4)))).mul(0.9);
  const noren = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.0), norenMat);
  noren.position.set(0, 2.45, -1.2);
  const sign = neonText('ホロ屋', T.signGlow, 1.8, { gain: 2 });
  sign.position.set(0, 2.55, 1.26);
  group.add(counter, posts, railMesh, crates, noren, sign);

  // Projector puck + ring on the counter; the additive cone reaches the front card's bottom edge.
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.22, 24).translate(0, 1.11, 0), dark);
  const ringGain = new THREE.Vector3(1.6, 0, 0);
  const ringMat = new THREE.MeshBasicNodeMaterial();
  ringMat.colorNode = color(T.secondary).mul(2.4);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.05, 6, 40).rotateX(Math.PI / 2).translate(0, 1.24, 0), ringMat);
  const coneH = CARD_BOTTOM - 1.55;
  const coneMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const buzz = mix(float(1), hash(floor(time.mul(24))), step(0.92, hash(floor(time.mul(0.6)))));
  coneMat.colorNode = color(T.secondary);
  coneMat.opacityNode = smoothstep(0, 1, uv().y).mul(0.2).mul(buzz);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(3.6, coneH, 40, 1, true).rotateX(Math.PI).translate(0, coneH / 2, 0), coneMat);
  cone.position.y = 1.55;
  cone.scale.y = 0.001;
  group.add(puck, ring, cone);

  // Cards mount here: the stack root sits above the counter, facing the same way as the group.
  const mount = new THREE.Object3D();
  mount.position.set(0, 6.6, 0);
  group.add(mount);

  const rise = (open: boolean) => {
    gsap.killTweensOf(cone.scale);
    if (ctx.reducedMotion) { cone.scale.y = open ? 1 : 0.001; return; }
    gsap.to(cone.scale, { y: open ? 1 : 0.001, duration: open ? 0.5 : 0.3, ease: 'power2.out' });
    if (open) { gsap.killTweensOf(ringGain); gsap.fromTo(ringGain, { x: 2.4 }, { x: 1.6, duration: 1.2, ease: 'power2.out' }); }
  };

  return {
    group, mount, width: 8, px: 640, style: '',
    range: [0.55, 0.95],
    lights: [[72, 3.5, -226, T.secondary, 500, 16]],
    rise,
  };
}

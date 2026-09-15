/**
 * Things the protagonist can use: the four résumé terminals (carriers/index.ts TERMINALS; anchor = the kiosk's
 * mount), the four taxi pads that pan to the next stop, and the landed hover car at the pier (the ride back to the
 * vista). Each frame the nearest one in range drives the HUD prompt and a flicker on its neon (interact.ts's
 * `attachHot` on the emissive materials); `F` runs its action, taxi pads also fire when stepped on. The pads are
 * built here.
 */
import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { color, time, sin, float, uv, length, smoothstep } from './tsl';
import { neonText } from './signs';
import { attachHot } from './interact';
import { PAL, reducedMotion } from './palette';
import { THEMES } from './theme';
import { EXITS, type Nav, type DockId } from './nav';
import { CARRIER_SECTION, type Carrier, type CarrierId } from './carriers/index';
import type { WalkSection } from './walkable';

export interface Interactable {
  id: string;
  section: WalkSection;
  anchor: THREE.Vector3;
  radius: number;
  label: string;
  action(): void;
  /** Fires without a key press when the player is this close (taxi pads). */
  auto?: number;
  /** Flicker uniforms on the highlighted neon. */
  hot: { value: number }[];
}

export interface InteractablesOptions {
  scene: THREE.Scene;
  carriers: Partial<Record<CarrierId, Carrier>>;
  nav: Nav;
  prompt(label: string | null): void;
  landingCar?: THREE.Object3D | null;
}


const glow = (tint: number, gain: number) => { const m = new THREE.MeshBasicNodeMaterial(); m.colorNode = color(tint).mul(gain); return m; };
const noReflect = (o: THREE.Object3D) => o.traverse((c) => c.layers.set(1));

/** Pulsing ground ring: marks a spot to stand on. */
function ring(tint: number, r: number) {
  const g = new THREE.Group();
  const torus = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 6, 40).rotateX(Math.PI / 2), glow(tint, 1.8));
  torus.position.y = 0.05;
  const discMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  discMat.colorNode = color(tint);
  discMat.opacityNode = float(1).sub(smoothstep(0.3, 0.5, length(uv().sub(0.5)))).mul(sin(time.mul(2.4)).mul(0.08).add(0.16));
  const disc = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2).rotateX(-Math.PI / 2), discMat);
  disc.position.y = 0.04;
  disc.renderOrder = 3;
  g.add(torus, disc);
  return g;
}

/** Taxi pad: yellow ring + a post carrying a neon "→ NEXT STOP" sign facing `yaw`. */
function taxiPad(label: string, yaw: number) {
  const g = ring(PAL.yellow, 1.5);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.5, 8).translate(0, 1.25, 0), new THREE.MeshStandardNodeMaterial({ color: 0x14161f, roughness: 0.5, metalness: 0.7 }));
  post.position.set(Math.cos(yaw), 0, -Math.sin(yaw)).multiplyScalar(1.7); // beside the ring, along the sign's right-hand axis
  const sign = neonText(`→ ${label}`, '#f2ff3d', 2.6, { gain: 2.4 });
  sign.position.set(post.position.x, 2.75, post.position.z);
  sign.rotation.y = yaw;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), glow(PAL.yellow, 2.2));
  cap.position.set(post.position.x, 2.55, post.position.z);
  g.add(post, sign, cap);
  return g;
}

/** Emissive (MeshBasicNodeMaterial with a colorNode) meshes of a carrier: the neon that flickers when it's the target. */
function neonOf(root: THREE.Object3D): { value: number }[] {
  const out: { value: number }[] = [];
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (!m?.isMeshBasicNodeMaterial || !m.colorNode || m.transparent) return;
    const hot = attachHot(o);
    if (hot && !out.includes(hot)) out.push(hot);
  });
  return out;
}

export function createInteractables(opts: InteractablesOptions) {
  const { nav } = opts;
  const group = new THREE.Group();
  group.name = 'interactables';
  const items: Interactable[] = [];
  const tmp = new THREE.Vector3();

  // ---- terminals
  for (const [key, c] of Object.entries(opts.carriers) as [CarrierId, Carrier][]) {
    if (!c?.terminal) continue;
    const anchor = new THREE.Vector3();
    c.mount.updateWorldMatrix(true, false); c.mount.getWorldPosition(anchor);
    items.push({
      id: key, section: CARRIER_SECTION[key] as WalkSection, anchor, radius: key === 'education' ? 12 : 6,
      label: `Open ${c.node?.replace(' TERMINAL', '').toLowerCase()} terminal`, hot: neonOf(c.group),
      action: () => nav.dock(key as DockId),
    });
  }
  // ---- taxi pads
  for (const [sec, ex] of Object.entries(EXITS) as [WalkSection, (typeof EXITS)[WalkSection]][]) {
    const pad = taxiPad(ex.label, ex.yaw);
    pad.position.fromArray(ex.pos);
    group.add(pad);
    items.push({
      id: `exit-${sec}`, section: sec, anchor: pad.position, radius: 6, auto: 1.5,
      label: `Hail a ride → ${ex.next === 'city' ? 'the vista' : THEMES[ex.next as WalkSection].name}`, hot: neonOf(pad),
      action: () => nav.panTo(ex.next),
    });
  }
  // ---- the landed hover car (interact.ts lands it on the pad at Contact)
  if (opts.landingCar) {
    items.push({
      id: 'ride-home', section: 'contact', anchor: new THREE.Vector3(140, 2.9, 20), radius: 6, label: 'Board the ride → the vista', hot: [],
      action: () => nav.panTo('city'),
    });
  }
  // The pier is mirrored by the water; everything else stays off the reflector.
  for (const child of group.children) if (child.position.x < 100) noReflect(child);
  opts.scene.add(group);

  let current: Interactable | null = null, shownLabel: string | null = null;
  const setHot = (it: Interactable, v: number, burst: boolean) => {
    for (const h of it.hot) {
      gsap.killTweensOf(h);
      if (reducedMotion) { h.value = 0; continue; }
      if (burst) { h.value = 1; gsap.to(h, { value: v, duration: 0.45, ease: 'steps(6)' }); } else h.value = v;
    }
  };
  const setCurrent = (it: Interactable | null, suppressPrompt = false) => {
    if (it !== current) {
      if (current) setHot(current, 0, false);
      current = it;
      if (it) setHot(it, 0.18, true);
    }
    // The prompt is edge-published; while suppressed (a resident is nearer: dialogue.ts owns the slot) it reads null.
    const label = it && !suppressPrompt ? it.label : null;
    if (label !== shownLabel) { shownLabel = label; opts.prompt(label); }
  };

  /**
   * Per frame in walk mode: pick the nearest item of the section in range (horizontal distance from the player),
   * highlight it, and act on `E` or on stepping onto a pad. Pass `section = null` outside walk mode. `suppressPrompt`
   * keeps the highlight but publishes no label (the dialogue's "Talk to …" is showing instead).
   */
  function update(player: THREE.Vector3 | null, pressed: boolean, section: WalkSection | null, suppressPrompt = false) {
    if (!section || !player) { setCurrent(null); return; }
    let best: Interactable | null = null, bestD = Infinity;
    for (const it of items) {
      if (it.section !== section) continue;
      if (it.id === 'ride-home' && !(opts.landingCar?.visible)) continue;
      tmp.set(it.anchor.x - player.x, 0, it.anchor.z - player.z);
      const d = tmp.length();
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    setCurrent(best, suppressPrompt);
    if (!best) return;
    if ((best.auto !== undefined && bestD < best.auto) || pressed) best.action();
  }

  return { group, items, update, get current() { return current; } };
}

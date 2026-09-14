/**
 * Things the protagonist can use: the seven résumé carriers (anchor = mount, or a viewing spot for the LED
 * wall and a telescope for the blimp), the four taxi pads that pan to the next stop, and the landed hover
 * car at the pier (the ride back to the vista). Each frame the nearest one in range drives the HUD prompt and
 * a flicker on the carrier's neon (interact.ts's `attachHot` on its emissive materials); `E` runs its action,
 * taxi pads also fire when stepped on. The pads, the telescope and the viewing rings are built here.
 */
import * as THREE from 'three/webgpu';
import gsap from 'gsap';
import { color, time, sin, float, uv, length, smoothstep } from './tsl';
import { neonText } from './signs';
import { attachHot } from './interact';
import { PAL, reducedMotion } from './palette';
import { THEMES } from './theme';
import { EXITS, type Nav, type DockId } from './nav';
import type { Carrier, CarrierId } from './carriers/index';
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

const CARRIER_SECTION: Record<CarrierId, WalkSection> = {
  education: 'education', 'amd-intern': 'work', kioxia: 'work', 'amd-dc': 'work', apple: 'work', projects: 'projects', contact: 'contact',
};
const LABELS: Record<CarrierId, string> = {
  education: 'Read the terminal', 'amd-intern': 'Read the poster', kioxia: 'Watch the wall', 'amd-dc': 'Use the telescope',
  apple: 'Inspect the hologram', projects: 'Browse the stall', contact: 'Check departures',
};
/** Ground anchors that are not the carrier's mount: the LED-wall viewing spot and the blimp telescope. */
const GROUND_ANCHOR: Partial<Record<CarrierId, [number, number, number]>> = {
  kioxia: [-15, 0.22, -112],
  'amd-dc': [-15.5, 0.22, -160],
};

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

/** Coin telescope on a post, aimed at the blimp's home pose; cyan trim ring on the tube. */
function telescope(aimAt: THREE.Vector3, at: THREE.Vector3) {
  const g = new THREE.Group();
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x1a1e2c, roughness: 0.45, metalness: 0.7 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, 0.5).translate(0, 0.04, 0), metal);
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.25, 10).translate(0, 0.08 + 0.625, 0), metal);
  const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 1.42, 0), metal);
  const head = new THREE.Group();
  head.position.y = 1.42;
  const d = aimAt.clone().sub(at);
  head.rotation.y = Math.atan2(d.x, d.z);
  head.rotation.x = -Math.atan2(d.y, Math.hypot(d.x, d.z));
  const tube = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.7).translate(0, 0, 0.2), metal);
  const trim = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 20), glow(PAL.cyan, 2.2));
  trim.position.z = 0.55;
  const slot = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 0.1), glow(PAL.cyan, 1.6));
  slot.position.set(0, 0.09, -0.1);
  head.add(tube, trim, slot);
  g.add(base, pillar, yoke, head);
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

  // ---- carriers
  for (const [key, c] of Object.entries(opts.carriers) as [CarrierId, Carrier][]) {
    if (!c) continue;
    const ga = GROUND_ANCHOR[key];
    const anchor = new THREE.Vector3();
    if (ga) anchor.fromArray(ga); else { c.mount.updateWorldMatrix(true, false); c.mount.getWorldPosition(anchor); }
    let hot = neonOf(c.group);
    if (key === 'amd-dc') {
      const scope = telescope(new THREE.Vector3(-2.5, 40, -158), anchor);
      scope.position.copy(anchor);
      group.add(scope);
      hot = neonOf(scope);
    } else if (key === 'kioxia') {
      const spot = ring(PAL.cyan, 0.9);
      spot.position.copy(anchor);
      group.add(spot);
      hot = [...neonOf(spot), ...hot];
    }
    items.push({
      id: key, section: CARRIER_SECTION[key], anchor, radius: key === 'amd-dc' ? 3 : 6,
      label: c.interact?.label ?? LABELS[key], hot,
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

  let current: Interactable | null = null;
  const setHot = (it: Interactable, v: number, burst: boolean) => {
    for (const h of it.hot) {
      gsap.killTweensOf(h);
      if (reducedMotion) { h.value = 0; continue; }
      if (burst) { h.value = 1; gsap.to(h, { value: v, duration: 0.45, ease: 'steps(6)' }); } else h.value = v;
    }
  };
  const setCurrent = (it: Interactable | null) => {
    if (it === current) return;
    if (current) setHot(current, 0, false);
    current = it;
    if (it) setHot(it, 0.18, true);
    opts.prompt(it ? it.label : null);
  };

  /**
   * Per frame in walk mode: pick the nearest item of the section in range (horizontal distance from the player),
   * highlight it, and act on `E` or on stepping onto a pad. Pass `section = null` outside walk mode.
   */
  function update(player: THREE.Vector3 | null, pressed: boolean, section: WalkSection | null) {
    if (!section || !player) { setCurrent(null); return; }
    let best: Interactable | null = null, bestD = Infinity;
    for (const it of items) {
      if (it.section !== section) continue;
      if (it.id === 'ride-home' && !(opts.landingCar?.visible)) continue;
      tmp.set(it.anchor.x - player.x, 0, it.anchor.z - player.z);
      const d = tmp.length();
      if (d < it.radius && d < bestD) { best = it; bestD = d; }
    }
    setCurrent(best);
    if (!best) return;
    if ((best.auto !== undefined && bestD < best.auto) || pressed) best.action();
  }

  return { group, items, update, get current() { return current; } };
}

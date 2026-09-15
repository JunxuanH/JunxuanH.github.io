/**
 * Market holo stall: a vendor's counter with a projector puck; the projects board (a directory listing painted
 * by content.ts under `mount`) hangs in its light cone, which rises when the projects window opens.
 * Stands at the east end of the market street, facing the camera's approach from the west.
 */
import * as THREE from 'three/webgpu';
import { color, uv, fract, step, float, mix, time, hash, floor, smoothstep, glowMaterial } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { THEMES } from '../theme';
import { neonText } from '../signs';
import { sfx } from '../audio';
import { keyToAction, setSel, hint, clearHint, retrigger, type DockActions } from './dock';
import type { Carrier, CarrierCtx } from './index';

const POS = new THREE.Vector3(72, 0.22, -227);
const YAW = -Math.PI / 2 + 0.55;      // board faces west-south-west, toward the dwell camera at (62.5, 4.6, -224.6)
const CARD_BOTTOM = 3.1;              // board's lower edge (fit() centres the mount above it)

export function create(ctx: CarrierCtx): Carrier {
  const T = THEMES.projects;
  const group = new THREE.Group();
  group.position.copy(POS);
  group.rotation.y = YAW;

  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x1a1e2c, roughness: 0.6, metalness: 0.4 });
  const neon = glowMaterial;

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

  // Projector puck + ring on the counter; the additive cone reaches the board's bottom edge.
  const puck = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, 0.22, 24).translate(0, 1.11, 0), dark);
  const ringGain = new THREE.Vector3(1.6, 0, 0);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.65, 0.05, 6, 40).rotateX(Math.PI / 2).translate(0, 1.24, 0), glowMaterial(T.secondary, 2.4));
  const coneH = CARD_BOTTOM - 1.55;
  const coneMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const buzz = mix(float(1), hash(floor(time.mul(24))), step(0.92, hash(floor(time.mul(0.6)))));
  coneMat.colorNode = color(T.secondary);
  coneMat.opacityNode = smoothstep(0, 1, uv().y).mul(0.2).mul(buzz);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, coneH, 40, 1, true).rotateX(Math.PI).translate(0, coneH / 2, 0), coneMat);
  cone.position.y = 1.55;
  cone.scale.y = 0.001;
  group.add(puck, ring, cone);

  // The board mounts here, above the counter, facing the same way as the group (fit() lifts it to sit on the cone).
  const mount = new THREE.Object3D();
  mount.position.set(0, 6.6, 0);
  group.add(mount);

  const rise = (open: boolean) => {
    gsap.killTweensOf(cone.scale);
    if (ctx.reducedMotion) { cone.scale.y = open ? 1 : 0.001; return; }
    gsap.to(cone.scale, { y: open ? 1 : 0.001, duration: open ? 0.5 : 0.3, ease: 'power2.out' });
    if (open) { gsap.killTweensOf(ringGain); gsap.fromTo(ringGain, { x: 2.4 }, { x: 1.6, duration: 1.2, ease: 'power2.out' }); }
  };

  // ---- dock: the projects are a directory listing (one row per card, `.is-sel` cursor); ↑/↓ move, Enter opens the row's
  // detail view (screenshot, description, stack, the repo link), Enter again opens the repo in a new tab (public) or
  // pulses the "showcase only" line (private); Esc / ◀ go back to the list. Esc in the list is left to the nav (undock).
  let stack: HTMLElement | null = null, cards: HTMLElement[] = [], sel = 0, detail = false;
  const listHint = () => { if (stack) hint(stack, '<kbd>↑</kbd><kbd>↓</kbd> select · <kbd>Enter</kbd> open · <kbd>Esc</kbd> back'); };
  const detailHint = () => {
    if (!stack) return;
    const pub = !!cards[sel]?.querySelector('.links a');
    hint(stack, pub ? '<kbd>Enter</kbd> open repo ↗ · <kbd>Esc</kbd> list' : '<b>PRIVATE</b> showcase only · <kbd>Esc</kbd> list');
  };
  const move = (d: number) => {
    if (!cards.length || detail) return;
    sel = (sel + d + cards.length) % cards.length;
    setSel(cards, sel);
    sfx.select();
  };
  const closeDetail = () => {
    if (!detail || !stack) return;
    detail = false;
    stack.classList.remove('is-detail');
    cards.forEach((c) => c.classList.remove('is-open', 'is-in'));
    listHint();
  };
  const confirm = () => {
    const card = cards[sel];
    if (!card || !stack) return;
    if (!detail) {
      detail = true;
      stack.classList.add('is-detail');
      card.classList.add('is-open');
      retrigger(card, 'is-in');
      detailHint();
      sfx.confirm();
      return;
    }
    const link = card.querySelector<HTMLAnchorElement>('.links a');
    if (link) { window.open(link.href, '_blank', 'noopener'); sfx.confirm(); return; }
    const badge = card.querySelector<HTMLElement>('.links .muted') ?? card.querySelector<HTMLElement>('h3 small');
    if (badge) retrigger(badge, 'is-pulse');
    sfx.select();
  };
  const actions: DockActions = { up: () => move(-1), down: () => move(1), left: () => { if (detail) { closeDetail(); sfx.select(); } }, confirm };

  return {
    group, mount, width: 4.8, px: 720, style: '', node: 'HOLO STALL',
    range: [0.55, 0.95],
    lights: [[72, 3.5, -226, T.secondary, 500, 16]],
    rise,
    fit(h) {
      // The board's bottom edge sits on the cone's top; the centre rises with the painted height.
      mount.position.y = CARD_BOTTOM + h / 2;
    },
    interact: {
      onEnter(el) {
        stack = el;
        cards = [...el.querySelectorAll<HTMLElement>('.card')];
        sel = 0; detail = false;
        setSel(cards, sel);
        listHint();
      },
      onExit(el) {
        closeDetail();
        setSel(cards, -1);
        for (const c of cards) { c.querySelector('h3 small')?.classList.remove('is-pulse'); c.querySelector('.links .muted')?.classList.remove('is-pulse'); }
        clearHint(el);
        stack = null; cards = []; detail = false;
      },
      onKey(e) {
        if (e.key === 'Escape') { if (!detail) return false; closeDetail(); sfx.select(); return true; }
        return keyToAction(e, actions);
      },
      actions,
    },
  };
}

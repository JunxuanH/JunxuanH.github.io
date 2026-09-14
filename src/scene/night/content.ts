/**
 * Résumé content in the scene: the DOM slabs from index.astro (education, four jobs, contact) are
 * mounted as CSS3D objects on their carriers (carriers/*: terminal kiosk, bus-stop poster, LED wall,
 * blimp banner, hologram, departures board) and the project cards form a Flip-3D stack rising out of
 * the market's holo stall. In ride mode each slab has a p window (data-window="a,b") during which it is
 * visible; on foot it fades in by proximity to its carrier, and in dock mode only the docked slab shows
 * (`dock` / `undock` / `onKey`). On phones the same elements live in a bottom sheet instead.
 */
import * as THREE from 'three/webgpu';
import { CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import gsap from 'gsap';
import { ANCHORS, followWeight, type SectionId } from './journey';
import { params, reducedMotion, type Tier } from './palette';
import { createCarriers, type Carrier, type CarrierId, type CarrierCtx } from './carriers/index';
import type { DistrictTextures } from './districts/shared';
import type { Mode } from './nav';
import { DOCK_EVENT, UNDOCK_EVENT, type DockEventDetail } from './hud';
import { paintSlab, slabFontsReady } from './slabcanvas';

export interface ContentOptions {
  scene: THREE.Scene;
  narrow: boolean;
  tier: Tier;
  tex: DistrictTextures;
  people: boolean;
  onFlap?: () => void;
}

/**
 * What the visitor is doing this frame (nav.ts). `ride` = slabs fade by their p windows as before; `walk` = each slab
 * fades by the player's horizontal distance to its carrier mount; `dock` = only the docked slab, fully on.
 */
export interface ContentView {
  mode: Mode;
  /** Section whose carriers stay drawn whatever p says (walk / dock); undefined in ride mode. */
  section?: SectionId;
  docked: CarrierId | null;
  /** Player feet position (walk mode). */
  player: THREE.Vector3 | null;
}

/** `board`: the phone stand-in (a canvas painting of the slab on its carrier, slabcanvas.ts); the element itself is in the sheet. */
interface Slab { id: string; el: HTMLElement; carrier?: Carrier; win: [number, number]; on: boolean; cueArmed: boolean; board?: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial> }

const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const FADE = 0.012;
/** Walk-mode proximity fade per carrier: [full at, gone at] horizontal distance (u). Big high carriers read from further. */
const WALK_RANGE: Partial<Record<string, [number, number]>> = { kioxia: [40, 70], 'amd-dc': [20, 45] };
const WALK_DEFAULT: [number, number] = [6, 14];

/** Card slots in the stack's local frame (0 = front). */
const SLOT = (k: number) => ({ x: k * 1.5, y: k * 0.45, z: -k * 2.0, ry: -k * 0.1 });
const CARD_W = 10, CARD_PX = 640;

/** Where a slab goes if its carrier module is missing (the pre-carrier placements). */
const SIGN_YAW = (x: number) => (x < 0 ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35);
function fallbackMount(id: string): { obj: THREE.Object3D; w: number; px: number } | null {
  const c = ANCHORS.campus;
  const at = (pos: THREE.Vector3, yaw: number) => { const o = new THREE.Object3D(); o.position.copy(pos); o.rotation.y = yaw; return o; };
  const jobs = ['amd-intern', 'kioxia', 'amd-dc', 'apple'];
  if (id === 'education') return { obj: at(new THREE.Vector3(c.x, 4.9, c.z - 11 + 0.35), 0), w: 15, px: 760 };
  if (id === 'contact') return { obj: at(new THREE.Vector3(ANCHORS.pad.x, 6.0, ANCHORS.pad.z + 11.6), Math.PI), w: 13, px: 680 };
  if (id === 'projects') return { obj: at(new THREE.Vector3(ANCHORS.market.x + 22, 6.2, ANCHORS.market.z + 1), -Math.PI / 2 + 0.55), w: CARD_W, px: CARD_PX };
  const i = jobs.indexOf(id);
  if (i < 0) return null;
  const p = ANCHORS.workSigns[i], yaw = SIGN_YAW(p.x);
  return { obj: at(p.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 0.35), yaw), w: 14, px: 760 };
}

export async function createContent(opts: ContentOptions) {
  const { scene, narrow } = opts;
  const carriers = await createCarriers({ scene, tier: opts.tier, tex: opts.tex, people: opts.people, reducedMotion, onFlap: opts.onFlap } satisfies CarrierCtx);
  scene.add(carriers.group);
  const slabs: Slab[] = [];
  // `?noslabs` keeps the carriers but mounts no DOM (perf bisecting).
  const els = params.has('noslabs') ? [] : [...document.querySelectorAll<HTMLElement>('[data-slab]')];
  const winOf = (el: HTMLElement) => (el.dataset.window || '0,0').split(',').map(Number) as [number, number];
  const sheet = document.querySelector<HTMLElement>('.sheet');
  if (narrow && els.length) await slabFontsReady();

  // ---- mount as CSS3D (desktop) or into the bottom sheet (narrow)
  const mount = (el: HTMLElement, widthU: number, pxWidth: number, parent: THREE.Object3D, local?: { x: number; y: number; z: number; ry: number }) => {
    el.style.width = `${pxWidth}px`;
    const obj = new CSS3DObject(el);
    obj.scale.setScalar(widthU / pxWidth);
    if (local) { obj.position.set(local.x, local.y, local.z); obj.rotation.y = local.ry; }
    parent.add(obj);
    return obj;
  };
  const parentFor = (id: string): { parent: THREE.Object3D; w: number; px: number; carrier?: Carrier } | null => {
    const c = carriers.byId[id as CarrierId];
    if (c) return { parent: c.mount, w: c.width, px: c.px, carrier: c };
    const fb = fallbackMount(id);
    if (!fb) return null;
    scene.add(fb.obj);
    return { parent: fb.obj, w: fb.w, px: fb.px };
  };

  // ---- project stack
  const cards: { el: HTMLElement; obj?: CSS3DObject; slot: number }[] = [];
  let stackEl: HTMLElement | null = null;
  let stackWin: [number, number] = [0, 0];
  let stackRoot: THREE.Object3D | null = null;
  let stallCarrier: Carrier | undefined;
  let active = 0, override: number | null = null, lastSlotP = -1;
  let stallOn = false; // phones: the stall's projector cone follows the cards' visibility (edge-triggered)

  // ---- phone sheet: the stack is a horizontal snap-scroller. ◀ ▶ (keys, or the stall's actions from the HUD chip bar via
  // `.stack-nav`) scroll it a card at a time, and the card nearest the centre carries `.is-front` so the stall's ✓ opens
  // the one on screen (stall.ts looks the front card up globally).
  let sheetCards: HTMLElement[] = [];
  const sheetFront = (i: number) => sheetCards.forEach((c, k) => c.classList.toggle('is-front', k === i));
  const sheetFrontIndex = () => Math.max(0, sheetCards.findIndex((c) => c.classList.contains('is-front')));
  function sheetGoto(i: number) {
    const st = stackEl, c = sheetCards[i];
    if (!st || !c) return;
    const left = c.getBoundingClientRect().left - st.getBoundingClientRect().left + st.scrollLeft - (st.clientWidth - c.offsetWidth) / 2;
    st.scrollTo({ left, behavior: reducedMotion ? 'auto' : 'smooth' });
    sheetFront(i);
  }
  function sheetStack(st: HTMLElement, cardEls: HTMLElement[]) {
    sheetCards = cardEls;
    sheetFront(0);
    let raf = 0;
    st.addEventListener('scroll', () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const sl = st.getBoundingClientRect().left, mid = st.clientWidth / 2;
        let best = 0, bd = Infinity;
        sheetCards.forEach((c, k) => { const r = c.getBoundingClientRect(); const d = Math.abs(r.left - sl + r.width / 2 - mid); if (d < bd) { bd = d; best = k; } });
        sheetFront(best);
      });
    }, { passive: true });
  }

  for (const el of els) {
    const id = el.dataset.slab!;
    if (id === 'projects') {
      stackEl = el;
      stackWin = winOf(el);
      const cardEls = [...el.querySelectorAll<HTMLElement>('.card')];
      if (narrow) { sheet?.appendChild(el); el.hidden = true; sheetStack(el, cardEls); continue; }
      const target = parentFor(id);
      if (!target) continue;
      stackRoot = target.parent;
      stallCarrier = target.carrier;
      cardEls.forEach((cardEl, i) => {
        const obj = mount(cardEl, target.w, target.px, target.parent, SLOT(i));
        cards.push({ el: cardEl, obj, slot: i });
        cardEl.style.visibility = 'hidden';
        cardEl.addEventListener('click', () => { if (i !== active) { override = i; layout(); } });
        cardEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); override = i; layout(); } });
      });
      cards[0]?.el.classList.add('is-front');
      continue;
    }
    const target = parentFor(id);
    if (narrow) {
      // Phones: the element goes to the bottom sheet (readable, interactive); the carrier shows a painted board instead.
      let board: Slab['board'];
      if (target) {
        const canvas = paintSlab(el, target.carrier?.style ?? '', target.px);
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const h = target.w * canvas.height / canvas.width;
        board = new THREE.Mesh(new THREE.PlaneGeometry(target.w, h), new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, opacity: 0 }));
        board.visible = false;
        target.parent.add(board);
        target.carrier?.fit?.(h);
      }
      sheet?.appendChild(el); el.hidden = true;
      slabs.push({ id, el, carrier: target?.carrier, win: winOf(el), on: false, cueArmed: true, board });
      continue;
    }
    if (!target) continue;
    if (target.carrier) {
      if (target.carrier.style) el.classList.add(target.carrier.style);
      target.carrier.prepare?.(el);
    }
    mount(el, target.w, target.px, target.parent);
    if (target.carrier?.fit) target.carrier.fit((el.offsetHeight || 400) * target.w / target.px);
    el.style.visibility = 'hidden';
    el.style.opacity = '0';
    slabs.push({ id, el, carrier: target.carrier, win: winOf(el), on: false, cueArmed: true });
  }

  // ---- Flip-3D: tween every card to its slot; the card leaving the front swings out and around the back.
  function layout() {
    const front = override ?? active;
    for (const card of cards) {
      const i = cards.indexOf(card);
      const slot = (i - front + cards.length) % cards.length;
      const wasFront = card.slot === 0, s = SLOT(slot);
      card.slot = slot;
      card.el.classList.toggle('is-front', slot === 0);
      if (!card.obj) continue;
      gsap.killTweensOf([card.obj.position, card.obj.rotation]);
      if (reducedMotion) { card.obj.position.set(s.x, s.y, s.z); card.obj.rotation.y = s.ry; continue; }
      if (wasFront && slot !== 0) {
        const tl = gsap.timeline();
        tl.to(card.obj.position, { x: -4.5, y: -1.2, z: 1.5, duration: 0.35, ease: 'power2.in' }, 0)
          .to(card.obj.rotation, { y: -0.9, duration: 0.35, ease: 'power2.in' }, 0)
          .to(card.obj.position, { x: s.x, y: s.y, z: s.z, duration: 0.5, ease: 'power3.out' })
          .to(card.obj.rotation, { y: s.ry, duration: 0.5, ease: 'power3.out' }, '<');
      } else {
        gsap.to(card.obj.position, { x: s.x, y: s.y, z: s.z, duration: 0.6, ease: 'power3.out' });
        gsap.to(card.obj.rotation, { y: s.ry, duration: 0.6, ease: 'power3.out' });
      }
    }
  }
  /** Cards rise out of the stall's projector when the projects window opens. */
  function rise() {
    stallCarrier?.rise?.(true);
    for (const card of cards) {
      if (!card.obj) continue;
      const s = SLOT(card.slot);
      gsap.killTweensOf(card.obj.position);
      if (reducedMotion) { card.obj.position.set(s.x, s.y, s.z); continue; }
      card.obj.position.y = s.y - 3.4;
      gsap.to(card.obj.position, { y: s.y, duration: 0.9, delay: 0.08 * card.slot, ease: 'power3.out', overwrite: 'auto' });
    }
  }
  document.querySelectorAll<HTMLButtonElement>('.stack-nav [data-goto]').forEach((b) => b.addEventListener('click', () => { override = Number(b.dataset.goto); if (narrow) sheetGoto(override); else layout(); }));

  let sheetShown: HTMLElement | null = null;
  const showInSheet = (el: HTMLElement | null) => {
    if (el === sheetShown) return;
    if (sheetShown) sheetShown.hidden = true;
    sheetShown = el;
    if (sheet) { sheet.hidden = !el; sheet.scrollTop = 0; }
    if (el) { el.hidden = false; el.classList.remove('is-on'); void el.offsetWidth; el.classList.add('is-on'); }
  };

  const windowK = (win: [number, number], p: number) => smooth(win[0] - FADE, win[0], p) * (1 - smooth(win[1], win[1] + FADE, p));
  const mountPos = new THREE.Vector3();
  /** Visibility 0…1 of a slab for this frame: p window (ride), proximity to its mount (walk), docked or not (dock). */
  const visibilityK = (id: string, carrier: Carrier | undefined, win: [number, number], p: number, view?: ContentView) => {
    if (!view || view.mode === 'ride') return windowK(win, p);
    if (view.mode === 'dock') return view.docked === id ? 1 : 0;
    if (!view.player || !carrier) return windowK(win, p);
    carrier.mount.getWorldPosition(mountPos);
    const d = Math.hypot(mountPos.x - view.player.x, mountPos.z - view.player.z);
    const [near, far] = WALK_RANGE[id] ?? WALK_DEFAULT;
    return 1 - smooth(near, far, d);
  };

  let docked: CarrierId | null = null;
  const dockedEl = (id: CarrierId) => (id === 'projects' ? stackEl : slabs.find((s) => s.id === id)?.el) ?? null;

  function update(p: number, t: number, dt: number, view?: ContentView) {
    carriers.update(t, dt, p, view?.section);
    const w = docked === 'amd-dc' ? 1 : followWeight(p);
    (carriers.byId['amd-dc'] as any)?.setSpeedScale?.(1 - 0.23 * w);
    const ride = !view || view.mode === 'ride';

    // Phones: the sheet only opens for the docked slab (the E prompt leads there) — never mid-pan; the painted boards
    // in the scene follow the same window / proximity / dock rules as the desktop slabs.
    const dockedNow = view?.mode === 'dock' ? view.docked : null;
    let sheetTarget: HTMLElement | null = null;
    for (const s of slabs) {
      const k = visibilityK(s.id, s.carrier, s.win, p, view);
      if (narrow) {
        if (s.board) { const on = k > 0.01; if (on !== s.board.visible) s.board.visible = on; if (on) s.board.material.opacity = k; }
        if (dockedNow === s.id) sheetTarget = s.el;
        continue;
      }
      const on = k > 0.01;
      if (on !== s.on) {
        s.on = on;
        s.el.style.visibility = on ? 'visible' : 'hidden';
        s.el.classList.toggle('is-on', on);
        if (on) s.carrier?.onShow?.(s.el);
      }
      if (on) s.el.style.opacity = k.toFixed(3);
      const cue = s.carrier?.cue;
      if (cue) {
        if (s.cueArmed && p >= cue.p) { s.cueArmed = false; cue.run(s.el); }
        else if (!s.cueArmed && p < cue.p - 0.05) s.cueArmed = true;
      }
    }
    // Project stack: which card is in front follows the ride through the window; a click overrides until the ride moves on.
    // On foot / docked the ride stands still, so the front card only changes by click or key.
    if (stackEl) {
      const [a, b] = stackWin;
      const k = visibilityK('projects', stallCarrier, stackWin, p, view);
      const slotP = ride ? THREE.MathUtils.clamp(Math.floor(((p - a) / (b - a)) * Math.max(cards.length, 1)), 0, Math.max(cards.length - 1, 0)) : 0;
      if (narrow) { if (dockedNow === 'projects') sheetTarget = stackEl; const on = k > 0.01; if (on !== stallOn) { stallOn = on; stallCarrier?.rise?.(on); } }
      else {
        const on = k > 0.01;
        if (on !== stackEl.classList.contains('is-on')) {
          stackEl.classList.toggle('is-on', on);
          for (const card of cards) { card.el.style.visibility = on ? 'visible' : 'hidden'; card.el.classList.toggle('is-on', on); }
          if (on) { if (active !== slotP) { active = slotP; lastSlotP = slotP; override = null; layout(); } rise(); }
          else stallCarrier?.rise?.(false);
        }
        if (on) for (const card of cards) card.el.style.opacity = k.toFixed(3);
      }
      if (slotP !== lastSlotP) {
        lastSlotP = slotP;
        override = null;
        if (active !== slotP) { active = slotP; if (!narrow) layout(); }
      }
    }
    if (narrow) showInSheet(sheetTarget);
  }

  /** Camera offset for the blimp formation (zero outside its window). */
  const zero = new THREE.Vector3();
  function followOffset(p: number, out: THREE.Vector3) {
    const c = carriers.byId['amd-dc'];
    const w = followWeight(p);
    if (!c?.displacement || w <= 0) return out.copy(zero);
    return c.displacement(out).multiplyScalar(w);
  }
  /** A moving carrier's displacement from its home pose (the dock camera rides along with the blimp). */
  function carrierDisplacement(id: CarrierId, out: THREE.Vector3) {
    const c = carriers.byId[id];
    return c?.displacement ? c.displacement(out) : out.copy(zero);
  }

  // ---- dock mode: the docked slab is interactive; keys go to its carrier's `interact` block (carriers/*.ts)
  function dock(id: CarrierId) {
    if (docked === id) return;
    if (docked) undock();
    docked = id;
    const el = dockedEl(id);
    if (!el) return;
    el.classList.add('is-docked');
    carriers.byId[id]?.interact?.onEnter?.(el);
    // The HUD's phone chip bar mirrors the carrier's named actions (hud.ts).
    document.dispatchEvent(new CustomEvent<DockEventDetail>(DOCK_EVENT, { detail: { id, actions: carriers.byId[id]?.interact?.actions ?? null } }));
  }
  function undock() {
    if (!docked) return;
    const id = docked, el = dockedEl(id);
    docked = null;
    document.dispatchEvent(new CustomEvent(UNDOCK_EVENT));
    if (!el) return;
    el.classList.remove('is-docked');
    carriers.byId[id]?.interact?.onExit?.(el);
  }
  /** Route a key to the docked carrier; true when handled. Cards flip with ←/→ unless the stall carrier takes the key. */
  function onKey(e: KeyboardEvent): boolean {
    if (!docked) return false;
    const el = dockedEl(docked);
    if (!el) return false;
    if (carriers.byId[docked]?.interact?.onKey?.(e, el)) return true;
    if (narrow && docked === 'projects' && sheetCards.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      sheetGoto((sheetFrontIndex() + (e.key === 'ArrowRight' ? 1 : sheetCards.length - 1)) % sheetCards.length);
      return true;
    }
    if (docked === 'projects' && cards.length && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const front = override ?? active;
      override = (front + (e.key === 'ArrowRight' ? 1 : cards.length - 1)) % cards.length;
      layout();
      return true;
    }
    return false;
  }

  return {
    update, followOffset, carrierDisplacement, dock, undock, onKey, get docked() { return docked; },
    /** Phone boards (id → height in u), for probes. */
    get boards() { return Object.fromEntries(slabs.filter((s) => s.board).map((s) => [s.id, +s.board!.geometry.parameters.height.toFixed(2)])); },
    stackRoot, lights: carriers.lights, props: carriers.props, npcs: carriers.npcs, carriers: carriers.byId, activeLights: carriers.activeLights,
  };
}

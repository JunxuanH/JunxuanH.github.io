/**
 * Résumé content in the scene. Every section (index.astro `[data-slab]`: education, four jobs, the project cards,
 * contact) is painted as a terminal board (slabcanvas.ts) on its carrier's mount (carriers/*: kiosk, bus stop,
 * LED wall, blimp banner, hologram, holo stall, departures board) — real geometry, so the boards depth-test against
 * the character. In ride mode each board has a p window (data-window="a,b") during which it is visible; on foot it
 * fades by proximity to its carrier, and in dock mode only the docked board shows. Docking opens the section's DOM
 * element in the terminal session overlay (session.ts) and routes keys to the carrier's `interact` block
 * (`dock` / `undock` / `onKey`); the board repaints after every action so it mirrors the session's cursor.
 */
import * as THREE from 'three/webgpu';
import { texture, float, fract, uv, time, smoothstep, abs } from './tsl';
import { ANCHORS, followWeight, type SectionId } from './journey';
import { params, reducedMotion, type Tier } from './palette';
import { createCarriers, type Board, type Carrier, type CarrierId, type CarrierCtx } from './carriers/index';
import type { DistrictTextures } from './districts/shared';
import type { Mode } from './nav';
import { DOCK_EVENT, UNDOCK_EVENT, type DockEventDetail } from './hud';
import type { DockActions } from './carriers/dock';
import { docFromSlab, paintTerminal, slabFontsReady, type TermDoc } from './slabcanvas';
import { createSession } from './session';

export interface ContentOptions {
  scene: THREE.Scene;
  narrow: boolean;
  tier: Tier;
  tex: DistrictTextures;
  people: boolean;
  onFlap?: () => void;
}

/**
 * What the visitor is doing this frame (nav.ts). `ride` = boards fade by their p windows; `walk` = each board fades by
 * the player's horizontal distance to its carrier mount; `dock` = only the docked board, fully on.
 */
export interface ContentView {
  mode: Mode;
  /** Section whose carriers stay drawn whatever p says (walk / dock); undefined in ride mode. */
  section?: SectionId;
  docked: CarrierId | null;
  /** Player feet position (walk mode). */
  player: THREE.Vector3 | null;
}

type BoardMesh = THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicNodeMaterial>;
interface Slab {
  id: string;
  el: HTMLElement;
  carrier?: Carrier;
  win: [number, number];
  cueArmed: boolean;
  board?: BoardMesh;
  handle: Board;
  /** The board just appeared / disappeared (edge-triggered `rise`). */
  shown: boolean;
}

const smooth = (a: number, b: number, x: number) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const FADE = 0.012;
/** Walk-mode proximity fade per carrier: [full at, gone at] horizontal distance (u). Big high carriers read from further. */
const WALK_RANGE: Partial<Record<string, [number, number]>> = { kioxia: [40, 70], 'amd-dc': [20, 45] };
const WALK_DEFAULT: [number, number] = [6, 14];
/** Board texture pixels per layout px: crisp on desktop, lean on phones. */
const TEX_SCALE = (narrow: boolean) => (narrow ? 1 : 1.5);
const ORDER: CarrierId[] = ['education', 'amd-intern', 'kioxia', 'amd-dc', 'apple', 'projects', 'contact'];

/** Where a board goes if its carrier module is missing (the pre-carrier placements). */
const SIGN_YAW = (x: number) => (x < 0 ? Math.PI / 2 - 0.35 : -Math.PI / 2 + 0.35);
function fallbackMount(id: string): { obj: THREE.Object3D; w: number; px: number } | null {
  const c = ANCHORS.campus;
  const at = (pos: THREE.Vector3, yaw: number) => { const o = new THREE.Object3D(); o.position.copy(pos); o.rotation.y = yaw; return o; };
  const jobs = ['amd-intern', 'kioxia', 'amd-dc', 'apple'];
  if (id === 'education') return { obj: at(new THREE.Vector3(c.x, 4.9, c.z - 11 + 0.35), 0), w: 15, px: 720 };
  if (id === 'contact') return { obj: at(new THREE.Vector3(ANCHORS.pad.x, 6.0, ANCHORS.pad.z + 11.6), Math.PI), w: 13, px: 680 };
  if (id === 'projects') return { obj: at(new THREE.Vector3(ANCHORS.market.x + 22, 6.2, ANCHORS.market.z + 1), -Math.PI / 2 + 0.55), w: 10, px: 720 };
  const i = jobs.indexOf(id);
  if (i < 0) return null;
  const p = ANCHORS.workSigns[i], yaw = SIGN_YAW(p.x);
  return { obj: at(p.clone().addScaledVector(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), 0.35), yaw), w: 14, px: 720 };
}

/**
 * The boards' shared material recipe — identical node graph per board, only the bound texture differs, so three
 * compiles ONE program for all of them. Phosphor gain for the bloom, a slow refresh band rolling down the screen,
 * `material.opacity` for the window / proximity fades.
 */
function boardMaterial(tex: THREE.CanvasTexture) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, opacity: 0 });
  const band = float(1).sub(smoothstep(0, 0.08, abs(fract(uv().y.add(time.mul(0.11))).sub(0.5))));
  m.colorNode = texture(tex).mul(float(1.15).add(band.mul(0.25)));
  return m;
}

export async function createContent(opts: ContentOptions) {
  const { scene, narrow } = opts;
  const carriers = await createCarriers({ scene, tier: opts.tier, tex: opts.tex, people: opts.people, reducedMotion, onFlap: opts.onFlap } satisfies CarrierCtx);
  scene.add(carriers.group);
  const slabs: Slab[] = [];
  // `?noslabs` keeps the carriers but paints no boards and opens no session (perf bisecting).
  const els = params.has('noslabs') ? [] : [...document.querySelectorAll<HTMLElement>('[data-slab]')];
  const winOf = (el: HTMLElement) => (el.dataset.window || '0,0').split(',').map(Number) as [number, number];
  const session = createSession();
  if (els.length) await slabFontsReady();
  const scale = TEX_SCALE(narrow);

  const parentFor = (id: string): { parent: THREE.Object3D; w: number; px: number; carrier?: Carrier } | null => {
    const c = carriers.byId[id as CarrierId];
    if (c) return { parent: c.mount, w: c.width, px: c.px, carrier: c };
    // No carrier (it failed to build): no board. The old free-floating fallback mounts put a 15 u wall over the plaza.
    // `?fallbackboards` restores them for debugging.
    if (!params.has('fallbackboards')) { console.warn('[night] no carrier for', id); return null; }
    const fb = fallbackMount(id);
    if (!fb) return null;
    scene.add(fb.obj);
    return { parent: fb.obj, w: fb.w, px: fb.px };
  };

  // ---- every section: the element goes to the session overlay (hidden); its board hangs on the carrier.
  for (const el of els) {
    const id = el.dataset.slab!;
    const target = parentFor(id);
    session.adopt(el);
    let board: BoardMesh | undefined;
    let handle: Board = { repaint() {} };
    if (target) {
      const paintOpts = { scale, aspect: target.carrier?.aspect, minAspect: 0.45 };
      const canvas = paintTerminal(docFromSlab(el), target.px, paintOpts);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      const h = target.w * canvas.height / canvas.width;
      board = new THREE.Mesh(new THREE.PlaneGeometry(target.w, h), boardMaterial(tex));
      board.position.z = 0.01; // a hair off the carrier's own screen face (no z-fighting with frames)
      board.visible = false;
      board.name = `board:${id}`;
      target.parent.add(board);
      target.carrier?.fit?.(h);
      // Repaints keep the first paint's layout height so the geometry (and the carrier's fit) never change.
      const height = canvas.height / scale;
      handle = { repaint(mutate?: (d: TermDoc) => TermDoc) { const doc = docFromSlab(el); paintTerminal(mutate ? mutate(doc) : doc, target.px, { ...paintOpts, height, canvas }); tex.needsUpdate = true; } };
      // Project screenshots (`.card img`, eager) may land after the first paint: repaint when they do.
      for (const img of el.querySelectorAll<HTMLImageElement>('img')) if (!(img.complete && img.naturalWidth > 0)) img.addEventListener('load', () => handle.repaint(), { once: true });
    }
    slabs.push({ id, el, carrier: target?.carrier, win: winOf(el), cueArmed: true, board, handle, shown: false });
  }

  const windowK = (win: [number, number], p: number) => smooth(win[0] - FADE, win[0], p) * (1 - smooth(win[1], win[1] + FADE, p));
  const mountPos = new THREE.Vector3();
  /** Visibility 0…1 of a board for this frame: p window (ride), proximity to its mount (walk), docked or not (dock). */
  const visibilityK = (id: string, carrier: Carrier | undefined, win: [number, number], p: number, view?: ContentView) => {
    if (!view || view.mode === 'ride') return windowK(win, p);
    // On foot or docked every board stays lit: boards are real geometry (cheap), and the old proximity fade (a CSS3D-era
    // saving) left the departures board a blank frame from the landing pad. Carriers outside the current section are
    // not drawn at all (carriers.update), so this only affects the district you are in. `?boardfade` restores the fade.
    if (!params.has('boardfade')) return 1;
    if (view.mode === 'dock') return view.docked === id ? 1 : 0;
    if (!view.player || !carrier) return windowK(win, p);
    carrier.mount.getWorldPosition(mountPos);
    const d = Math.hypot(mountPos.x - view.player.x, mountPos.z - view.player.z);
    const [near, far] = WALK_RANGE[id] ?? WALK_DEFAULT;
    return 1 - smooth(near, far, d);
  };

  let docked: CarrierId | null = null;
  const slabOf = (id: string) => slabs.find((s) => s.id === id);

  function update(p: number, t: number, dt: number, view?: ContentView) {
    carriers.update(t, dt, p, view?.section);
    const w = docked === 'amd-dc' ? 1 : followWeight(p);
    (carriers.byId['amd-dc'] as any)?.setSpeedScale?.(1 - 0.23 * w);
    for (const s of slabs) {
      const k = visibilityK(s.id, s.carrier, s.win, p, view);
      const on = k > 0.01;
      if (s.board) {
        if (on !== s.board.visible) s.board.visible = on;
        if (on) s.board.material.opacity = k;
      }
      if (on !== s.shown) { s.shown = on; s.carrier?.rise?.(on); }
      const cue = s.carrier?.cue;
      if (cue) {
        if (s.cueArmed && p >= cue.p) { s.cueArmed = false; cue.run(s.handle); }
        else if (!s.cueArmed && p < cue.p - 0.05) s.cueArmed = true;
      }
    }
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

  // ---- dock mode: the section opens in the session overlay; keys go to its carrier's `interact` block (carriers/*.ts),
  // and the board repaints after each action so the screen in the scene mirrors the cursor.
  const sectionName = (el: HTMLElement) => (el.querySelector('.kicker')?.textContent || el.querySelector('h2')?.textContent || el.dataset.slab || '').replace(/\s+/g, ' ').trim();
  /** The carrier's actions, each followed by a board repaint + a scroll to the cursor (the HUD chip bar calls these directly). */
  const wrapActions = (s: Slab, a: DockActions | undefined | null): DockActions | null => {
    if (!a) return null;
    const out: DockActions = {};
    for (const k of Object.keys(a) as (keyof DockActions)[]) {
      const fn = a[k];
      if (fn) out[k] = () => { fn(); s.handle.repaint(); session.reveal(); };
    }
    return out;
  };
  function dock(id: CarrierId) {
    if (docked === id) return;
    if (docked) undock();
    docked = id;
    const s = slabOf(id), c = carriers.byId[id];
    if (!s) { document.dispatchEvent(new CustomEvent<DockEventDetail>(DOCK_EVENT, { detail: { id, actions: c?.interact?.actions ?? null } })); return; }
    s.el.classList.add('is-docked');
    session.open(s.el, { node: c?.node ?? id, section: sectionName(s.el), index: Math.max(0, ORDER.indexOf(id)) });
    c?.interact?.onEnter?.(s.el);
    s.handle.repaint();
    // The HUD's phone chip bar mirrors the carrier's named actions (hud.ts).
    document.dispatchEvent(new CustomEvent<DockEventDetail>(DOCK_EVENT, { detail: { id, actions: wrapActions(s, c?.interact?.actions) } }));
  }
  function undock() {
    if (!docked) return;
    const id = docked, s = slabOf(id);
    docked = null;
    document.dispatchEvent(new CustomEvent(UNDOCK_EVENT));
    if (!s) return;
    carriers.byId[id]?.interact?.onExit?.(s.el);
    s.el.classList.remove('is-docked');
    session.close();
    s.handle.repaint();
  }
  /** Route a key to the docked carrier; true when handled. */
  function onKey(e: KeyboardEvent): boolean {
    if (!docked) return false;
    const s = slabOf(docked);
    if (!s) return false;
    const handled = !!carriers.byId[docked]?.interact?.onKey?.(e, s.el);
    if (handled) { s.handle.repaint(); session.reveal(); }
    return handled;
  }

  return {
    update, followOffset, carrierDisplacement, dock, undock, onKey, get docked() { return docked; },
    /** Boards (id → height in u), for probes. */
    get boards() { return Object.fromEntries(slabs.filter((s) => s.board).map((s) => [s.id, +s.board!.geometry.parameters.height.toFixed(2)])); },
    session, lights: carriers.lights, props: carriers.props, npcs: carriers.npcs, carriers: carriers.byId, activeLights: carriers.activeLights,
  };
}

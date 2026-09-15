/**
 * Content carriers: the in-world objects that hold the résumé sections. Each carrier's content surface is a canvas
 * "terminal board" painted by content.ts (slabcanvas.ts) onto a plane on the carrier's `mount`; docking opens the
 * section in the 2D terminal session overlay (session.ts) and routes keys to the carrier's `interact` block.
 * One module per carrier; each builds its geometry, exposes a `mount` (board centre, local +Z = screen normal),
 * the board size, and optional per-frame behaviour. main.ts adds the groups, lights and props; districts-style
 * visibility gating happens here via `range`.
 */
import * as THREE from 'three/webgpu';
import type { Tier } from '../palette';
import type { DistrictTextures, LightSpec } from '../districts/shared';
import type { PropPlacement } from '../props';
import type { SectionId } from '../journey';
import type { TermDoc } from '../slabcanvas';
import { create as createKiosk } from './kiosk';
import { TERMINALS, type TerminalId } from '../terminal-layout';
import { terminalScreen } from '../district-art';
import { THEMES } from '../theme';

export interface CarrierCtx {
  scene: THREE.Scene;
  tier: Tier;
  tex: DistrictTextures;
  /** Rigged NPCs are available (main.ts loaded them). */
  people: boolean;
  reducedMotion: boolean;
  /** Split-flap clack cue (audio.ts). */
  onFlap?: () => void;
}

/** A carrier's painted board (content.ts): repaint from the section's DOM, optionally transforming the doc first. */
export interface Board {
  repaint(mutate?: (doc: TermDoc) => TermDoc): void;
}

export interface Carrier {
  displayMount?: THREE.Object3D;
  displayWidth?: number;
  terminal?: boolean;
  group: THREE.Group;
  /** The board parents here at the origin; local +Z is the screen normal. */
  mount: THREE.Object3D;
  /** Board world width (u) and layout width in px (the type scales with it); `style` is informational. */
  width: number;
  px: number;
  style: string;
  /** Exact board height / width (the banner fills its frame); otherwise the height follows the content. */
  aspect?: number;
  /** Name in the session header: `NEON HARBOR // <node> — <section>`. */
  node?: string;
  /** Scroll window in which the group is visible. */
  range: [number, number];
  lights?: LightSpec[];
  props?: PropPlacement[];
  npcs?: { root: THREE.Object3D; headBone?: THREE.Bone }[];
  update?(t: number, dt: number, p: number): void;
  /** Called once with the painted board's height (u) so frames / backings match it. */
  fit?(boardHeightU: number): void;
  /** Fired once when p crosses `p` upward; re-armed when p drops below `p - 0.05`. */
  cue?: { p: number; run(board: Board): void };
  /** Moving carriers: world position minus the home pose (camera follow). */
  displacement?(out: THREE.Vector3): THREE.Vector3;
  /**
   * Full camera pose (world) while docked, evaluated every frame. When present it replaces nav.ts's default of the
   * dwell pose (nav.DOCK_P / dockPose(id)) plus `displacement`, so a carrier that turns can rotate its formation
   * offset with its heading instead of only translating it.
   */
  dockPose?(pos: THREE.Vector3, look: THREE.Vector3): void;
  /** The board just appeared / went away (the stall's projector cone). */
  rise?(open: boolean): void;
  /**
   * Dock-mode mini-interaction (walk mode: the player presses E next to the carrier, the camera parks on the dwell
   * pose, the section opens in the session overlay and content.ts routes keys here). `el` is the section's DOM
   * element inside the overlay. `label` overrides the HUD prompt ("Read the terminal").
   */
  interact?: {
    label?: string;
    onEnter?(el: HTMLElement): void;
    onExit?(el: HTMLElement): void;
    /** Return true when the key was handled. Escape arrives here first; when unhandled it undocks. */
    onKey?(e: KeyboardEvent, el: HTMLElement): boolean | void;
    /** The same handlers as named actions, for the phone HUD's chip bar (▲▼ / ◀▶ / ✓). Valid while docked. */
    actions?: { up?(): void; down?(): void; left?(): void; right?(): void; confirm?(): void };
  };
}

export type CarrierId = 'education' | 'amd-intern' | 'kioxia' | 'amd-dc' | 'apple' | 'projects' | 'contact';

/** The journey section each carrier belongs to (walk / dock visibility). */
export const CARRIER_SECTION: Record<CarrierId, SectionId> = {
  education: 'education', 'amd-intern': 'work', kioxia: 'work', 'amd-dc': 'work', apple: 'work', projects: 'projects', contact: 'contact',
};

/** Module per carrier id. Resolved through a glob so a missing module is skipped instead of breaking the build. */
const MODULE_OF: Record<CarrierId, string> = {
  education: './kiosk.ts',
  'amd-intern': './busstop.ts',
  kioxia: './megascreen.ts',
  'amd-dc': './blimp.ts',
  apple: './holo.ts',
  projects: './stall.ts',
  contact: './flapboard.ts',
};
type CarrierModule = { create: (ctx: CarrierCtx) => Promise<Carrier> | Carrier };
// Eager: the carriers ship inside the main bundle. As lazy chunks, a page served from Safari's cache after a redeploy
// asked for chunk names that no longer existed, the kiosk failed and its board fell back to a wall floating over the plaza.
const eager = import.meta.glob<CarrierModule>('./{kiosk,busstop,megascreen,blimp,holo,stall,flapboard}.ts', { eager: true });
const modules = Object.fromEntries(Object.entries(eager).map(([k, m]) => [k, async () => m])) as Record<string, () => Promise<CarrierModule>>;

export async function createCarriers(ctx: CarrierCtx) {
  const byId = {} as Record<CarrierId, Carrier>;
  const group = new THREE.Group();
  const lights: LightSpec[] = [];
  const props: PropPlacement[] = [];
  const npcs: { root: THREE.Object3D; headBone?: THREE.Bone }[] = [];
  await Promise.all((Object.keys(MODULE_OF) as CarrierId[]).map(async (id) => {
    const load = modules[MODULE_OF[id]];
    if (!load) return;
    try {
      const c = await (await load()).create(ctx);
      byId[id] = c;
      group.add(c.group);
      if (c.props) props.push(...c.props);
      if (c.npcs) npcs.push(...c.npcs);
    } catch (e) {
      console.warn(`[night] carrier ${id} failed`, e);
    }
  }));
  // Keep the original architectural carriers as advertisements; reading happens at four matching kiosks.
  for (const [id, c] of Object.entries(byId) as [CarrierId, Carrier][]) {
    c.displayMount = c.mount; c.displayWidth = c.width;
    if (!(id in TERMINALS)) { c.interact = undefined; continue; }
    const spec = TERMINALS[id as TerminalId];
    const kiosk = id === 'education' ? c : await createKiosk({ ...ctx, people: false }, THEMES[CARRIER_SECTION[id] as keyof typeof THEMES]);
    if (id !== 'education') {
      // An identity wrapper preserves the original carrier's world transform and updates.
      const wrapper = new THREE.Group(); group.remove(c.group); wrapper.add(c.group, kiosk.group); group.add(wrapper);
      c.group = wrapper;
      c.mount = kiosk.mount; c.width = 3; c.dockPose = undefined;
    }
    kiosk.group.position.fromArray(spec.pos); kiosk.group.rotation.y = spec.yaw;
    kiosk.fit?.(2);
    c.terminal = true; c.node = `${spec.label} TERMINAL`;
    c.interact = undefined; // native accessible reading controls replace carrier-specific minigames
    const screen = terminalScreen(id as TerminalId); screen.position.z = 0.025; c.mount.add(screen);
  }
  /** `section` (walk / dock mode) keeps every carrier of that section drawn whatever p says; the rest follow their windows. */
  const update = (t: number, dt: number, p: number, section?: SectionId) => {
    for (const id in byId) {
      const c = byId[id as CarrierId];
      c.group.visible = (p >= c.range[0] && p <= c.range[1]) || (section !== undefined && CARRIER_SECTION[id as CarrierId] === section);
      if (c.group.visible) c.update?.(t, dt, p);
    }
  };
  /** Specs of the carriers currently drawn — fed to the light pool (lights.ts) every frame. */
  const activeLights = (): LightSpec[] => Object.values(byId).flatMap((c) => (c.group.visible ? c.lights ?? [] : []));
  return { byId, group, lights, props, npcs, update, activeLights };
}

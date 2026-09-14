/**
 * Content carriers: the in-world objects that hold the résumé slabs (CSS3D DOM, mounted by content.ts).
 * One module per carrier; each builds its geometry, exposes a `mount` (slab centre, local +Z = screen
 * normal), the slab size/style, and optional per-frame behaviour. main.ts adds the groups, lights and
 * props; districts-style visibility gating happens here via `range`.
 */
import * as THREE from 'three/webgpu';
import type { Tier } from '../palette';
import type { DistrictTextures, LightSpec } from '../districts/shared';
import type { PropPlacement } from '../props';
import type { SectionId } from '../journey';

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

export interface Carrier {
  group: THREE.Group;
  /** The CSS3D slab parents here at the origin; local +Z is the screen normal. */
  mount: THREE.Object3D;
  /** Slab world width (u) and CSS pixel width; `style` is the class added to the slab element (desktop only). */
  width: number;
  px: number;
  style: string;
  /** Scroll window in which the group is visible. */
  range: [number, number];
  lights?: LightSpec[];
  props?: PropPlacement[];
  npcs?: { root: THREE.Object3D; headBone?: THREE.Bone }[];
  update?(t: number, dt: number, p: number): void;
  /** Called once after mount with the measured slab height (u) so frames/backings can match the DOM. */
  fit?(slabHeightU: number): void;
  /** One-time DOM prep (e.g. `--i` indices for staggered reveals). */
  prepare?(el: HTMLElement): void;
  /** The slab's window just opened. */
  onShow?(el: HTMLElement): void;
  /** Fired once when p crosses `p` upward; re-armed when p drops below `p - 0.05`. */
  cue?: { p: number; run(el: HTMLElement): void };
  /** Moving carriers: world position minus the home pose (camera follow). */
  displacement?(out: THREE.Vector3): THREE.Vector3;
  /**
   * Full camera pose (world) while docked, evaluated every frame. When present it replaces nav.ts's default of the
   * dwell pose (nav.DOCK_P / dockPose(id)) plus `displacement`, so a carrier that turns can rotate its formation
   * offset with its heading instead of only translating it.
   */
  dockPose?(pos: THREE.Vector3, look: THREE.Vector3): void;
  /** Extra behaviour hooks used by content.ts (e.g. stall.rise). */
  rise?(open: boolean): void;
  /**
   * Dock-mode mini-interaction (walk mode: the player presses E next to the carrier, the camera parks on the dwell
   * pose and content.ts routes keys here). `label` overrides the HUD prompt ("Read the terminal").
   */
  interact?: {
    label?: string;
    onEnter?(el: HTMLElement): void;
    onExit?(el: HTMLElement): void;
    /** Return true when the key was handled. Escape arrives here first; when unhandled it undocks. */
    onKey?(e: KeyboardEvent, el: HTMLElement): boolean | void;
    /** The same handlers as named actions, for the phone sheet's chip bar (▲▼ / ◀▶ / ✓). Valid while docked. */
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
const modules = import.meta.glob<CarrierModule>('./{kiosk,busstop,megascreen,blimp,holo,stall,flapboard}.ts');

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

/**
 * Campus street terminal (education). A CRT housing leaning back on a plinth at the plaza edge, facing +z
 * toward the dwell camera at (−80, 2.25, −96.6); the `terminal` slab sits on the housing face and types
 * itself in, and an amber scanline plane glows through as the DOM fades. ~8 draws + the NPC.
 */
import * as THREE from 'three/webgpu';
import { color, step, fract, uv, time, glowMaterial as glow } from '../tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEMES } from '../theme';
import { CURB_H } from '../streets';
import { loadCharacter, instantiate } from '../characters';
import { sfx } from '../audio';
import { keyToAction, setSel, hint, clearHint, retrigger, type DockActions } from './dock';
import type { Carrier, CarrierCtx } from './index';

const TILT = -0.17;      // housing leans back: top away from the viewer, screen normal tilts up toward the camera
const SCREEN_Y = 2.05;   // slab centre (the close camera looks here)
const FACE_Z = 0.05;     // housing centre z; its front face is 0.15 further along the tilted normal
const HOUSING_H = 2.3;
const KEY_Y = 1.25;

/** z of the tilted housing face at world-ish (group) height y, for parking the keypad tray against it. */
function faceZ(y: number) {
  const s = Math.sin(TILT), c = Math.cos(TILT);
  const yl = (y - SCREEN_Y + 0.15 * s) / c;
  return FACE_Z + yl * s + 0.15 * c;
}

export async function create(ctx: CarrierCtx): Promise<Carrier> {
  const T = THEMES.education;
  const group = new THREE.Group();
  group.position.set(-80, CURB_H, -100);
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x14161f, roughness: 0.5, metalness: 0.7 });

  // Plinth, pedestal, spine (behind the housing) and canopy: one merged dark-metal mesh.
  const body = mergeGeometries([
    new THREE.BoxGeometry(1.8, 0.12, 1.1).translate(0, 0.06, 0),
    new THREE.BoxGeometry(0.9, 0.9, 0.5).translate(0, 0.57, -0.1),
    new THREE.BoxGeometry(0.5, 2.4, 0.35).translate(0, 2.2, -0.3),
    new THREE.BoxGeometry(3.6, 0.1, 1.2).translate(0, 3.4, 0.1),
  ], false)!;
  group.add(new THREE.Mesh(body, metal));
  // Pink trim along the plinth's top edges, warm strip under the canopy's front edge.
  const trim = mergeGeometries([
    new THREE.BoxGeometry(1.84, 0.03, 0.04).translate(0, 0.12, 0.55),
    new THREE.BoxGeometry(1.84, 0.03, 0.04).translate(0, 0.12, -0.55),
    new THREE.BoxGeometry(0.04, 0.03, 1.14).translate(0.9, 0.12, 0),
    new THREE.BoxGeometry(0.04, 0.03, 1.14).translate(-0.9, 0.12, 0),
  ], false)!;
  group.add(new THREE.Mesh(trim, glow(T.primary, 1.6)));
  const under = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.03, 0.08), glow(T.warm, 1.8));
  under.position.set(0, 3.34, 0.5);
  group.add(under);

  // Housing face pivot: housing, bezel and backing share the tilt (local +z = screen normal).
  const face = new THREE.Object3D();
  face.position.set(0, SCREEN_Y, FACE_Z);
  face.rotation.x = TILT;
  group.add(face);
  const housing = new THREE.Mesh(new THREE.BoxGeometry(3.3, HOUSING_H, 0.3), metal);
  face.add(housing);
  const bezel = new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(3.3, 0.06, 0.06).translate(0, HOUSING_H / 2 - 0.03, 0.16),
    new THREE.BoxGeometry(3.3, 0.06, 0.06).translate(0, -HOUSING_H / 2 + 0.03, 0.16),
    new THREE.BoxGeometry(0.06, HOUSING_H, 0.06).translate(1.65 - 0.03, 0, 0.16),
    new THREE.BoxGeometry(0.06, HOUSING_H, 0.06).translate(-1.65 + 0.03, 0, 0.16),
  ], false)!, glow(T.primary, 1.8));
  face.add(bezel);
  // Amber scanline backing just in front of the housing face: what you see when the DOM slab fades.
  const backMat = new THREE.MeshBasicNodeMaterial();
  const scan = step(0.5, fract(uv().y.mul(160).add(time.mul(2))));
  backMat.colorNode = color(0xffb000).mul(0.35).mul(scan.mul(0.65).add(0.35));
  const backing = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 2.0), backMat);
  backing.position.z = 0.16;
  face.add(backing);

  // Keypad tray against the housing's lower lip: shelf + 12 instanced amber keys (4 × 3).
  const tray = new THREE.Group();
  tray.position.set(0, KEY_Y, faceZ(KEY_Y) + 0.18);
  tray.add(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.05, 0.4), metal));
  const keys = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.03, 0.09), glow(0xffb000, 2), 12);
  const km = new THREE.Matrix4();
  for (let i = 0; i < 12; i++) keys.setMatrixAt(i, km.makeTranslation(-0.18 + (i % 4) * 0.12, 0.04, -0.12 + Math.floor(i / 4) * 0.12));
  tray.add(keys);
  group.add(tray);

  // Slab mount: on the screen plane, a hair in front of the backing.
  const mount = new THREE.Object3D();
  mount.position.set(0, SCREEN_Y, 0.22);
  mount.rotation.x = TILT;
  group.add(mount);

  // Schoolgirl hacker idling at the screen (assets may be missing).
  let mixer: THREE.AnimationMixer | null = null;
  const npcs: NonNullable<Carrier['npcs']> = [];
  if (ctx.people) {
    try {
      const inst = instantiate(await loadCharacter('schoolgirl-hacker'), { height: 1.6, rim: T.primary });
      inst.root.position.set(-1.6, 0, 2.6);          // world (−81.6, 0.22, −97.4)
      inst.root.rotation.y = Math.atan2(1.6, -2.6);  // rig forward is +z: face the screen at (−80, ·, −100)
      inst.play('idle', 0);
      group.add(inst.root);
      mixer = inst.mixer;
      npcs.push({ root: inst.root, headBone: inst.headBone });
    } catch (e) { console.warn('[kiosk] NPC unavailable', e); }
  }

  // ---- dock: the slab is a menu (certification + toolbox rows, `data-detail` from content.ts); ↑/↓ move the cursor,
  // Enter types the row's detail into an output line under the columns (one row open at a time).
  let rows: HTMLElement[] = [], sel = 0, open = -1, out: HTMLElement | null = null;
  const closeRow = () => {
    if (open < 0) return;
    rows[open]?.classList.remove('is-open');
    open = -1;
    if (out) { out.classList.remove('is-typing'); out.textContent = ''; }
  };
  const move = (d: number) => {
    if (!rows.length) return;
    closeRow();
    sel = (sel + d + rows.length) % rows.length;
    setSel(rows, sel);
    sfx.select();
  };
  const toggle = () => {
    const row = rows[sel];
    if (!row || !out) return;
    if (open === sel) { closeRow(); sfx.select(); return; }
    closeRow();
    open = sel;
    row.classList.add('is-open');
    out.textContent = `> ${row.dataset.detail || row.textContent?.trim() || ''}`;
    retrigger(out, 'is-typing');
    sfx.confirm();
  };
  const actions: DockActions = { up: () => move(-1), down: () => move(1), confirm: toggle };

  return {
    group, mount, width: 3.0, px: 720, style: 'terminal', range: [0.08, 0.34],
    lights: [[-80, 2.8, -98.4, 0xffb000, 350, 12]],
    npcs,
    update(_t, dt) { mixer?.update(dt); },
    fit(h) {
      // Housing wraps the slab with a 0.15 lip; the bezel scales with it (bars stay ~0.06 thick).
      const k = (h + 0.3) / HOUSING_H;
      housing.scale.y = k;
      bezel.scale.y = k;
      backing.scale.y = (h + 0.06) / 2.0;
      // The DOM is composited over the canvas, so keep the keypad below the slab's bottom edge.
      const y = Math.min(KEY_Y, SCREEN_Y - h / 2 - 0.08);
      tray.position.set(0, y, faceZ(y) + 0.18);
    },
    prepare(el) {
      el.querySelectorAll<HTMLElement>('.kicker, h2, .meta > span, h3, .bullets li, .chips li')
        .forEach((n, i) => n.style.setProperty('--i', String(i)));
    },
    interact: {
      onEnter(el) {
        rows = [...el.querySelectorAll<HTMLElement>('.bullets li, .chips li')];
        sel = 0; open = -1;
        setSel(rows, sel);
        out = document.createElement('p');
        out.className = 'term-out';
        out.textContent = '> SELECT AN ENTRY';
        el.appendChild(out);
        retrigger(out, 'is-typing');
        hint(el, '<kbd>↑</kbd><kbd>↓</kbd> select · <kbd>Enter</kbd> details · <kbd>Esc</kbd> back');
      },
      onExit(el) {
        closeRow();
        setSel(rows, -1);
        rows = [];
        out?.remove(); out = null;
        clearHint(el);
      },
      onKey(e) {
        // Esc collapses an open row first (only reached if the nav lets Escape through); otherwise the usual keys.
        if (e.key === 'Escape') { if (open < 0) return false; closeRow(); sfx.select(); return true; }
        return keyToAction(e, actions);
      },
      actions,
    },
  };
}

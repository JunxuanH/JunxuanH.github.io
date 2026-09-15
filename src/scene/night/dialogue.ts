/**
 * Talking to the residents. In walk mode the nearest NPC within TALK_RANGE (crowd walkers, the kiosk's
 * schoolgirl hacker, the bus stop's bouncer) puts "Talk to <NAME>" in the HUD prompt; `E` holds the walker
 * (rigs' `hold`: stop, turn to the player, talk/idle clip), opens a holo speech box under the HUD and types a
 * random exchange from src/dialogue.ts (résumé lines for the district, sometimes a line about the city; no
 * immediate repeat per resident). `E` skips the typewriter, then advances, then closes; Esc, a walk input or
 * walking off (> LEAVE_RANGE) closes; the walker is released 0.6 s later. While a box is open the HUD prompt
 * is hidden and `update` returns true so main.ts keeps `E` away from the carriers.
 *
 * `glance()` runs after the crowds' mixers (interact.ts does the same for camera glances): the target's head
 * bone slerps toward the player's head. The box is DOM inside #hud (styles/dialogue.css): name kicker, typed
 * line over a hidden ghost of the full line (stable height), and an `E ▸` cue that blinks once the line is
 * complete. Phones: top-anchored under the nav; tapping the box advances. Reduced motion: lines appear whole.
 */
import * as THREE from 'three/webgpu';
import { linesFor, cityLinesFor, personaFor, type Persona, type Section } from '../../dialogue';
import { sfx } from './audio';
import { reducedMotion } from './palette';
import type { WalkSection } from './walkable';
import '../../styles/dialogue.css';

/** Someone the player can talk to. Crowd walkers and carrier NPCs are mapped into this shape (helpers below). */
export interface Target {
  id: string;
  /** fal rig name → persona + lines (src/dialogue.ts). */
  rig: string;
  /** Persona name (the prompt says "Talk to <name>"). */
  name: string;
  /** Only reachable in this district; unset = any. */
  section?: WalkSection | null;
  /** Pivot: world position, +z forward. */
  root: THREE.Object3D;
  /** Head bone for the glance, when the rig has one. */
  head?: THREE.Bone;
  /** Stop and face `face` (a walker's `hold`; a carrier NPC turns its torso). */
  hold(face: THREE.Vector3): void;
  release(): void;
  /** Optional per-frame hook (carrier NPCs ease their yaw here). */
  tick?(dt: number): void;
}

export interface DialogueOptions {
  /** The HUD (createHud(); its `hideHint` is called when a box opens) or just its root element: the box mounts inside it. */
  hud?: { el: HTMLElement | null; hideHint?: () => void } | HTMLElement | null;
  /** Prompt slot ("Talk to RIN" / null). main.ts arbitrates with the carriers' prompt. */
  prompt(label: string | null): void;
  getTargets(): Target[];
  /**
   * The player's heading (radians, +z = 0; player.ts `yaw`). Residents count only inside a cone in front of the
   * player (FACING_DOT), so the kiosk's schoolgirl does not steal the terminal's E from its natural approach.
   * Omit, or return null, for a facing-agnostic pick.
   */
  playerYaw?(): number | null;
  onOpen?(target: Target | null): void;
  onClose?(target: Target | null): void;
}

/** Horizontal reach of a conversation, and the distance that ends one. */
export const TALK_RANGE = 2.6, LEAVE_RANGE = 3.2;
/** cos of the half-angle of the "facing" cone (0.4 ≈ 66°): a resident is a target only inside it. */
export const FACING_DOT = 0.4;
const CPS = 38;              // typewriter speed (chars / s)
const RELEASE_AFTER = 0.6;   // s after the box closes before the walker resumes
const CITY_ODDS = 0.3;       // chance of a line about the city instead of the résumé
const PLAYER_HEAD = 1.55;    // the protagonist's eye height above the feet (u)

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Typewriter blip: audio.ts's `blip(hz)` when it exists (persona pitch), else the menu tick. */
function blip(pitch: number | undefined) {
  const s = sfx as typeof sfx & { blip?: (hz: number) => void };
  if (s.blip) s.blip(pitch ?? 1000); else s.select();
}

export function createDialogue(opts: DialogueOptions) {
  // ---- DOM
  const hudEl = opts.hud instanceof HTMLElement ? opts.hud : opts.hud?.el ?? null;
  const hudApi = opts.hud && !(opts.hud instanceof HTMLElement) ? (opts.hud as { hideHint?: () => void }) : null;
  const box = document.createElement('div');
  box.className = 'dlg';
  box.hidden = true;
  box.innerHTML =
    '<p class="dlg-name"><span class="dlg-who"></span><span class="dlg-title"></span></p>' +
    '<p class="dlg-text" aria-hidden="true"><span class="dlg-typed"></span><span class="dlg-ghost"></span></p>' +
    '<span class="dlg-sr" aria-live="polite"></span>' +
    '<span class="dlg-more" aria-hidden="true"><kbd>F</kbd><i>▸</i></span>';
  (hudEl ?? document.body).appendChild(box);
  const who = box.querySelector<HTMLElement>('.dlg-who')!, title = box.querySelector<HTMLElement>('.dlg-title')!;
  const typed = box.querySelector<HTMLElement>('.dlg-typed')!, ghost = box.querySelector<HTMLElement>('.dlg-ghost')!, sr = box.querySelector<HTMLElement>('.dlg-sr')!;
  box.addEventListener('pointerdown', (e) => { e.preventDefault(); advance(); }); // tap / click the box = E

  // ---- state
  let target: Target | null = null;   // nearest in range (prompt), or who we are talking to (open)
  let open = false;
  let persona: Persona = personaFor('');
  let lines: string[] = [], li = 0;
  let line = '', shown = 0, typedLen = 0, done = true;
  let lastLabel: string | null = null;
  const lastPick = new Map<string, string[]>();
  let held: Target | null = null, releaseIn = 0;
  const playerRef = new THREE.Vector3();
  let hasPlayer = false;

  // ---- picking an exchange: résumé lines for the district, sometimes the city; never the same one twice in a row
  function pick(rig: string, section: Section, key: string): string[] {
    const own = linesFor(rig, section), city = cityLinesFor(rig);
    const last = lastPick.get(key);
    const pool = city.length && Math.random() < CITY_ODDS ? city : own;
    let cands = pool.filter((e) => e !== last);
    if (!cands.length) cands = own.filter((e) => e !== last);
    if (!cands.length) cands = pool;
    const ex = cands[Math.floor(Math.random() * cands.length)];
    lastPick.set(key, ex);
    return ex;
  }

  // ---- typewriter
  const render = () => { typed.textContent = line.slice(0, typedLen); ghost.textContent = line.slice(typedLen); };
  function showLine(i: number) {
    li = i;
    line = lines[i] ?? '';
    sr.textContent = line;
    typedLen = reducedMotion ? line.length : 0;
    shown = typedLen;
    done = typedLen >= line.length;
    box.classList.toggle('is-done', done);
    render();
  }
  function finish() {
    typedLen = line.length; shown = typedLen; done = true;
    box.classList.add('is-done');
    render();
  }
  function type(dt: number) {
    if (done) return;
    shown += CPS * dt;
    const n = Math.min(line.length, Math.floor(shown));
    if (n === typedLen) return;
    for (let i = typedLen; i < n; i++) if ((i & 1) === 0 && line[i] !== ' ') blip(persona.pitch);
    typedLen = n;
    render();
    if (n >= line.length) { done = true; box.classList.add('is-done'); }
  }

  // ---- hold / release (the walker stops and faces the player; resumes a moment after the box closes)
  function hold(t: Target) {
    if (held && held !== t) held.release();
    releaseIn = 0;
    if (held !== t) { t.hold(playerRef); held = t; }
  }
  function releaseTick(dt: number) {
    if (releaseIn <= 0 || !held || open) return;
    releaseIn -= dt;
    if (releaseIn <= 0) { held.release(); held = null; }
  }

  // ---- open / advance / close
  function openWith(t: Target | null, rig: string, section: Section) {
    persona = personaFor(rig);
    lines = pick(rig, section, t?.id ?? rig);
    open = true;
    box.dataset.voice = persona.voice;
    who.textContent = persona.name;
    title.textContent = persona.title ?? '';
    title.hidden = !persona.title;
    box.hidden = false;
    box.classList.remove('is-on'); void box.offsetWidth; box.classList.add('is-on');
    showLine(0);
    if (t) hold(t);
    setPrompt(null);
    hudApi?.hideHint?.(); // the controls card (first walk) would sit under the box on phones; talking proves it read
    sfx.confirm();
    opts.onOpen?.(t);
  }
  function advance() {
    if (!open) return;
    if (!done) { finish(); return; }
    if (li + 1 < lines.length) { showLine(li + 1); sfx.select(); return; }
    close();
  }
  function close() {
    if (!open) return;
    open = false;
    box.hidden = true;
    box.classList.remove('is-on', 'is-done');
    releaseIn = RELEASE_AFTER;
    opts.onClose?.(target);
  }

  // ---- prompt + target
  function setPrompt(label: string | null) {
    if (label === lastLabel) return;
    lastLabel = label;
    opts.prompt(label);
  }
  function setTarget(t: Target | null) {
    target = t;
    setPrompt(t ? `Talk to ${personaFor(t.rig).name}` : null);
  }

  const tmp = new THREE.Vector3();
  const horiz = (t: Target, p: THREE.Vector3) => { t.root.getWorldPosition(tmp); return Math.hypot(tmp.x - p.x, tmp.z - p.z); };

  /**
   * Per frame in walk mode (before interactables.update). Returns true when the dialogue owns the interact key (F / Enter) this frame:
   * a box is open, or a resident is within TALK_RANGE. Pass `section = null` outside walk mode.
   */
  function update(playerPos: THREE.Vector3 | null, section: WalkSection | null, pressInteract: boolean, pressBack: boolean, walkIntent: boolean, dt: number): boolean {
    const targets = opts.getTargets();
    for (const t of targets) t.tick?.(dt);
    releaseTick(dt);
    if (playerPos) { playerRef.copy(playerPos); hasPlayer = true; } else hasPlayer = false;
    if (!section || !playerPos) { close(); setTarget(null); return false; }

    if (open) {
      const away = target ? horiz(target, playerPos) > LEAVE_RANGE : false;
      if (pressBack || walkIntent || away) { close(); return true; }
      if (pressInteract) advance(); else type(dt);
      return true;
    }

    // Nearest resident in reach, inside the facing cone when the player has a heading (an open box ignores facing).
    const yaw = opts.playerYaw?.() ?? null;
    const fx = yaw === null ? 0 : Math.sin(yaw), fz = yaw === null ? 0 : Math.cos(yaw);
    let best: Target | null = null, bestD = TALK_RANGE;
    for (const t of targets) {
      if (t.section && t.section !== section) continue;
      if (!t.root.visible) continue;
      t.root.getWorldPosition(tmp);
      const dx = tmp.x - playerPos.x, dz = tmp.z - playerPos.z, d = Math.hypot(dx, dz);
      if (d >= bestD) continue;
      if (yaw !== null && d > 0.05 && (fx * dx + fz * dz) / d < FACING_DOT) continue;
      best = t; bestD = d;
    }
    setTarget(best);
    if (!best) return false;
    if (pressInteract) openWith(best, best.rig, section);
    return true;
  }

  // ---- head glance (after the mixers): the target looks at the player, firmly while talking, a little when in range
  const npcPos = new THREE.Vector3(), headPos = new THREE.Vector3(), eye = new THREE.Vector3(), toP = new THREE.Vector3(), fwd = new THREE.Vector3();
  const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion(), parentWorld = new THREE.Quaternion(), desired = new THREE.Quaternion();
  function glance() {
    const t = target;
    if (!t || !t.head || !hasPlayer || !t.root.visible) return;
    t.root.getWorldPosition(npcPos);
    toP.subVectors(playerRef, npcPos); toP.y = 0;
    const d = toP.length();
    if (d < 0.3) return;
    toP.divideScalar(d);
    t.root.getWorldDirection(fwd);
    if (fwd.dot(toP) < 0.3) return; // the player is behind: no owl necks
    const k = reducedMotion ? 0.6 : open ? 0.35 : 0.12;
    t.head.getWorldPosition(headPos);
    eye.set(playerRef.x, playerRef.y + PLAYER_HEAD, playerRef.z);
    lookM.lookAt(eye, headPos, THREE.Object3D.DEFAULT_UP); // +z of the result points from the head to the player
    lookQ.setFromRotationMatrix(lookM);
    t.head.parent!.getWorldQuaternion(parentWorld);
    desired.copy(parentWorld).invert().multiply(lookQ);
    t.head.quaternion.slerp(desired, k);
  }

  const api = {
    update, glance, close, advance,
    get open() { return open; },
    get target() { return target; },
    el: box,
  };
  (window as any).__dialogue = {
    get open() { return open; },
    get targetName() { return target ? personaFor(target.rig).name : null; },
    get text() { return typed.textContent ?? ''; },
    get line() { return line; },
    get index() { return li; },
    get count() { return lines.length; },
    get done() { return done; },
    get held() { return held?.id ?? null; },
    targets: () => opts.getTargets().map((t) => {
      t.root.getWorldPosition(tmp);
      return { id: t.id, rig: t.rig, name: t.name, section: t.section ?? null, visible: t.root.visible, position: { x: tmp.x, y: tmp.y, z: tmp.z }, pos: [tmp.x, tmp.y, tmp.z] };
    }),
    say: (rig: string, section: Section) => openWith(null, rig, section),
    advance, close,
  };
  return api;
}

export type Dialogue = ReturnType<typeof createDialogue>;

// ---------------------------------------------------------------------------------------------------------------
// Mapping the scene's people into Targets
// ---------------------------------------------------------------------------------------------------------------

/**
 * A carrier NPC (kiosk schoolgirl, bus-stop bouncer: content.npcs `{ root, headBone }`) as a Target. It never walks,
 * so `hold` eases its torso round to face the player and `release` eases it back to its posed yaw.
 */
export function carrierTarget(npc: { root: THREE.Object3D; headBone?: THREE.Bone }, rig: string, section: WalkSection, id = `${section}:${rig}`): Target {
  const root = npc.root;
  const home = root.rotation.y;
  let want = home;
  const local = new THREE.Vector3();
  return {
    id, rig, name: personaFor(rig).name, section, root, head: npc.headBone,
    hold(face) {
      local.copy(face);
      root.parent?.worldToLocal(local); // yaw in the parent's frame; rig forward is +z
      want = Math.atan2(local.x - root.position.x, local.z - root.position.z);
    },
    release() { want = home; },
    tick(dt) {
      const d = wrapAngle(want - root.rotation.y);
      if (Math.abs(d) < 1e-3) return;
      root.rotation.y += reducedMotion ? d : d * (1 - Math.exp(-6 * dt));
    },
  };
}

/** The crowd API's walker (characters.ts `createCrowd().walkers`), structurally: enough to hold, release and find it. */
export interface WalkerLike {
  /** Rig name. */
  name: string;
  root: THREE.Object3D;
  inst?: { headBone?: THREE.Bone };
  hold(face?: THREE.Vector3): void;
  release(): void;
}

/** Crowd walkers as Targets (ids `${prefix}:${index}`); `section` limits them to one district (null = wherever they roam). */
export function walkerTargets(walkers: readonly WalkerLike[], section: WalkSection | null, prefix: string): Target[] {
  return walkers.map((w, i) => ({
    id: `${prefix}:${i}`, rig: w.name, name: personaFor(w.name).name, section, root: w.root, head: w.inst?.headBone,
    hold: (face: THREE.Vector3) => w.hold(face),
    release: () => w.release(),
  }));
}

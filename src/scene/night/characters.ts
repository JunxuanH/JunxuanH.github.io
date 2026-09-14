import * as THREE from 'three/webgpu';
import {
  texture, uv, color, vec3, float, step, normalize, cameraPosition, positionWorld, normalWorld, dot, max, pow,
  luminance, mx_rgbtohsv, mix, smoothstep, length,
  uniform } from './tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { PathDef } from './paths';
import { rigMeta, groundOffsetFor, type RigMeta } from './rigs';

/**
 * Character assets: fal-generated rigs (public/night/characters/<name>/{rigged,walk,run,idle}.glb,
 * see scripts/night-character.sh). One loader, cached assets, SkeletonUtils clones, one mixer per
 * instance, and a shared contact "blob" shadow under every instance (no shadow maps in this scene).
 * Every instance is a pivot Group around the cloned model: rigs.ts supplies the yaw / ground offset /
 * default height / stride per rig (from the audit), so callers only ever position and turn the pivot.
 */
export interface CharacterAsset {
  name: string;
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  height: number; // rig units (bbox height of the unscaled scene; Meshy rigs: the declared height_meters)
  meta?: Record<string, any>;
  /** Constant translation/scale tracks dropped at load (fewer property mixers per action). */
  strippedTracks?: number;
}

let loader: GLTFLoader | null = null;
export function gltfLoader() {
  if (loader) return loader;
  loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  loader.setDRACOLoader(draco);
  return loader;
}

const cache = new Map<string, Promise<CharacterAsset>>();

function bboxHeight(obj: THREE.Object3D) {
  const box = new THREE.Box3().setFromObject(obj);
  return box.max.y - box.min.y;
}

function nameClip(clip: THREE.AnimationClip, fallback: string) {
  const n = clip.name.toLowerCase();
  if (/walk/.test(n)) return 'walk';
  if (/run/.test(n)) return 'run';
  if (/idle|stand|breath/.test(n)) return 'idle';
  if (/sit/.test(n)) return 'sit';
  return fallback;
}

/**
 * Classifies a keyframe track against the rest pose of `root`: Meshy writes translation + rotation + scale
 * for every bone (72 channels a clip), but only the hips translate and nothing scales, so most of them
 * are constants equal to the bind pose. A missing track leaves the bone at that same rest value (and the
 * mixer's crossfade blends against the saved rest state), so dropping them is lossless.
 */
export function redundantTrackFilter(root: THREE.Object3D) {
  const q = new THREE.Quaternion();
  return (track: THREE.KeyframeTrack): 'redundant' | 'constant-rotation' | 'keep' => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const node: any = THREE.PropertyBinding.findNode(root, nodeName);
    if (!node) return 'keep';
    const v = track.values, size = track.getValueSize();
    for (let i = size; i < v.length; i++) if (Math.abs(v[i] - v[i % size]) > 1e-4) return 'keep';
    if (propertyName === 'quaternion') {
      q.set(v[0], v[1], v[2], v[3]);
      return Math.abs(node.quaternion.dot(q)) > 1 - 1e-5 ? 'constant-rotation' : 'keep';
    }
    if (propertyName !== 'position' && propertyName !== 'scale') return 'keep';
    const rest: THREE.Vector3 = node[propertyName];
    const eps = propertyName === 'scale' ? 1e-3 : 1e-4;
    return Math.abs(v[0] - rest.x) < eps && Math.abs(v[1] - rest.y) < eps && Math.abs(v[2] - rest.z) < eps ? 'redundant' : 'keep';
  };
}

/** Load a fal character (rigged.glb + clip GLBs listed in meta.json). Falls back to model.glb when unrigged. */
export function loadCharacter(name: string, base = '/night/characters'): Promise<CharacterAsset> {
  const key = `${base}/${name}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const gl = gltfLoader();
      const meta: Record<string, any> = await fetch(`${key}/meta.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
      const files: string[] = meta.files ?? ['rigged.glb', 'walk.glb', 'run.glb', 'idle.glb'];
      const main = files.includes('rigged.glb') ? 'rigged.glb' : 'model.glb';
      const g = await gl.loadAsync(`${key}/${main}`);
      const clips = new Map<string, THREE.AnimationClip>();
      g.animations.forEach((c, i) => clips.set(nameClip(c, `clip${i}`), c));
      for (const f of files) {
        if (f === main || !/\.glb$/.test(f) || f === 'model.glb') continue;
        try {
          const c = await gl.loadAsync(`${key}/${f}`);
          const label = f.replace(/\.glb$/, '').replace(/^clip-/, 'clip');
          c.animations.forEach((clip, i) => clips.set(i === 0 ? label : `${label}${i}`, clip));
        } catch (e) { console.warn('[characters] clip load failed', f, e); }
      }
      // Drop the constant translation/scale tracks (see redundantTrackFilter): ~2/3 of every Meshy clip.
      const filter = redundantTrackFilter(g.scene);
      let stripped = 0;
      for (const clip of clips.values()) {
        const before = clip.tracks.length;
        clip.tracks = clip.tracks.filter((t) => filter(t) !== 'redundant');
        stripped += before - clip.tracks.length;
      }
      // Meshy normalises the bind pose to meta.height_meters; measure anyway (unrigged model.glb fallback).
      const height = bboxHeight(g.scene) || 1.75;
      return { name, scene: g.scene, clips, height, meta, strippedTracks: stripped };
    })());
  }
  return cache.get(key)!;
}

export interface SkinOptions {
  /** Neon rim colour (nearest sign); default cyan. */
  rim?: THREE.ColorRepresentation;
  rimStrength?: number;
  /** Multiply albedo (tint variants of the same rig). */
  tint?: THREE.ColorRepresentation;
  /** Make bright saturated albedo (LED strips, visors) emissive so it blooms. */
  glow?: boolean;
  glowStrength?: number;
}

/** Replace the GLB's standard materials with node materials: PBR maps kept, neon rim + LED glow added. */
const skinCache = new Map<string, THREE.MeshStandardNodeMaterial>();
export function applySkin(root: THREE.Object3D, opts: SkinOptions = {}) {
  const rim = uniform(new THREE.Color(opts.rim ?? 0x00e5ff)); // uniforms so every rig shares one program
  const rimStrength = uniform(opts.rimStrength ?? 0.6);
  const tint = opts.tint !== undefined ? uniform(new THREE.Color(opts.tint)) : null;
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const src = o.material as THREE.MeshStandardMaterial;
    if ((src as any).__nightSkin) return;
    // One material per (source material, skin options): clones of the same rig share it, so a crowd of
    // 50 walkers costs a handful of shader builds instead of a hundred.
    const key = [src.uuid, opts.rim ?? 0x00e5ff, opts.rimStrength ?? 0.6, opts.tint ?? -1, opts.glow !== false, opts.glowStrength ?? 2.2].join('|');
    const cached = skinCache.get(key);
    if (cached) { o.userData.srcMaterial = src; o.material = cached; o.castShadow = false; o.receiveShadow = false; o.frustumCulled = true; return; }
    const m = new THREE.MeshStandardNodeMaterial({
      roughness: src.roughness ?? 0.7, metalness: src.metalness ?? 0.0, side: src.side,
      transparent: src.transparent, alphaTest: src.alphaTest,
    });
    m.normalMap = src.normalMap ?? null;
    m.roughnessMap = src.roughnessMap ?? null;
    m.metalnessMap = src.metalnessMap ?? null;
    const base = src.map ? texture(src.map, uv()).rgb : color(src.color ?? 0x8090a0);
    const albedo = tint ? base.mul(tint) : base;
    m.colorNode = albedo;
    const v = normalize(cameraPosition.sub(positionWorld));
    const fres = pow(float(1).sub(max(dot(normalWorld, v), 0.0)), 2.5);
    let emissive: any = rim.mul(fres).mul(rimStrength);
    if (opts.glow !== false) {
      const hsv = mx_rgbtohsv(base);
      const lit = step(0.55, luminance(base)).mul(step(0.28, (hsv as any).y));
      emissive = emissive.add(base.mul(lit).mul(opts.glowStrength ?? 2.2));
    }
    if (src.emissiveMap) emissive = emissive.add(texture(src.emissiveMap, uv()).rgb.mul(2.0));
    m.emissiveNode = emissive;
    (m as any).__nightSkin = true;
    skinCache.set(key, m);
    o.userData.srcMaterial = src; // keeps the original maps inspectable (viewer HUD)
    o.material = m;
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = true;
  });
}

export interface Instance {
  /** Pivot: position / turn this. Its +z is the character's forward, y = 0 is the sole of the planted foot. */
  root: THREE.Object3D;
  /** The cloned rig inside the pivot (yaw / ground offset / scale from rigs.ts applied). */
  model: THREE.Object3D;
  meta: RigMeta;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string | null;
  play(name: string, fade?: number): THREE.AnimationAction | null;
  /** World height of the character (u). */
  height: number;
  /** Head height above the feet (u) — look-at target, camera focus. */
  headY: number;
  /** Head bone (Meshy `Head` / mixamorig:Head) for look-at, when the rig has one. */
  headBone?: THREE.Bone;
  /** Contact shadow blob under the feet (child of `root`; hidden with it, follows it, ignores the head look-at). */
  blob: THREE.Mesh;
}

/** Find the head bone of a rig by common names (Meshy, Mixamo). */
export function getHead(root: THREE.Object3D): THREE.Bone | undefined {
  let found: THREE.Bone | undefined;
  root.traverse((o: any) => {
    if (found || !o.isBone) return;
    if (/^(mixamorig:?)?head$|(^|[_:])head$/i.test(o.name)) found = o;
  });
  return found;
}

// ---------- Contact shadow blob ----------
// The scene has dozens of point lights and no shadow maps, so every rig gets a cheap elliptical
// darkening on the ground under its feet. One geometry and one material are shared by all blobs
// (each material instance is a shader build here); size/placement are per-mesh transforms.

const BLOB_W = 0.9, BLOB_D = 0.6, BLOB_LIFT = 0.02, BLOB_OPACITY = 0.55;
let blobGeometry: THREE.PlaneGeometry | null = null;
let blobMaterial: THREE.MeshBasicNodeMaterial | null = null;
function blobShared() {
  if (!blobGeometry) {
    blobGeometry = new THREE.PlaneGeometry(1, 1);
    blobGeometry.rotateX(-Math.PI / 2); // lie flat, normal +y
  }
  if (!blobMaterial) {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.NormalBlending });
    m.colorNode = vec3(0.0, 0.0, 0.0);
    // Radial (elliptical, since the plane is non-square) falloff: BLOB_OPACITY at the centre → 0 at the rim.
    const d = length(uv().sub(0.5).mul(2.0));
    m.opacityNode = float(1).sub(smoothstep(0.0, 1.0, d)).mul(BLOB_OPACITY);
    m.name = 'blob-shadow';
    blobMaterial = m;
  }
  return { geometry: blobGeometry, material: blobMaterial };
}

/** Blob shadow under a pivot (world units: the pivot is unscaled), sized by the character's height. */
function makeBlob(root: THREE.Object3D, height: number) {
  const { geometry, material } = blobShared();
  const blob = new THREE.Mesh(geometry, material);
  blob.name = 'blob-shadow';
  blob.scale.set(BLOB_W * height, 1, BLOB_D * height);
  blob.position.y = BLOB_LIFT;
  blob.renderOrder = 2; // after the ground (transparent pass, depthWrite off)
  blob.castShadow = false;
  blob.receiveShadow = false;
  blob.matrixAutoUpdate = true;
  blob.layers.mask = root.layers.mask;
  // Layers are per object; callers move roots to layer 1 (no reflection) after instantiate, so re-sync lazily.
  blob.onBeforeRender = () => { if (blob.layers.mask !== root.layers.mask) blob.layers.mask = root.layers.mask; };
  root.add(blob);
  return blob;
}

export interface InstantiateOptions extends SkinOptions {
  /** World height (u); default: the rigs.ts row, else the rig's own size. */
  height?: number;
  /** false = keep the GLB materials (lab viewer); the night skin is applied otherwise. */
  skin?: boolean;
}

/**
 * Clone a rig into a pivot: the model is turned by the table's `yaw`, lifted by `groundOffset`, scaled to
 * `height`, skinned (cached node materials) and given a mixer with all clips plus a blob shadow.
 */
export function instantiate(asset: CharacterAsset, opts: InstantiateOptions = {}): Instance {
  const meta = rigMeta(asset.name, asset);
  const model = SkeletonUtils.clone(asset.scene) as THREE.Object3D;
  if (opts.skin !== false) applySkin(model, opts);
  const height = opts.height ?? meta.height;
  const s = height / asset.height;
  model.scale.setScalar(s);
  model.rotation.y = meta.yaw;
  model.position.y = groundOffsetFor(meta, 'idle') * s;
  const root = new THREE.Group();
  root.name = `rig:${asset.name}`;
  root.add(model);
  const mixer = new THREE.AnimationMixer(model);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const [name, clip] of asset.clips) actions.set(name, mixer.clipAction(clip));
  const blob = makeBlob(root, height);
  const inst: Instance = {
    root, model, meta, mixer, actions, current: null, height, headY: meta.headY * s, headBone: getHead(model), blob,
    play(name, fade = 0.25) {
      const next = actions.get(name) ?? actions.get('idle') ?? [...actions.values()][0];
      if (!next) return null;
      const prev = inst.current ? actions.get(inst.current) : null;
      if (prev === next) return next;
      next.reset().setEffectiveWeight(1).fadeIn(fade).play();
      if (prev) prev.fadeOut(fade);
      inst.current = [...actions.entries()].find(([, a]) => a === next)?.[0] ?? name;
      model.position.y = groundOffsetFor(meta, inst.current) * s; // the planted foot dips deeper in walk/run than idle
      return next;
    },
  };
  return inst;
}

/** Walk-clip stride speed of an instance in world units (the table's value scales with the rig). */
export function strideOf(inst: Instance, clip: 'walk' | 'run' = 'walk') {
  const s = inst.height / inst.meta.height;
  return (clip === 'run' ? inst.meta.strideRun : inst.meta.stride) * s;
}

// ---------- Crowd: walkers on district paths with stalls ----------

export interface CrowdOptions {
  path: PathDef;
  /** Assets cycled through the walkers (fal rigs); rows with `ok: false` in rigs.ts are skipped. */
  assets: CharacterAsset[];
  count: number;
  /** Per-asset skin options (by index, cycled). */
  skins?: SkinOptions[];
  /** Force one height for every walker (default: each rig's own from rigs.ts). */
  height?: number;
  speed?: [number, number];
  /** Walker clips: names of clips to use (defaults walk/idle). */
  seed?: number;
  /** Hide + stop animating beyond this camera distance. */
  cullDistance?: number;
  /** Override the walk stride speed (u/s at timeScale 1) for every walker (default: per rig from rigs.ts). */
  strideSpeed?: number;
}

/**
 * One crowd walker. Dialogue / interactions use the public part: `hold(face)` stops it where it is (others on
 * the loop pass it), turns it to `face` (yaw slerp, ~0.4 s) and plays `talk` (or `idle` when the rig has no
 * talk clip); `release()` sends it walking again. A held walker is never culled.
 */
export interface Walker {
  /** Rig name (rigs.ts / public/night/characters/<name>). */
  name: string;
  /** The pivot (== inst.root): world position / heading. */
  root: THREE.Object3D;
  inst: Instance;
  held: boolean;
  hold(face?: THREE.Vector3): void;
  release(): void;
  // ---- internal (createCrowd)
  t: number;
  dir: 1 | -1;
  speed: number;
  baseSpeed: number;
  /** Walk clip stride speed (u/s at timeScale 1) — timeScale = speed / stride keeps the feet planted. */
  stride: number;
  state: 'walk' | 'stall' | 'hold';
  until: number;
  stall: number; // stall index or -1
  faceTarget: THREE.Vector3 | null;
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** How long a stall stays reserved for walkers that own its clip before anyone may take it with idle. */
const STALL_OWNER_WAIT = 20;

export function createCrowd(opts: CrowdOptions) {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(opts.path.points.map((p) => new THREE.Vector3(...p)), opts.path.closed, 'centripetal');
  const length = curve.getLength();
  const rand = rng(opts.seed ?? 1);
  const [smin, smax] = opts.speed ?? [0.9, 1.4];
  const stalls = opts.path.stalls ?? [];
  const occupied = new Set<number>();
  const vacantSince = stalls.map(() => 0);
  const walkers: Walker[] = [];
  const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), target = new THREE.Quaternion(), m = new THREE.Matrix4();
  const wp = new THREE.Vector3();
  const okAssets = opts.assets.filter((a) => rigMeta(a.name, a).ok);
  const assets = okAssets.length ? okAssets : opts.assets;

  for (let i = 0; i < opts.count; i++) {
    const asset = assets[i % assets.length];
    const inst = instantiate(asset, { ...(opts.skins?.[i % (opts.skins.length || 1)] ?? {}), height: opts.height });
    const speed = smin + rand() * (smax - smin);
    const stride = opts.strideSpeed ?? strideOf(inst);
    const w: Walker = {
      name: asset.name, root: inst.root, inst, held: false, t: i / opts.count + rand() * 0.02, dir: opts.path.closed && rand() < 0.4 ? -1 : 1,
      speed, baseSpeed: speed, stride, state: 'walk', until: 0, stall: -1, faceTarget: null,
      hold(face) {
        if (w.stall >= 0) { occupied.delete(w.stall); vacantSince[w.stall] = elapsed; w.stall = -1; }
        w.held = true; w.state = 'hold';
        w.faceTarget = face ? face.clone() : null;
        w.inst.play(w.inst.actions.has('talk') ? 'talk' : 'idle', 0.25);
      },
      release() {
        if (!w.held) return;
        w.held = false; w.state = 'walk'; w.faceTarget = null;
        w.inst.play('walk', 0.25);
      },
    };
    inst.play('walk', 0);
    const a = inst.actions.get('walk');
    if (a) { a.timeScale = speed / stride; a.time = rand() * (a.getClip().duration || 1); }
    group.add(inst.root);
    walkers.push(w);
  }

  let elapsed = 0;
  const cull = opts.cullDistance ?? 90;
  const update = (dt: number, camera: THREE.Camera) => {
    elapsed += dt;
    for (const w of walkers) {
      const r = w.inst.root;
      if (w.held) {
        // Parked for dialogue: no path motion (walkers behind ignore non-walking peers and pass), turn to the face point.
        if (w.faceTarget && w.faceTarget.distanceToSquared(r.position) > 1e-4) {
          m.lookAt(w.faceTarget, r.position, THREE.Object3D.DEFAULT_UP);
          target.setFromRotationMatrix(m);
          r.quaternion.slerp(target, 1 - Math.exp(-8 * dt)); // ~96 % of the turn in 0.4 s
        }
      } else if (w.state === 'stall') {
        if (elapsed > w.until) {
          w.state = 'walk';
          if (w.stall >= 0) { occupied.delete(w.stall); vacantSince[w.stall] = elapsed; }
          w.stall = -1;
          w.inst.play('walk');
        }
      } else {
        // Keep spacing on one-way loops: slow to the walker ahead when closer than 1.6 u.
        w.speed = w.baseSpeed;
        for (const o of walkers) {
          if (o === w || o.dir !== w.dir || o.state !== 'walk') continue;
          let d = (o.t - w.t) * w.dir;
          if (opts.path.closed) d = ((d % 1) + 1) % 1;
          if (d > 0 && d * length < 1.6) w.speed = Math.min(w.speed, o.baseSpeed * 0.9);
        }
        w.t += (w.dir * w.speed * dt) / length;
        if (opts.path.closed) w.t = ((w.t % 1) + 1) % 1;
        else if (w.t > 1 || w.t < 0) { w.dir = (w.dir * -1) as 1 | -1; w.t = THREE.MathUtils.clamp(w.t, 0, 1); }
        curve.getPointAt(w.t, tmp);
        curve.getTangentAt(w.t, tan).multiplyScalar(w.dir);
        r.position.copy(tmp);
        m.lookAt(tan.clone().add(tmp), tmp, THREE.Object3D.DEFAULT_UP);
        target.setFromRotationMatrix(m);
        r.quaternion.slerp(target, 0.15);
        const a = w.inst.actions.get('walk');
        if (a) a.timeScale = w.speed / w.stride;

        // Stall points: pause with idle/talk/wave when passing a free one. A stall that asks for a clip
        // (talk, wave) waits for a walker whose rig owns it; after STALL_OWNER_WAIT s anyone takes it with idle.
        for (let si = 0; si < stalls.length; si++) {
          const s = stalls[si];
          if (occupied.has(si)) continue;
          const clip = s.clip ?? 'idle';
          if (!w.inst.actions.has(clip) && elapsed - vacantSince[si] < STALL_OWNER_WAIT) continue;
          if (tmp.distanceTo(new THREE.Vector3(...s.pos)) < 1.2 && rand() < 0.5 * dt) {
            occupied.add(si); w.stall = si; w.state = 'stall'; w.until = elapsed + 8 + rand() * 12;
            r.position.set(...s.pos);
            if (s.face) { m.lookAt(new THREE.Vector3(...s.face), r.position, THREE.Object3D.DEFAULT_UP); r.quaternion.setFromRotationMatrix(m); }
            w.inst.play(clip);
            break;
          }
        }
      }
      // Movement is always simulated (cheap); far walkers are hidden and skip skinning/mixer work.
      const far = !w.held && camera.position.distanceTo(r.getWorldPosition(wp)) > cull;
      r.visible = !far;
      if (!far) w.inst.mixer.update(dt);
    }
  };
  /** Closest visible walker within `radius` (horizontal distance) of `pos`, or null. */
  const nearest = (pos: THREE.Vector3, radius: number): Walker | null => {
    let best: Walker | null = null, bd = radius;
    for (const w of walkers) {
      if (!w.root.visible) continue;
      const d = Math.hypot(w.root.position.x - pos.x, w.root.position.z - pos.z);
      if (d <= bd) { bd = d; best = w; }
    }
    return best;
  };
  return { group, update, walkers, nearest };
}

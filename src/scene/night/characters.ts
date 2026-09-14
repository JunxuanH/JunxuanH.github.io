import * as THREE from 'three/webgpu';
import {
  texture, uv, color, vec3, float, step, normalize, cameraPosition, positionWorld, normalWorld, dot, max, pow,
  luminance, mx_rgbtohsv, mix,
} from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import type { PathDef } from './paths';

/**
 * Character assets: fal-generated rigs (public/night/characters/<name>/{rigged,walk,run,idle}.glb,
 * see scripts/night-character.sh) and the Kenney CC0 mini-characters (public/night/cc0/*.glb) as a
 * far-crowd fallback. One loader, cached assets, SkeletonUtils clones, one mixer per instance.
 */
export interface CharacterAsset {
  name: string;
  scene: THREE.Group;
  clips: Map<string, THREE.AnimationClip>;
  height: number; // world units (bbox height of the unscaled scene)
  meta?: Record<string, any>;
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

/** Load a fal character (rigged.glb + clip GLBs listed in meta.json). Falls back to model.glb when unrigged. */
export function loadCharacter(name: string, base = '/night/characters'): Promise<CharacterAsset> {
  const key = `${base}/${name}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const gl = gltfLoader();
      const meta = await fetch(`${key}/meta.json`).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
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
      // fal rigs are ~1.75 u tall already; measure to be safe.
      const height = bboxHeight(g.scene) || 1.75;
      return { name, scene: g.scene, clips, height, meta };
    })());
  }
  return cache.get(key)!;
}

/** Kenney mini-character (idle/walk/sit clips baked in). */
export function loadKenney(file = 'character-male-a'): Promise<CharacterAsset> {
  const key = `/night/cc0/${file}`;
  if (!cache.has(key)) {
    cache.set(key, (async () => {
      const g = await gltfLoader().loadAsync(`${key}.glb`);
      const clips = new Map<string, THREE.AnimationClip>();
      g.animations.forEach((c, i) => clips.set(nameClip(c, `clip${i}`), c));
      return { name: file, scene: g.scene, clips, height: bboxHeight(g.scene) || 1 };
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
export function applySkin(root: THREE.Object3D, opts: SkinOptions = {}) {
  const rim = color(opts.rim ?? 0x00e5ff);
  const rimStrength = opts.rimStrength ?? 0.6;
  const tint = opts.tint !== undefined ? color(opts.tint) : null;
  root.traverse((o: any) => {
    if (!o.isMesh) return;
    const src = o.material as THREE.MeshStandardMaterial;
    if ((src as any).__nightSkin) return;
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
      const lit = step(0.55, luminance(base)).mul(step(0.28, hsv.y));
      emissive = emissive.add(base.mul(lit).mul(opts.glowStrength ?? 2.2));
    }
    if (src.emissiveMap) emissive = emissive.add(texture(src.emissiveMap, uv()).rgb.mul(2.0));
    m.emissiveNode = emissive;
    (m as any).__nightSkin = true;
    o.userData.srcMaterial = src; // keeps the original maps inspectable (viewer HUD)
    o.material = m;
    o.castShadow = false;
    o.receiveShadow = false;
    o.frustumCulled = true;
  });
}

export interface Instance {
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: string | null;
  play(name: string, fade?: number): THREE.AnimationAction | null;
  height: number;
  /** Head bone (Meshy `Head` / mixamorig:Head / Kenney `head`) for look-at, when the rig has one. */
  headBone?: THREE.Bone;
}

/** Find the head bone of a rig by common names (Meshy, Mixamo, Kenney). */
export function getHead(root: THREE.Object3D): THREE.Bone | undefined {
  let found: THREE.Bone | undefined;
  root.traverse((o: any) => {
    if (found || !o.isBone) return;
    if (/^(mixamorig:?)?head$|(^|[_:])head$/i.test(o.name)) found = o;
  });
  return found;
}

/** Clone a rig, apply the skin, scale to `height` world units, set up a mixer with all clips. */
export function instantiate(asset: CharacterAsset, opts: SkinOptions & { height?: number } = {}): Instance {
  const root = SkeletonUtils.clone(asset.scene) as THREE.Object3D;
  applySkin(root, opts);
  const height = opts.height ?? 1.75;
  root.scale.setScalar(height / asset.height);
  const mixer = new THREE.AnimationMixer(root);
  const actions = new Map<string, THREE.AnimationAction>();
  for (const [name, clip] of asset.clips) actions.set(name, mixer.clipAction(clip));
  const inst: Instance = {
    root, mixer, actions, current: null, height, headBone: getHead(root),
    play(name, fade = 0.25) {
      const next = actions.get(name) ?? actions.get('idle') ?? [...actions.values()][0];
      if (!next) return null;
      const prev = inst.current ? actions.get(inst.current) : null;
      if (prev === next) return next;
      next.reset().setEffectiveWeight(1).fadeIn(fade).play();
      if (prev) prev.fadeOut(fade);
      inst.current = [...actions.entries()].find(([, a]) => a === next)?.[0] ?? name;
      return next;
    },
  };
  return inst;
}

// ---------- Crowd: walkers on district paths with stalls ----------

export interface CrowdOptions {
  path: PathDef;
  /** Assets cycled through the walkers (fal rigs); Kenney rigs can be mixed in for the far band. */
  assets: CharacterAsset[];
  count: number;
  /** Per-asset skin options (by index, cycled). */
  skins?: SkinOptions[];
  height?: number;
  speed?: [number, number];
  /** Walker clips: names of clips to use (defaults walk/idle). */
  seed?: number;
  /** Hide + stop animating beyond this camera distance. */
  cullDistance?: number;
  /** Walk stride speed of the clip at timeScale 1 (u/s) — keeps feet from sliding. */
  strideSpeed?: number;
}

interface Walker {
  inst: Instance;
  t: number;
  dir: 1 | -1;
  speed: number;
  baseSpeed: number;
  state: 'walk' | 'stall';
  until: number;
  stall: number; // stall index or -1
}

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

export function createCrowd(opts: CrowdOptions) {
  const group = new THREE.Group();
  const curve = new THREE.CatmullRomCurve3(opts.path.points.map((p) => new THREE.Vector3(...p)), opts.path.closed, 'centripetal');
  const length = curve.getLength();
  const rand = rng(opts.seed ?? 1);
  const [smin, smax] = opts.speed ?? [0.9, 1.4];
  const stride = opts.strideSpeed ?? 1.2;
  const stalls = opts.path.stalls ?? [];
  const occupied = new Set<number>();
  const walkers: Walker[] = [];
  const tmp = new THREE.Vector3(), tan = new THREE.Vector3(), target = new THREE.Quaternion(), m = new THREE.Matrix4();
  const wp = new THREE.Vector3();

  for (let i = 0; i < opts.count; i++) {
    const asset = opts.assets[i % opts.assets.length];
    const inst = instantiate(asset, { ...(opts.skins?.[i % (opts.skins.length || 1)] ?? {}), height: opts.height ?? 1.75 });
    const speed = smin + rand() * (smax - smin);
    const w: Walker = { inst, t: i / opts.count + rand() * 0.02, dir: opts.path.closed && rand() < 0.4 ? -1 : 1, speed, baseSpeed: speed, state: 'walk', until: 0, stall: -1 };
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
      if (w.state === 'stall') {
        if (elapsed > w.until) {
          w.state = 'walk';
          if (w.stall >= 0) occupied.delete(w.stall);
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
        if (a) a.timeScale = w.speed / stride;

        // Stall points: pause with idle/talk/wave when passing a free one.
        for (let si = 0; si < stalls.length; si++) {
          const s = stalls[si];
          if (occupied.has(si)) continue;
          if (tmp.distanceTo(new THREE.Vector3(...s.pos)) < 1.2 && rand() < 0.5 * dt) {
            occupied.add(si); w.stall = si; w.state = 'stall'; w.until = elapsed + 8 + rand() * 12;
            r.position.set(...s.pos);
            if (s.face) { m.lookAt(new THREE.Vector3(...s.face), r.position, THREE.Object3D.DEFAULT_UP); r.quaternion.setFromRotationMatrix(m); }
            w.inst.play(s.clip ?? 'idle');
            break;
          }
        }
      }
      // Movement is always simulated (cheap); far walkers are hidden and skip skinning/mixer work.
      const far = camera.position.distanceTo(r.getWorldPosition(wp)) > cull;
      r.visible = !far;
      if (!far) w.inst.mixer.update(dt);
    }
  };
  return { group, update, walkers };
}

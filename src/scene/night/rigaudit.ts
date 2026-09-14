/**
 * Rig audit: numeric QA of a fal/Meshy character (see design/night/characters/README.md, "Audit").
 * `auditRig(asset)` samples every clip by stepping a mixer (`mixer.setTime`) and skinning the vertices
 * itself (the same linear blend the GPU does), so it needs no renderer and runs in the lab page
 * (`/lab/characters?audit=all`) or headless through scripts/rig-audit.mjs. Everything is measured in
 * rig units, which for Meshy rigs are metres (Meshy normalises the bind pose to `height_meters`).
 *
 *  - forward:  the `headfront` marker bone minus `Head` (fallback: toes minus feet) → `yawErr`
 *              (degrees from +z, the runtime's forward) and `mirrored` (left bones on the right side);
 *              the planted-foot velocity over the walk clip gives an independent `walkYawErr`.
 *  - heights:  `bboxRest`, `headY` (Head bone), `headTopY` (top of the head at rest).
 *  - ground:   per-frame lowest skinned vertex over the walk clip → `groundOffset = −p20(minY)`,
 *              `floating` / `sinking` beyond ±0.03, `hover` (minY swings > 0.08 over the loop),
 *              `hipsDrift` (hips leave their start XZ by > 0.1: root motion baked into an in-place clip).
 *  - skin:     `maxDisp` = largest distance between a vertex's blended position and where its dominant
 *              bone alone would put it (> 0.30 walk / 0.40 run = exploding weights), `strayWeights` =
 *              share of vertices with a weight ≥ 0.05 on a bone farther than 0.3 × height away at rest
 *              (> 1 %), `stretch` = p99 over edges of the worst length ratio vs rest (> 2.0; ordinary
 *              joint bending on these low-poly rigs already reaches 1.5).
 *  - stride:   planted-foot linear fits: while a toe stays at ground level its forward coordinate moves
 *              at −stride u/s in an in-place clip; median over contacts → `stride` (walk) / `strideRun`,
 *              `stepLen` (distance between successive footfalls). Values outside 0.8–2.0 / 2.0–7.0 are
 *              reported raw but flagged so the runtime keeps its defaults.
 *  - tracks:   `redundantTracks` = constant translation/scale tracks equal to the rest pose (the loader
 *              already dropped them: `asset.strippedTracks`, plus any still present), `totalTracks`.
 */
import * as THREE from 'three/webgpu';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { redundantTrackFilter, type CharacterAsset } from './characters';

export const AUDIT_LIMITS = {
  yawDeg: 10, walkYawDeg: 25, ground: 0.03, hover: 0.08, hipsDrift: 0.2,
  maxDispWalk: 0.30, maxDispRun: 0.40, strayWeights: 0.01, stretch: 2.0,
  stride: [0.8, 2.0] as const, strideRun: [2.0, 7.0] as const, heightTol: 0.05,
};

export interface FootPhase { foot: 'L' | 'R'; t0: number; t1: number; samples: number; slope: number; vx: number; vz: number }

export interface ClipAudit {
  name: string;
  duration: number;
  tracks: number;
  redundantTracks: number;
  constantRotations: number;
  /** Lowest skinned vertex per sampled frame (rig units). */
  minY: { p20: number; min: number; max: number };
  hipsDrift: number;
  hipsDriftY: number;
  maxDisp: number;
  maxDispBone: string;
  stretch: number;
  stretchMax: number;
  /** Planted-foot speed (u/s at timeScale 1), NaN when no contact phase was found. */
  stride: number;
  strideSign: number;
  cycles: number;
  stepLen: number;
  walkYawErr: number;
  phases: FootPhase[];
}

export interface RigAudit {
  name: string;
  metaHeight: number;
  assetHeight: number;
  vertices: number;
  triangles: number;
  bones: number;
  skinnedMeshes: number;
  bboxRest: { minY: number; maxY: number; height: number; width: number; depth: number };
  headY: number;
  headTopY: number;
  hipsY: number;
  forward: [number, number];
  forwardSource: 'headfront' | 'toes' | 'none';
  yawErr: number;
  mirrored: boolean;
  strayWeights: number;
  strayBones: string[];
  clips: Record<string, ClipAudit>;
  groundOffset: number;
  floating: boolean;
  sinking: boolean;
  hover: boolean;
  hipsDrift: number;
  maxDisp: number;
  stretch: number;
  stride: number;
  strideRun: number;
  stepLen: number;
  stepLenRun: number;
  walkYawErr: number;
  redundantTracks: number;
  totalTracks: number;
  flags: string[];
  ms: number;
}

const bone = (root: THREE.Object3D, name: string) => {
  const re = new RegExp(`(^|[:_.])${name}$`, 'i');
  let found: THREE.Object3D | undefined;
  root.traverse((o: any) => { if (!found && o.isBone && re.test(o.name)) found = o; });
  return found;
};
const percentile = (arr: ArrayLike<number>, p: number) => {
  const s = Array.from(arr).filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))];
};
const median = (arr: number[]) => percentile(arr, 0.5);
const deg = (r: number) => Math.round(THREE.MathUtils.radToDeg(r) * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

interface Subject { root: THREE.Object3D; animRoot: THREE.Object3D; meshes: THREE.SkinnedMesh[] }

/** Skinning tables for one SkinnedMesh: rest positions, weights and the per-frame bone→world matrices. */
class SkinTable {
  n: number;
  rest: Float32Array;
  idx: Uint16Array;
  w: Float32Array;
  dominant: Uint16Array;
  boneMats: Float32Array; // 16 × bones, mesh-local-with-world: meshWorld · bindInv · boneMatrix · bind
  edges: Uint32Array;
  restLen: Float32Array;
  constructor(public mesh: THREE.SkinnedMesh) {
    const g = mesh.geometry;
    const pos = g.attributes.position as THREE.BufferAttribute;
    const si = g.attributes.skinIndex as THREE.BufferAttribute;
    const sw = g.attributes.skinWeight as THREE.BufferAttribute;
    this.n = pos.count;
    this.rest = new Float32Array(this.n * 3);
    this.idx = new Uint16Array(this.n * 4);
    this.w = new Float32Array(this.n * 4);
    this.dominant = new Uint16Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.rest[i * 3] = pos.getX(i); this.rest[i * 3 + 1] = pos.getY(i); this.rest[i * 3 + 2] = pos.getZ(i);
      const ws = [sw.getX(i), sw.getY(i), sw.getZ(i), sw.getW(i)];
      const is = [si.getX(i), si.getY(i), si.getZ(i), si.getW(i)];
      const sum = ws[0] + ws[1] + ws[2] + ws[3] || 1;
      let best = 0;
      for (let k = 0; k < 4; k++) { this.w[i * 4 + k] = ws[k] / sum; this.idx[i * 4 + k] = is[k]; if (ws[k] > ws[best]) best = k; }
      this.dominant[i] = is[best];
    }
    this.boneMats = new Float32Array(mesh.skeleton.bones.length * 16);
    // Unique undirected edges of the triangle list.
    const index = g.index ? g.index.array : null;
    const triCount = (index ? index.length : this.n) / 3;
    const seen = new Set<number>();
    const e: number[] = [];
    for (let t = 0; t < triCount; t++) {
      const a = index ? index[t * 3] : t * 3, b = index ? index[t * 3 + 1] : t * 3 + 1, c = index ? index[t * 3 + 2] : t * 3 + 2;
      for (const [p, q] of [[a, b], [b, c], [c, a]]) {
        const lo = Math.min(p, q), hi = Math.max(p, q), key = lo * 4294967296 + hi;
        if (seen.has(key)) continue;
        seen.add(key); e.push(lo, hi);
      }
    }
    this.edges = Uint32Array.from(e);
    this.restLen = new Float32Array(this.edges.length / 2);
  }
  /** Rebuild the bone matrices for the mesh's current pose (call after updateMatrixWorld + skeleton.update). */
  update() {
    const { mesh } = this;
    const sk = mesh.skeleton;
    const tmp = new THREE.Matrix4(), bm = new THREE.Matrix4();
    for (let b = 0; b < sk.bones.length; b++) {
      bm.fromArray(sk.boneMatrices!, b * 16);
      tmp.copy(mesh.matrixWorld).multiply(mesh.bindMatrixInverse).multiply(bm).multiply(mesh.bindMatrix);
      tmp.toArray(this.boneMats, b * 16);
    }
  }
  /** Blend a rest vertex with matrix `b` (index into boneMats). */
  private apply(b: number, x: number, y: number, z: number, out: Float32Array, o: number, wgt: number) {
    const m = this.boneMats, k = b * 16;
    out[o] += wgt * (m[k] * x + m[k + 4] * y + m[k + 8] * z + m[k + 12]);
    out[o + 1] += wgt * (m[k + 1] * x + m[k + 5] * y + m[k + 9] * z + m[k + 13]);
    out[o + 2] += wgt * (m[k + 2] * x + m[k + 6] * y + m[k + 10] * z + m[k + 14]);
  }
  /** Skinned world positions (`out`, 3n) and the dominant-bone-only positions (`dom`, 3n). */
  skin(out: Float32Array, dom?: Float32Array) {
    out.fill(0); dom?.fill(0);
    for (let i = 0; i < this.n; i++) {
      const x = this.rest[i * 3], y = this.rest[i * 3 + 1], z = this.rest[i * 3 + 2];
      for (let k = 0; k < 4; k++) { const wgt = this.w[i * 4 + k]; if (wgt > 0) this.apply(this.idx[i * 4 + k], x, y, z, out, i * 3, wgt); }
      if (dom) this.apply(this.dominant[i], x, y, z, dom, i * 3, 1);
    }
  }
}

function subjectOf(asset: CharacterAsset, fixed: boolean, clip?: string): Subject {
  // `fixed` audits the runtime instance (pivot with yaw / groundOffset / height from rigs.ts); the plain
  // path audits the raw rig. The import is dynamic-free: characters.ts imports nothing from here.
  const root: THREE.Object3D = SkeletonUtils.clone(asset.scene) as THREE.Object3D;
  let animRoot = root;
  let subject: THREE.Object3D = root;
  if (fixed) {
    const { rigMeta } = fixedDeps;
    const meta = rigMeta(asset.name, asset);
    const pivot = new THREE.Group();
    root.rotation.y = meta.yaw;
    const s = meta.height / asset.height;
    root.scale.setScalar(s);
    root.position.y = fixedDeps.groundOffsetFor(meta, clip) * s;
    pivot.add(root);
    subject = pivot;
    animRoot = root;
  }
  subject.updateMatrixWorld(true);
  const meshes: THREE.SkinnedMesh[] = [];
  subject.traverse((o: any) => { if (o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) m.skeleton.update();
  return { root: subject, animRoot, meshes };
}
/** rigs.ts is loaded by the lab page; the audit stays importable without it (`fixed` needs it). */
type MetaLike = { yaw: number; height: number; groundOffset: number };
const fixedDeps: { rigMeta: (name: string, asset: { height: number }) => MetaLike; groundOffsetFor: (meta: any, clip?: string) => number } = {
  rigMeta: () => ({ yaw: 0, height: 1.75, groundOffset: 0 }),
  groundOffsetFor: (meta) => meta.groundOffset,
};
export function setRigMetaProvider(fn: typeof fixedDeps.rigMeta, offsetFor?: typeof fixedDeps.groundOffsetFor) { fixedDeps.rigMeta = fn; if (offsetFor) fixedDeps.groundOffsetFor = offsetFor; }

function poseAt(subject: Subject, mixer: THREE.AnimationMixer, t: number) {
  mixer.setTime(t);
  subject.root.updateMatrixWorld(true);
  for (const m of subject.meshes) m.skeleton.update();
}

const wp = new THREE.Vector3();
const worldPos = (o: THREE.Object3D) => o.getWorldPosition(wp).clone();

function auditClip(asset: CharacterAsset, name: string, clip: THREE.AnimationClip, fixed: boolean, fwd: THREE.Vector2, samples: number): ClipAudit {
  const S = samples;
  const subject = subjectOf(asset, fixed, name);
  const tables = subject.meshes.map((m) => new SkinTable(m));
  const buf = tables.map((t) => new Float32Array(t.n * 3));
  const dom = tables.map((t) => new Float32Array(t.n * 3));
  const edgeMax = tables.map((t) => new Float32Array(t.edges.length / 2).fill(0));
  // Rest lengths from the bind pose (the subject is still at rest here).
  tables.forEach((t, i) => {
    t.update(); t.skin(buf[i]);
    for (let e = 0; e < t.edges.length / 2; e++) {
      const a = t.edges[e * 2] * 3, b = t.edges[e * 2 + 1] * 3;
      t.restLen[e] = Math.hypot(buf[i][a] - buf[i][b], buf[i][a + 1] - buf[i][b + 1], buf[i][a + 2] - buf[i][b + 2]);
    }
  });
  const filter = redundantTrackFilter(subject.animRoot);
  let redundant = 0, constRot = 0;
  for (const tr of clip.tracks) { const k = filter(tr); if (k === 'redundant') redundant++; else if (k === 'constant-rotation') constRot++; }

  const mixer = new THREE.AnimationMixer(subject.animRoot);
  mixer.clipAction(clip).play();
  const hips = bone(subject.root, 'Hips');
  const toeL = bone(subject.root, 'LeftToeBase') ?? bone(subject.root, 'LeftFoot');
  const toeR = bone(subject.root, 'RightToeBase') ?? bone(subject.root, 'RightFoot');
  const hips0 = hips ? (poseAt(subject, mixer, 0), worldPos(hips)) : null;

  const minYs: number[] = [];
  let maxDisp = 0, maxDispBone = '';
  let hipsDrift = 0, hipsDriftY = 0;
  for (let k = 0; k < S; k++) {
    poseAt(subject, mixer, (clip.duration * k) / S);
    let minY = Infinity;
    tables.forEach((t, i) => {
      t.update(); t.skin(buf[i], dom[i]);
      const p = buf[i], d = dom[i];
      for (let v = 0; v < t.n; v++) {
        const y = p[v * 3 + 1];
        if (y < minY) minY = y;
        const dd = Math.hypot(p[v * 3] - d[v * 3], y - d[v * 3 + 1], p[v * 3 + 2] - d[v * 3 + 2]);
        if (dd > maxDisp) { maxDisp = dd; maxDispBone = t.mesh.skeleton.bones[t.dominant[v]]?.name ?? '?'; }
      }
      const em = edgeMax[i];
      for (let e = 0; e < t.edges.length / 2; e++) {
        const rl = t.restLen[e];
        if (rl < 0.002) continue;
        const a = t.edges[e * 2] * 3, b = t.edges[e * 2 + 1] * 3;
        const r = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]) / rl;
        if (r > em[e]) em[e] = r;
      }
    });
    minYs.push(minY);
    if (hips && hips0) {
      const h = worldPos(hips);
      hipsDrift = Math.max(hipsDrift, Math.hypot(h.x - hips0.x, h.z - hips0.z));
      hipsDriftY = Math.max(hipsDriftY, Math.abs(h.y - hips0.y));
    }
  }
  const allEdgeMax = edgeMax.flatMap((e) => Array.from(e).filter((v) => v > 0));

  // Planted-foot fits at a finer step (bones only).
  const F = Math.max(S * 3, 96);
  const feet: { foot: 'L' | 'R'; b: THREE.Object3D }[] = [];
  if (toeL) feet.push({ foot: 'L', b: toeL });
  if (toeR) feet.push({ foot: 'R', b: toeR });
  const phases: FootPhase[] = [];
  let cycles = 0;
  for (const { foot, b } of feet) {
    const ys: number[] = [], xs: number[] = [], zs: number[] = [], ts: number[] = [];
    for (let k = 0; k < F; k++) {
      const t = (clip.duration * k) / F;
      poseAt(subject, mixer, t);
      const p = worldPos(b);
      ys.push(p.y); xs.push(p.x); zs.push(p.z); ts.push(t);
    }
    const floor = Math.min(...ys);
    const planted = ys.map((y) => y - floor < 0.04);
    // Rotate the series so it starts on a non-planted sample (the loop can wrap mid-contact).
    let start = planted.indexOf(false);
    if (start < 0) start = 0;
    let run: number[] = [];
    let count = 0;
    const flush = () => {
      // A contact needs ≥ 10 samples; the fit uses its middle 60 % (heel strike and toe-off slide a little).
      if (run.length >= 10) {
        count++;
        const trim = Math.floor(run.length * 0.2);
        const mid = run.slice(trim, run.length - trim);
        const n = mid.length;
        let st = 0, ss = 0, sx = 0, sz = 0, stt = 0, sts = 0, stx = 0, stz = 0;
        mid.forEach((i, j) => {
          const t = (j * clip.duration) / F; // consecutive samples: uniform spacing, immune to the loop wrap
          const s = xs[i] * fwd.x + zs[i] * fwd.y;
          st += t; ss += s; sx += xs[i]; sz += zs[i]; stt += t * t; sts += t * s; stx += t * xs[i]; stz += t * zs[i];
        });
        const den = n * stt - st * st || 1e-9;
        phases.push({ foot, t0: ts[run[0]], t1: ts[run[run.length - 1]], samples: run.length, slope: (n * sts - st * ss) / den, vx: (n * stx - st * sx) / den, vz: (n * stz - st * sz) / den });
      }
      run = [];
    };
    for (let j = 0; j < F; j++) {
      const i = (start + j) % F;
      if (planted[i]) run.push(i); else flush();
    }
    flush();
    cycles = Math.max(cycles, count);
  }
  mixer.stopAllAction();
  // Stride = contact-length-weighted mean of the planted-foot speeds (both feet, every contact).
  const wsum = phases.reduce((a, p) => a + p.samples, 0);
  const stride = wsum ? phases.reduce((a, p) => a + Math.abs(p.slope) * p.samples, 0) / wsum : NaN;
  const strideSign = wsum ? Math.sign(phases.reduce((a, p) => a + p.slope * p.samples, 0)) : 0;
  // Feet move opposite to the walking direction: the character's forward is −(mean planted velocity).
  let walkYawErr = NaN;
  if (phases.length) {
    const vx = median(phases.map((p) => p.vx)), vz = median(phases.map((p) => p.vz));
    if (Math.hypot(vx, vz) > 0.05) {
      const yawWalk = Math.atan2(-vx, -vz), yawFwd = Math.atan2(fwd.x, fwd.y);
      walkYawErr = deg(Math.atan2(Math.sin(yawWalk - yawFwd), Math.cos(yawWalk - yawFwd)));
    }
  }
  return {
    name, duration: r3(clip.duration), tracks: clip.tracks.length, redundantTracks: redundant, constantRotations: constRot,
    minY: { p20: r3(percentile(minYs, 0.2)), min: r3(Math.min(...minYs)), max: r3(Math.max(...minYs)) },
    hipsDrift: r3(hipsDrift), hipsDriftY: r3(hipsDriftY),
    maxDisp: r3(maxDisp), maxDispBone, stretch: r3(percentile(allEdgeMax, 0.99)), stretchMax: r3(Math.max(0, ...allEdgeMax)),
    stride: r3(stride), strideSign, cycles, stepLen: cycles && Number.isFinite(stride) ? r3((stride * clip.duration) / (2 * cycles)) : NaN,
    walkYawErr, phases: phases.map((p) => ({ ...p, t0: r3(p.t0), t1: r3(p.t1), slope: r3(p.slope), vx: r3(p.vx), vz: r3(p.vz) })),
  };
}

export interface AuditOptions {
  /** Audit the runtime instance (rigs.ts pivot) instead of the raw rig. */
  fixed?: boolean;
  /** Skinned samples per clip (the foot fits use 3× as many bone-only samples). */
  samples?: number;
  /** Clips to audit (default: every clip the asset has). */
  clips?: string[];
}

export function auditRig(asset: CharacterAsset, opts: AuditOptions = {}): RigAudit {
  const t0 = performance.now();
  const fixed = !!opts.fixed;
  const subject = subjectOf(asset, fixed);
  const tables = subject.meshes.map((m) => new SkinTable(m));
  const metaHeight = Number(asset.meta?.height_meters) || asset.height;

  // Rest pose: bbox from skinned vertices, bones.
  const box = new THREE.Box3();
  let vertices = 0, triangles = 0;
  tables.forEach((t) => {
    t.update();
    const p = new Float32Array(t.n * 3); t.skin(p);
    for (let v = 0; v < t.n; v++) box.expandByPoint(wp.set(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]));
    vertices += t.n; triangles += t.edges.length ? (t.mesh.geometry.index ? t.mesh.geometry.index.count : t.n) / 3 : 0;
  });
  const bones: THREE.Bone[] = [];
  subject.root.traverse((o: any) => { if (o.isBone) bones.push(o); });
  const head = bone(subject.root, 'Head'), headFront = bone(subject.root, 'headfront'), headEnd = bone(subject.root, 'head_end');
  const hips = bone(subject.root, 'Hips');
  const toeL = bone(subject.root, 'LeftToeBase'), toeR = bone(subject.root, 'RightToeBase');
  const footL = bone(subject.root, 'LeftFoot'), footR = bone(subject.root, 'RightFoot');
  const armL = bone(subject.root, 'LeftArm') ?? bone(subject.root, 'LeftShoulder'), armR = bone(subject.root, 'RightArm') ?? bone(subject.root, 'RightShoulder');

  let forward = new THREE.Vector2(0, 1), forwardSource: RigAudit['forwardSource'] = 'none';
  if (head && headFront) {
    const h = worldPos(head), f = worldPos(headFront);
    const v = new THREE.Vector2(f.x - h.x, f.z - h.z);
    if (v.length() > 0.01) { forward = v.normalize(); forwardSource = 'headfront'; }
  }
  if (forwardSource === 'none' && toeL && toeR && footL && footR) {
    const tl = worldPos(toeL), tr = worldPos(toeR), fl = worldPos(footL), fr = worldPos(footR);
    const v = new THREE.Vector2((tl.x + tr.x - fl.x - fr.x) / 2, (tl.z + tr.z - fl.z - fr.z) / 2);
    if (v.length() > 0.01) { forward = v.normalize(); forwardSource = 'toes'; }
  }
  const yawErr = deg(Math.atan2(forward.x, forward.y));
  let mirrored = false;
  if (armL && armR) {
    const l = worldPos(armL), r = worldPos(armR);
    // left = up × forward = (fz, 0, −fx): a +z-facing rig has its left arm at +x.
    const leftAxis = new THREE.Vector2(forward.y, -forward.x);
    mirrored = (l.x - r.x) * leftAxis.x + (l.z - r.z) * leftAxis.y < 0;
  }
  const headY = head ? r3(worldPos(head).y) : NaN;
  const headTopY = r3(headEnd ? Math.max(worldPos(headEnd).y, box.max.y) : box.max.y);
  const hipsY = hips ? r3(worldPos(hips).y) : NaN;

  // Stray weights: a weight ≥ 0.05 on a bone whose segment (bone → nearest child) is far from the rest vertex.
  let stray = 0;
  const strayCount = new Map<string, number>();
  const R = 0.3 * (box.max.y - box.min.y);
  const segA = new THREE.Vector3(), segB = new THREE.Vector3(), pt = new THREE.Vector3(), tmpV = new THREE.Vector3();
  tables.forEach((t) => {
    const p = new Float32Array(t.n * 3); t.update(); t.skin(p);
    const sk = t.mesh.skeleton;
    const segs = sk.bones.map((b) => {
      const a = worldPos(b);
      const kids = b.children.filter((c: any) => c.isBone).map((c) => worldPos(c));
      return { a, kids: kids.length ? kids : [a] };
    });
    for (let v = 0; v < t.n; v++) {
      pt.set(p[v * 3], p[v * 3 + 1], p[v * 3 + 2]);
      let isStray = false;
      for (let k = 0; k < 4; k++) {
        const wgt = t.w[v * 4 + k];
        if (wgt < 0.05) continue;
        const s = segs[t.idx[v * 4 + k]];
        if (!s) continue;
        let dmin = Infinity;
        for (const kid of s.kids) {
          segA.copy(s.a); segB.copy(kid);
          const ab = tmpV.subVectors(segB, segA), l2 = ab.lengthSq();
          const u = l2 > 1e-8 ? THREE.MathUtils.clamp(pt.clone().sub(segA).dot(ab) / l2, 0, 1) : 0;
          dmin = Math.min(dmin, pt.distanceTo(segA.addScaledVector(ab, u)));
        }
        if (dmin > R) { isStray = true; const n = sk.bones[t.idx[v * 4 + k]].name; strayCount.set(n, (strayCount.get(n) ?? 0) + 1); }
      }
      if (isStray) stray++;
    }
  });
  const strayWeights = vertices ? stray / vertices : 0;
  const strayBones = [...strayCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, c]) => `${n}:${c}`);

  // Clips.
  const clips: Record<string, ClipAudit> = {};
  const wanted = opts.clips ?? [...asset.clips.keys()];
  for (const name of wanted) {
    const clip = asset.clips.get(name);
    if (!clip) continue;
    try { clips[name] = auditClip(asset, name, clip, fixed, forward, opts.samples ?? 32); }
    catch (e) { console.warn('[rigaudit] clip failed', asset.name, name, e); }
  }
  const walk = clips.walk, run = clips.run;
  const groundClip = walk ?? run ?? clips.idle;
  const groundOffset = groundClip ? r3(-groundClip.minY.p20) : 0;
  const hover = groundClip ? groundClip.minY.max - groundClip.minY.min > AUDIT_LIMITS.hover : false;
  const strideOk = walk && walk.stride >= AUDIT_LIMITS.stride[0] && walk.stride <= AUDIT_LIMITS.stride[1];
  const strideRunOk = run && run.stride >= AUDIT_LIMITS.strideRun[0] && run.stride <= AUDIT_LIMITS.strideRun[1];
  const maxDisp = Math.max(0, ...Object.values(clips).map((c) => c.maxDisp));
  const stretch = Math.max(0, ...Object.values(clips).map((c) => c.stretch));
  const hipsDrift = Math.max(0, ...Object.values(clips).map((c) => c.hipsDrift));
  const redundantTracks = (asset.strippedTracks ?? 0) + Object.values(clips).reduce((a, c) => a + c.redundantTracks, 0);
  const totalTracks = (asset.strippedTracks ?? 0) + Object.values(clips).reduce((a, c) => a + c.tracks, 0);

  const flags: string[] = [];
  if (forwardSource === 'none') flags.push('no-forward');
  if (Math.abs(yawErr) > AUDIT_LIMITS.yawDeg) flags.push(`yaw ${yawErr}°`);
  if (mirrored) flags.push('mirrored');
  if (walk && Number.isFinite(walk.walkYawErr) && Math.abs(walk.walkYawErr) > AUDIT_LIMITS.walkYawDeg) flags.push(`walk-yaw ${walk.walkYawErr}°`);
  if (Math.abs(box.max.y - box.min.y - metaHeight) > AUDIT_LIMITS.heightTol) flags.push(`height ${r3(box.max.y - box.min.y)}≠${metaHeight}`);
  if (groundClip && -groundOffset > AUDIT_LIMITS.ground) flags.push(`floating ${r3(-groundOffset)}`);
  if (groundClip && -groundOffset < -AUDIT_LIMITS.ground) flags.push(`sinking ${r3(groundOffset)}`);
  if (hover) flags.push('hover');
  if (hipsDrift > AUDIT_LIMITS.hipsDrift) flags.push(`hips-drift ${r3(hipsDrift)}`);
  if (walk && walk.maxDisp > AUDIT_LIMITS.maxDispWalk) flags.push(`explode-walk ${walk.maxDisp}@${walk.maxDispBone}`);
  if (run && run.maxDisp > AUDIT_LIMITS.maxDispRun) flags.push(`explode-run ${run.maxDisp}@${run.maxDispBone}`);
  if (clips.idle && clips.idle.maxDisp > AUDIT_LIMITS.maxDispRun) flags.push(`explode-idle ${clips.idle.maxDisp}@${clips.idle.maxDispBone}`);
  if (strayWeights > AUDIT_LIMITS.strayWeights) flags.push(`stray ${(strayWeights * 100).toFixed(1)}%`);
  if (stretch > AUDIT_LIMITS.stretch) flags.push(`stretch ${stretch}`);
  if (!walk) flags.push('no-walk'); else if (!strideOk) flags.push(`stride-odd ${walk.stride}`);
  if (!run) flags.push('no-run'); else if (!strideRunOk) flags.push(`stride-run-odd ${run.stride}`);
  if (!clips.idle) flags.push('no-idle');

  return {
    name: asset.name, metaHeight, assetHeight: r3(asset.height), vertices, triangles: Math.round(triangles), bones: bones.length, skinnedMeshes: subject.meshes.length,
    bboxRest: { minY: r3(box.min.y), maxY: r3(box.max.y), height: r3(box.max.y - box.min.y), width: r3(box.max.x - box.min.x), depth: r3(box.max.z - box.min.z) },
    headY, headTopY, hipsY, forward: [r3(forward.x), r3(forward.y)], forwardSource, yawErr, mirrored,
    strayWeights: r3(strayWeights), strayBones, clips,
    groundOffset, floating: groundClip ? -groundOffset > AUDIT_LIMITS.ground : false, sinking: groundClip ? -groundOffset < -AUDIT_LIMITS.ground : false, hover, hipsDrift: r3(hipsDrift),
    maxDisp: r3(maxDisp), stretch: r3(stretch),
    stride: strideOk ? walk!.stride : NaN, strideRun: strideRunOk ? run!.stride : NaN,
    stepLen: strideOk ? walk!.stepLen : NaN, stepLenRun: strideRunOk ? run!.stepLen : NaN,
    walkYawErr: walk?.walkYawErr ?? NaN,
    redundantTracks, totalTracks, flags, ms: Math.round(performance.now() - t0),
  };
}

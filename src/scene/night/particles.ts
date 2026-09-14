import * as THREE from 'three/webgpu';
import {
  attribute, vec2, vec3, float, fract, floor, time, sin, cos, positionLocal, uniform, smoothstep, mix, color,
  texture, uv, mx_noise_float, cameraWorldMatrix, abs, max, step,
} from 'three/tsl';
import { SECTIONS, type SectionId } from './journey';
import { rng, type Tier } from './palette';

/*
 * Particles & weather, all on the GPU: every system is one InstancedMesh whose per-instance
 * seeds (aSeed) and, where needed, anchor points (aAnchor) are baked once; positions, lifetimes and
 * fades are functions of `time` in positionNode/opacityNode. The CPU only sets a few uniforms
 * (active gate, wind, box centre). Quads face the camera via the camera's world-matrix basis, so
 * meshes stay at the origin with an identity transform (positionNode is world space).
 *
 *   sakura — falling petals in a box (Japantown campus)
 *   steam  — rising puffs from stall roofs / vents (Kabuki alley)
 *   sparks — welder burst from a point (alley mouth)
 *   spray  — sea spray bursting up from pier pilings on wave peaks
 *   koi    — holographic koi swimming flat quads along loops (pond / bay edge)
 */

export type ParticleKind = 'sakura' | 'steam' | 'sparks' | 'spray' | 'koi';
export type V3 = [number, number, number];

export interface ParticleSpec {
  kind: ParticleKind;
  /** Journey section that keeps this system alive (±0.02 p feather). */
  section: SectionId;
  /** sakura: spawn box. */
  box?: { center: V3; size: V3 };
  /** steam / spray: anchor points (stall roofs, pilings). */
  points?: V3[];
  /** sparks: emitter. */
  origin?: V3;
  /** koi: closed loops (each becomes one swimmer path; swimmers are spread over the loops). */
  loops?: V3[][];
  /** Override the per-tier count. */
  count?: number;
  /** Tint override (steam / sparks / spray). */
  tint?: number;
  /** sakura: petal size in world units (default 0.22). */
  size?: number;
}

export interface ParticleSystem {
  kind: ParticleKind;
  mesh: THREE.Object3D;
  /** p = journey progress; drives the section gate. dt for CPU-side movers (koi). */
  update(p: number, dt: number): void;
  setWind(v: number): void;
  /** Current gate value 0..1. */
  readonly active: number;
}

export interface ParticleOptions { motion?: boolean }

const COUNTS: Record<ParticleKind, Record<Tier, number>> = {
  sakura: { high: 2400, med: 1200, low: 400 },
  steam: { high: 12, med: 8, low: 4 },
  sparks: { high: 300, med: 150, low: 0 },
  spray: { high: 400, med: 200, low: 0 },
  koi: { high: 6, med: 6, low: 4 },
};

const TWO_PI = Math.PI * 2;

/**
 * A texture that draws immediately (soft disc) and swaps to the real sprite sheet once it loads;
 * `sheet` (uniform 0/1) lets the shader switch from whole-texture UVs to per-cell UVs.
 */
function lazyTexture(url: string | null, drawFallback: (g: CanvasRenderingContext2D, s: number) => void, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  drawFallback(c.getContext('2d')!, size);
  const tex = new THREE.Texture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const sheet = uniform(0);
  if (url) {
    new THREE.ImageLoader().load(url, (img) => { tex.image = img; tex.needsUpdate = true; sheet.value = 1; }, undefined, () => {});
  }
  return { tex, sheet };
}

const discFallback = (tintCss: string) => (g: CanvasRenderingContext2D, s: number) => {
  const r = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  r.addColorStop(0, tintCss);
  r.addColorStop(0.6, tintCss.replace(/[\d.]+\)$/, '0.5)'));
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, s, s);
};

/** Instanced quad geometry with a vec4 seed per instance (+ optional vec3 anchor). */
function instancedQuads(count: number, w: number, h: number, seed: number, anchors?: V3[]) {
  const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(w, h) as any) as THREE.InstancedBufferGeometry;
  const r = rng(seed);
  const seeds = new Float32Array(count * 4);
  for (let i = 0; i < count * 4; i++) seeds[i] = r();
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  if (anchors && anchors.length) {
    const a = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const p = anchors[i % anchors.length];
      a[i * 3] = p[0]; a[i * 3 + 1] = p[1]; a[i * 3 + 2] = p[2];
    }
    geo.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(a, 3));
  }
  geo.instanceCount = count;
  return geo;
}

/** World-space camera-facing quad corner: centre + right·x + up·y (optionally spun by `angle`). */
function billboard(center: any, sx: any, sy: any, angle?: any) {
  const right = cameraWorldMatrix.element(0).xyz;
  const up = cameraWorldMatrix.element(1).xyz;
  let lx: any = positionLocal.x, ly: any = positionLocal.y;
  if (angle) {
    const c = cos(angle), s = sin(angle);
    const rx = lx.mul(c).sub(ly.mul(s)), ry = lx.mul(s).add(ly.mul(c));
    lx = rx; ly = ry;
  }
  return center.add(right.mul(lx.mul(sx))).add(up.mul(ly.mul(sy)));
}

function gate(section: SectionId) {
  const s = SECTIONS.find((x) => x.id === section)!;
  return (p: number) => THREE.MathUtils.smoothstep(p, s.start - 0.02, s.start) * (1 - THREE.MathUtils.smoothstep(p, s.end, s.end + 0.02));
}

export function createParticles(spec: ParticleSpec, tier: Tier, opts: ParticleOptions = {}): ParticleSystem {
  const motion = opts.motion !== false;
  const t: any = motion ? time : float(0);
  const active = uniform(0);
  const wind = uniform(0);
  const count = spec.count ?? COUNTS[spec.kind][tier];
  const gateFn = gate(spec.section);
  let activeValue = 0;
  const base = { kind: spec.kind, setWind: (v: number) => { wind.value = v; }, get active() { return activeValue; } };

  if (spec.kind === 'koi') return createKoi(spec, count, t, active, gateFn, base, motion);
  if (count <= 0) {
    const empty = new THREE.Group();
    return { ...base, mesh: empty, update: () => {} } as ParticleSystem;
  }

  let mesh: THREE.InstancedMesh;
  const seed = attribute('aSeed', 'vec4');

  if (spec.kind === 'sakura') {
    const box = spec.box ?? { center: [0, 8, 0], size: [40, 16, 40] };
    const center = uniform(new THREE.Vector3(...box.center));
    const size = new THREE.Vector3(...box.size);
    const geo = instancedQuads(count, spec.size ?? 0.22, spec.size ?? 0.22, 101);
    const { tex, sheet } = lazyTexture('/night/particles/sakura.webp', discFallback('rgba(255,154,213,1)'), 64);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.fog = false;
    // Fall + drift: y wraps through the box; x/z sway with a per-petal phase and the shared wind.
    const fallSpeed = seed.z.mul(0.35).add(0.6);
    const yFrac = fract(seed.y.sub(t.mul(fallSpeed).mul(0.045)));
    const phase = seed.w.mul(TWO_PI);
    const sway = sin(t.mul(0.8).add(phase)).mul(1.2).add(sin(t.mul(0.3).add(seed.x.mul(6.0))).mul(wind).mul(2.0));
    const xFrac = fract(seed.x.add(t.mul(wind.mul(0.015).add(0.004))));
    const px = center.x.add(xFrac.sub(0.5).mul(size.x)).add(sway);
    const py = center.y.sub(size.y * 0.5).add(yFrac.mul(size.y));
    const pz = center.z.add(seed.z.sub(0.5).mul(size.z)).add(cos(t.mul(0.6).add(phase)).mul(0.8));
    const spin = t.mul(seed.z.mul(2.0).add(1.5)).add(phase);
    const tumble = abs(cos(t.mul(1.7).add(phase))).mul(0.6).add(0.4); // fake 3D tumbling by squashing
    mat.positionNode = billboard(vec3(px, py, pz), tumble, float(1.0), spin);
    // Sheet cell (4×2) per petal; the fallback disc ignores the offset harmlessly.
    const cell = floor(seed.w.mul(8.0));
    const cuv = vec2(uv().x.mul(0.25).add(fract(cell.mul(0.25))), uv().y.mul(0.5).add(floor(cell.mul(0.25)).mul(0.5)));
    const s = texture(tex, mix(uv(), cuv, sheet));
    mat.colorNode = mix(color(0xff9ad5), color(0xffe6f5), seed.x).mul(s.rgb.mul(0.6).add(0.4)).mul(1.6);
    const fade = smoothstep(0.0, 0.08, yFrac).mul(smoothstep(1.0, 0.85, yFrac));
    mat.opacityNode = s.a.mul(fade).mul(active).mul(0.95);
    mesh = new THREE.InstancedMesh(geo, mat, count);
  } else if (spec.kind === 'steam') {
    const pts = spec.points ?? [[0, 2, 0]];
    const geo = instancedQuads(count, 1, 1, 102, pts);
    const anchor = attribute('aAnchor', 'vec3');
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const life = fract(t.mul(0.25).add(seed.x)); // 4 s loop
    const rise = life.mul(4.0);
    const drift = sin(t.mul(0.5).add(seed.y.mul(TWO_PI))).mul(0.6).mul(life);
    const centre = anchor.add(vec3(drift, rise, cos(t.mul(0.4).add(seed.z.mul(TWO_PI))).mul(0.4).mul(life)));
    const scale = life.mul(3.0).add(2.0);
    mat.positionNode = billboard(centre, scale, scale, seed.w.mul(TWO_PI));
    const n = mx_noise_float(vec3(uv().mul(3.0).add(vec2(0, t.mul(0.3))), seed.y.mul(10.0))).mul(0.5).add(0.5);
    const d = uv().sub(0.5).length();
    const puff = smoothstep(0.5, 0.15, d).mul(n);
    mat.colorNode = mix(color(spec.tint ?? 0x8a8ea0), color(0xffb070), 0.25).mul(1.1);
    mat.opacityNode = puff.mul(float(1).sub(life)).mul(smoothstep(0.0, 0.15, life)).mul(0.4).mul(active);
    mesh = new THREE.InstancedMesh(geo, mat, count);
  } else if (spec.kind === 'sparks') {
    const origin = uniform(new THREE.Vector3(...(spec.origin ?? [0, 1, 0])));
    const geo = instancedQuads(count, 0.05, 0.05, 103);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    mat.fog = false;
    const life = fract(t.mul(1.6).add(seed.x)); // 0.6 s
    const lt = life.mul(0.6);
    const v0 = vec3(seed.y.sub(0.5).mul(9.0), seed.z.mul(6.0).add(2.5), seed.w.sub(0.5).mul(9.0));
    const pos = origin.add(v0.mul(lt)).add(vec3(0, lt.mul(lt).mul(-4.9), 0));
    const len = float(1.0).add(seed.z.mul(2.0));
    mat.positionNode = billboard(pos, float(1.0), len, seed.y.mul(TWO_PI)); // elongated streaks
    mat.colorNode = mix(color(0xffd27a), color(spec.tint ?? 0xff9a3d), seed.w).mul(3.0);
    mat.opacityNode = float(1).sub(life).mul(step(0.04, life)).mul(active);
    mesh = new THREE.InstancedMesh(geo, mat, count);
  } else { // spray
    const pts = spec.points ?? [[0, 0, 0]];
    const geo = instancedQuads(count, 0.35, 0.35, 104, pts);
    const anchor = attribute('aAnchor', 'vec3');
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const life = fract(t.mul(0.83).add(seed.x)); // 1.2 s
    const ang = seed.y.mul(TWO_PI);
    const r = seed.z.mul(1.6).add(0.4);
    const peak = smoothstep(0.2, 1.0, sin(t.mul(1.1).add(anchor.x.mul(0.3)).add(anchor.z.mul(0.2)))); // rough sync with the swell
    const pos = anchor.add(vec3(cos(ang).mul(r).mul(life), life.mul(3.2).sub(life.mul(life).mul(3.2)), sin(ang).mul(r).mul(life)));
    const s = seed.w.mul(0.8).add(0.6);
    mat.positionNode = billboard(pos, s, s);
    const d = uv().sub(0.5).length();
    const disc = smoothstep(0.5, 0.2, d);
    mat.colorNode = mix(color(0xdfe8ff), color(spec.tint ?? 0x2ec4b6), 0.2).mul(1.5);
    mat.opacityNode = disc.mul(float(1).sub(life)).mul(peak).mul(0.6).mul(active);
    mesh = new THREE.InstancedMesh(geo, mat, count);
  }

  mesh.frustumCulled = false;
  mesh.visible = false;
  const update = (p: number) => {
    activeValue = gateFn(p);
    active.value = activeValue;
    mesh.visible = activeValue > 0.01;
  };
  return { kind: spec.kind, mesh, update, setWind: base.setWind, get active() { return activeValue; } };
}

/** Holographic koi: flat quads riding CatmullRom loops, 4-frame swim cycle from the sheet. */
function createKoi(spec: ParticleSpec, count: number, t: any, active: any, gateFn: (p: number) => number, base: any, motion: boolean): ParticleSystem {
  const group = new THREE.Group();
  const loops = (spec.loops ?? [[[0, 0.1, 0], [6, 0.1, 2], [8, 0.1, 8], [2, 0.1, 10], [-4, 0.1, 6]]]).map(
    (pts) => new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), true, 'centripetal'),
  );
  const { tex, sheet } = lazyTexture('/night/particles/koi.webp', (g, s) => {
    g.fillStyle = 'rgba(0,229,255,0.9)';
    g.beginPath(); g.ellipse(s * 0.5, s * 0.5, s * 0.42, s * 0.18, 0, 0, TWO_PI); g.fill();
  }, 64);
  const swimmers: { mesh: THREE.Mesh; loop: THREE.CatmullRomCurve3; u: number; speed: number }[] = [];
  const r = rng(105);
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    mat.fog = false;
    const frame = fract(floor(t.mul(6.0).add(i * 1.3)).mul(0.25));
    const s = texture(tex, mix(uv(), vec2(uv().x.mul(0.25).add(frame), uv().y), sheet));
    mat.colorNode = s.rgb.mul(2.2);
    mat.opacityNode = s.a.mul(0.85).mul(active);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), mat);
    mesh.rotation.x = -Math.PI / 2;
    group.add(mesh);
    swimmers.push({ mesh, loop: loops[i % loops.length], u: r(), speed: 0.02 + r() * 0.015 });
  }
  group.visible = false;
  const pos = new THREE.Vector3(), ahead = new THREE.Vector3();
  let activeValue = 0;
  const update = (p: number, dt: number) => {
    activeValue = gateFn(p);
    active.value = activeValue;
    group.visible = activeValue > 0.01;
    if (!group.visible) return;
    for (const sw of swimmers) {
      if (motion) sw.u = (sw.u + sw.speed * dt) % 1;
      sw.loop.getPointAt(sw.u, pos);
      sw.loop.getPointAt((sw.u + 0.01) % 1, ahead);
      sw.mesh.position.copy(pos);
      sw.mesh.rotation.z = Math.atan2(ahead.x - pos.x, ahead.z - pos.z) - Math.PI / 2; // plane lies flat; spin to the tangent
    }
  };
  return { kind: 'koi' as const, mesh: group, update, setWind: base.setWind, get active() { return activeValue; } };
}

export { max as _max };

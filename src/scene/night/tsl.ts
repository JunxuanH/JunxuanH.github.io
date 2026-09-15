/**
 * three/tsl with one change: `color(literal)` yields a uniform instead of a shader constant. A constant
 * bakes the value into the WGSL, so every tint variant of a material becomes its own program (a Metal
 * compile each, hundreds of milliseconds); as a uniform the code is identical and the pipeline is shared.
 * Node arguments pass through to the real `color()` (a conversion).
 *
 * The same rule drives the two material recipes below: every per-call number is a uniform, so all the
 * city's constant-colour neon trims share one fragment program and all its light cones share another.
 * Identical parameters also share the material instance (three builds a node graph per material
 * instance, and every build is ~25 ms of JS at boot).
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
import { reducedMotion } from './palette';
export * from 'three/tsl';
/** three's `time` (seconds, per render), held at 0 under reduced motion: no neon buzz, ad glitches, billboard sweeps or ripples. */
export const time = TSL.uniform(0).setGroup(TSL.renderGroup).onRenderUpdate((frame: { time: number }) => (reducedMotion ? 0 : frame.time));
export const color = (v: any): any =>
  typeof v === 'number' || typeof v === 'string' || v instanceof THREE.Color ? TSL.uniform(new THREE.Color(v)) : TSL.color(v);

export interface GlowOptions { transparent?: boolean; opacity?: number; side?: THREE.Side; depthWrite?: boolean; blending?: THREE.Blending }

const glowCache = new Map<string, THREE.MeshBasicNodeMaterial>();
/**
 * Unlit constant-colour emissive material (`tint × gain`): neon trims, bulbs, edge strips, rings. Tint and
 * gain are uniforms so every call renders through the same program; equal parameters return the same
 * instance (safe to share between meshes and instanced meshes; nothing mutates these materials).
 */
export function glowMaterial(tint: THREE.ColorRepresentation, gain = 1, opts: GlowOptions = {}) {
  const c = new THREE.Color(tint);
  const key = [c.getHex(), gain, opts.transparent ? 1 : 0, opts.opacity ?? 1, opts.side ?? THREE.FrontSide, opts.depthWrite ?? true, opts.blending ?? THREE.NormalBlending].join('|');
  let m = glowCache.get(key);
  if (!m) {
    const params: THREE.MeshBasicNodeMaterialParameters = {};
    if (opts.transparent !== undefined) params.transparent = opts.transparent;
    if (opts.opacity !== undefined) params.opacity = opts.opacity;
    if (opts.side !== undefined) params.side = opts.side;
    if (opts.depthWrite !== undefined) params.depthWrite = opts.depthWrite;
    if (opts.blending !== undefined) params.blending = opts.blending;
    m = new THREE.MeshBasicNodeMaterial(params);
    m.colorNode = TSL.uniform(c).mul(TSL.uniform(gain));
    glowCache.set(key, m);
  }
  return m;
}

const beamCache = new Map<string, THREE.MeshBasicNodeMaterial>();
/**
 * Additive light cone / beam on an open cone geometry whose uv.y runs 0 at the bright end to 1 at the tip:
 * opacity `(1 − uv.y)² · gain · smoothstep(0, fadeIn, uv.y)`, colour `tint × colorGain`. All uniforms.
 */
export function beamMaterial(tint: THREE.ColorRepresentation, gain: number, fadeIn: number, colorGain = 1) {
  const c = new THREE.Color(tint);
  const key = [c.getHex(), gain, fadeIn, colorGain].join('|');
  let m = beamCache.get(key);
  if (!m) {
    m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    m.fog = false; // additive haze must not add the scene fog colour as a solid cone
    m.colorNode = TSL.uniform(c).mul(TSL.uniform(colorGain));
    m.opacityNode = TSL.float(1).sub(TSL.uv().y).pow(2).mul(TSL.uniform(gain)).mul(TSL.smoothstep(0.0, TSL.uniform(fadeIn), TSL.uv().y));
    beamCache.set(key, m);
  }
  return m;
}

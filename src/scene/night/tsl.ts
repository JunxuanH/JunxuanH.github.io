/**
 * three/tsl with one change: `color(literal)` yields a uniform instead of a shader constant. A constant
 * bakes the value into the WGSL, so every tint variant of a material becomes its own program (a Metal
 * compile each, hundreds of milliseconds); as a uniform the code is identical and the pipeline is shared.
 * Node arguments pass through to the real `color()` (a conversion).
 */
import * as THREE from 'three/webgpu';
import * as TSL from 'three/tsl';
export * from 'three/tsl';
export const color = (v: any): any =>
  typeof v === 'number' || typeof v === 'string' || v instanceof THREE.Color ? TSL.uniform(new THREE.Color(v)) : TSL.color(v);

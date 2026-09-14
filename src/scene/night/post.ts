import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { params, type Tier } from './palette';

/**
 * Night post chain: bounded bloom (the neon is the light source), light chromatic aberration and
 * grain on high, temporal AA, sharpen. No DoF / SSGI (crash + cost lessons from the Aero scene).
 */
export function createPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, tier: Tier) {
  const pipeline = new THREE.RenderPipeline(renderer);
  const bounded = (n: any) => vec4(n.rgb.min(vec3(6.0)), n.a);
  if (tier === 'low') {
    const p = pass(scene, camera);
    pipeline.outputNode = params.has('nobloom') ? p : p.add(bloom(bounded(p), 0.4, 0.4, 1.5));
    return pipeline;
  }
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, velocity }));
  const beauty = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const vel = scenePass.getTextureNode('velocity');
  let o: any = params.has('nobloom') ? beauty : beauty.add(bloom(bounded(beauty), Number(params.get('bs')) || 0.45, 0.5, Number(params.get('bt')) || 1.6));
  if (tier === 'high' && !params.has('noca')) {
    // Subtle lens fringing at the edges only; explicit centre (null would be nodeObject(null) → build error).
    o = chromaticAberration(o, Number(params.get('ca')) || 0.04, vec2(0.5, 0.5), 1.02);
    o = film(o, 0.06);
  }
  o = traa(o, depth, vel, camera);
  if (tier === 'high' && !params.has('nosharp')) o = sharpen(o, 0.2);
  pipeline.outputNode = o;
  return pipeline;
}

import * as THREE from 'three/webgpu';
import { pass, mrt, output, velocity, vec2, vec3, vec4 } from './tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { sharpen } from 'three/addons/tsl/display/SharpenNode.js';
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js';
import { film } from 'three/addons/tsl/display/FilmNode.js';
import { params, type Tier } from './palette';

/**
 * Night post chain: bounded bloom (the neon is the light source), light chromatic aberration and
 * grain on high. Resolve temporal AA before bloom, so moving light halos do not enter
 * the surface-depth history. No DoF / SSGI (crash + cost lessons from the Aero scene).
 */
export function createPost(renderer: THREE.WebGPURenderer, scene: THREE.Scene, camera: THREE.Camera, tier: Tier) {
  const pipeline = new THREE.RenderPipeline(renderer);
  const bounded = (n: any) => vec4(n.rgb.clamp(vec3(0), vec3(6.0)), 1);
  // Bloom is radiance, not coverage. Never add its alpha to the scene alpha.
  const withBloom = (n: any, strength: number, radius: number, threshold: number) =>
    vec4(n.rgb.add(bloom(bounded(n), strength, radius, threshold).rgb).max(vec3(0)), n.a);
  if (tier === 'low') {
    const p = pass(scene, camera);
    pipeline.outputNode = params.has('nobloom') ? p : withBloom(p, 0.28, 0.3, 1.6);
    return { pipeline, scenePass: p };
  }
  const scenePass = pass(scene, camera);
  scenePass.setMRT(mrt({ output, velocity }));
  let beauty: any = scenePass.getTextureNode('output');
  const depth = scenePass.getTextureNode('depth');
  const vel = scenePass.getTextureNode('velocity');
  // Ground-truth ambient occlusion, high tier only. The scene has no shadow maps at all, so contact
  // darkening where props, walls and characters meet the ground has to come from screen space.
  // Normals are reconstructed from depth rather than adding a third MRT attachment: one less
  // full-resolution target to write and read every frame, which matters more here than exactness.
  if (tier === 'high' && !params.has('nogtao')) {
    // Null normals means "reconstruct from depth"; the addon's typings mark the parameter as
    // required even though the node handles null, so the cast keeps the typecheck at its baseline.
    const occlusion = ao(depth, null as any, camera);
    occlusion.resolutionScale = Number(params.get('aores')) || 0.5;
    occlusion.distanceExponent.value = 1.6;
    occlusion.radius.value = Number(params.get('aorad')) || 0.55;
    occlusion.scale.value = Number(params.get('aoamt')) || 1.0;
    occlusion.thickness.value = 1.0;
    // Multiply, floored: neon is emissive and must not be darkened into mud by a depth-only guess.
    beauty = vec4(beauty.rgb.mul(occlusion.clamp(0.35, 1.0)), beauty.a);
  }
  let o: any = traa(beauty, depth, vel, camera);
  if (!params.has('nobloom')) o = withBloom(o, Number(params.get('bs')) || 0.3, 0.35, Number(params.get('bt')) || 1.6);
  if (tier === 'high' && !params.has('noca')) {
    // Subtle lens fringing at the edges only; explicit centre (null would be nodeObject(null) → build error).
    o = chromaticAberration(o, Number(params.get('ca')) || 0.04, vec2(0.5, 0.5), 1.02);
    o = film(o, 0.06);
  }
  if (tier === 'high' && !params.has('nosharp')) o = sharpen(o, 0.2);
  pipeline.outputNode = o;
  return { pipeline, scenePass };
}

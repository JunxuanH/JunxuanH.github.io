import * as THREE from 'three/webgpu';
import type { LightSpec } from './districts/shared';
import * as japantown from './districts/japantown';
import * as center from './districts/center';
import * as kabuki from './districts/kabuki';
import * as pier from './districts/pier';
import type { DistrictBuild, DistrictCtx } from './districts/shared';
import type { SectionId } from './journey';

export type { DistrictContent, DistrictTextures, DistrictCtx, DistrictBuild, LightSpec } from './districts/shared';
export { facadeBlock, createFlameSign, createConduit } from './districts/shared';

/**
 * Orchestrates the four themed districts (each in ./districts/*.ts) and merges what they ask for:
 * one group to mount, the Kenney props they want placed, and the point lights they want lit.
 */
export async function createDistricts(ctx: DistrictCtx) {
  const [jp, ce, ka, pi] = await Promise.all([japantown.create(ctx), center.create(ctx), kabuki.create(ctx), pier.create(ctx)]);
  const builds: DistrictBuild[] = [jp, ce, ka, pi];
  const group = new THREE.Group();
  for (const b of builds) group.add(b.group);
  return {
    group,
    props: builds.flatMap((b) => b.props),
    lights: [] as LightSpec[],
    /** Specs of the districts currently drawn — fed to the light pool (lights.ts) every frame. */
    activeLights: () => builds.flatMap((b) => (b.group.visible ? b.lights : [])),
    padRing: pi.padRing,
    // Districts are only drawn near their own section (hundreds of small meshes each; invisible from the vista anyway).
    // `section` (walk / dock mode) forces that section's district on regardless of p; the others keep their p windows.
    update: (t: number, p: number, section?: SectionId) => {
      pi.update(t);
      jp.group.visible = (p > 0.08 && p < 0.34) || section === 'education'; // not part of the bay vista (and it would be mirrored by the water)
      ce.group.visible = (p > 0.08 && p < 0.78) || section === 'work';
      ka.group.visible = (p > 0.55 && p < 0.95) || section === 'projects';
      pi.group.visible = p > 0.8 || section === 'contact';
    },
  };
}

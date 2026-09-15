import * as THREE from 'three/webgpu';
import type { Carrier, CarrierCtx } from './index';

/** Product poster attached to the game shop; the Projects reader is the entrance kiosk. */
export function create(_ctx: CarrierCtx): Carrier {
  const group = new THREE.Group();
  group.name = 'Market game-shop poster';
  group.position.set(70, 2.2, -240.65);
  const mount = new THREE.Object3D();
  group.add(mount);
  return { group, mount, width: 3.4, px: 1024, style: 'market', range: [0.55, 0.95] };
}

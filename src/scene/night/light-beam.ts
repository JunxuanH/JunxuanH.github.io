import * as THREE from 'three/webgpu';

/** Open cone with its apex exactly at the emitter and base at the target.
 * Native ConeGeometry has apex +Y and v=1. Expose v=0 at the source to beamMaterial.
 */
export function lightBeamGeometry(radius: number, distance: number) {
  const geometry = new THREE.ConeGeometry(radius, distance, 24, 1, true).translate(0, -distance / 2, 0);
  const uv = geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  return geometry;
}

export function aimLightBeam(mesh: THREE.Mesh, source: THREE.Vector3, target: THREE.Vector3) {
  mesh.position.copy(source);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), target.clone().sub(source).normalize());
}

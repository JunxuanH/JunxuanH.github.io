import * as THREE from 'three/webgpu';

/** Cut the source margins AND their world-space area; never stretch the retained artwork. */
export function croppedPlateGeometry(width: number, height: number, margin: number, mirror = false) {
  if (margin < 0 || margin >= 0.5) throw new RangeError('Plate margin must be in [0, 0.5)');
  const geometry = new THREE.PlaneGeometry(width * (1 - 2 * margin), height);
  const sourceUV = geometry.attributes.uv.clone();
  for (let i = 0; i < sourceUV.count; i++) {
    const u = margin + sourceUV.getX(i) * (1 - 2 * margin);
    sourceUV.setX(i, mirror ? 1 - u : u);
  }
  // UV0 stays local to the trimmed panel for its narrow seam feather; UV1 samples only safe artwork.
  geometry.setAttribute('uv1', sourceUV);
  return geometry;
}

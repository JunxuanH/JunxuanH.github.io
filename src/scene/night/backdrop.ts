import * as THREE from 'three/webgpu';
import { texture, uv, vec3, smoothstep, float, uniform, mix, color } from './tsl';
import { loadSRGB } from './palette';
import { croppedPlateGeometry } from './plate-geometry';

/**
 * Far skyline: a flat Fal aerial plate (nano-banana-pro) on the north boundary (−z, behind the city seen from the
 * vista) at z −560, mirrored to both sides so wide viewports never see its edge. It fades to the sky dome at the top
 * and sides. `fog: false` — haze is baked in. No east / west plates: those read as nearby wallpaper from the streets.
 */
export async function createBackdrop() {
  const group = new THREE.Group();
  group.name = 'backdrop';
  const H0 = 520, D0 = 560, Y0 = 150;
  const make = (plate: THREE.Texture, W: number, H: number, mirror: boolean) => {
    // Crop geometry and UVs together so retained buildings are not stretched to fill the old width.
    const margin = 0.08;
    const geo = croppedPlateGeometry(W, H, margin, mirror);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.fog = false;
    const tuv = uv(1);
    // A distant painted skyline must stay planar: depth-image discontinuities stretch building silhouettes when
    // viewed from the side. Real foreground towers already provide the parallax.
    const fadeB = smoothstep(uniform(0), uniform(0.0001), uv().y);
    // Toward the faded bottom the plate also takes the street haze's navy, so what remains reads as mist, not a cut edge.
    // Distorted source margins are physically absent, not merely dimmed. Feather only the new
    // cut boundary; UV0 spans the retained geometry while UV1 excludes the source's outer strips.
    const edgeStart = uniform(0), edgeEnd = uniform(0.06);
    const fadeX = smoothstep(edgeStart, edgeEnd, uv().x).mul(smoothstep(edgeStart, edgeEnd, float(1).sub(uv().x)));
    const plateColor = texture(plate, tuv).rgb.mul(vec3(0.95, 1.0, 1.08)).mul(1.1);
    // Fade coverage only. Darkening RGB as well produced a dark fringe along the cut buildings.
    mat.colorNode = mix(color(0x0b0d1c), plateColor, fadeB.mul(0.6).add(0.4));
    // Ascending smoothstep edges are defined on both WebGL and WebGPU.
    const fadeY = float(1).sub(smoothstep(0.72, 1.0, uv().y));
    mat.opacityNode = fadeX.mul(fadeY).mul(fadeB);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.sourceCrop = [margin, 1 - margin];
    return mesh;
  };
  const load = (name: string) => loadSRGB(`/night/backdrop/${name}.webp`);

  const plate = await load('aerial');
  const aspect = plate.image.width / plate.image.height;
  const W0 = H0 * aspect;
  const centre = make(plate, W0, H0, false);
  centre.position.set(0, Y0, -D0);
  const left = make(plate, W0, H0, true), right = make(plate, W0, H0, true);
  // A generous overlap gives the above feathered margins room to dissolve; the previous 14% overlap exposed a
  // parallax discontinuity at wide aspect ratios.
  left.position.set(-W0 * 0.72, Y0, -600);
  right.position.set(W0 * 0.72, Y0, -600);
  group.add(left, right, centre);

  group.renderOrder = -10;
  return group;
}

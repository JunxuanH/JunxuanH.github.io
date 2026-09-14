import * as THREE from 'three/webgpu';
import { texture, uv, positionLocal, vec3, smoothstep, float } from 'three/tsl';
import { loader, loadSRGB } from './palette';

/**
 * Far skyline: the fal aerial plate displaced by its depth map (2.5D), at z −560 behind the
 * kitbash city. The plate is mirrored to both sides so wide viewports never see its edge, and its
 * top/side edges fade to transparent so the sky dome shows through. `fog: false` — haze is baked in.
 */
export async function createBackdrop() {
  const plate = await loadSRGB('/night/backdrop/aerial.webp');
  const depth = await loader.loadAsync('/night/backdrop/aerial-depth.png');
  const aspect = plate.image.width / plate.image.height;
  const H = 520, W = H * aspect;
  const group = new THREE.Group();
  const make = (mirror: boolean) => {
    const geo = new THREE.PlaneGeometry(W, H, 256, 128);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.fog = false;
    const u = mirror ? float(1).sub(uv().x) : uv().x;
    const tuv = vec3(u, uv().y, 0).xy;
    const d = texture(depth, tuv).r;
    mat.positionNode = positionLocal.add(vec3(0, 0, d.mul(140)));
    mat.colorNode = texture(plate, tuv).rgb.mul(vec3(0.95, 1.0, 1.08)).mul(1.1);
    const fadeX = smoothstep(0.0, 0.10, uv().x).mul(smoothstep(1.0, 0.90, uv().x));
    const fadeY = smoothstep(1.0, 0.72, uv().y);
    mat.opacityNode = fadeX.mul(fadeY);
    return new THREE.Mesh(geo, mat);
  };
  const centre = make(false);
  centre.position.set(0, 150, -560);
  const left = make(true), right = make(true);
  left.position.set(-W * 0.86, 150, -600);
  right.position.set(W * 0.86, 150, -600);
  group.add(left, right, centre);
  group.renderOrder = -10;
  return group;
}

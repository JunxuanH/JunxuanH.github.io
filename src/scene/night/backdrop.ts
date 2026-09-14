import * as THREE from 'three/webgpu';
import { texture, uv, positionLocal, vec3, smoothstep, float, uniform, mix, color } from './tsl';
import { loader, loadSRGB } from './palette';

/**
 * Far skyline: fal aerial plates (nano-banana-pro) displaced by their Depth Anything maps (2.5D), fading to the sky dome
 * at the top and sides. `fog: false` — haze is baked in.
 *
 * - North (−z, behind the city seen from the vista): the original plate at z −560, mirrored to both sides so wide
 *   viewports never see its edge.
 * - `ring` (east +x, west −x, south +z): three more plates in the same style (design/night/prompts/plate-aerial-*.txt)
 *   stand around the rest of the map, so every street-level view past the city's edge ends in skyline rather than sky.
 *   Each is scaled with its distance so the horizon sits at the same angle as the north plate. Same material graph as
 *   the north plate (one program; only the textures differ).
 */
export async function createBackdrop(opts: { ring?: boolean } = {}) {
  const group = new THREE.Group();
  const H0 = 520, D0 = 560, Y0 = 150;
  // `bottom` = [start, end] of a fade over the plate's lower part (uv.y): the side plates' foreground rooftops dissolve into
  // haze instead of sitting on the water like a cut-out. Uniforms, so every plate keeps the same program.
  const make = (plate: THREE.Texture, depth: THREE.Texture, W: number, H: number, mirror: boolean, bottom: [number, number] = [0, 0.0001]) => {
    const geo = new THREE.PlaneGeometry(W, H, 256, 128);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.fog = false;
    const u = mirror ? float(1).sub(uv().x) : uv().x;
    const tuv = vec3(u, uv().y, 0).xy;
    const d = texture(depth, tuv).r;
    mat.positionNode = positionLocal.add(vec3(0, 0, d.mul(140 * (H / H0))));
    const fadeB = smoothstep(uniform(bottom[0]), uniform(bottom[1]), uv().y);
    // Toward the faded bottom the plate also takes the street haze's navy, so what remains reads as mist, not a cut edge.
    mat.colorNode = mix(color(0x0b0d1c), texture(plate, tuv).rgb.mul(vec3(0.95, 1.0, 1.08)).mul(1.1), fadeB.mul(0.6).add(0.4));
    const fadeX = smoothstep(0.0, 0.10, uv().x).mul(smoothstep(1.0, 0.90, uv().x));
    const fadeY = smoothstep(1.0, 0.72, uv().y);
    mat.opacityNode = fadeX.mul(fadeY).mul(fadeB);
    return new THREE.Mesh(geo, mat);
  };
  const load = (name: string) => Promise.all([loadSRGB(`/night/backdrop/${name}.webp`), loader.loadAsync(`/night/backdrop/${name}-depth.png`)]);

  const [plate, depth] = await load('aerial');
  const aspect = plate.image.width / plate.image.height;
  const W0 = H0 * aspect;
  const centre = make(plate, depth, W0, H0, false);
  centre.position.set(0, Y0, -D0);
  const left = make(plate, depth, W0, H0, true), right = make(plate, depth, W0, H0, true);
  left.position.set(-W0 * 0.86, Y0, -600);
  right.position.set(W0 * 0.86, Y0, -600);
  group.add(left, right, centre);

  const ring: THREE.Mesh[] = []; // the side plates: main.ts hides them at the harbor (they sat on the water there)
  group.userData.ring = ring;
  if (opts.ring) {
    const D = 900, k = D / D0, H = H0 * k;
    // [plate, x, z, yaw, bottom fade]: the fade band sits under each plate's own skyline (east keeps its maglev line).
    const sides: [string, number, number, number, [number, number]][] = [
      ['ring-east', D, 0, -Math.PI / 2, [0.08, 0.26]], // at +x, facing the centre (−x)
      ['ring-west', -D, 0, Math.PI / 2, [0.16, 0.36]],
      ['ring-south', 0, D, Math.PI, [0.24, 0.46]],
    ];
    const loaded = await Promise.all(sides.map(([name]) => load(name).catch((e) => { console.warn('[night] backdrop plate', name, e); return null; })));
    sides.forEach(([, x, z, yaw, bottom], i) => {
      const t = loaded[i];
      if (!t) return;
      const m = make(t[0], t[1], H * (t[0].image.width / t[0].image.height), H, false, bottom);
      m.position.set(x, Y0 * k, z);
      m.rotation.y = yaw;
      group.add(m);
      ring.push(m);
    });
  }
  group.renderOrder = -10;
  return group;
}

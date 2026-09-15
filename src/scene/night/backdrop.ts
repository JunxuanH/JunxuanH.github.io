import * as THREE from 'three/webgpu';
import { texture, uv, vec3, smoothstep, float, uniform, mix, color } from './tsl';
import { loadSRGB } from './palette';

/**
 * Far skyline: flat Fal aerial plates (nano-banana-pro), fading to the sky dome
 * at the top and sides. `fog: false` — haze is baked in.
 *
 * - North (−z, behind the city seen from the vista): the original plate at z −560, mirrored to both sides so wide
 *   viewports never see its edge.
 * - `ring` (east +x, west −x): two more plates in the same style (design/night/prompts/plate-aerial-*.txt)
 *   stand around the rest of the map, so every street-level view past the city's edge ends in skyline rather than sky.
 *   Each is scaled with its distance so the horizon sits at the same angle as the north plate. Same material graph as
 *   the north plate (one program; only the textures differ).
 */
export async function createBackdrop(opts: { ring?: boolean } = {}) {
  const group = new THREE.Group();
  const H0 = 520, D0 = 560, Y0 = 150;
  // `bottom` = [start, end] of a fade over the plate's lower part (uv.y): the side plates' foreground rooftops dissolve into
  // haze instead of sitting on the water like a cut-out. Uniforms, so every plate keeps the same program.
  const make = (plate: THREE.Texture, W: number, H: number, mirror: boolean, bottom: [number, number] = [0, 0.0001]) => {
    const geo = new THREE.PlaneGeometry(W, H);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    mat.fog = false;
    const u = mirror ? float(1).sub(uv().x) : uv().x;
    const tuv = vec3(u, uv().y, 0).xy;
    // A distant painted skyline must stay planar: depth-image discontinuities stretch building silhouettes when
    // viewed from the side. Real foreground towers already provide the parallax.
    const fadeB = smoothstep(uniform(bottom[0]), uniform(bottom[1]), uv().y);
    // Toward the faded bottom the plate also takes the street haze's navy, so what remains reads as mist, not a cut edge.
    mat.colorNode = mix(color(0x0b0d1c), texture(plate, tuv).rgb.mul(vec3(0.95, 1.0, 1.08)).mul(1.1), fadeB.mul(0.6).add(0.4));
    const fadeX = smoothstep(0.035, 0.18, uv().x).mul(smoothstep(0.965, 0.82, uv().x));
    const fadeY = smoothstep(1.0, 0.72, uv().y);
    mat.opacityNode = fadeX.mul(fadeY).mul(fadeB);
    return new THREE.Mesh(geo, mat);
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

  const ring: THREE.Mesh[] = []; // the side plates: main.ts hides them at the harbor (they sat on the water there)
  group.userData.ring = ring;
  if (opts.ring) {
    const D = 900, k = D / D0, H = H0 * k;
    // [plate, x, z, yaw, bottom fade]: the fade band sits under each plate's own skyline (east keeps its maglev line).
    const sides: [string, number, number, number, [number, number]][] = [
      ['ring-east', D, 0, -Math.PI / 2, [0.08, 0.26]], // at +x, facing the centre (−x)
      ['ring-west', -D, 0, Math.PI / 2, [0.16, 0.36]],
      // No south plate: it sits across the bay behind the bridge and read as a wallpaper on the water (Ivan, 2026-09-14).
    ];
    const loaded = await Promise.all(sides.map(([name]) => load(name).catch((e) => { console.warn('[night] backdrop plate', name, e); return null; })));
    sides.forEach(([, x, z, yaw, bottom], i) => {
      const t = loaded[i];
      if (!t) return;
      const m = make(t, H * (t.image.width / t.image.height), H, false, bottom);
      m.position.set(x, Y0 * k, z);
      m.rotation.y = yaw;
      group.add(m);
      ring.push(m);
    });
  }
  group.renderOrder = -10;
  return group;
}

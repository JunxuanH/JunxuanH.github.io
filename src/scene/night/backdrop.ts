import * as THREE from 'three/webgpu';
import { texture, uv, vec2, vec3, smoothstep, float, uniform, mix, color, floor, hash, step, time, luminance } from './tsl';
import { loadSRGB } from './palette';
import { croppedPlateGeometry } from './plate-geometry';

/**
 * Far skyline: a flat Fal aerial plate (nano-banana-pro) on the north boundary (−z, behind the city seen from the
 * vista) at z −560, mirrored to both sides so wide viewports never see its edge. It fades to the sky dome at the top
 * and sides. `fog: false` — haze is baked in. No east / west plates: those read as nearby wallpaper from the streets.
 *
 * The plate stays a still. A 5 s Kling O1 loop of the same image was generated and wired in as a VideoTexture
 * (scripts/backdrop-loop.sh, take 3) and Ivan judged it worse than the still on 2026-09-20 — the clip ships at
 * 1280 px against a 2048 px painting, and the softness costs more than the blinking beacons buy. The generator and
 * its prompt are kept; the runtime swap is not. Motion around the plate comes from air-traffic.ts and from the
 * window flicker below; a drifting cloud sheet was tried in front of it and removed on Ivan's call the same day.
 */
export async function createBackdrop() {
  const group = new THREE.Group();
  group.name = 'backdrop';
  // Taller than it is wide-ish: the plate's job is the sky as much as the skyline. The bottom edge
  // stays at y -110 where it meets the water and the city, so H0 and Y0 move together.
  const H0 = 760, D0 = 560, Y0 = 270;
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
    // A 6 % feather is not a fade, it is an edge with a soft corner. Seen obliquely from the pier the
    // plate ended in a vertical step of 55 to 76 luminance against the sky. A fifth of the panel now
    // dissolves, which costs some painted city at the extremes and buys no visible boundary.
    const edgeStart = uniform(0), edgeEnd = uniform(0.2);
    const fadeX = smoothstep(edgeStart, edgeEnd, uv().x).mul(smoothstep(edgeStart, edgeEnd, float(1).sub(uv().x)));
    const painted = texture(plate, tuv).rgb.mul(vec3(0.95, 1.0, 1.08)).mul(1.1);
    // The painting's windows are lit but frozen. Flicker them on a coarse cell grid — bright pixels only, so the
    // sky and the water stay still — and the far city reads as inhabited instead of as a photograph. Costs nothing,
    // survives on every tier, and stops dead under reduced motion, where `time` is held at 0 (tsl.ts).
    const cellId = floor(tuv.mul(vec2(260, 195)));
    const flick = hash(cellId.x.mul(0.173).add(cellId.y.mul(9.71)).add(floor(time.mul(1.6))));
    const lit = smoothstep(0.30, 0.72, luminance(painted));
    // The clouds are left alone. Modulating their density in this shader only made banks thicken and thin in
    // place (the shapes are pixels and cannot translate), and a sheet of drifting cloud hung in front of the
    // plate was tried and cut: the sky is the painting's, and both attempts read as haze over it.
    const plateColor = painted.mul(float(1).add(lit.mul(step(0.93, flick)).mul(0.55)));
    // Fade coverage only. Darkening RGB as well produced a dark fringe along the cut buildings.
    mat.colorNode = mix(color(0x0b0d1c), plateColor, fadeB.mul(0.6).add(0.4));
    // Ascending smoothstep edges are defined on both WebGL and WebGPU.
    // The knee is in UV space, so a taller plate would otherwise dissolve most of its new sky. Hold the
  // paint opaque to 86 % and let only the top band blend into the dome.
  const fadeY = float(1).sub(smoothstep(0.86, 1.0, uv().y));
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


/**
 * Downtown bus shelter (AMD intern). A glass shelter on the west sidewalk, 8 u along z with its back wall
 * on the façade line and open to the road; the backlit ad panel on the back wall carries the `poster`
 * slab facing +x toward the dwell camera at (−14.8, 1.7, −90.6). Bench, stop flag "47", a bouncer
 * waiting outside the south end. ~8 draws + the NPC.
 */
import * as THREE from 'three/webgpu';
import { color } from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { THEMES } from '../theme';
import { CURB_H } from '../streets';
import { neonText } from '../signs';
import { loadCharacter, instantiate } from '../characters';
import type { Carrier, CarrierCtx } from './index';

const CX = -17.0, CZ = -94.9;  // shelter centre; footprint x −17.9…−16.1, z −98.9…−90.9
const BACK_X = -17.85;         // glass back wall
const ROOF_Y = 3.05;
const POST_H = 2.9;
const GLASS_H = 2.7;
const PANEL = { x: -17.6, y: 2.0, z: -94.6, h: 2.6 };

function glow(tint: number, gain: number) {
  const m = new THREE.MeshBasicNodeMaterial();
  m.colorNode = color(tint).mul(gain);
  return m;
}

export async function create(ctx: CarrierCtx): Promise<Carrier> {
  const T = THEMES.work;
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardNodeMaterial({ color: 0x14161f, roughness: 0.5, metalness: 0.7 });

  // Roof slab with a white underside strip and cyan edge trim; the group lifts in fit() for a tall poster.
  const roof = new THREE.Group();
  roof.position.y = ROOF_Y;
  roof.add(new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.14, 8.2).translate(CX, 0, CZ), metal));
  roof.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 7.6).translate(CX + 0.4, -0.09, CZ), glow(0xdfe8ff, 0.6)));
  roof.add(new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(0.06, 0.06, 8.2).translate(CX + 1.0, 0, CZ),
    new THREE.BoxGeometry(2.0, 0.06, 0.06).translate(CX, 0, CZ + 4.1),
    new THREE.BoxGeometry(2.0, 0.06, 0.06).translate(CX, 0, CZ - 4.1),
  ], false)!, glow(T.secondary, 1.6)));
  group.add(roof);

  // Four corner posts, instanced; the mesh origin is at the kerb so scale.y stretches them upward.
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.06, 0.06, POST_H, 8).translate(0, POST_H / 2, 0), metal, 4);
  const pm = new THREE.Matrix4();
  [[BACK_X, CZ - 3.9], [BACK_X, CZ + 3.9], [CX + 0.85, CZ - 3.9], [CX + 0.85, CZ + 3.9]].forEach(([x, z], i) => posts.setMatrixAt(i, pm.makeTranslation(x, 0, z)));
  posts.position.y = CURB_H;
  group.add(posts);

  // Glass: back wall facing the road + two end walls, merged; glassLobby recipe (no transmission).
  const glassMat = new THREE.MeshStandardNodeMaterial({ transparent: true, opacity: 0.25, roughness: 0.05, metalness: 0.6, depthWrite: false, side: THREE.DoubleSide });
  glassMat.colorNode = color(0xdfe8ff);
  const glass = new THREE.Mesh(mergeGeometries([
    new THREE.PlaneGeometry(7.8, GLASS_H).rotateY(Math.PI / 2).translate(BACK_X, GLASS_H / 2 + 0.05, CZ),
    new THREE.PlaneGeometry(1.7, GLASS_H).translate(CX, GLASS_H / 2 + 0.05, CZ - 3.9),
    new THREE.PlaneGeometry(1.7, GLASS_H).translate(CX, GLASS_H / 2 + 0.05, CZ + 3.9),
  ], false)!, glassMat);
  glass.position.y = CURB_H;
  glass.renderOrder = 3;
  group.add(glass);

  // Ad panel on the back wall: dark housing, bright backlight plane the poster sits on (blooms round it).
  const housing = new THREE.Mesh(new THREE.BoxGeometry(0.12, PANEL.h, 4.5), metal);
  housing.position.set(PANEL.x, PANEL.y, PANEL.z);
  const backlight = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 2.5), glow(0xdfe8ff, 0.5));
  backlight.rotation.y = Math.PI / 2;
  backlight.position.set(PANEL.x + 0.07, PANEL.y, PANEL.z);
  group.add(housing, backlight);
  const mount = new THREE.Object3D();
  mount.position.set(-17.5, PANEL.y, PANEL.z);
  mount.rotation.y = Math.PI / 2; // local +z → world +x, toward the road
  group.add(mount);

  // Backless bench along the back wall, stop pole + flag at the north end: one merged metal mesh.
  group.add(new THREE.Mesh(mergeGeometries([
    new THREE.BoxGeometry(0.45, 0.08, 2.2).translate(-17.4, 0.5, -97.5),
    new THREE.BoxGeometry(0.4, 0.24, 0.08).translate(-17.4, CURB_H + 0.12, -96.5),
    new THREE.BoxGeometry(0.4, 0.24, 0.08).translate(-17.4, CURB_H + 0.12, -98.5),
    new THREE.CylinderGeometry(0.05, 0.05, 2.7, 8).translate(-16.4, CURB_H + 1.35, -89.6),
    new THREE.BoxGeometry(0.5, 0.7, 0.05).translate(-16.4, 2.7, -89.6),
  ], false)!, metal));
  // Route number on the flag's +z face (readable on the approach from the north).
  const flag = neonText('47', '#dfe8ff', 1.2);
  flag.position.set(-16.4, 2.7, -89.6 + 0.04);
  group.add(flag);

  // Oni bouncer waiting outside the south end, facing the road (assets may be missing).
  let mixer: THREE.AnimationMixer | null = null;
  const npcs: NonNullable<Carrier['npcs']> = [];
  if (ctx.people) {
    try {
      const inst = instantiate(await loadCharacter('oni-bouncer'), { height: 2.0, rim: 0xdfe8ff });
      inst.root.position.set(-16.4, CURB_H, -100.3);
      inst.root.rotation.y = Math.PI / 2;
      inst.play('idle', 0);
      group.add(inst.root);
      mixer = inst.mixer;
      npcs.push({ root: inst.root, headBone: inst.headBone });
    } catch (e) { console.warn('[busstop] NPC unavailable', e); }
  }

  return {
    group, mount, width: 4.4, px: 720, style: 'poster', range: [0.2, 0.42],
    lights: [[-16.8, 2.8, -94.6, 0xdfe8ff, 220, 12]],
    npcs,
    update(_t, dt) { mixer?.update(dt); },
    fit(h) {
      const H = h + 0.15;
      housing.scale.y = H / PANEL.h;
      backlight.scale.y = (h + 0.05) / 2.5;
      // A poster taller than the shelter lifts the roof; posts and glass stretch with it.
      const lift = Math.max(0, PANEL.y + H / 2 + 0.1 - (ROOF_Y - 0.07));
      if (lift > 0) {
        roof.position.y = ROOF_Y + lift;
        posts.scale.y = (POST_H + lift) / POST_H;
        glass.scale.y = (GLASS_H + lift) / GLASS_H;
      }
    },
  };
}

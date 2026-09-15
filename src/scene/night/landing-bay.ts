import * as THREE from 'three/webgpu';

/** An unlit, instanced hangar: no textures, extra lights, shadows or post-processing. */
export function createLandingBay() {
  const group = new THREE.Group();
  const materials: THREE.MeshBasicMaterial[] = [];
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  type Block = [number, number, number, number, number, number];
  const shell: Block[] = [[0, -2, -9, 13, .2, 34], [-6.5, 1.5, -9, .2, 7, 34], [6.5, 1.5, -9, .2, 7, 34], [0, 5, -9, 13, .2, 34]];
  const ribs: Block[] = [], cyan: Block[] = [], amber: Block[] = [];
  for (const z of [5, 0, -5, -10, -15, -20]) {
    ribs.push([-6.2, 1.5, z, .35, 7, .3], [6.2, 1.5, z, .35, 7, .3], [0, 4.8, z, 12.4, .35, .3]);
    cyan.push([-6, 1.8, z, .06, 4.5, .08], [6, 1.8, z, .06, 4.5, .08], [0, 4.58, z, 7, .04, .1]);
    for (const x of [-3.7, 3.7]) cyan.push([x, -1.88, z, .07, .02, 3.3]);
    for (const x of [-5, 5]) amber.push([x, -1.87, z, .6, .03, .22]);
  }
  const material = (color: number) => {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true });
    materials.push(mat); return mat;
  };
  const batch = (blocks: Block[], color: number) => {
    const mesh = new THREE.InstancedMesh(geometry, material(color), blocks.length);
    const transform = new THREE.Object3D();
    blocks.forEach(([x, y, z, w, h, d], i) => {
      transform.position.set(x, y, z); transform.scale.set(w, h, d); transform.updateMatrix();
      mesh.setMatrixAt(i, transform.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true; group.add(mesh);
  };
  batch(shell, 0x0b1520); batch(ribs, 0x26394a); batch(cyan, 0x278fa5); batch(amber, 0xa78936);
  // The door sits ahead of the car, not between the camera and the vehicle.
  const doors = [-1, 1].map((side) => {
    const door = new THREE.Group(); door.position.set(side * 3.1, 1.4, -23);
    const panel = new THREE.Mesh(geometry, material(0x203344)); panel.scale.set(6.2, 6.8, .2); door.add(panel);
    const seam = new THREE.Mesh(geometry, material(0xff2bd6));
    seam.position.set(-side * 3.04, 0, .13); seam.scale.set(.09, 6.3, .04); door.add(seam);
    const stripe = new THREE.Mesh(geometry, material(0x597080));
    stripe.position.set(0, .8, .13); stripe.scale.set(5.3, .09, .04); door.add(stripe);
    group.add(door); return door;
  });
  return {
    group,
    update(elapsed: number, moving: boolean, entered: boolean) {
      const open = entered ? THREE.MathUtils.smoothstep(elapsed, 0, 1.2) : 0;
      const fade = entered ? 1 - THREE.MathUtils.smoothstep(elapsed, moving ? 1.2 : 0, moving ? 2.8 : .35) : 1;
      doors.forEach((door, i) => { door.position.x = (i ? 1 : -1) * (3.1 + (moving ? open * 6.4 : 0)); });
      // Camera and car depart together: the room travels past them before the skyway takes over.
      group.position.z = moving && entered ? THREE.MathUtils.smoothstep(elapsed, 1.1, 2.8) * 30 : 0;
      for (const mat of materials) mat.opacity = fade;
      group.visible = fade > .001;
    },
  };
}

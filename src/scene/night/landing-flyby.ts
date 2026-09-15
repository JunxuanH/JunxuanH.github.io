/** The generated gate hovercar's last beat: after the loading overlay drops, it appears in the live bay vista and
 * accelerates toward the skyline. Keeping this in the world renderer makes the handoff feel like one continuous trip. */
import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { texture, uv, smoothstep, max, min } from './tsl';

export function createLandingFlyby(scene: THREE.Scene) {
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  const root = new THREE.Group(); root.name = 'landing-flyby'; root.visible = false; scene.add(root);
  let ready = false, launched = false, elapsed = 0;
  const direction = new THREE.Vector3();
  const anchor = new THREE.Vector3();

  loader.load('/night/models/landing-hovercar.glb', (g) => {
    const model = g.scene;
    model.traverse((o: any) => {
      if (!o.isMesh) return;
      const repaint = (source: any) => {
        const material = new THREE.MeshStandardNodeMaterial({ map: source.map, normalMap: source.normalMap, roughness: 0.45, metalness: 0.4 });
        if (source.map) {
          const base = texture(source.map, uv()).rgb;
          const hi = max(base.r, max(base.g, base.b)), lo = min(base.r, min(base.g, base.b));
          const glow = smoothstep(0.25, 0.65, hi.sub(lo)).mul(smoothstep(0.25, 0.65, hi));
          material.emissiveNode = base.mul(glow.mul(2.5).add(0.25));
        }
        return material;
      };
      o.material = Array.isArray(o.material) ? o.material.map(repaint) : repaint(o.material);
    });
    const box = new THREE.Box3().setFromObject(model), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const scale = 5.8 / Math.max(size.x, size.z, 0.001);
    model.scale.setScalar(scale);
    model.position.set(-centre.x * scale, -centre.y * scale, -centre.z * scale);
    root.add(model); ready = true;
    if (launched) root.visible = true;
  }, undefined, () => { /* a missing flyby asset leaves the arrival clean rather than blocking it */ });

  return {
    launch(camera: THREE.Camera) {
      launched = true;
      camera.getWorldDirection(direction); direction.y = 0; direction.normalize();
      // Local +Z faces the visitor, showing the magenta tail bar. Start near the centre of the landing frame.
      anchor.copy(camera.position).addScaledVector(direction, 8);
      root.position.copy(anchor);
      root.lookAt(camera.position);
      root.visible = ready;
    },
    update(dt: number) {
      if (!launched || !ready || !root.visible) return;
      elapsed += dt;
      // Hold the silhouette just long enough for the crossfade to reveal it, then carry it beyond the bridge.
      const t = Math.min(1, elapsed / 4.2), ease = t * t * (3 - 2 * t);
      root.position.copy(anchor).addScaledVector(direction, 210 * ease);
      root.position.y += ease * 35 + Math.sin(elapsed * 4.4) * (1 - t) * 0.12;
      if (t >= 1) root.visible = false;
    },
    dispose() { draco.dispose(); scene.remove(root); },
  };
}

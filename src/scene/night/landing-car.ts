/** Live Three.js hovercar for the gate. Prefer the newly generated Fal asset, keep the established Fal sedan as a
 * resilient fallback while a generation is unavailable. This deliberately replaces a pre-rendered car moment: motion,
 * lighting and framing are all real-time and respect the gate's reduced-motion choice. */
import * as THREE from 'three/webgpu';
// The city uses the WebGPU facade; its gate stays on WebGL so it can paint before `main.ts` starts the WebGPU renderer.
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

export function mountLandingCar(host: HTMLElement, motion = () => !document.documentElement.classList.contains('reduce-motion')) {
  const renderer = new WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setClearAlpha(0);
  host.append(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0.2, 9);
  const rig = new THREE.Group(); scene.add(rig);
  scene.add(new THREE.HemisphereLight(0x66eaff, 0x180817, 2.2));
  const key = new THREE.DirectionalLight(0xd5eaff, 4); key.position.set(-2, 4, 6); scene.add(key);
  const cyan = new THREE.PointLight(0x00e5ff, 16, 18); cyan.position.set(-4, 3, 4); scene.add(cyan);
  const magenta = new THREE.PointLight(0xff2bd6, 18, 16); magenta.position.set(4, -1, 3); scene.add(magenta);

  let live = true, model: THREE.Object3D | null = null;
  const fit = (root: THREE.Object3D) => {
    if (!live) return;
    const box = new THREE.Box3().setFromObject(root), size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const scale = 7.2 / Math.max(size.x, size.z, 0.001);
    root.scale.setScalar(scale); root.position.set(-centre.x * scale, -centre.y * scale - 0.45, -centre.z * scale);
    root.rotation.y = 0; // the Fal sedan ships rear-facing on its local camera axis: preserve its light bar toward the visitor
    rig.add(root); model = root;
    host.dataset.model = 'ready';
  };
  const draco = new DRACOLoader().setDecoderPath('/draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  loader.load('/night/models/landing-hovercar.glb', (g) => fit(g.scene), undefined, () => {
    loader.load('/night/models/cars/hover-sedan.glb', (g) => fit(g.scene));
  });
  const resize = () => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  const tick = (ms: number) => {
    if (!live) return;
    const t = ms * 0.001;
    if (model && motion()) { rig.position.y = Math.sin(t * 1.4) * 0.12; rig.rotation.y = Math.sin(t * 0.42) * 0.11; }
    else { rig.position.y = 0; rig.rotation.y = 0; }
    host.dataset.motion = motion() ? 'full' : 'reduced';
    renderer.render(scene, camera); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    live = false; ro.disconnect(); draco.dispose();
    scene.traverse((o: any) => { if (!o.isMesh) return; o.geometry.dispose();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        for (const value of Object.values(m)) if ((value as any)?.isTexture) (value as THREE.Texture).dispose();
        m.dispose();
      }
    });
    renderer.dispose(); renderer.forceContextLoss(); host.replaceChildren();
  };
}

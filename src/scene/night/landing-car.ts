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

  // Real geometry, not a movie: radial lanes race past the chase camera on Enter.
  const count = 420, positions = new Float32Array(count * 6), colors = new Float32Array(count * 6);
  const lanes = Array.from({ length: count }, (_, i) => {
    const angle = i * 2.399963, radius = 5 + ((i * 37) % 130) / 10;
    const tint = new THREE.Color(i % 5 ? 0x62dcff : 0xdc5aff);
    tint.toArray(colors, i * 6); tint.clone().multiplyScalar(.08).toArray(colors, i * 6 + 3);
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, z: -((i * 17) % 100) };
  });
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const starMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
  const stars = new THREE.LineSegments(starGeo, starMat); stars.frustumCulled = false; scene.add(stars);
  let launchedAt = 0, emergedAt = 0, lastTime = 0, baseFov = 34;

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
  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    // Expanding the canvas to full-screen must not suddenly enlarge the car.
    const framingHeight = matchMedia('(max-width: 760px)').matches ? innerHeight * .42 : Math.min(440, innerHeight * .48);
    baseFov = THREE.MathUtils.radToDeg(2 * Math.atan(h / framingHeight * Math.tan(THREE.MathUtils.degToRad(17))));
    camera.fov = baseFov; camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize); ro.observe(host); resize();
  const tick = (ms: number) => {
    if (!live) return;
    const t = ms * 0.001;
    const dt = Math.min(.05, lastTime ? t - lastTime : 0); lastTime = t;
    const moving = motion(), boot = host.closest('#boot');
    if (boot && !launchedAt) launchedAt = t;
    const launch = moving && launchedAt ? THREE.MathUtils.smoothstep(t - launchedAt, 0, 1.7) : 0;
    const emerging = boot?.classList.contains('is-arriving');
    if (emerging && !emergedAt) emergedAt = t;
    const exit = emergedAt ? THREE.MathUtils.smoothstep(t - emergedAt, 0, .5) : 0;
    const thrust = launch * (1 - exit);
    host.dataset.phase = !moving ? 'still' : boot ? emerging ? 'emerging' : 'hyperspace' : 'hover';
    if (model && moving) {
      rig.position.set(Math.sin(t * .6) * thrust * .18, Math.sin(t * 1.4) * .12, -thrust * 5);
      rig.rotation.set(-thrust * .055, Math.sin(t * .42) * .11 * (1 - launch), Math.sin(t * .9) * thrust * .025);
    } else { rig.position.set(0, 0, 0); rig.rotation.set(0, 0, 0); }
    starMat.opacity = moving && boot ? thrust * .85 : 0;
    for (let i = 0; i < count; i++) {
      const lane = lanes[i]; lane.z += dt * (8 + thrust * 85);
      if (lane.z > 8) lane.z -= 108;
      positions.set([lane.x, lane.y, lane.z, lane.x, lane.y, lane.z - .2 - launch * 15], i * 6);
    }
    starGeo.attributes.position.needsUpdate = true;
    camera.fov = baseFov + thrust * 9; camera.updateProjectionMatrix();
    cyan.intensity = 16 + launch * 15; magenta.intensity = 18 + launch * 10;
    host.dataset.motion = moving ? 'full' : 'reduced';
    renderer.render(scene, camera); requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return () => {
    live = false; ro.disconnect(); draco.dispose();
    starGeo.dispose(); starMat.dispose();
    scene.traverse((o: any) => { if (!o.isMesh) return; o.geometry.dispose();
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        for (const value of Object.values(m)) if ((value as any)?.isTexture) (value as THREE.Texture).dispose();
        m.dispose();
      }
    });
    renderer.dispose(); renderer.forceContextLoss(); host.replaceChildren();
  };
}

import * as THREE from 'three/webgpu';
import {
  pass, uv, texture, positionLocal, positionWorld, normalWorld, float, vec2, vec3, vec4, color, mix, step,
  smoothstep, fract, floor, abs, hash, time, instanceIndex, uniform, luminance, fog, densityFogFactor,
  attribute, sin, max, dot, normalize, cameraPosition, pow,
} from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

/*
 * Night City lab scene. Everything here is a candidate module for src/scene/night/*:
 *   backdrop (2.5D depth-displaced plate), towers (procedural window grids + reused GLBs),
 *   signs (keyed cutouts + canvas text), ads (hovering holo panels), traffic (Kenney cars as
 *   hover cars with light trails), pedestrians (Kenney animated characters), rain, wet ground, bloom.
 */

type Tier = 'high' | 'med' | 'low';
const params = new URLSearchParams(location.search);
const rng = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const PAL = { cyan: 0x00e5ff, magenta: 0xff2bd6, yellow: 0xf2ff3d, sodium: 0xff9a3d, asphalt: 0x07070c };

export async function start(root: HTMLElement) {
  const renderer = new THREE.WebGPURenderer({ antialias: false });
  await renderer.init();
  const isWebGPU = (renderer.backend as any).isWebGPUBackend === true;
  const tier: Tier = (params.get('q') as Tier) || (isWebGPU ? 'high' : 'low');
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier === 'high' ? 1.5 : 1.25));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060c);
  scene.fogNode = fog(color(0x0b0d1c).mul(0.9), densityFogFactor(0.0045));
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 2000);
  const camZ = Number(params.get('cam')) || 0;
  camera.position.set(0, 31, 44 + camZ);
  camera.lookAt(0, 26, -60);

  scene.add(new THREE.HemisphereLight(0x223055, 0x0a0710, 0.6));
  const key = new THREE.DirectionalLight(0x8fb3ff, 0.35);
  key.position.set(-40, 80, 20);
  scene.add(key);

  const loader = new THREE.TextureLoader();
  const gltf = new GLTFLoader();
  const load = (p: string) => loader.loadAsync(p).then((t) => { t.colorSpace = THREE.SRGBColorSpace; return t; });

  // ---------- Backdrop: depth-displaced 2.5D plate ----------
  {
    const plate = await load('/night/backdrop/aerial.webp');
    const depth = await loader.loadAsync('/night/backdrop/aerial-depth.png');
    const aspect = plate.image.width / plate.image.height;
    const H = 520, W = H * aspect;
    const geo = new THREE.PlaneGeometry(W, H, 256, 128);
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.fog = false;
    const d = texture(depth, uv()).r;
    mat.positionNode = positionLocal.add(vec3(0, 0, d.mul(140)));
    mat.colorNode = texture(plate, uv()).rgb.mul(vec3(0.95, 1.0, 1.08)).mul(1.15);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, 150, -560);
    scene.add(mesh);
  }

  // ---------- Ground: wet asphalt with lane paint ----------
  {
    const g = new THREE.PlaneGeometry(600, 900);
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.25, metalness: 0.1 });
    const xz = positionWorld.xz;
    const lane = step(0.985, fract(xz.x.mul(1 / 16).add(0.5))).mul(step(0.5, fract(xz.y.mul(0.12))));
    const puddle = smoothstep(0.35, 0.6, hash(floor(xz.mul(0.15)).x.mul(11.3).add(floor(xz.mul(0.15)).y.mul(7.7))));
    m.colorNode = mix(color(0x0a0b12), color(0x141826), puddle);
    m.emissiveNode = color(PAL.sodium).mul(lane).mul(1.6);
    m.roughnessNode = mix(float(0.35), float(0.08), puddle);
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(0, 0, -300);
    scene.add(mesh);
  }

  // ---------- Procedural towers with TSL window grids ----------
  const towerCount = { high: 900, med: 500, low: 250 }[tier];
  {
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.6, metalness: 0.2 });
    const wall = float(1).sub(smoothstep(0.4, 0.6, abs(normalWorld.y))); // no windows on roofs
    const across = mix(positionWorld.x, positionWorld.z, abs(normalWorld.x));
    // Per-building window pitch and occupancy, so towers don't all read as the same LED grid.
    const bId = float(instanceIndex);
    const pitch = hash(bId.mul(0.731)).mul(0.9).add(0.55); // cells per world unit: 0.55–1.45
    const pitchY = pitch.mul(0.8);
    const occupancy = hash(bId.mul(0.413)).mul(0.45).add(0.2); // 20–65% of windows lit
    const cx = floor(across.mul(pitch)), cy = floor(positionWorld.y.mul(pitchY));
    const seed = cx.mul(13.1).add(cy.mul(7.3)).add(bId.mul(0.37));
    const lit = step(float(1).sub(occupancy), hash(seed));
    const fx = fract(across.mul(pitch)), fy = fract(positionWorld.y.mul(pitchY));
    const inset = step(0.22, fx).mul(step(fx, 0.78)).mul(step(0.25, fy)).mul(step(fy, 0.75));
    const flicker = float(1).sub(step(0.975, hash(seed.add(floor(time.mul(2.0)).mul(3.1)))));
    const warm = hash(seed.add(99.0));
    const winColor = mix(color(PAL.sodium), mix(color(PAL.cyan), color(0xdfe8ff), step(0.5, warm)), step(0.35, warm));
    const bright = hash(seed.add(7.0)).mul(0.8).add(0.6);
    mat.colorNode = color(0x141826);
    mat.emissiveNode = winColor.mul(lit).mul(inset).mul(wall).mul(flicker).mul(bright).mul(1.7);
    const towers = new THREE.InstancedMesh(geo, mat, towerCount);
    const r = rng(7);
    const m = new THREE.Matrix4();
    let n = 0, guard = 0;
    while (n < towerCount && guard++ < towerCount * 20) {
      const gx = Math.round((r() * 2 - 1) * 20), gz = Math.round(-r() * 40) - 1;
      const x = gx * 14 + (r() - 0.5) * 3, z = gz * 14 + (r() - 0.5) * 3;
      if (Math.abs(x) < 11) continue; // the avenue
      if (z > -12 && Math.abs(x) < 30) continue; // keep the foreground open
      const dist = Math.hypot(x, z + 40);
      const h = 18 + r() * r() * 70 + Math.min(40, dist * 0.08);
      const w = 8 + r() * 6, dd = 8 + r() * 6;
      m.compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion(), new THREE.Vector3(w, h, dd));
      towers.setMatrixAt(n++, m);
    }
    towers.count = n;
    scene.add(towers);
  }

  // ---------- Reused playweave GLB towers with lit windows ----------
  const litWindows = (obj: THREE.Object3D) => {
    obj.traverse((o: any) => {
      if (!o.isMesh || !o.material?.map) return;
      const tex = texture(o.material.map, uv());
      const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
      m.colorNode = tex.rgb.mul(0.55);
      const glow = smoothstep(0.42, 0.62, luminance(tex.rgb));
      m.emissiveNode = tex.rgb.mul(glow).mul(2.6);
      o.material = m;
    });
  };
  for (const [file, x, z, s, yaw] of [['tower-01', -30, -30, 1, 0.2], ['tower-02', 28, -48, 1.15, -0.4], ['tower-03', -52, -90, 1.3, 0.8]] as const) {
    try {
      const g = await gltf.loadAsync(`/night/models/${file}.glb`);
      const box = new THREE.Box3().setFromObject(g.scene);
      const h = box.max.y - box.min.y;
      const k = (55 * s) / h; // normalise to ~55 u tall
      g.scene.scale.setScalar(k);
      g.scene.position.set(x, -box.min.y * k, z);
      g.scene.rotation.y = yaw;
      litWindows(g.scene);
      scene.add(g.scene);
    } catch (e) { console.warn('tower load failed', file, e); }
  }

  // ---------- Neon signs: keyed cutouts (if present) + canvas text signs ----------
  const signGroup = new THREE.Group();
  scene.add(signGroup);
  const signMat = (tex: THREE.Texture, id: number, tint = 0xffffff) => {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const t = texture(tex, uv());
    const slow = hash(float(id).add(floor(time.mul(0.5))));
    const buzz = mix(float(1), hash(float(id).add(floor(time.mul(30)))), step(0.88, slow));
    m.colorNode = t.rgb.mul(color(tint)).mul(3.2).mul(buzz.mul(0.6).add(0.4));
    m.opacityNode = t.a;
    return m;
  };
  const canvasSign = (text: string, col: string, w = 512, h = 160) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    g.font = `700 ${h * 0.55}px "Rajdhani", "Chakra Petch", "Impact", sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.shadowColor = col; g.shadowBlur = h * 0.18;
    g.strokeStyle = col; g.lineWidth = h * 0.05;
    g.strokeText(text, w / 2, h / 2);
    g.shadowBlur = h * 0.06;
    g.fillStyle = '#ffffff';
    g.fillText(text, w / 2, h / 2);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const textSigns: [string, string, number, number, number, number][] = [
    ['GPU·PERF', '#00e5ff', -19, 26, -22, 0.4], ['24H', '#ff2bd6', 20, 18, -40, -0.5], ['ナイト', '#f2ff3d', -34, 40, -70, 0.9],
    ['FRAME', '#ff2bd6', 22, 34, -96, -0.6], ['メモリ', '#00e5ff', -22, 52, -130, 0.3],
  ];
  textSigns.forEach(([txt, col, x, y, z, yaw], i) => {
    const t = canvasSign(txt, col);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(12, 3.75), signMat(t, i));
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    signGroup.add(mesh);
  });
  const keyedSigns = ['sign-1', 'sign-2', 'sign-3', 'sign-4', 'sign-5', 'sign-6'];
  const signSpots: [number, number, number, number][] = [[-16, 20, -30, 0.5], [17, 24, -58, -0.6], [-28, 34, -84, 0.7], [30, 30, -110, -0.8], [-20, 44, -150, 0.5], [18, 46, -180, -0.4]];
  await Promise.all(keyedSigns.map(async (name, i) => {
    try {
      const t = await load(`/night/signs/${name}.webp`);
      const a = t.image.width / t.image.height;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(8 * a, 8), signMat(t, 10 + i));
      const [x, y, z, yaw] = signSpots[i];
      mesh.position.set(x, y, z);
      mesh.rotation.y = yaw;
      signGroup.add(mesh);
    } catch { /* not generated yet */ }
  }));

  // ---------- Hovering ads ----------
  const ads: { mesh: THREE.Mesh; base: THREE.Vector3; phase: number }[] = [];
  const adFiles = ['ad-1', 'ad-2', 'ad-3', 'ad-4'];
  const adSpots: [number, number, number][] = [[-9, 36, -34], [11, 42, -64], [-13, 30, -100], [14, 48, -140]];
  await Promise.all(adFiles.map(async (name, i) => {
    try {
      let t: THREE.Texture = await load(`/night/ads/${name}.webp`);
      if (name === 'ad-3' && !params.has('novideo')) {
        // Generated loop (LTX) as a live texture, if it exists.
        const ok = await fetch('/night/ads/ad-3-loop.mp4', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
        if (ok) {
          const v = document.createElement('video');
          Object.assign(v, { src: '/night/ads/ad-3-loop.mp4', muted: true, loop: true, playsInline: true, autoplay: true });
          await v.play().catch(() => {});
          const vt = new THREE.VideoTexture(v);
          vt.colorSpace = THREE.SRGBColorSpace;
          t = vt;
          console.info('[night] ad-3 video loop active');
        }
      }
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, side: THREE.DoubleSide });
      const s = texture(t, uv());
      const scan = step(0.5, fract(uv().y.mul(90).add(time.mul(8)))).mul(0.12).add(0.88);
      const glitch = step(0.97, hash(floor(time.mul(6)).add(float(i)))).mul(hash(floor(uv().y.mul(24)).add(time)).sub(0.5)).mul(0.04);
      const s2 = texture(t, uv().add(vec2(glitch, 0)));
      m.colorNode = s2.rgb.mul(scan).mul(2.4);
      m.opacityNode = float(0.82);
      const frame = new THREE.Mesh(new THREE.PlaneGeometry(9 * 9 / 16 * 1.6, 9 * 1.6), m);
      const [x, y, z] = adSpots[i];
      frame.position.set(x, y, z);
      frame.rotation.y = x < 0 ? 0.35 : -0.35;
      // thin cyan border
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(9 * 9 / 16 * 1.6 + 0.3, 9 * 1.6 + 0.3), new THREE.MeshBasicNodeMaterial({ color: PAL.cyan, transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
      edge.position.z = -0.02;
      frame.add(edge);
      scene.add(frame);
      ads.push({ mesh: frame, base: frame.position.clone(), phase: i * 1.7 });
      void s; // (unused direct sample kept for clarity)
    } catch { /* not generated yet */ }
  }));

  // ---------- Traffic: Kenney cars as hover cars on lanes, with light trails ----------
  const lanes = [
    { pts: [[-60, 22, 30], [-30, 24, -40], [-10, 26, -120], [6, 27, -220], [30, 28, -330]], dir: 1, speed: 0.06 },
    { pts: [[40, 30, -330], [18, 31, -200], [8, 33, -110], [26, 34, -30], [70, 35, 30]], dir: 1, speed: 0.05 },
    { pts: [[-80, 40, -60], [-40, 41, -90], [0, 42, -110], [40, 43, -130], [80, 44, -170]], dir: 1, speed: 0.045 },
  ].map((l) => ({ ...l, curve: new THREE.CatmullRomCurve3(l.pts.map((p) => new THREE.Vector3(...(p as [number, number, number])))) }));
  const cars: { root: THREE.Object3D; lane: number; t: number; speed: number }[] = [];
  const carFiles = ['sedan', 'taxi', 'suv', 'hatchback-sports'];
  const carModels: THREE.Group[] = [];
  // Generated hover car (Hunyuan3D v3) if present: normalised to ~4.5 u long, dark body + emissive strips.
  if (!params.has('kenney')) {
    try {
      const g = await gltf.loadAsync('/night/models/hovercar.glb');
      const box = new THREE.Box3().setFromObject(g.scene);
      const size = box.getSize(new THREE.Vector3());
      const k = 4.5 / Math.max(size.x, size.z);
      g.scene.scale.setScalar(k);
      g.scene.position.y = -box.min.y * k;
      g.scene.rotation.y = size.x > size.z ? Math.PI / 2 : 0; // long axis along z (lane direction)
      g.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        const map = o.material?.map;
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.3, metalness: 0.7 });
        const base = map ? texture(map, uv()).rgb : vec3(0.12, 0.13, 0.18);
        // Anything already bright in the texture (light strips) becomes emissive cyan/magenta.
        const strip = smoothstep(0.45, 0.7, luminance(base));
        m.colorNode = base.mul(0.5);
        m.emissiveNode = mix(color(PAL.cyan), color(PAL.magenta), step(0.5, fract(positionLocal.z.mul(0.3)))).mul(strip).mul(3.0);
        o.material = m;
      });
      const wrap = new THREE.Group();
      wrap.add(g.scene);
      carModels.push(wrap);
      console.info('[night] hover car GLB loaded', size.toArray().map((v) => v.toFixed(2)).join('×'));
    } catch { /* not generated yet */ }
  }
  for (const f of carModels.length ? [] : carFiles) {
    try {
      const g = await gltf.loadAsync(`/night/cc0/${f}.glb`);
      g.scene.traverse((o: any) => {
        if (!o.isMesh) return;
        if (/wheel/i.test(o.name)) { o.visible = false; return; }
        const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.35, metalness: 0.6 });
        m.colorNode = color(0x1a1e2c);
        o.material = m;
      });
      carModels.push(g.scene);
    } catch (e) { console.warn('car load failed', f, e); }
  }
  const carCount = { high: 36, med: 20, low: 10 }[tier];
  const r2 = rng(99);
  for (let k = 0; k < carCount && carModels.length; k++) {
    const root = new THREE.Group();
    const body = carModels[k % carModels.length].clone(true);
    body.scale.setScalar(1.6);
    root.add(body);
    // underglow + tail light
    const glowMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const dd = uv().sub(0.5).length();
    glowMat.colorNode = color(PAL.cyan).mul(2.5);
    glowMat.opacityNode = float(1).sub(smoothstep(0.15, 0.5, dd)).mul(0.6);
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.5, 2.6), glowMat);
    glow.rotation.x = -Math.PI / 2; glow.position.y = -0.2;
    root.add(glow);
    const tail = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.25), new THREE.MeshBasicNodeMaterial({ color: 0xff2040 }));
    tail.position.set(0, 0.6, 1.5);
    root.add(tail);
    const head = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.2), new THREE.MeshBasicNodeMaterial({ color: 0xffffff }));
    head.position.set(0, 0.6, -1.5); head.rotation.y = Math.PI;
    root.add(head);
    const lane = k % lanes.length;
    cars.push({ root, lane, t: r2(), speed: lanes[lane].speed * (0.8 + r2() * 0.5) });
    scene.add(root);
  }
  // Light trails: dashed pulses along each lane, red and white
  for (const [i, l] of lanes.entries()) {
    for (const [tint, off, dir] of [[0xff3050, 0.9, 1], [0xffffff, -0.9, -1]] as const) {
      const tube = new THREE.TubeGeometry(l.curve, 200, 0.12, 6);
      const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
      const s = uv().x;
      const pulse = pow(fract(s.mul(28).sub(time.mul(0.9 * dir)).add(i * 0.3)), 6.0);
      m.colorNode = color(tint).mul(pulse).mul(3.0);
      m.opacityNode = pulse.mul(0.9);
      const mesh = new THREE.Mesh(tube, m);
      mesh.position.x = off;
      scene.add(mesh);
    }
  }

  // ---------- Pedestrians: Kenney animated mini characters on a foreground walkway ----------
  const walkway = new THREE.Mesh(new THREE.BoxGeometry(46, 1.2, 10), new THREE.MeshStandardNodeMaterial({ color: 0x1a1e2e, roughness: 0.18, metalness: 0.35 }));
  walkway.position.set(0, 23.4, -6);
  scene.add(walkway);
  const rail = new THREE.Mesh(new THREE.BoxGeometry(46, 0.12, 0.12), new THREE.MeshBasicNodeMaterial({ color: PAL.cyan }));
  rail.position.set(0, 25.1, -10.8);
  scene.add(rail);
  for (const lx of [-14, 0, 14]) {
    const lamp = new THREE.PointLight(0xffb070, 60, 26, 1.6);
    lamp.position.set(lx, 27.5, -6);
    scene.add(lamp);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), new THREE.MeshBasicNodeMaterial({ color: 0xffd9a0 }));
    bulb.position.copy(lamp.position);
    scene.add(bulb);
  }
  const personMaterial = (mesh: any) => {
    const map = mesh.material?.map;
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.7 });
    const base = map ? texture(map, uv()).rgb : vec3(0.5, 0.55, 0.7);
    const v = normalize(cameraPosition.sub(positionWorld));
    const rim = pow(float(1).sub(max(dot(normalWorld, v), 0.0)), 2.5);
    m.colorNode = base;
    m.emissiveNode = color(PAL.cyan).mul(rim).mul(0.9).add(base.mul(0.15));
    return m;
  };
  const mixers: THREE.AnimationMixer[] = [];
  const walkers: { root: THREE.Object3D; x: number; dir: number; speed: number }[] = [];
  const peopleFiles = ['character-male-a', 'character-female-b', 'character-male-c', 'character-female-d'];
  const people: { scene: THREE.Group; clips: THREE.AnimationClip[] }[] = [];
  for (const f of peopleFiles) {
    try { const g = await gltf.loadAsync(`/night/cc0/${f}.glb`); people.push({ scene: g.scene, clips: g.animations }); }
    catch (e) { console.warn('person load failed', f, e); }
  }
  if (people.length) console.info('[night] character clips:', people[0].clips.map((c) => c.name).join(', '));
  const r3 = rng(5);
  const walkerCount = { high: 12, med: 8, low: 4 }[tier];
  for (let k = 0; k < walkerCount && people.length; k++) {
    const src = people[k % people.length];
    const root = SkeletonUtils.clone(src.scene) as THREE.Object3D;
    root.traverse((o: any) => { if (o.isMesh) o.material = personMaterial(o); });
    root.scale.setScalar(1.6);
    const dir = k % 2 ? 1 : -1;
    const x = (r3() * 2 - 1) * 20;
    root.position.set(x, 24, -3 - r3() * 5);
    root.rotation.y = dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    scene.add(root);
    const mixer = new THREE.AnimationMixer(root);
    const walk = src.clips.find((c) => /walk/i.test(c.name)) || src.clips[0];
    if (walk) { const a = mixer.clipAction(walk); a.time = r3() * walk.duration; a.play(); }
    mixers.push(mixer);
    walkers.push({ root, x, dir, speed: 1.4 + r3() * 0.8 });
  }

  // ---------- Rain ----------
  let rain: THREE.InstancedMesh | null = null;
  const rainCount = params.has('norain') ? 0 : { high: 5000, med: 2500, low: 0 }[tier];
  if (rainCount) {
    const geo = new THREE.PlaneGeometry(0.03, 0.9);
    const igeo = new THREE.InstancedBufferGeometry().copy(geo as any);
    const seeds = new Float32Array(rainCount * 3);
    const r4 = rng(11);
    for (let i = 0; i < rainCount; i++) { seeds[i * 3] = r4(); seeds[i * 3 + 1] = r4(); seeds[i * 3 + 2] = r4(); }
    igeo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
    igeo.instanceCount = rainCount;
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const s = attribute('aSeed', 'vec3');
    const box = vec3(90, 40, 90);
    const fall = fract(s.y.add(time.mul(0.55).mul(s.z.mul(0.5).add(0.8))));
    const off = vec3(s.x.mul(box.x).sub(box.x.mul(0.5)), box.y.sub(fall.mul(box.y)), s.z.mul(box.z).sub(box.z.mul(0.5)));
    m.positionNode = positionLocal.add(off).add(vec3(cameraPosition.x, cameraPosition.y.sub(20), cameraPosition.z.sub(35)));
    m.colorNode = color(0xa9c8ff);
    m.opacityNode = float(0.13);
    rain = new THREE.InstancedMesh(igeo as any, m, rainCount);
    rain.frustumCulled = false;
    scene.add(rain);
  }

  // ---------- Post: bloom ----------
  const pipeline = new THREE.RenderPipeline(renderer);
  const scenePass = pass(scene, camera, { samples: tier === 'low' ? 4 : 0 });
  const beauty = scenePass.getTextureNode('output');
  pipeline.outputNode = params.has('nobloom') ? beauty : beauty.add(bloom(beauty, 0.7, 0.55, 0.9));

  const pointer = new THREE.Vector2();
  addEventListener('pointermove', (e) => pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1));
  const clock = new THREE.Timer();
  const tmp = new THREE.Vector3(), ahead = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    clock.update();
    const t = clock.getElapsed(), dt = Math.min(clock.getDelta(), 0.05);
    camera.position.x = pointer.x * 1.5;
    camera.position.y = 31 + Math.sin(t * 0.6) * 0.35 - pointer.y * 0.6;
    camera.rotation.z = -pointer.x * 0.02;
    for (const c of cars) {
      c.t = (c.t + c.speed * dt) % 1;
      const l = lanes[c.lane];
      l.curve.getPointAt(c.t, tmp);
      l.curve.getPointAt((c.t + 0.01) % 1, ahead);
      c.root.position.copy(tmp);
      c.root.lookAt(ahead);
      c.root.position.y += Math.sin(t * 2 + c.t * 20) * 0.15;
    }
    for (const a of ads) {
      a.mesh.position.y = a.base.y + Math.sin(t * 0.7 + a.phase) * 0.6;
      a.mesh.position.x = a.base.x + Math.sin(t * 0.3 + a.phase) * 0.4;
    }
    for (const w of walkers) {
      w.x += w.dir * w.speed * dt;
      if (w.x > 22) { w.x = 22; w.dir = -1; w.root.rotation.y = -Math.PI / 2; }
      if (w.x < -22) { w.x = -22; w.dir = 1; w.root.rotation.y = Math.PI / 2; }
      w.root.position.x = w.x;
    }
    for (const m of mixers) m.update(dt);
    if (rain) rain.rotation.y = 0; // streaks are vertical; no billboarding needed at this thickness
    pipeline.render();
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  });
  return { tier, isWebGPU, towers: towerCount, cars: cars.length, walkers: walkers.length, ads: ads.length, rain: rainCount };
}

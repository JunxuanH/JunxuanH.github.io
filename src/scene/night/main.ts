import * as THREE from 'three/webgpu';
import { CSS3DRenderer } from 'three/addons/renderers/CSS3DRenderer.js';
import { createContent } from './content';
import { boot } from './boot';
import { dedupeMaterials } from './districts/shared';
import { createLightPool } from './lights';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';

import { PAL, params, reducedMotion, loader, type Tier } from './palette';
import { createSky, createHaze } from './sky';
import { createPost } from './post';
import { createBackdrop } from './backdrop';
import { createStreets, loadGroundTextures, AVENUE_HALF, SIDEWALK, CROSS_Z, CROSS_HALF, QUAY_Z } from './streets';
import { createEnvironment } from './env';
import { createParticles, type ParticleSpec } from './particles';
import { createKitbash, loadGlbTowers } from './towers';
import { createProps } from './props';
import { loadCharacter, loadKenney, createCrowd } from './characters';
import { createRobots } from './robots';
import { createDrones } from './drones';
import { DISTRICT_CROWDS, PATROLS, DRONE_LANES } from './paths';
import { createWater, createBridge, createBillboard, createQuay } from './bay';
import { createKeyedSigns, neonText, signRegistryGroup } from './signs';
import { createAudio, bindAudioToggle } from './audio';
import { createInteract } from './interact';
import { createAds } from './ads';
import { createTraffic } from './traffic';
import { createRain } from './rain';
import { createDistricts } from './districts';
import { ANCHORS, poseAt, sectionAt, sectionStart, SECTIONS, type SectionId } from './journey';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

/**
 * Night City. Bay vista hero → flight into the avenue → Education, Work, Projects, Contact districts.
 * All lights are emissive; bloom is the light source. `?q=high|med|low`, `?p=0.4` (jump to progress),
 * `?nobloom ?noca ?nosharp ?norain ?novideo ?kenney ?nokit ?noglb ?nowater ?debug`.
 */
export async function start(root: HTMLElement) {
  const narrow = matchMedia('(max-width: 760px)').matches;
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  await renderer.init();
  boot.phase('renderer up', 0.05);
  const isWebGPU = (renderer.backend as any).isWebGPUBackend === true;
  // Default to medium on WebGPU: same look as high minus grain/CA/sharpen at roughly half the frame cost.
  const tier: Tier = (params.get('q') as Tier) || (isWebGPU ? 'med' : 'low');
  document.documentElement.dataset.tier = tier;
  document.documentElement.dataset.backend = isWebGPU ? 'webgpu' : 'webgl2';
  // Resolution is budgeted in pixels, not device ratio: a Retina desktop or a 3× phone would otherwise
  // render 3–5× the pixels of a laptop. The governor below then trims/raises it from measured frame time.
  const PIXEL_BUDGET = { high: 2.4e6, med: 1.7e6, low: 0.9e6 }[tier];
  const dprCap = Math.min(devicePixelRatio, tier === 'low' ? 1.5 : 1.25, Math.sqrt(PIXEL_BUDGET / (innerWidth * innerHeight)));
  let dpr = Number(params.get('dpr')) || Math.max(0.6, dprCap);
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(params.get('exp')) || 1.0;
  root.appendChild(renderer.domElement);
  if (params.has('debug')) {
    const { Inspector } = await import('three/addons/inspector/Inspector.js');
    (renderer as any).inspector = new Inspector();
  }

  const scene = new THREE.Scene();
  scene.fogNode = createHaze(Number(params.get('haze')) || 0.0032);
  const camera = new THREE.PerspectiveCamera(narrow ? 62 : 50, innerWidth / innerHeight, 0.5, 2600);
  scene.add(camera);

  // Ambient is what makes the façades read as surfaces instead of black outlines.
  scene.add(new THREE.HemisphereLight(0x3d4f86, 0x2a1230, Number(params.get('amb')) || 2.0));
  const moon = new THREE.DirectionalLight(0x9ab0ff, Number(params.get('moon')) || 1.2);
  moon.position.set(-300, 400, -500);
  scene.add(moon);
  // Local street light: point lights where the camera stops, requested by each district (theme.ts palettes).
  const lamp = (x: number, y: number, z: number, c: number, i = 900, d = 55) => {
    const l = new THREE.PointLight(c, i, d, 2);
    l.position.set(x, y, z);
    scene.add(l);
  };

  // ---------- world
  scene.environment = createEnvironment(renderer); // wet-surface reflections for puddles, glass, metal
  scene.environmentIntensity = 0.55;
  scene.add(createSky(tier));
  // Phones / WebGL2 get a lighter city: half-res textures + 512 px signature towers from /night-lite,
  // fewer rigs, no far crowd, no ad videos. The URL modifier covers every three loader (default manager).
  const lite = tier === 'low' || narrow;
  if (lite || params.has('lite')) {
    THREE.DefaultLoadingManager.setURLModifier((url) => {
      if (/^\/night\/(facades|ads|ground|signs|backdrop)\//.test(url) || /^\/night\/models\/tower-[a-d]\.glb$/.test(url)) return url.replace('/night/', '/night-lite/');
      if (url === '/textures/waternormals.jpg') return '/night-lite/textures/waternormals.jpg';
      return url;
    });
  }
  boot.phase('paving the streets', 0.1);
  const ground = await loadGroundTextures();
  scene.add(createStreets(ground));
  const pending: Promise<unknown>[] = []; // async builds to finish before the shader pre-warm
  pending.push(createBackdrop().then((m) => scene.add(m)).catch((e) => console.warn('[night] backdrop', e)));

  const keepOut: [number, number, number][] = [
    [ANCHORS.towerA.x, ANCHORS.towerA.z, 20], [-30, -95, 18], [30, -95, 18], [-22, -190, 18],
    [ANCHORS.campus.x, ANCHORS.campus.z, 52], [ANCHORS.campus.x, -72, 24], [ANCHORS.market.x, ANCHORS.market.z, 44], [ANCHORS.pad.x - 10, -24, 34],
    [34, -118, 17], // media tower (carriers/megascreen.ts)
  ];
  const srgb = (t: THREE.Texture) => { t.colorSpace = THREE.SRGBColorSpace; return t; };
  const [facadeTex, screensTex, storefrontTex] = await Promise.all([
    loader.loadAsync('/night/facades/facade-mix.jpg').then((t) => { srgb(t); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; }).catch(() => null),
    loader.loadAsync('/night/ads/screens-atlas.jpg').then(srgb).catch(() => null),
    loader.loadAsync('/night/facades/storefronts.jpg').then(srgb).catch(() => null),
  ]);
  const margin = SIDEWALK + 1;
  boot.phase('raising the skyline', 0.22);
  const kit = params.has('nokit') ? null : createKitbash({
    tier, keepOut, atlas: params.has('noatlas') ? null : facadeTex, screens: screensTex, storefronts: storefrontTex,
    clear: (x, z, hw, hd) => Math.abs(x) - hw > AVENUE_HALF + margin && CROSS_Z.every((cz) => Math.abs(z - cz) - hd > CROSS_HALF + margin),
    streetSide: (x, z, hw, hd) => {
      if (Math.abs(x) - hw < AVENUE_HALF + margin + 8) return x > 0 ? 'nx' : 'px';
      const cz = CROSS_Z.find((c) => Math.abs(z - c) - hd < CROSS_HALF + margin + 8);
      return cz === undefined ? null : z > cz ? 'nz' : 'pz';
    },
  });
  if (kit) scene.add(kit.group);

  // Signature (fal) towers first, playweave set as mid-ground fill.
  if (!params.has('noglb')) {
    pending.push(loadGlbTowers([
      { file: 'tower-a', x: ANCHORS.towerA.x, z: ANCHORS.towerA.z, height: 84, tint: PAL.cyan },
      { file: 'tower-b', x: -30, z: -95, height: 70, yaw: 0.2, tint: PAL.magenta },
      { file: 'tower-c', x: 30, z: -95, height: 64, yaw: -0.3, tint: PAL.cyan },
      { file: 'tower-d', x: -22, z: -190, height: 78, yaw: 0.1, tint: PAL.yellow },
      { file: 'tower-01', x: -62, z: -130, height: 58, yaw: 0.2, tint: PAL.cyan },
      { file: 'tower-02', x: 66, z: -150, height: 62, yaw: -0.4, tint: PAL.magenta },
      { file: 'tower-03', x: -48, z: -240, height: 66, yaw: 0.8, tint: PAL.cyan },
      { file: 'tower-04', x: 90, z: -120, height: 54, yaw: 0.3, tint: PAL.magenta },
      { file: 'tower-05', x: -96, z: -180, height: 60, yaw: -0.2, tint: PAL.cyan },
      { file: 'tower-06', x: 40, z: -260, height: 70, yaw: 0.5, tint: PAL.yellow },
    ]).then((g) => scene.add(g)));
  }

  // ---------- bay
  const water = params.has('nowater') ? null : createWater({ high: 0.5, med: 0.4, low: 0.3 }[tier]);
  if (water) scene.add(water);
  scene.add(createBridge());
  scene.add(createQuay(QUAY_Z, ground));
  const billboard = createBillboard('Ivan He', 'GPU Software Performance Engineer');
  billboard.position.set(ANCHORS.towerA.x, 53, ANCHORS.towerA.z + 14.5);
  scene.add(billboard);

  // ---------- life
  const signs = await createKeyedSigns([
    { x: -16, y: 20, z: -60, yaw: 0.5 }, { x: 17, y: 24, z: -78, yaw: -0.6 }, { x: -28, y: 34, z: -114, yaw: 0.7 },
    { x: 30, y: 30, z: -140, yaw: -0.8 }, { x: -20, y: 44, z: -170, yaw: 0.5 }, { x: 18, y: 46, z: -200, yaw: -0.4 },
    { x: -60, y: 12, z: -60, yaw: 0.9, w: 6 }, { x: 30, y: 7, z: -238, yaw: 0.2, w: 4 }, { x: 58, y: 7.5, z: -218, yaw: Math.PI, w: 4 },
    { x: 72, y: 6.5, z: -238, yaw: 0.3, w: 3.5 }, { x: -20, y: 8, z: -70, yaw: Math.PI / 2, w: 4 }, { x: 20, y: 9, z: -140, yaw: -Math.PI / 2, w: 4 },
  ]);
  scene.add(signs);
  if (lite) params.set('novideo', '1');
  const ads = await createAds([{ x: -12, y: 38, z: -70 }, { x: 14, y: 42, z: -104 }, { x: -14, y: 30, z: -168 }, { x: 16, y: 48, z: -180 }]);
  scene.add(ads.group);
  const traffic = await createTraffic([
    // Street level: both avenue directions and the market cross street.
    { pts: [[-5, 0.1, -24], [-5, 0.1, -200], [-5, 0.1, -640]], speed: 0.02, ground: true },
    { pts: [[5, 0.1, -640], [5, 0.1, -200], [5, 0.1, -24]], speed: 0.018, ground: true },
    { pts: [[-300, 0.1, -232], [0, 0.1, -232], [300, 0.1, -232]], speed: 0.02, ground: true },
    { pts: [[300, 0.1, -224], [0, 0.1, -224], [-300, 0.1, -224]], speed: 0.02, ground: true },
    // Aloft: hover lanes and the bridge deck.
    { pts: [[-40, 22, 300], [-12, 24, 120], [-8, 26, -40], [-6, 28, -200], [10, 30, -420]], speed: 0.05 },
    { pts: [[12, 30, -420], [8, 33, -200], [10, 34, -60], [20, 32, 100], [60, 30, 300]], speed: 0.045 },
    { pts: [[-120, 40, -60], [-60, 41, -90], [0, 42, -110], [40, 43, -130], [120, 44, -170]], speed: 0.04 },
    { pts: [[-300, 13.5, 70], [300, 13.5, 70]], speed: 0.03, ground: true },
  ], tier);
  scene.add(traffic.group);
  const rainCount = params.has('norain') ? 0 : { high: 5000, med: 2500, low: 0 }[tier];
  if (rainCount) scene.add(createRain(rainCount));

  boot.phase('wiring the districts', 0.45);
  const districts = await createDistricts({
    content: {
      // The job slabs live on their own carriers (content.ts); the flame signs stay as short neon labels.
      jobs: [...document.querySelectorAll<HTMLElement>('.slab.job')].slice(0, 4).map((el) => ({ label: el.querySelector('.kicker')?.textContent?.trim() ?? '', rows: 0 })),
      projects: [...document.querySelectorAll<HTMLElement>('.stack .card h3')].map((el) => ({ name: el.firstChild?.textContent?.trim() || '' })),
    },
    tex: { facade: facadeTex, storefronts: storefrontTex, ground },
    tier,
  });

  // ---------- particles & weather (petals, koi, steam, sparks, spray), gated by section
  const specs: ParticleSpec[] = [
    { kind: 'sakura', section: 'education', box: { center: [-80, 10, -102], size: [90, 20, 60] } },
    { kind: 'koi', section: 'education', loops: [[[-96, 0.3, -90], [-90, 0.3, -86], [-86, 0.3, -92], [-90, 0.3, -98], [-96, 0.3, -96]]] },
    { kind: 'steam', section: 'projects', points: [24, 38, 52, 66, 76].map((x) => [x, 2.6, -239] as [number, number, number]) },
    { kind: 'sparks', section: 'projects', origin: [22, 1, -228] },
    { kind: 'spray', section: 'contact', points: [[134.8, -0.2, -10], [145.2, -0.2, 2], [134.8, -0.2, 14], [145.2, -0.2, 26]] },
  ];
  const particles = params.has('noparticles') ? [] : specs.map((s) => createParticles(s, tier, { motion: !reducedMotion }));
  for (const s of particles) { scene.add(s.mesh); s.setWind(0.6); }
  scene.add(districts.group);
  for (const [x, y, z, c, i, d] of districts.lights) lamp(x, y, z, c, i, d);

  // ---------- people, robots, drones (rigged fal characters near the camera, Kenney rigs as the far band)
  const life: { update(dt: number, cam: THREE.Camera): void }[] = [];
  if (!params.has('nopeople')) {
    try {
      boot.phase('waking the residents', 0.62);
      const all = ['netrunner', 'corpo', 'vendor', 'punk', 'sec-bot', 'chef', 'geisha-bot', 'idol', 'ronin', 'schoolgirl-hacker', 'mech-pilot', 'cat-courier', 'oni-bouncer', 'maid-bot'] as const;
      const names = lite ? (['netrunner', 'sec-bot', 'idol', 'maid-bot', 'cat-courier'] as const) : all;
      const rigs = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadCharacter(n)]))) as Partial<Record<(typeof all)[number], Awaited<ReturnType<typeof loadCharacter>>>>;
      const kenney = lite ? [] : await Promise.all(['character-male-a', 'character-female-b', 'character-male-c'].map((f) => loadKenney(f)));
      for (const d of DISTRICT_CROWDS) {
        const assets = d.assets.map((n) => rigs[n]).filter((a): a is NonNullable<typeof a> => !!a);
        if (!assets.length) continue;
        const near = createCrowd({ path: d.path, assets, count: d.count[tier], seed: 7 });
        scene.add(near.group);
        life.push(near);
        if (kenney.length) {
          const far = createCrowd({ path: d.path, assets: kenney, count: d.count[tier], height: 1.6, seed: 11, cullDistance: 140 });
          scene.add(far.group);
          life.push(far);
        }
      }
      if (rigs['sec-bot']) {
        const robots = createRobots({ asset: rigs['sec-bot'], patrols: PATROLS, height: 2.1, searchlight: tier !== 'low' });
        scene.add(robots.group);
        life.push(robots);
      }
      const drones = await createDrones({ lanes: DRONE_LANES, tier });
      scene.add(drones.group);
      life.push(drones);
    } catch (e) { console.warn('[night] life failed', e); }
  }

  // ---------- ambient sound
  const audio = createAudio();
  bindAudioToggle(audio, document.querySelector('.audio-toggle'));

  // ---------- résumé content: slabs on their carriers (kiosk, bus stop, LED wall, blimp, hologram, stall, departures board)
  boot.phase('mounting the résumé', 0.82);
  const content = await createContent({
    scene, narrow, tier, tex: { facade: facadeTex, storefronts: storefrontTex, ground }, people: !params.has('nopeople') && !lite, // carrier NPCs are desktop-only
    onFlap: () => audio.clack(6, 0.07),
  });
  // District + carrier lights go through a fixed-size pool (constant light count → no shader rebuilds).
  const lightPool = createLightPool(scene, 6);
  const propsReady = createProps({ tier, extra: [...districts.props, ...content.props] }).then((p) => { scene.add(p.group); console.info('[night] props', p.count); return p; });
  pending.push(propsReady);

  // ---------- interactions (sign flicker, NPC glances, landing car on the pier)
  const landingCar = traffic.models.ground[0]?.clone(true) ?? null;
  if (landingCar) { landingCar.visible = false; scene.add(landingCar); }
  const interact = createInteract({
    camera, dom: root, signs: signRegistryGroup, crowds: [...life.filter((l: any) => l.walkers), { instances: content.npcs }] as any,
    padRing: districts.padRing, landingCar, padPosition: ANCHORS.pad.clone().setY(2.9),
  });

  // ---------- hero copy (CSS3D slab anchored to the camera, lower-left)
  const cssRenderer = new CSS3DRenderer();
  cssRenderer.setSize(innerWidth, innerHeight);
  cssRenderer.domElement.classList.add('css3d');
  root.appendChild(cssRenderer.domElement);
  // The hero slab is camera-locked, so it is plain fixed DOM (2D parallax below) rather than a CSS3D object:
  // Safari hit-tests 3D-transformed elements inside a perspective context a few pixels off their paint.
  const heroCopy = document.getElementById('hero-copy')!;
  document.body.appendChild(heroCopy);
  heroCopy.classList.add('is-fixed');
  const heroScale = () => { heroCopy.style.setProperty('--hero-scale', String(THREE.MathUtils.clamp(innerWidth / 1800, 0.55, 1))); };
  heroScale();

  // ---------- post
  const { pipeline, scenePass } = createPost(renderer, scene, camera, tier);
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), off = new THREE.Vector3();
  // The water reflector renders with a camera that only sees layer 0: street-level detail goes to layer 1 so it
  // is drawn by the main camera but never mirrored (half the shader builds, far fewer reflection draws).
  camera.layers.enable(1);
  const noReflect = (o: THREE.Object3D | null | undefined) => o?.traverse((c) => { if (!(c as any).isLight) c.layers.set(1); });
  for (const b of [districts.group.children[0], districts.group.children[1], districts.group.children[2]]) noReflect(b); // campus, downtown, market (the pier stays mirrored)
  for (const [id, c] of Object.entries(content.carriers)) if (id !== 'contact') noReflect(c.group);
  for (const l of life as any[]) noReflect(l.group);
  for (const s of particles) noReflect(s.mesh);
  pending.push(propsReady.then((p) => noReflect(p.group)));
  // Share identical plain materials before anything is built (fewer shader builds, fewer pipelines).
  {
    const d = dedupeMaterials(scene);
    console.info('[night] materials', d.before, '→', d.after);
  }
  // `?prof`: time three's internal stages so a slow frame says where it went (node builds, pipelines, uploads).
  const stages: Record<string, number> = {};
  if (params.has('prof')) {
    const wrap = (obj: any, method: string, label: string) => {
      const orig = obj?.[method]; if (!orig) return;
      obj[method] = function (...args: any[]) { const a = performance.now(); const r = orig.apply(this, args); stages[label] = (stages[label] || 0) + performance.now() - a; return r; };
    };
    const r: any = renderer;
    wrap(r._nodes, 'getForRender', 'nodes'); wrap(r._pipelines, 'getForRender', 'pipelines'); wrap(r._textures, 'updateTexture', 'textures');
    wrap(r._geometries, 'updateForRender', 'geometries'); wrap(r._bindings, 'updateForRender', 'bindings'); wrap(r._objects, 'get', 'objects');
    wrap(r.backend, 'draw', 'draw'); wrap(r.backend, 'createRenderPipeline', 'gpuPipeline'); wrap(r.backend, 'createTexture', 'gpuTexture'); wrap(r.backend, 'updateTexture', 'gpuTexUpload');
  }
  // Pre-warm: real frames from every key pose with the whole city visible, so three builds and caches
  // every material/render object now (behind the boot bar) instead of the first time a district scrolls
  // into view. Backgrounding this proved unreliable (three keys the cache per render pass); a slightly
  // longer boot with a progress bar beats freezes while scrolling.
  boot.phase('compiling shaders', 0.86);
  {
    const t0 = performance.now();
    const hidden: THREE.Object3D[] = [];
    scene.traverse((o) => { if (!o.visible) { o.visible = true; hidden.push(o); } });
    const poses = [0, 0.19, 0.31, 0.42, 0.535, 0.66, 0.82, 0.94, 1.0];
    for (let i = 0; i < poses.length; i++) {
      if (water) water.visible = poses[i] === 0 || poses[i] === 1.0; // the reflection pass only where the water is seen
      poseAt(poses[i], pos, look); camera.position.copy(pos); camera.lookAt(look); camera.updateMatrixWorld(true);
      const tp = performance.now();
      pipeline.render();
      if (params.has('prof')) console.info('[night] pre-warm pose', poses[i], Math.round(performance.now() - tp), 'ms');
      boot.phase(`compiling shaders ${i + 1}/${poses.length}`, 0.86 + (0.1 * (i + 1)) / poses.length);
      await new Promise((r) => setTimeout(r, 0)); // let the boot bar paint between the (synchronous) frames
    }
    for (const o of hidden) o.visible = false;
    console.info('[night] pre-warm', Math.round(performance.now() - t0), 'ms', params.has('prof') ? Object.entries(stages).map(([k, v]) => `${k}=${Math.round(v)}`).join(' ') : '');
  }
  boot.phase('first light', 0.97);
  let firstFrame = true;

  // ---------- journey
  const journey = { p: Number(params.get('p')) || 0 };
  ScrollTrigger.create({
    trigger: '.journey', start: 'top top', end: 'bottom bottom', scrub: 0.4,
    onUpdate: (st) => { if (!params.has('p')) journey.p = st.progress; },
  });
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[data-section]')];
  const jumpLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[data-section]')]; // nav + the hero's "Enter the city"
  const journeyEl = document.querySelector<HTMLElement>('.journey')!;
  const scrollTo = (id: SectionId) => {
    const y = journeyEl.offsetTop + sectionStart(id) * (journeyEl.offsetHeight - innerHeight) + 2;
    if (reducedMotion) window.scrollTo(0, y);
    else gsap.to(window, { scrollTo: y, duration: 1.0, ease: 'power2.inOut' });
  };
  jumpLinks.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); scrollTo(a.dataset.section as SectionId); }));
  let currentSection: SectionId | null = null;

  const pointer = new THREE.Vector2(), eased = new THREE.Vector2();
  addEventListener('pointermove', (e) => pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1));

  const clock = new THREE.Timer();
  const perf = { cpu: 0, frames: 0, renderer, dpr };
  // Adaptive resolution: drop the pixel ratio when frames run long, creep back up when there is headroom.
  let ema = 16, slow = 0, fast = 0;
  const govern = (dt: number) => {
    if (params.has('dpr')) return;
    ema += (dt * 1000 - ema) * 0.1;
    if (ema > 24) { fast = 0; if (++slow > 30 && dpr > 0.6) { dpr = Math.max(0.6, dpr - 0.1); slow = 0; apply(); } }
    else if (ema < 12.5) { slow = 0; if (++fast > 240 && dpr < dprCap) { dpr = Math.min(dprCap, dpr + 0.05); fast = 0; apply(); } }
    else { slow = 0; fast = 0; }
  };
  const apply = () => { renderer.setPixelRatio(dpr); renderer.setSize(innerWidth, innerHeight); perf.dpr = dpr; };
  (window as any).__perf = perf;
  (window as any).__scene = scene;
  const timed = (name: string, fn: () => void) => {
    const a = performance.now(); fn(); const d = performance.now() - a;
    if (d > 40) {
      const detail = Object.entries(stages).filter(([, v]) => v > 5).map(([k, v]) => `${k}=${Math.round(v)}`).join(' ');
      console.warn('[slow]', name, Math.round(d), 'ms at p=', journey.p.toFixed(3), detail);
    }
    for (const k in stages) stages[k] = 0;
  };
  renderer.setAnimationLoop(() => {
    clock.update();
    const t = reducedMotion ? 0 : clock.getElapsed();
    const dt = Math.min(clock.getDelta(), 0.05);
    govern(dt);
    eased.lerp(pointer, 0.05);
    const p = journey.p;
    timed('content', () => content.update(p, t, dt)); // carriers first so the blimp's displacement is current
    poseAt(p, pos, look);
    content.followOffset(p, off);
    pos.add(off); look.add(off);
    camera.position.set(pos.x + eased.x * 1.2, pos.y + Math.sin(t * 0.6) * 0.1 - eased.y * 0.5, pos.z); // small bob: the CSS3D slabs re-rasterize when their screen scale changes
    camera.lookAt(look);
    camera.rotation.z -= eased.x * 0.02;
    heroCopy.style.opacity = String(THREE.MathUtils.clamp(1 - (p - 0.05) * 25, 0, 1));
    heroCopy.style.pointerEvents = p > 0.09 ? 'none' : 'auto';
    heroCopy.style.transform = `translate(${(-eased.x * 14).toFixed(1)}px, ${(-eased.y * 8 + Math.sin(t * 0.6) * 3).toFixed(1)}px) scale(var(--hero-scale))`;
    if (water) water.visible = p < 0.14 || p > 0.86; // bay vista and the pier; hidden in between (reflector cost)
    const sec = sectionAt(p);
    if (sec !== currentSection) {
      currentSection = sec;
      navLinks.forEach((a) => a.toggleAttribute('aria-current', a.dataset.section === sec));
    }
    // Each subsystem's update is timed; anything over 40 ms is reported (`[slow]`) so hitches can be attributed.
    timed('traffic', () => traffic.update(dt, t, camera.position));
    timed('ads', () => ads.update(t));
    timed('life', () => { for (const l of life) l.update(dt, camera); });
    timed('districts', () => districts.update(t, p));
    timed('lights', () => lightPool.update([...districts.activeLights(), ...content.activeLights()], camera.position));
    timed('particles', () => { for (const s of particles) s.update(p, dt); });
    timed('interact', () => interact.update(dt, p));
    timed('audio', () => audio.update(p));
    const t0 = performance.now();
    timed('render', () => pipeline.render());
    timed('css3d', () => cssRenderer.render(scene, camera));
    if (firstFrame) {
      firstFrame = false; boot.done();
      if (params.has('prof')) {
        const vis = (o: THREE.Object3D) => { for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return false; return true; };
        const now: string[] = []; scene.traverse((o: any) => { if (o.isLight && vis(o)) now.push(o.type + '#' + o.id); });
        console.info('[night] frame lights', now.length, now.join(' '));
        console.info('[night] frame contextNode', (renderer as any).contextNode?.id, (renderer as any).contextNode?.version);
      }
    }
    perf.cpu += performance.now() - t0;
    perf.frames++;
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    heroScale();
    renderer.setPixelRatio(dpr);
    renderer.setSize(innerWidth, innerHeight);
    cssRenderer.setSize(innerWidth, innerHeight);
  });

  document.documentElement.classList.add('is-3d');
  return { tier, isWebGPU, towers: kit?.count ?? 0, screens: kit?.screens ?? 0, cars: traffic.count, ads: ads.count, sections: SECTIONS.length };
}

export { neonText };

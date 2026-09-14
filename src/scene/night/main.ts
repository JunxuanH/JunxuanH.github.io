import * as THREE from 'three/webgpu';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { createContent } from './content';
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
  const isWebGPU = (renderer.backend as any).isWebGPUBackend === true;
  // Default to medium on WebGPU: same look as high minus grain/CA/sharpen at roughly half the frame cost.
  const tier: Tier = (params.get('q') as Tier) || (isWebGPU ? 'med' : 'low');
  document.documentElement.dataset.tier = tier;
  document.documentElement.dataset.backend = isWebGPU ? 'webgpu' : 'webgl2';
  renderer.setPixelRatio(Math.min(devicePixelRatio, tier === 'low' ? 1.0 : 1.25));
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
  const ground = await loadGroundTextures();
  scene.add(createStreets(ground));
  createBackdrop().then((m) => scene.add(m)).catch((e) => console.warn('[night] backdrop', e));

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
    loadGlbTowers([
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
    ]).then((g) => scene.add(g));
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
      const names = ['netrunner', 'corpo', 'vendor', 'punk', 'sec-bot', 'chef', 'geisha-bot', 'idol', 'ronin', 'schoolgirl-hacker', 'mech-pilot', 'cat-courier', 'oni-bouncer', 'maid-bot'] as const;
      const rigs = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadCharacter(n)]))) as Record<(typeof names)[number], Awaited<ReturnType<typeof loadCharacter>>>;
      const kenney = await Promise.all(['character-male-a', 'character-female-b', 'character-male-c'].map((f) => loadKenney(f)));
      for (const d of DISTRICT_CROWDS) {
        const near = createCrowd({ path: d.path, assets: d.assets.map((n) => rigs[n]), count: d.count[tier], seed: 7 });
        const far = createCrowd({ path: d.path, assets: kenney, count: d.count[tier], height: 1.6, seed: 11, cullDistance: 140 });
        scene.add(near.group, far.group);
        life.push(near, far);
      }
      const robots = createRobots({ asset: rigs['sec-bot'], patrols: PATROLS, height: 2.1, searchlight: tier !== 'low' });
      scene.add(robots.group);
      life.push(robots);
      const drones = await createDrones({ lanes: DRONE_LANES, tier });
      scene.add(drones.group);
      life.push(drones);
    } catch (e) { console.warn('[night] life failed', e); }
  }

  // ---------- ambient sound
  const audio = createAudio();
  bindAudioToggle(audio, document.querySelector('.audio-toggle'));

  // ---------- résumé content: slabs on their carriers (kiosk, bus stop, LED wall, blimp, hologram, stall, departures board)
  const content = await createContent({
    scene, narrow, tier, tex: { facade: facadeTex, storefronts: storefrontTex, ground }, people: !params.has('nopeople'),
    onFlap: () => audio.clack(6, 0.07),
  });
  for (const [x, y, z, c, i, d] of content.lights) lamp(x, y, z, c, i, d);
  createProps({ tier, extra: [...districts.props, ...content.props] }).then((p) => { scene.add(p.group); console.info('[night] props', p.count); });

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
  const heroCopy = document.getElementById('hero-copy')!;
  heroCopy.style.width = '720px';
  const heroObj = new CSS3DObject(heroCopy);
  heroObj.scale.setScalar(4.6 / 720);
  heroObj.position.set(narrow ? 0 : -5.2, narrow ? -4.2 : -3.0, -14);
  camera.add(heroObj);

  // ---------- post
  const pipeline = createPost(renderer, scene, camera, tier);

  // ---------- journey
  const journey = { p: Number(params.get('p')) || 0 };
  ScrollTrigger.create({
    trigger: '.journey', start: 'top top', end: 'bottom bottom', scrub: 0.8,
    onUpdate: (st) => { if (!params.has('p')) journey.p = st.progress; },
  });
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[data-section]')];
  const journeyEl = document.querySelector<HTMLElement>('.journey')!;
  const scrollTo = (id: SectionId) => {
    const y = journeyEl.offsetTop + sectionStart(id) * (journeyEl.offsetHeight - innerHeight) + 2;
    if (reducedMotion) window.scrollTo(0, y);
    else gsap.to(window, { scrollTo: y, duration: 1.4, ease: 'power2.inOut' });
  };
  navLinks.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); scrollTo(a.dataset.section as SectionId); }));
  let currentSection: SectionId | null = null;

  const pointer = new THREE.Vector2(), eased = new THREE.Vector2();
  addEventListener('pointermove', (e) => pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1));

  const clock = new THREE.Timer();
  const pos = new THREE.Vector3(), look = new THREE.Vector3(), off = new THREE.Vector3();
  const perf = { cpu: 0, frames: 0, renderer };
  (window as any).__perf = perf;
  renderer.setAnimationLoop(() => {
    clock.update();
    const t = reducedMotion ? 0 : clock.getElapsed();
    const dt = Math.min(clock.getDelta(), 0.05);
    eased.lerp(pointer, 0.05);
    const p = journey.p;
    content.update(p, t, dt); // carriers first so the blimp's displacement is current
    poseAt(p, pos, look);
    content.followOffset(p, off);
    pos.add(off); look.add(off);
    camera.position.set(pos.x + eased.x * 1.2, pos.y + Math.sin(t * 0.6) * 0.3 - eased.y * 0.5, pos.z);
    camera.lookAt(look);
    camera.rotation.z -= eased.x * 0.02;
    heroCopy.style.opacity = String(THREE.MathUtils.clamp(1 - (p - 0.05) * 25, 0, 1));
    heroCopy.style.pointerEvents = p > 0.09 ? 'none' : 'auto';
    if (water) water.visible = p < 0.14 || p > 0.86; // bay vista and the pier; hidden in between (reflector cost)
    const sec = sectionAt(p);
    if (sec !== currentSection) {
      currentSection = sec;
      navLinks.forEach((a) => a.toggleAttribute('aria-current', a.dataset.section === sec));
    }
    traffic.update(dt, t);
    ads.update(t);
    for (const l of life) l.update(dt, camera);
    districts.update(t, p);
    for (const s of particles) s.update(p, dt);
    interact.update(dt, p);
    audio.update(p);
    const t0 = performance.now();
    pipeline.render();
    cssRenderer.render(scene, camera);
    perf.cpu += performance.now() - t0;
    perf.frames++;
  });
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    cssRenderer.setSize(innerWidth, innerHeight);
  });

  document.documentElement.classList.add('is-3d');
  return { tier, isWebGPU, towers: kit?.count ?? 0, screens: kit?.screens ?? 0, cars: traffic.count, ads: ads.count, sections: SECTIONS.length };
}

export { neonText };

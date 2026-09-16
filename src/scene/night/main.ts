import * as THREE from 'three/webgpu';
import { createContent } from './content';
import { boot } from './boot';
import { landing } from './landing';
import { dedupeMaterials } from './districts/shared';
import { createLightPool } from './lights';

import { PAL, params, reducedMotion, setReducedMotion, loader, type Tier } from './palette';
import { createSky, createHaze } from './sky';
import { createPost } from './post';
import { createBackdrop } from './backdrop';
import { createLandingFlyby } from './landing-flyby';
import { createStreets, loadGroundTextures, loadWallSets, AVENUE_HALF, SIDEWALK, CROSS_Z, CROSS_HALF, QUAY_Z, CURB_H } from './streets';
import { createEnvironment } from './env';
import { createParticles, type ParticleSpec } from './particles';
import { createKitbash, loadGlbTowers } from './towers';
import { clearStreetFootprint, clearDistrictFootprint } from './building-layout';
import { createProps } from './props';
import { loadCharacter, createCrowd, instantiate } from './characters';
import { MARKET_STALLS } from './market-layout';
import { createShops } from './shops';
import { createRobots } from './robots';
import { createDrones } from './drones';
import { DISTRICT_CROWDS, PATROLS, DRONE_LANES } from './paths';
import { createWater, createBridge, createBillboard, createQuay } from './bay';
import { createKeyedSigns, neonText, signRegistryGroup } from './signs';
import { createAudio, bindAudioToggle } from './audio';
import { createInteract } from './interact';
import { createAds } from './ads';
import { DOWNTOWN_ADS } from './downtown-layout';
import { OFFICE_RESIDENTS } from './downtown-layout';
import { DOWNTOWN_LOBBIES, DOWNTOWN_CENTER_X } from './building-layout';
import { createCrossingSignals } from './crossing-signals';
import { createTraffic } from './traffic';
import { createRain } from './rain';
import { createDistricts } from './districts';
import { ANCHORS, ESTABLISH, poseAt, rig, SECTIONS, type SectionId } from './journey';
import { createNav, SPAWN } from './nav';
import { createPlayer } from './player';
import { createInput } from './input';
import { createHud } from './hud';
import { createInteractables } from './interactables';
import { createDialogue, walkerTargets, carrierTarget, type Target } from './dialogue';
import { buildAreas, buildWorldArea, sectionAt as walkSectionAt, type Obstacle, type WalkSection } from './walkable';
import { THEMES } from './theme';
import type { PropPlacement } from './props';

let tiltAnswer: Promise<boolean> | null = null;
/** Phones feed device tilt into the parallax (not under reduced motion, not with `?nogyro`). */
const tiltWanted = () => typeof window !== 'undefined' && matchMedia('(pointer: coarse)').matches && !reducedMotion && !params.has('nogyro') && 'DeviceOrientationEvent' in window;
/**
 * Ask for device-tilt access. iOS only prompts from a completed tap (click / touchend): call it synchronously inside one —
 * the landing gate's Enter does, before `start()`, so the system dialog never covers the launch. Resolves true when
 * tilt may be used (granted, or no permission API), false when refused or not wanted. The answer is kept; a refusal
 * WebKit makes without prompting (not a gesture it accepts) is forgotten so the next tap asks again.
 */
export function askTilt(): Promise<boolean> {
  if (!tiltWanted()) return Promise.resolve(false);
  const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
  if (typeof DOE.requestPermission !== 'function') return Promise.resolve(true);
  if (tiltAnswer) return tiltAnswer;
  let req: Promise<string>;
  try { req = DOE.requestPermission(); } catch { return Promise.resolve(false); }
  const answer: Promise<boolean> = req.then((s) => s === 'granted', () => { if (tiltAnswer === answer) tiltAnswer = null; return false; });
  tiltAnswer = answer;
  return answer;
}

/**
 * Neon Harbor. Bay vista hero → the nav pans the camera along the rail to a district, where the visitor takes
 * over the protagonist (the `ronin-player` rig, `soldier` if it fails to load) on foot (nav.ts / player.ts) and docks on the résumé carriers. No scrolling.
 * All lights are emissive; bloom is the light source. `?q=high|med|low`, `?p=0.4` (start the ride at that progress),
 * `?nobloom ?noca ?nosharp ?norain ?novideo ?kenney ?nokit ?noglb ?nowater ?debug`.
 */
export async function start(root: HTMLElement) {
  // Reproducible, UI-free establishing stills (journey.ts ESTABLISH).
  // This is a public render mode, not an automation hook into private scene state.
  const capture = params.get('capture') as SectionId | null;
  if (capture && Object.hasOwn(ESTABLISH, capture)) {
    params.set('p', String(ESTABLISH[capture]));
    setReducedMotion(true);
    document.documentElement.classList.add('capture-frame');
  }
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
  // ACES crushes saturated neon toward white; AgX holds the hue as it clips, which matters in a
  // scene whose only light sources are coloured signs. `?tm=aces|agx|neutral` to compare.
  const TONE = { aces: THREE.ACESFilmicToneMapping, agx: THREE.AgXToneMapping, neutral: THREE.NeutralToneMapping } as const;
  renderer.toneMapping = TONE[(params.get('tm') as keyof typeof TONE) ?? 'aces'] ?? THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = Number(params.get('exp')) || 1.0;
  root.appendChild(renderer.domElement);
  if (params.has('debug')) {
    const { Inspector } = await import('three/addons/inspector/Inspector.js');
    (renderer as any).inspector = new Inspector();
  }

  const scene = new THREE.Scene();
  const landingFlyby = landing.enabled ? createLandingFlyby(scene) : null;
  // The night gradient sky + the aerial skyline plate (Ivan preferred it over the 360° panorama).
  scene.fogNode = createHaze(Number(params.get('haze')) || 0.0032);
  const camera = new THREE.PerspectiveCamera(narrow ? 62 : 50, innerWidth / innerHeight, 0.5, 2600);
  scene.add(camera);

  // Ambient is what makes the façades read as surfaces instead of black outlines.
  scene.add(new THREE.HemisphereLight(0x626773, 0x302a30, Number(params.get('amb')) || 2.0));
  const moon = new THREE.DirectionalLight(0xeee8df, Number(params.get('moon')) || 1.2);
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
  scene.add(createSky(tier));
  // Start the rig downloads now so they overlap the skyline build instead of gating 'waking the residents'.
  const PROTAGONIST = 'ronin-player'; // chosen anime Ronin; separate from the existing ronin NPC
  const RIGS_ALL = [PROTAGONIST, 'netrunner', 'corpo', 'vendor', 'punk', 'sec-bot', 'chef', 'geisha-bot', 'idol', 'ronin', 'schoolgirl-hacker', 'mech-pilot', 'cat-courier', 'oni-bouncer', 'maid-bot', 'medic', 'skater', 'salaryman', 'dj', 'nomad', 'noodle-cook', 'patrol-bot',
    'delivery-rider', 'tech-shaman', 'tagger', 'dock-worker', 'bouncer-android', 'yakuza-boss', 'nurse', 'exo-courier'] as const; // 'tourist' dropped (rigs.ts note)
  // Phones: 11 varied crowd rigs (the smallest downloads, ≈ 4.5 MB) + the player + the patrol robot (≈ 5.6 MB in all), plus the
  // kiosk / bus-stop NPC rigs the carriers load anyway. Every district roster in paths.ts keeps ≥ 4 of these.
  const RIGS_LITE = [PROTAGONIST, 'sec-bot', 'schoolgirl-hacker', 'oni-bouncer', 'corpo', 'bouncer-android', 'nurse', 'dj', 'ronin', 'yakuza-boss', 'cat-courier', 'medic', 'exo-courier', 'delivery-rider', 'dock-worker'] as const;
  if (!params.has('nopeople')) for (const n of (lite ? RIGS_LITE : RIGS_ALL)) loadCharacter(n).catch(() => {});
  boot.phase('paving the streets', 0.1);
  const ground = await loadGroundTextures();
  const walls = await loadWallSets(['wall-concrete', 'wall-metal', 'glass-grime']);
  scene.add(createStreets(ground, walls));
  const pending: Promise<unknown>[] = []; // async builds to finish before the shader pre-warm
  // Keep the painted skyline on the far north boundary, visible down the city streets.
  // No east/west panels: those read as nearby wallpaper when looking sideways across the map.
  pending.push(createBackdrop().then((m) => { scene.add(m); }).catch((e) => console.warn('[night] backdrop', e)));

  const keepOut: [number, number, number][] = [
    [ANCHORS.towerA.x, ANCHORS.towerA.z, 20], [-33, -95, 18], [30, -95, 18], [-22, -190, 18],
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
    clear: (x,z,hw,hd) => clearStreetFootprint(x,z,hw,hd) && clearDistrictFootprint(x,z,hw,hd),
    streetSide: (x, z, hw, hd) => {
      if (Math.abs(x) - hw < AVENUE_HALF + margin + 8) return x > 0 ? 'nx' : 'px';
      const cz = CROSS_Z.find((c) => Math.abs(z - c) - hd < CROSS_HALF + margin + 8);
      return cz === undefined ? null : z > cz ? 'nz' : 'pz';
    },
  });
  if (kit) scene.add(kit.group);

  // Signature (fal) towers first, playweave set as mid-ground fill.
  const buildingObstacles: Obstacle[] = [...(kit?.obstacles ?? [])];
  if (!params.has('noglb')) {
    pending.push(loadGlbTowers([
      { file: 'tower-a', x: ANCHORS.towerA.x, z: ANCHORS.towerA.z, height: 84, tint: PAL.cyan },
      { file: 'tower-b', x: -33, z: -95, height: 70, yaw: 0.2, tint: PAL.magenta }, // 3 u back from the sidewalk: its ground floor used to swallow the bus shelter's panel
      { file: 'tower-c', x: 30, z: -95, height: 64, yaw: -0.3, tint: PAL.cyan },
      { file: 'tower-d', x: -22, z: -190, height: 78, yaw: 0.1, tint: PAL.yellow },
      { file: 'tower-01', x: -62, z: -130, height: 58, yaw: 0.2, tint: PAL.cyan },
      { file: 'tower-02', x: 66, z: -150, height: 62, yaw: -0.4, tint: PAL.magenta },
      { file: 'tower-03', x: -48, z: -240, height: 66, yaw: 0.8, tint: PAL.cyan },
      { file: 'tower-04', x: 90, z: -120, height: 54, yaw: 0.3, tint: PAL.magenta },
      { file: 'tower-05', x: -96, z: -180, height: 60, yaw: -0.2, tint: PAL.cyan },
      { file: 'tower-06', x: 40, z: -260, height: 70, yaw: 0.5, tint: PAL.yellow },
    ], (_t, obj) => {
      const b = new THREE.Box3().setFromObject(obj);
      buildingObstacles.push({ kind: 'box', x0: b.min.x, x1: b.max.x, z0: b.min.z, z1: b.max.z, h: b.max.y });
    }).then((g) => scene.add(g)));
  }

  // ---------- bay
  const water = params.has('nowater') ? null : createWater({ high: 0.5, med: 0.4, low: 0.3 }[tier]);
  if (water) scene.add(water);
  scene.add(createBridge(walls));
  scene.add(createQuay(QUAY_Z, ground, walls));
  const billboard = createBillboard({ image: '/night/ads/billboard-shellworks.webp', video: lite || reducedMotion ? undefined : '/night/ads/billboard-shellworks-loop.mp4' }); // the tower's ad (design/night/prompts/ad-shellworks.txt, billboard-loop.txt); phones keep the still + shader motion
  billboard.position.set(ANCHORS.towerA.x, 53, ANCHORS.towerA.z + 14.5);
  scene.add(billboard);

  // ---------- life
  const signs = await createKeyedSigns([
    ...DOWNTOWN_ADS.map(s=>({x:s.x,y:s.y+10,z:s.z,yaw:s.yaw,w:4})),
    { x: -60, y: 12, z: -60, yaw: 0.9, w: 6 }, { x: 30, y: 7, z: -238, yaw: 0.2, w: 4 }, { x: 58, y: 7.5, z: -218, yaw: Math.PI, w: 4 },
    { x: 72, y: 6.5, z: -238, yaw: 0.3, w: 3.5 }, { x: -20, y: 8, z: -70, yaw: Math.PI / 2, w: 4 }, { x: 20, y: 9, z: -140, yaw: -Math.PI / 2, w: 4 },
  ], [1,2,3,4,7,8,9,10,11,12]);
  scene.add(signs);
  if (lite || reducedMotion) params.set('novideo', '1'); // phones and reduced motion: still ads
  const ads = await createAds(DOWNTOWN_ADS);
  scene.add(ads.group);
  const traffic = await createTraffic([
    // Street level: avenue and the parallel Downtown cross street; Market is pedestrian-only.
    { pts: [[-5, 0.1, -24], [-5, 0.1, -200], [-5, 0.1, -640]], speed: 0.02, ground: true },
    { pts: [[5, 0.1, -640], [5, 0.1, -200], [5, 0.1, -24]], speed: 0.018, ground: true },
    { pts: [[-300, 0.1, -148], [0, 0.1, -148], [300, 0.1, -148]], speed: 0.02, ground: true },
    { pts: [[300, 0.1, -140], [0, 0.1, -140], [-300, 0.1, -140]], speed: 0.02, ground: true },
    // Aloft: hover lanes and the bridge deck.
    { pts: [[-40, 22, 300], [-12, 24, 120], [-8, 26, -40], [-6, 28, -200], [10, 30, -420]], speed: 0.05 },
    { pts: [[12, 30, -420], [8, 33, -200], [10, 34, -60], [20, 32, 100], [60, 30, 300]], speed: 0.045 },
    { pts: [[-120, 40, -60], [-60, 41, -90], [0, 42, -110], [40, 43, -130], [120, 44, -170]], speed: 0.04 },
    { pts: [[-300, 13.5, 70], [300, 13.5, 70]], speed: 0.03, ground: true },
  ], tier);
  scene.add(traffic.group);
  const crossingSignals=createCrossingSignals();scene.add(crossingSignals.group);
  const rainCount = params.has('norain') || reducedMotion ? 0 : { high: 5000, med: 2500, low: 0 }[tier];
  if (rainCount) scene.add(createRain(rainCount));

  boot.phase('wiring the districts', 0.45);
  const districts = await createDistricts({
    content: {
      // The job slabs live on their own carriers (content.ts); the flame signs stay as short neon labels.
      jobs: [...document.querySelectorAll<HTMLElement>('.slab.job')].slice(0, 4).map((el) => ({ label: el.querySelector('.kicker')?.textContent?.trim() ?? '', rows: 0 })),
      projects: [...document.querySelectorAll<HTMLElement>('.stack .card h3')].map((el) => ({ name: el.firstChild?.textContent?.trim() || '' })),
    },
    tex: { facade: facadeTex, storefronts: storefrontTex, ground, walls },
    tier,
  });

  // ---------- particles & weather (petals, koi, steam, sparks, spray), gated by section
  const specs: ParticleSpec[] = [
    { kind: 'sakura', section: 'education', box: { center: [-80, 10, -102], size: [90, 20, 60] } },
    { kind: 'koi', section: 'education', loops: [[[-96, 0.3, -90], [-90, 0.3, -86], [-86, 0.3, -92], [-90, 0.3, -98], [-96, 0.3, -96]]] },
    { kind: 'steam', section: 'projects', points: [[34, 1.5, -238]] },
    { kind: 'spray', section: 'contact', points: [[134.8, -0.2, -10], [145.2, -0.2, 2], [134.8, -0.2, 14], [145.2, -0.2, 26]] },
  ];
  const particles = params.has('noparticles') ? [] : specs.map((s) => createParticles(s, tier, { motion: !reducedMotion }));
  for (const s of particles) { scene.add(s.mesh); s.setWind(0.6); }
  scene.add(districts.group);
  for (const [x, y, z, c, i, d] of districts.lights) lamp(x, y, z, c, i, d);

  // ---------- people, robots, drones (rigged fal characters; walkers stay visible out to 140 u)
  const life: { group?: THREE.Group; update(dt: number, cam: THREE.Camera): void }[] = [];
  const crowds: { id: string; walkers: ReturnType<typeof createCrowd>['walkers'] }[] = []; // the walkers, for the dialogue
  const shopOwners = new Map<number, ReturnType<typeof instantiate>>();
  let shopPropsRequested=false;
  if (!params.has('nopeople')) {
    try {
      boot.phase('waking the residents', 0.62);
      const all = RIGS_ALL;
      const names = lite ? RIGS_LITE : all;
      const rigs = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadCharacter(n)]))) as Partial<Record<(typeof all)[number], Awaited<ReturnType<typeof loadCharacter>>>>;
      // Ambient office staff reuse loaded rigs, never join street paths or dialogue queues.
      const officeGroup=new THREE.Group();officeGroup.name='Downtown office residents';scene.add(officeGroup);
      const officeResidents=OFFICE_RESIDENTS.flatMap((s,i)=>{
        const asset=rigs[s.rig] ?? rigs.corpo ?? rigs['yakuza-boss'];
        if(!asset) return [];
        const inst=instantiate(asset);
        const [side,z]=DOWNTOWN_LOBBIES[s.lobby];
        const yaw=side<0?Math.PI/2:-Math.PI/2;
        inst.root.name=s.role;
        inst.root.position.set(s.x,CURB_H+.2,s.z).applyAxisAngle(new THREE.Vector3(0,1,0),yaw);
        inst.root.position.x+=side*DOWNTOWN_CENTER_X;inst.root.position.z+=z;
        inst.root.rotation.y=yaw+s.yaw;
        const action=inst.play('idle',0);
        if(action) action.time=i*.7;
        inst.mixer.update(0);
        officeGroup.add(inst.root);return [inst];
      });
      const officeFrustum=new THREE.Frustum(),officeMatrix=new THREE.Matrix4();
      const officeBounds=new THREE.Sphere(new THREE.Vector3(),1.5);
      life.push({group:officeGroup,update(dt,cam) {
        officeMatrix.multiplyMatrices(cam.projectionMatrix,cam.matrixWorldInverse);officeFrustum.setFromProjectionMatrix(officeMatrix);
        for(const inst of officeResidents) {
          officeBounds.center.copy(inst.root.position);officeBounds.center.y+=1;
          inst.root.visible=cam.position.distanceToSquared(inst.root.position)<10000 && officeFrustum.intersectsSphere(officeBounds);
          if(inst.root.visible && !reducedMotion) inst.mixer.update(Math.min(dt,.1));
        }
      }});
      // Shopkeepers stay behind their counters. Reuse already-loaded rigs on phones.
      const vendorGroup = new THREE.Group();
      vendorGroup.name = 'Market shopkeepers';
      scene.add(vendorGroup);
      const vendors = MARKET_STALLS.map((s,i) => {
        const asset = rigs[s.rig] ?? rigs[['dj','medic','cat-courier'][i%3] as keyof typeof rigs];
        if (!asset) return null;
        const inst = instantiate(asset);
        inst.root.position.set(s.x, .22, s.z-.45*Math.cos(s.yaw));
        inst.root.rotation.y=s.yaw;
        const action=inst.play(inst.actions.has('talk')?'talk':'idle',0);
        if(action) action.time=i*.43;
        vendorGroup.add(inst.root);
        shopOwners.set(i,inst);
        return inst;
      }).filter((v): v is NonNullable<typeof v> => !!v);
      life.push({group:vendorGroup,update(dt,cam) {
        for(const v of vendors) {
          v.root.visible = v.root.position.distanceToSquared(cam.position)<100*100 && districts.group.children[2].visible;
          if(v.root.visible && !reducedMotion) v.mixer.update(dt);
        }
      }});
      for (const d of DISTRICT_CROWDS) {
        const assets = d.assets.map((n) => rigs[n]).filter((a): a is NonNullable<typeof a> => !!a);
        if (!assets.length) continue;
        const near = createCrowd({ path: d.path, assets, count: d.count[tier], seed: 7, cullDistance: 140 });
        scene.add(near.group);
        life.push(near);
        crowds.push({ id: d.path.id, walkers: near.walkers });
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
    scene, narrow, tier, tex: { facade: facadeTex, storefronts: storefrontTex, ground, walls }, people: !params.has('nopeople'), // both resident rigs are already cached in the phone roster
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

  // ---------- walk mode: nav state machine, the protagonist, the HUD and what can be used on foot
  const journey = { p: Number(params.get('p')) || 0 };
  const hud = createHud();
  // Street furniture becomes obstacles when props.ts exports its placements; otherwise walkable.ts replicates the rules.
  const propsBuilt = await propsReady.catch(() => null);
  const placements = (propsBuilt as unknown as { placements?: PropPlacement[] } | null)?.placements ?? null;
  const areas = buildAreas(placements);
  const worldArea = buildWorldArea(areas, buildingObstacles, placements ?? []);
  const protagonist = params.has('nopeople') ? null : await loadCharacter(PROTAGONIST).then((asset) => {
    if (!['idle', 'walk', 'run'].every((name) => asset.clips.has(name))) throw new Error('Ronin locomotion clips missing');
    return asset;
  }).catch((e) => {
    console.warn('[night] Ronin unavailable; using the previous protagonist', e);
    return loadCharacter('soldier').catch(() => null);
  });
  const player = protagonist ? createPlayer({ asset: protagonist, onStep: () => audio.step(), onBump: () => audio.bump() }) : null;
  if (player) {
    scene.add(player.root);
    player.setArea(worldArea);
    player.teleport(...SPAWN.education.pos, SPAWN.education.yaw); // in view of the pre-warm poses so its skin compiles now
  }
  const playerPos = new THREE.Vector3(); // player feet, or the spawn when there is no character (`?nopeople`)
  const dockTarget = new THREE.Vector3(), dockNormal = new THREE.Vector3();
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[data-section]')];
  const nav = createNav({
    journey,
    onMode: (m) => { hud.setMode(m); if (player) player.root.visible = m !== 'ride'; },
    onSection: (id) => {
      navLinks.forEach((a) => {
        if (a.dataset.section === id) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      });
      if (id !== 'city') document.documentElement.classList.add('has-entered'); // the nav appears once the visitor enters
    },
    onEnterWalk: (id) => {
      const s = SPAWN[id];
      playerPos.fromArray(s.pos);
      if (player) { player.setArea(worldArea); player.teleport(...s.pos, s.yaw); }
      hud.showHintOnce();
    },
    // The jump happened behind the black (the reveal starts): the title card.
    onArrive: (id) => { if (id !== 'city') { const th = THEMES[id]; hud.toast(th.name.toUpperCase(), th.subtitle.toUpperCase()); } },
    onBeat: (s) => hud.cutscene(s), // the fade through black
    onDock: (id) => {
      content.dock(id);
      // The character turns to the carrier: the follow camera (and the phone dock framing) look at it too.
      const c = content.carriers[id];
      if (player && c && id !== 'amd-dc') { c.mount.getWorldPosition(dockTarget); player.face(dockTarget.x, dockTarget.z); }
    },
    onUndock: () => content.undock(),
    dockOffset: (id, out) => (id === 'amd-dc' ? content.carrierDisplacement(id, out) : out.set(0, 0, 0)),
    dockPoseOf: (id, pos, look) => {
      const c = content.carriers[id];
      // Phones have no CSS3D slab to frame: the dwell poses would stare at an empty panel. The camera stays over the
      // character's shoulder, looking at the carrier (the blimp's formation flight is the view on every device).
      if (player && c?.terminal) { c.mount.getWorldPosition(dockTarget); c.mount.getWorldDirection(dockNormal); player.frame(dockTarget, dockNormal, c.width, pos, look); return true; }
      if (!c?.dockPose) return false;
      c.dockPose(pos, look);
      if (narrow) {
        // Portrait: the formation slot sits a little further out (the avenue's towers are close on the port side, so not
        // much further) and the look point drops so the banner's middle band shows above the bottom sheet.
        pos.sub(look).multiplyScalar(1.35).add(look);
        const dx = look.x - pos.x, dz = look.z - pos.z, h = Math.hypot(dx, dz) || 1, a = Math.atan2(look.y - pos.y, h) - 0.2;
        look.y = pos.y + Math.tan(a) * h;
      }
      return true;
    },
  });
  hud.onBack(() => nav.undock());
  content.session.el?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); nav.undock(); }
  });
  const input = createInput({
    stage: root, touch: hud.touch,
    enabled: () => nav.mode === 'walk' && !document.documentElement.classList.contains('shop-open'),
    onKey: (e) => {
      if (nav.mode !== 'dock') return false;
      if (content.onKey(e)) return true; // the docked carrier first (Esc may collapse a menu row before it leaves)
      if (e.key === 'Escape') { nav.undock(); return true; }
      return false;
    },
  });
  // One HUD prompt slot, two writers: the residents' "Talk to …" (dialogue.ts) wins over the carriers' prompt.
  const prompts: { shop: string | null; talk: string | null; use: string | null } = { shop: null, talk: null, use: null };
  const publishPrompt = () => hud.prompt(prompts.shop ?? prompts.talk ?? prompts.use);
  const shops = createShops({
    prompt: l => { prompts.shop=l; publishPrompt(); },
    available: i => shopOwners.get(i)?.root.visible ?? false,
    owner: (i,active) => {
      const owner=shopOwners.get(i); if(!owner)return;
      owner.play(active && owner.actions.has('talk')?'talk':'idle',.2);
      if(active) {
        const s=MARKET_STALLS[i];
        const target=Math.atan2(playerPos.x-s.x,playerPos.z-s.z);
        const delta=Math.atan2(Math.sin(target-s.yaw),Math.cos(target-s.yaw));
        owner.root.rotation.y=s.yaw+THREE.MathUtils.clamp(delta,-.5,.5);
      } else owner.root.rotation.y=MARKET_STALLS[i].yaw;
    },
  });
  const interactables = createInteractables({ scene, carriers: content.carriers, nav, prompt: (l) => { prompts.use = l; publishPrompt(); }, landingCar });
  document.querySelector('.hud-prompt')?.addEventListener('click', () => {
    if (nav.mode === 'walk' && !nav.cutscene) input.press('interact');
  });
  // ---------- talking to the residents (dialogue.ts): every crowd walker, plus the two carrier NPCs matched by where they stand
  const NPC_RIGS: [x: number, z: number, rig: string, section: WalkSection][] = [[-81.6, -97.4, 'schoolgirl-hacker', 'education'], [-16.4, -100.3, 'oni-bouncer', 'work']];
  const npcAt = new THREE.Vector3();
  const dialogueTargets: Target[] = crowds.flatMap((c) => walkerTargets(c.walkers, null, c.id));
  for (const npc of content.npcs) {
    npc.root.getWorldPosition(npcAt);
    const row = NPC_RIGS.find(([x, z]) => Math.hypot(npcAt.x - x, npcAt.z - z) < 3);
    if (row) dialogueTargets.push(carrierTarget(npc, row[2], row[3]));
  }
  const dialogue = createDialogue({ hud, prompt: (l) => { prompts.talk = l; publishPrompt(); }, getTargets: () => dialogueTargets, playerYaw: () => player?.yaw ?? null,
    onOpen: (target) => { if (target) player?.focusResident(target.root.getWorldPosition(new THREE.Vector3())); },
    onClose: () => player?.focusResident(null),
  });
  const jumpLinks = [...document.querySelectorAll<HTMLAnchorElement>('a[data-section]')]; // nav + the hero's "Enter the city"
  jumpLinks.forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); a.blur(); nav.panTo(a.dataset.section as SectionId); }));
  (window as any).__player = player ? { position: player.position, teleport: player.teleport, get speed() { return player.speed; } } : null;
  (window as any).__content = content;

  // ---------- hero copy (anchored to the camera, lower-left)
  // The hero slab is camera-locked, so it is plain fixed DOM (2D parallax below):
  // Safari hit-tests 3D-transformed elements inside a perspective context a few pixels off their paint.
  const heroCopy = document.getElementById('hero-copy')!;
  document.body.appendChild(heroCopy);
  heroCopy.classList.add('is-fixed');
  const heroScale = () => { heroCopy.style.setProperty('--hero-scale', String(innerWidth <= 760 ? 1 : THREE.MathUtils.clamp(innerWidth / 1800, 0.55, 1))); };
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
  if (player) noReflect(player.root);
  if (propsBuilt) noReflect(propsBuilt.group);
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
  // Each step gates the scene exactly as the journey will at that point (districts.update / content.update),
  // so a step builds only its own district and the boot bar visibly advances nine times; a yield before every
  // step lets the label paint. Frustum culling is off so a district's whole
  // content is built, not just what the pose happens to frame.
  {
    const t0 = performance.now();
    const meshes: THREE.Object3D[] = [];
    scene.traverse((o: any) => { if (o.isMesh || o.isPoints || o.isLine || o.isSprite) meshes.push(o); });
    const culled = meshes.map((o) => o.frustumCulled);
    for (const o of meshes) o.frustumCulled = false;
    const poses = [0, 0.10, 0.19, 0.31, 0.42, 0.535, 0.66, 0.82, 0.94, 1.0]; // 0.10: campus appears while the water still reflects
    // Chunked so the landing car keeps moving: one render that compiled every new program of a pose held the main
    // thread (and on iPhones the GPU process) for seconds, freezing the overlay. Each pose now
    // reveals its not-yet-compiled materials a few at a time (everything else hidden, so a render compiles only that
    // chunk), yields until the loop has presented new frames, then renders the whole pose once for the combinations.
    // Visibility only toggles meshes; lights stay put, so program keys are unchanged.
    const CHUNK = narrow || tier === 'low' ? 1 : 4;
    const seen = new Set<string>();
    const keyOf = (o: any) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      return mats.map((m: any) => m?.uuid).join('+') + (o.isSkinnedMesh ? ':s' : o.isInstancedMesh ? ':i' : o.isPoints ? ':p' : o.isLine ? ':l' : o.isSprite ? ':sp' : '');
    };
    const visibleInScene = (o: THREE.Object3D) => { for (let a: THREE.Object3D | null = o; a; a = a.parent) if (!a.visible) return false; return true; };
    for (let i = 0; i < poses.length; i++) {
      boot.phase(`compiling shaders ${i + 1}/${poses.length}`, 0.86 + (0.1 * i) / poses.length);
      await landing.breathe(); // paint the label, let the landing car draw a frame
      const pp = poses[i];
      districts.update(0, pp);
      content.update(pp, 0, 0);
      if (water) water.visible = pp < 0.14 || pp > 0.86;
      poseAt(pp, pos, look); camera.position.copy(pos); camera.lookAt(look); camera.updateMatrixWorld(true);
      const tp = performance.now();
      // The pose's visible meshes whose material + kind is new.
      const fresh: THREE.Object3D[] = [];
      // The water stays on through the chunks: its reflector renders the scene a second time with its own programs, so a
      // chunk must compile for both passes (otherwise the pose's final render compiled every reflection program at once).
      const inWater = (o: THREE.Object3D) => { for (let a: THREE.Object3D | null = o; a; a = a.parent) if (a === water) return true; return false; };
      const shown = meshes.filter((o) => o.visible && visibleInScene(o) && !inWater(o));
      const pass = water?.visible ? '|w' : ''; // a program compiled without the reflector still needs its reflection-pass twin
      for (const o of shown) { const k = keyOf(o); if (!seen.has(k + pass)) { seen.add(k + pass); seen.add(k); fresh.push(o); } }
      if (fresh.length > CHUNK) {
        for (const o of shown) o.visible = false;
        for (let c = 0; c < fresh.length; c += CHUNK) {
          const batch = fresh.slice(c, c + CHUNK);
          for (const o of batch) o.visible = true;
          const tc = performance.now();
          // Warm the actual render passes in bounded batches. Do not await compileAsync:
          // mobile drivers can leave its pipeline promises pending, trapping boot indefinitely.
          // A timeout is not a safe fallback because compilation mutates shared renderer state.
          pipeline.render();
          if (params.has('prof') && performance.now() - tc > 150) console.info('[night] pre-warm chunk', Math.round(performance.now() - tc), 'ms', batch.map((o: any) => `${o.name || o.type}/${(Array.isArray(o.material) ? o.material[0] : o.material)?.type}`).join(', '));
          for (const o of batch) o.visible = false;
          boot.progress(.86 + .1 * (i + .9 * Math.min(1, (c + CHUNK) / fresh.length)) / poses.length);
          await landing.breathe();
        }
        for (const o of shown) o.visible = true;
      }
      await landing.breathe();
      pipeline.render();
      if (params.has('prof')) console.info('[night] pre-warm pose', pp, Math.round(performance.now() - tp), 'ms', fresh.length, 'new');
    }
    meshes.forEach((o, i) => { o.frustumCulled = culled[i]; });
    console.info('[night] pre-warm', Math.round(performance.now() - t0), 'ms', params.has('prof') ? Object.entries(stages).map(([k, v]) => `${k}=${Math.round(v)}`).join(' ') : '');
  }
  boot.phase('first light', 0.97);
  let firstFrame = true;
  let heroAlpha = 1;

  // ---------- journey: ride at p (the hero, or a `?p=` override) until the nav or the hero button pans somewhere
  if (player) player.root.visible = false;
  nav.start();
  const railPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

  const pointer = new THREE.Vector2(), eased = new THREE.Vector2(), ZERO2 = new THREE.Vector2();
  let tiltOn = false, tiltLook = 1; // a phone is feeding device tilt into `pointer`; tiltLook = walk-mode tilt gain
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); });
  // Phones: device tilt drives the same parallax as the mouse, a little stronger. iOS only grants motion access from a
  // user gesture, so the permission is requested on the first touch; Android delivers events directly. `?nogyro` opts out.
  if (tiltWanted()) {
    rig.parallaxScale = 3;
    let base: { x: number; y: number } | null = null;
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return;
      tiltOn = true;
      const angle = Number(screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0);
      let x = e.gamma, y = e.beta; // portrait: gamma = roll left/right, beta = pitch toward/away
      if (angle === 90) { x = e.beta; y = -e.gamma; } else if (angle === -90 || angle === 270) { x = -e.beta; y = e.gamma; }
      if (!base) base = { x, y };
      base.x += (x - base.x) * 0.004; base.y += (y - base.y) * 0.004; // slow re-centre: the neutral grip drifts with the hand
      pointer.set(THREE.MathUtils.clamp((x - base.x) / 16, -1, 1), THREE.MathUtils.clamp((y - base.y) / 16, -1, 1));
    };
    const listen = () => addEventListener('deviceorientation', onTilt);
    const DOE = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof DOE.requestPermission === 'function') {
      // iOS: the request only counts inside a completed tap (touchend / click; pointerdown and touchstart are refused
      // without a prompt). The landing's Enter-the-city tap asks (askTilt, before the launch); the hero's TILT
      // chip is the explicit way in after that. With the landing off (`?nolanding`), the first tap anywhere asks, as
      // before. A refusal WebKit makes without prompting (not a gesture it accepts) is retried on the next ask.
      const chip = document.querySelector<HTMLButtonElement>('.hero-tilt');
      let answered = false;
      const ask = () => {
        if (answered) return;
        askTilt().then((granted) => {
          if (answered || (!granted && !tiltAnswer)) return; // not a gesture WebKit accepts: the next tap asks again
          answered = true;
          removeEventListener('touchend', ask, true); removeEventListener('click', ask, true);
          if (granted) listen();
          if (chip) { chip.textContent = granted ? 'Tilt on ◈' : 'Tilt off'; chip.disabled = true; setTimeout(() => { chip.hidden = true; }, 1600); }
        });
      };
      if (tiltAnswer) ask(); // the gate's Enter already asked: adopt its answer
      else if (!landing.enabled) { addEventListener('touchend', ask, true); addEventListener('click', ask, true); }
      if (chip && !answered) { chip.addEventListener('click', ask); chip.hidden = false; }
    } else listen();
    (window as any).__tilt = (beta: number, gamma: number) => onTilt({ beta, gamma } as DeviceOrientationEvent); // probes
  }

  // ---------- landing (landing.ts): when the overlay lifts, the hovercar flies off and the vista sits on its establishing pose
  landing.configure({
    onLand: () => {
      if (!reducedMotion) landingFlyby?.launch(camera);
      if (nav.mode === 'ride' && nav.section === 'city' && !nav.inFlight && journey.p !== ESTABLISH.city) { journey.p = ESTABLISH.city; rig.reset(); }
    },
  });
  let lastDraw = 0, wasThrottled = false;

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
  const apply = () => { renderer.setPixelRatio(dpr); renderer.setSize(root.clientWidth || innerWidth, root.clientHeight || innerHeight); perf.dpr = dpr; };
  (window as any).__perf = perf;
  (window as any).__scene = scene;
  (window as any).__camera = camera;
  const timed = (name: string, fn: () => void) => {
    const a = performance.now(); fn(); const d = performance.now() - a;
    if (d > 40) {
      const detail = Object.entries(stages).filter(([, v]) => v > 5).map(([k, v]) => `${k}=${Math.round(v)}`).join(' ');
      console.warn('[slow]', name, Math.round(d), 'ms at p=', journey.p.toFixed(3), detail);
    }
    for (const k in stages) stages[k] = 0;
  };
  // Loop order: input → nav/player (mode camera) → content (carriers, slabs) → districts/carriers with the section
  // override → lights → the rest → render.
  renderer.setAnimationLoop(() => {
    // Under the landing overlay (compiled shaders, nothing to see) render ~4 fps so the landing car keeps the GPU / CPU.
    const throttled = !firstFrame && landing.covering && !landing.arriving;
    if (throttled) {
      const now = performance.now();
      if (now - lastDraw < 250) return;
      lastDraw = now;
    }
    const unthrottled = wasThrottled && !throttled;
    wasThrottled = throttled;
    if (unthrottled) { ema = 16; slow = 0; fast = 0; } // the 4 fps frame times are not the scene's cost
    clock.update();
    const t = reducedMotion ? 0 : clock.getElapsed();
    const dt = Math.min(clock.getDelta(), 0.05);
    if (!throttled && !unthrottled) govern(dt);
    eased.lerp(landing.covering ? ZERO2 : pointer, 0.05); // no parallax under the overlay: the crossfade lands on a steady vista
    const inp = input.poll();
    nav.tick(dt); // advance the location-change fade (the jump happens behind the black)
    let p = journey.p;
    const mode = nav.mode;
    let walkSec: WalkSection | undefined = mode !== 'ride' && nav.section !== 'city' ? nav.section : undefined;
    if (mode === 'dock' && inp.walkIntent) nav.undock(); // walking away leaves the carrier
    if (player) {
      player.update(dt, inp, nav.mode === 'walk' && !nav.cutscene && !shops.open);
      if (nav.mode !== 'ride') playerPos.copy(player.position);
      if (nav.mode === 'walk' && !nav.cutscene) {
        walkSec = walkSectionAt(playerPos.x, playerPos.z);
        nav.exploreSection(walkSec); p = journey.p;
      }
    }
    timed('content', () => content.update(p, t, dt, { mode: nav.mode, section: walkSec, docked: nav.docked, player: walkSec ? playerPos : null })); // carriers first so the blimp's displacement is current
    // Residents first: a box open or a resident in reach takes F (and the prompt slot) from the carriers; never docked or mid-fade.
    const talkSec = nav.mode === 'walk' && !nav.cutscene ? walkSec ?? null : null;
    if(talkSec==='projects' && !shopPropsRequested) {
      shopPropsRequested=true;
      void import('./shop-models').then(async ({loadShopModel})=>{
        for(const [kind,id] of [['wear','mask'],['audio','headphones'],['games','console']] as const) {
          try {
            const model=await loadShopModel(id), s=MARKET_STALLS.find(s=>s.kind===kind)!;
            model.scale.setScalar(.7); model.rotation.y=s.yaw;
            model.position.set(s.x,1.72,s.z+Math.cos(s.yaw));
            noReflect(model); districts.group.children[2].add(model);
          } catch(error) {console.warn('[shop display]',error);}
        }
      }).catch(error=>console.warn('[shop displays]',error));
    }
    const shopping = shops.update(playerPos,player?.yaw ?? 0,talkSec==='projects',inp.interact);
    let talk = false;
    timed('talk', () => { talk = dialogue.update(talkSec && !shopping ? playerPos : null, shopping ? null : talkSec, inp.interact && !shopping, inp.back, inp.walkIntent, dt); });
    timed('use', () => interactables.update(walkSec ? playerPos : null, inp.interact && !talk && !shopping && !nav.cutscene, nav.mode === 'walk' && !nav.cutscene ? walkSec ?? null : null, talk || shopping));
    const rigP = nav.samplePath(pos, look); // rail pose
    content.followOffset(p, off);
    pos.add(off); look.add(off);
    rig.update(camera, rigP, pos, look, pointer, t, dt, reducedMotion); // look-ahead, damped parallax, bob, banking roll (journey.ts)
    railPose.pos.copy(camera.position); railPose.look.copy(look);
    // Blend rail / follow / dock cameras (nav.ts). In plain ride mode the rig's camera (with its roll) stands as is.
    if (nav.resolveCamera(dt, railPose, player ? player.camera : null, camPos, camLook)) {
      camera.position.copy(camPos); camera.lookAt(camLook);
      // On foot / docked, tilt turns the view a few degrees like looking around a window (the rail camera already
      // takes it as parallax through the rig).
      // Tilt look fades out while the player moves: a phone held in walking hands jitters and read as camera shake.
      if (tiltOn) {
        tiltLook += ((player && player.speed > 0.4 ? 0 : 1) - tiltLook) * Math.min(1, dt * 3);
        const dz = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - 0.08) / 0.92; // ignore hand tremor
        camera.rotateY(-dz(eased.x) * 0.06 * tiltLook); camera.rotateX(-dz(eased.y) * 0.04 * tiltLook);
      }
    }
    else camera.rotation.z -= eased.x * 0.02;
    // The hero slab belongs to the vista only: it fades the moment a location change starts.
    const heroOn = nav.mode === 'ride' && nav.section === 'city' && !nav.inFlight && p < 0.05 && !landing.covering;
    heroAlpha += ((heroOn ? 1 : 0) - heroAlpha) * Math.min(1, dt * 6);
    heroCopy.style.opacity = heroAlpha.toFixed(3);
    heroCopy.style.pointerEvents = heroAlpha > 0.5 ? 'auto' : 'none';
    // Opacity does not remove invisible links from keyboard navigation or the accessibility tree.
    heroCopy.inert = !heroOn;
    heroCopy.style.transform = innerWidth <= 760 ? 'none' : `translate(${(-eased.x * 14).toFixed(1)}px, ${(-eased.y * 8 + Math.sin(t * 0.6) * 3).toFixed(1)}px) scale(var(--hero-scale))`;
    if (water) water.visible = walkSec ? playerPos.z > -60 : p < 0.14 || p > 0.86;
    // Each subsystem's update is timed; anything over 40 ms is reported (`[slow]`) so hitches can be attributed.
    crossingSignals.update(t);
    timed('traffic', () => traffic.update(dt, t, camera.position,
      [...crowds.flatMap(c=>c.walkers.map(w=>w.root.position)),...(nav.mode==='walk'?[playerPos]:[])]));
    landingFlyby?.update(dt);
    timed('ads', () => ads.update(t));
    timed('life', () => { for (const l of life) l.update(dt, camera); });
    dialogue.glance(); // after the mixers: the resident being talked to looks at the player
    timed('districts', () => districts.update(t, p, walkSec));
    timed('lights', () => lightPool.update([...districts.activeLights(), ...content.activeLights()], camera.position));
    timed('particles', () => { for (const s of particles) s.update(p, dt); });
    timed('interact', () => interact.update(dt, p));
    timed('audio', () => audio.update(p));
    const t0 = performance.now();
    timed('render', () => pipeline.render());
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
  // Size from the stage's own box (fixed, inset 0) and re-check on every way a phone changes it: window resize, the
  // visual viewport (toolbars, zoom), orientation, and the stage box itself.
  let lastW = 0, lastH = 0;
  const resize = () => {
    const w = root.clientWidth || innerWidth, h = root.clientHeight || innerHeight;
    if (w === lastW && h === lastH) return;
    lastW = w; lastH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    heroScale();
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h);
  };
  addEventListener('resize', resize);
  visualViewport?.addEventListener('resize', resize);
  addEventListener('orientationchange', () => setTimeout(resize, 300));
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(root);
  resize();

  document.documentElement.classList.add('is-3d');
  return { tier, isWebGPU, towers: kit?.count ?? 0, screens: kit?.screens ?? 0, cars: traffic.count, ads: ads.count, sections: SECTIONS.length };
}

export { neonText };

import * as THREE from 'three/webgpu';
import { createContent } from './content';
import { boot } from './boot';
import { dedupeMaterials } from './districts/shared';
import { createLightPool } from './lights';

import { PAL, params, reducedMotion, loader, type Tier } from './palette';
import { createSky, createHaze } from './sky';
import { createPost } from './post';
import { createBackdrop } from './backdrop';
import { createStreets, loadGroundTextures, AVENUE_HALF, SIDEWALK, CROSS_Z, CROSS_HALF, QUAY_Z } from './streets';
import { createEnvironment } from './env';
import { createParticles, type ParticleSpec } from './particles';
import { createKitbash, loadGlbTowers } from './towers';
import { createProps } from './props';
import { loadCharacter, createCrowd } from './characters';
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
import { ANCHORS, poseAt, rig, SECTIONS, type SectionId } from './journey';
import { createNav, SPAWN } from './nav';
import { createPlayer } from './player';
import { createInput } from './input';
import { createHud } from './hud';
import { createCine } from './cutscene';
import { createInteractables } from './interactables';
import { createDialogue, walkerTargets, carrierTarget, type Target } from './dialogue';
import { buildAreas, type WalkSection } from './walkable';
import { THEMES } from './theme';
import type { PropPlacement } from './props';

/**
 * Neon Harbor. Bay vista hero → the nav pans the camera along the rail to a district, where the visitor takes
 * over the protagonist (the `agent` rig) on foot (nav.ts / player.ts) and docks on the résumé carriers. No scrolling.
 * All lights are emissive; bloom is the light source. `?q=high|med|low`, `?p=0.4` (start the ride at that progress),
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
  const panoUrl = params.get('pano') ? (params.get('pano') === '1' ? '/night/pano/pano-1.jpg' : params.get('pano')!) : null; // preview flag
  scene.fogNode = createHaze(Number(params.get('haze')) || 0.0032, !!panoUrl);
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
  scene.add(createSky(tier, panoUrl ? { url: panoUrl, rotation: Number(params.get('panoRot')) || 0, gain: Number(params.get('panoGain')) || 1.15 } : undefined));
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
  // Start the rig downloads now so they overlap the skyline build instead of gating 'waking the residents'.
  const PROTAGONIST = 'agent'; // the player's rig (rigs.ts row: height 1.80, cyan rim); netrunner stays a crowd rig
  const RIGS_ALL = [PROTAGONIST, 'netrunner', 'corpo', 'vendor', 'punk', 'sec-bot', 'chef', 'geisha-bot', 'idol', 'ronin', 'schoolgirl-hacker', 'mech-pilot', 'cat-courier', 'oni-bouncer', 'maid-bot', 'medic', 'skater', 'salaryman', 'dj', 'nomad', 'noodle-cook', 'patrol-bot'] as const;
  const RIGS_LITE = [PROTAGONIST, 'netrunner', 'sec-bot', 'idol', 'maid-bot', 'cat-courier'] as const;
  if (!params.has('nopeople')) for (const n of (lite ? RIGS_LITE : RIGS_ALL)) loadCharacter(n).catch(() => {});
  boot.phase('paving the streets', 0.1);
  const ground = await loadGroundTextures();
  scene.add(createStreets(ground));
  const pending: Promise<unknown>[] = []; // async builds to finish before the shader pre-warm
  if (!panoUrl) pending.push(createBackdrop().then((m) => scene.add(m)).catch((e) => console.warn('[night] backdrop', e)));

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
      { file: 'tower-b', x: -33, z: -95, height: 70, yaw: 0.2, tint: PAL.magenta }, // 3 u back from the sidewalk: its ground floor used to swallow the bus shelter's panel
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
  const billboard = createBillboard({ image: '/night/ads/billboard-shellworks.webp', video: lite ? undefined : '/night/ads/billboard-shellworks-loop.mp4' }); // the tower's ad (design/night/prompts/ad-shellworks.txt, billboard-loop.txt); phones keep the still + shader motion
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

  // ---------- people, robots, drones (rigged fal characters; walkers stay visible out to 140 u)
  const life: { update(dt: number, cam: THREE.Camera): void }[] = [];
  const crowds: { id: string; walkers: ReturnType<typeof createCrowd>['walkers'] }[] = []; // the walkers, for the dialogue
  if (!params.has('nopeople')) {
    try {
      boot.phase('waking the residents', 0.62);
      const all = RIGS_ALL;
      const names = lite ? RIGS_LITE : all;
      const rigs = Object.fromEntries(await Promise.all(names.map(async (n) => [n, await loadCharacter(n)]))) as Partial<Record<(typeof all)[number], Awaited<ReturnType<typeof loadCharacter>>>>;
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

  // ---------- walk mode: nav state machine, the protagonist, the HUD and what can be used on foot
  const journey = { p: Number(params.get('p')) || 0 };
  const hud = createHud();
  // Street furniture becomes obstacles when props.ts exports its placements; otherwise walkable.ts replicates the rules.
  const propsBuilt = await propsReady.catch(() => null);
  const placements = (propsBuilt as unknown as { placements?: PropPlacement[] } | null)?.placements ?? null;
  const areas = buildAreas(placements);
  const protagonist = params.has('nopeople') ? null : await loadCharacter(PROTAGONIST).catch(() => null);
  const footstep = (audio as unknown as { step?: () => void }).step; // audio.ts grows `step()` with the interactions pass
  const player = protagonist ? createPlayer({ asset: protagonist, rim: PAL.cyan, onStep: () => footstep?.call(audio) }) : null;
  if (player) {
    scene.add(player.root);
    player.setArea(areas.education);
    player.teleport(...SPAWN.education.pos, SPAWN.education.yaw); // in view of the pre-warm poses so its skin compiles now
  }
  const playerPos = new THREE.Vector3(); // player feet, or the spawn when there is no character (`?nopeople`)
  const dockTarget = new THREE.Vector3(), dockNormal = new THREE.Vector3();
  const navLinks = [...document.querySelectorAll<HTMLAnchorElement>('.nav a[data-section]')];
  // Generated video cutscenes over the nav transitions (desktop only; cutscene.ts decides). Clips are warmed per section.
  const cine = createCine({ lite, narrow });
  const nav = createNav({
    journey,
    cover: cine.cover,
    onMode: (m) => { hud.setMode(m); if (player) player.root.visible = m !== 'ride'; },
    onSection: (id) => {
      navLinks.forEach((a) => a.toggleAttribute('aria-current', a.dataset.section === id));
      if (id !== 'city') document.documentElement.classList.add('has-entered'); // the nav appears once the visitor enters
    },
    onEnterWalk: (id) => {
      const s = SPAWN[id];
      playerPos.fromArray(s.pos);
      if (player) { player.setArea(areas[id]); player.teleport(...s.pos, s.yaw); }
      hud.showHintOnce();
    },
    // The camera has settled on the district's establishing shot (the cutscene's hold): the title card.
    onArrive: (id) => { if (id !== 'city') { const th = THEMES[id]; hud.toast(th.name.toUpperCase(), th.subtitle.toUpperCase()); } cine.preload(id); },
    onBeat: (s) => hud.cutscene(s), // letterbox bars, the skip chip, the reduced-motion fade
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
      if (narrow && player && c && id !== 'amd-dc') { c.mount.getWorldPosition(dockTarget); c.mount.getWorldDirection(dockNormal); player.frame(dockTarget, dockNormal, c.width, pos, look); return true; }
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
  hud.onSkip(() => nav.skip());
  const input = createInput({
    stage: root, touch: hud.touch,
    enabled: () => nav.mode === 'walk',
    // E interacts while a prompt is up or a dialogue / terminal is open; with nothing to use it turns the camera (Q / E).
    interactable: () => nav.mode !== 'walk' || !!(prompts.talk || prompts.use) || !!dialogueOpen(),
    onKey: (e) => {
      if (nav.mode !== 'dock') return false;
      if (content.onKey(e)) return true; // the docked carrier first (Esc may collapse a menu row before it leaves)
      if (e.key === 'Escape') { nav.undock(); return true; }
      return false;
    },
  });
  // One HUD prompt slot, two writers: the residents' "Talk to …" (dialogue.ts) wins over the carriers' prompt.
  const prompts: { talk: string | null; use: string | null } = { talk: null, use: null };
  let dialogueOpen: () => boolean = () => false; // bound once the dialogue exists (below)
  const publishPrompt = () => hud.prompt(prompts.talk ?? prompts.use);
  const interactables = createInteractables({ scene, carriers: content.carriers, nav, prompt: (l) => { prompts.use = l; publishPrompt(); }, landingCar });
  // ---------- talking to the residents (dialogue.ts): every crowd walker, plus the two carrier NPCs matched by where they stand
  const NPC_RIGS: [x: number, z: number, rig: string, section: WalkSection][] = [[-81.6, -97.4, 'schoolgirl-hacker', 'education'], [-16.4, -100.3, 'oni-bouncer', 'work']];
  const npcAt = new THREE.Vector3();
  const dialogueTargets: Target[] = crowds.flatMap((c) => walkerTargets(c.walkers, null, c.id));
  for (const npc of content.npcs) {
    npc.root.getWorldPosition(npcAt);
    const row = NPC_RIGS.find(([x, z]) => Math.hypot(npcAt.x - x, npcAt.z - z) < 3);
    if (row) dialogueTargets.push(carrierTarget(npc, row[2], row[3]));
  }
  const dialogue = createDialogue({ hud, prompt: (l) => { prompts.talk = l; publishPrompt(); }, getTargets: () => dialogueTargets, playerYaw: () => player?.yaw ?? null });
  dialogueOpen = () => dialogue.open;
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
  // step lets the label paint and the skip link appear. Frustum culling is off so a district's whole
  // content is built, not just what the pose happens to frame.
  {
    const t0 = performance.now();
    const meshes: THREE.Object3D[] = [];
    scene.traverse((o: any) => { if (o.isMesh || o.isPoints || o.isLine) meshes.push(o); });
    const culled = meshes.map((o) => o.frustumCulled);
    for (const o of meshes) o.frustumCulled = false;
    boot.allowSkip();
    const poses = [0, 0.10, 0.19, 0.31, 0.42, 0.535, 0.66, 0.82, 0.94, 1.0]; // 0.10: campus appears while the water still reflects
    for (let i = 0; i < poses.length; i++) {
      boot.phase(`compiling shaders ${i + 1}/${poses.length}`, 0.86 + (0.1 * i) / poses.length);
      await new Promise((r) => setTimeout(r, 16)); // paint the label before the (synchronous) frame
      const pp = poses[i];
      districts.update(0, pp);
      content.update(pp, 0, 0);
      if (water) water.visible = pp < 0.14 || pp > 0.86;
      poseAt(pp, pos, look); camera.position.copy(pos); camera.lookAt(look); camera.updateMatrixWorld(true);
      const tp = performance.now();
      pipeline.render();
      if (params.has('prof')) console.info('[night] pre-warm pose', pp, Math.round(performance.now() - tp), 'ms');
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
  cine.preload(nav.section); // the four clips out of the starting section, once the first frame is up and the thread idle
  const railPose = { pos: new THREE.Vector3(), look: new THREE.Vector3() };
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();

  const pointer = new THREE.Vector2(), eased = new THREE.Vector2();
  let tiltOn = false; // a phone is feeding device tilt into `pointer`
  addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') pointer.set((e.clientX / innerWidth) * 2 - 1, (e.clientY / innerHeight) * 2 - 1); });
  // Phones: device tilt drives the same parallax as the mouse, a little stronger. iOS only grants motion access from a
  // user gesture, so the permission is requested on the first touch; Android delivers events directly. `?nogyro` opts out.
  if (matchMedia('(pointer: coarse)').matches && !reducedMotion && !params.has('nogyro') && 'DeviceOrientationEvent' in window) {
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
      // without a prompt). Ask on the first tap anywhere, retry on the next if WebKit refused, stop once answered. The
      // hero's TILT chip is the explicit way in (a tap on "Enter the city" would prompt mid-cutscene).
      const chip = document.querySelector<HTMLButtonElement>('.hero-tilt');
      let asking = false;
      const done = (granted: boolean) => {
        removeEventListener('touchend', ask, true); removeEventListener('click', ask, true);
        if (chip) { chip.textContent = granted ? 'Tilt on ◈' : 'Tilt off'; chip.disabled = true; setTimeout(() => { chip.hidden = true; }, 1600); }
      };
      const ask = () => {
        if (asking) return;
        asking = true;
        DOE.requestPermission!().then((s) => { if (s === 'granted') listen(); done(s === 'granted'); })
          .catch(() => { asking = false; }); // not a gesture WebKit accepts: try again on the next tap
      };
      addEventListener('touchend', ask, true);
      addEventListener('click', ask, true);
      if (chip) chip.hidden = false;
    } else listen();
    (window as any).__tilt = (beta: number, gamma: number) => onTilt({ beta, gamma } as DeviceOrientationEvent); // probes
  }

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
    clock.update();
    const t = reducedMotion ? 0 : clock.getElapsed();
    const dt = Math.min(clock.getDelta(), 0.05);
    govern(dt);
    eased.lerp(pointer, 0.05);
    const inp = input.poll();
    if (inp.skip) nav.skip(); // Esc / Enter / Space / a tap on the stage: cut the transition cutscene to its arrival
    nav.tick(dt);             // advance the cutscene: journey.p along the paced move, the beats, the hand-over to the character
    const p = journey.p;
    const mode = nav.mode;
    const walkSec: WalkSection | undefined = mode !== 'ride' && nav.section !== 'city' ? nav.section : undefined;
    if (mode === 'dock' && inp.walkIntent) nav.undock(); // walking away leaves the carrier
    if (player) {
      player.update(dt, inp, nav.mode === 'walk');
      if (nav.mode !== 'ride') playerPos.copy(player.position);
    }
    timed('content', () => content.update(p, t, dt, { mode: nav.mode, section: walkSec, docked: nav.docked, player: walkSec ? playerPos : null })); // carriers first so the blimp's displacement is current
    // Residents first: a box open or a resident in reach takes E (and the prompt slot) from the carriers; never docked or mid-cutscene.
    const talkSec = nav.mode === 'walk' && !nav.cutscene ? walkSec ?? null : null;
    let talk = false;
    timed('talk', () => { talk = dialogue.update(talkSec ? playerPos : null, talkSec, inp.interact, inp.back, inp.walkIntent, dt); });
    timed('use', () => interactables.update(walkSec ? playerPos : null, inp.interact && !talk, nav.mode === 'walk' ? walkSec ?? null : null, talk));
    const rigP = nav.samplePath(pos, look); // rail pose, or the fly-over's during a non-adjacent jump
    content.followOffset(p, off);
    pos.add(off); look.add(off);
    rig.update(camera, rigP, pos, look, pointer, t, dt, reducedMotion); // look-ahead, damped parallax, bob, banking roll (journey.ts)
    railPose.pos.copy(camera.position); railPose.look.copy(look);
    // Blend rail / follow / dock cameras (nav.ts). In plain ride mode the rig's camera (with its roll) stands as is.
    if (nav.resolveCamera(dt, railPose, player ? player.camera : null, camPos, camLook)) {
      camera.position.copy(camPos); camera.lookAt(camLook);
      // On foot / docked, tilt turns the view a few degrees like looking around a window (the rail camera already
      // takes it as parallax through the rig).
      if (tiltOn) { camera.rotateY(-eased.x * 0.07); camera.rotateX(-eased.y * 0.045); }
    }
    else camera.rotation.z -= eased.x * 0.02;
    // The hero slab belongs to the vista only: it fades the moment a pan starts (p may not move until a fly-over's apex).
    const heroOn = nav.mode === 'ride' && nav.section === 'city' && !nav.inFlight && p < 0.05;
    heroAlpha += ((heroOn ? 1 : 0) - heroAlpha) * Math.min(1, dt * 6);
    heroCopy.style.opacity = heroAlpha.toFixed(3);
    heroCopy.style.pointerEvents = heroAlpha > 0.5 ? 'auto' : 'none';
    heroCopy.style.transform = `translate(${(-eased.x * 14).toFixed(1)}px, ${(-eased.y * 8 + Math.sin(t * 0.6) * 3).toFixed(1)}px) scale(var(--hero-scale))`;
    if (water) water.visible = walkSec ? walkSec === 'contact' : p < 0.14 || p > 0.86; // bay vista and the pier; hidden in between (reflector cost)
    // Each subsystem's update is timed; anything over 40 ms is reported (`[slow]`) so hitches can be attributed.
    timed('traffic', () => traffic.update(dt, t, camera.position));
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

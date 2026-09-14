# Night City — district plan, assets and lab results

Branch `redesign`. Companion to the approved plan (`~/.claude/plans/pure-petting-adleman.md`, Part C). Ivan's
direction: mockup **variant 1** (`design/concepts/nightcity-hero-1.png`), **no employers in the first frame**,
résumé split into **three districts** (Education / Work / Projects) the site flies between, and **animated
life** (flying cars, people, neon, hovering ads). Visual targets from this round: `design/night/concepts/*.png`
(hero without company names, education, work, projects) — contact sheet `design/night/contact/concepts.png`.

## 1. Hero (first frame)
- Camera hangs above the avenue (flying-car POV, mockup 1). The near tower carries the **"IVAN HE" holo
  billboard** (name + "GPU SOFTWARE PERFORMANCE ENGINEER"); below it a dark holo panel with
  **ENTER THE CITY** (acid-yellow, hazard stripes) and **RÉSUMÉ** (cyan outline). Nav: `CITY · EDUCATION ·
  WORK · PROJECTS · CONTACT`.
- Nothing else is text: the skyline is procedural towers + reused GLB towers, keyed neon signs (glyphs
  only), hovering ads (fictional brands), cars with trails, rain. **No AMD / KIOXIA / Apple anywhere in the
  hero.** The employer signs live in the Work district only.
- Content lift: `#hero-copy` (name, role, buttons) → `CSS3DObject` on the billboard, exactly as the Aero
  plan does; the billboard mesh is a `MeshPhysicalNodeMaterial` slab (transmission .6, emissive cyan border,
  scanline `fract(uv.y·120)`, `hash(floor(time·24))` flicker).

## 2. Districts (content model unchanged: `src/content.ts` from the approved plan)
| district | nav | where in the city | what it shows | DOM → 3D |
|---|---|---|---|---|
| **Education** | `#education` | a low campus block off the avenue to the **left**, plaza with holo trees (mockup `district-education`) | one holo "transcript" window: UC Berkeley · B.A. Cognitive Science · 2015–19; two badge chips: GCP Core Infrastructure, Architecting with Compute Engine | `[data-window="berkeley"]` (kept from the plan's 5th window) + `[data-cert]` chips |
| **Work** | `#work` | the avenue of corporate towers, **straight ahead** (mockup `district-work`) | 4 towers, each with a **neon flame-graph sign** + monospace label (AMD · 2017–18, Toshiba/KIOXIA · 2019–21, AMD · 2021–22, Apple · 2022–); a fibre conduit with pulses links them; the active tower's sign expands into the **holo window** (title bar, role, bullets) — the "Aero window expand" behaviour re-skinned | `[data-window]` ×4, `createFlameGraph(spans)` bars re-skinned as neon tubes |
| **Projects** | `#projects` | a rooftop night market to the **right**, string lights and noodle neon (mockup `district-projects`) | Flip-3D stack of 4 holo-ad windows (trip-planner, chordsmith, okaybuddy, Hearthly) with screenshot textures; details sheet with chips + LIVE/CODE buttons | `[data-project]` ×4, `createStack(projects)` |
| **Contact** | `#contact` | landing pad on the market roof, pulsing yellow "H" | LinkedIn / GitHub as neon signs | footer links |

Apple stays org-line only (no bullets), as decided.

## 3. Flight between districts
- One scroll journey (`journey.ts` sections) **and** direct flights from the nav: clicking a district
  animates `journey.p` to that district's start (GSAP ScrollTo), so scrolling and nav are the same path.
- Camera keyframes (world units; avenue along −z, x = 0; towers ~14 u grid):
  - **K0 hero**: cam (0, 31, 44) → look (0, 26, −60). Billboard on tower A at (−22, 34, −18) facing +z.
  - **K1 Education**: bank left, descend: cam (−48, 20, −40) → look (−78, 12, −70); campus block at
    (−80, 0, −80), transcript window at (−66, 16, −62) facing the camera.
  - **K2–K5 Work**: back to the avenue, climb: cam `sign.pos + normal·7 + (0, .4, 0)` with a dwell per
    tower; towers at z = −60, −100, −140, −180 alternating x = ±22; signs at y 30→22.
  - **K6 Projects**: bank right onto the market roof: cam (34, 30, −196) → look (52, 27, −214); stack
    centred (52, 27, −214); details sheet at stack + (4.6, 0, 1.8).
  - **K7 Contact**: cam (46, 26, −226) → look (54, 24.6, −236), pad beacon.
- Transitions: banked turns (`camera.rotation.z` from lateral velocity, max 6°), 0.3 Hz hover bob,
  pointer roll ±1°; district entry = glitch-reveal of that district's windows (GSAP `steps(8)` clip-path
  slices + scramble text). Reduced motion: cuts instead of flights, no bob, no flicker.

## 4. Animated life (what moves, how it's driven)
| thing | count (high/med/low) | driver |
|---|---|---|
| window lights flicker + occupancy | all procedural towers | TSL `hash(cell + floor(time·2))`, per-building pitch/occupancy from `instanceIndex` |
| neon signs buzz | 12 keyed + 6 canvas | TSL `hash(floor(time·30))` gated by a slow `hash(floor(time·.5))` |
| hovering ads | 4 | CPU bob/drift (sin) + TSL scanlines `fract(uv.y·90 + time·8)` + glitch offset `hash(floor(time·6))`; optional video loop (see §6) |
| hover cars + trails | 36/20/10 on 3 lanes (+3 more lanes in the full scene) | CPU `curve.getPointAt(t)`, wheels hidden, cyan underglow + tail/head planes; trails = `TubeGeometry` ribbons with TSL dash pulses `pow(fract(u·28 − time·.9), 6)` |
| pedestrians | 12/8/4 | Kenney CC0 mini characters (`idle`/`walk`/`sit` clips) via `AnimationMixer`, `SkeletonUtils.clone`; CPU walk along the walkway; rim-lit TSL material |
| rain | 5k/2.5k/0 | one `InstancedMesh` of streaks, TSL `fract(seed + time)` fall inside a camera-relative box |
| conduit pulses, flame-graph bars | Work district | TSL `fract(u·5 − time·.22)` (existing `createPipe`), bars emissive ×4 for bloom |
| fog / haze | — | `fog(navy·magenta, densityFogFactor(.0045))` |

## 5. Backdrop decision (per district)
- **2.5D depth-displaced plate** for the far city everywhere: `public/night/backdrop/aerial.webp`
  (Nano Banana Pro plate, POV car cropped out) + `aerial-depth.png` (depth-anything v2). Plane
  (W≈1065×520 u, 256×128 segments) at z −560, `positionNode += depth·140`. Lab check
  `design/night/lab-parallax.png` (camera ±14 u): the plate shifts against the procedural towers, seams
  none, 2048-px webp = 300 KB. Parallax inside the plate is subtle at that distance, which is what a
  far skyline should do; all real parallax comes from the procedural/GLB towers in the 0–250 u band.
- **Hunyuan World: rejected for the web.** The Aero run on `design/plates/clean-plate-2.jpg` finished
  after ~20 min as a **312 MB zip** (`design/plates/world-plate2.bin`): `mesh_layer0..3.ply` = 32 / 25 /
  **315** / 98 MB of vertex-coloured PLY, plus the panorama (`full_image_sr.png` 10 MB), `sky_image*.png`,
  per-layer masks and `fg1/fg2.json`. No `.drc` files were produced despite `export_drc: true`. Even
  Draco-compressed offline, the layers would stay tens of MB and the lights are baked (no flicker,
  no moving ads). My night run on the aerial plate was cancelled once that was clear (see cost table).
  The plate + depth pair does the far-city job at 0.5 MB.
- Districts differ by what stands in front of the plate: Education = low campus blocks + holo trees
  (procedural boxes + emissive band material + `SpriteNodeMaterial` tree cutouts); Work = the tall
  window-grid towers + GLB towers; Projects = rooftop props (string lights = instanced emissive spheres,
  stalls = boxes + keyed noodle signs).

## 6. Asset inventory
Generated this round (all under `design/night/**`, web copies under `public/night/**`):
| asset | source | files |
|---|---|---|
| far-city plates (aerial, canyon) | NBP 21:9 2K | `design/night/plates/aerial-1.png`, `canyon-1.png`; web `public/night/backdrop/aerial.webp` + `aerial-depth.png` |
| district mockups (hero w/o employers, education, work, projects) | NBP 16:9 2K | `design/night/concepts/*.png` |
| neon signs, 12 cutouts with alpha | 2 NBP sheets on flat green → PIL green-key (median border colour, un-premultiply, BFS component split) | `public/night/signs/sign-1..12.webp` (`design/night/contact/signs-keyed.png`) |
| hovering ads, 4 fictional brands 9:16 | NBP 1K | `public/night/ads/ad-1..4.webp` |
| ad loop test | LTX 13B distilled i2v, 97 frames 720p ($0.10) | `design/night/ads/ad-3-loop.mp4` (832 KB, 4 s). Plays in Chrome as a `THREE.VideoTexture` on ad-3 in the lab (`[night] ad-3 video loop active`). The bundled Playwright ffmpeg can't decode H.264, so the loop seam wasn't frame-checked; stills + TSL scanline/glitch already read as alive, so video stays optional (one ad at most, muted/loop/playsinline). |
| hover car concept + 3D | NBP concept → Hunyuan3D v3 image-to-3d | `design/night/vehicles/hovercar-1.png` (concept, `hovercar-preview.png` = fal's render: clean wedge, cyan sill strip, magenta tail bar). `hovercar.glb` (Normal, **27 MB**, unusable) → `hovercar-lowpoly.glb` (LowPoly, **2,808 triangles**, 8.4 MB of which 8.1 MB is one 4K PNG texture) → shipped as `public/night/models/hovercar.glb`. Re-encoding that texture to 1K WebP (gltf-transform, or a small Python GLB repack) brings it under 1 MB — do that before production. In the lab the GLB replaces the Kenney cars; light strips come from texture luminance → emissive cyan/magenta. |
Reused (no spend): Kenney CC0 Car Kit (sedan, taxi, suv, hatchback-sports, delivery) and Mini Characters
(4 rigs with idle/walk/sit) → `public/night/cc0/` (+ `cc0-manifest.json`); playweave-engine towers
`tower-01..06.glb` (Ivan's own Hunyuan3D generations, receipts in `public/night/models/towers-provenance.json`).
Procedural (no spend): window-grid towers, canvas text signs, lane paint, walkway, rain, trails, lamps.
Still needed for the full site: project screenshots (Playwright, as in the Aero plan), the "IVAN HE"
billboard (CSS3D, no asset), Education campus props, market props (string lights, stalls), fallback poster.

## 7. Performance tiers (lab, headless Chrome, 1600×900)
| tier | DPR | towers | GLB towers | cars | walkers | rain | post |
|---|---|---|---|---|---|---|---|
| high | 1.5 | 900 | 3 | 36 | 12 | 5k | bloom (.7/.55/.9) |
| med | 1.25 | 500 | 3 | 20 | 8 | 2.5k | bloom |
| low (WebGL2) | 1.0 | 250 | 0–1 | 10 | 4 | 0 | MSAA 4, small bloom |
Full scene adds: TRAA + sharpen, DoF on the active window (high), chromatic aberration + film (light),
`GodraysNode` behind the hero billboard (high). Cut order when the governor trips: godrays → rain → DoF →
reflector → CA/film.

## 8. Implementation steps (after the Aero/Night decision)
1. `src/scene/night/{palette,backdrop,towers,signs,ads,traffic,people,rain,streets}.ts` extracted from
   `lab.ts` (each is already a self-contained block there).
2. `holo.ts`: billboard + holo window + Flip-3D stack skins with the same signatures as the Aero
   `createWindow/createStack/createHeroPanel`; `html[data-theme=night]` CSS tokens (Rajdhani display).
3. District layout + camera keyframes (§3) in `journey.ts` (standoff as a theme parameter).
4. Work district: neon flame-graph signs on tower faces, conduit, expand-on-dwell.
5. Education + Projects districts, contact pad.
6. Nav flights (ScrollTo), glitch reveals, reduced-motion path.
7. Post chain + governor; tiers table verified with `scripts/fps.mjs`.
8. Fallback poster + `?flat`.

## 9. Cost table (this task; `design/fal-spend.log` lines with `night/`)
| item | endpoint | $ |
|---|---|---|
| plates aerial + canyon | nano-banana-pro 21:9 2K ×2 | 0.30 |
| district mockups ×4 | nano-banana-pro 16:9 2K | 0.60 |
| neon sign sheets ×2 | nano-banana-pro 16:9 2K | 0.30 |
| ads ×4 | nano-banana-pro 9:16 1K | 0.60 |
| hover-car concept | nano-banana-pro 4:3 1K | 0.15 |
| depth (aerial) | image-preprocessors/depth-anything/v2 | 0.01 |
| hover car 3D (Normal) | hunyuan3d-v3/image-to-3d | 0.375 |
| hover car 3D (LowPoly) | hunyuan3d-v3/image-to-3d | 0.45 |
| ad loop test | ltxv-13b-098-distilled/image-to-video (97 f) | 0.10 |
| world model (aerial) | hunyuan_world/image-to-world — **cancelled** while IN_PROGRESS after the Aero run proved the format; not in the ledger, fal may still bill it | (0.30) |
| **total logged** | | **$2.89 of the $20** (≤ $3.19 if the cancelled run is billed) |
Not spent (deliberately): pedestrian sprite sheets (Kenney rigs cover it), more world-model runs (2.5D
plate is sufficient), background-removal endpoints (local PIL keying was clean), more ad videos.

## 10. Lab results
`src/pages/lab/night.astro` + `src/scene/night/lab.ts`, dev server `:4322`, screenshots
`design/night/lab-1..4.png` (`lab-4.png` = final: 2.5D plate skyline, 900 window-grid towers with per-building
pitch/occupancy/flicker, 3 GLB towers with lit windows, keyed neon signs + canvas text signs buzzing,
4 hovering ads (one video), 36 hover cars on 3 lanes with red/white trail pulses, 12 Kenney pedestrians
walking under sodium lamps on a wet walkway, 5k rain streaks, bloom). `lab-parallax.png` = camera ±14 u.
Query flags: `?cam=<z>`, `?nobloom`, `?norain`, `?novideo`, `?kenney` (Kenney cars instead of the GLB),
`?q=high|med|low`. `scripts/night-fps.mjs` (copy of fps.mjs pointed at the lab) errored in this session
and was not debugged; measure with the parent's harness after extraction.

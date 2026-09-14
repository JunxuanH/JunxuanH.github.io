# Night City — characters, rig audit & animated life

Pipeline: Nano Banana Pro concept (anime cel-shaded, strict A-pose, #00ff00 background — see
`design/night/prompts/char-<name>.txt`) → `fal-ai/hunyuan3d-v3/image-to-3d` (LowPoly + PBR, 40k faces;
drones: Normal + PBR) → `fal-ai/meshy/rigging` (`enable_animation` + one idle clip; walk/run come free as
armature-only GLBs) → optional `fal-ai/meshy/rigging/multi-animation` (extra clips such as talk/wave — it
re-rigs the mesh, so `--clips-replace-rig` ships that rig) → gltf-transform slim (dedup, prune, 1K textures,
WebP, Draco). Script: `scripts/night-character.sh <name> <concept.png> [--rig] [--idle id]
[--clips talk=308,wave=28 --clips-replace-rig] [--height m] [--skip-3d --model-url …]`.
Raw fal downloads + responses stay here (`design/night/characters/<name>/`), shipped files go to
`public/night/characters/<name>/{rigged,model,walk,run,idle[,talk,wave]}.glb + meta.json`.

## Rig QA: audit, lab page, runtime table

- **Lab page** `src/pages/lab/characters.astro` → `src/scene/night/rigview.ts` (no city, boots in ~2 s):
  `?name=agent&clip=walk|run|idle|talk|wave&t=0.3&view=front|side|back|three[&raw=1&skin=1]` (grid, +z
  arrow = runtime forward, rest bbox, head marker, HUD with the rigs.ts row + audit numbers),
  `?sheet=all&clip=walk&view=front&t=0.3[&flags=1]` (7 × 4 orthographic contact sheet), `?turntable=name`,
  `?audit=all[&fixed=1]` → `window.__audit`.
- **Audit** `src/scene/night/rigaudit.ts` (`auditRig`) skins every clip on the CPU and measures: forward from
  the `headfront` marker bone (`yawErr`, `mirrored`, plus `walkYawErr` from the planted-foot velocity),
  `bboxRest` / `headY` / `headTopY`, ground contact per clip (`groundOffset = −p20(minY)`, floating/sinking
  beyond ±3 cm, hover, hips drift), skin faults (`maxDisp` = blended vs dominant-bone position, > 0.30 walk /
  0.40 run; `strayWeights` > 1 %; `stretch` = p99 edge ratio > 2.0), stride from planted-foot linear fits
  (`stride`, `strideRun`, `stepLen`) and the redundant-track count. Driver: `node scripts/rig-audit.mjs
  [--fixed] [--names a,b] [--no-sheets] [--turntables=missing|all|none]` → `audit.json` / `audit-fixed.json`,
  a flag table, `sheet-{walk,run,idle}-{front,side}[-fixed].png`, `<name>/turntable.png`.
- **Runtime table** `src/scene/night/rigs.ts` (`RIG_META`, filled from the audit; `ok` / `note` by hand).
  `characters.ts#instantiate` wraps every clone in a pivot: `yaw`, per-clip `groundOffset`, default `height`,
  `stride`/`strideRun` (u/s at timeScale 1) for foot-slide-free playback, `headY` for look-at / camera.
  `loadCharacter` drops the constant translation/scale tracks (188 of 288 per rig). The skin material cache
  is untouched (no new shader programs).

## Roster (22 rigs, 2026-09-14 audit)

Facing: every Meshy rig faces +z (yaw 0, none mirrored). Old runtime assumed stride 1.2 / 3.4 for all rigs;
measured walk 1.25–1.72, run 3.6–6.4 u/s → every walker's feet slid ~20 %. Ground: the planted foot dips
1–5 cm in walk/run while the idle pose sits on 0 → per-clip offsets. Verdicts (rule: data fix → accept
localised faults → re-rig $0.32 → regenerate $1.07 → drop):

| name | role in the city | h (u) | walk / run stride | audit → decision | 2026-09-14 spend |
|---|---|---|---|---|---|
| **agent** | **protagonist** (player.ts, cyan rim) | 1.80 | 1.42 / 5.03 | new: 3 concepts, concept-2 picked (clean A-pose, coat hem above the knee, nothing cropped); clean rig | $1.37 |
| netrunner | Education plaza + avenue walker (ex-protagonist) | 1.75 | 1.44 / 5.25 | clean → data fix | – |
| corpo | Work walkway, avenue | 1.75 | 1.36 / 4.98 | clean (OBJ-zip quirk at generation) → data fix | – |
| vendor | Projects market stall (wave) + talker | 1.75 | 1.30 / 4.54 | accepted: stretch 2.8 = raised-arm idle pulling the apron; re-rigged by the clips call → `talk` (313) `wave` (28) | $0.56 |
| punk | Projects market talk pair, avenue | 1.75 | 1.33 / 4.81 | clean; clips call → `talk` (308) `wave` (290) | $0.56 |
| sec-bot | Work avenue + Education gate patrols (searchlight) | 2.10 | 1.72 / 6.42 | clean; meta.json height corrected 1.75 → 2.1 (the rig was made at 2.1) | – |
| chef | Projects market walker | 1.78 | 1.41 / 5.08 | **regenerated** (concept-v3, props-free): v2's wok + holo sign became geometry weighted to the forearm/legs (stray 14 %, maxDisp 0.46, stretch 18) → v3 audits clean | $1.07 |
| geisha-bot | Education plaza + campus talker | 1.80 | 1.31 / 4.92 | accepted: stretch 3.1 = kimono hem while the legs move (maxDisp 0.57 only in the big wave); clips call → `talk` (313) `wave` (28) | $0.56 |
| idol | Work walkway, avenue | 1.65 | 1.35 / 4.66 | accepted: 12.5 % "stray" = twin-tail hair weighted to Head/neck (far by design), maxDisp 0.20; sinking 3.6 cm → offset | – |
| ronin | Education plaza, campus street | 1.78 | 1.40 / 4.86 | clean → data fix | – |
| schoolgirl-hacker | kiosk NPC (h 1.6), campus street | 1.60 | 1.55 / 3.55 | clean; 4.7 cm sink in walk / 3.8 cm float in idle → per-clip offsets | – |
| mech-pilot | Work walkway, avenue, pier | 1.90 | 1.46 / 5.27 | accepted: stretch 2.0 / run maxDisp 0.38 = shoulder pads; sinking 4.1 cm → offset | – |
| cat-courier | avenue, market, pier | 1.65 | 1.28 / 4.63 | clean; sinking 3.1 cm → offset | – |
| oni-bouncer | bus-stop NPC (h 2.0), Education plaza | 2.00 | 1.57 / 5.51 | accepted: 1.9 % stray = long coat hem on Hips/UpLegs; no explosion | – |
| maid-bot | Education plaza, campus, market | 1.70 | 1.38 / 4.96 | clean → data fix | – |
| medic | Work walkway, avenue, pier | 1.72 | 1.38 / 4.97 | clean → data fix | – |
| skater | Education plaza, campus, market | 1.65 | 1.28 / 4.56 | clean; sinking 3.9 cm → offset | – |
| salaryman | Education plaza, Work walkway, avenue (campus talker) | 1.75 | 1.41 / 5.03 | clean; clips call → `talk` (312 phone) `wave` (290) | $0.56 |
| dj | avenue, market | 1.70 | 1.40 / 4.95 | clean → data fix | – |
| nomad | pier | 1.78 | 1.45 / 5.25 | clean → data fix | – |
| noodle-cook | market | 1.68 | 1.25 / 4.42 | clean; sinking 3.1 cm → offset | – |
| patrol-bot | Work walkway, avenue | 1.90 | 1.54 / 5.65 | clean (v2 concept); idle floats 3.3 cm → per-clip offset | – |
| drone-police | avenue figure-8, Contact pad | – | – | prop (procedural flight), not rigged | – |

No rig was dropped (`ok: false`): nothing failed beyond repair once the chef was regenerated. The exact
numbers (per-clip offsets, headY, stepLen) live in `rigs.ts`; the raw measurements in `audit.json`
(before) and `audit-fixed.json` (after: ground 0.000 for every rig, no sinking/floating flags).

## Runtime modules (`src/scene/night/`)

- `rigs.ts` — `RigMeta`, `RIG_DEFAULT`, `RIG_META`, `RIG_NAMES`, `rigMeta(name, asset)`, `groundOffsetFor(meta, clip)`.
- `characters.ts` — `loadCharacter(name)` (shared GLTFLoader + DRACOLoader at `/draco/`, redundant tracks
  stripped), `applySkin(root, {rim, tint, glow})` (PBR maps kept; neon rim; bright saturated albedo →
  emissive so LED trims bloom; one cached material per source material × options), `instantiate(asset,
  {height, rim, skin})` → `{ root (pivot), model, meta, mixer, actions, play(), height, headY, headBone, blob }`,
  `strideOf(inst, 'walk'|'run')`, `createCrowd({ path, assets, count })` → walkers with per-rig height and
  stride, spacing, stalls (a `talk`/`wave` stall waits 20 s for a walker whose rig owns the clip, then anyone
  idles there), 90 u cull.
- `rigaudit.ts` / `rigview.ts` — see above (lab only; not imported by the site bundle).
- `paths.ts` — district loops/stalls (`EDUCATION_PLAZA`, `WORK_WALK_LEFT/RIGHT`, `PROJECTS_MARKET`,
  `CONTACT_PAD`, avenue walks), `PATROLS`, `DRONE_LANES`, `DISTRICT_CROWDS` (which rigs where, counts per tier).
- `robots.ts` — `createRobots({ asset, patrols })`: walk patrol loops (stride from rigs.ts), pause + searchlight sweep.
- `player.ts` — the protagonist: `createPlayer({ asset, rim, onStep })`; height / head height / clip strides /
  footstep length come from the rig's rigs.ts row, so any audited rig can be the player (`PROTAGONIST` in main.ts).
- `drones.ts` — `createDrones({ lanes, tier })`: hover bob, banked turns, rotors, strobe bar, searchlight / holo panel.
- `interact.ts` — NPC glances use `Instance.headY` (rigs.ts) instead of a fixed 1.5 u.

## Spend

- 2026-09-13 first batch (6 rigs + drone): 7 concepts $1.05 · 3D $2.925 · rigs $1.60 = **$6.18**; later batch
  (15 rigs): concepts $2.40 · 3D $9.00 · rigs $4.80 (ledger lines `night/char/<name>/{3d,rig}`).
- 2026-09-14 rig pass (this audit): agent $1.37 (3 concepts $0.45 + 3D $0.60 + rig $0.32) · chef regeneration
  $1.07 · stall clips 4 × $0.56 (multi-animation, idle + talk + wave) = $2.24 → **$4.68** (ceiling $7.10).
  Ledger `design/fal-spend.log` (TSV) is the single source of truth.

## Quirks found

- Hunyuan3D v3 sometimes returns `model_glb` as an **OBJ zip** (`content_type text/plain`, `model_urls.glb null`).
  Fix used for corpo: `unzip` → `npx --yes obj2gltf -i model.obj -o model.glb` → `gltf-transform resize 1024`
  → `night-character.sh --skip-3d --model-url <glb> --rig` (the GLB goes to Meshy as a data URI).
- A data-URI `model_url` is megabytes: build the request JSON in python from a file path — `jq --arg`
  and env vars both hit ARG_MAX. The fal `model_glb.url` from the 3D step stays valid for days: pass it as
  `--model-url` for later Meshy calls instead of re-uploading (all 2026-09-14 clip calls did).
- Meshy's `rigged_character_glb` embeds 4 K PNGs (17 MB); the slim chain brings it to < 250 KB.
  `walking_armature_glb` / `running_armature_glb` are animation-only (60 KB); full-model clips (idle, the
  multi-animation clips) go through `scripts/night-strip-mesh.mjs` → 40–90 KB each.
- Meshy writes translation + rotation + scale tracks for every bone (72 per clip); only the hips translate and
  nothing scales — `loadCharacter` drops the 47 constant tracks per clip (lossless: a missing track leaves
  the bone at that same rest value).
- Meshy normalises the bind pose to `height_meters` exactly (minY 0); `headfront` is a marker bone in front
  of the face — an exact forward probe. The clips are the same `walking_man` retargeted to each rig's leg
  length, so stride speed varies 1.25–1.72 u/s and must be per rig.
- Props in a concept (chef v2's wok + holo sign) become body geometry and receive stray weights → always
  "hands empty, no props crossing the body" in the prompt.
- Never edit `night-character.sh` while a run is in flight: bash reads scripts incrementally and the running
  job dies with a syntax error (the chef v3 run had to be resumed with `--skip-3d --rig`).
- three's `WebGPURenderer.setViewport` takes y from the **top** (the WebGL backend flips); Astro `<style>` is
  scoped, so DOM created at runtime needs `is:global`.
- `sec-bot` was rigged at 2.1 m while its meta.json said 1.75 (fixed); the runtime uses `bboxHeight` anyway.

**Perf (headless Chrome, `?q=med&p=0.31`, 1600×900 DPR 1):** median 16.7 ms (vsync), p95 18.1, CPU 7.9 ms,
244 draws — unchanged by the pivot/table (no new programs: 159 fragment / 263 vertex at boot).

# Ronin protagonist — 2026-09-15

Selected by Ivan: anime male Ronin (silver hair, aubergine bomber, black turtleneck/cargo pants, restrained magenta tabs). Keep separate from the existing `ronin` NPC.

## Generation provenance

- Concept sheet: `fal-ai/nano-banana-2`, request `01a0a2fe-d8ba-7192-b9ad-a21be5de92d8`.
- Isolated A-pose: `fal-ai/nano-banana-2/edit`, request `01a0a301-147a-7c61-bca5-9727ceea8d75`.
  - Prompt: Extract only approved character 02 RONIN; preserve face, silver layered hair, purple cropped bomber, black turtleneck, dark cargos, fingerless gloves and boots; single front-facing full-body symmetric A-pose, separated limbs, white background, no labels/duplicates/props.
  - Reference: https://v3b.fal.media/files/b/0aaa7864/w-esPnXPNWyaYoGDX9wbk_P027Ys1N.png
  - Result: https://v3b.fal.media/files/b/0aaa7873/0GOdMzjrXlWZEeqrUKLRA_wmqura1B.png
- Mesh: `fal-ai/hunyuan-3d/v3.1/pro/image-to-3d`, request `01a0a301-f64d-7671-add5-0840da59db26`; Normal, PBR, 40,000 faces.
- Rig: `fal-ai/meshy/rigging`, request `01a0a304-e627-7710-ac9a-daa4cc31d3f2`; height 1.8 m, idle preset 0 plus basic walking/running, all on one skeleton.
- Raw files/concept live in ignored `design/night/characters/ronin-player/`; optimized deliverables in `public/night/characters/ronin-player/`.

## Budget

These jobs used the Fal connector, not the old shell ledger. No keys were added to the client.
Published pricing: image base $0.08 each; Hunyuan $0.375 + $0.15 PBR + $0.15 custom face count = $0.675. Meshy page says $0.32 with idle, but live pricing API returns $0.80/generation. Conservative reservation: $0.16 for each of the two earlier concept sheets and this A-pose, $0.675 mesh, and $0.92 rig including idle = $2.075 total. This is an estimate/reservation, not a verified billing statement, and remains inside the user's $10 cap.

Pricing sources: https://fal.ai/models/fal-ai/hunyuan-3d/v3.1/pro/image-to-3d and https://fal.ai/models/fal-ai/meshy/rigging plus Fal get_pricing responses.

## Rig audit and motion

- 39,757 triangles; 24 bones; no stray weights; yaw error 0°; walk yaw error -0.7°.
- Measured native speeds: walk 1.483 m/s, run 5.392 m/s. Step lengths .791 / 1.797 m.
- Runtime foot offsets: walk .002 m, run .022 m. Idle metadata offset -.0153 m is divided by the exported 1.17647 unit scale, giving -.013 m after normalization.
- Player: walk 1.8 m/s, run 4.8 m/s; speed-dependent clip rate even during fade-out, hysteresis, phase-preserving walk/run transitions, heading follows velocity during reversal.
- QA: `/lab/characters?gait=ronin-player` provides actual-controller regression checks and visual controls. All seven idle/slow/walk/run/walk/reverse/idle stages passed, planted-foot p20 within .004 m and skeleton-scale error 0.
- Unit check: `node --experimental-strip-types scripts/gait-check.mjs`.
- Previous soldier kept intact and used as load/clip-error fallback.

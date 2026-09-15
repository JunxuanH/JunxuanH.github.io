# Harbor rendering and transition refresh — 2026-09-14

User authorized an additional $15–20 maximum. Estimated generation cost: **$14.70**
(21 Kling v3 Pro, five-second, no-audio jobs × $0.14/second). This is an estimate,
not a reconciled invoice. Uploads and local editing add no model-generation charge.
Request IDs, prompts, input CDN URLs and results are in `cutscenes/refresh-2026-09-14/`.

## Rendering

- The board's black/coloured halo reproduced with bloom enabled, including the low
  tier without temporal AA. It was absent with bloom bypassed. The nearby 350-intensity
  point light made a concentrated specular hotspot under the board; moved it below
  and away from the board and reduced it to 45. Reduced the overhead pad light from
  700 yellow to 160 warm, and softened the pier lamps and signs.
- Bloom now clamps negative input, adds RGB radiance without adding alpha, and runs
  after temporal AA. Contact close-ups checked at low, medium and high quality.
- Drone and robot cone apexes now coincide exactly with their spotlight emitters;
  cone axes and radii derive from the same targets/angles as the actual lights.
  Lighthouse uses the same tested source/target geometry helper. All cones fade more
  rapidly, with fog disabled on the additive material and substantially lower gain.
- Original skyline panels retained. No panorama substitution.

## Film editing

All 20 directed routes have new forward-time footage; no reverse playback remains.
Fresh first/last references come from the production renderer using
`?capture=<section>&p=<establish>&nolanding&dpr=1` at 1280×720.

The first harbor→city generation was rejected: it grew a skyline behind the pier.
Take 2 uses an explicit editorial cut between the departing pier shot and the bay
reverse angle. Its geography is not presented as a continuous camera flight.

The other takes also showed unreliable intermediate geography. The published edits
retain only the first/last 1.2 seconds, connected by a short fade-through-dark, instead
of shipping the invented middle. Each ending dissolves into its exact rendered
reference for the final 0.3 seconds. Harbor→vista keeps the reviewed two-shot take.
These are short travel edits, not claims of physically accurate continuous flyovers.

## Reproduction

- `scripts/cutscene-upload.mjs`: upload reviewed frame files without logging credentials.
- `scripts/cutscene-download-refresh.mjs`: download recorded results and make review strips.
- `scripts/cutscene-edit-refresh.mjs`: reproduce the curated edits with pinned endings.
- `CUTSCENE_TAKE=edited scripts/cutscene-encode.sh <pairs…>`: encode/publish selected edits.
- `node --experimental-strip-types scripts/light-beam-check.mjs`: emitter, aim and fade tests.

Build and gait/beam tests pass. Full TypeScript checking still reports the existing
unrelated Three.js node typing errors; no new errors were introduced in this change.

Final verification: `cutscene-assets-check.mjs` passes all 20 directed routes (18.6 MB
combined; each below 2.5 MB; H.264/no audio; manifest hashes, sizes and durations match).
Worst renderer-pinned ending RMSE is 0.80% after compression. Browser confirmed the
new 5.367-second harbor film playing, the vista arrival, return-to-harbor walk handoff,
and Escape skip to campus. No browser errors during these checks. The contact board
was also checked at a 393×852 viewport.

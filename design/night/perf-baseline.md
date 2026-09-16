# Frame-time baseline — before the street-level fidelity pass

Recorded 2026-09-16 at commit `b1f566e`, against `npx astro build` output served statically on
`http://localhost:4399/` (not a dev server, and not a port another session owns). Machine: this Mac,
Chrome for Testing 1234, `--enable-unsafe-webgpu --use-angle=metal`, WebGPU backend.

Probes: `scripts/fps.mjs` (150 rAF samples after a 20 s warm-up) and `scripts/scrub.mjs`.
Every run appends `&nolanding`, which removes the gate before first paint.

## Desktop, 1600 × 900

| setting | median ms | p95 ms | cpu ms | draws | triangles | dpr |
|---|---|---|---|---|---|---|
| `q=high&dpr=2` | 16.7 | 17.4 | 5.6 | 664 | 4,171,677 | 2.00 |
| `q=high&dpr=1.5` | 16.7 | 17.6 | 4.8 | 664 | 4,171,677 | 1.50 |
| `q=high` | 16.7 | 17.6 | 4.7 | 664 | 4,171,677 | 1.00 |
| `q=med` | 16.7 | 17.5 | 4.3 | 607 | 3,182,069 | 1.00 |

## Phone-shaped, 390 × 844 at device pixel ratio 3

Desktop silicon, so this measures our own cost, not an iPhone's.

| setting | median ms | p95 ms | cpu ms | draws | triangles | dpr |
|---|---|---|---|---|---|---|
| `q=med&lite` | 16.7 | 17.6 | 4.3 | 537 | 2,760,794 | 1.25 |
| `q=low&lite` | 16.7 | 17.7 | 3.3 | 485 | 2,025,900 | 1.50 |

## Hitches, `scripts/scrub.mjs` at `q=high`

1201 frames, median 16.7 ms, p95 17.3 ms, max 18 ms, zero frames over 50 ms, no spikes.

## How to read this

**Every configuration is pinned to the 60 Hz refresh, even at device pixel ratio 2, which is 5.76
million pixels.** Wall-clock frame time therefore cannot detect a regression on this machine until
something costs more than 16.7 ms. Compare the **cpu column** and the **draw and triangle counts**
instead; those move immediately. Treat a rise in cpu ms at `q=high` as the primary regression signal,
and re-measure `q=high&dpr=2` as the closest thing to a loaded GPU that this hardware offers.

The approved allowance for this work is up to roughly 20 percent more frame time on the high tier
only, which against the 4.7 ms cpu baseline means staying under about 5.6 ms. The low tier and the
phone-shaped runs must not regress at all.

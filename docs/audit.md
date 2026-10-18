# Design audit (site-polish phases 1-2)

Evidence: `shots/before/*` (gitignored; regenerate with `node scripts/shots-matrix.mjs http://localhost:4321 shots/before`), `impeccable detect` on `/resume` and `/?flat&nolanding`, and greps over `src/styles`.
Run with `IMPECCABLE_NO_TELEMETRY=1`; in this sandbox the browser needs `--no-sandbox` (set `IMPECCABLE_BROWSER` to a wrapper script).

## Not audited
- **City (3D scene) and in-city HUD.** The sandbox has no GPU: `city-*.png` stops at the loading screen ("compiling shaders", 76%). Frame times (`scripts/fps.mjs`) were not re-measured; `design/night/perf-baseline.md` stands as the budget. Audit these on a machine with WebGPU.
- Impeccable found no `PRODUCT.md` or `DESIGN.md`, so its brief-based checks did not run.

## Findings, ranked

| # | Sev | Surface | Finding | Evidence | Verdict vs design-system |
|---|---|---|---|---|---|
| 1 | high | flat, hud | 9-11px functional text: flat nav sublabels are 9px (`night.css:40`); 21 declarations under 12px across `night.css`, `hud.css`, `dialogue.css`, `shops.css`, `carriers/terminal*.css` | detect `undersized-ui-text` x4; grep | Keep: violates rule 2 (min 12px). Fix. |
| 2 | high | resume | Inconsistent job headers: "Technical Marketing Engineer → Technical Product Manager" puts its dates on a separate line, others right-align them; the Apple entry has no bullets and reads as unfinished | `shots/before/resume-desktop.png` | Keep. Layout/content fix. |
| 3 | med | resume | Line length: bullets and project text run ~115 characters | detect `line-length` x3 | Keep: add `max-width` (~70ch) to `.job li`, `.line`, project text. |
| 4 | med | all 2D | Glow is on nearly everything: 22 neon `box-shadow` rules, detector flags ~20 `dark-glow` on the flat page | detect `dark-glow`; grep | Partly keep: glow is the identity, so keep it on nav, primary CTA and interaction prompt only (rule 1). Remove it from secondary chips, tags and the project card halos. |
| 5 | med | flat | Four project cards repeat a hairline border + 36px diffuse shadow | detect advisory | Keep as a soft note: choose one, edge or elevation. |
| 6 | low | flat | "Kicker above heading" on Education and Contact | detect `kicker-above-heading` | Reject: the tracked mono labels are part of the site's HUD voice. Revisit only if the labels are doing no work. |
| 7 | low | css | Thick left border on shop accent (`shops.css:8`) | detect `side-tab` | Optional; minor. |
| 8 | low | all | 18 uses of letter-spacing >= 0.2em | grep | Keep: limit to labels of 3 words or fewer (rule 2). |

Checked and fine: tokens now shared by both pages; no low-alpha ink text found by grep; 10 `prefers-reduced-motion` and 9 `focus-visible` rules exist (coverage not verified); flat-page project images load (opacity 1, 300px tall) -- the blank areas in the full-page screenshot are a capture artifact, not a bug.

## Suggested phase 3 order
1. Raise minimum text to 12px (14px for body/bullets) -- #1.
2. Resume header/date/bullet consistency and `max-width` -- #2, #3.
3. De-emphasize glow on secondary elements -- #4, #5.

## Phase 3 results (2D layer)

Changed: `night.css`, `hud.css`, `dialogue.css`, `shops.css`, `resume.css`. Before/after screenshots: `shots/before` and `shots/after` (gitignored).

| # | Status |
|---|---|
| 1 tiny text | Fixed for nav, HUD, dialogue, boot and shop labels (9-11px -> 12px, tracking reduced to 0.08-0.2em). **Not changed:** `carriers/terminal*.css` (in-scene CRT sheet, 11px; the detector exempts terminal contexts) -- check it in the 3D view before touching it. |
| 2 resume headers | Dates now stay right-aligned on the first line of every role. **Content gap, not CSS:** the Apple entry still has no bullets (`src/content.ts`); add some or accept it. |
| 3 line length | `max-width: 64ch` on bullets/body/summary. The resume now has a wide empty right margin; try 68-72ch if that looks too narrow. |
| 4 glow | Removed the halo from `.slab`, `.card`, the outline button and the resume paper. Kept on nav, hero panel, primary yellow button, interaction prompt. |
| 5 card shadow row | Resolved by 4 (cards keep the edge, lose the shadow). |
| 6, 7 | Not changed (see table above). |

`impeccable detect`: /resume 5 -> 1 finding (the intentional yellow button glow); flat page 23 -> 6 (remaining: kickers, kept; primary-element glow, kept).

Not done: phases 4 (GSAP motion) and 5 (three.js scene) -- they need a GPU to verify. The in-city HUD changes (sizes, tracking) were not visually checked because the city can't render in this sandbox; check the nav, hint, toast and dialogue at phone width.

---
name: site-polish
description: End-to-end workflow that improves this site's design using every installed design, three.js, GSAP and Playwright skill. Use when asked to polish, audit, redesign or "improve the aesthetics" of the Neon Harbor site, or to run the full design pass.
user-invocable: true
argument-hint: "[phase 1-6 | all] [surface: resume | flat | hud | city]"
---

# Site polish workflow

Surfaces: **city** (three.js scene), **hud** (nav, prompts, toasts: `src/styles/hud.css`, `night.css`), **resume** (`/resume`), **flat** (`html.no-3d` fallback).
Authority order when skills disagree: `design-system` (this repo's rules) > `impeccable` > `frontend-design` > `taste-skill` family > `ui-ux-pro-max`. The third-party design skills are generic and push their own aesthetics (for example brutalist or minimalist); keep the cyberpunk identity, tokens and fonts.

Work in a branch per phase, commit small, and look at the rendered result before and after every change. Never mark a phase done on reading CSS alone.

## 1. Baseline (playwright-cli, scripts/shots-matrix.mjs)
- `pnpm dev`, then `node scripts/shots-matrix.mjs http://localhost:4321 shots/before` (needs `CHROME` set to a Chromium binary).
- Use `playwright-cli` for anything the matrix doesn't cover: hover/focus states, the HUD prompt, opening a section from the nav, keyboard-only navigation.
- Record frame times with `scripts/fps.mjs` and read `design/night/perf-baseline.md`; this is the budget later phases must not break.

## 2. Audit (impeccable `audit` / `critique`, taste-skill, ui-ux-pro-max)
- Run impeccable `audit` and `critique` against `shots/before`; run taste-skill's inspector on `resume` and `flat`.
- Ask ui-ux-pro-max for contrast, touch-target and typography findings.
- Output one ranked list in `docs/audit.md`: finding, surface, evidence (screenshot name), severity. Drop findings that conflict with `design-system`.

## 3. Fix the 2D layer (design-system, impeccable `typeset`/`polish`/`quieter`, frontend-design, redesign-skill)
Order: tokens, type scale and min sizes, emphasis (remove glow from secondary chips), contrast, responsive layout, then the `resume` and `flat` pages. Reuse `tokens.css`; add new tokens there. Respect `prefers-reduced-motion`. Use taste-skill's `output-skill` rules for completeness (no placeholder or half-finished sections).

## 4. Motion (gsap-core, gsap-timeline, gsap-performance, gsap-utils; gsap-scrolltrigger and gsap-react only if relevant)
Review nav camera pans, HUD show/hide and the landing gate for easing, durations and timeline structure. This site is vanilla JS (no React): ignore gsap-react and gsap-frameworks. Add a `gsap.matchMedia` reduced-motion branch. Kill tweens on teardown.

## 5. Scene (webgpu-threejs-tsl, three-best-practices, three-js, img2threejs)
- Check TSL materials, post-processing and asset loading against the skills' rules. Target is three r186: verify any API a skill suggests against `node_modules/three` before using it.
- Use img2threejs only for new props (give it a reference image from `design/night/`); keep to the existing palette.
- Any scene change must keep frame times within the phase 1 baseline.

## 6. Verify and ship
- `pnpm build`; rerun the shots matrix into `shots/after`; compare with `shots/before` at 375/768/1440 and tell the user what changed and what did not.
- Re-run impeccable `audit` and `fps.mjs`; list anything still open.
- Commit, push, update the PR description with before/after notes.

## Rules
- Report honestly: say which skills were actually used and which phases were skipped or failed.
- impeccable's launcher downloads a binary on first use; tell the user before the first run.
- Don't install further skills or change tokens' meaning without asking.

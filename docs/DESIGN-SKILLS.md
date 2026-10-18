# Design skills worth adding

Install with `npx skills add <repo>` (or copy the skill folder into `.claude/skills/`). Star counts vary by source; read each repo and its SKILL.md before installing, since a skill is instructions your agent will follow.

| Skill | Source | Why it fits this site |
|---|---|---|
| frontend-design | anthropics/skills | Picks a deliberate aesthetic direction and avoids generic fonts. Baseline for HUD, /resume, flat page. |
| impeccable | pbakaus/impeccable (Apache-2.0) | `/audit`, `/polish`, `/typeset` commands plus 27 anti-pattern rules; targets the small-text and glow-everywhere issues. |
| taste-skill | Leonxlnx/taste-skill | Anti-"AI slop" pass with adjustable styles; has an image-to-code sub-skill. Described as a first-pass corrector, so pair with impeccable. |
| ui-ux-pro-max | community | Generates a design system from the project; useful as a second opinion on `tokens.css`. |
| img2threejs | github.com/img2threejs/img2threejs (a `hoainho/img2threejs` fork also exists; confirm the official repo) | Rebuilds an object from a reference image as a TypeScript THREE.Group (primitives + procedural shaders, with pivots and colliders). Fits generating new props for the city without GLB assets. |
| playwright (CLI/MCP) | microsoft/playwright | Multi-viewport screenshots and a11y checks; `scripts/shots-matrix.mjs` is the starter. |
| design-system (local) | `.claude/skills/design-system` | This repo's own rules and tokens. |

## three.js and GSAP

This site is vanilla three.js r186 (WebGPU renderer with TSL, WebGL2 fallback) plus GSAP 3.15, with no React, so the React Three Fiber skills don't apply.

| Skill | Source | Why it fits |
|---|---|---|
| gsap-skills (official) | greensock/gsap-skills; `npx skills add https://github.com/greensock/gsap-skills` | Maintained by GreenSock: core API, timelines, ScrollTrigger, plugins, performance. Useful for the camera pans in `nav.ts` and the HUD glitch/transition timing. GSAP plugins are now free. |
| webgpu-threejs-tsl | dgreenheck/webgpu-claude-skill (targets r183+; check against r186) | WebGPU renderer setup, TSL node materials, compute shaders, post-processing. Matches `post.ts`, the wave/reflection work and the TSL materials in `src/scene/night`. |
| three-best-practices | emalorenzo (listed on Smithery) | Performance rules, including GLTF with Draco, Meshopt and KTX2 loading. Relevant to the `public/night` GLB and texture budget; see `design/night/perf-baseline.md`. |
| three-js (vanilla) | noklip-io/agent-skills | Imperative three.js reference. Alternative to the one above; install one, not both. |
| img2threejs | see table above | New props as code instead of GLB files. |

Not worth it for this repo: OpenAEC-Foundation's Three.js skill package (24 skills, mostly R3F, very few installs) and the `threejs-r3f` skills.

Before installing any of these, check that they target your three.js version (r186): TSL and WebGPU APIs changed a lot between releases, and a skill written for an older one will push the agent toward APIs that no longer exist.

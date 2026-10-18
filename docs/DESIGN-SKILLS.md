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

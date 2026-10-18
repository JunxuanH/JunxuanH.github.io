---
name: design-system
description: Design rules for this site (Neon Harbor). Use when editing any CSS, HUD, nav, /resume, or the flat no-3D fallback page, or when asked to review or improve the site's visual design.
---

# Neon Harbor design system

## Tokens
All colour and font tokens live in `src/styles/tokens.css`. Never redeclare them in `night.css`, `resume.css`, or `styles/carriers/*`; import tokens and use `var(--…)`.

- Neutrals: `--asphalt` (page), `--ink` (text), `--holo` (glass fill).
- Accents have roles: `--cyan` = chrome/links/borders, `--yellow` = the single primary action or current state, `--magenta` = section labels/secondary, `--sodium` = warm in-scene light only.
- Fonts: `--font-display` (Rajdhani) for headings and nav, `--font` (Source Sans 3) for body, `--mono` (IBM Plex Mono) for small labels and data.

## Rules
1. **Emphasis is scarce.** Glow (`box-shadow` neon), corner brackets and backdrop blur are for the primary elements (nav, interaction prompt). Secondary chips use a plain 1px border, no glow.
2. **Minimum text size 12px**, and 14px for anything a visitor must read (body, bullets). Uppercase + wide letter-spacing (>0.12em) only for labels of 3 words or fewer.
3. **Contrast**: body text >= 4.5:1 against the actual background (including the 3D scene behind glass). Don't use `rgb(234 252 255 / 0.5)` or lower for text.
4. **One component, one definition.** The glass chrome pattern is shared by `.nav`, `.hud-*`; change it in one place.
5. **Reduced motion**: respect `prefers-reduced-motion` for glitch, glow pulses and camera moves.
6. **Three surfaces must all look intentional**: the 3D city, `/resume`, and the `html.no-3d` flat page. Check all three after any change.

## Verify
`pnpm dev`, then `node scripts/shots-matrix.mjs` (screenshots at 375/768/1440 into `shots/`, gitignored). Look at the images, don't just trust the CSS.

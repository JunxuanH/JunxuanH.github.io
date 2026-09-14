# junxuanh.github.io

Ivan He's personal site — a walkable cyberpunk city, **Neon Harbor**, where each district holds part of the résumé. The nav pans the camera between districts; on arrival you take control of a character (WASD / touch joystick), walk up to the carriers — a campus terminal, a bus-stop poster, an LED wall, a blimp banner, a hologram, a market holo-stall with the project cards, a harbor departures board — and interact with them (E / tap). Astro 5 · three.js r186 (WebGPU + TSL, WebGL2 fallback) · GSAP.

- `pnpm dev` — dev server on :4321 (`?p=0.xx` pins the rail camera for screenshots, `?flat` forces the static page, `?q=high|med|low` picks the quality tier, `?prof` logs per-stage timings)
- `pnpm build` — static build to `dist/`, deployed by `.github/workflows/deploy.yml`
- `src/content.ts` — the résumé/projects content (scene slabs, `/resume`, and the PDF all read from it)
- `node scripts/resume-pdf.mjs` — regenerates `public/Ivan-He-Resume.pdf` from `/resume` (dev server must be running)
- `scripts/shot.mjs`, `scripts/fps.mjs`, `scripts/scrub.mjs` — headless screenshot / frame-time / hitch probes (Chrome for Testing with WebGPU)
- `design/` — generated concept art, receipts and the fal spend ledger (only the ledger, prompts and notes are tracked)

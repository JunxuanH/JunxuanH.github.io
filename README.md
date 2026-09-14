# junxuanh.github.io

Ivan He's personal site — a scroll-driven flight through a cyberpunk "Night City" where each district holds part of the résumé (campus terminal, downtown carriers, market holo stall, harbor departures board). Astro 5 · three.js r186 (WebGPU + TSL) · GSAP.

- `pnpm dev` — dev server on :4321 (`?p=0.xx` pins scroll progress, `?flat` forces the static page, `?q=high|med|low` picks the quality tier)
- `pnpm build` — static build to `dist/`, deployed by `.github/workflows/deploy.yml`
- `src/content.ts` — the résumé/projects content (scene slabs, `/resume`, and the PDF all read from it)
- `node scripts/resume-pdf.mjs` — regenerates `public/Ivan-He-Resume.pdf` from `/resume` (dev server must be running)
- `design/` — generated concept art, receipts and the fal spend ledger (not shipped)

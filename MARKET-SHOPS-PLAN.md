# Market shops: interaction and inventory plan

## Latest revision: inventory first and distinct products

- Owner interaction now opens inventory immediately. Talk is optional; conversation and item-detail Back buttons return to inventory.
- Three genuinely different products per shop, 18 items total, each with its own illustration. The former same-art variants below are superseded.
- Added two 1K Fal atlases with six items each, estimated $0.30 additional / $0.45 cumulative of the $5 item-art budget.
- Endpoint `fal-ai/nano-banana-pro/edit`; requests `01a0a7eb-5c49-74c2-a66d-b7476d3ca697` and `01a0a7eb-bf77-7c32-aeb7-98cda3b82275`.
- Originals: https://v3b.fal.media/files/b/0aaa98a9/DwMau06xd52XAqP2d1xYQ_JLq18aSp.webp and https://v3b.fal.media/files/b/0aaa98ac/AAxEBXO3Xhyf8oDogC8bv_0FbjCiFP.webp
- Local assets: `public/night/ads/market-items-atlas-2.webp` and `market-items-atlas-3.webp`.

## Immediate visual correction

- Move the ramen, drink and streetwear posters off the serving openings and onto the rear walls; reduce width from 2.4 to 1.75 units.
- Move each stall light inside, away from the front curtain, and reduce intensity from 140 to 35. Keep the neon signs readable without whitening the counter.
- Preserve the central project terminal and existing collision bounds.

## Interaction (implemented locally)

1. Approach a serving counter from the aisle. Show one `F / Talk to [owner]` prompt, with the same tap button on mobile. A shop interaction point at the counter takes priority over passing customers, but never steals the central terminal prompt.
2. Open a compact owner panel with `Talk`, `Browse items`, and `Leave`. Pause player movement, retain the current camera, and have the owner face the visitor within a limited angle. No camera zoom into the awning.
3. Talk offers two or three authored topics per owner: their products, local market lore, and a relevant project connection. Reuse existing talk/idle clips; no live AI, network dependency, or paid runtime service.
4. Browse shows 2–3 item cards per shop: large illustration, name, short description, and an owner remark. Select a card for a larger view. These are fictional showcase items, with no checkout, currency, or required collection mechanic.
5. Back returns to the owner menu; Escape/Leave closes it and restores movement/focus. Walking away, changing districts, and opening the résumé must cleanly dismiss the session.

## Initial inventory

| Shop | Featured item | Next variants |
| --- | --- | --- |
| Midnight Ramen | Night Shift Bowl | Chili Boost Bowl; Mushroom Broth |
| Patch / Repair | Link-6 repair module | Pocket Diagnostics; Cooling Kit |
| Neon Deck | Pocket Arcade | Rhythm Cartridge; Retro Controller |
| Synapse Audio | Quietline headphones | Neon Earbuds; Pocket Synth |
| Afterhours Gear | Foxfilter mask | Signal Jacket; Utility Gloves |
| Neo / Chroma | Citrus Static soda | Plum Frequency; Night Tea |

## Implementation structure

- Add a typed shop catalogue keyed by `MARKET_STALLS.kind`, with stable owner identities, dialogue topics and item records.
- Register the actual stationary vendors, not crowd walkers, as shop targets. Current `main.ts` vendors are rendered separately and are not registered in `dialogueTargets`; the screenshot's Talk prompt can belong to a nearby walker.
- Use a dedicated counter interaction anchor so the counter's collision doesn't prevent talking. Check front-side facing, distance, visibility, and active district.
- Extend the existing prompt arbitration and interaction ownership in `main.ts`; opening a shop must suppress resident dialogue and project-terminal input for that frame.
- Create one accessible DOM shop panel with touch-sized controls, focus containment/restoration, keyboard support and reduced-motion behaviour. Do not render small body text inside the 3D world.
- Reuse one six-cell item atlas for initial catalogue images and small rear-wall product displays. Use separate UV regions, not six duplicate GPU textures. Reuse existing meshes for physical stock; the new art is 2D, not generated 3D models.
- Keep vendors within the existing animation/light budgets. Lazy-load catalogue details; no additional full-scene shader or model warm-up.

## Acceptance checks

- Portrait-phone and desktop views: owner and goods visible, no panel across the opening, no white lighting hotspot.
- All six owners reachable across their counters; wandering customers never hijack the shop action.
- Central terminal remains immediately usable from the arrival position.
- Browse, item detail, Back, Escape and district switching work with mouse, keyboard and touch; no stuck player input or overlapping panels.
- Walk all customer routes and counter approaches; collision and gait tests continue passing.
- Verify WebGPU and WebGL fallback; no new console errors or failed artwork requests.

## Fal artwork / budget

- New cap: $5. One completed 1K generation, estimated $0.15; no additional jobs submitted.
- Endpoint: `fal-ai/nano-banana-pro/edit`.
- Request: `01a0a7d5-bc19-7370-afa0-48d43bcf097f`.
- Original: https://v3b.fal.media/files/b/0aaa981b/fjiCHfFcBTPVaj1XHXYrv_tGtbmA6C.webp
- Local: `public/night/ads/market-items-atlas.webp` (1264 × 848).
- Reading order: ramen, repair module, console; headphones, mask, soda. The interactive catalogue now uses this atlas; two product variants per shop deliberately share the same base illustration.

## Implementation status

- Six stationary owners registered, with counter-based approach checks and shop-first prompt arbitration.
- Two authored topics and two catalogue entries per shop; item detail and owner remarks.
- Native modal dialog provides focus containment, Escape/Leave and focus restoration. World movement is disabled while browsing.
- Existing collision/gait architecture retained; no new Fal generations or 3D models in this implementation pass.
- Build and market/world collision tests pass. Isolated browser checks cover menu, browse, detail and Escape/focus restoration. Full phone/world walkthrough remains to be checked on device.

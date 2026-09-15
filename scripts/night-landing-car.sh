#!/usr/bin/env bash
# Generate and web-optimize the live landing hovercar. The model is deliberately a single
# static GLB: Three.js supplies its hover, lights and launch motion at runtime.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT="design/night/landing-car"
PUB="public/night/models/landing-hovercar.glb"
mkdir -p "$OUT" "$(dirname "$PUB")"

cat > "$OUT/input.json" <<'JSON'
{
  "prompt": "A single premium cyberpunk hover coupe for a WebGL portfolio landing scene, rear three-quarter view. Low, wide, aerodynamic wedge body, four subtle levitation pods, dark graphite ceramic panels, a continuous magenta rear light bar, restrained cyan underglow, clean hard-surface manufacturing seams. No driver, no text, no logos, no street, no background, no pedestal, isolated object. Game-ready stylized realism, coherent wheels-or-hover-pods, balanced symmetrical silhouette, optimized medium-poly asset.",
  "generate_type": "LowPoly",
  "enable_pbr": true,
  "face_count": 40000,
  "polygon_type": "triangle"
}
JSON

# $0.60 includes PBR. The landing media workflow owns the $88 cap; the caller may raise it explicitly.
FAL_BUDGET="${FAL_BUDGET:-90}" scripts/fal-run.sh \
  fal-ai/hunyuan3d-v3/text-to-3d 0.60 night/landing-car/3d \
  "$OUT/input.json" "$OUT/model-raw.glb" '.model_glb.url'

# Keep the shipped asset modest; retain the raw source and response in design/ for provenance.
npx --yes @gltf-transform/cli dedup "$OUT/model-raw.glb" "$OUT/0.glb"
npx --yes @gltf-transform/cli prune "$OUT/0.glb" "$OUT/1.glb"
npx --yes @gltf-transform/cli resize --width 1024 --height 1024 "$OUT/1.glb" "$OUT/2.glb"
npx --yes @gltf-transform/cli webp "$OUT/2.glb" "$OUT/3.glb" || cp "$OUT/2.glb" "$OUT/3.glb"
npx --yes @gltf-transform/cli draco "$OUT/3.glb" "$PUB"
echo "$PUB ($(du -h "$PUB" | cut -f1))"

#!/usr/bin/env bash
# Night City character pipeline: concept image → Hunyuan3D v3 (GLB) → optional Meshy auto-rig with
# walk/run (+ one idle clip) → optional extra Meshy clips → slimmed GLBs under public/night/characters/<name>/.
#
# Usage: scripts/night-character.sh <name> <concept.png> [--type LowPoly|Normal] [--rig] [--idle <meshyId>]
#                                   [--clips talk=308,wave=28] [--clips-replace-rig] [--height 1.75]
#                                   [--skip-3d] [--model-url <url|file.glb>] [--no-slim]
#   e.g. scripts/night-character.sh netrunner design/night/characters/netrunner/concept-1.png --rig --idle 0
#        scripts/night-character.sh drone-police design/night/characters/drone-police/concept-1.png --type Normal
#        scripts/night-character.sh vendor x.png --skip-3d --model-url design/night/characters/vendor/model-raw.glb \
#            --clips idle=12,talk=313,wave=28 --clips-replace-rig      # extra clips on an existing character
#
# --clips: Meshy animation-library ids (docs.meshy.ai/en/api/animation-library), optionally labelled
#   `label=id`; each clip ships as public/…/<label>.glb (armature-only, ~40–70 KB) so the runtime clip key
#   is the label (stalls ask for talk / wave / idle). The multi-animation endpoint re-rigs the mesh and
#   returns a NEW rig with its own walk/run: --clips-replace-rig ships that rig (rigged/walk/run) instead
#   of the one from --rig, so all clips share one skeleton (audit again afterwards: rigs.ts numbers move).
#
# Prices (verified on fal model pages 2026-09-13): Hunyuan3D v3 LowPoly $0.45 / Normal $0.375, +$0.15 PBR;
# Meshy rigging $0.20 (+$0.12 with one animation clip); Meshy multi-animation $0.20 + $0.12 per clip.
# Every fal call goes through scripts/fal-run.sh (ledger design/fal-spend.log, cap FAL_BUDGET).
# Raw downloads + fal responses live in design/night/characters/<name>/ (not shipped).
set -euo pipefail
cd "$(dirname "$0")/.."

NAME="${1:?name}"; CONCEPT="${2:?concept.png}"; shift 2
TYPE=LowPoly; RIG=0; IDLE=0; CLIPS=""; CLIPS_REPLACE=0; HEIGHT=1.75; SKIP3D=0; SLIM=1; MODEL_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --type) TYPE="$2"; shift 2 ;;
    --model-url) MODEL_OVERRIDE="$2"; shift 2 ;;   # URL or local .glb (sent as a data URI) — e.g. after an OBJ→GLB conversion
    --rig) RIG=1; shift ;;
    --idle) IDLE="$2"; shift 2 ;;
    --clips) CLIPS="$2"; shift 2 ;;
    --clips-replace-rig) CLIPS_REPLACE=1; shift ;;
    --height) HEIGHT="$2"; shift 2 ;;
    --skip-3d) SKIP3D=1; shift ;;
    --no-slim) SLIM=0; shift ;;
    *) echo "unknown arg $1" >&2; exit 1 ;;
  esac
done

DES="design/night/characters/$NAME"; PUB="public/night/characters/$NAME"
mkdir -p "$DES" "$PUB"
GT="npx --yes @gltf-transform/cli"
ids=()

# ---------- 1. image → 3D ----------
if [[ $SKIP3D == 0 ]]; then
  python3 - "$CONCEPT" "$DES/3d-input.json" "$TYPE" <<'EOF'
import sys, base64, json, io
from PIL import Image
src, out, typ = sys.argv[1:4]
im = Image.open(src).convert('RGB')
buf = io.BytesIO(); im.save(buf, 'JPEG', quality=90)
body = {'input_image_url': 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(),
        'generate_type': typ, 'enable_pbr': True, 'face_count': 40000}
if typ == 'LowPoly': body['polygon_type'] = 'triangle'
json.dump(body, open(out, 'w'))
EOF
  PRICE=$([[ "$TYPE" == LowPoly ]] && echo 0.60 || echo 0.525)
  OUT3D="$(scripts/fal-run.sh fal-ai/hunyuan3d-v3/image-to-3d "$PRICE" "night/char/$NAME/3d" "$DES/3d-input.json" "$DES/model-raw.glb" '.model_glb.url')" || {
    # fal-run exits non-zero without logging spend; surface fal's error (e.g. downstream_service_unavailable) and stop.
    echo "3D step failed for $NAME: $(jq -r '.detail // . | tostring' "$DES/model-raw.response.json" 2>/dev/null | head -c 300)" >&2; exit 1; }
  echo "$OUT3D"; ids+=("3d=$(grep -o 'queued: [^ ]*' <<<"$OUT3D" | cut -d' ' -f2)")
  jq -r '.thumbnail.url // empty' "$DES/model-raw.response.json" | { read -r u || true; [[ -n "${u:-}" ]] && curl -sSL -o "$DES/thumbnail.png" "$u" || true; }
fi

# MODEL_URL is either a short https URL or "file:<path>" — a local GLB is turned into a data URI
# inside python (a multi-MB string can't go through argv/env: ARG_MAX).
if [[ -n "$MODEL_OVERRIDE" ]]; then
  if [[ -f "$MODEL_OVERRIDE" ]]; then MODEL_URL="file:$MODEL_OVERRIDE"; else MODEL_URL="$MODEL_OVERRIDE"; fi
else
  MODEL_URL="$(jq -r '.model_glb.url // empty' "$DES/model-raw.response.json")"
  [[ "$MODEL_URL" == http* ]] || { echo "no model_glb.url in $DES/model-raw.response.json: $(jq -c '.detail // .' "$DES/model-raw.response.json" | head -c 300)" >&2; exit 1; }
  # Hunyuan3D occasionally returns an OBJ zip in model_glb; convert it before rigging (see README).
  if [[ "$(jq -r '.model_glb.file_name // ""' "$DES/model-raw.response.json")" == *.obj ]]; then
    echo "NOTE: $NAME came back as an OBJ zip — unzip, run obj2gltf, then re-run with --skip-3d --model-url <glb> --rig" >&2
  fi
fi

# ---------- 2. Meshy auto-rig (+ walk/run basics, + one idle clip) ----------
if [[ $RIG == 1 ]]; then
  python3 - "$DES/rig-input.json" "$MODEL_URL" "$HEIGHT" "$IDLE" <<'EOF'
import json, sys, base64
out, url, height, idle = sys.argv[1:5]
if url.startswith('file:'):
    url = 'data:model/gltf-binary;base64,' + base64.b64encode(open(url[5:], 'rb').read()).decode()
json.dump({'model_url': url, 'height_meters': float(height), 'enable_animation': True, 'animation_action_id': int(idle)}, open(out, 'w'))
EOF
  OUTRIG="$(scripts/fal-run.sh fal-ai/meshy/rigging 0.32 "night/char/$NAME/rig" "$DES/rig-input.json" "$DES/rigged-raw.glb" '.rigged_character_glb.url')"
  echo "$OUTRIG"; ids+=("rig=$(grep -o 'queued: [^ ]*' <<<"$OUTRIG" | cut -d' ' -f2)")
  R="$DES/rigged-raw.response.json"
  dl() { local u; u="$(jq -r "$1 // empty" "$R")"; [[ -n "$u" ]] && curl -sSL -o "$2" "$u" && echo "  $2 ($(du -h "$2" | cut -f1))" || echo "  (no $1)"; }
  dl '.basic_animations.walking_armature_glb.url' "$DES/walk-armature-raw.glb"
  dl '.basic_animations.running_armature_glb.url' "$DES/run-armature-raw.glb"
  dl '.basic_animations.walking_glb.url' "$DES/walk-raw.glb"
  dl '.basic_animations.running_glb.url' "$DES/run-raw.glb"
  dl '.animation_glb.url' "$DES/idle-raw.glb"
fi

# ---------- 3. extra Meshy clips (multi-animation: $0.20 + $0.12 per clip) ----------
CLIP_LABELS=()
has_label() { local l; for l in "${CLIP_LABELS[@]:-}"; do [[ "$l" == "$1" ]] && return 0; done; return 1; }
if [[ -n "$CLIPS" ]]; then
  # "label=id,label=id" or bare ids (label = clip-<id>)
  CLIP_IDS=()
  for spec in $(tr ',' ' ' <<<"$CLIPS"); do
    if [[ "$spec" == *=* ]]; then CLIP_LABELS+=("${spec%%=*}"); CLIP_IDS+=("${spec#*=}"); else CLIP_LABELS+=("clip-$spec"); CLIP_IDS+=("$spec"); fi
  done
  N="${#CLIP_IDS[@]}"
  PRICE="$(awk -v n="$N" 'BEGIN {printf "%.2f", 0.20 + 0.12 * n}')"
  python3 - "$DES/clips-input.json" "$MODEL_URL" "$HEIGHT" "$(IFS=,; echo "${CLIP_IDS[*]}")" <<'EOF'
import json, sys, base64
out, url, height, clips = sys.argv[1:5]
if url.startswith('file:'):
    url = 'data:model/gltf-binary;base64,' + base64.b64encode(open(url[5:], 'rb').read()).decode()
json.dump({'model_url': url, 'height_meters': float(height), 'animation_action_ids': [int(x) for x in clips.split(',') if x]}, open(out, 'w'))
EOF
  OUTC="$(scripts/fal-run.sh fal-ai/meshy/rigging/multi-animation "$PRICE" "night/char/$NAME/clips" "$DES/clips-input.json" "$DES/clips-rigged-raw.glb" '.rigged_character_glb.url')"
  echo "$OUTC"; ids+=("clips=$(grep -o 'queued: [^ ]*' <<<"$OUTC" | cut -d' ' -f2)")
  RC="$DES/clips-rigged-raw.response.json"
  for ((i = 0; i < N; i++)); do
    u="$(jq -r ".animations[$i].animation_glb.url // empty" "$RC")"
    [[ -n "$u" ]] && curl -sSL -o "$DES/${CLIP_LABELS[$i]}-raw.glb" "$u" && echo "  clip ${CLIP_LABELS[$i]} (id ${CLIP_IDS[$i]}, $(du -h "$DES/${CLIP_LABELS[$i]}-raw.glb" | cut -f1))"
  done
  if [[ $CLIPS_REPLACE == 1 ]]; then
    # The clips live on the multi-animation rig: ship that rig and its walk/run so every clip shares one skeleton.
    [[ -f "$DES/rigged-raw.glb" ]] && mv "$DES/rigged-raw.glb" "$DES/rigged-raw.prev.glb"
    cp "$DES/clips-rigged-raw.glb" "$DES/rigged-raw.glb"
    dlc() { local u; u="$(jq -r "$1 // empty" "$RC")"; [[ -n "$u" ]] && curl -sSL -o "$2" "$u" && echo "  $2 ($(du -h "$2" | cut -f1))" || echo "  (no $1)"; }
    # Meshy's basic walking/running come with every rig; a labelled walk=/run= clip from the library replaces them
    # (the basic ones are still downloaded as walk-basic/run-basic for reference, not shipped).
    if has_label walk; then dlc '.basic_animations.walking_armature_glb.url' "$DES/walk-basic-armature-raw.glb"; [[ -f "$DES/walk-armature-raw.glb" ]] && mv "$DES/walk-armature-raw.glb" "$DES/walk-armature-raw.prev.glb"
    else dlc '.basic_animations.walking_armature_glb.url' "$DES/walk-armature-raw.glb"; fi
    if has_label run; then dlc '.basic_animations.running_armature_glb.url' "$DES/run-basic-armature-raw.glb"; [[ -f "$DES/run-armature-raw.glb" ]] && mv "$DES/run-armature-raw.glb" "$DES/run-armature-raw.prev.glb"
    else dlc '.basic_animations.running_armature_glb.url' "$DES/run-armature-raw.glb"; fi
    # An idle from the earlier --rig call would be on the previous skeleton: keep it only when re-requested here.
    if ! has_label idle; then [[ -f "$DES/idle-raw.glb" ]] && mv "$DES/idle-raw.glb" "$DES/idle-raw.prev.glb"; fi
  fi
fi

# ---------- 4. slim → public ----------
slim() { # in out : dedup → resample (animation keyframes) → prune → 1K textures → webp → draco
  local t; t="$(mktemp -d)"
  $GT dedup "$1" "$t/0.glb" >/dev/null 2>&1
  $GT resample "$t/0.glb" "$t/1.glb" >/dev/null 2>&1 || cp "$t/0.glb" "$t/1.glb"
  $GT prune "$t/1.glb" "$t/2.glb" >/dev/null 2>&1
  $GT resize --width 1024 --height 1024 "$t/2.glb" "$t/3.glb" >/dev/null 2>&1
  $GT webp "$t/3.glb" "$t/4.glb" >/dev/null 2>&1 || cp "$t/3.glb" "$t/4.glb"
  $GT draco "$t/4.glb" "$2" >/dev/null 2>&1
  rm -rf "$t"
  echo "  $2 ($(du -h "$2" | cut -f1))"
}
files=()
if [[ $SLIM == 1 ]]; then
  echo "slimming:"
  [[ -f "$DES/model-raw.glb" ]] && slim "$DES/model-raw.glb" "$PUB/model.glb" && files+=(model.glb)
  [[ -f "$DES/rigged-raw.glb" ]] && slim "$DES/rigged-raw.glb" "$PUB/rigged.glb" && files+=(rigged.glb)
  if ! has_label walk; then [[ -f "$DES/walk-armature-raw.glb" ]] && slim "$DES/walk-armature-raw.glb" "$PUB/walk.glb" && files+=(walk.glb); fi
  if ! has_label run; then [[ -f "$DES/run-armature-raw.glb" ]] && slim "$DES/run-armature-raw.glb" "$PUB/run.glb" && files+=(run.glb); fi
  if ! has_label idle; then [[ -f "$DES/idle-raw.glb" ]] && slim "$DES/idle-raw.glb" "$PUB/idle.glb" && files+=(idle.glb); fi
  # Labelled clips (full-model GLBs from multi-animation, idle included): strip the mesh → armature-only, then slim.
  for label in "${CLIP_LABELS[@]:-}"; do
    [[ -z "$label" ]] && continue # (bash 3.2 + set -u: an empty array expands to "")
    f="$DES/$label-raw.glb"; [[ -f "$f" ]] || continue
    t="$(mktemp -d)"; node scripts/night-strip-mesh.mjs "$f" "$t/arm.glb" >/dev/null 2>&1 || cp "$f" "$t/arm.glb"
    slim "$t/arm.glb" "$PUB/$label.glb" && files+=("$label.glb"); rm -rf "$t"
  done
fi

# ---------- 5. meta ----------
jq -n --arg name "$NAME" --arg type "$TYPE" --argjson height "$HEIGHT" --arg ids "${ids[*]:-}" \
  --argjson files "$(printf '%s\n' "${files[@]:-}" | jq -R . | jq -s 'map(select(length>0))')" \
  --arg concept "$(basename "$CONCEPT")" --arg idle "$IDLE" --arg clips "$CLIPS" \
  '{name: $name, generate_type: $type, height_meters: $height, concept: $concept, fal_requests: $ids, files: $files,
    meshy_idle: (if $idle == "" then null else ($idle | tonumber) end), meshy_clips: $clips, generated: (now | todate)}' \
  > "$PUB/meta.json"
cat "$PUB/meta.json"

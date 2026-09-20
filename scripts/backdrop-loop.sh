#!/usr/bin/env bash
# Animate the far skyline plate: a seamless ~5 s Kling O1 loop conditioned on the shipped plate as both start and end
# frame. Same shape as billboard-loop.sh.
#
# NOT WIRED UP. Take 3 shipped on 2026-09-20 and came straight back out: the clip encodes at 1280 px against a 2048 px
# painting and the softness cost more than the blinking beacons bought. backdrop.ts draws the still. Keep this script
# for the next attempt — which wants a sharper encode (or a model that returns the plate's own resolution) before the
# VideoTexture swap is worth restoring.
# Usage: scripts/backdrop-loop.sh gen [take=1] [open]       # $0.56 → design/night/plates/backdrop-loop-<take>.mp4 (gitignored)
#        scripts/backdrop-loop.sh encode <raw.mp4> [w=1280] # → public/night/backdrop/aerial-loop.mp4 (≤ 2 MB)
#
# `open` drops the end frame. Conditioning on the same image at both ends is what makes a clip loop, but it also
# forbids any motion that does not return to where it started: take 1 answered it by freezing the clouds outright
# (sky pixels moved by 1.1 of 255 across 2.5 s). Without the end frame the clouds actually drift, and the encoder
# closes the loop instead, by crossfading the tail back over the head.
# Prompt: design/night/prompts/backdrop-loop.txt (edit and re-run `gen 2` to retry).
# Frame: design/night/plates/aerial-loop-frame.png — the SHIPPED plate (public/night/backdrop/aerial.webp) exported to
# PNG, so the first video frame and the still the scene already draws are the same image. Re-export it if the plate
# changes, or the crossfade between still and video will show. FAL_KEY from .env.local via fal-run.sh.
# The file must not be named with "pano" or "depth": scripts/panel-edge-check.mjs fails any backdrop URL containing those.
set -euo pipefail
cd "$(dirname "$0")/.."
CMD="${1:?gen|encode}"
PLATES=design/night/plates; FRAME=$PLATES/aerial-loop-frame.png; PROMPT=design/night/prompts/backdrop-loop.txt
MODEL=fal-ai/kling-video/o1/image-to-video; PRICE=0.56
export FAL_BUDGET="${FAL_BUDGET:-100}"

if [[ $CMD == gen ]]; then
  TAKE="${2:-1}"; MODE="${3:-loop}"
  if [[ -z "${FAL_KEY:-}" && -f .env.local ]]; then FAL_KEY="$(grep -E '^FAL_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"; fi
  [[ -n "${FAL_KEY:-}" ]] || { echo "FAL_KEY not set" >&2; exit 1; }
  export FAL_KEY
  sha="$(shasum -a 256 "$FRAME" | cut -c1-64)"; cache="${FRAME%.png}.url"
  if [[ -f "$cache" && "$(cut -f1 "$cache")" == "$sha" ]]; then URL="$(cut -f2 "$cache")"; else
    init="$(curl -sS --fail-with-body -X POST "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3" \
      -H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json" -d '{"content_type":"image/png","file_name":"aerial-loop-frame.png"}')"
    up="$(jq -r '.upload_url' <<<"$init")"; URL="$(jq -r '.file_url' <<<"$init")"
    curl -sS --fail-with-body -X PUT "$up" -H "Content-Type: image/png" --data-binary "@$FRAME" >/dev/null
    printf '%s\t%s\n' "$sha" "$URL" > "$cache"
  fi
  INPUT=$PLATES/backdrop-loop-$TAKE.input.json
  if [[ $MODE == open ]]; then
    jq -n --rawfile p "$PROMPT" --arg u "$URL" '{prompt: ($p | rtrimstr("\n")), start_image_url: $u, duration: "5"}' > "$INPUT"
  else
    jq -n --rawfile p "$PROMPT" --arg u "$URL" '{prompt: ($p | rtrimstr("\n")), start_image_url: $u, end_image_url: $u, duration: "5"}' > "$INPUT"
  fi
  scripts/fal-run.sh "$MODEL" "$PRICE" "night/plates/backdrop-loop-$TAKE" "$INPUT" "$PLATES/backdrop-loop-$TAKE.mp4" '.video.url'
elif [[ $CMD == encode ]]; then
  RAW="${2:?raw.mp4}"; W="${3:-1280}"; OUT=public/night/backdrop/aerial-loop.mp4
  # Height follows the plate's own aspect (the panel UVs map the video and the still the same way).
  H="$(python3 -c "import sys;from PIL import Image;im=Image.open('$FRAME');print(round($W*im.height/im.width/2)*2)")"
  for crf in 26 28 30 32 34; do
    /opt/homebrew/bin/ffmpeg -v error -y -i "$RAW" -vf "scale=$W:$H:flags=lanczos,format=yuv420p" -r 24 -c:v libx264 -preset slow -crf "$crf" -profile:v high \
      -g 24 -keyint_min 24 -sc_threshold 0 -movflags +faststart -an "$OUT"
    size="$(stat -f%z "$OUT")"; [[ $size -le 2000000 ]] && break
    echo "$size bytes at crf $crf, retrying tighter" >&2
  done
  echo "$OUT  $((size / 1024)) KB  crf $crf  ${W}x${H}  $(/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s"
else
  echo "unknown command $CMD" >&2; exit 1
fi

#!/usr/bin/env bash
# Animate the tower's SHELLWORKS billboard: a seamless ~5 s Kling O1 loop from the static panel (same image as start and
# end frame), then an H.264 loop for cutscene-free playback in the billboard's LED material (bay.ts `{ image, video }`).
# Usage: scripts/billboard-loop.sh gen [take=1]          # $0.56 → design/night/ads/billboard-loop-<take>.mp4 (gitignored)
#        scripts/billboard-loop.sh encode <raw.mp4> [w=1280]  # → public/night/ads/billboard-shellworks-loop.mp4 (≤ 1.5 MB)
# Prompt: design/night/prompts/billboard-loop.txt (edit and re-run `gen 2` to retry). Panel: design/night/ads/billboard-shellworks-panel.png
# (the 2048×1024 face; frames-style .url cache next to it). FAL_KEY from .env.local via fal-run.sh.
set -euo pipefail
cd "$(dirname "$0")/.."
CMD="${1:?gen|encode}"
ADS=design/night/ads; PANEL=$ADS/billboard-shellworks-panel.png; PROMPT=design/night/prompts/billboard-loop.txt
MODEL=fal-ai/kling-video/o1/image-to-video; PRICE=0.56
export FAL_BUDGET="${FAL_BUDGET:-75}"

if [[ $CMD == gen ]]; then
  TAKE="${2:-1}"
  if [[ -z "${FAL_KEY:-}" && -f .env.local ]]; then FAL_KEY="$(grep -E '^FAL_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"; fi
  [[ -n "${FAL_KEY:-}" ]] || { echo "FAL_KEY not set" >&2; exit 1; }
  export FAL_KEY
  sha="$(shasum -a 256 "$PANEL" | cut -c1-64)"; cache="${PANEL%.png}.url"
  if [[ -f "$cache" && "$(cut -f1 "$cache")" == "$sha" ]]; then URL="$(cut -f2 "$cache")"; else
    init="$(curl -sS --fail-with-body -X POST "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3" \
      -H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json" -d '{"content_type":"image/png","file_name":"billboard-shellworks-panel.png"}')"
    up="$(jq -r '.upload_url' <<<"$init")"; URL="$(jq -r '.file_url' <<<"$init")"
    curl -sS --fail-with-body -X PUT "$up" -H "Content-Type: image/png" --data-binary "@$PANEL" >/dev/null
    printf '%s\t%s\n' "$sha" "$URL" > "$cache"
  fi
  INPUT=$ADS/billboard-loop-$TAKE.input.json
  jq -n --rawfile p "$PROMPT" --arg u "$URL" '{prompt: ($p | rtrimstr("\n")), start_image_url: $u, end_image_url: $u, duration: "5"}' > "$INPUT"
  scripts/fal-run.sh "$MODEL" "$PRICE" "night/ads/billboard-loop-$TAKE" "$INPUT" "$ADS/billboard-loop-$TAKE.mp4" '.video.url'
elif [[ $CMD == encode ]]; then
  RAW="${2:?raw.mp4}"; W="${3:-1280}"; H=$((W / 2)); OUT=public/night/ads/billboard-shellworks-loop.mp4
  for crf in 26 28 30 32; do
    /opt/homebrew/bin/ffmpeg -v error -y -i "$RAW" -vf "scale=$W:$H:flags=lanczos,format=yuv420p" -r 30 -c:v libx264 -preset slow -crf "$crf" -profile:v high \
      -g 30 -keyint_min 30 -sc_threshold 0 -movflags +faststart -an "$OUT"
    size="$(stat -f%z "$OUT")"; [[ $size -le 1500000 ]] && break
    echo "$size bytes at crf $crf, retrying tighter" >&2
  done
  echo "$OUT  $((size / 1024)) KB  crf $crf  $(/opt/homebrew/bin/ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s"
else
  echo "unknown command $CMD" >&2; exit 1
fi

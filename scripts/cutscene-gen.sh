#!/usr/bin/env bash
# Generate one video cutscene with Kling O1 (first → last frame) between two sections' establishing frames.
# Usage: scripts/cutscene-gen.sh <from> <to> [dur=5]
#   e.g. scripts/cutscene-gen.sh city education
# Frames come from scripts/cutscene-frames.mjs (design/night/cutscenes/frames/<id>.png); each is uploaded to the fal
# CDN once (frames/<id>.url caches the url keyed by the png's sha). The prompt lives in
# design/night/prompts/cutscene-<from>-<to>.txt (created from the template below on first run — edit and re-run to
# retry). The raw mp4 lands in design/night/cutscenes/raw/<from>-<to>.mp4 (gitignored; scripts/cutscene-encode.sh
# publishes it) and the run is appended to design/night/cutscenes/ledger.tsv. Spend is logged by fal-run.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

FROM="${1:?from}"; TO="${2:?to}"; DUR="${3:-5}"
MODEL=fal-ai/kling-video/o1/image-to-video
PRICE="$(awk -v d="$DUR" 'BEGIN {printf "%.2f", 0.112 * d}')"
export FAL_BUDGET="${FAL_BUDGET:-75}"
DIR=design/night/cutscenes; FRAMES=$DIR/frames; RAW=$DIR/raw; PROMPTS=design/night/prompts; LEDGER=$DIR/ledger.tsv
PAIR="$FROM-$TO"

for id in "$FROM" "$TO"; do [[ -f "$FRAMES/$id.png" ]] || { echo "missing frame $FRAMES/$id.png (run scripts/cutscene-frames.mjs)" >&2; exit 1; }; done
[[ "$FROM" != "$TO" ]] || { echo "from and to must differ" >&2; exit 1; }

if [[ -z "${FAL_KEY:-}" && -f .env.local ]]; then
  FAL_KEY="$(grep -E '^FAL_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi
[[ -n "${FAL_KEY:-}" ]] || { echo "FAL_KEY not set (env or .env.local)" >&2; exit 1; }
export FAL_KEY

# ---- frames → fal CDN (once per png content)
upload() {
  local id="$1" png="$FRAMES/$1.png" cache="$FRAMES/$1.url" sha init up url
  sha="$(shasum -a 256 "$png" | cut -c1-64)"
  if [[ -f "$cache" && "$(cut -f1 "$cache")" == "$sha" ]]; then cut -f2 "$cache"; return; fi
  init="$(curl -sS --fail-with-body -X POST "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3" \
    -H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json" \
    -d "{\"content_type\":\"image/png\",\"file_name\":\"cutscene-$id.png\"}")"
  up="$(jq -r '.upload_url' <<<"$init")"; url="$(jq -r '.file_url' <<<"$init")"
  [[ "$up" != "null" && "$url" != "null" ]] || { echo "upload initiate failed: $init" >&2; return 1; }
  curl -sS --fail-with-body -X PUT "$up" -H "Content-Type: image/png" --data-binary "@$png" >/dev/null
  printf '%s\t%s\n' "$sha" "$url" > "$cache"
  echo "$url"
}

# ---- prompt: template + a per-pair route from the vantage table (edit the file to steer a retry)
vantage() {
  case "$1" in
    city) echo "the bay vista over the bridge toward the skyline" ;;
    education) echo "the campus plaza with the torii gate and the terminal kiosk" ;;
    work) echo "the downtown neon avenue with the bus shelter and the media tower" ;;
    projects) echo "the night-market street with the holo stall" ;;
    contact) echo "the harbor pier with the departures board and the landed hover car" ;;
    *) echo "unknown section $1" >&2; return 1 ;;
  esac
}
# World anchors (x, z; −z is north) for a compass heading in the route text.
anchor() {
  case "$1" in
    city) echo "0 250" ;; education) echo "-80 -102" ;; work) echo "0 -140" ;; projects) echo "50 -228" ;; contact) echo "140 20" ;;
  esac
}
heading() {
  awk -v a="$(anchor "$1")" -v b="$(anchor "$2")" 'BEGIN {
    split(a, A, " "); split(b, B, " "); dx = B[1] - A[1]; dz = -(B[2] - A[2]);
    ang = atan2(dx, dz) * 180 / 3.14159265; if (ang < 0) ang += 360;
    split("north,north-east,east,south-east,south,south-west,west,north-west", N, ",");
    print N[int((ang + 22.5) / 45) % 8 + 1] }'
}
PROMPT="$PROMPTS/cutscene-$PAIR.txt"
if [[ ! -f "$PROMPT" ]]; then
  mkdir -p "$PROMPTS"
  ROUTE="The camera lifts away from $(vantage "$FROM"), glides $(heading "$FROM" "$TO") over the wet rooftops through the rain, then descends and settles on $(vantage "$TO")."
  cat > "$PROMPT" <<PROMPT_EOF
Cinematic drone shot through a rain-soaked cyberpunk city at night. Start exactly on @Image1 and end exactly on @Image2. $ROUTE Cyan, magenta and yellow neon, wet asphalt reflections, light rain, thin haze, hover cars with light trails, holographic billboards. One continuous smooth camera move, no cuts, steady speed, gentle banking. No text, no readable letters or logos, no faces, no people near the camera, no camera shake, no flicker.
PROMPT_EOF
  echo "wrote $PROMPT"
fi
PROMPT_SHA="$(shasum -a 256 "$PROMPT" | cut -c1-8)"

START_URL="$(upload "$FROM")"; END_URL="$(upload "$TO")"
mkdir -p "$RAW"
INPUT="$RAW/$PAIR.input.json"
jq -n --rawfile p "$PROMPT" --arg s "$START_URL" --arg e "$END_URL" --arg d "$DUR" \
  '{prompt: ($p | rtrimstr("\n")), start_image_url: $s, end_image_url: $e, duration: $d}' > "$INPUT"

echo "$PAIR: $MODEL ${DUR}s \$$PRICE (prompt $PROMPT_SHA)"
OUT="$RAW/$PAIR.mp4"
LOG="$(scripts/fal-run.sh "$MODEL" "$PRICE" "night/cutscene/$PAIR" "$INPUT" "$OUT" '.video.url' | tee /dev/stderr)"
REQ="$(sed -n 's/^queued: //p' <<<"$LOG" | head -1)"
printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$PAIR" "$MODEL" "$DUR" "${REQ:-?}" "$PROMPT_SHA" >> "$LEDGER"
printf '%s\t%s\t%s\t%s\n' "$PAIR" "$MODEL" "${REQ:-?}" "$PROMPT_SHA" > "$RAW/$PAIR.request" # provenance sidecar for cutscene-encode.sh
echo "$OUT · request ${REQ:-?} · ledger $LEDGER"

#!/usr/bin/env bash
# Generic fal.ai queue runner for non-image endpoints (world models, depth, background removal…).
# Usage: scripts/fal-run.sh <endpoint> <price> <label> <input.json> <out_file> [jq_url_path]
#   e.g. scripts/fal-run.sh fal-ai/hunyuan_world/image-to-world 0.30 world design/plates/world-input.json design/plates/world.zip
#        scripts/fal-run.sh fal-ai/hunyuan3d-v3/image-to-3d 0.525 night/tower-a in.json out.glb '.model_glb.url'
# Submits to the fal queue, polls until done, downloads the url selected by jq_url_path (default: the
# first "url" anywhere in the response), logs spend to design/fal-spend.log (same ledger as
# fal-image.sh) and saves the raw response next to the output so other files can be fetched later:
#   jq -r '.rigged_character_glb.url' out.response.json | xargs curl -sSL -o rigged.glb
set -euo pipefail
cd "$(dirname "$0")/.."

ENDPOINT="$1"; PRICE="$2"; LABEL="$3"; INPUT="$4"; OUT="$5"
JQ_URL="${6:-[.. | objects | select(has(\"url\")) | .url] | first // empty}"
# Running total the ledger may not exceed, in dollars. Raised to 100 by Ivan on 2026-09-20.
BUDGET="${FAL_BUDGET:-100}"
LOG=design/fal-spend.log

if [[ -z "${FAL_KEY:-}" && -f .env.local ]]; then
  FAL_KEY="$(grep -E '^FAL_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi
[[ -n "${FAL_KEY:-}" ]] || { echo "FAL_KEY not set (env or .env.local)" >&2; exit 1; }

SPENT="$(awk -F'\t' '{s+=$3} END {printf "%.2f", s+0}' "$LOG" 2>/dev/null || echo 0)"
if awk -v s="$SPENT" -v c="$PRICE" -v b="$BUDGET" 'BEGIN {exit !(s+c>b)}'; then
  echo "Refusing: spent \$$SPENT + \$$PRICE would exceed \$$BUDGET budget" >&2; exit 1
fi

AUTH=(-H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json")
SUBMIT="$(curl -sS --fail-with-body -X POST "https://queue.fal.run/$ENDPOINT" "${AUTH[@]}" --data-binary "@$INPUT")"
STATUS_URL="$(jq -r '.status_url' <<<"$SUBMIT")"
RESPONSE_URL="$(jq -r '.response_url' <<<"$SUBMIT")"
[[ "$STATUS_URL" != "null" ]] || { echo "Submit failed: $SUBMIT" >&2; exit 1; }
echo "queued: $(jq -r '.request_id' <<<"$SUBMIT")"

for _ in $(seq 1 360); do
  ST="$(curl -sS "$STATUS_URL" "${AUTH[@]}")"
  S="$(jq -r '.status' <<<"$ST")"
  case "$S" in
    COMPLETED) break ;;
    IN_QUEUE|IN_PROGRESS) sleep 5 ;;
    *) echo "Failed: $ST" >&2; exit 1 ;;
  esac
done
[[ "$S" == "COMPLETED" ]] || { echo "Timed out waiting for $ENDPOINT" >&2; exit 1; }

RESP="$(curl -sS "$RESPONSE_URL" "${AUTH[@]}")"
mkdir -p "$(dirname "$OUT")"
echo "$RESP" > "${OUT%.*}.response.json"
URL="$(jq -r "$JQ_URL" <<<"$RESP")"
# A fal error body ({"detail": …}) has no url: fail here (nothing is logged) instead of curl-ing "null".
[[ -n "$URL" && "$URL" != "null" ]] || { echo "No url in response ($ENDPOINT): $(jq -c '.detail // .' <<<"$RESP" | head -c 400)" >&2; exit 1; }
curl -sS -L -o "$OUT" "$URL"
printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$ENDPOINT" "$PRICE" "$LABEL" >> "$LOG"
echo "$OUT ($(du -h "$OUT" | cut -f1)) · logged \$$PRICE · total \$$(awk -F'\t' '{s+=$3} END {printf "%.2f", s}' "$LOG") of \$$BUDGET"

#!/usr/bin/env bash
# Generate images with fal.ai and log spend.
# Usage: scripts/fal-image.sh <endpoint> <price_per_image> <out_prefix> <prompt_file> [extra_json]
#   e.g. scripts/fal-image.sh fal-ai/nano-banana-pro 0.15 design/concepts/compositor design/prompts/compositor.txt '{"aspect_ratio":"16:9","resolution":"2K"}'
# Reads FAL_KEY from the environment or .env.local. Appends every run to design/fal-spend.log.
set -euo pipefail
cd "$(dirname "$0")/.."

ENDPOINT="$1"; PRICE="$2"; OUT="$3"; PROMPT_FILE="$4"; EXTRA="${5:-{\}}"
BUDGET="${FAL_BUDGET:-15}"
LOG=design/fal-spend.log

if [[ -z "${FAL_KEY:-}" && -f .env.local ]]; then
  FAL_KEY="$(grep -E '^FAL_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
fi
[[ -n "${FAL_KEY:-}" ]] || { echo "FAL_KEY not set (env or .env.local)" >&2; exit 1; }

N="$(jq -r '.num_images // 1' <<<"$EXTRA")"
SPENT="$(awk -F'\t' '{s+=$3} END {printf "%.2f", s+0}' "$LOG" 2>/dev/null || echo 0)"
COST="$(awk -v p="$PRICE" -v n="$N" 'BEGIN {printf "%.2f", p*n}')"
if awk -v s="$SPENT" -v c="$COST" -v b="$BUDGET" 'BEGIN {exit !(s+c>b)}'; then
  echo "Refusing: spent \$$SPENT + \$$COST would exceed \$$BUDGET budget" >&2; exit 1
fi

BODY="$(jq -n --rawfile p "$PROMPT_FILE" --argjson extra "$EXTRA" '{prompt: $p} + $extra')"
RESP="$(curl -sS --fail-with-body -X POST "https://fal.run/$ENDPOINT" \
  -H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json" -d "$BODY")"

mkdir -p "$(dirname "$OUT")"
i=0
for url in $(jq -r '.images[].url' <<<"$RESP"); do
  i=$((i+1)); ext="${url##*.}"; ext="${ext%%\?*}"
  curl -sS -o "${OUT}-${i}.${ext}" "$url"
  echo "${OUT}-${i}.${ext}"
done
[[ $i -gt 0 ]] || { echo "No images returned: $RESP" >&2; exit 1; }

printf '%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$ENDPOINT" "$COST" "$OUT" >> "$LOG"
echo "Logged \$$COST · total \$$(awk -F'\t' '{s+=$3} END {printf "%.2f", s}' "$LOG") of \$$BUDGET"

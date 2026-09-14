#!/usr/bin/env bash
# Publish video cutscenes: raw Kling downloads → public/night/cutscenes/<pair>.mp4 (1280×720, H.264 high, 30 fps,
# 1 s GOP, faststart, no audio, ≤ 2.5 MB), first/last posters, and manifest.json for cutscene.ts.
# Usage: scripts/cutscene-encode.sh [pair…] [--reverse A-B …]
#   scripts/cutscene-encode.sh city-education work-projects   # encode these raw clips
#   scripts/cutscene-encode.sh --reverse city-education       # play city-education backwards as education-city
#   scripts/cutscene-encode.sh                                # every raw clip forwards (raw/*.old.mp4 = retired takes, skipped)
#   scripts/cutscene-encode.sh --manifest                     # only rebuild manifest.json from clips.tsv + the mp4s present
# Each encoded clip is recorded in design/night/cutscenes/clips.tsv (pair, reverseOf|-, model, request, crf) — the
# manifest is rebuilt from that table and the mp4s present, so a reversal upgraded to a real clip just overwrites.
set -euo pipefail
cd "$(dirname "$0")/.."

FF=/opt/homebrew/bin/ffmpeg; FP=/opt/homebrew/bin/ffprobe
DIR=design/night/cutscenes; RAW=$DIR/raw; OUT=public/night/cutscenes; CLIPS=$DIR/clips.tsv; LEDGER=$DIR/ledger.tsv
MAX_BYTES=2500000
mkdir -p "$OUT"; touch "$CLIPS"

pairs=(); reverses=(); mode=fwd; manifest_only=0
for a in "$@"; do
  case "$a" in --reverse) mode=rev ;; --forward) mode=fwd ;; --manifest) manifest_only=1 ;; *) if [[ $mode == rev ]]; then reverses+=("$a"); else pairs+=("$a"); fi ;; esac
done
if [[ $manifest_only == 0 && ${#pairs[@]} -eq 0 && ${#reverses[@]} -eq 0 ]]; then
  for f in "$RAW"/*.mp4; do b="$(basename "$f" .mp4)"; [[ -f "$f" && "$b" != *.* ]] && pairs+=("$b"); done  # <pair>.<tag>.mp4 (old, old2, pano…) = alternate takes, skipped
fi

# ledger row for a real clip: model and request id
ledger_of() {
  # provenance: raw/<pair>.request (model, request id — written by cutscene-gen.sh, or by hand when an older take is restored),
  # else the ledger's last row for the pair
  if [[ -f "$RAW/$1.request" ]]; then awk -F'\t' '{ printf "%s\t%s", $2, $3 }' "$RAW/$1.request"; return; fi
  awk -F'\t' -v p="$1" '$2 == p { m = $3; r = $5 } END { printf "%s\t%s", m, r }' "$LEDGER" 2>/dev/null
}

# encode <pair> <source-pair> <reverse:0|1>
encode() {
  local pair="$1" srcpair="$2" rev="$3" src="$RAW/$2.mp4" out="$OUT/$1.mp4" vf crf size
  [[ -f "$src" ]] || { echo "missing $src" >&2; return 1; }
  vf="scale=1280:720:flags=lanczos,format=yuv420p"; [[ $rev == 1 ]] && vf="reverse,$vf"
  for crf in 24 26 28; do
    $FF -v error -y -i "$src" -vf "$vf" -r 30 -c:v libx264 -preset slow -crf "$crf" -profile:v high -g 30 -keyint_min 30 -sc_threshold 0 \
      -movflags +faststart -an "$out"
    size="$(stat -f%z "$out")"
    [[ $size -le $MAX_BYTES ]] && break
    echo "$pair: $size bytes at crf $crf, retrying tighter" >&2
  done
  $FF -v error -y -i "$out" -frames:v 1 -q:v 4 "$OUT/$pair.first.jpg"
  $FF -v error -y -sseof -0.15 -i "$out" -frames:v 1 -update 1 -q:v 4 "$OUT/$pair.last.jpg"
  local meta; meta="$(ledger_of "$srcpair")"
  # one row per pair (last write wins); "-" marks an empty reverseOf (a tab IFS would swallow an empty field)
  awk -F'\t' -v p="$pair" '$1 != p' "$CLIPS" > "$CLIPS.tmp" || true
  printf '%s\t%s\t%s\t%s\n' "$pair" "$([[ $rev == 1 ]] && echo "$srcpair" || echo -)" "$meta" "$crf" >> "$CLIPS.tmp"
  sort "$CLIPS.tmp" > "$CLIPS"; rm -f "$CLIPS.tmp"
  echo "$out  $(( size / 1024 )) KB  crf $crf$([[ $rev == 1 ]] && echo "  (reverse of $srcpair)")"
}

for p in "${pairs[@]+"${pairs[@]}"}"; do encode "$p" "$p" 0; done
for p in "${reverses[@]+"${reverses[@]}"}"; do
  a="${p%-*}"; b="${p#*-}"
  encode "$b-$a" "$p" 1
done

# ---- manifest from the clip table + what is actually on disk
while IFS=$'\t' read -r pair reverseOf model request crf; do
  f="$OUT/$pair.mp4"; [[ -f "$f" ]] || continue
  dur="$($FP -v error -show_entries format=duration -of csv=p=0 "$f")"
  jq -n --arg pair "$pair" --arg src "/night/cutscenes/$pair.mp4" --argjson duration "$(printf '%.3f' "$dur")" \
    --argjson bytes "$(stat -f%z "$f")" --arg sha "$(shasum -a 256 "$f" | cut -c1-8)" \
    --arg model "$model" --arg request "$request" --arg rev "$reverseOf" \
    '{($pair): {src: $src, duration: $duration, bytes: $bytes, sha: $sha, model: $model, request: $request, reverseOf: (if $rev == "-" or $rev == "" then null else $rev end)}}'
done < "$CLIPS" | jq -s 'add // {} | {v: 1, clips: .}' > "$OUT/manifest.json"
echo "manifest: $(jq -r '.clips | length' "$OUT/manifest.json") clips, $(du -ch "$OUT"/*.mp4 2>/dev/null | tail -1 | cut -f1) total"

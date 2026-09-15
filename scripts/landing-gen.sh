#!/usr/bin/env bash
# "Warp to Neon Harbor" landing media: a light-speed hover-sedan loop that plays while the city boots, and an arrival
# clip that drops out of warp onto the bay vista (design/night/cutscenes/frames/city.png).
# Usage:
#   scripts/landing-gen.sh key [take=1]            # $0.30 nano-banana-pro/edit ×2 (2K 16:9) → design/night/landing/key-<take>-{1,2}.png
#   scripts/landing-gen.sh pick <candidate.png>    # downscale the chosen candidate → design/night/landing/keyframe.png (1920×1080)
#   scripts/landing-gen.sh loop [take=1] [--start-only]   # $0.56 Kling O1 start = end = keyframe → loop-<take>.mp4
#                                                  # --start-only: no end frame; then `seam loop-<take>.mp4` makes it loop
#   scripts/landing-gen.sh seam <raw.mp4>          # fallback: crossfade the last 1 s into the first 1 s → <raw>.seam.mp4
#   scripts/landing-gen.sh arrival [take=1]        # $0.56 Kling O1 start = keyframe, end = frames/city.png → arrival-<take>.mp4
#   scripts/landing-gen.sh soften <raw.mp4> [from=1.7] [to=4.2] [frames=3]
#                                                  # photosensitivity: centred N-frame temporal blend over [from, to] with 0.3 s
#                                                  # ramps (fast bright moving cables flicker per WCAG 2.3.1) → <raw>.soft.mp4;
#                                                  # measure with scripts/flash-check.py, then ARRIVAL=<raw>.soft.mp4 encode
#   LOOP=… ARRIVAL=… scripts/landing-gen.sh encode # → public/night/landing/ (defaults: loop-1.mp4, arrival-1.mp4)
#   LOOP=… ARRIVAL=… scripts/landing-gen.sh check  # SSIM gates + design/night/landing/contact-sheet.png
# Prompts: design/night/prompts/landing-{key,loop,arrival}.txt (edit and re-run with the next take to retry).
# Raws, responses, request sidecars and the chosen-take table live in design/night/landing/ (gitignored).
# Every paid call goes through scripts/fal-run.sh (budget FAL_BUDGET, ledger design/fal-spend.log). FAL_KEY from .env.local.
set -euo pipefail
cd "$(dirname "$0")/.."

CMD="${1:?key|pick|loop|seam|soften|arrival|encode|check}"
FF=/opt/homebrew/bin/ffmpeg; FP=/opt/homebrew/bin/ffprobe
DIR=design/night/landing; PROMPTS=design/night/prompts; OUT=public/night/landing
CAR=design/night/cars/hover-sedan/concept-1.png; CITY=design/night/cutscenes/frames/city.png; KEY=$DIR/keyframe.png
KLING=fal-ai/kling-video/o1/image-to-video; KLING_PRICE=0.56
EDIT=fal-ai/nano-banana-pro/edit; EDIT_PRICE=0.15   # per image at 1K/2K (4K doubles), confirmed on fal.ai 2026-09-14
export FAL_BUDGET="${FAL_BUDGET:-88}"
mkdir -p "$DIR"

key_env() {
  if [[ -z "${FAL_KEY:-}" && -f .env.local ]]; then FAL_KEY="$(grep -E '^FAL_KEY=' .env.local | head -1 | cut -d= -f2- | tr -d '"'"'"' \r')"; fi
  [[ -n "${FAL_KEY:-}" ]] || { echo "FAL_KEY not set (env or .env.local)" >&2; exit 1; }
  export FAL_KEY
}

# upload <png> → fal CDN url, cached in <png minus .png>.url as "sha<TAB>url" (same format as cutscene-gen.sh, so
# frames/city.url is reused as is)
upload() {
  local png="$1" cache="${1%.png}.url" sha init up url
  sha="$(shasum -a 256 "$png" | cut -c1-64)"
  if [[ -f "$cache" && "$(cut -f1 "$cache")" == "$sha" ]]; then cut -f2 "$cache"; return; fi
  init="$(curl -sS --fail-with-body -X POST "https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3" \
    -H "Authorization: Key $FAL_KEY" -H "Content-Type: application/json" \
    -d "{\"content_type\":\"image/png\",\"file_name\":\"landing-$(basename "$png")\"}")"
  up="$(jq -r '.upload_url' <<<"$init")"; url="$(jq -r '.file_url' <<<"$init")"
  [[ "$up" != "null" && "$url" != "null" ]] || { echo "upload initiate failed" >&2; return 1; }
  curl -sS --fail-with-body -X PUT "$up" -H "Content-Type: image/png" --data-binary "@$png" >/dev/null
  printf '%s\t%s\n' "$sha" "$url" > "$cache"
  echo "$url"
}

# run <endpoint> <price> <label> <input.json> <out> <jq> → runs fal-run.sh, writes <out minus ext>.request (endpoint, request, prompt sha)
run() {
  local log req
  log="$(scripts/fal-run.sh "$1" "$2" "$3" "$4" "$5" "$6" | tee /dev/stderr)"
  req="$(sed -n 's/^queued: //p' <<<"$log" | head -1)"
  printf '%s\t%s\t%s\t%s\t%s\n' "$(date -u +%FT%TZ)" "$1" "${req:-?}" "$2" "$3" > "${5%.*}.request"
  echo "request ${req:-?}"
}

# ssim <a> <b> → the "All" SSIM of two stills, both scaled to 640×360
ssim() {
  $FF -hide_banner -nostats -i "$1" -i "$2" -lavfi "[0:v]scale=640:360:flags=bicubic,format=yuv420p[a];[1:v]scale=640:360:flags=bicubic,format=yuv420p[b];[a][b]ssim" \
    -f null - 2>&1 | sed -n 's/.*All:\([0-9.]*\).*/\1/p' | tail -1
}
frame_at() { $FF -v error -y -ss "$2" -i "$1" -frames:v 1 "$3"; }             # frame_at <video> <sec> <png>
frame_last() { $FF -v error -y -sseof -0.2 -i "$1" -update 1 "$2"; }           # last decoded frame
dur() { $FP -v error -show_entries format=duration -of csv=p=0 "$1"; }

LOOP="${LOOP:-$DIR/loop-1.mp4}"; ARRIVAL="${ARRIVAL:-$DIR/arrival-1.mp4}"

case "$CMD" in
key)
  TAKE="${2:-1}"; key_env
  CAR_URL="$(upload "$CAR")"; CITY_URL="$(upload "$CITY")"
  INPUT=$DIR/key-$TAKE.input.json
  jq -n --rawfile p "$PROMPTS/landing-key.txt" --arg car "$CAR_URL" --arg city "$CITY_URL" \
    '{prompt: ($p | rtrimstr("\n")), image_urls: [$car, $city], num_images: 2, aspect_ratio: "16:9", resolution: "2K", output_format: "png"}' > "$INPUT"
  PRICE="$(awk -v p="$EDIT_PRICE" 'BEGIN {printf "%.2f", p * 2}')"
  run "$EDIT" "$PRICE" "night/landing/key-$TAKE" "$INPUT" "$DIR/key-$TAKE-1.png" '.images[0].url'
  url2="$(jq -r '.images[1].url // empty' "$DIR/key-$TAKE-1.response.json")"
  [[ -n "$url2" ]] && curl -sS -L -o "$DIR/key-$TAKE-2.png" "$url2"
  ls -1 "$DIR"/key-"$TAKE"-*.png
  ;;
pick)
  SRC="${2:?candidate png}"
  $FF -v error -y -i "$SRC" -vf "scale=1920:1080:flags=lanczos" "$KEY"
  printf '%s\tkeyframe\t%s\n' "$(date -u +%FT%TZ)" "$SRC" >> "$DIR/chosen.tsv"
  echo "$KEY ← $SRC"
  ;;
loop)
  TAKE="${2:-1}"; START_ONLY="${3:-}"; key_env
  [[ -f "$KEY" ]] || { echo "no $KEY (run key + pick)" >&2; exit 1; }
  K_URL="$(upload "$KEY")"; INPUT=$DIR/loop-$TAKE.input.json
  if [[ "$START_ONLY" == --start-only ]]; then
    # the "@Image2" sentence makes no sense without an end frame: drop it
    jq -n --rawfile p "$PROMPTS/landing-loop.txt" --arg k "$K_URL" \
      '{prompt: ($p | rtrimstr("\n") | sub(" Start exactly on @Image1.*$"; " Start exactly on @Image1.")), start_image_url: $k, duration: "5"}' > "$INPUT"
  else
    jq -n --rawfile p "$PROMPTS/landing-loop.txt" --arg k "$K_URL" \
      '{prompt: ($p | rtrimstr("\n")), start_image_url: $k, end_image_url: $k, duration: "5"}' > "$INPUT"
  fi
  run "$KLING" "$KLING_PRICE" "night/landing/loop-$TAKE" "$INPUT" "$DIR/loop-$TAKE.mp4" '.video.url'
  ;;
seam)
  RAW="${2:?raw.mp4}"; D="$(dur "$RAW")"; X=1
  # out(t) = src(t + X) until the tail, where src's last X seconds dissolve into src(0..X): out's last frame ≈ out's first
  $FF -v error -y -i "$RAW" -filter_complex \
    "[0:v]split[a][b];[a]trim=start=$X,setpts=PTS-STARTPTS,fps=30[main];[b]trim=0:$X,setpts=PTS-STARTPTS,fps=30[head];[main][head]xfade=transition=fade:duration=$X:offset=$(awk -v d="$D" -v x="$X" 'BEGIN {printf "%.3f", d - 2 * x}'),format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -crf 12 -preset slow -an "${RAW%.mp4}.seam.mp4"
  echo "${RAW%.mp4}.seam.mp4 $(dur "${RAW%.mp4}.seam.mp4")s"
  ;;
soften)
  RAW="${2:?raw.mp4}"; S0="${3:-1.7}"; S1="${4:-4.2}"; N="${5:-3}"; SH=$(( (N - 1) / 2 )); SOFT="${RAW%.mp4}.soft.mp4"
  A="max(0,min(1,(T-$S0)/0.3))*max(0,min(1,($S1-T)/0.3))"   # 0 outside, 1 inside, 0.3 s linear ramps
  # tmix averages the current and N-1 previous frames: trim SH frames so the blend is centred, then mix it in by A
  $FF -v error -y -i "$RAW" -filter_complex \
    "[0:v]fps=30,format=gbrp,split[a][b];[b]tmix=frames=$N,trim=start_frame=$SH,setpts=PTS-STARTPTS[bt];[a][bt]blend=all_expr='A*(1-$A)+B*$A':eof_action=repeat,format=yuv420p[v]" \
    -map "[v]" -c:v libx264 -crf 10 -preset slow -an "$SOFT"
  printf '%s\tsoften\t%s frames=%s %s-%ss\n' "$(date -u +%FT%TZ)" "$SOFT" "$N" "$S0" "$S1" >> "$DIR/chosen.tsv"
  echo "$SOFT $(dur "$SOFT")s"
  ;;
arrival)
  TAKE="${2:-1}"; key_env
  [[ -f "$KEY" ]] || { echo "no $KEY (run key + pick)" >&2; exit 1; }
  K_URL="$(upload "$KEY")"; CITY_URL="$(upload "$CITY")"; INPUT=$DIR/arrival-$TAKE.input.json
  jq -n --rawfile p "$PROMPTS/landing-arrival.txt" --arg k "$K_URL" --arg c "$CITY_URL" \
    '{prompt: ($p | rtrimstr("\n")), start_image_url: $k, end_image_url: $c, duration: "5"}' > "$INPUT"
  run "$KLING" "$KLING_PRICE" "night/landing/arrival-$TAKE" "$INPUT" "$DIR/arrival-$TAKE.mp4" '.video.url'
  ;;
encode)
  mkdir -p "$OUT"
  # enc <src> <out> <max bytes> <vf> [extra input args] — CRF steps from 24 until it fits
  enc() {
    local src="$1" out="$2" max="$3" vf="$4" crf size
    for crf in 24 26 28 30 32 34 36; do
      $FF -v error -y -i "$src" -vf "$vf" -r 30 -c:v libx264 -preset slow -crf "$crf" -profile:v high -g 30 -keyint_min 30 -sc_threshold 0 \
        -movflags +faststart -an "$out"
      size="$(stat -f%z "$out")"; [[ $size -le $max ]] && break
      echo "$(basename "$out"): $size bytes at crf $crf, retrying tighter" >&2
    done
    [[ $size -le $max ]] || { echo "$(basename "$out") still $size > $max" >&2; return 1; }
    echo "$out  $((size / 1024)) KB  crf $crf" >&2
  }
  # the loop's last frame repeats its first (start = end frame): drop it so the wrap does not hold a frame
  nf="$($FP -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of csv=p=0 "$LOOP")"
  TRIM="trim=end_frame=$((nf - 1)),setpts=PTS-STARTPTS"
  WIDE="scale=1280:720:flags=lanczos,format=yuv420p"
  TALL="crop=trunc(ih*9/16/2)*2:ih,scale=540:960:flags=lanczos,format=yuv420p"
  enc "$LOOP" "$OUT/warp-loop.mp4" 1500000 "$TRIM,$WIDE"
  enc "$ARRIVAL" "$OUT/warp-arrival.mp4" 2500000 "$WIDE"
  enc "$LOOP" "$OUT/warp-loop-p.mp4" 600000 "$TRIM,$TALL"
  enc "$ARRIVAL" "$OUT/warp-arrival-p.mp4" 900000 "$TALL"
  # posters = first frame of each loop, JPEG quality stepped down until it fits
  poster() {
    local src="$1" out="$2" max="$3" q size
    for q in 3 4 5 6 8 10 12; do
      $FF -v error -y -i "$src" -frames:v 1 -q:v "$q" "$out"; size="$(stat -f%z "$out")"; [[ $size -le $max ]] && break
    done
    [[ $size -le $max ]] || { echo "$(basename "$out") still $size > $max" >&2; return 1; }
    echo "$out  $((size / 1024)) KB  q $q" >&2
  }
  poster "$OUT/warp-loop.mp4" "$OUT/warp-poster.jpg" 120000
  poster "$OUT/warp-loop-p.mp4" "$OUT/warp-poster-p.jpg" 60000
  for f in warp-loop.mp4 warp-arrival.mp4 warp-loop-p.mp4 warp-arrival-p.mp4 warp-poster.jpg warp-poster-p.jpg; do
    d=null; [[ $f == *.mp4 ]] && d="$(printf '%.3f' "$(dur "$OUT/$f")")"
    jq -n --arg k "${f%.*}" --arg path "/night/landing/$f" --argjson duration "$d" --argjson bytes "$(stat -f%z "$OUT/$f")" \
      --arg sha "$(shasum -a 256 "$OUT/$f" | cut -c1-8)" '{($k): {path: $path, duration: $duration, bytes: $bytes, sha: $sha}}'
  done | jq -s --arg loop "$(basename "$LOOP")" --arg arrival "$(basename "$ARRIVAL")" \
    'add | {v: 1, source: {loop: $loop, arrival: $arrival}, files: .}' > "$OUT/manifest.json"
  printf '%s\tencode\tloop=%s arrival=%s\n' "$(date -u +%FT%TZ)" "$LOOP" "$ARRIVAL" >> "$DIR/chosen.tsv"
  cat "$OUT/manifest.json"
  ;;
check)
  T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
  W="$OUT/warp-loop.mp4"; A="$OUT/warp-arrival.mp4"
  for f in "$LOOP" "$ARRIVAL" "$W" "$A"; do [[ -f "$f" ]] || { echo "missing $f" >&2; exit 1; }; done
  fail=0
  gate() { # gate <label> <value> <op ge|lt> <threshold>
    local ok; ok="$(awk -v v="$2" -v t="$4" -v op="$3" 'BEGIN {print (op == "ge" ? v >= t : v < t) ? "PASS" : "FAIL"}')"
    [[ $ok == PASS ]] || fail=1
    printf '%-44s %s  (%s %s)  %s\n' "$1" "$2" "$([[ $3 == ge ]] && echo '>=' || echo '<')" "$4" "$ok"
  }
  frame_at "$LOOP" 0 "$T/lr0.png"; frame_last "$LOOP" "$T/lrN.png"
  frame_at "$W" 0 "$T/l0.png"; frame_last "$W" "$T/lN.png"; frame_at "$W" "$(awk -v d="$(dur "$W")" 'BEGIN {print d / 2}')" "$T/lM.png"
  frame_at "$A" 0 "$T/a0.png"; frame_last "$A" "$T/aN.png"; frame_at "$A" "$(awk -v d="$(dur "$A")" 'BEGIN {print d / 2}')" "$T/aM.png"
  gate "loop raw first <-> last" "$(ssim "$T/lr0.png" "$T/lrN.png")" ge 0.97
  echo "  (info) encoded loop last <-> first, wrap neighbour: $(ssim "$T/lN.png" "$T/l0.png")"
  gate "arrival first <-> loop first" "$(ssim "$T/a0.png" "$T/l0.png")" ge 0.95
  gate "arrival last <-> city.png" "$(ssim "$T/aN.png" "$CITY")" ge 0.90
  gate "loop motion: first <-> mid (must differ)" "$(ssim "$T/l0.png" "$T/lM.png")" lt 0.97
  gate "arrival motion: first <-> mid (must differ)" "$(ssim "$T/a0.png" "$T/aM.png")" lt 0.90
  # consecutive-frame change a third into the loop: streaks should keep moving, not freeze
  t1="$(awk -v d="$(dur "$W")" 'BEGIN {print d / 3}')"; frame_at "$W" "$t1" "$T/m1.png"; frame_at "$W" "$(awk -v t="$t1" 'BEGIN {print t + 0.2}')" "$T/m2.png"
  gate "loop motion: t <-> t+0.2 s (must differ)" "$(ssim "$T/m1.png" "$T/m2.png")" lt 0.99
  # contact sheet: keyframe candidates, then 5 frames of loop / arrival (wide) and of both phone crops
  for clip in warp-loop warp-arrival warp-loop-p warp-arrival-p; do
    d="$(dur "$OUT/$clip.mp4")"
    for i in 0 1 2 3 4; do
      if [[ $i == 4 ]]; then frame_last "$OUT/$clip.mp4" "$T/$clip-$i.png"; else frame_at "$OUT/$clip.mp4" "$(awk -v d="$d" -v i="$i" 'BEGIN {print d * i / 4}')" "$T/$clip-$i.png"; fi
    done
  done
  python3 - "$T" "$DIR/contact-sheet.png" "$DIR" <<'PY'
import sys, glob, os
from PIL import Image, ImageDraw
t, out, d = sys.argv[1:4]
cw, pad = 384, 8
rows = []
keys = sorted(glob.glob(os.path.join(d, 'key-*-[0-9].png')))
if keys: rows.append(('keyframe candidates: ' + ', '.join(os.path.basename(k) for k in keys), [Image.open(k).convert('RGB') for k in keys]))
for clip in ['warp-loop', 'warp-arrival']:
    rows.append((clip + ' (0, 25, 50, 75 %, last)', [Image.open(f'{t}/{clip}-{i}.png').convert('RGB') for i in range(5)]))
for clip in ['warp-loop-p', 'warp-arrival-p']:
    rows.append((clip + ' phone crop', [Image.open(f'{t}/{clip}-{i}.png').convert('RGB') for i in range(5)]))
def fit(im, h): return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)
lines = []
for label, ims in rows:
    h = 216 if ims[0].width >= ims[0].height else 400
    lines.append((label, [fit(i, h) for i in ims], h))
W = max(sum(i.width + pad for i in ims) + pad for _, ims, _ in lines)
H = sum(h + 28 + pad for *_, h in lines) + pad
sheet = Image.new('RGB', (W, H), (18, 18, 24)); dr = ImageDraw.Draw(sheet)
y = pad
for label, ims, h in lines:
    dr.text((pad, y + 6), label, fill=(230, 230, 230)); y += 24
    x = pad
    for im in ims:
        sheet.paste(im, (x, y))
        if im.width >= im.height:  # mark the middle 25 % of the width (the phone's safe slice)
            for fx in (0.375, 0.625): dr.line([(x + im.width * fx, y), (x + im.width * fx, y + h)], fill=(255, 255, 0), width=1)
        x += im.width + pad
    y += h + pad
sheet.save(out); print(out, sheet.size)
PY
  [[ $fail == 0 ]] && echo "check: all gates pass" || { echo "check: FAILED gates above" >&2; exit 2; }
  ;;
*) echo "unknown command $CMD" >&2; exit 1 ;;
esac

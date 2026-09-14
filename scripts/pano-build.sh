#!/usr/bin/env bash
# Build the 360° city backdrop from a HunyuanWorld equirect panorama (design/night/pano/pano-1.png):
#   1. wrap-pad 96 px on both sides so the u=0/1 seam survives the upscaler, 2. fal ESRGAN ×4, 3. crop the padding,
#   4. Depth Anything v2 on the (wrap-padded) panorama, 5. export public/night/backdrop/pano.webp (4096×2048),
#   pano-depth.png (1024×512) and half-size copies under public/night-lite/backdrop/ (the lite URL rewrite).
# Usage: scripts/pano-build.sh [src.png]   (FAL_BUDGET applies; FAL_KEY from env or .env.local)
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:-design/night/pano/pano-1.png}"
OUT=design/night/pano/build; mkdir -p "$OUT" public/night/backdrop public/night-lite/backdrop
FAL_KEY="${FAL_KEY:-$(grep -m1 '^FAL_KEY=' .env.local | cut -d= -f2- | tr -d '"')}"; export FAL_KEY
PAD=96
python3 - "$SRC" "$OUT/padded.png" "$PAD" <<'PY'
import sys
from PIL import Image
src, dst, pad = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src).convert('RGB'); w, h = im.size
out = Image.new('RGB', (w + 2 * pad, h)); out.paste(im, (pad, 0)); out.paste(im.crop((w - pad, 0, w, h)), (0, 0)); out.paste(im.crop((0, 0, pad, h)), (w + pad, 0))
out.save(dst); print('padded', out.size)
PY
upload() {
  local f="$1" ct="$2" init up url
  init="$(curl -sS --fail-with-body -X POST 'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3' -H "Authorization: Key $FAL_KEY" -H 'Content-Type: application/json' -d "{\"content_type\":\"$ct\",\"file_name\":\"$(basename "$f")\"}")"
  up="$(jq -r '.upload_url' <<<"$init")"; url="$(jq -r '.file_url' <<<"$init")"
  [[ "$up" != "null" && "$url" != "null" ]] || { echo "upload initiate failed: $init" >&2; return 1; }
  curl -sS --fail-with-body -X PUT "$up" -H "Content-Type: $ct" --data-binary @"$f" -o /dev/null
  echo "$url"
}
URL="$(upload "$OUT/padded.png" image/png)"
jq -n --arg u "$URL" '{image_url:$u, scale:4, output_format:"png"}' > "$OUT/esrgan-input.json"
scripts/fal-run.sh fal-ai/esrgan 0.10 night/pano/esrgan-x4 "$OUT/esrgan-input.json" "$OUT/padded-x4.png" '.image.url'
jq -n --arg u "$URL" '{image_url:$u}' > "$OUT/depth-input.json"
scripts/fal-run.sh fal-ai/image-preprocessors/depth-anything/v2 0.02 night/pano/depth "$OUT/depth-input.json" "$OUT/padded-depth.png" '.image.url'
python3 - "$OUT" "$PAD" <<'PY'
import sys
from PIL import Image, ImageFilter
out, pad = sys.argv[1], int(sys.argv[2])
up = Image.open(f'{out}/padded-x4.png').convert('RGB'); k = up.width // (Image.open(f'{out}/padded.png').width)
col = up.crop((pad * k, 0, up.width - pad * k, up.height))
col.resize((4096, 2048), Image.LANCZOS).save('public/night/backdrop/pano.webp', quality=82, method=6)
col.resize((2048, 1024), Image.LANCZOS).save('public/night-lite/backdrop/pano.webp', quality=80, method=6)
d = Image.open(f'{out}/padded-depth.png').convert('L')
dk = d.width / Image.open(f'{out}/padded.png').width
d = d.crop((round(pad * dk), 0, d.width - round(pad * dk), d.height)).filter(ImageFilter.GaussianBlur(2))
d.resize((1024, 512), Image.LANCZOS).save('public/night/backdrop/pano-depth.png', optimize=True)
d.resize((512, 256), Image.LANCZOS).save('public/night-lite/backdrop/pano-depth.png', optimize=True)
print('upscale factor', k, 'colour', col.size)
PY
ls -la public/night/backdrop/pano* public/night-lite/backdrop/pano*

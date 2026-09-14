#!/usr/bin/env bash
# Post-process the generated ambience loops into seamless web loops.
# Usage: scripts/night-audio.sh [name ...]   (default: rain japantown center kabuki pier)
# Input : design/night/audio/<name>.wav  (Stable Audio 2.5 via scripts/fal-run.sh, 30 s)
# Output: public/night/audio/<name>.opus (libopus 64k) + <name>.m4a (aac 96k)
# Loop seam: the last CROSS seconds are cross-faded onto the first CROSS seconds and the tail is cut,
# so the file loops at its own boundary. Prints an RMS check of the first/last 200 ms.
set -euo pipefail
cd "$(dirname "$0")/.."
FF=${FFMPEG:-/opt/homebrew/bin/ffmpeg}
FP=${FFPROBE:-/opt/homebrew/bin/ffprobe}
durOf() { "$FP" -v error -show_entries format=duration -of csv=p=0 "$1"; }
CROSS=2.0
NAMES=("$@"); [[ ${#NAMES[@]} -gt 0 ]] || NAMES=(rain japantown center kabuki pier)
mkdir -p public/night/audio design/night/audio/tmp

for n in "${NAMES[@]}"; do
  in=design/night/audio/$n.wav
  [[ -f "$in" ]] || { echo "missing $in" >&2; continue; }
  dur=$(durOf "$in")
  body=$(python3 -c "print(max(1.0, $dur - $CROSS))")
  tmp=design/night/audio/tmp
  # head = first CROSS s, tail = last CROSS s, mid = the rest. Loop = [tail⨯head crossfade] + mid.
  "$FF" -y -loglevel error -i "$in" -t "$CROSS" -af "volume=0.9" "$tmp/$n-head.wav"
  "$FF" -y -loglevel error -i "$in" -ss "$body" -af "volume=0.9" "$tmp/$n-tail.wav"
  "$FF" -y -loglevel error -i "$in" -ss "$CROSS" -t "$(python3 -c "print($body - $CROSS)")" -af "volume=0.9" "$tmp/$n-mid.wav"
  "$FF" -y -loglevel error -i "$tmp/$n-tail.wav" -i "$tmp/$n-head.wav" -filter_complex "[0][1]acrossfade=d=$CROSS:c1=tri:c2=tri" "$tmp/$n-seam.wav"
  "$FF" -y -loglevel error -i "$tmp/$n-seam.wav" -i "$tmp/$n-mid.wav" -filter_complex "[0][1]concat=n=2:v=0:a=1,loudnorm=I=-20:TP=-2:LRA=9" -ar 48000 "$tmp/$n-loop.wav"
  "$FF" -y -loglevel error -i "$tmp/$n-loop.wav" -c:a libopus -b:a 64k -vbr on public/night/audio/$n.opus
  "$FF" -y -loglevel error -i "$tmp/$n-loop.wav" -c:a aac -b:a 96k -movflags +faststart public/night/audio/$n.m4a
  # Seam check: RMS of the first and last 200 ms should be close.
  a=$("$FF" -loglevel info -i "$tmp/$n-loop.wav" -t 0.2 -af astats=measure_overall=RMS_level:measure_perchannel=none -f null - 2>&1 | sed -n 's/.*RMS level dB: \(.*\)/\1/p' | tail -1)
  ld=$(durOf "$tmp/$n-loop.wav")
  b=$("$FF" -loglevel info -ss "$(python3 -c "print($ld - 0.2)")" -i "$tmp/$n-loop.wav" -af astats=measure_overall=RMS_level:measure_perchannel=none -f null - 2>&1 | sed -n 's/.*RMS level dB: \(.*\)/\1/p' | tail -1)
  printf '%-10s %6.1fs  head %s dB  tail %s dB  opus %sK  m4a %sK\n' "$n" "$ld" "$a" "$b" \
    "$(du -k public/night/audio/$n.opus | cut -f1)" "$(du -k public/night/audio/$n.m4a | cut -f1)"
done

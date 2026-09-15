#!/usr/bin/env bash
# Prepare the 62.5s generated track as a 60s loop with a one-bar overlap at 96 BPM.
# Usage: bash scripts/synthwave-loop.sh /path/to/source.mp3
set -euo pipefail
cd "$(dirname "$0")/.."
input=${1:?Provide the generated source audio}
ffmpeg -n -hide_banner -loglevel error -i "$input" -filter_complex \
  '[0:a]asplit=3[h][t][m];[h]atrim=0:2.5,asetpts=PTS-STARTPTS[head];[t]atrim=60:62.5,asetpts=PTS-STARTPTS[tail];[m]atrim=2.5:60,asetpts=PTS-STARTPTS[mid];[tail][head]acrossfade=d=2.5:c1=tri:c2=tri[seam];[seam][mid]concat=n=2:v=0:a=1,loudnorm=I=-20:TP=-3:LRA=7,asplit=2[opus][aac]' \
  -map '[opus]' -ar 48000 -c:a libopus -b:a 96k public/night/audio/neon-cruise-v1.opus \
  -map '[aac]' -ar 48000 -c:a aac -b:a 128k -movflags +faststart public/night/audio/neon-cruise-v1.m4a

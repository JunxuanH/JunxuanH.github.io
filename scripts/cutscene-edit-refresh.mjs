// Curated forward-time edits: discard generated mid-route geography, retain departure and
// arrival motion, then pin the final frame to the real renderer. No reverse filters.
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const dir = 'design/night/cutscenes/refresh-2026-09-14';
const rows = JSON.parse(await readFile(`${dir}/results.json`, 'utf8'));
for (const row of rows) {
  const sourceTake = row.take > 1 ? `refresh${row.take}` : 'refresh';
  const source = `design/night/cutscenes/raw/${row.pair}.${sourceTake}.mp4`;
  const target = row.pair.split('-')[1];
  const duration = Number(execFileSync('/opt/homebrew/bin/ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', source], { encoding: 'utf8' }));
  const base = 'scale=1280:720:flags=lanczos,setsar=1,fps=30,format=yuv420p,settb=AVTB';
  const harbor = row.pair === 'contact-city' && row.take === 2;
  const filter = harbor
    ? `[0:v]${base},setpts=PTS-STARTPTS[v];[1:v]${base},trim=duration=0.55,setpts=PTS-STARTPTS[end];[v][end]xfade=transition=fade:duration=0.25:offset=${duration - .25}[out]`
    : `[0:v]${base},split[a][b];[a]trim=duration=1.2,setpts=PTS-STARTPTS[depart];[b]trim=start=${duration - 1.2}:duration=1.2,setpts=PTS-STARTPTS[arrive];[depart][arrive]xfade=transition=fadeblack:duration=0.24:offset=0.96[travel];[1:v]${base},trim=duration=0.55,setpts=PTS-STARTPTS[end];[travel][end]xfade=transition=fade:duration=0.25:offset=1.91[out]`;
  const out = `design/night/cutscenes/raw/${row.pair}.edited.mp4`;
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-y', '-i', source, '-loop', '1', '-i', `${dir}/frames/${target}.jpg`, '-filter_complex', filter, '-map', '[out]', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  await writeFile(`design/night/cutscenes/raw/${row.pair}.edited.request`, `${row.pair}\tfal-ai/kling-video/v3/pro/image-to-video\t${row.request_id}\tedited\n`);
  console.log(`${row.pair}: ${harbor ? 'reviewed two-shot harbor take' : 'trimmed departure / arrival edit'}, renderer-pinned ending`);
}

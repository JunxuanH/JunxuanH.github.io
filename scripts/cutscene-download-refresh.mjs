// Download Fal results and make review strips. Does not publish any clips.
import { readFile, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
const dir = 'design/night/cutscenes/refresh-2026-09-14';
const rows = JSON.parse(await readFile(`${dir}/results.json`, 'utf8'));
for (const row of rows) {
  if (!row.url) continue;
  const take = row.take > 1 ? `refresh${row.take}` : 'refresh';
  const file = `design/night/cutscenes/raw/${row.pair}.${take}.mp4`;
  try { await access(file); } catch {
    const response = await fetch(row.url);
    if (!response.ok) throw new Error(`Download failed: ${row.pair} (${response.status})`);
    await writeFile(file, Buffer.from(await response.arrayBuffer()));
  }
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', 'fps=2,scale=384:216,tile=5x2', '-frames:v', '1', `/tmp/${row.pair}.${take}.jpg`]);
  await writeFile(`design/night/cutscenes/raw/${row.pair}.${take}.request`, `${row.pair}\tfal-ai/kling-video/v3/pro/image-to-video\t${row.request_id}\trefresh\n`);
  console.log(`${row.pair} take ${row.take}: downloaded, ready for review`);
}

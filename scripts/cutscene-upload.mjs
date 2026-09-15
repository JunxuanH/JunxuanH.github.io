// Upload reviewed JPEG endpoints; credentials are never logged or persisted.
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
const [dir, ...ids] = process.argv.slice(2);
if (!dir || !ids.length) throw new Error('Usage: node scripts/cutscene-upload.mjs <frame-dir> <section...>');
const env = await readFile('.env.local', 'utf8').catch(() => '');
const key = process.env.FAL_KEY || env.match(/^FAL_KEY\s*=\s*["']?([^"'\r\n]+)/m)?.[1]?.trim();
if (!key) throw new Error('FAL_KEY is not configured');
const urls = {};
for (const id of ids) {
  const path = join(dir, `${id}.jpg`);
  const r = await fetch('https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3', {
    method: 'POST', headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ file_name: basename(path), content_type: 'image/jpeg' }),
  });
  if (!r.ok) throw new Error(`Upload initialization failed (${r.status})`);
  const { upload_url, file_url } = await r.json();
  const up = await fetch(upload_url, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: await readFile(path) });
  if (!up.ok) throw new Error(`Upload failed (${up.status})`);
  urls[id] = file_url;
}
await writeFile(join(dir, 'urls.json'), JSON.stringify(urls, null, 2) + '\n');
console.log(JSON.stringify(urls));

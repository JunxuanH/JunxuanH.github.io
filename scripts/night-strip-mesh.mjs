// Strip meshes/materials/textures from a GLB, keeping nodes, skins and animations — turns Meshy's
// full-model animation GLBs (~17 MB) into armature-only clip files (~60 KB).
//   node scripts/night-strip-mesh.mjs in.glb out.glb
// Uses the @gltf-transform packages that `npx --yes @gltf-transform/cli` already cached (no install).
import { readdirSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [, , input, output] = process.argv;
if (!input || !output) { console.error('usage: night-strip-mesh.mjs in.glb out.glb'); process.exit(1); }

const npx = join(homedir(), '.npm', '_npx');
let coreDir = null;
for (const d of existsSync(npx) ? readdirSync(npx) : []) {
  const p = join(npx, d, 'node_modules', '@gltf-transform', 'core');
  if (existsSync(p)) { coreDir = p; break; }
}
if (!coreDir) { console.error('run `npx --yes @gltf-transform/cli --version` once to cache the packages'); process.exit(1); }
const { NodeIO } = await import(pathToFileURL(join(coreDir, 'dist', 'index.js')).href);
const extDir = join(coreDir, '..', 'extensions');
const ext = existsSync(extDir) ? await import(pathToFileURL(join(extDir, 'dist', 'index.js')).href).catch(() => ({})) : {};
const io = new NodeIO().registerExtensions(ext.ALL_EXTENSIONS ?? []);
const doc = await io.read(input);
const root = doc.getRoot();
for (const node of root.listNodes()) node.setMesh(null);
for (const mesh of root.listMeshes()) mesh.dispose();
for (const mat of root.listMaterials()) mat.dispose();
for (const tex of root.listTextures()) tex.dispose();
for (const acc of root.listAccessors()) if (acc.listParents().length <= 1) acc.dispose();
for (const buf of root.listBuffers()) if (buf.listParents().length <= 1) buf.dispose();
await io.write(output, doc);
const anims = root.listAnimations().map((a) => `${a.getName() || 'clip'} (${a.listChannels().length} ch)`);
console.log(`${output}: nodes ${root.listNodes().length}, skins ${root.listSkins().length}, animations ${anims.join(', ') || 'none'}`);

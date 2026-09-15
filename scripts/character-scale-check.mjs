// Real-asset regression: skeleton size stays constant through animation crossfades.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs');
const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, headless: true });
try {
  const page = await browser.newPage();
  await page.goto((process.argv[2] || 'http://127.0.0.1:4332') + '/?flat');
  const results = await page.evaluate(async () => {
    const { loadCharacter, instantiate, normalizeClipUnits } = await import('/src/scene/night/characters.ts');
    const { RIG_NAMES, rigMeta } = await import('/src/scene/night/rigs.ts');
    const THREE = await import('/node_modules/three/build/three.webgpu.js');
    const rows = [];
    for (const name of RIG_NAMES.filter(n => rigMeta(n).ok)) {
      const asset = await loadCharacter(name), inst = instantiate(asset, { skin: false });
      const hips = inst.model.getObjectByName('Hips');
      const rest = hips.scale.clone();
      const row = { name, corrected: Object.fromEntries([...asset.clipUnitScales].filter(([, s]) => s !== 1)), maxScaleError: 0, feet: {} };
      for (const clip of ['idle', 'walk', 'run', ...asset.clips.keys()].filter((v, i, a) => a.indexOf(v) === i)) {
        inst.play(clip, .2);
        for (let i = 0; i < 30; i++) {
          inst.mixer.update(1/60);
          row.maxScaleError = Math.max(row.maxScaleError, hips.scale.distanceTo(rest));
        }
        if (['idle', 'walk', 'run'].includes(clip)) {
          const minima = [];
          for (let i = 0; i < 12; i++) {
            inst.mixer.update(inst.actions.get(clip).getClip().duration / 12);
            inst.root.updateMatrixWorld(true);
            minima.push(new THREE.Box3().setFromObject(inst.model, true).min.y);
          }
          minima.sort((a,b)=>a-b); row.feet[clip] = minima[2];
        }
      }
      inst.play('idle', .2);
      for(let i=0;i<30;i++) {inst.mixer.update(1/60);row.maxScaleError=Math.max(row.maxScaleError,hips.scale.distanceTo(rest));}
      rows.push(row);
    }
    // Animated scaling is not an export-unit mismatch and must remain untouched.
    const root = new THREE.Group(), bone = new THREE.Bone(); bone.name = 'Hips'; root.add(bone);
    const scale = new THREE.VectorKeyframeTrack('Hips.scale', [0,1], [1,1,1,2,2,2]);
    const position = new THREE.VectorKeyframeTrack('Hips.position', [0,1], [0,1,0,0,2,0]);
    const clip = new THREE.AnimationClip('intentional', 1, [scale,position]);
    const untouched = normalizeClipUnits(root,clip) === 1 && scale.values[3] === 2 && position.values[4] === 2;
    return { rows, untouched };
  });
  mkdirSync('design/night/characters', { recursive: true });
  writeFileSync('design/night/characters/scale-check.json', JSON.stringify(results,null,2));
  for(const row of results.rows) {
    console.log(row.name, JSON.stringify(row));
    assert.ok(row.maxScaleError < .001, `${row.name}: scale changes across clips`);
    for (const [clip, y] of Object.entries(row.feet)) assert.ok(Math.abs(y) < .015, `${row.name}/${clip}: planted feet must remain grounded`);
  }
  assert.ok(results.untouched, 'preserve intentional animated scaling');
  console.log(`PASS ${results.rows.length} rigs: constant size, grounded idle, animated-scale preservation`);
} finally { await browser.close(); }

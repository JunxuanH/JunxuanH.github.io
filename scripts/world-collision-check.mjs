import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const astroRequire = createRequire(require.resolve('astro/package.json'));
const viteRequire = createRequire(astroRequire.resolve('vite'));
const { build } = viteRequire('esbuild');
import { Vector3 } from 'three';

// Bundle the pure movement queries with their shared scene constants; no DOM or GPU is needed.
globalThis.location = { search: '' };
globalThis.matchMedia = () => ({ matches: false });
const bundled = await build({ entryPoints: ['src/scene/night/walkable.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { buildAreas, buildWorldArea, resolve, groundY, rectAt, sectionAt } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const area = buildWorldArea(buildAreas(), []);
const layout = await build({ entryPoints: ['src/scene/night/terminal-layout.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { TERMINALS } = await import(`data:text/javascript;base64,${Buffer.from(layout.outputFiles[0].text).toString('base64')}`);
assert.equal(Object.keys(TERMINALS).length, 4);
for (const [id, terminal] of Object.entries(TERMINALS)) {
  const [x, , z] = terminal.pos;
  const dx = Math.sin(terminal.yaw), dz = Math.cos(terminal.yaw);
  const previous = new Vector3(x + dx * 2, groundY(area, x, z), z + dz * 2);
  const next = new Vector3(x, previous.y, z);
  assert(resolve(area, next, previous), `${id} kiosk must block the player`);
  assert(Math.hypot(next.x - x, next.z - z) > .7, `${id} has a solid housing`);
  assert(rectAt(area, previous.x, previous.z), `${id} approach stays on dry ground`);
}
function walk(x, z, dx, dz, steps) {
  const p = new Vector3(x, groundY(area, x, z), z);
  let hit = false;
  for (let i = 0; i < steps; i++) {
    const prev = p.clone(); p.x += dx; p.z += dz;
    hit = resolve(area, p, prev) || hit;
    assert(rectAt(area, p.x, p.z), 'player left dry ground');
  }
  return { p, hit };
}
assert(walk(0, -200, 0, -.2, 100).p.z < -219, 'avenue remains connected past old downtown boundary');
assert(walk(-70, -60, .2, 0, 350).p.x > -1, 'campus cross street connects to avenue');
assert(walk(0, -228, .2, 0, 60).p.x > 11, 'avenue connects to market');
const wall = walk(100, -30, 0, .2, 100);
assert(wall.hit && wall.p.z < -22.3, 'quay wall blocks stepping straight into water');
const ramp = walk(140, -35, 0, .1, 180);
assert(ramp.p.z > -18 && Math.abs(ramp.p.y - 2.9) < .01, 'visible ramp connects street to pier');
const shore = walk(140, -10, .2, 0, 100);
assert(shore.hit && shore.p.x <= 145.6, 'pier side cannot enter water');
const quay = walk(100, -21, 0, .1, 100);
assert(quay.hit && quay.p.z <= -20.4, 'quay edge blocks water');
const obstacleArea = { section: 'work', rects: [{x0:-10,x1:10,z0:-10,z1:10}], obstacles:[{kind:'box',x0:0,x1:2,z0:0,z1:2}] };
const prev = new Vector3(-.5,0,1), next = new Vector3(-.2,0,1.1);
assert(resolve(obstacleArea,next,prev));
assert(next.x <= -.4 && next.z > prev.z, 'building collision slides tangentially');
assert.equal(sectionAt(-80,-102),'education'); assert.equal(sectionAt(50,-228),'projects'); assert.equal(sectionAt(140,0),'contact');
console.log('PASS connected streets, district ownership, wall sliding, ramp access and waterfront exclusion');

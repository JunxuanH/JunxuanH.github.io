import assert from 'node:assert/strict';
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack, Quaternion } from 'three';
import { refineRoninRun } from '../src/scene/night/ronin-run.ts';

const rotation = (bone, angle) => new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, .5, 1],
  [0, 0, 0, 1, Math.sin(angle / 2), 0, 0, Math.cos(angle / 2), 0, 0, 0, 1]);
const run = new AnimationClip('run', 1, [rotation('LeftShoulder', 1), rotation('RightUpLeg', 1),
  rotation('LeftLeg', 1), rotation('Head', .1),
  new VectorKeyframeTrack('Hips.scale', [0, 1], [1, 1, 1, 1, 1, 1]),
  new VectorKeyframeTrack('Hips.position', [0, .5, 1], [0, 1, 0, 0, 1.1, 0, 0, 1, 0])]);
const walk = new AnimationClip('walk', 2, run.tracks.map(t => {
  const copy = t.clone(); copy.times = copy.times.map(v => v * 2);
  if (copy.name.endsWith('.quaternion')) copy.values.set([0, 0, 0, 1], 4);
  return copy;
}));
const before = JSON.stringify(AnimationClip.toJSON(run));
const result = refineRoninRun(run, walk);
assert.equal(JSON.stringify(AnimationClip.toJSON(run)), before, 'source clip stays untouched');
assert.equal(result.duration, run.duration);
for (const t of result.tracks) {
  assert.ok(Array.from(t.values).every(Number.isFinite));
  if (t.name.endsWith('.quaternion')) {
    for (let i = 0; i < t.values.length; i += 4) assert.ok(Math.abs(new Quaternion().fromArray(t.values, i).length() - 1) < 1e-6);
    assert.deepEqual(Array.from(t.values.slice(0, 4)), Array.from(t.values.slice(-4)), 'loop remains continuous');
  }
  if (t.name === 'Hips.scale' || t.name === 'Head.quaternion') assert.deepEqual(t.values, run.tracks.find(s => s.name === t.name).values);
}
for (const name of ['LeftShoulder', 'RightUpLeg', 'LeftLeg']) {
  const values = result.tracks.find(t => t.name === `${name}.quaternion`).values;
  assert.ok(new Quaternion().fromArray(values, 4).angleTo(new Quaternion()) < 1, `${name} extreme reduced`);
}
console.log('PASS Ronin run: phase sampling, smaller shoulder/leg extremes, normalized rotations, loop continuity, immutable source and unchanged scale');

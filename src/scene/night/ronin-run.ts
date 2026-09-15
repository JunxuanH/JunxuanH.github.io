import { AnimationClip, Quaternion, QuaternionLinearInterpolant, LinearInterpolant } from 'three';

/** Retain the authored foot cycle, but soften the sprint's exaggerated jacket/leg poses.
 * Work on a clone once at load time: no per-frame overrides, shared-asset mutation, or scale changes.
 * Walk and run both start with the same leading foot in this Meshy export.
 */
export function refineRoninRun(run: AnimationClip, walk: AnimationClip): AnimationClip {
  const result = run.clone();
  const q = new Quaternion(), target = new Quaternion();
  for (const track of result.tracks) {
    const [bone, property] = track.name.split('.');
    const amount = /Shoulder$/.test(bone) ? .75 : /Arm$/.test(bone) ? .45
      : /UpLeg$|^Hips$|^Spine/.test(bone) ? .2 : /Leg$|Foot$|ToeBase$/.test(bone) ? .2 : 0;
    if (!amount || (property !== 'quaternion' && !(bone === 'Hips' && property === 'position'))) continue;
    const reference = walk.tracks.find((t) => t.name === track.name);
    if (!reference) continue;
    const sample = property === 'quaternion'
      ? new QuaternionLinearInterpolant(reference.times, reference.values, 4)
      : new LinearInterpolant(reference.times, reference.values, 3);
    const size = track.getValueSize();
    for (let i = 0; i < track.times.length; i++) {
      const v = sample.evaluate(track.times[i] / run.duration * walk.duration);
      const offset = i * size;
      if (property === 'quaternion') {
        q.fromArray(track.values, offset); target.fromArray(v);
        q.slerp(target, amount).normalize().toArray(track.values, offset);
      } else {
        for (let c = 0; c < size; c++) track.values[offset + c] += (v[c] - track.values[offset + c]) * amount;
      }
    }
  }
  return result;
}

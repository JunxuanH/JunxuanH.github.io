/**
 * Fixed-size pool of point lights. three bakes the number of active lights into every material's
 * shader, so toggling a district's lights on and off regenerates every shader in the scene (multi-second
 * freezes). The pool keeps the count constant: districts and carriers hand in their light specs each
 * frame and the nearest ones take the slots; the rest sit at intensity 0.
 *
 * Handover is the delicate part. Ranking by distance alone means a step or two of walking can reorder
 * the list, and a slot that jumps to a different spec changes position, colour and intensity between
 * one frame and the next: whole walls change brightness as you approach a district, which reads as the
 * scene itself changing rather than as lighting. Two things keep it quiet. A slot that already holds a
 * spec defends it, so a rival has to be clearly closer to take the slot. And a slot never jumps while
 * lit: it fades out, adopts the new spec dark, then fades up.
 */
import * as THREE from 'three/webgpu';
import type { LightSpec } from './districts/shared';

/** How much closer a rival must be to displace the spec a slot already holds. */
const DEFEND = 0.82;
/** Seconds for a slot to fade out of one spec and up into the next. */
const FADE = 0.28;

const keyOf = (s: LightSpec) => `${s[0]},${s[1]},${s[2]}`;

export function createLightPool(scene: THREE.Scene, size: number) {
  const slots: THREE.PointLight[] = [];
  /** What each slot is currently lighting, and what it is heading toward. */
  const held: (LightSpec | null)[] = [];
  const want: (LightSpec | null)[] = [];
  for (let i = 0; i < size; i++) {
    const l = new THREE.PointLight(0xffffff, 0, 40, 2);
    l.position.set(0, -1000, 0);
    scene.add(l);
    slots.push(l);
    held.push(null);
    want.push(null);
  }
  const scored: { spec: LightSpec; d: number }[] = [];
  const tmp = new THREE.Vector3();

  const update = (specs: LightSpec[], viewer: THREE.Vector3, dt = 1 / 60) => {
    scored.length = 0;
    const incumbents = new Set(held.filter(Boolean).map((s) => keyOf(s!)));
    for (const spec of specs) {
      const d = tmp.set(spec[0], spec[1], spec[2]).distanceTo(viewer);
      // Rank by how much of the light could reach the viewer: intensity over distance, capped by its range.
      const reach = spec[5] ?? 55;
      let score = d > reach * 2.5 ? Infinity : d / Math.sqrt(spec[4]);
      if (score !== Infinity && incumbents.has(keyOf(spec))) score *= DEFEND;
      scored.push({ spec, d: score });
    }
    scored.sort((a, b) => a.d - b.d);

    // The specs that deserve a slot this frame, best first.
    const chosen: LightSpec[] = [];
    for (const s of scored) {
      if (chosen.length >= size) break;
      if (s.d === Infinity) break;
      chosen.push(s.spec);
    }
    const chosenKeys = new Map(chosen.map((s) => [keyOf(s), s]));

    // A slot that still holds a chosen spec keeps it; the rest are free to be reassigned.
    const free: number[] = [];
    for (let i = 0; i < size; i++) {
      const h = held[i];
      if (h && chosenKeys.has(keyOf(h))) {
        want[i] = chosenKeys.get(keyOf(h))!;
        chosenKeys.delete(keyOf(h));
      } else {
        want[i] = null;
        free.push(i);
      }
    }
    const spare = [...chosenKeys.values()];
    for (const i of free) {
      const next = spare.shift();
      want[i] = next ?? null;
    }

    for (let i = 0; i < size; i++) {
      const l = slots[i], target = want[i], h = held[i];
      const same = target && h && keyOf(target) === keyOf(h);
      const goal = same ? target![4] : 0;              // fade out before adopting anything new
      const rate = Math.max(target?.[4] ?? 0, h?.[4] ?? 0, 1) / FADE;
      const step = rate * dt;
      l.intensity = goal > l.intensity ? Math.min(goal, l.intensity + step) : Math.max(goal, l.intensity - step);
      if (same) {
        // Position and colour may still drift with a moving carrier; that is continuous, so it is safe.
        l.position.set(target![0], target![1], target![2]);
        l.color.set(target![3]);
        l.distance = target![5] ?? 55;
      } else if (l.intensity <= 1e-3) {
        // Dark: adopt the new spec now, so nothing visibly jumps.
        held[i] = target;
        if (target) {
          l.position.set(target[0], target[1], target[2]);
          l.color.set(target[3]);
          l.distance = target[5] ?? 55;
        } else {
          l.position.set(0, -1000, 0);
        }
      }
    }
  };
  return { slots, update };
}

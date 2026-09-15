import * as THREE from 'three/webgpu';
import { uniform, mix, float, hash, floor, time } from './tsl';
import gsap from 'gsap';
import { sectionAt, type SectionId } from './journey';
import { reducedMotion } from './palette';
import type { Instance } from './characters';

/*
 * Interactive touches:
 *  - neon signs flicker when the pointer passes over them (raycast at 30 Hz; a per-material `hot`
 *    uniform is attached lazily by wrapping the sign's existing colorNode — signs.ts is untouched);
 *  - nearby NPCs glance at the camera (head bone slerp after the mixer update, torso-yaw fallback);
 *  - arrival triggers when the journey section changes: the pad ring pulses and a hover car lands
 *    at Contact; Education / Projects emit a "gust" for the particle systems;
 *  - clicking the landed car reveals the contact links with a stepped glitch.
 * Reduced motion: no tweens, instant states.
 */

export interface CrowdLike { walkers?: { inst: Instance }[]; instances?: { root: THREE.Object3D; headBone?: THREE.Bone; headY?: number }[] }

export interface InteractOptions {
  camera: THREE.Camera;
  dom: HTMLElement;
  /** Group whose descendant meshes are neon signs (keyed cutouts, canvas signs). */
  signs?: THREE.Group | null;
  crowds?: CrowdLike[];
  padRing?: THREE.Object3D | null;
  landingCar?: THREE.Object3D | null;
  padPosition?: THREE.Vector3 | null;
  onSection?: (id: SectionId, prev: SectionId | null) => void;
  /** Called with a strength (0..1 tween) when a district asks for a gust (Education / Projects). */
  onGust?: (district: SectionId, strength: number) => void;
}


/** Wrap a sign material's colorNode once so a `hot` uniform can drive a flicker burst. */
export function attachHot(mesh: THREE.Mesh): { value: number } | null {
  const mat = mesh.material as any;
  if (!mat || !mat.colorNode) return null;
  if (mat.userData?.hot) return mat.userData.hot;
  const hot = uniform(0);
  mat.colorNode = mat.colorNode.mul(mix(float(1), hash(floor(time.mul(40))).mul(1.6), hot));
  mat.needsUpdate = true;
  mat.userData = { ...(mat.userData ?? {}), hot };
  return hot;
}

export function createInteract(opts: InteractOptions) {
  const { camera, dom } = opts;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(2, 2); // off-screen until the first move
  let pointerDirty = false;
  dom.addEventListener('pointermove', (e) => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    pointerDirty = true;
  }, { passive: true });

  // ---- signs
  const signMeshes: THREE.Mesh[] = [];
  const hotOf = new Map<THREE.Mesh, { value: number }>();
  const refreshSigns = () => {
    signMeshes.length = 0;
    opts.signs?.traverse((o: any) => { if (o.isMesh) signMeshes.push(o); });
  };
  refreshSigns();
  const flicker = (mesh: THREE.Mesh) => {
    let hot = hotOf.get(mesh);
    if (!hot) { const h = attachHot(mesh); if (!h) return; hot = h; hotOf.set(mesh, hot); }
    if (reducedMotion) { hot.value = 0; return; }
    gsap.killTweensOf(hot);
    hot.value = 1;
    gsap.to(hot, { value: 0, duration: 0.4, ease: 'steps(6)' });
  };
  let lastCast = 0;
  let lastHit: THREE.Mesh | null = null;

  // ---- NPC look-at
  const camPos = new THREE.Vector3(), npcPos = new THREE.Vector3(), headPos = new THREE.Vector3(), toCam = new THREE.Vector3(), fwd = new THREE.Vector3();
  const lookM = new THREE.Matrix4(), lookQ = new THREE.Quaternion(), headWorld = new THREE.Quaternion(), parentWorld = new THREE.Quaternion();
  const npcs = (): { root: THREE.Object3D; headBone?: THREE.Bone; headY?: number }[] => {
    const out: { root: THREE.Object3D; headBone?: THREE.Bone; headY?: number }[] = [];
    for (const c of opts.crowds ?? []) {
      if (c.walkers) for (const w of c.walkers) out.push({ root: w.inst.root, headBone: w.inst.headBone, headY: w.inst.headY });
      if (c.instances) out.push(...c.instances);
    }
    return out;
  };
  let npcList = npcs();
  const lookAtCamera = () => {
    camera.getWorldPosition(camPos);
    for (const n of npcList) {
      if (!n.root.visible) continue;
      n.root.getWorldPosition(npcPos);
      toCam.subVectors(camPos, npcPos);
      const d = toCam.length();
      if (d > 8 || d < 0.5) continue;
      toCam.divideScalar(d);
      n.root.getWorldDirection(fwd);
      if (fwd.dot(toCam) < 0.3) continue; // camera behind the NPC
      if (n.headBone) {
        // Runs after the mixers: blend the animated head pose toward a "look at camera" pose.
        const head = n.headBone;
        head.getWorldQuaternion(headWorld);
        head.parent!.getWorldQuaternion(parentWorld);
        // Head world rotation that faces the camera (eye = head, target = camera).
        headPos.set(npcPos.x, npcPos.y + (n.headY ?? 1.5), npcPos.z); // rigs.ts head height (1.5 for carrier NPCs that pass none)
        lookM.lookAt(camPos, headPos, THREE.Object3D.DEFAULT_UP); // three: +Z of the result points from target to eye
        lookQ.setFromRotationMatrix(lookM);
        // desired local = inverse(parentWorld) * lookQ
        const desiredLocal = parentWorld.clone().invert().multiply(lookQ);
        head.quaternion.slerp(desiredLocal, reducedMotion ? 0.6 : 0.6 * 0.15);
      } else {
        const yaw = Math.atan2(toCam.x, toCam.z);
        n.root.rotation.y += (yaw - n.root.rotation.y) * (reducedMotion ? 1 : 0.08);
      }
    }
  };

  // ---- arrival triggers
  let current: SectionId | null = null;
  let landingTween: gsap.core.Tween | gsap.core.Timeline | null = null;
  let landed = false;
  let bobPhase = 0;
  const landCar = () => {
    const car = opts.landingCar, pad = opts.padPosition;
    if (!car || !pad) return;
    car.visible = true;
    landingTween?.kill();
    if (reducedMotion) { car.position.set(pad.x, pad.y + 0.9, pad.z); landed = true; return; }
    car.position.set(pad.x, pad.y + 40, pad.z);
    landed = false;
    landingTween = gsap.to(car.position, { y: pad.y + 0.9, duration: 2.5, ease: 'power2.out', onComplete: () => { landed = true; } });
  };
  const pulsePad = () => {
    const ring = opts.padRing;
    if (!ring) return;
    if (reducedMotion) return;
    gsap.killTweensOf(ring.scale);
    ring.scale.setScalar(1);
    gsap.to(ring.scale, { x: 1.18, y: 1.18, z: 1.18, duration: 0.5, ease: 'power2.out', yoyo: true, repeat: 3 });
  };
  const gust = (id: SectionId) => {
    if (!opts.onGust) return;
    if (reducedMotion) { opts.onGust(id, 0); return; }
    const g = { s: 1 };
    opts.onGust(id, 1);
    gsap.to(g, { s: 0, duration: 3, ease: 'power2.out', onUpdate: () => opts.onGust!(id, g.s) });
  };
  const onSectionChange = (id: SectionId, prev: SectionId | null) => {
    opts.onSection?.(id, prev);
    if (id === 'contact') { pulsePad(); landCar(); }
    if (id === 'education' || id === 'projects') gust(id);
  };

  // ---- click on the landed car → glitch reveal of the contact links
  const reveal = () => {
    const contact = dom.querySelector<HTMLElement>('.contact') ?? document.querySelector<HTMLElement>('.contact');
    if (!contact) return;
    contact.classList.add('is-revealed');
    if (reducedMotion) { contact.style.clipPath = 'none'; return; }
    gsap.fromTo(contact, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.6, ease: 'steps(8)', clearProps: 'clipPath' });
  };
  dom.addEventListener('click', (e) => {
    const car = opts.landingCar;
    if (!car || !car.visible) return;
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    if (raycaster.intersectObject(car, true).length) reveal();
  });

  const update = (dt: number, p: number) => {
    const now = performance.now();
    // Sign hover (30 Hz)
    if (pointerDirty && signMeshes.length && now - lastCast > 33) {
      lastCast = now;
      pointerDirty = false;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(signMeshes, false)[0]?.object as THREE.Mesh | undefined;
      if (hit && hit !== lastHit) flicker(hit);
      lastHit = hit ?? null;
    }
    // NPC glances (after the crowds' mixers ran this frame)
    lookAtCamera();
    // Section changes
    const sec = sectionAt(p);
    if (sec !== current) { const prev = current; current = sec; onSectionChange(sec, prev); }
    // Hover bob once landed
    if (landed && opts.landingCar && opts.padPosition && !reducedMotion) {
      bobPhase += dt;
      opts.landingCar.position.y = opts.padPosition.y + 0.9 + Math.sin(bobPhase * 0.3 * Math.PI * 2) * 0.12;
    }
  };

  return {
    update,
    refreshSigns,
    refreshCrowds: () => { npcList = npcs(); },
    get section() { return current; },
  };
}

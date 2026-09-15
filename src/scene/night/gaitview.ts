/** Interactive, real-rig locomotion QA. Kept out of the landing-page bundle. */
import * as THREE from 'three/webgpu';
import { loadCharacter } from './characters';
import { createPlayer } from './player';
import type { InputState } from './input';

export async function mountGaitView(stage: HTMLElement, hud: HTMLElement, name: string) {
  const player = createPlayer({ asset: await loadCharacter(name), rim: 0xff2bd6 });
  const input: InputState = { move: new THREE.Vector2(), run: false, interact: false, back: false, orbitX: 0, orbitY: 0, skip: false, walkIntent: false, stick: false };
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init(); renderer.setSize(innerWidth, innerHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x10131e); scene.add(player.root);
  scene.add(new THREE.HemisphereLight(0xe3e9ff, 0x3b293a, 2));
  const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(3, 5, 4); scene.add(key);
  const grid = new THREE.GridHelper(200, 200, 0x45aabc, 0x283945); scene.add(grid);
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, .05, 300);
  const toolbar = document.createElement('div'); toolbar.style.cssText = 'position:fixed;top:12px;left:12px;display:flex;gap:8px;flex-wrap:wrap;z-index:2';
  document.body.appendChild(toolbar);
  let mode = 'Idle', report = '', elapsed = 0;
  const setInput = (m: string) => { input.move.set(0, m === 'Idle' ? 0 : m === 'Slow' ? .15 : m === 'Reverse' ? -1 : 1); input.run = m === 'Run'; };
  const button = (label: string, click: () => void) => {
    const b = document.createElement('button'); b.textContent = label;
    b.style.cssText = 'padding:12px;color:#dff;background:#172938;border:1px solid #49b1c4;border-radius:4px;cursor:pointer';
    b.onclick = click; toolbar.appendChild(b);
  };
  for (const label of ['Idle', 'Slow', 'Walk', 'Run', 'Reverse']) button(label, () => { mode = label; });
  button('Run regression checks', () => {
    player.teleport(0, 0, 0, 0);
    const hips = player.inst.model.getObjectByName('Hips');
    const restScale = hips?.scale.clone(); let maxScaleError = 0;
    const rows: string[] = [], failures: string[] = [];
    // Actual player controller + animation mixer, not a duplicate implementation.
    for (const label of ['Idle', 'Slow', 'Walk', 'Run', 'Walk', 'Reverse', 'Idle']) {
      setInput(label); const feet: number[] = [];
      for (let frame = 0; frame < 180; frame++) {
        player.update(1 / 60, input, true);
        if (hips && restScale) maxScaleError = Math.max(maxScaleError, hips.scale.distanceTo(restScale));
        if (frame >= 60 && frame % 6 === 0) {
          player.root.updateMatrixWorld(true);
          feet.push(new THREE.Box3().setFromObject(player.inst.model, true).min.y - player.position.y);
        }
      }
      feet.sort((a, b) => a - b); const planted = feet[Math.floor(feet.length * .2)];
      rows.push(`${label}: ${player.inst.current}, ${player.speed.toFixed(2)} m/s, planted foot ${planted.toFixed(3)} m`);
      if (!Number.isFinite(planted) || Math.abs(planted) > .025) failures.push(`${label} grounding`);
      const expected = label === 'Idle' ? 'idle' : label === 'Run' ? 'run' : 'walk';
      if (player.inst.current !== expected) failures.push(`${label} state`);
    }
    if (!hips || maxScaleError > .001) failures.push('skeleton scale');
    report = `${failures.length ? 'FAIL: ' + failures.join(', ') : 'PASS: actual-rig gait checks'}\n${rows.join('\n')}\nmax skeleton scale error ${maxScaleError.toFixed(6)}`;
    player.teleport(0, 0, 0, 0); mode = 'Idle';
  });
  renderer.setAnimationLoop(() => {
    setInput(mode); player.update(1 / 60, input, true); elapsed += 1 / 60;
    camera.position.copy(player.position).add(new THREE.Vector3(3, 1.5, 4)); camera.lookAt(player.position.x, player.position.y + .95, player.position.z);
    renderer.render(scene, camera);
    if (Math.floor(elapsed * 10) !== Math.floor((elapsed - 1 / 60) * 10)) {
      const action = player.inst.actions.get(player.inst.current ?? 'idle');
      hud.textContent = `${name} · ${mode} · ${player.inst.current} · ${player.speed.toFixed(2)} m/s · playback ${action?.timeScale.toFixed(2)}x\n${report}`;
    }
  });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
}

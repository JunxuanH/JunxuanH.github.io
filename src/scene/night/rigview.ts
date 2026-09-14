/**
 * Rig QA viewer behind /lab/characters (no city, fast boot). Modes by query string:
 *   ?name=agent&clip=walk|run|idle&t=0.3&view=front|side|back|three&raw=1&skin=1&speed=1
 *       one rig on a 1 m grid with the +z arrow (runtime forward), the rest bbox, a head-height
 *       marker and a HUD with the rigs.ts row and the audit numbers/flags. `raw=1` shows the rig as
 *       loaded (no pivot: yaw / groundOffset / height from rigs.ts are not applied); `t` freezes the clip.
 *   ?sheet=all&clip=walk&view=front&t=0.3[&raw=1&cols=7&flags=1]
 *       contact sheet: one orthographic cell per rig (7 × 3), ground line at y = 0, labels as DOM
 *       (name, height, flags when `flags=1`).
 *   ?turntable=agent[&clip=idle&t=0]   front / three-quarter / side / back strip for the README.
 *   ?audit=all|a,b[&fixed=1&samples=32]  runs rigaudit.ts for each rig and publishes
 *       window.__audit = { done, rigs, errors } (+ a table in the HUD). `fixed=1` audits the runtime
 *       instance (pivot applied) instead of the raw rig.
 * window.__view = { ready, mode, names, renderer, scene } for the Playwright drivers (scripts/rig-audit.mjs).
 */
import * as THREE from 'three/webgpu';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { loadCharacter, instantiate, type CharacterAsset } from './characters';
import { RIG_NAMES, rigMeta, groundOffsetFor } from './rigs';
import { auditRig, setRigMetaProvider, type RigAudit } from './rigaudit';

type View = 'front' | 'side' | 'back' | 'three';

const esc = (s: unknown) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const fmt = (v: unknown) => (typeof v === 'number' ? (Number.isFinite(v) ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(3)) : 'NaN') : String(v));

/** A rig on the stage: the raw clone or the runtime instance, plus its mixer and helpers. */
interface Shown {
  name: string;
  asset: CharacterAsset;
  root: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  height: number;
}

function show(asset: CharacterAsset, raw: boolean, skin: boolean, clip: string, t: number | null): Shown {
  let root: THREE.Object3D, mixer: THREE.AnimationMixer, actions: Map<string, THREE.AnimationAction>, height: number;
  if (raw) {
    root = SkeletonUtils.clone(asset.scene) as THREE.Object3D;
    mixer = new THREE.AnimationMixer(root);
    actions = new Map();
    for (const [n, c] of asset.clips) actions.set(n, mixer.clipAction(c));
    height = asset.height;
  } else {
    const inst = instantiate(asset, { skin: skin ? undefined : false, glow: skin });
    root = inst.root; mixer = inst.mixer; actions = inst.actions; height = inst.height;
    inst.blob.visible = false;
  }
  const a = actions.get(clip) ?? actions.get('idle') ?? [...actions.values()][0];
  if (a) { a.play(); if (t !== null) { mixer.setTime(t); a.paused = true; } }
  return { name: asset.name, asset, root, mixer, actions, height };
}

function helpers(height: number) {
  const g = new THREE.Group();
  const grid = new THREE.GridHelper(4, 4, 0x00e5ff, 0x30404a);
  (grid.material as THREE.Material).transparent = true; (grid.material as any).opacity = 0.5;
  g.add(grid);
  g.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.015, 0), 0.9, 0x00e5ff, 0.18, 0.1));
  g.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.015, 0), 0.5, 0xff4060, 0.12, 0.07)); // +x = the rig's left
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.025, 12, 8), new THREE.MeshBasicMaterial({ color: 0xf2ff3d }));
  head.name = 'head-marker';
  head.position.set(0, height, 0.4);
  g.add(head);
  return { group: g, head };
}

function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xbfd0ff, 0x303038, 1.3));
  for (const [x, y, z, i] of [[3, 4, 4, 3.0], [-4, 2, 2, 1.4], [0, 3, -4, 1.8]] as const) {
    const l = new THREE.DirectionalLight(0xffffff, i); l.position.set(x, y, z); scene.add(l);
  }
}

function placeCamera(cam: THREE.Camera, view: View, cx: number, h: number, d: number) {
  const y = h * 0.52;
  if (view === 'front') cam.position.set(cx, y, d);
  else if (view === 'back') cam.position.set(cx, y, -d);
  else if (view === 'side') cam.position.set(cx + d, y, 0);
  else cam.position.set(cx + d * 0.72, y + h * 0.12, d * 0.72);
  cam.lookAt(cx, y, 0);
}

const names = (v: string | null, fallback = RIG_NAMES) => (!v || v === 'all' ? fallback : v.split(',').map((s) => s.trim()).filter(Boolean));

export async function mountRigView(stage: HTMLElement, hud: HTMLElement) {
  const q = new URLSearchParams(location.search);
  setRigMetaProvider((n, a) => rigMeta(n, a), groundOffsetFor);
  const w = window as any;
  w.__view = { ready: false, mode: 'boot' };
  const raw = q.get('raw') === '1';
  const clipName = q.get('clip') ?? 'walk';
  const tParam = q.get('t');
  const tFreeze = tParam !== null ? Number(tParam) : null;
  const view = (q.get('view') ?? 'front') as View;
  const speed = Number(q.get('speed') ?? 1);

  // ---------- audit mode: no renderer
  if (q.has('audit')) {
    const list = names(q.get('audit'));
    const fixed = q.get('fixed') === '1';
    const samples = Number(q.get('samples') ?? 32);
    const rigs: Record<string, RigAudit> = {}, errors: Record<string, string> = {};
    w.__audit = { done: false, fixed, rigs, errors };
    w.__view = { ready: true, mode: 'audit', names: list };
    const rows: string[] = [];
    const render = () => { hud.innerHTML = `<b>audit ${fixed ? '(runtime pivot)' : '(raw)'}</b> ${Object.keys(rigs).length}/${list.length}\n` + rows.join('\n'); };
    render();
    for (const n of list) {
      try {
        const asset = await loadCharacter(n);
        const a = auditRig(asset, { fixed, samples });
        rigs[n] = a;
        rows.push(`${n.padEnd(18)} h ${fmt(a.bboxRest.height)} yaw ${a.yawErr}° ${a.mirrored ? 'MIRRORED ' : ''}ground ${fmt(a.groundOffset)} stride ${fmt(a.clips.walk?.stride)}/${fmt(a.clips.run?.stride)} disp ${fmt(a.maxDisp)} stray ${(a.strayWeights * 100).toFixed(1)}% stretch ${fmt(a.stretch)} tracks ${a.redundantTracks}/${a.totalTracks} · ${a.flags.join(', ') || 'ok'} (${a.ms} ms)`);
      } catch (e: any) {
        errors[n] = String(e?.message ?? e);
        rows.push(`${n.padEnd(18)} ERROR ${errors[n]}`);
        console.error('[rigview] audit', n, e);
      }
      render();
      await new Promise((r) => setTimeout(r, 0));
    }
    w.__audit.done = true;
    return;
  }

  // ---------- renderer for the visual modes
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.NeutralToneMapping;
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d14);
  lights(scene);
  const clock = new THREE.Timer();
  const shown: Shown[] = [];
  const mode = q.has('sheet') ? 'sheet' : q.has('turntable') ? 'turntable' : 'single';
  const lines: string[] = [];

  const step = () => {
    clock.update();
    const dt = Math.min(clock.getDelta(), 0.05) * speed;
    if (tFreeze === null) for (const s of shown) s.mixer.update(dt);
  };

  if (mode === 'sheet') {
    const list = names(q.get('sheet'));
    const cols = Number(q.get('cols') ?? 7), rows = Math.ceil(list.length / cols);
    const spacing = 6;
    const ground = new THREE.GridHelper(spacing * (list.length + 2), spacing * (list.length + 2), 0x2a3a44, 0x1a2430);
    ground.position.x = (spacing * (list.length - 1)) / 2;
    scene.add(ground);
    const audits: Record<string, RigAudit> = {};
    const wantAudit = q.get('flags') === '1';
    await Promise.all(list.map(async (n, i) => {
      try {
        const asset = await loadCharacter(n);
        const s = show(asset, raw, q.get('skin') === '1', clipName, tFreeze);
        s.root.position.x = i * spacing;
        scene.add(s.root);
        const h = helpers(rigMeta(n, asset).headY * (s.height / asset.height));
        h.group.position.x = i * spacing;
        scene.add(h.group);
        shown[i] = s;
        if (wantAudit) audits[n] = auditRig(asset, { fixed: !raw });
      } catch (e: any) { lines.push(`${n}: ${e?.message ?? e}`); console.error('[rigview]', n, e); }
    }));
    // Labels as DOM over each cell.
    const labels = document.createElement('div');
    labels.className = 'labels';
    labels.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    labels.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
    for (let i = 0; i < list.length; i++) {
      const n = list[i], a = audits[n], m = rigMeta(n, shown[i]?.asset);
      const el = document.createElement('div');
      el.className = 'label' + (a?.flags.length ? ' is-flagged' : '');
      el.innerHTML = `<b>${esc(n)}</b> ${m.height.toFixed(2)} u${m.ok ? '' : ' · <s>off</s>'}` + (a ? `<br>${esc(a.flags.join(', ') || 'ok')}` : '');
      labels.appendChild(el);
    }
    stage.appendChild(labels);
    hud.innerHTML = `<b>sheet</b> ${list.length} rigs · clip ${esc(clipName)} · view ${esc(view)} · t ${tFreeze ?? 'live'} · ${raw ? 'raw' : 'runtime pivot'}` + (lines.length ? '\n' + lines.map(esc).join('\n') : '');
    const cams = list.map(() => new THREE.OrthographicCamera(-1, 1, 1, -1, 6, 14)); // 10 u out: the clip planes exclude the neighbours (6 u apart)
    const draw = () => {
      step();
      const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
      const cw = W / cols, ch = H / rows;
      const fh = 2.6, fw = fh * (cw / ch);
      for (let i = 0; i < list.length; i++) {
        const cam = cams[i];
        cam.left = -fw / 2; cam.right = fw / 2; cam.top = fh / 2; cam.bottom = -fh / 2; cam.updateProjectionMatrix();
        const cx = i * spacing;
        // Ortho: look straight along the axis, centred at fh/2 − 0.2 so the ground line sits near the bottom.
        const cy = fh / 2 - 0.25;
        if (view === 'front') cam.position.set(cx, cy, 10); else if (view === 'back') cam.position.set(cx, cy, -10); else if (view === 'side') cam.position.set(cx + 10, cy, 0); else cam.position.set(cx + 7, cy, 7);
        cam.lookAt(cx, cy, 0);
        const col = i % cols, row = Math.floor(i / cols);
        const x = col * cw, y = row * ch; // three's WebGPURenderer viewport: y from the top (the WebGL backend flips)
        renderer.setViewport(x, y, cw, ch); renderer.setScissor(x, y, cw, ch); renderer.setScissorTest(true);
        renderer.autoClear = i === 0;
        renderer.render(scene, cam);
      }
    };
    renderer.setAnimationLoop(draw);
    w.__view = { ready: true, mode, names: list, renderer, scene, audits, shown };
    addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
    return;
  }

  if (mode === 'turntable') {
    const n = q.get('turntable')!;
    const asset = await loadCharacter(n);
    const s = show(asset, raw, q.get('skin') === '1', q.get('clip') ?? 'idle', tFreeze ?? 0.4);
    scene.add(s.root);
    const h = helpers(rigMeta(n, asset).headY * (s.height / asset.height));
    h.head.visible = false;
    scene.add(h.group);
    shown.push(s);
    const views: View[] = ['front', 'three', 'side', 'back'];
    const cams = views.map(() => new THREE.PerspectiveCamera(28, 1, 0.05, 50));
    hud.innerHTML = `<b>${esc(n)}</b> ${s.height.toFixed(2)} u · ${views.join(' / ')} · ${esc(q.get('clip') ?? 'idle')} @ ${tFreeze ?? 0.4}s`;
    const draw = () => {
      step();
      const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight, cw = W / 4;
      views.forEach((v, i) => {
        const cam = cams[i];
        cam.aspect = cw / H; cam.updateProjectionMatrix();
        placeCamera(cam, v, 0, s.height, (s.height * 0.75) / Math.tan(THREE.MathUtils.degToRad(14)));
        renderer.setViewport(i * cw, 0, cw, H); renderer.setScissor(i * cw, 0, cw, H); renderer.setScissorTest(true);
        renderer.autoClear = i === 0;
        renderer.render(scene, cam);
      });
    };
    renderer.setAnimationLoop(draw);
    w.__view = { ready: true, mode, names: [n], renderer, scene, shown };
    addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));
    return;
  }

  // ---------- single rig
  const n = q.get('name') ?? 'agent';
  const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 100);
  try {
    const asset = await loadCharacter(n);
    const meta = rigMeta(n, asset);
    const s = show(asset, raw, q.get('skin') === '1', clipName, tFreeze);
    scene.add(s.root);
    shown.push(s);
    const scale = s.height / asset.height;
    const h = helpers(meta.headY * scale);
    scene.add(h.group);
    // Rest bbox (bind pose = rest pose for Meshy rigs) in world units.
    s.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(s.root, true);
    const bh = new THREE.Box3Helper(box, new THREE.Color(0xff2bd6));
    scene.add(bh);
    placeCamera(camera, view, 0, s.height, (s.height * 0.72) / Math.tan(THREE.MathUtils.degToRad(15)));
    const audit = q.get('audit') === '0' ? null : auditRig(asset, { fixed: !raw });
    const files: string[] = asset.meta?.files ?? [];
    const sizes = await Promise.all(files.map(async (f) => {
      try { const r = await fetch(`/night/characters/${n}/${f}`, { method: 'HEAD' }); const b = Number(r.headers.get('content-length')); return `${f} ${b ? (b / 1024).toFixed(0) + ' KB' : '?'}`; } catch { return `${f} ?`; }
    }));
    const clipList = [...asset.clips.entries()].map(([k, c]) => `${k} ${c.duration.toFixed(2)}s/${c.tracks.length}t`).join(' · ');
    lines.push(
      `<b>${esc(n)}</b> ${raw ? 'raw rig' : 'runtime pivot'} · clip <b>${esc(clipName)}</b>${tFreeze !== null ? ` @ ${tFreeze}s` : ''} · view ${view}`,
      `meta   h ${meta.height} yaw ${meta.yaw.toFixed(3)} stride ${meta.stride}/${meta.strideRun} ground ${meta.groundOffset} headY ${meta.headY} step ${meta.stepLen}/${meta.stepLenRun} ok ${meta.ok}`,
      meta.note ? `note   ${esc(meta.note)}` : '',
      `asset  raw h ${asset.height.toFixed(3)} (meta.json ${asset.meta?.height_meters ?? '?'}) · bbox ${box.min.y.toFixed(3)}…${box.max.y.toFixed(3)} · clips ${esc(clipList)}`,
    );
    if (audit) {
      lines.push(
        `audit  bbox ${fmt(audit.bboxRest.height)} (${fmt(audit.bboxRest.width)}×${fmt(audit.bboxRest.depth)}) minY ${fmt(audit.bboxRest.minY)} headY ${fmt(audit.headY)} top ${fmt(audit.headTopY)} hips ${fmt(audit.hipsY)}`,
        `       forward ${audit.forwardSource} [${audit.forward.join(', ')}] yaw ${audit.yawErr}° walk-yaw ${fmt(audit.walkYawErr)}° mirrored ${audit.mirrored}`,
        `       ground ${fmt(audit.groundOffset)} floating ${audit.floating} sinking ${audit.sinking} hover ${audit.hover} hipsDrift ${fmt(audit.hipsDrift)}`,
        `       maxDisp ${fmt(audit.maxDisp)} stray ${(audit.strayWeights * 100).toFixed(2)}% [${esc(audit.strayBones.join(' '))}] stretch ${fmt(audit.stretch)}`,
        `       stride ${fmt(audit.clips.walk?.stride)} (${audit.clips.walk?.cycles ?? 0} cyc, step ${fmt(audit.clips.walk?.stepLen)}) run ${fmt(audit.clips.run?.stride)} (step ${fmt(audit.clips.run?.stepLen)}) · tracks ${audit.redundantTracks} redundant / ${audit.totalTracks} · ${audit.vertices} v ${audit.triangles} t ${audit.bones} bones`,
        `<b>flags</b>  ${esc(audit.flags.join(', ') || 'ok')}`,
      );
    }
    lines.push(sizes.join(' · '));
    w.__view = { ready: true, mode, names: [n], renderer, scene, camera, audit, shown };
  } catch (e: any) {
    lines.push(`<b>error</b> ${esc(e?.message ?? e)}`);
    console.error(e);
    w.__view = { ready: true, mode, names: [n], error: String(e?.message ?? e) };
  }
  hud.innerHTML = lines.filter(Boolean).join('\n');
  const spin = q.get('spin') === '1';
  renderer.setAnimationLoop(() => {
    step();
    if (spin) for (const s of shown) s.root.rotation.y += 0.01;
    renderer.render(scene, camera);
  });
  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
}

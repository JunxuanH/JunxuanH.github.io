// Local dev-server regression checks for scene transitions, camera clearance and NPC motion.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs');
const base = process.argv[2] || 'http://127.0.0.1:4332';
const audit = process.argv.includes('--audit');
const browser = await chromium.launch({ executablePath: process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`, headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const out = 'design/night/shots/scene-review'; mkdirSync(out, { recursive: true });
try {
  const page = await browser.newPage();
  await page.goto(base + '/?flat');
  const checks = await page.evaluate(async () => {
    const { buildAreas, limitCamera, resolve } = await import('/src/scene/night/walkable.ts');
    const { DISTRICT_CROWDS } = await import('/src/scene/night/paths.ts');
    const { createCrowd } = await import('/src/scene/night/characters.ts');
    const { createNav } = await import('/src/scene/night/nav.ts');
    const { setReducedMotion } = await import('/src/scene/night/palette.ts');
    // The app and the regression objects must use the same Three.js module instance.
    const THREE = await import('/node_modules/three/build/three.webgpu.js');
    const areas = buildAreas();
    const pivot = new THREE.Vector3(0, .6, 0), boom = new THREE.Vector3(0, 2, 5);
    limitCamera({section: 'work', rects:[{x0:-10,x1:10,z0:-10,z1:10,y:0}], obstacles:[{kind:'box',x0:-1,x1:1,z0:.1,z1:1,h:4}]}, pivot, boom);
    const routeHits = [];
    for (const row of DISTRICT_CROWDS) {
      const section = {'education-plaza':'education','projects-market':'projects','contact-pad':'contact'}[row.path.id];
      if (!section) continue;
      const curve = new THREE.CatmullRomCurve3(row.path.points.map(p => new THREE.Vector3(...p)), row.path.closed, 'centripetal');
      for (let i=0;i<=400;i++) {
        const p = curve.getPointAt(i/400), next=p.clone();
        resolve(areas[section], next, p, .35);
        if (Math.hypot(next.x-p.x,next.z-p.z)>.01) routeHits.push({path:row.path.id,t:i/400,p:p.toArray()});
      }
    }
    const scene = new THREE.Group(); scene.add(new THREE.Mesh(new THREE.BoxGeometry(.5,1.8,.4)));
    const asset = {name:'test',scene,height:1.8,clips:new Map()};
    const crowd=createCrowd({assets:[asset],count:1,path:{id:'test',closed:false,points:[[0,0,0],[0,0,10]]}});
    const cam=new THREE.PerspectiveCamera(); const w=crowd.walkers[0];
    crowd.update(1/60,cam); w.hold(new THREE.Vector3(3,3,3));
    for(let i=0;i<60;i++) crowd.update(1/60,cam);
    const upright=new THREE.Vector3(0,1,0).applyQuaternion(w.root.quaternion).y;
    // A stall may be off the centreline: resuming must not teleport to it.
    w.root.position.x=1; const before=w.root.position.clone(); w.release(); crowd.update(1/60,cam);
    const resumeStep=w.root.position.distanceTo(before);
    setReducedMotion(true);
    const nav=createNav({journey:{p:0}}); nav.start(); nav.panTo('education');
    const fadeSource=nav.section;
    for(let i=0;i<12;i++) nav.tick(1/30);
    const revealDestination=nav.section;
    for(let i=0;i<12;i++) nav.tick(1/30);
    setReducedMotion(false);
    nav.panTo('work');
    for(let i=0;i<4;i++) nav.tick(1/30);
    nav.dock('amd-intern');
    const blockedDock=nav.mode;
    for(let i=0;i<55;i++) nav.tick(1/30);
    const settled={beat:nav.cutscene?.beat??null,mode:nav.mode,section:nav.section};
    return {cameraBoom:pivot.distanceTo(boom),upright,resumeStep,routeHits,fadeSource,revealDestination,settled,blockedDock};
  });
  console.log(JSON.stringify({...checks,routeHits:checks.routeHits.length,examples:checks.routeHits.filter((_,i)=>i%30===0)},null,2));
  writeFileSync(`${out}/geometry.json`,JSON.stringify(checks,null,2));
  if (!audit) {
    assert.ok(checks.cameraBoom < 2,'immediate obstruction must shorten camera boom');
    assert.ok(checks.upright > .9999,'talking NPC must remain upright');
    assert.ok(checks.resumeStep < .05,'NPC resumes without a teleport');
    assert.equal(checks.routeHits.length,0,'district crowd routes must clear static obstacles');
    assert.equal(checks.fadeSource,'city','reduced motion retains source district until black');
    assert.equal(checks.revealDestination,'education','destination appears during reveal');
    assert.deepEqual(checks.settled,{beat:null,mode:'walk',section:'work'},'every location change ends walking the destination');
    assert.equal(checks.blockedDock,'walk','interactions must not interrupt the fade');
  }
  await page.close();
} finally { await browser.close(); }

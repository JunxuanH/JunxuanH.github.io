// End-to-end resident dialogue, the fade's input lock, and rapid navigation checks.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs');
const base=process.argv[2] || 'http://127.0.0.1:4333/';
const browser=await chromium.launch({executablePath:process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,headless:true,args:['--enable-unsafe-webgpu','--enable-gpu','--use-angle=metal','--ignore-gpu-blocklist']});
const out='design/night/shots/scene-review'; mkdirSync(out,{recursive:true});
try {
  for(const phone of [false,true]) {
    const name=phone?'phone':'desktop';
    if(process.argv[3] && process.argv[3]!==name) continue;
    const page=await browser.newPage({viewport:phone?{width:393,height:852}:{width:1440,height:900},hasTouch:phone,isMobile:phone});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'?nolanding');
    await page.waitForFunction(()=>window.__nav && document.documentElement.classList.contains('is-landed'),null,{timeout:120000});
    const jump=async(section)=>{await page.locator(`.nav a[data-section="${section}"]`).click();};
    const settled=async(section)=>{await page.waitForFunction(s=>window.__nav.section===s && !window.__nav.cutscene && window.__nav.mode==='walk',section,{timeout:60000});};
    await page.locator('#hero-copy .neon-btn.primary').click();
    await page.waitForFunction(()=>window.__nav.cutscene?.beat==='reveal',null,{timeout:30000});
    // Hold W from the start of the reveal (the character is already placed) until the fade ends: it must not move.
    const moved=await page.evaluate(()=>new Promise(res=>{
      const p0=window.__player.position.clone();
      dispatchEvent(new KeyboardEvent('keydown',{code:'KeyW',key:'w'}));
      const loop=()=>{ if(window.__nav.cutscene) return requestAnimationFrame(loop);
        dispatchEvent(new KeyboardEvent('keyup',{code:'KeyW',key:'w'})); res(window.__player.position.distanceTo(p0)); };
      requestAnimationFrame(loop);
    }));
    assert.ok(moved<.01,`movement locked during the fade (moved ${moved})`);
    await settled('education');
    // Place the test visitor on the clear approach, then exercise the actual keyboard/touch interaction.
    await page.evaluate(()=>window.__player.teleport(-81.6,.22,-95.6,Math.PI));
    await page.waitForFunction(()=>window.__dialogue.targetName==='RIN');
    if(phone) {
      const button=await page.locator('[data-act="interact"]').boundingBox();
      assert.ok(button); await page.touchscreen.tap(button.x+button.width/2,button.y+button.height/2);
    } else await page.keyboard.press('f');
    await page.waitForFunction(()=>window.__dialogue.open,null,{timeout:5000});
    await page.waitForTimeout(2000); await page.screenshot({path:`${out}/${name}-resident.png`});
    assert.ok((await page.evaluate(()=>window.__dialogue.text)).length>0);
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!window.__dialogue.open && !window.__dialogue.held);
    await jump('projects'); await page.waitForTimeout(500); await jump('contact'); await page.waitForTimeout(500); await jump('work');
    await settled('work');
    assert.equal(await page.locator('.dlg:not([hidden])').count(),0,'dialogue closes across navigation');
    await page.screenshot({path:`${out}/${name}-redirect.png`});
    assert.deepEqual(errors,[]);
    console.log(`PASS ${name}: fade input lock, resident conversation/release, rapid redirect`);
    await page.close();
  }
} finally {await browser.close();}

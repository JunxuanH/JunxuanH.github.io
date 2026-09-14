// Grab frames of a generated ad loop in Chrome (the bundled ffmpeg can't decode H.264) to judge loop quality.
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const [,, url = 'http://localhost:4322/night/ads/ad-3-loop.mp4', out = 'design/night/ads/ad-3-loop-frames.png'] = process.argv;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 560 } });
await page.setContent(`<body style="margin:0;background:#111;display:flex;gap:8px">${[0, 1.3, 2.6, 3.95].map((t) => `<video data-t="${t}" src="${url}" muted playsinline style="height:540px"></video>`).join('')}</body>`);
await page.evaluate(async () => {
  for (const v of document.querySelectorAll('video')) {
    await new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true }));
    v.currentTime = Number(v.dataset.t);
    await new Promise((r) => v.addEventListener('seeked', r, { once: true }));
  }
  return Array.from(document.querySelectorAll('video')).map((v) => `${v.duration.toFixed(2)}s ${v.videoWidth}x${v.videoHeight}`).join(', ');
}).then(console.log);
await page.screenshot({ path: out });
await browser.close();

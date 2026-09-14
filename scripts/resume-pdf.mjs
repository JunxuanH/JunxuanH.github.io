// Prints /resume to public/Ivan-He-Resume.pdf with the headless Chrome used by shot.mjs. Run against the dev server:
//   node scripts/resume-pdf.mjs [http://localhost:4321/resume]
import { chromium } from '/private/tmp/claude-501/-Users-ivan-Desktop-Projects/b7838c10-cf27-4bee-97f1-abc644ec1d9e/scratchpad/pw/node_modules/playwright-core/index.mjs';
const [,, url = 'http://localhost:4321/resume', out = 'public/Ivan-He-Resume.pdf'] = process.argv;
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto(url, { waitUntil: 'networkidle' });
await page.emulateMedia({ media: 'print' });
await page.pdf({ path: out, format: 'Letter', printBackground: false, preferCSSPageSize: true });
await browser.close();
console.log('wrote', out);

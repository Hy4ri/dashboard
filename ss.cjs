const { chromium } = require('playwright');

const url = process.argv[2] || 'http://localhost:8080/';
const out = process.argv[3] || '/tmp/dash-ss.png';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: out, fullPage: true });
  await browser.close();
  console.log('Screenshot: ' + out);
})();

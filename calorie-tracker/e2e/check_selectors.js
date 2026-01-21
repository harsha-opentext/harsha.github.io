const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const url = process.env.TEST_URL || 'http://localhost:8000/calorie-tracker/index.html';
  console.log('Checking URL:', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  const content = await page.content();
  console.log('PAGE CONTENT (first 1000 chars):\n', content.slice(0, 1000));
  const selectors = ['#open-csv-btn', '#csv-parse', '#csv-import-all', '#csv-copy-example', '#csv-back', 'textarea#csv-input'];
  for (const s of selectors) {
    const count = await page.$$eval(s, els => els.length).catch(() => 0);
    console.log(s, '=>', count);
  }
  // Also dump whether csv modal is present
  const modalCount = await page.$$eval('#csv-modal', els => els.length).catch(() => 0);
  console.log('#csv-modal =>', modalCount);
  await browser.close();
})();

const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const url = process.env.TEST_URL || 'http://localhost:8000/index.html';
  console.log('Loading', url);
  await page.goto(url, { waitUntil: 'networkidle' });

  // Ensure openCsvImport exists and call it
  const hasFn = await page.evaluate(() => typeof window.openCsvImport === 'function');
  console.log('openCsvImport exists?', hasFn);
  await page.evaluate(() => { try { window.openCsvImport(); } catch(e) { console.error(e); } });

  // Give browser a moment to update DOM
  await page.waitForTimeout(200);

  // Get modal display and parse/import button styles
  const info = await page.evaluate(() => {
    const modal = document.getElementById('csv-modal');
    const parse = document.getElementById('csv-parse');
    const importAll = document.getElementById('csv-import-all');
    const inputSection = document.getElementById('csv-input-section');
    const previewSection = document.getElementById('csv-preview-section');
    function cs(el) { try { return window.getComputedStyle(el).cssText; } catch(e) { return null; } }
    return {
      modalExists: !!modal,
      modalDisplay: modal ? cs(modal) : null,
      modalOuterHTML: modal ? modal.outerHTML.slice(0, 500) : null,
      parseExists: !!parse,
      parseDisplay: parse ? cs(parse) : null,
      parseOuterHTML: parse ? parse.outerHTML : null,
      importExists: !!importAll,
      importDisplay: importAll ? cs(importAll) : null,
      importOuterHTML: importAll ? importAll.outerHTML : null,
      inputSectionDisplay: inputSection ? cs(inputSection) : null,
      previewSectionDisplay: previewSection ? cs(previewSection) : null,
    };
  });

  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();

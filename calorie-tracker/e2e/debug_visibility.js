const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const url = process.env.TEST_URL || 'http://localhost:8000/index.html';
  console.log('Loading', url);
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate(() => { if (window.openCsvImport) window.openCsvImport(); });
  await page.waitForTimeout(200);

  const check = await page.evaluate(() => {
    function infoFor(sel) {
      const el = document.querySelector(sel);
      if (!el) return { exists: false };
      const cs = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        exists: true,
        tag: el.tagName,
        id: el.id,
        classes: el.className,
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        zIndex: cs.zIndex,
        isConnected: el.isConnected
      };
    }

    return {
      modal: infoFor('#csv-modal'),
      parseBtn: infoFor('#csv-parse'),
      importBtn: infoFor('#csv-import-all'),
      bodyRect: document.body.getBoundingClientRect(),
      scrollY: window.scrollY,
      innerHeight: window.innerHeight
    };
  });

  console.log(JSON.stringify(check, null, 2));
  await browser.close();
})();

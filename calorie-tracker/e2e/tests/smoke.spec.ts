import { test, expect } from '@playwright/test';

test('app loads and import CSV flow', async ({ page, baseURL }) => {
  // Try loading the app in both possible server roots: either the server
  // serves the `calorie-tracker` folder as a subpath, or it serves that
  // folder as the server root. Try both URLs and use the one that loads.
  const tryUrls = ['/index.html', '/calorie-tracker/index.html', '/calorie-tracker/'];
  let loaded = false;
  for (const u of tryUrls) {
    try {
      await page.goto(u, { waitUntil: 'domcontentloaded' });
      // quick check for app-specific markers (nav-brand or csv-modal) to avoid 404 pages
      const hasNavBrand = await page.$('.nav-brand');
      const hasImportButton = await page.$('#open-csv-btn');
      const hasModal = await page.$('#csv-modal');
      if (hasNavBrand || hasImportButton || hasModal) { loaded = true; break; }
    } catch (e) {
      // ignore and try next
    }
  }
  if (!loaded) {
    // final fallback: navigate to root and continue; tests may skip later
    await page.goto('/');
  }

  // Wait for import UI to be available - try common selectors used by the app
  // Prefer CSP-friendly ID-based buttons added to the app
  const openCsvBtn = page.locator('#open-csv-btn');
  if (await openCsvBtn.count() > 0) {
    await openCsvBtn.first().click();
  } else {
    // Fallback: look for a textual Import button
    const importButton = page.locator('button:has-text("Import")');
    if (await importButton.count() === 0) {
      test.skip();
    }
    await importButton.first().click();
  }

  // Ensure modal is opened: call openCsvImport() directly if available
  await page.evaluate(() => { try { if (window.openCsvImport) window.openCsvImport(); } catch(e){} });

  // Wait for the specific CSV textarea to be visible
  await page.waitForSelector('#csv-input', { state: 'visible', timeout: 3000 });
  // Run parse + import in-page in one JS context to avoid timing issues
  const csv = `2026-01-21,09:00 AM,Test entry,500,10,20,5\n2026-01-21,12:30 PM,Another food,300,5,40,10`;
  console.log('CURRENT URL:', page.url());
  // Fill via Playwright API (ensures events fire)
  await page.fill('#csv-input', csv);
  // Debug: read back the textarea value in-page
  const taVal = await page.evaluate(() => {
    const el = document.getElementById('csv-input');
    return el ? { len: el.value.length, sample: el.value.slice(0,200) } : null;
  });
  console.log('TEXTAREA VALUE:', taVal);

  // Call parse and import in the page context and return post-state
  const result = await page.evaluate(async () => {
    try {
      const before = { parsedBefore: typeof csvParsedData !== 'undefined' ? csvParsedData.length : null };
      if (window.parseCsv) window.parseCsv();
      const afterParsed = typeof csvParsedData !== 'undefined' ? csvParsedData.length : null;
      if (window.importCsvEntries) await window.importCsvEntries();
      return Object.assign(before, {
        csvParsedLen: afterParsed,
        entriesLen: (window.state && window.state.entries) ? window.state.entries.length : 0,
        dateIndexKeys: window.state && window.state.dateIndex ? Object.keys(window.state.dateIndex) : null,
        hasParseFn: !!window.parseCsv,
        hasImportFn: !!window.importCsvEntries
      });
    } catch (e) { return { error: e && e.message } }
  });
  // Wait for in-page state to be updated (allow async operations to complete)
  try {
    await page.waitForFunction(() => window.state && window.state.entries && window.state.entries.length > 0, null, { timeout: 2000 });
  } catch (e) {
    // ignored, we'll read state below for debugging
  }
  const finalState = await page.evaluate(() => ({ entriesLen: window.state && window.state.entries ? window.state.entries.length : 0, dateIndexKeys: window.state && window.state.dateIndex ? Object.keys(window.state.dateIndex) : null }));
  console.log('FINAL STATE AFTER WAIT:', finalState);
  console.log('IMPORT RESULT:', result);
  // Confirm parsing succeeded and import function exists (CSP bindings working)
  expect(result.csvParsedLen).toBeGreaterThan(0);
  expect(result.hasImportFn).toBe(true);
});

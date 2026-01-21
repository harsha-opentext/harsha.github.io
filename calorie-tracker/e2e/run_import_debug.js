const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const url = process.env.TEST_URL || 'http://localhost:8000/index.html';
  console.log('Loading', url);
  await page.goto(url, { waitUntil: 'networkidle' });

  // open modal
  await page.evaluate(() => { if (window.openCsvImport) window.openCsvImport(); });
  await page.waitForTimeout(100);

  // fill textarea
  const csv = `2026-01-21,09:00 AM,Test entry,500,10,20,5\n2026-01-21,12:30 PM,Another food,300,5,40,10`;
  await page.fill('#csv-input', csv);

  // call parse
  await page.evaluate(() => { if (window.parseCsv) window.parseCsv(); });
  await page.waitForTimeout(200);

  // inspect parsed data
  const parsedInfo = await page.evaluate(() => {
    return {
      csvParsedLen: (typeof csvParsedData !== 'undefined') ? csvParsedData.length : null,
      sampleParsed: (typeof csvParsedData !== 'undefined' && csvParsedData.length>0) ? csvParsedData[0] : null,
      hasGitHubPerDayAPI: !!window.GitHubPerDayAPI,
      hasPushToGit: !!window.pushToGit
    };
  });
  console.log('After parse:', parsedInfo);

  // call import
  await page.evaluate(() => { if (window.importCsvEntries) window.importCsvEntries(); });
  await page.waitForTimeout(400);

  // inspect state
  const stateInfo = await page.evaluate(() => {
    try {
      return {
        entriesLen: state.entries ? state.entries.length : null,
        dateIndexKeys: state.dateIndex ? Object.keys(state.dateIndex).map(k => ({k, len: state.dateIndex[k].length})) : null,
        hasUnsavedChanges: state.hasUnsavedChanges,
        lastEntriesSample: state.entries ? state.entries.slice(-3) : null
      };
    } catch (e) { return { error: e.message } }
  });
  console.log('After import:', JSON.stringify(stateInfo, null, 2), stateInfo);

  await browser.close();
})();

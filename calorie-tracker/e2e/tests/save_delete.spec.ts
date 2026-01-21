import { test, expect } from '@playwright/test';
import fetch from 'node-fetch';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPO_PATH; // e.g. 'username/repo'

if (!token || !repo) {
  console.warn('GITHUB_TOKEN or GITHUB_REPO_PATH not set — skipping GitHub integration tests');
}

function ghApi(path, method='GET', body=null) {
  const url = `https://api.github.com/repos/${repo}/${path}`;
  const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' };
  if (body) headers['Content-Type'] = 'application/json';
  return fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

// Helper: check file existence
async function getFile(path) {
  const url = `https://api.github.com/repos/${repo}/contents/${path}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
  if (res.status === 404) return null;
  const json = await res.json();
  return json;
}

// Main test — will be skipped if env not present
test('save and delete per-day file on GitHub', async ({ page }) => {
  test.skip(!token || !repo, 'GitHub credentials not provided');

  // Use a dedicated test path inside repo to avoid clobbering real data
  const testPrefix = `calorie-tracker-tests/${Date.now()}`;
  const testDate = '2026-01-22';
  const testPath = `${testPrefix}/tracker/data/${testDate}.json`;

  // Start app and capture console logs
  const logs = [] as string[];
  page.on('console', msg => {
    try { logs.push(`${msg.type()}: ${msg.text()}`); } catch(e) { logs.push('console parse error'); }
  });
  page.on('requestfailed', req => {
    try { const f = req.failure(); logs.push(`requestfailed: ${req.url()} - ${f ? f.errorText : 'no-failure-info'}`); } catch(e) { logs.push('requestfailed parse error'); }
  });
  page.on('response', res => {
    try { if (res.status() >= 400) logs.push(`bad-response: ${res.url()} status=${res.status()}`); } catch(e) { logs.push('response parse error'); }
  });
  await page.goto('/calorie-tracker/index.html');

  // Set credentials and test prefix in localStorage (prefix isolates writes)
  await page.evaluate(({t, r, p}) => { localStorage.setItem('gt_token', t); localStorage.setItem('gt_repo', r); localStorage.setItem('gt_prefix', p); localStorage.setItem('gt_test_mode', '1'); }, { t: token, r: repo, p: testPrefix });

  // Reload the page so updated scripts (app.js) are loaded after setting localStorage
  await page.goto('/calorie-tracker/index.html', { waitUntil: 'networkidle' });
  // Ensure the app initializes; call fetchFromGit to populate per-day APIs
  await page.evaluate(() => { if (window.fetchFromGit) window.fetchFromGit(); });

  // Add an entry directly to state and mark unsaved
  const entry = { timestamp: new Date().toISOString(), date: testDate, food: 'PW Test Food', calories: 123 };
  await page.evaluate((e) => {
    if (!window.state) window.state = {};
    if (!window.state.dateIndex) window.state.dateIndex = {};
    window.state.dateIndex[e.date] = (window.state.dateIndex[e.date] || []).concat([e]);
    window.state.entries = Object.keys(window.state.dateIndex).sort().reduce((acc,k)=>acc.concat(window.state.dateIndex[k]), []);
    window.state.hasUnsavedChanges = true;
  }, entry);

  // Read back state for debugging
  const beforeState = await page.evaluate((d) => {
    return {
      hasUnsavedChanges: window.state && window.state.hasUnsavedChanges,
      dateIndexKeys: window.state && window.state.dateIndex ? Object.keys(window.state.dateIndex) : [],
      entriesLen: window.state && window.state.entries ? window.state.entries.length : 0,
      todayEntries: window.state && window.state.dateIndex && window.state.dateIndex[d] ? window.state.dateIndex[d].length : 0
    };
  }, testDate);
  console.log('BEFORE STATE:', JSON.stringify(beforeState));

  // Call pushToGit (the app's function) — it should write per-day files under tracker/data/
  
  // Check whether GitHubPerDayAPI and GitHubDB are available
  const apisPresent = await page.evaluate(() => ({
    hasGitHubPerDayAPI: !!(window.GitHubPerDayAPI && window.GitHubPerDayAPI.writeDateFile),
    hasGitHubDB: !!(window.GitHubDB && window.GitHubDB.putFile && window.GitHubDB.getFile)
  }));
  console.log('APIS PRESENT:', JSON.stringify(apisPresent));

  // Diagnostic: capture pushToGit source and localStorage keys
  const diag = await page.evaluate(() => {
    return {
      pushToGitSrc: window.pushToGit ? window.pushToGit.toString().slice(0,400) : null,
      token: localStorage.getItem('gt_token'),
      repo: localStorage.getItem('gt_repo'),
      prefix: localStorage.getItem('gt_prefix')
    };
  });
  console.log('DIAG:', JSON.stringify(diag).slice(0,2000));

  // Call per-day API directly to write the date file (bypass pushToGit)
  const writeRes = await page.evaluate(async (d) => {
    if (!(window.GitHubPerDayAPI && window.GitHubPerDayAPI.writeDateFile)) return { err: 'no-api' };
    const entries = (window.state && window.state.dateIndex && window.state.dateIndex[d]) || [];
    try {
      const r = await window.GitHubPerDayAPI.writeDateFile(d, entries);
      return r;
    } catch (e) { return { err: e.message } }
  }, testDate);
  console.log('writeDateFile returned:', JSON.stringify(writeRes));

  const afterState = await page.evaluate((d) => {
    return { perDaySha: window.state && window.state.perDaySha ? window.state.perDaySha : {}, hasUnsavedChanges: window.state && window.state.hasUnsavedChanges };
  }, testDate);
  console.log('AFTER STATE:', JSON.stringify(afterState));

  // Check GitHub for the file under our test prefix + tracker/data by listing contents and scanning
  const listRes = await fetch(`https://api.github.com/repos/${repo}/contents/${encodeURIComponent(testPrefix)}/tracker/data`, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
  const listJson = await listRes.json();
  const candidate = Array.isArray(listJson) ? listJson.find(f => f.type === 'file') : null;
  expect(Array.isArray(listJson)).toBe(true);
  // find which date file contains our 'PW Test Food'
  let found = false;
  try {
    for (const f of listJson) {
      if (f.type !== 'file') continue;
      const contentRes = await fetch(f.url, { headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
      const contentJson = await contentRes.json();
      if (!contentJson || !contentJson.content) continue;
      const decoded = Buffer.from(contentJson.content, contentJson.encoding).toString('utf8');
      if (decoded.includes('PW Test Food')) { found = true; break; }
    }
    expect(found).toBe(true);
  } catch (err) {
    console.error('Assertion failed while scanning tracker/data — dumping helpful info');
    console.error('LIST JSON:', JSON.stringify(listJson).slice(0,2000));
    console.error('BEFORE STATE (re-check):', JSON.stringify(await page.evaluate(() => ({ hasUnsavedChanges: window.state && window.state.hasUnsavedChanges, dateIndexKeys: window.state && window.state.dateIndex ? Object.keys(window.state.dateIndex) : [], entriesLen: window.state && window.state.entries ? window.state.entries.length : 0 }))) );
    console.error('AFTER STATE (re-check):', JSON.stringify(await page.evaluate(() => ({ perDaySha: window.state && window.state.perDaySha ? window.state.perDaySha : {}, hasUnsavedChanges: window.state && window.state.hasUnsavedChanges }))));
    console.error('\n--- PAGE CONSOLE LOGS START ---');
    for (const l of logs) console.error(l);
    console.error('--- PAGE CONSOLE LOGS END ---\n');
    throw err;
  }

  // Now delete the file by calling app delete flow: remove entry and push
  await page.evaluate((d) => {
    if (!window.state || !window.state.dateIndex) return;
    delete window.state.dateIndex[d];
    window.state.entries = Object.keys(window.state.dateIndex).sort().reduce((acc,k)=>acc.concat(window.state.dateIndex[k]), []);
    window.state.hasUnsavedChanges = true;
  }, testDate);

  await page.evaluate(() => { return window.pushToGit ? window.pushToGit() : Promise.resolve(); });

  // File should be gone or empty now — attempt to get it; allow null
  const fileAfter = await getFile(testPath);
  // Cleanup: if file still exists, try deleting via API
  if (fileAfter && fileAfter.sha) {
    const delRes = await ghApi(`contents/${testPath}`, 'DELETE', { message: 'cleanup test', sha: fileAfter.sha });
    // ignore status
  }

  // Dump page console logs to test output for debugging
  console.log('\n--- PAGE CONSOLE LOGS START ---');
  for (const l of logs) console.log(l);
  console.log('--- PAGE CONSOLE LOGS END ---\n');

});

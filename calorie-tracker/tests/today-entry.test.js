const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

async function run() {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const TEST_PORT = process.env.TEST_PORT || process.env.PORT || '8001';
  const baseUrl = `http://localhost:${TEST_PORT}/calorie-tracker/index.html`;
  const schemaText = fs.readFileSync(path.join(__dirname, '..', 'schema.yaml'), 'utf8');

  const dom = new JSDOM(html, { runScripts: 'dangerously', resources: 'usable', url: baseUrl,
    beforeParse(window) {
      // Minimal fetch to serve schema and static files
      window.fetch = async (u) => {
        const url = String(u || '');
        if (url.endsWith('schema.yaml')) {
          return { ok: true, status: 200, text: async () => schemaText };
        }
        try {
          const rel = url.replace(/^(?:https?:)?\/\/(?:[^\/]+)\//, '');
          const full = path.join(__dirname, '..', rel);
          if (fs.existsSync(full)) {
            const body = fs.readFileSync(full, 'utf8');
            return { ok: true, status: 200, text: async () => body };
          }
        } catch (e) {}
        return { ok: false, status: 404, text: async () => '' };
      };
      window.localStorage = { getItem: () => null, setItem: () => {} };
      window.confirm = () => true;
      // Provide initial state so app.js picks up schema early
      window.__initialState = {
        schema: {
          fields: [
            { name: 'timestamp', type: 'hidden', autoCapture: true },
            { name: 'date', type: 'date', default: 'today' },
            { name: 'time', type: 'text' },
            { name: 'food', type: 'text', required: true },
            { name: 'calories', type: 'number' }
          ],
          displayFormat: '{date} {time} - {food} - {calories} kcal',
          totalField: 'calories'
        }
      };
    }
  });

  const { window } = dom;

  // Wait for renderFormFields
  await new Promise((resolve, reject) => {
    let attempts = 0;
    const iv = setInterval(() => {
      attempts++;
      if (window && typeof window.renderFormFields === 'function') {
        clearInterval(iv);
        try { window.renderFormFields(); } catch (e) {}
        resolve();
      }
      if (attempts > 100) { clearInterval(iv); reject(new Error('Timeout waiting for renderFormFields')); }
    }, 100);
  });

  // Capture payload written by writeDateFile
  let captured = null;
  window.GitHubPerDayAPI = window.GitHubPerDayAPI || {};
  window.GitHubPerDayAPI.writeDateFile = async (dateStr, entries, existingSha) => {
    captured = { dateStr, entries: JSON.parse(JSON.stringify(entries)), existingSha };
    return { ok: true, sha: 'captured-sha' };
  };

  // Fill form and submit
  const foodField = window.document.getElementById('field-food');
  const caloriesField = window.document.getElementById('field-calories');
  if (!foodField || !caloriesField) throw new Error('Form inputs missing');
  foodField.value = 'Payload Food';
  caloriesField.value = '321';

  await window.addEntry();
  await new Promise(r => setTimeout(r, 300));

  if (!captured) throw new Error('writeDateFile was not called');

  const today = (window.getTodayString && typeof window.getTodayString === 'function') ? window.getTodayString() : (new Date()).toISOString().split('T')[0];
  if (captured.dateStr !== today) throw new Error(`Expected dateStr ${today}, got ${captured.dateStr}`);
  if (!Array.isArray(captured.entries) || !captured.entries.some(e => e.food === 'Payload Food')) throw new Error('Submitted payload missing the new entry');

  console.log('today-entry test passed');
}

run().then(() => console.log('All tests passed')).catch(err => { console.error('Test failed:', err); process.exit(1); });

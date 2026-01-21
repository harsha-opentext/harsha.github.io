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
      // Provide a simple fetch implementation for the app to load schema.yaml
      window.fetch = async (u) => {
        const url = String(u || '');
        if (url.endsWith('schema.yaml')) {
          return {
            ok: true,
            text: async () => schemaText,
            status: 200
          };
        }
        // For other static files, try to read from disk relative to calorie-tracker
        try {
          const rel = url.replace(/^(?:https?:)?\/\/(?:[^\/]+)\//, '');
          const full = path.join(__dirname, '..', rel);
          if (fs.existsSync(full)) {
            const body = fs.readFileSync(full, 'utf8');
            return { ok: true, text: async () => body, status: 200 };
          }
        } catch (e) {}
        return { ok: false, status: 404, text: async () => '' };
      };
      // Provide minimal localStorage
      window.localStorage = { getItem: () => null, setItem: () => {} };
      // Stub confirm so delete flows proceed in JSDOM
      window.confirm = () => true;
      // Provide initial app state via __initialState so app.js merges defaults
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

  // Wait for scripts to load (simple poll)
  // Ensure a minimal schema exists so the form renders without remote fetches
  window.state = window.state || {};
  if (!window.state.schema) {
    window.state.schema = {
      fields: [
        { name: 'timestamp', type: 'hidden', autoCapture: true },
        { name: 'date', type: 'date', default: 'today' },
        { name: 'time', type: 'text' },
        { name: 'food', type: 'text', required: true },
        { name: 'calories', type: 'number' }
      ],
      displayFormat: '{date} {time} - {food} - {calories} kcal',
      totalField: 'calories'
    };
  }

  // Wait for renderFormFields to be available and then call it
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

  // Mock the GitHubPerDayAPI.writeDateFile to succeed quickly
  window.GitHubPerDayAPI.writeDateFile = async (dateStr, entries, existingSha) => {
    return { ok: true, sha: 'testsha123' };
  };

  // Prepare form fields according to schema (renderFormFields should have created them)
  if (!window.state || !window.state.schema) throw new Error('state.schema not available');

  const formContainer = window.document.getElementById('form-container');
  if (!formContainer) {
    console.error('form-container missing. Document body:', window.document.body.innerHTML.slice(0,1000));
    throw new Error('form-container not found in DOM');
  }

  // Fill only required fields: find first text field (food) and calories
  const foodField = window.document.getElementById('field-food');
  const caloriesField = window.document.getElementById('field-calories');
  if (!foodField || !caloriesField) {
    console.error('Form inputs not found. form-container innerHTML:', formContainer.innerHTML);
    throw new Error('Form inputs not found');
  }
  foodField.value = 'Test food';
  caloriesField.value = '123';

  // Trigger addEntry
  await window.addEntry();

  // Wait a bit for async persistence then verify entry rendered in DOM
  await new Promise(r => setTimeout(r, 500));
  const bodyHtml = window.document.body.innerHTML;
  if (!bodyHtml.includes('Test food')) throw new Error('Added entry not found in DOM');
  console.log('ADD entry test passed (found in DOM)');

  // Test delete: click the first Delete button in the tracker UI
  // Mock API for delete (same behavior)
  window.GitHubPerDayAPI.writeDateFile = async (dateStr, entries, existingSha) => ({ ok: true, sha: 'deletesha' });
  const deleteBtn = Array.from(window.document.querySelectorAll('button')).find(b => b.textContent && b.textContent.trim() === 'Delete');
  if (!deleteBtn) throw new Error('Delete button not found in DOM');
  deleteBtn.click();
  await new Promise(r => setTimeout(r, 500));

  const afterHtml = window.document.body.innerHTML;
  if (afterHtml.includes('Test food')) throw new Error('Entry not deleted from DOM after delete');
  console.log('DELETE entry test passed (removed from DOM)');
}

run().then(() => console.log('All tests passed')).catch(err => { console.error('Test failed:', err); process.exit(1); });

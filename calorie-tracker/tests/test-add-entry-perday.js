// Simple smoke test to write a sample entry to today's per-day file using the GitHub Per-Day API module
// Usage: node tests/test-add-entry-perday.js

const path = require('path');
const fs = require('fs');

const repoModulePath = path.resolve(__dirname, '../tools/github-perday-api.js');
if (!fs.existsSync(repoModulePath)) {
  console.error('github-perday-api.js not found at', repoModulePath);
  process.exit(1);
}

// Load the module as a script in a Node VM to get access to its exported functions
const vm = require('vm');
const code = fs.readFileSync(repoModulePath, 'utf8');
const sandbox = { module: {}, console, require, process, Buffer, setTimeout };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

if (!sandbox.module.exports || !sandbox.module.exports.writeDateFile) {
  console.error('Module did not export writeDateFile.');
  process.exit(1);
}

(async () => {
  try {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const sample = { timestamp: new Date().toISOString(), date: dateStr, food: 'Test Snack', calories: 123 };

    console.log('Writing sample entry for', dateStr);
    const res = await sandbox.module.exports.writeDateFile(dateStr, [sample]);
    console.log('Result:', res);
    process.exit(0);
  } catch (e) {
    console.error('Error during test:', e);
    process.exit(2);
  }
})();

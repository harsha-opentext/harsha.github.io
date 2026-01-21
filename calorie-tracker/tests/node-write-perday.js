// Node smoke test: directly PUT a per-day file to GitHub using REST API.
// Requires env vars: GH_TOKEN and GH_REPO (owner/repo)
// Usage: GH_TOKEN=... GH_REPO=owner/repo node calorie-tracker/tests/node-write-perday.js

const fetch = require('node-fetch');
const fs = require('fs');

async function run() {
  const token = process.env.GH_TOKEN;
  const repo = process.env.GH_REPO;
  if (!token || !repo) {
    console.error('Set GH_TOKEN and GH_REPO env vars');
    process.exit(2);
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate()).padStart(2, '0');
  const dateStr = `${yyyy}-${mm}-${dd}`;
  const path = `tracker/data/${dateStr}.json`;
  const content = JSON.stringify([{ timestamp: new Date().toISOString(), date: dateStr, food: 'Node Test', calories: 42 }], null, 2);
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;

  // Check existing sha
  let sha = null;
  const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
  if (getRes.status === 200) {
    const jb = await getRes.json();
    if (jb && jb.sha) sha = jb.sha;
    console.log('Existing sha:', sha);
  } else if (getRes.status === 404) {
    console.log('File does not exist yet. Will create new file.');
  } else {
    console.log('GET status', getRes.status);
    console.log(await getRes.text());
  }

  const body = { message: `node test write ${path}`, content: Buffer.from(content).toString('base64') };
  if (sha) body.sha = sha;

  const putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const jb = await putRes.json();
  console.log('PUT status', putRes.status);
  console.log('Response:', jb);
}

run().catch(err => { console.error(err); process.exit(1); });

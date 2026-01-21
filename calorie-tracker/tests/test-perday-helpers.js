const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.TEST_REPO; // owner/repo
const DATE = process.env.TEST_DATE || '2026-01-15';

if (!TOKEN || !REPO) {
  console.error('Set GITHUB_TOKEN and TEST_REPO (owner/repo) environment variables');
  process.exit(1);
}

function ghRequest(method, path, body) {
  const opts = {
    hostname: 'api.github.com',
    path: path,
    method: method,
    headers: {
      'User-Agent': 'test-perday-helpers',
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${TOKEN}`
    }
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async ()=>{
  console.log('Testing fetch of', DATE);
  const path = `/repos/${REPO}/contents/tracker/data/${DATE}.json`;
  const res = await ghRequest('GET', path);
  console.log('Status:', res.status);
  if (res.status === 200) {
    if (res.body.content) console.log('Content length:', res.body.content.length, 'sha:', res.body.sha);
    else console.log('No content field; sha:', res.body.sha);
  } else {
    console.log('Body:', res.body);
  }
})();

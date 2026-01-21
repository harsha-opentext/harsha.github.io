const https = require('https');

const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.TEST_REPO || 'harsha-opentext/private-data';
const DATE_SAMPLE = process.env.TEST_DATE || '2026-01-15';

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
      'User-Agent': 'test-githubdb-smoke',
      'Accept': 'application/vnd.github.v3+json',
      'Authorization': `token ${TOKEN}`
    }
  };
  let bodyStr = null;
  if (body) {
    bodyStr = JSON.stringify(body);
    opts.headers['Content-Type'] = 'application/json';
    opts.headers['Content-Length'] = Buffer.byteLength(bodyStr);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let bodyParsed = null;
        try { bodyParsed = JSON.parse(data); } catch (e) { bodyParsed = data; }
        resolve({ status: res.statusCode, body: bodyParsed });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

(async () => {
  console.log('Smoke test: GitHubDB-like ops against', REPO);

  // 1) List files in tracker/data
  console.log('\n1) LIST tracker/data');
  let path = `/repos/${REPO}/contents/tracker/data`;
  let res = await ghRequest('GET', path);
  console.log('Status:', res.status);
  if (res.status === 200 && Array.isArray(res.body)) {
    console.log('Files count:', res.body.length);
  } else {
    console.log('List body:', res.body);
  }

  // 2) Fetch a known date sample
  console.log('\n2) FETCH sample date file');
  path = `/repos/${REPO}/contents/tracker/data/${DATE_SAMPLE}.json`;
  res = await ghRequest('GET', path);
  console.log('Status:', res.status);
  if (res.status === 200) {
    console.log('Sample content length:', res.body.content ? res.body.content.length : '(no content field)', 'sha:', res.body.sha);
  } else {
    console.log('Fetch body:', res.body);
  }

  // 3) CREATE a temporary test file
  console.log('\n3) CREATE temporary test file');
  const ts = Date.now();
  const testName = `smoke-${ts}`;
  const testPath = `tracker/data/${testName}.json`;
  const apiPath = `/repos/${REPO}/contents/${encodeURIComponent(testPath)}`;
  const payload = { message: `Smoke test create ${testName}`, content: Buffer.from(JSON.stringify({test: 'smoke', ts}), 'utf8').toString('base64') };
  res = await ghRequest('PUT', apiPath, payload);
  console.log('Status:', res.status);
  if (res.status === 201 || res.status === 200) {
    console.log('Created sha:', res.body.content && res.body.content.sha);
  } else {
    console.log('Create body:', res.body);
  }

  // 4) FETCH back the created file
  console.log('\n4) FETCH created file');
  path = `/repos/${REPO}/contents/${encodeURIComponent(testPath)}`;
  res = await ghRequest('GET', path);
  console.log('Status:', res.status);
  if (res.status === 200) {
    console.log('Created file sha:', res.body.sha);
  } else {
    console.log('Fetch created body:', res.body);
  }

  // 5) UPDATE the created file
  console.log('\n5) UPDATE created file');
  const newContent = Buffer.from(JSON.stringify({test: 'smoke-updated', ts, extra: 'updated'})).toString('base64');
  const updatePayload = { message: `Smoke test update ${testName}`, content: newContent, sha: (res.body && res.body.sha) };
  res = await ghRequest('PUT', `/repos/${REPO}/contents/${encodeURIComponent(testPath)}`, updatePayload);
  console.log('Status:', res.status);
  if (res.status === 200) {
    console.log('Updated sha:', res.body.content && res.body.content.sha);
  } else {
    console.log('Update body:', res.body);
  }

  // 6) DELETE the created file
  console.log('\n6) DELETE created file');
  // Re-fetch the file to obtain the latest sha
  const refetch = await ghRequest('GET', `/repos/${REPO}/contents/${encodeURIComponent(testPath)}`);
  const currentSha = (refetch.body && refetch.body.sha) || (res.body && res.body.content && res.body.content.sha) || updatePayload.sha;
  if (!currentSha) {
    console.log('Could not determine file sha for delete. Skipping delete.');
  } else {
    const deletePayload = { message: `Smoke test delete ${testName}`, sha: currentSha };
    res = await ghRequest('DELETE', `/repos/${REPO}/contents/${encodeURIComponent(testPath)}`, deletePayload);
    console.log('Status:', res.status);
    if (res.status === 200) {
      console.log('Delete result:', res.body);
    } else {
      console.log('Delete body:', res.body);
    }
  }
  console.log('Status:', res.status);
  if (res.status === 200) {
    console.log('Delete result:', res.body);
  } else {
    console.log('Delete body:', res.body);
  }

  console.log('\nSmoke test completed.');
})().catch(err => { console.error('Error:', err); process.exit(1); });

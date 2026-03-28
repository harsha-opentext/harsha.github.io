const https = require('https');
const { Buffer } = require('buffer');
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPO_PATH;
if (!token || !repo) {
  console.error('Missing GITHUB_TOKEN or GITHUB_REPO_PATH env vars');
  process.exit(2);
}

function ghGet(url) {
  return new Promise((resolve, reject) => {
    const opts = { headers: { 'User-Agent': 'node.js', Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.v3+json' } };
    https.get(url, opts, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

function ghPut(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const opts = {
      method: 'PUT',
      hostname: 'api.github.com',
      path: `/repos/${repo}/contents/${encodeURIComponent(path)}`,
      headers: {
        'User-Agent': 'node.js',
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    const req = https.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function localDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

(async function main(){
  try {
    console.error('Listing data folder via GitHub API');
    const folderUrl = `https://api.github.com/repos/${repo}/contents/data`;
    const files = await ghGet(folderUrl);
    if (!Array.isArray(files)) { console.error('Unexpected folder listing'); process.exit(1); }
    console.error('Found', files.length, 'items');

    // fetch all files and accumulate entries
    const allEntries = [];
    const fileMap = {};
    for (const item of files.filter(f=>f.name && f.name.endsWith('.json'))) {
      const file = await ghGet(item.url);
      const content = file.content ? Buffer.from(file.content, file.encoding || 'base64').toString('utf8') : '[]';
      let arr = [];
      try { arr = JSON.parse(content || '[]'); } catch (e) { console.error('Failed parse', item.name); arr = []; }
      fileMap[item.name] = { sha: item.sha, size: item.size, rawContent: file.content };
      arr.forEach(e => { e._sourceFile = item.name; allEntries.push(e); });
    }

    console.error('Total entries gathered:', allEntries.length);

    // Backup originals into data-backup/<filename>-<ts>.json
    const ts = Date.now();
    for (const item of files.filter(f=>f.name && f.name.endsWith('.json'))) {
      const backupPath = `data-backup/${item.name.replace('.json','')}-${ts}.json`;
      console.error('Backing up', item.name, '->', backupPath);
      // use original base64 content if available
      const originalFile = await ghGet(item.url);
      const backupBody = {
        message: `Backup ${item.name} before normalize-dates ${new Date(ts).toISOString()}`,
        content: originalFile.content
      };
      try { await ghPut(backupPath, backupBody); } catch (e) { console.error('Backup failed for', item.name, e.message || e); }
    }

    // Normalize entries and group by date derived from timestamp
    const grouped = {};
    let changed = 0;
    allEntries.forEach(e => {
      const nd = e.timestamp ? localDate(e.timestamp) : (e.date || 'unknown');
      if (e.date !== nd) changed++;
      e.date = nd;
      delete e._sourceFile;
      (grouped[nd] = grouped[nd] || []).push(e);
    });

    console.error('Entries with changed date:', changed);

    // Determine target filenames (union of existing and grouped)
    const targetDates = new Set(Object.keys(grouped));
    files.filter(f=>f.name && f.name.endsWith('.json')).forEach(f => targetDates.add(f.name.replace('.json','')));

    // Map existing name->sha for safe updates
    const nameToSha = {};
    files.forEach(f => { if (f.name) nameToSha[f.name.replace('.json','')] = f.sha; });

    // Write normalized per-day files
    let written = 0;
    for (const dateStr of Array.from(targetDates)) {
      const arr = grouped[dateStr] || [];
      const path = `data/${dateStr}.json`;
      const content = Buffer.from(JSON.stringify(arr, null, 2)).toString('base64');
      const body = { message: `Normalize dates: write ${dateStr}.json (${arr.length} entries)`, content };
      const existingSha = nameToSha[dateStr];
      if (existingSha) body.sha = existingSha;
      try{
        const res = await ghPut(path, body);
        written++;
        console.error('Wrote', path, 'result SHA:', res.content && res.content.sha);
      }catch(e){ console.error('Write failed for', path, e.message || e); }
    }

    console.error('Normalize complete. Files written:', written);
    process.exit(0);
  }catch(err){ console.error('Error:', err && err.message || err); process.exit(1); }
})();

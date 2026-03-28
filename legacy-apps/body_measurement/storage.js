// storage.js - handles index pointer, data file rotation, and traversal
const BM = {
  indexPath() { return `${bm_getConfig('STORAGE_ROOT')}/${bm_getConfig('INDEX_FOLDER')}/${bm_getConfig('INDEX_FILE')}`; },
  dataFolderPath() { return `${bm_getConfig('STORAGE_ROOT')}/${bm_getConfig('DATA_FOLDER')}`; },
  maxEntries() { return bm_getConfig('MAX_ENTRIES_PER_FILE'); }
};

async function bm_fetchJSON(path) {
  try {
    if (typeof bm_log === 'function') bm_log(`bm_fetchJSON: fetching ${path}`, 'debug');
    const res = await fetch(path);
    if (!res.ok) {
      if (typeof bm_log === 'function') bm_log(`bm_fetchJSON: fetch failed ${path} (${res.status})`, 'error');
      throw new Error('Failed to fetch ' + path + ' (' + res.status + ')');
    }
    const j = await res.json();
    if (typeof bm_log === 'function') bm_log(`bm_fetchJSON: success ${path}`, 'debug');
    return j;
  } catch (e) {
    if (typeof bm_log === 'function') bm_log(`bm_fetchJSON: error ${path} -> ${e.message}`, 'error');
    throw e;
  }
}

// Load index.json from local server (used in static mode). If missing, return default index.
async function bm_loadIndexLocal() {
  try {
    if (typeof bm_log === 'function') bm_log('bm_loadIndexLocal: loading index', 'info');
    const idx = await bm_fetchJSON(BM.indexPath());
    if (typeof bm_log === 'function') bm_log('bm_loadIndexLocal: loaded index', 'debug');
    return idx;
  } catch (e) {
    // Return default blank index
    if (typeof bm_log === 'function') bm_log('bm_loadIndexLocal: index missing, returning empty', 'warn');
    return { active: null, history: {} };
  }
}

// Load index and return structured object
async function bm_loadIndex() {
  // prefer local fetch
          await bm_putRepoFile(`${BM.dataFolderPath()}/${active}`, JSON.stringify(data, null, 2), `Update ${active}`, existingSha);
          if (typeof bm_log === 'function') bm_log(`bm_appendEntry: wrote entry to ${active} (count ${data.entries.length})`, 'debug');
          // Ensure index maps any dates in this file to the active filename
          try { await bm_updateIndexWithFileDates(active); } catch(e) { console.warn('bm_appendEntry: failed to update index mapping', e.message); }
          return { writtenTo: active };
  const v = await bm_loadIndexLocal();
  if (typeof bm_log === 'function') bm_log('bm_loadIndex: exit', 'debug');
  return v;
}

async function bm_loadDataFileLocal(filename) {
  const p = `${BM.dataFolderPath()}/${filename}`;
  try {
    if (typeof bm_log === 'function') bm_log(`bm_loadDataFileLocal: loading ${p}`, 'debug');
    const res = await fetch(p);
    if (!res.ok) {
      if (typeof bm_log === 'function') bm_log(`bm_loadDataFileLocal: fetch failed ${p} (${res.status})`, 'warn');
      throw new Error('fetch failed');
    }
    const j = await res.json();
    if (typeof bm_log === 'function') bm_log(`bm_loadDataFileLocal: loaded ${p}`, 'debug');
    return j;

    // Read a data file's JSON content. Try local first, then GitHub repo if available.
    async function bm_readDataFileContent(filename) {
      try {
        if (typeof bm_log === 'function') bm_log(`bm_readDataFileContent: attempt ${filename}`, 'debug');
        return await bm_loadDataFileLocal(filename);
      } catch (e) {
        // try repo
        try {
          if (typeof bm_log === 'function') bm_log(`bm_readDataFileContent: trying repo for ${filename}`, 'debug');
          const res = await bm_fetchRepoFile(`${BM.dataFolderPath()}/${filename}`);
          if (res && res.content) {
            const txt = atob(res.content);
            if (typeof bm_log === 'function') bm_log(`bm_readDataFileContent: repo read success ${filename}`, 'debug');
            return JSON.parse(txt);
          }
        } catch (er) {
          if (typeof bm_log === 'function') bm_log(`bm_readDataFileContent: failed ${filename} -> ${er.message}`, 'error');
          throw new Error('Failed to read data file ' + filename + ' -> ' + er.message);
        }
      }
    }
  } catch (e) {
    if (typeof bm_log === 'function') bm_log(`bm_loadDataFileLocal: failed ${filename} -> ${e.message}`, 'error');
    throw new Error('Failed to load data file: ' + filename + ' -> ' + e.message);
  }
}

// Get recent entries across files. Traverses history if needed.
// Returns array sorted newest->oldest
async function bm_getEntries(limit = 50) {
  if (typeof bm_log === 'function') bm_log(`bm_getEntries: start limit=${limit}`, 'info');
  const idx = await bm_loadIndex();
  const result = [];
  if (!idx || !idx.active) {
    if (typeof bm_log === 'function') bm_log('bm_getEntries: no active index', 'debug');
    return result;
  }

  // gather files: active first then history sorted reverse-chronological by key
  const files = [];
  files.push(idx.active);
  const histKeys = Object.keys(idx.history || {}).sort((a,b) => b.localeCompare(a)); // reverse chronological
  for (const k of histKeys) {
    const f = idx.history[k];
    if (!f) continue;
    if (f === idx.active) continue;
    files.push(f);
  }

  for (const file of files) {
    if (result.length >= limit) break;
    try {
      if (typeof bm_log === 'function') bm_log(`bm_getEntries: loading file ${file}`, 'debug');
      const data = await bm_loadDataFileLocal(file);
      if (Array.isArray(data.entries)) {
        // newest first assumed
        for (const e of data.entries) {
          if (result.length >= limit) break;
          result.push(e);
        }
      }
      if (typeof bm_log === 'function') bm_log(`bm_getEntries: added entries from ${file} (total ${result.length})`, 'debug');
    } catch (e) {
      if (typeof bm_log === 'function') bm_log(`bm_getEntries: failed to load ${file} -> ${e.message}`, 'warn');
      continue;
    }
  }
  if (typeof bm_log === 'function') bm_log(`bm_getEntries: returning ${result.length} entries`, 'info');
  return result;
}

// Utilities for GitHub writes: use same token/repo as tracker (gt_token, gt_repo)
async function bm_fetchRepoFile(path) {
  const token = localStorage.getItem('gt_token');
  const repo = localStorage.getItem('gt_repo');
  if (!token || !repo) throw new Error('Missing GitHub credentials');
  try {
    if (typeof bm_log === 'function') bm_log(`bm_fetchRepoFile: GET ${path} from ${repo}`, 'debug');
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
    if (!res.ok) {
      if (typeof bm_log === 'function') bm_log(`bm_fetchRepoFile: failed ${path} -> ${res.status}`, 'warn');
      throw new Error('GitHub fetch failed: ' + res.status);
    }
    const j = await res.json();
    if (typeof bm_log === 'function') bm_log(`bm_fetchRepoFile: success ${path}`, 'debug');
    return j;
  } catch (e) {
    if (typeof bm_log === 'function') bm_log(`bm_fetchRepoFile: error ${path} -> ${e.message}`, 'error');
    throw e;
  }
}

async function bm_putRepoFile(path, contentStr, message, existingSha) {
  const token = localStorage.getItem('gt_token');
  const repo = localStorage.getItem('gt_repo');
  if (!token || !repo) throw new Error('Missing GitHub credentials');
  try {
    if (typeof bm_log === 'function') bm_log(`bm_putRepoFile: PUT ${path} sha=${existingSha || 'nil'} message=${message}`, 'info');
    const url = `https://api.github.com/repos/${repo}/contents/${path}`;
    const body = { message: message || `Update ${path}`, content: btoa(unescape(encodeURIComponent(contentStr))) };
    if (existingSha) body.sha = existingSha;
    const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      const txt = await res.text();
      if (typeof bm_log === 'function') bm_log(`bm_putRepoFile: failed ${path} -> ${res.status} ${txt}`, 'error');
      throw new Error('GitHub put failed: ' + res.status + ' ' + txt);
    }
    const j = await res.json();
    if (typeof bm_log === 'function') bm_log(`bm_putRepoFile: success ${path}`, 'debug');
    return j;
  } catch (e) {
    if (typeof bm_log === 'function') bm_log(`bm_putRepoFile: error ${path} -> ${e.message}`, 'error');
    throw e;
  }
}

// Create a new data file and update index. entries must be array (can be empty)
async function bm_createDataFile(entries = []) {
  const date = new Date().toISOString().slice(0,10);
  const filename = `measurements-${date}-${Date.now()}.json`;
  const path = `${BM.dataFolderPath()}/${filename}`;
  const payload = { created_at: new Date().toISOString(), entries };
  // write file to repo if credentials available, else fail silently
  try {
    if (typeof bm_log === 'function') bm_log(`bm_createDataFile: creating ${filename} with ${entries.length} entries`, 'info');
    let existingSha = null;
    try { const existing = await bm_fetchRepoFile(path); if (existing && existing.sha) existingSha = existing.sha; } catch(e) { /* ignore */ }
    await bm_putRepoFile(path, JSON.stringify(payload, null, 2), `Create data file ${filename}`, existingSha);
    if (typeof bm_log === 'function') bm_log(`bm_createDataFile: created ${filename}`, 'debug');
  } catch (e) {
    if (typeof bm_log === 'function') bm_log('bm_createDataFile: write skipped or failed: ' + e.message, 'warn');
  }
  return filename;
}

// Update index.json on repo to point to new active file and record history
async function bm_updateIndexOnRepo(activeFilename) {
  const idxPath = BM.indexPath();
  const nowDate = new Date().toISOString().slice(0,10);
  let idx = { active: activeFilename, history: {} };
  try {
    if (typeof bm_log === 'function') bm_log(`bm_updateIndexOnRepo: loading ${idxPath}`, 'debug');
    const existing = await bm_fetchRepoFile(idxPath);
    if (existing && existing.content) {
      const content = atob(existing.content);
      idx = JSON.parse(content);
      if (typeof bm_log === 'function') bm_log('bm_updateIndexOnRepo: loaded existing index', 'debug');
    }
  } catch (e) { /* index may not exist */ }
  idx.active = activeFilename;
  idx.history = idx.history || {};
  if (!idx.history[nowDate]) idx.history[nowDate] = activeFilename;
  try {
    // write back
    const existingSha = (await (async()=>{try{return (await bm_fetchRepoFile(idxPath)).sha;}catch(e){return null;}})());
    await bm_putRepoFile(idxPath, JSON.stringify(idx, null, 2), `Update index -> ${activeFilename}`, existingSha);
    if (typeof bm_log === 'function') bm_log(`bm_updateIndexOnRepo: updated index active=${activeFilename}`, 'info');
  } catch (e) {
    if (typeof bm_log === 'function') bm_log('bm_updateIndexOnRepo: failed to write index ' + e.message, 'error');
  }
}

// Append an entry: reads active file, appends, rotates if > maxEntries, writes file(s) and updates index
async function bm_appendEntry(entry) {
  const idx = await bm_loadIndex();
  let active = idx.active;
  if (!active) {
    // create initial file
    active = await bm_createDataFile([]);
    // attempt to update index
    await bm_updateIndexOnRepo(active);
  }

  // load active file local if possible
  let data = null;
  try { data = await bm_loadDataFileLocal(active); } catch (e) { data = { entries: [] }; }

  data.entries = data.entries || [];
  // Prepend so newest first
  data.entries.unshift(entry);

  if (data.entries.length > BM.maxEntries()) {
    // split: keep first N in current, move remainder to new older file
    const keep = data.entries.slice(0, BM.maxEntries());
    const overflow = data.entries.slice(BM.maxEntries());
    data.entries = keep;
    // write current active file
    try {
      let existingSha = null;
      try { const existing = await bm_fetchRepoFile(`${BM.dataFolderPath()}/${active}`); if (existing && existing.sha) existingSha = existing.sha; } catch(e) { /* ignore */ }
      await bm_putRepoFile(`${BM.dataFolderPath()}/${active}`, JSON.stringify(data, null, 2), `Update ${active}`, existingSha);
    } catch (e) { console.warn('bm_appendEntry write active failed', e.message); }
    // create new older file with overflow entries (older ones should come after, so store as overflow)
    const newFilename = await bm_createDataFile(overflow);
    // update index history: the new file is older (so index.active remains current active)
    try { await bm_updateIndexOnRepo(active); } catch (e) { /* ignore */ }
    return { writtenTo: active, rotatedTo: newFilename };
  } else {
    try {
      let existingSha = null;
      try { const existing = await bm_fetchRepoFile(`${BM.dataFolderPath()}/${active}`); if (existing && existing.sha) existingSha = existing.sha; } catch(e) { /* ignore */ }
      await bm_putRepoFile(`${BM.dataFolderPath()}/${active}`, JSON.stringify(data, null, 2), `Update ${active}`, existingSha);
        // Ensure index maps any dates in this file to the active filename
        try { await bm_updateIndexWithFileDates(active); } catch(e) { console.warn('bm_appendEntry: failed to update index mapping', e.message); }
    } catch (e) { console.warn('bm_appendEntry write failed', e.message); }
    return { writtenTo: active };
  }
}

// Read a data file's JSON content. Try local first, then GitHub repo if available.
async function bm_readDataFileContent(filename) {
  try {
    return await bm_loadDataFileLocal(filename);
  } catch (e) {
    // try repo
    try {
      const res = await bm_fetchRepoFile(`${BM.dataFolderPath()}/${filename}`);
      if (res && res.content) {
        const txt = atob(res.content);
        return JSON.parse(txt);
      }
    } catch (er) {
      throw new Error('Failed to read data file ' + filename + ' -> ' + er.message);
    }
  }
}

// Update index.json on repo to include mappings for all dates present in the given file
async function bm_updateIndexWithFileDates(activeFilename) {
  const idxPath = BM.indexPath();
  let idx = { active: activeFilename, history: {} };
  try {
    const existing = await bm_fetchRepoFile(idxPath);
    if (existing && existing.content) idx = JSON.parse(atob(existing.content));
  } catch (e) { /* ignore */ }
  idx.active = activeFilename;
  idx.history = idx.history || {};

  // load the file and register all dates found
  try {
    const data = await bm_readDataFileContent(activeFilename);
    if (data && Array.isArray(data.entries)) {
      for (const ent of data.entries) {
        if (ent && ent.date) idx.history[ent.date] = activeFilename;
      }
    }
  } catch (e) {
    // ignore read errors
  }

  try {
    const existingSha = (await (async()=>{try{return (await bm_fetchRepoFile(idxPath)).sha;}catch(e){return null;}})());
    await bm_putRepoFile(idxPath, JSON.stringify(idx, null, 2), `Update index -> ${activeFilename}`, existingSha);
  } catch (e) { console.warn('bm_updateIndexWithFileDates failed', e.message); }
}

// Return file name that contains entries for `date` based on index history mapping.
async function bm_getFileForDate(date) {
  const idx = await bm_loadIndex();
  if (!idx || !idx.history) return null;
  return idx.history[date] || null;
}

// Return entries for a single date by loading the file that contains them
async function bm_getEntriesByDate(date) {
  const file = await bm_getFileForDate(date);
  if (!file) return [];
  try {
    const data = await bm_readDataFileContent(file);
    if (!data || !Array.isArray(data.entries)) return [];
    return data.entries.filter(e => e.date === date).slice();
  } catch (e) {
    console.warn('bm_getEntriesByDate failed', e.message);
    return [];
  }
}

// Replace all entries for a given date with provided entries array (writes back to the file that contains that date)
async function bm_replaceEntriesForDate(date, newEntries) {
  const file = await bm_getFileForDate(date);
  if (!file) {
    // No existing file -> append each new entry normally
    for (const e of newEntries) await bm_appendEntry(e);
    return { created: false, writtenTo: null };
  }
  try {
    const data = await bm_readDataFileContent(file);
    data.entries = data.entries || [];
    // remove existing entries for date
    const remaining = data.entries.filter(e => e.date !== date);
    // insert new entries at front (newest-first)
    const toInsert = (Array.isArray(newEntries) ? newEntries : [newEntries]).slice().reverse();
    // ensure newest-first ordering
    const merged = toInsert.concat(remaining);
    data.entries = merged;

    // attempt to get sha for file on repo
    let existingSha = null;
    try { const repoResp = await bm_fetchRepoFile(`${BM.dataFolderPath()}/${file}`); if (repoResp && repoResp.sha) existingSha = repoResp.sha; } catch(e){ /* ignore */ }
    await bm_putRepoFile(`${BM.dataFolderPath()}/${file}`, JSON.stringify(data, null, 2), `Replace entries for ${date} in ${file}`, existingSha);
    // update index to map date to this file (should already be mapped)
    try { await bm_updateIndexWithFileDates(file); } catch(e){}
    return { created: false, writtenTo: file };
  } catch (e) {
    console.warn('bm_replaceEntriesForDate failed', e.message);
    throw e;
  }
}

// Add or replace entries grouped by date. If a date exists already and overwriteDates contains that date, it will replace; otherwise it will append.
async function bm_addOrReplaceEntries(entries, overwriteDates = new Set()) {
  // group by date
  const byDate = {};
  for (const e of entries) {
    const d = e.date || (new Date(e.timestamp || Date.now()).toISOString().slice(0,10));
    byDate[d] = byDate[d] || [];
    byDate[d].push(e);
  }
  for (const d of Object.keys(byDate)) {
    const arr = byDate[d];
    const mappedFile = await bm_getFileForDate(d);
    if (mappedFile && overwriteDates.has(d)) {
      await bm_replaceEntriesForDate(d, arr);
    } else if (mappedFile && !overwriteDates.has(d)) {
      // user chose not to overwrite - append to the existing file by inserting these entries into that file
      await bm_replaceEntriesForDate(d, arr.concat(await bm_getEntriesByDate(d)));
    } else {
      // no mapped file -> append each entry
      for (const e of arr) await bm_appendEntry(e);
    }
  }
}

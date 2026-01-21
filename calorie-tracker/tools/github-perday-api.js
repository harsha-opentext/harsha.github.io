// Browser-side helpers for per-day GitHub operations
(function(window){
  function dbg(msg, type='info') { try { if (window && window.dbg) window.dbg(msg, type); } catch(e){} }

  function ghApiHeaders(token) {
    return { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' };
  }

  let _listDateFilesInFlight = null;
  async function listDateFiles() {
    if (_listDateFilesInFlight) return _listDateFilesInFlight;
    _listDateFilesInFlight = (async () => {
      if (!window.GitHubDB || !window.GitHubDB.getFile) {
        dbg('listDateFiles: GitHubDB not available', 'warn');
        return [];
      }
      const prefix = (localStorage.getItem('gt_prefix') || '').replace(/\/$/, '');
      const listPath = prefix ? `${prefix}/tracker/data` : 'tracker/data';
      const res = await window.GitHubDB.getFile(listPath);
      if (!res) { dbg('listDateFiles: getFile returned null', 'warn'); return []; }
      if (!res.ok) { dbg(`listDateFiles: getFile not ok: ${JSON.stringify(res).slice(0,200)}`, 'warn'); return []; }
      // res.meta is the original contents API object when listing a folder
      const json = res.meta;
      if (!Array.isArray(json)) { dbg('listDateFiles: meta is not array', 'warn'); return []; }
      dbg(`listDateFiles: found ${json.length} items`, 'debug');
      return json.filter(f => f.type === 'file');
    })();
    try { return await _listDateFilesInFlight; } finally { _listDateFilesInFlight = null; }
  }

  async function fetchDateFile(dateStr) {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) return null;
    if (!window.GitHubDB || !window.GitHubDB.getFile) {
      dbg('fetchDateFile: GitHubDB not available', 'warn');
      return null;
    }
    const prefix = (localStorage.getItem('gt_prefix') || '').replace(/\/$/, '');
    const path = prefix ? `${prefix}/tracker/data/${dateStr}.json` : `tracker/data/${dateStr}.json`;
    const res = await window.GitHubDB.getFile(path);
    if (!res || !res.ok) return null;
    try {
      const arr = JSON.parse(res.content);
      return { entries: arr, sha: res.sha };
    } catch (e) { dbg('fetchDateFile parse error: ' + e.message, 'error'); return null; }
  }

  async function writeDateFile(dateStr, entries, existingSha) {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) { dbg('Missing credentials for writeDateFile', 'error'); return null; }
    if (!window.GitHubDB || !window.GitHubDB.putFile) {
      dbg('writeDateFile: GitHubDB not available', 'warn');
      return { ok: false, error: 'db-missing' };
    }
    const prefix = (localStorage.getItem('gt_prefix') || '').replace(/\/$/, '');
    const path = prefix ? `${prefix}/tracker/data/${dateStr}.json` : `tracker/data/${dateStr}.json`;
    const res = await window.GitHubDB.putFile(path, JSON.stringify(entries, null, 2), `sync: update ${path}`, existingSha);
    dbg(`GitHubPerDayAPI.writeDateFile: putFile result for ${path}: ${JSON.stringify(res).slice(0,300)}`, 'debug');
    if (res && res.ok) return { ok: true, sha: res.sha };
    return { ok: false, error: res && res.body ? res.body : res };
  }

  window.GitHubPerDayAPI = {
    listDateFiles,
    fetchDateFile,
    writeDateFile
  };

})(window);

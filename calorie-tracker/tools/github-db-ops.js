(function(window){
  function dbg(msg, type='info') { try { if (window && window.dbg) window.dbg(msg, type); } catch(e){} }

  function ghApiHeaders(token) {
    return { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' };
  }

  async function getFile(path, ref='main') {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) { dbg('getFile: missing creds', 'error'); return null; }
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(ref)}`;
    try {
      const res = await fetch(url, { method: 'GET', headers: ghApiHeaders(token) });
      const rawBody = await res.text();
      let parsedBody = null;
      try { parsedBody = JSON.parse(rawBody); } catch (e) { parsedBody = rawBody; }
      if (!res.ok) {
        dbg(`getFile: HTTP ${res.status} for ${path} - ${JSON.stringify(parsedBody).slice(0,200)}`, 'warn');
        return { ok: false, status: res.status, body: parsedBody };
      }
      const json = parsedBody;
      // If the API returned a directory listing (array), surface it as meta
      if (Array.isArray(json)) {
        dbg(`getFile: directory listing for ${path} (${json.length} entries)`, 'debug');
        return { ok: true, meta: json };
      }

      // If content present (file contents)
      if (json.content && json.encoding === 'base64') {
        const raw = atob(json.content);
        return { ok: true, content: raw, sha: json.sha, meta: json };
      }

      // If the response references a blob (large file), fetch the blob
      if (json.sha) {
        const blobRes = await fetch(`https://api.github.com/repos/${repo}/git/blobs/${json.sha}`, { method: 'GET', headers: ghApiHeaders(token) });
        if (!blobRes.ok) return { ok: false, status: blobRes.status };
        const blobJson = await blobRes.json();
        const raw = atob(blobJson.content);
        return { ok: true, content: raw, sha: json.sha, meta: json };
      }

      return { ok: false };
    } catch (e) { dbg('getFile error:' + e.message, 'error'); return { ok: false, error: e }; }
  }

  async function putFile(path, contentUtf8, message, sha) {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) { dbg('putFile: missing creds', 'error'); return { ok: false }; }
    const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
    // Keep a mutable copy of the UTF8 content so we can alter it (e.g. merge) on retries
    let currentContentUtf8 = contentUtf8;
    const encodeContent = (s) => btoa(unescape(encodeURIComponent(s)));
    let body = { message, content: encodeContent(currentContentUtf8) };
    // If caller didn't provide a sha, attempt to detect whether the file exists and include its sha
    if (sha) {
      body.sha = sha;
    } else {
      try {
        const existing = await getFile(path);
        if (existing && existing.ok && existing.sha) {
          dbg(`putFile: detected existing sha for ${path}: ${existing.sha}`, 'debug');
          body.sha = existing.sha;
        } else {
          dbg(`putFile: no existing file detected for ${path}, creating new file`, 'debug');
        }
      } catch (e) {
        dbg(`putFile: error while checking existing file: ${e.message}`, 'warn');
      }
    }
    try {
      const doPut = async (putBody) => {
        const bodyStr = JSON.stringify(putBody);
        try { console.debug('[GitHubDB.putFile] PUT', url); console.debug('[GitHubDB.putFile] bodySize', bodyStr.length); } catch(e){}
        const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: bodyStr });
        let j = null;
        try { j = await res.json(); } catch (e) { console.debug('[GitHubDB.putFile] failed parsing JSON response', e); }
        try { console.debug('[GitHubDB.putFile] status', res.status, res.statusText); console.debug('[GitHubDB.putFile] resp', JSON.stringify(j).slice(0,1000)); } catch(e){}
        return { res, j };
      };

      let attemptBody = body;
      let res, j;
      const maxRetries = 3;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (attempt > 0) {
          // small exponential backoff
          const delay = 200 * Math.pow(2, attempt - 1);
          dbg(`putFile: retry attempt ${attempt} for ${path}, delaying ${delay}ms`, 'debug');
          await new Promise(r => setTimeout(r, delay));
        }

        const out = await doPut(attemptBody);
        res = out.res; j = out.j;

        // Success
        if (res.ok && j && j.content && j.content.sha) {
          return { ok: true, sha: j.content.sha, body: j };
        }

        // Handle 422 (missing sha) by fetching existing sha and retrying
        if (res.status === 422 && j && typeof j.message === 'string' && j.message.includes("sha") && !attemptBody.sha) {
          dbg(`putFile: 422 received for ${path}, attempting to fetch existing sha and retry`, 'warn');
          try {
            const existing = await getFile(path);
            if (existing && existing.ok && existing.sha) {
              // ensure we use the currentContentUtf8 when rebuilding the body
              attemptBody = Object.assign({}, { message, content: encodeContent(currentContentUtf8), sha: existing.sha });
              dbg(`putFile: retrying with detected sha ${existing.sha}`, 'debug');
              continue; // retry loop
            } else {
              dbg(`putFile: could not detect existing sha for ${path} on retry`, 'warn');
            }
          } catch (e) { dbg(`putFile retry error: ${e.message}`, 'error'); }
        }

        // Handle 409 Conflict by fetching latest sha and retrying (no automatic merge)
        if (res.status === 409) {
          dbg(`putFile: 409 Conflict for ${path} — attempting to fetch latest sha and retry`, 'warn');
          try {
            const existing = await getFile(path);
            if (existing && existing.ok && existing.sha) {
              attemptBody = Object.assign({}, { message, content: encodeContent(currentContentUtf8), sha: existing.sha });
              dbg(`putFile: retrying with latest sha ${existing.sha}`, 'debug');
              continue; // retry loop
            } else {
              dbg(`putFile: could not fetch latest sha for ${path} after 409`, 'warn');
            }
          } catch (e) { dbg(`putFile 409-retry error: ${e.message}`, 'error'); }
        }

        // If we've reached here and it's not a retriable condition, break and return error
        break;
      }

      // Return last response as failure
      return { ok: false, body: j, status: res ? res.status : 0 };
    } catch (e) { dbg('putFile error:' + e.message, 'error'); return { ok: false, error: e }; }
  }

  window.GitHubDB = { getFile, putFile };
})(window);

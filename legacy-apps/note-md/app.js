// Minimal NoteMD app — loads NoteMd/data/index.json and individual .md files
// Uses marked.js for rendering markdown (loaded in index.html)

let state = {
  notes: [],
  current: null
  ,liveRender: false
};

// Logging state (mirror tracker app logging API)
state.logs = [];
state.retentionMinutes = 5;
state.logLevel = 'info'; // debug, info, warn, error

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function dbg(msg, type = 'info', raw = null, meta = null) {
  try {
    // respect runtime log level
    const currentLevel = LOG_LEVELS[state.logLevel] != null ? LOG_LEVELS[state.logLevel] : 1;
    const messageLevel = LOG_LEVELS[type] != null ? LOG_LEVELS[type] : 1;
    if (messageLevel < currentLevel) return;
    const text = (window.NoteLogger && typeof window.NoteLogger.format === 'function')
      ? window.NoteLogger.format(type, msg, raw, meta)
      : `[${new Date().toLocaleTimeString()}] [${type.toUpperCase()}] ${msg}`;
    // persist to in-memory logs
    try { state.logs.unshift({ ts: Date.now(), text, type }); pruneLogs(); } catch (e) { /* ignore */ }
    // mirror to console
    try {
      if (window.NoteLogger) {
        if (type === 'debug') NoteLogger.debug(msg, raw, meta);
        else if (type === 'warn') NoteLogger.warn(msg, raw, meta);
        else if (type === 'error') NoteLogger.error(msg, raw, meta);
        else NoteLogger.info(msg, raw, meta);
      } else {
        console.log(text);
      }
    } catch (e) { /* ignore console errors */ }
    // render to UI log screen if present
    const screen = document.getElementById('log-screen');
    if (!screen) return;
    const item = document.createElement('div');
    item.className = `log-item ${type === 'error' ? 'log-error' : type === 'warn' ? 'log-warn' : type === 'debug' ? 'log-debug' : ''}`;
    item.innerText = text;
    try { screen.prepend(item); } catch (e) { /* ignore render errors */ }
  } catch (e) {
    try { console.error('dbg failed', e); } catch (ee) {}
  }
}

function pruneLogs() {
  if (!state.retentionMinutes || state.retentionMinutes <= 0) return;
  const cutoff = Date.now() - state.retentionMinutes * 60 * 1000;
  state.logs = state.logs.filter(l => l.ts >= cutoff);
  const screen = document.getElementById('log-screen');
  if (!screen) return;
  screen.innerHTML = '';
  for (let i = state.logs.length - 1; i >= 0; i--) {
    const l = state.logs[i];
    const el = document.createElement('div');
    el.className = `log-item ${l.type === 'error' ? 'log-error' : l.type === 'warn' ? 'log-warn' : ''}`;
    el.innerText = l.text;
    screen.appendChild(el);
  }
}

function clearLogs() { const s = document.getElementById('log-screen'); if (s) s.innerHTML = ''; state.logs = []; }

async function copyLogs() {
  const txt = state.logs.map(l => l.text).join('\n\n');
  try { await navigator.clipboard.writeText(txt); dbg('Logs copied to clipboard.'); } catch (e) {
    const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); dbg('Logs copied (fallback).');
  }
}

async function saveLogs() {
  const token = localStorage.getItem('note_token');
  const repo = localStorage.getItem('note_repo');
  if (!token || !repo) { dbg('Cannot save logs: Missing credentials', 'error'); showStatus('Please configure GitHub credentials in Settings first.', 'error'); return; }
  const logFile = 'note-md-logs.txt';
  const url = `https://api.github.com/repos/${repo}/contents/${logFile}`;
  dbg('Saving logs to GitHub...', 'info');
  try {
    const timestamp = new Date().toISOString();
    const newLogContent = `\n\n=== Logs saved at ${timestamp} ===\n` + state.logs.map(l => l.text).join('\n');
    // Try fetch existing
    let existing = ''; let fileSha = null;
    try {
      const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
      if (res.ok) { const j = await res.json(); fileSha = j.sha; existing = atob(j.content); }
    } catch (e) { /* ignore */ }
    const finalContent = existing ? (existing + newLogContent) : newLogContent;
    const body = { message: `Save logs: ${timestamp}`, content: btoa(unescape(encodeURIComponent(finalContent))) };
    if (fileSha) body.sha = fileSha;
    const put = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (put.ok) { dbg('Logs saved to GitHub', 'info'); showStatus('Logs saved to repo', 'success'); } else { const err = await put.text(); dbg('Failed to save logs: ' + err, 'error'); showStatus('Failed to save logs', 'error'); }
  } catch (e) { dbg('Error saving logs: ' + e.message, 'error'); showStatus('Error saving logs', 'error'); }
}

function toggleLogs() {
  const panel = document.getElementById('log-panel'); if (!panel) return;
  const backdrop = document.getElementById('log-drawer-backdrop');
  const hidden = panel.getAttribute('aria-hidden') === 'true';
  const opening = hidden === true;
  panel.setAttribute('aria-hidden', opening ? 'false' : 'true');
  if (opening) {
    panel.classList.add('open');
    if (backdrop) backdrop.classList.add('open');
    const screen = document.getElementById('log-screen'); if (screen) { screen.scrollTop = 0; screen.focus && screen.focus(); }
    try { showStatus('Logs opened', 'info', 1000); } catch(e) { console.log('Logs opened'); }
    try { setTimeout(attachLogOutsideClick, 0); } catch (e) {}
  } else {
    panel.classList.remove('open');
    if (backdrop) backdrop.classList.remove('open');
    try { showStatus('Logs closed', 'info', 800); } catch(e) { console.log('Logs closed'); }
    try { detachLogOutsideClick(); } catch (e) {}
  }
  try { syncNavLogsState(); } catch (e) { /* ignore */ }
}

// outside click handler reference so we can remove it
let _logOutsideHandler = null;

function attachLogOutsideClick() {
  detachLogOutsideClick();
  _logOutsideHandler = function(e) {
    const panel = document.getElementById('log-panel');
    if (!panel) return;
    if (panel.contains(e.target)) return; // click inside panel
    // also ignore clicks on the bottom nav Logs button
    const navLogs = document.getElementById('nav-logs');
    if (navLogs && navLogs.contains(e.target)) return;
      try { toggleLogs(); } catch (err) { /* ignore */ }
  };
  // attach in bubble phase so we don't intercept the click that opened the drawer
  document.addEventListener('click', _logOutsideHandler, false);
}

function detachLogOutsideClick() {
  if (_logOutsideHandler) {
    document.removeEventListener('click', _logOutsideHandler, false);
    _logOutsideHandler = null;
  }
}

// make toggleLogs available to inline onclick handlers
window.toggleLogs = toggleLogs;

// ensure nav-logs active state follows panel
function syncNavLogsState() {
  const panel = document.getElementById('log-panel');
  const navLogs = document.getElementById('nav-logs');
  if (!panel || !navLogs) return;
  const hidden = panel.getAttribute('aria-hidden') === 'true';
  if (!hidden) {
    navLogs.classList.add('active');
    panel.style.display = 'block';
  } else {
    navLogs.classList.remove('active');
    panel.style.display = 'none';
  }
}

// NOTE: MutationObserver for the log panel is added after DOM is ready (see DOMContentLoaded wiring)

function updateRetention(v) { if (typeof v === 'number') state.retentionMinutes = v; pruneLogs(); dbg(`Log retention set to ${state.retentionMinutes}`, 'debug'); }

function updateLogLevel(v) { if (v) state.logLevel = v; dbg(`Log level set to ${state.logLevel}`, 'info'); }

const el = id => document.getElementById(id);

function repoPathFor(rel) {
  // NOTE: NOTE_CONFIG.STORAGE_ROOT is a relative path used for local file fetches (e.g. '../NoteMd').
  // For GitHub API operations we need a repo-content path without leading ./ or ../, so normalize.
  const root = (NOTE_CONFIG.STORAGE_ROOT || '').replace(/^\.\/?/, '').replace(/^\.\.\//, '').replace(/\/$/, '');
  const r = rel.replace(/^\/?/, '');
  if (!root) return r;
  return root + '/' + r;
}

async function fetchJSON(path){
  const res = await fetch(path);
  if(!res.ok) throw new Error('Failed to fetch '+path);
  return res.json();
}

async function loadIndex(){
  const idxPath = `${NOTE_CONFIG.STORAGE_ROOT}/${NOTE_CONFIG.DATA_INDEX}`;
  try{
    dbg(`Loading index from ${idxPath}`, 'debug');
    const data = await fetchJSON(idxPath);
    state.notes = data;
    dbg(`Loaded index: ${state.notes.length} notes`, 'info');
  }catch(e){
    dbg('Index load failed: ' + (e && e.message), 'warn', e);
    state.notes = [];
  }
}

async function loadNoteFile(note){
  const path = `${NOTE_CONFIG.STORAGE_ROOT}/data/${note.file}`;
  try {
    dbg(`Loading note file local: ${path}`, 'debug', null, {noteId: note.id});
    const res = await fetch(path);
    if(!res.ok) { dbg(`Local note fetch failed: ${res.status}`, 'warn', {status: res.status}); return ''; }
    const txt = await res.text();
    dbg(`Loaded local note ${note.file} (${txt.length} bytes)`, 'debug');
    return txt;
  } catch (e) {
    dbg('Error loading note file: ' + (e && e.message), 'error', e, {note: note.file});
    return '';
  }
}

function renderList(){
  removeFloatingPreview();
  const list = el('notes-list');
  list.innerHTML = '';
  state.notes.forEach(n => {
    const li = document.createElement('li');
    li.dataset.id = n.id;
    li.className = 'note-item';

    // build meta block for title and subtitle (keeps layout stable and clickable areas separate)
    const meta = document.createElement('div');
    meta.className = 'note-meta';
    const title = document.createElement('div');
    title.className = 'note-title';
    title.textContent = n.title || n.file;
    meta.appendChild(title);
    const sub = document.createElement('div');
    sub.className = 'note-sub';
    sub.textContent = n.updated_at ? new Date(n.updated_at).toLocaleString() : '';
    meta.appendChild(sub);

    li.appendChild(meta);
    li.addEventListener('click', async ()=> await openNote(n.id));
    if(state.current && state.current.id===n.id) li.classList.add('active');

    // Add menu button
    const menuBtn = document.createElement('button');
    menuBtn.className = 'note-menu-btn';
    menuBtn.setAttribute('aria-label', 'Note menu');
    menuBtn.innerHTML = '&#8942;'; // vertical ellipsis
    menuBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await showNoteMenu(n, menuBtn);
    });

    li.appendChild(menuBtn);
    list.appendChild(li);
  });
}

async function showNoteMenu(note, anchorBtn) {
  // Remove any existing menu
  const oldMenu = document.getElementById('note-menu-popup');
  if (oldMenu) oldMenu.remove();
  // Create menu
  const menu = document.createElement('div');
  menu.id = 'note-menu-popup';
  menu.className = 'note-menu-popup';
  menu.innerHTML = `
    <button class="note-menu-item" id="menu-rename">Rename</button>
    <button class="note-menu-item" id="menu-download">Download .md</button>
    <button class="note-menu-item" id="menu-delete">Delete</button>
  `;
  document.body.appendChild(menu);
  // Position menu near anchorBtn
  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = (rect.bottom + window.scrollY + 4) + 'px';
  menu.style.left = (rect.left + window.scrollX - 10) + 'px';
  // Handle actions
  menu.querySelector('#menu-rename').onclick = async () => {
    menu.remove();
    await renameNote(note);
  };
  menu.querySelector('#menu-download').onclick = async () => {
    menu.remove();
    await downloadNote(note);
  };
  menu.querySelector('#menu-delete').onclick = async () => {
    menu.remove();
    await deleteCurrentNote(note);
  };
  // Remove menu on outside click
  setTimeout(() => {
    document.addEventListener('mousedown', function handler(e){
      if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('mousedown', handler); }
    });
  }, 0);
}

async function downloadNote(note) {
  let content = '';
  // Try to fetch from GitHub if configured
  const token = localStorage.getItem('note_token');
  const repo = localStorage.getItem('note_repo');
  if (token && repo) {
    try {
      const filePath = repoPathFor(`data/${note.file}`);
      dbg(`Attempting GitHub download for ${filePath}`, 'debug');
      const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        content = decodeURIComponent(escape(atob(json.content)));
        dbg(`Downloaded ${note.file} from GitHub (${content.length} bytes)`, 'info');
      } else {
        dbg(`GitHub download returned ${res.status}`, 'warn', {status: res.status});
      }
    } catch (e) {}
  }
  if (!content) {
    // fallback to local
    content = note.content || '';
  }
  const name = note.file || 'note.md';
  const blob = new Blob([content], {type:'text/markdown'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  showStatus('Downloaded ' + name, 'success');
}

async function renameNote(note) {
  const newTitle = await showPrompt('Rename note:', note.title || note.file);
  if (!newTitle || newTitle === note.title) return;
  note.title = newTitle;
  renderList();
  if (state.current && state.current.id === note.id) {
    el('note-title').value = newTitle;
  }
  dbg(`Renaming note ${note.id} -> ${newTitle}`, 'info');
  await saveCurrentToGit().catch((e) => { dbg('saveCurrentToGit failed during rename', 'warn', e); });
  showStatus('Note renamed', 'success');
}

async function deleteCurrentNote(note) {
  if (!note) return;
  const ok = await showConfirm('Delete this note?');
  if (!ok) return;
  dbg(`Deleting note ${note.id}`, 'info', null, {file: note.file});
  removeFloatingPreview();
  state.notes = state.notes.filter(n => n.id !== note.id);
  if (state.current && state.current.id === note.id) {
    state.current = null;
    el('note-title').value = '';
    el('note-editor').value = '';
    el('note-preview').innerHTML = '';
  }
  renderList();
  await saveCurrentToGit().catch((e) => { dbg('saveCurrentToGit failed during delete', 'warn', e); });
  showStatus('Note deleted', 'info');
}

async function openNote(id, forceGitHub=false){
  const note = state.notes.find(n=>n.id===id);
  if(!note) return;
  dbg(`Opening note ${id} (forceGitHub=${!!forceGitHub})`, 'debug');
  // Always fetch latest content from GitHub if credentials are present or if forced
  const token = localStorage.getItem('note_token');
  const repo = localStorage.getItem('note_repo');
  let md = '';
  if ((token && repo) || forceGitHub) {
    try {
      const filePath = repoPathFor(`data/${note.file}`);
      const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
      if (res.ok) {
        const json = await res.json();
        md = decodeURIComponent(escape(atob(json.content)));
        dbg(`Fetched ${note.file} from GitHub (${md.length} bytes)`, 'info');
      } else {
        md = await loadNoteFile(note); // fallback to local
        dbg(`GitHub fetch failed with ${res.status}, falling back to local`, 'warn', {status: res.status});
      }
    } catch (e) {
      dbg('Error fetching note from GitHub: ' + (e && e.message), 'warn', e);
      md = await loadNoteFile(note); // fallback to local
    }
  } else {
    md = await loadNoteFile(note);
  }
  state.current = {...note, content: md};
  el('note-title').value = note.title;
  el('note-editor').value = md;
  renderPreview();
  renderList();
}

function renderPreview(){
  const md = el('note-editor').value || '';
  const pv = el('note-preview');
  if (!pv) return;
  pv.innerHTML = marked.parse(md);
  // If a floating preview instance is active, mirror the content so it stays up-to-date
  try {
    const inst = document.getElementById('floating-preview-instance');
    if (inst) inst.innerHTML = pv.innerHTML;
  } catch (e) { dbg('Failed to mirror preview to floating instance', 'warn', e); }
}

function showPreview(show=true, morph=false){
  const pv = el('note-preview');
  const editor = el('note-editor');
  if (!pv || !editor) return;
  const page = document.getElementById('page-main');
  const editorWrap = document.querySelector('.editor');
  if (morph) {
    // Morph editor in-place: hide textarea and show `#note-preview` inside the editor area
    try { if (show) editorWrap.classList.add('morphed'); else editorWrap.classList.remove('morphed'); } catch (e) { /* ignore */ }
    if (show) {
      // hide the textarea and show the preview in its place
      try { editor.style.display = 'none'; } catch (e) {}
      try { pv.style.display = 'block'; pv.style.position = 'static'; pv.style.width = '100%'; pv.style.maxWidth = '100%'; } catch (e) {}
    } else {
      // restore textarea and hide preview
      try { editor.style.display = ''; } catch (e) {}
      try { pv.style.display = 'none'; pv.style.position = ''; pv.style.width = ''; pv.style.maxWidth = ''; } catch (e) {}
    }
  }
  if (page) {
    if (show) page.classList.add('live-render'); else page.classList.remove('live-render');
  }
  // Toggle preview fullscreen button visibility depending on preview visibility
  try {
    const pvBtn = el('btn-fullscreen-preview');
    if (pvBtn) {
      pvBtn.style.display = (show ? 'inline-flex' : 'none');
    }
  } catch (e) {}
}

function removeFloatingPreview(){
  try {
    const inst = document.getElementById('floating-preview-instance');
    if (inst && inst.parentNode) inst.parentNode.removeChild(inst);
    const pv = el('note-preview'); if (pv) pv.style.display = 'block';
    const editorWrap = document.querySelector('.editor'); if (editorWrap) editorWrap.classList.remove('preview-overlay');
  } catch (e) { dbg('removeFloatingPreview failed', 'warn', e); }
}

function enableLiveRender(enable) {
  state.liveRender = !!enable;
  const editor = el('note-editor');
  const liveBtn = el('btn-live-render');
  // Remove both possible listeners before adding the correct one
  try { editor.removeEventListener('input', renderPreview); } catch(e){}
  try { editor.removeEventListener('input', debounce(renderPreview, 200)); } catch(e){}
  if (state.liveRender) {
    // show preview and attach input listener for live updates
    showPreview(true);
    renderPreview();
    editor.addEventListener('input', renderPreview);
    if (liveBtn) liveBtn.classList.add('active');
  } else {
    // attach debounced input for non-live mode
    editor.addEventListener('input', debounce(renderPreview, 200));
    if (liveBtn) liveBtn.classList.remove('active');
    // hide preview when live render is disabled
    showPreview(false);
  }
}

function newNote(){
  const id = 'note-'+Date.now();
  const n = {id, title:'Untitled', file: `${id}.md`, folder:'root', created_at:new Date().toISOString(), updated_at:new Date().toISOString()};
  state.notes.unshift(n);
  state.current = {...n, content:''};
  renderList();
  el('note-title').value = n.title;
  el('note-editor').value = '';
  renderPreview();
}

function downloadCurrent(){
  if(!state.current) return;
  const name = state.current.file || 'note.md';
  const blob = new Blob([el('note-editor').value||''], {type:'text/markdown'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

function saveCurrent(){
  if(!state.current) return showStatus('No note open', 'error');
  state.current.title = el('note-title').value || 'Untitled';
  state.current.content = el('note-editor').value || '';
  state.current.updated_at = new Date().toISOString();
  dbg(`Saving current note ${state.current.id}`, 'info', null, {title: state.current.title});
  // Local-only: update index.json in-memory. Real GitHub push must be implemented in your sync flow.
  const idx = state.notes.findIndex(n=>n.id===state.current.id);
  if(idx>=0) state.notes[idx] = {...state.current};
  else state.notes.unshift({...state.current});
  renderList();
  // Try to save current note file to GitHub if configured
  saveCurrentToGit().catch(err => {
    dbg('Git save failed, kept local state: ' + (err && err.message), 'warn', err);
    showStatus('Saved locally. To push to GitHub, set credentials and try Push or Save again.', 'error');
  });
}

async function saveCurrentToGit() {
  if (!state.current) throw new Error('no-current-note');
  const token = localStorage.getItem('note_token');
  const repo = localStorage.getItem('note_repo');
  if (!token || !repo) throw new Error('github-not-configured');

  dbg(`saveCurrentToGit starting for ${state.current && state.current.file}`, 'debug');

  // 1) Upload the markdown file to NoteMd/data/<file>
  const filePath = repoPathFor(`data/${state.current.file}`);
  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  // Try to get existing file SHA
  let fileSha = null;
  try {
    const getRes = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (getRes.ok) { const j = await getRes.json(); fileSha = j.sha; }
  } catch (e) { /* ignore */ }

  const body = {
    message: `Save note ${state.current.title}: ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(state.current.content)))
  };
  if (fileSha) body.sha = fileSha;

  const putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!putRes.ok) {
    const te = await putRes.text();
    dbg('Failed to upload note file: ' + te, 'error');
    showStatus('Failed to upload note file: ' + te, 'error');
    throw new Error('failed-upload:' + te);
  }

  // 2) Update index.json in NoteMd/data/index.json to reflect title/updated_at
  // Fetch existing index.json to get its SHA
  const idxPath = repoPathFor(NOTE_CONFIG.DATA_INDEX);
  const idxUrl = `https://api.github.com/repos/${repo}/contents/${idxPath}`;
  let idxSha = state.sha || null;
  let idxList = state.notes.slice();

  try {
    const getIdx = await fetch(idxUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    if (getIdx.ok) {
      const j = await getIdx.json(); idxSha = j.sha;
      const content = decodeURIComponent(escape(atob(j.content)));
      idxList = JSON.parse(content);
      // merge/update entry
      const i = idxList.findIndex(it => it.id === state.current.id);
      if (i >= 0) idxList[i] = { id: state.current.id, title: state.current.title, file: state.current.file, folder: state.current.folder, created_at: state.current.created_at, updated_at: state.current.updated_at };
      else idxList.unshift({ id: state.current.id, title: state.current.title, file: state.current.file, folder: state.current.folder, created_at: state.current.created_at, updated_at: state.current.updated_at });
    }
  } catch (e) { /* if no index exists, we'll create it from state.notes */ }

  // PUT updated index.json
  const putIdxBody = {
    message: `Update index for note ${state.current.title}: ${new Date().toISOString()}`,
    content: btoa(unescape(encodeURIComponent(JSON.stringify(idxList, null, 2))))
  };
  if (idxSha) putIdxBody.sha = idxSha;
  const putIdxRes = await fetch(idxUrl, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(putIdxBody) });
  if (!putIdxRes.ok) {
    const te = await putIdxRes.text();
    dbg('Failed to update index.json: ' + te, 'error');
    showStatus('Failed to update index.json: ' + te, 'error');
    throw new Error('failed-index-update:' + te);
  }

  // update local state and sha
  const idxJson = await putIdxRes.json();
  state.sha = idxJson.content.sha;
  state.hasUnsavedChanges = false;
  dbg(`Index.json updated, new sha ${state.sha}`, 'info');
  showStatus('Saved to GitHub ✅', 'success');
}

function deleteCurrent(){
  if(!state.current) return;
  showConfirm('Delete this note?').then(ok => {
    if (!ok) return;
    state.notes = state.notes.filter(n=>n.id!==state.current.id);
    state.current = null;
    el('note-title').value = '';
    el('note-editor').value = '';
    el('note-preview').innerHTML = '';
    renderList();
    saveCurrentToGit().catch(()=>{});
    showStatus('Note deleted', 'info');
  });
}

function bind(){
  const editor = el('note-editor');
  // Remove both possible listeners before adding the correct one
  try { editor.removeEventListener('input', renderPreview); } catch(e){}
  try { editor.removeEventListener('input', debounce(renderPreview, 200)); } catch(e){}
  if (!state.liveRender && editor) {
    editor.addEventListener('input', debounce(renderPreview, 200));
  }
  el('btn-new').addEventListener('click', newNote);
  el('btn-save').addEventListener('click', saveCurrent);
  el('btn-delete').addEventListener('click', deleteCurrent);
  const renderBtn = el('btn-render');
  const liveBtn = el('btn-live-render');
  const editBtn = el('btn-edit');
  const settingsBtn = document.getElementById('nav-settings');
  if (renderBtn) renderBtn.onclick = () => {
    // toggle morph state
    const isMorphed = document.querySelector('.editor').classList.contains('morphed');
    if (isMorphed) {
      showPreview(false, true);
      renderBtn.classList.remove('active');
    } else {
      renderPreview();
      showPreview(true, true);
      renderBtn.classList.add('active');
    }
  };
  // hide separate Edit button UI — render acts as a toggle
  if (editBtn) editBtn.style.display = 'none';
  if (liveBtn) liveBtn.onclick = () => {
    const pressed = liveBtn.getAttribute('aria-pressed') === 'true';
    liveBtn.setAttribute('aria-pressed', (!pressed).toString());
    enableLiveRender(!pressed);
    liveBtn.textContent = (!pressed) ? '🔄 Live' : '⏹️ Live';
    liveBtn.classList.toggle('active', !pressed);
  };
  if (settingsBtn) {
    settingsBtn.onclick = () => { showPage('settings'); settingsBtn.classList.add('active'); };
  } else {
    console.warn('nav-settings not found during bind');
  }

  // Fullscreen toggles
  const fsEditorBtn = el('btn-fullscreen-editor');
  const fsPreviewBtn = el('btn-fullscreen-preview');
  if (fsEditorBtn) fsEditorBtn.addEventListener('click', toggleEditorFullscreen);
  if (fsPreviewBtn) fsPreviewBtn.addEventListener('click', togglePreviewFullscreen);
  el('search').addEventListener('input', e=>{
    const q = e.target.value.toLowerCase();
    const filtered = state.notes.filter(n=> (n.title||'').toLowerCase().includes(q) || (n.file||'').toLowerCase().includes(q));
    const list = el('notes-list'); list.innerHTML='';
    filtered.forEach(n=>{ const li=document.createElement('li'); li.textContent=n.title; li.onclick=()=>openNote(n.id); list.appendChild(li); });
  });
}

function _exitFullscreenByKey(e) {
  if (e.key === 'Escape') {
    const ed = document.querySelector('.editor.fullscreen');
    const pv = document.querySelector('.preview.fullscreen');
    if (ed) { ed.classList.remove('fullscreen'); const btn = el('btn-fullscreen-editor'); if (btn) btn.classList.remove('active'); }
    if (pv) { pv.classList.remove('fullscreen'); const btn = el('btn-fullscreen-preview'); if (btn) btn.classList.remove('active'); }
  }
}

function toggleEditorFullscreen(){
  const editor = document.querySelector('.editor');
  const textarea = el('note-editor');
  const btn = el('btn-fullscreen-editor');
  if (!editor) return;
  const is = editor.classList.toggle('fullscreen');
  // when fullscreen, ensure note-preview is hidden unless morphed
  try { if (is) { document.body.style.overflow = 'hidden'; } else { document.body.style.overflow = ''; } } catch(e){}
  if (btn) btn.classList.toggle('active', is);
  // When editor fullscreen, show preview button to also allow preview fullscreen
  const pvBtn = el('btn-fullscreen-preview'); if (pvBtn) pvBtn.style.display = is ? 'inline-flex' : 'none';
  // mark global fullscreen state
  document.body.classList.toggle('has-fullscreen', is);
  // attach Escape handler while fullscreen
  if (is) document.addEventListener('keydown', _exitFullscreenByKey); else document.removeEventListener('keydown', _exitFullscreenByKey);
}

function togglePreviewFullscreen(){
  const pv = el('note-preview');
  const btn = el('btn-fullscreen-preview');
  if (!pv) return;
  const is = pv.classList.toggle('fullscreen');
  if (btn) btn.classList.toggle('active', is);
  try { if (is) { document.body.style.overflow = 'hidden'; } else { document.body.style.overflow = ''; } } catch(e){}
  // mark global fullscreen state
  document.body.classList.toggle('has-fullscreen', is);
  if (is) document.addEventListener('keydown', _exitFullscreenByKey); else document.removeEventListener('keydown', _exitFullscreenByKey);
}

// Settings helpers
function loadSettings() {
  const t = localStorage.getItem('note_token');
  const r = localStorage.getItem('note_repo');
  const a = localStorage.getItem('note_autosave') === 'true';
  const tokenEl = document.getElementById('cfg-token');
  const repoEl = document.getElementById('cfg-repo');
  const autoEl = document.getElementById('cfg-autosave');
  if (tokenEl) tokenEl.value = t || '';
  if (repoEl) repoEl.value = r || '';
  if (autoEl) autoEl.checked = !!a;
}

function saveSettings() {
  const tokenEl = document.getElementById('cfg-token');
  const repoEl = document.getElementById('cfg-repo');
  const autoEl = document.getElementById('cfg-autosave');
  if (tokenEl && repoEl) {
    const t = tokenEl.value.trim();
    const r = repoEl.value.trim();
    localStorage.setItem('note_token', t);
    localStorage.setItem('note_repo', r);
    localStorage.setItem('note_autosave', !!(autoEl && autoEl.checked));
    showStatus('Settings saved', 'success');
    closeSettings();
  }
}

function openSettings() {
  showPage('settings');
}

function closeSettings() {
  showPage('main');
}

function showPage(p) {
  removeFloatingPreview();
  const pages = document.querySelectorAll('.page');
  pages.forEach(page => { page.style.display = 'none'; page.classList.remove('active'); });
  if (p === 'settings') {
    const s = document.getElementById('page-settings');
    // hide main app wrapper and footer so settings looks like a separate page
    const wrap = document.querySelector('.app-wrap');
    const footer = document.querySelector('footer');
    if (wrap) wrap.style.display = 'none';
    if (footer) footer.style.display = 'none';
    // show settings page and allow it to scroll internally
    if (s) { s.style.display = 'block'; s.classList.add('active'); s.scrollTop = 0; }
    // populate settings inputs
    try { loadSettings(); } catch (e) { /* ignore */ }
    // focus first input for accessibility
    const tokenEl = document.getElementById('cfg-token'); if (tokenEl) { tokenEl.focus(); }
    document.body.style.overflow = 'hidden';
    // Add a spacer element at the end of the settings page so users can scroll content above the fixed bottom-nav
    try {
        const bottomNav = document.querySelector('.bottom-nav');
      const existing = document.getElementById('page-bottom-spacer');
      if (existing) existing.remove();
      if (bottomNav && s) {
        const navRect = bottomNav.getBoundingClientRect();
        const extra = (navRect.height || 80) + 24; // extra breathing room
        const spacer = document.createElement('div');
        spacer.id = 'page-bottom-spacer';
        spacer.style.height = extra + 'px';
        spacer.style.width = '100%';
        spacer.style.pointerEvents = 'none';
        s.appendChild(spacer);
        // update on resize
        window.addEventListener('resize', updatePageSpacer);
        // ensure settings container scrolls internally and fits above header
        try {
          const header = document.querySelector('.header');
          const headerH = header ? header.getBoundingClientRect().height : 100;
          const maxH = window.innerHeight - headerH - 24; // leave a little breathing room
          s.style.maxHeight = maxH + 'px';
          s.style.overflow = 'auto';
        } catch (e) {}
      }
    } catch (e) {}
    setActiveNav('settings');
  } else {
    // show main app container
    const main = document.getElementById('page-main');
    if (main) main.style.display = 'block';
    // hide settings explicitly
    const s = document.getElementById('page-settings'); if (s) { s.style.display = 'none'; s.classList.remove('active'); }
    // restore main wrapper and footer
    const wrap = document.querySelector('.app-wrap');
    const footer = document.querySelector('footer');
    if (wrap) wrap.style.display = '';
    if (footer) footer.style.display = '';
    document.body.style.overflow = '';
    // restore settings page layout
    try { const s = document.getElementById('page-settings'); if (s) { s.style.maxHeight = ''; s.style.overflow = ''; } } catch (e) {}
    // Remove spacer if present
    try { const sp = document.getElementById('page-bottom-spacer'); if (sp) sp.remove(); window.removeEventListener('resize', updatePageSpacer); } catch (e) {}
    setActiveNav('main');
  }
}

function updatePageSpacer() {
  try {
    const bottomNav = document.querySelector('.bottom-nav');
    const spacer = document.getElementById('page-bottom-spacer');
    if (!bottomNav || !spacer) return;
    const navRect = bottomNav.getBoundingClientRect();
    const extra = (navRect.height || 80) + 24;
    spacer.style.height = extra + 'px';
  } catch (e) {}
}
function setActiveNav(name) {
  try {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const nh = document.getElementById('nav-home'); if (name === 'main' && nh) nh.classList.add('active');
    const ns = document.getElementById('nav-settings'); if (name === 'settings' && ns) ns.classList.add('active');
    const na = document.getElementById('nav-apps'); if (name === 'apps' && na) na.classList.add('active');
    const nl = document.getElementById('nav-logs'); if (name === 'logs' && nl) nl.classList.add('active');
  } catch (e) { console.warn('setActiveNav failed', e); }
}

// wire settings buttons after DOM ready
document.addEventListener('DOMContentLoaded', ()=>{
  const openBtn = document.getElementById('btn-fetch');
  if (openBtn) openBtn.addEventListener('dblclick', openSettings); // quick access: dblclick Fetch
  const saveBtn = document.getElementById('btn-save-settings');
  const closeBtn = document.getElementById('btn-close-settings');
  if (saveBtn) saveBtn.addEventListener('click', saveSettings);
  if (closeBtn) closeBtn.addEventListener('click', closeSettings);
  // header settings button removed; settings accessed via bottom nav
  // settings page buttons
  const fetchGit = document.getElementById('btn-fetch-git');
  const pushGit = document.getElementById('btn-push-git');
  const clearLocal = document.getElementById('btn-clear-local');
  if (fetchGit) fetchGit.addEventListener('click', fetchFromGit);
  if (pushGit) pushGit.addEventListener('click', pushToGit);
  if (clearLocal) clearLocal.addEventListener('click', async ()=>{ const ok = await showConfirm('Clear local notes?'); if(ok){ state.notes=[]; state.current=null; renderList(); showStatus('Local notes cleared', 'info'); } });
  // top bar settings buttons
  const fetchGitTop = document.getElementById('btn-fetch-git-top');
  const pushGitTop = document.getElementById('btn-push-git-top');
  if (fetchGitTop) fetchGitTop.addEventListener('click', fetchFromGit);
  if (pushGitTop) pushGitTop.addEventListener('click', pushToGit);
  const navHome = document.getElementById('nav-home');
  const navSettings = document.getElementById('nav-settings');
  const navLogs = document.getElementById('nav-logs');
  const navApps = document.getElementById('nav-apps');
  if (navHome) navHome.addEventListener('click', ()=> showPage('main'));
  if (navSettings) navSettings.addEventListener('click', ()=> showPage('settings'));
  if (navLogs) {
    // If an inline onclick is already present in the HTML, avoid adding a duplicate listener
    if (!navLogs.getAttribute('onclick')) {
      navLogs.addEventListener('click', ()=>{ toggleLogs(); navLogs.classList.toggle('active'); });
    } else {
      // still toggle active class when clicked (inline handler will toggle panel)
      navLogs.addEventListener('click', ()=> navLogs.classList.toggle('active'));
    }
  }
  // ensure clicking settings also updates hash for fallback
  if (navSettings) navSettings.addEventListener('click', ()=> { window.location.hash = '#settings'; });
  if (navApps) navApps.addEventListener('click', () => {
    setActiveNav('apps');
    window.location.href = '../index.html';
  });
  // Ensure log panel observer and initial render
  try {
    const lp = document.getElementById('log-panel');
    if (lp) {
      // Default aria-hidden to true if not set
      if (!lp.hasAttribute('aria-hidden')) lp.setAttribute('aria-hidden','true');
      // Render existing state.logs into the screen
      const screen = document.getElementById('log-screen');
      if (screen && state.logs && state.logs.length>0) {
        // render newest first
        screen.innerHTML = '';
        for (let i = state.logs.length-1; i>=0; i--) {
          const l = state.logs[i];
          const el = document.createElement('div');
          el.className = `log-item ${l.type === 'error' ? 'log-error' : l.type === 'warn' ? 'log-warn' : ''}`;
          el.innerText = l.text;
          screen.appendChild(el);
        }
      }
      if (window.MutationObserver) {
        const mo = new MutationObserver(syncNavLogsState);
        mo.observe(lp, { attributes: true, attributeFilter: ['aria-hidden'] });
      }
      // backdrop click closes panel
      try {
        const backdrop = document.getElementById('log-drawer-backdrop');
          if (backdrop) backdrop.addEventListener('click', ()=>{ toggleLogs(); });
      } catch (e) { /* ignore */ }
      // If panel is currently open on load, attach outside click handler
      try { if (lp.getAttribute('aria-hidden') === 'false') attachLogOutsideClick(); } catch (e) {}
    }
  } catch (e) { console.warn('Log panel init failed', e); }
  // Log panel controls
  const btnCopy = document.getElementById('btn-copy-logs');
  const btnSave = document.getElementById('btn-save-logs');
  const btnClear = document.getElementById('btn-clear-logs');
  const btnCloseLogs = document.getElementById('btn-close-logs');
  const levelSel = document.getElementById('log-level');
  const retentionSel = document.getElementById('log-retention');
  if (btnCopy) btnCopy.addEventListener('click', copyLogs);
  if (btnSave) btnSave.addEventListener('click', saveLogs);
  if (btnClear) btnClear.addEventListener('click', ()=>{ clearLogs(); showStatus('Logs cleared', 'info'); });
  if (btnCloseLogs) btnCloseLogs.addEventListener('click', ()=>{ const lp = document.getElementById('log-panel'); if (lp) lp.setAttribute('aria-hidden','true'); });
  if (levelSel) levelSel.addEventListener('change', (e)=> updateLogLevel(e.target.value));
  if (retentionSel) retentionSel.addEventListener('change', (e)=> updateRetention(parseInt(e.target.value,10)));
  window.addEventListener('hashchange', ()=>{ if (window.location.hash === '#settings') showPage('settings'); if (!window.location.hash || window.location.hash === '#') showPage('main'); });
});

// Update saveCurrentToGit to consider autosave
const _saveCurrentToGit = saveCurrentToGit;
saveCurrentToGit = async function() {
  const autosave = localStorage.getItem('note_autosave') === 'true';
  try {
    await _saveCurrentToGit();
    if (autosave) {
      // auto-update index already handled in _saveCurrentToGit
    }
  } catch (e) { throw e; }
};

function debounce(fn,ms){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); }}

async function init(){
  try { dbg('NoteMD initializing', 'info'); } catch (e) {}
  try { if (window.applyNoteConfig) window.applyNoteConfig(); } catch (e) {}
  // Try to fetch from GitHub first when credentials are configured, otherwise load local files
  const token = localStorage.getItem('note_token');
  const repo = localStorage.getItem('note_repo');
  if (token && repo) {
    try {
      dbg('Credentials found; attempting fetchFromGit', 'debug');
      await fetchFromGit();
    } catch (e) {
      dbg('fetchFromGit failed, loading local index: ' + (e && e.message), 'warn', e);
      try { await loadIndex(); } catch (err) { dbg('loadIndex failed: ' + (err && err.message), 'error', err); }
    }
  } else {
    try{ await loadIndex(); } catch(e){ console.error(e); }
  }

  renderList();
  bind();
  // open first note if available
  if(state.notes.length>0) openNote(state.notes[0].id);
  // ensure main page is visible by default
  showPage('main');
  // hide preview by default
  showPreview(false);
  // If URL contains #settings, open settings on load (robust fallback)
  if (window.location.hash === '#settings') {
    try { showPage('settings'); } catch (e) { /* ignore */ }
  }
  try { dbg('NoteMD ready', 'info'); } catch (e) {}
}

window.addEventListener('DOMContentLoaded', init);

// --- GitHub sync helpers (mirror todo-app/storage.js behavior)
async function fetchFromGit() {
  const token = localStorage.getItem('note_token');
  const repo = localStorage.getItem('note_repo');
  if (!token || !repo) { showStatus('Please configure GitHub settings first', 'error'); return; }
  dbg('fetchFromGit starting', 'debug');
  const dataFile = `${NOTE_CONFIG.DATA_INDEX}`;
  const repoIndexPath = repoPathFor(dataFile);
  const url = `https://api.github.com/repos/${repo}/contents/${repoIndexPath}`;
  try {
    const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
      const json = await res.json();
      // update state.notes and cache sha
      const content = decodeURIComponent(escape(atob(json.content)));
      state.notes = JSON.parse(content);
      state.sha = json.sha;
      renderList();
      // After fetching index, load and display first note's content
      if (state.notes.length > 0) {
        await openNote(state.notes[0].id, true); // force fetch from GitHub
      }
      dbg('Fetched index from GitHub', 'info');
      showStatus('Fetched index from GitHub', 'success');
    } else if (res.status === 404) {
      dbg('No data file found in repo (404)', 'info');
      showStatus('No data file found in repo - will create on first push', 'info');
    } else {
      throw new Error('Fetch failed');
    }
  } catch (err) { console.error('Fetch error', err); showStatus('Failed to fetch from GitHub', 'error'); }
}

async function pushToGit(isAutoSave = false) {
  const token = localStorage.getItem('note_token');
  const repo = localStorage.getItem('note_repo');
  if (!token || !repo) { showStatus('Please configure GitHub settings first', 'error'); return; }
  if (state.autoSyncing) return;
  dbg('pushToGit starting', 'debug', null, {notes: state.notes.length});
  state.autoSyncing = true;
  const dataFile = `${NOTE_CONFIG.DATA_INDEX}`;
  const repoIndexPath = repoPathFor(dataFile);
  const url = `https://api.github.com/repos/${repo}/contents/${repoIndexPath}`;
  try {
    const jsonContent = JSON.stringify(state.notes, null, 2);
    const body = { message: "Update notes index: " + new Date().toISOString(), content: btoa(unescape(encodeURIComponent(jsonContent))) };
    if (state.sha) body.sha = state.sha;
    const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (res.ok) {
      const j = await res.json();
      state.sha = j.content.sha;
      state.hasUnsavedChanges = false;
      dbg('Pushed index to GitHub, new sha=' + state.sha, 'info');
      showStatus('Pushed index to GitHub', 'success');
    } else {
      throw new Error('Push failed');
    }
  } catch (err) { console.error('Push error', err); showStatus('Failed to push to GitHub', 'error'); }
  finally { state.autoSyncing = false; }
}

// Wire fetch/push buttons
document.addEventListener('DOMContentLoaded', () => {
  const bf = document.getElementById('btn-fetch');
  const bp = document.getElementById('btn-push');
  if (bf) bf.addEventListener('click', fetchFromGit);
  if (bp) bp.addEventListener('click', pushToGit);
});

// Status message box
function showStatus(msg, type='info', timeout=3000) {
  const box = document.getElementById('status-box');
  const msgEl = document.getElementById('status-msg');
  if (!box || !msgEl) return;
  box.style.display = 'block';
  box.style.background = type==='error' ? '#d32f2f' : (type==='success' ? '#007aff' : '#222');
  msgEl.textContent = msg;
  box.style.opacity = '0.95';
  setTimeout(() => {
    box.style.opacity = '0';
    setTimeout(() => { box.style.display = 'none'; }, 400);
  }, timeout);
}

// Floating, non-blocking confirm/prompt helpers that appear near the top-right
function _ensureFloatingRoot(){
  let root = document.getElementById('floating-ui-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'floating-ui-root';
    document.body.appendChild(root);
  }
  return root;
}

function showConfirm(message, opts = {}){
  return new Promise(resolve => {
    const root = _ensureFloatingRoot();
    const panel = document.createElement('div');
    panel.className = 'confirm-panel floating-panel';
    panel.innerHTML = `
      <div class="confirm-msg">${message}</div>
      <div class="confirm-actions">
        <button class="btn btn-cancel">${opts.cancelLabel||'Cancel'}</button>
        <button class="btn btn-ok">${opts.okLabel||'OK'}</button>
      </div>
    `;
    root.appendChild(panel);
    const cleanup = (res)=>{ try{ panel.remove(); }catch(e){} resolve(res); };
    panel.querySelector('.btn-cancel').addEventListener('click', ()=> cleanup(false));
    panel.querySelector('.btn-ok').addEventListener('click', ()=> cleanup(true));
    // keyboard support
    const keyHandler = (e)=>{
      if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', keyHandler); }
      if (e.key === 'Enter') { cleanup(true); document.removeEventListener('keydown', keyHandler); }
    };
    setTimeout(()=>{ document.addEventListener('keydown', keyHandler); }, 0);
  });
}

function showPrompt(message, defaultValue=''){
  return new Promise(resolve => {
    const root = _ensureFloatingRoot();
    const panel = document.createElement('div');
    panel.className = 'prompt-panel floating-panel';
    panel.innerHTML = `
      <div class="prompt-msg">${message}</div>
      <input class="prompt-input" value="${String(defaultValue).replace(/"/g,'&quot;')}">
      <div class="confirm-actions">
        <button class="btn btn-cancel">Cancel</button>
        <button class="btn btn-ok">OK</button>
      </div>
    `;
    root.appendChild(panel);
    const input = panel.querySelector('.prompt-input');
    input.focus(); input.select();
    const cleanup = (val)=>{ try{ panel.remove(); }catch(e){} resolve(val); };
    panel.querySelector('.btn-cancel').addEventListener('click', ()=> cleanup(null));
    panel.querySelector('.btn-ok').addEventListener('click', ()=> cleanup(input.value));
    const keyHandler = (e)=>{
      if (e.key === 'Escape') { cleanup(null); document.removeEventListener('keydown', keyHandler); }
      if (e.key === 'Enter') { cleanup(input.value); document.removeEventListener('keydown', keyHandler); }
    };
    setTimeout(()=>{ document.addEventListener('keydown', keyHandler); }, 0);
  });
}

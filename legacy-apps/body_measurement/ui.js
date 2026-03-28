// ui.js - rendering and UI interactions for Body Measurement
function bm_formatDateISO(d) {
  if (!d) return '';
  const dt = new Date(d);
  return dt.toISOString().slice(0,10);
}

// Simple in-memory logs and UI writer
const bm_logs = [];
function bm_log(msg, level='info') {
  const ts = new Date().toISOString();
  const row = { ts, level, msg };
  bm_logs.unshift(row);
  // append to UI if present
  const list = document.getElementById('bm-log-list');
  if (list) {
    const el = document.createElement('div'); el.className = 'bm-log-row';
    el.innerHTML = `<div style="font-size:12px;color:var(--text-secondary);">${ts}</div><div style="font-weight:600;margin-top:4px;">${level.toUpperCase()}</div><div style="margin-top:6px;">${String(msg)}</div>`;
    list.insertBefore(el, list.firstChild);
  }
  console.log(`[BM ${level}] ${msg}`);
}

function showNotification(msg, type='info') {
  // log it
  try { bm_log(msg, type); } catch(e){}
  // small toast
  const t = document.createElement('div'); t.className = 'bm-toast'; t.textContent = msg; document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('visible'));
  setTimeout(()=>{ t.classList.remove('visible'); setTimeout(()=>t.remove(),250); }, 2200);
}

// Render the log panel content from `bm_logs` array
function bm_renderLogPanel() {
  const list = document.getElementById('bm-log-list');
  if (!list) return;
  list.innerHTML = '';
  if (!bm_logs || bm_logs.length === 0) {
    list.innerHTML = '<div class="bm-empty">No logs yet.</div>';
    return;
  }
  for (const row of bm_logs) {
    const el = document.createElement('div'); el.className = 'bm-log-row';
    el.innerHTML = `<div style="font-size:12px;color:var(--text-secondary);">${row.ts}</div><div style="font-weight:600;margin-top:4px;">${row.level.toUpperCase()}</div><div style="margin-top:6px;">${String(row.msg)}</div>`;
    list.appendChild(el);
  }
}

// Toggle log panel visibility and ensure it's populated when opened
function bm_toggleLogs() {
  const lp = document.getElementById('log-panel');
  if (!lp) return;
  const isHidden = lp.getAttribute('aria-hidden') === 'true';
  lp.setAttribute('aria-hidden', isHidden ? 'false' : 'true');
  if (isHidden) {
    bm_renderLogPanel();
  }
}

// initial log so the panel isn't empty
try { bm_log('Log initialized', 'info'); } catch(e){}

function bm_buildEntryCard(e, idx) {
  const el = document.createElement('div');
  el.className = 'bm-entry-card';
  const date = e.date || bm_formatDateISO(e.timestamp);
  el.innerHTML = `<div class="bm-row"><div class="bm-weight">${e.weight} kg</div><div class="bm-date">${date}</div></div>`;
  const opt = [];
  if (e.bodyFat) opt.push(`BF: ${e.bodyFat}%`);
  if (e.bmi) opt.push(`BMI: ${e.bmi}`);
  if (e.muscleMass) opt.push(`MM: ${e.muscleMass}kg`);
  if (e.fatMass) opt.push(`FM: ${e.fatMass}kg`);
  if (opt.length) {
    const meta = document.createElement('div'); meta.className = 'bm-meta'; meta.textContent = opt.join(' | ');
    el.appendChild(meta);
  }
  return el;
}

async function bm_renderList(limit = 50) {
  const container = document.getElementById('bm-list');
  if (!container) return;
  if (typeof bm_log === 'function') bm_log(`bm_renderList: rendering up to ${limit} entries`, 'info');
  container.innerHTML = '<div class="bm-loading">Loading...</div>';
  try {
    const entries = await bm_getEntries(limit);
    if (typeof bm_log === 'function') bm_log(`bm_renderList: fetched ${entries.length} entries`, 'debug');
    container.innerHTML = '';
    if (!entries || entries.length === 0) {
      container.innerHTML = '<div class="bm-empty">No entries yet. Add your first weight.</div>';
      if (typeof bm_log === 'function') bm_log('bm_renderList: no entries to display', 'debug');
      return;
    }
    entries.forEach((e,i) => {
      const card = bm_buildEntryCard(e, i);
      container.appendChild(card);
    });
  } catch (e) {
    container.innerHTML = `<div class="bm-error">Failed to load entries: ${e.message}</div>`;
    if (typeof bm_log === 'function') bm_log(`bm_renderList: failed to load entries -> ${e.message}`, 'error');
  }
}

function bm_readForm() {
  const weight = parseFloat(document.getElementById('bm-weight').value);
  const date = document.getElementById('bm-date').value || bm_formatDateISO(new Date());
  const bodyFat = document.getElementById('bm-bodyfat').value;
  const bmi = document.getElementById('bm-bmi').value;
  const muscleMass = document.getElementById('bm-muscle').value;
  const fatMass = document.getElementById('bm-fatmass').value;
  return {
    weight: isNaN(weight) ? null : weight,
    date,
    timestamp: new Date(date).toISOString(),
    bodyFat: bodyFat ? parseFloat(bodyFat) : undefined,
    bmi: bmi ? parseFloat(bmi) : undefined,
    muscleMass: muscleMass ? parseFloat(muscleMass) : undefined,
    fatMass: fatMass ? parseFloat(fatMass) : undefined
  };
}

async function bm_handleAddEntry(e) {
  e && e.preventDefault();
  const entry = bm_readForm();
  if (!entry.weight) { alert('Please enter a valid weight'); return; }
  if (typeof bm_log === 'function') bm_log(`bm_handleAddEntry: adding entry date=${entry.date} weight=${entry.weight}`, 'info');
  try {
    // check whether this date already has entries in index
    const existingFile = await bm_getFileForDate(entry.date);
    if (existingFile) {
      if (typeof bm_log === 'function') bm_log(`bm_handleAddEntry: detected existing file ${existingFile} for ${entry.date}`, 'warn');
      const ok = window.confirm(`Entries already exist for ${entry.date} in file ${existingFile}.\n\nChoose OK to OVERWRITE existing entries for this date, or Cancel to append to active file.`);
      if (ok) {
        if (typeof bm_log === 'function') bm_log(`bm_handleAddEntry: user chose to overwrite ${entry.date}`, 'info');
        await bm_replaceEntriesForDate(entry.date, [entry]);
      } else {
        if (typeof bm_log === 'function') bm_log(`bm_handleAddEntry: user chose to append to ${entry.date}`, 'info');
        await bm_appendEntry(entry);
      }
    } else {
      await bm_appendEntry(entry);
    }
    if (typeof showNotification === 'function') showNotification('Weight saved', 'write');
    else {
      const n = document.createElement('div'); n.textContent = 'Weight saved'; n.style.position='fixed'; n.style.right='16px'; n.style.top='16px'; n.style.padding='8px 12px'; n.style.background='#34c759'; n.style.color='#fff'; n.style.borderRadius='8px'; document.body.appendChild(n); setTimeout(()=>n.remove(),2000);
    }
    await bm_renderList(50);
    document.getElementById('bm-form').reset();
  } catch (err) {
    console.error(err);
    if (typeof bm_log === 'function') bm_log('bm_handleAddEntry: failed to save entry -> ' + err.message, 'error');
    alert('Failed to save entry: ' + err.message);
  }
}

// History UI has been moved to history.js

// --- CSV IMPORT FEATURE (mirrors tracker behavior) ---
/* CSV functions moved to csv.js */

// Settings modal handlers: store into gt_token / gt_repo so storage uses same keys
function bm_showSettings() {
  const modal = document.getElementById('bm-settings-modal');
  if (!modal) return;
  // populate fields from localStorage
  const token = localStorage.getItem('gt_token') || '';
  const repo = localStorage.getItem('gt_repo') || '';
  const t = document.getElementById('bm-cfg-token');
  const r = document.getElementById('bm-cfg-repo');
  if (t) t.value = token; if (r) r.value = repo;
  modal.style.display = 'block';
}

function bm_hideSettings() {
  const modal = document.getElementById('bm-settings-modal'); if (!modal) return; modal.style.display = 'none';
}

function bm_saveSettings() {
  const t = document.getElementById('bm-cfg-token');
  const r = document.getElementById('bm-cfg-repo');
  if (!t || !r) return;
  const token = t.value.trim(); const repo = r.value.trim();
  if (token) localStorage.setItem('gt_token', token); else localStorage.removeItem('gt_token');
  if (repo) localStorage.setItem('gt_repo', repo); else localStorage.removeItem('gt_repo');
  // If we're on a modal, hide it; if on a full settings page, keep fields populated
  try { bm_hideSettings(); } catch(e){}
  if (typeof showNotification === 'function') showNotification('Settings saved', 'write');
}

// Initialize full settings page inputs from localStorage (used by settings.html)
function bm_initSettingsPage() {
  const t = document.getElementById('bm-cfg-token');
  const r = document.getElementById('bm-cfg-repo');
  if (!t && !r) return;
  const token = localStorage.getItem('gt_token') || '';
  const repo = localStorage.getItem('gt_repo') || '';
  if (t) t.value = token;
  if (r) r.value = repo;
}


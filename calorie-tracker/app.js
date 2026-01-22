let state = { 
    entries: [], 
    sha: "", 
    logs: [], 
    retentionMinutes: 5, 
    schema: null,
    fileIndex: {},
    logLevel: 'info', // debug, info, warn, error
    dateRangeStart: null,
    dateRangeEnd: null,
    selectMode: false,
    selectedEntries: new Set(),
    hasUnsavedChanges: false,
    historySelectMode: false,
    historySelectedEntries: new Set(),
    tempCsvData: null,
    csvSource: null,
    autoSyncing: false
    
};

// Track which history date-sets we've attempted to prefetch to avoid fetch loops
state.historyPrefetchAttempts = new Set();

const LOG_LEVELS = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3
};

// --- EXTENSIVE LOGGING SYSTEM ---
function dbg(msg, type = 'info', raw = null) {
    // Check if this log should be displayed based on log level
    const currentLevel = LOG_LEVELS[state.logLevel] || 1;
    const messageLevel = LOG_LEVELS[type] || 1;
    
    if (messageLevel < currentLevel) return; // Skip if below threshold
    
    const screen = document.getElementById('log-screen');
    if (!screen) return;
    const item = document.createElement('div');
    item.className = `log-item ${type === 'error' ? 'log-error' : type === 'warn' ? 'log-warn' : type === 'debug' ? 'log-debug' : ''}`;

    const timestamp = new Date().toLocaleTimeString();
    let text = `[${timestamp}] [${type.toUpperCase()}] ${msg}`;
    if (raw) text += `\nRAW: ${JSON.stringify(raw, null, 2)}`;

    item.innerText = text;
    screen.prepend(item);

    try {
        state.logs.unshift({ ts: Date.now(), text, type });
        pruneLogs();
    } catch (e) { /* ignore */ }
}

// Lightweight toast notification (non-blocking)
function showNotification(message, type = 'info') {
    try {
        const n = document.createElement('div');
        n.className = 'gt-notification';
        n.textContent = message;
        // basic styling placed inline to avoid touching CSS files
        n.style.cssText = 'position: fixed; top: 16px; right: 16px; background: var(--card-bg); color: var(--text); padding: 10px 14px; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.12); z-index: 10000; font-size: 13px; font-weight:600; opacity:1; transition: opacity 0.25s;';
        if (type === 'error') {
            n.style.background = '#ff3b30';
            n.style.color = '#fff';
        } else if (type === 'success') {
            n.style.background = 'linear-gradient(90deg,#34c759 0%, #30d158 100%)';
            n.style.color = '#fff';
        }
        document.body.appendChild(n);
        setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 2500);
    } catch (e) { /* ignore */ }
}

function toggleViewMode() {
    state.viewMode = state.viewMode === 'today' ? 'all' : 'today';
    const btn = document.getElementById('view-toggle-btn');
    if (btn) btn.textContent = state.viewMode === 'today' ? 'Show: Today' : 'Show: All';
    dbg(`View mode changed to: ${state.viewMode}`, 'info');
    render();
}

function updateDateButton() {
    const btn = document.getElementById('date-btn');
    if (!btn) return;
    btn.textContent = getTodayString();
}

// Helper: canonical today string used for filenames (YYYY-MM-DD)
function getTodayString() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function updateBudgetUI(todayTotal) {
    const budget = parseInt(getConfig('dailyBudget') || 0, 10) || 0;
    // Calculate total if not passed
    let total = 0;
    if (typeof todayTotal === 'number') {
        total = todayTotal;
    } else {
        total = state.entries.reduce((s, e) => {
            if (!isTodayEntry(e)) return s;
            const c = parseFloat(e.calories);
            return s + (isNaN(c) ? 0 : c);
        }, 0);
    }
    const pct = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 0;
    dbg(`Budget UI: total=${total} budget=${budget} pct=${pct}%`, 'debug');
    const fill = document.getElementById('budget-bar-fill');
    const vals = document.getElementById('budget-values');
    if (fill) fill.style.width = pct + '%';
    if (vals) vals.textContent = `${Math.round(total)} / ${budget} kcal`;
    // Color warning if over budget
    if (fill) {
        if (total > budget) {
            fill.style.background = 'linear-gradient(90deg, #ff3b30 0%, #ff7b7b 100%)';
        } else {
            fill.style.background = 'linear-gradient(90deg, #34c759 0%, #ffd60a 60%, #ff3b30 100%)';
        }
    }
}

// Main render entry used across the app. Kept minimal so it's safe to call
// early in startup before other render helpers are defined.
function render() {
    try {
        // Compute today's total only from entries that match the canonical today date
        const today = getTodayString();
        const todayTotal = Array.isArray(state.entries)
            ? state.entries.reduce((s, e) => (getEntryDate(e) === today ? s + (parseFloat(e.calories) || 0) : s), 0)
            : 0;
        if (typeof updateBudgetUI === 'function') updateBudgetUI(todayTotal);

        const activePage = document.querySelector('.page.active');

        // Refresh history view if available
        if (activePage && activePage.id === 'page-history' && typeof renderHistory === 'function') {
            renderHistory();
        }

        // Render tracker list (today's entries) into #list-container
        if (activePage && activePage.id === 'page-tracker') {
            try {
                const listContainer = document.getElementById('list-container');
                if (listContainer) {
                    listContainer.innerHTML = '';
                    const today = getTodayString();
                    const todayIdx = [];
                    state.entries.forEach((e, i) => {
                        const d = getEntryDate(e);
                        if (d === today) todayIdx.push({ entry: e, idx: i });
                    });

                    if (todayIdx.length === 0) {
                        listContainer.innerHTML = '<div class="empty-state">No entries for today. Add one above.</div>';
                    } else {
                        todayIdx.forEach(({ entry, idx }) => {
                            const card = buildEntryCard(entry, idx, { mode: 'tracker' });
                            listContainer.appendChild(card);
                        });
                    }
                }
            } catch (e) { dbg(`render tracker list error: ${e && e.message ? e.message : String(e)}`, 'error', e); }
        }
    } catch (e) {
        try { dbg(`render error: ${e && e.message ? e.message : String(e)}`, 'error', e); } catch (eee) { /* ignore */ }
    }
}

async function saveBudgetToRepo() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) {
        alert('Missing GitHub credentials. Configure in Settings first.');
        showPage('settings');
        return;
    }

    const budgetInput = document.getElementById('cfg-daily-budget');
    const budget = budgetInput ? parseInt(budgetInput.value, 10) : getConfig('dailyBudget');
    if (isNaN(budget) || budget <= 0) {
        alert('Please enter a valid daily budget value before saving to repo.');
        return;
    }

    const dataFile = 'budget.json';
    const url = `https://api.github.com/repos/${repo}/contents/${dataFile}`;
    const body = {
        message: `Budget: ${new Date().toISOString()}`,
        content: btoa(unescape(encodeURIComponent(JSON.stringify({ dailyBudget: budget }, null, 2))))
    };

    // Try to fetch existing file to include SHA
    try {
        const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (getRes.ok) {
            const j = await getRes.json();
            if (j.sha) body.sha = j.sha;
        }
    } catch (e) { /* ignore */ }

    try {
        const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) {
            const json = await res.json();
            setConfig('dailyBudget', budget);
            showNotification('Budget saved to repo ✅');
            dbg('Budget saved to GitHub', 'info');
        } else {
            const err = await res.json();
            dbg('Failed to save budget: ' + (err.message || res.statusText), 'error', err);
            alert('Failed to save budget to repo. Check logs.');
        }
    } catch (err) {
        dbg('Save budget error: ' + err.message, 'error');
        alert('Error saving budget to repo. Check logs.');
    }
}

// Debug helper: dump entry matching info (only when debug enabled)
function dumpEntryDebugInfo() {
    if (LOG_LEVELS[state.logLevel] > LOG_LEVELS.debug) return;
    try {
        state.entries.forEach((entry, i) => {
            const reportedDate = entry.date || (entry.timestamp ? formatDateLocal(entry.timestamp) : 'none');
            const match = isTodayEntry(entry);
            dbg(`Entry[${i}] date:${entry.date || 'n/a'} timestamp:${entry.timestamp || 'n/a'} -> reported:${reportedDate} match:${match}`, 'debug');
        });
    } catch (e) { /* ignore */ }
}

// Call debug dump after render to help diagnose date issues
dumpEntryDebugInfo();

function clearLogs() { document.getElementById('log-screen').innerHTML = ''; }

function pruneLogs() {
    // retentionMinutes === 0 means keep all
    if (!state.retentionMinutes || state.retentionMinutes <= 0) return;
    const cutoff = Date.now() - state.retentionMinutes * 60 * 1000;
    // remove logs older than cutoff
    state.logs = state.logs.filter(l => l.ts >= cutoff);
    // also truncate DOM if needed
    const screen = document.getElementById('log-screen');
    if (!screen) return;
    // Re-render screen from state.logs (in reverse order since newest is first in array)
    screen.innerHTML = '';
    for (let i = state.logs.length - 1; i >= 0; i--) {
        const l = state.logs[i];
        const el = document.createElement('div');
        el.className = `log-item ${l.type === 'error' ? 'log-error' : l.type === 'warn' ? 'log-warn' : ''}`;
        el.innerText = l.text;
        screen.appendChild(el);
    }
}

// --- Chunked Log Writer + Auto-Log Scheduler ---
// State pointer for logs already written to remote chunks
state.logWriteIndex = state.logWriteIndex || 0;
let autoLogTimer = null;

const DEFAULT_LOG_FOLDER = getConfig('logFolder') || 'logs';

function getAutoLogIntervalMinutes() {
    const v = parseInt(getConfig('autoLogIntervalMinutes') || 0, 10);
    // default to 3 minutes if not configured or invalid
    return (isNaN(v) || v <= 0) ? 3 : v;
}

async function listLogChunks() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) return [];
    const url = `https://api.github.com/repos/${repo}/contents/${DEFAULT_LOG_FOLDER}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (!res.ok) return [];
        const items = await res.json();
        // items contain `name`, `size`, `sha` etc. Return sorted by name/time
        return (items || []).filter(it => it.type === 'file').sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        dbg(`listLogChunks error: ${e.message}`, 'error');
        return [];
    }
}

function chooseChunkFilename(existingItems, chunkSize) {
    // Use date-based prefix and incremental numeric suffix
    const datePrefix = new Date().toISOString().slice(0,10); // YYYY-MM-DD
    // Find existing items for today
    const todays = existingItems.filter(it => it.name.startsWith(datePrefix));
    if (todays.length === 0) {
        return `${datePrefix}-part-0.log`;
    }
    // Get last part index
    const last = todays[todays.length - 1].name;
    const m = last.match(/-part-(\d+)\.log$/);
    let idx = m ? parseInt(m[1], 10) : todays.length - 1;
    // If last file size + chunkSize > max, roll to next index
    const lastSize = todays[todays.length - 1].size || 0;
    const maxSize = parseInt(getConfig('maxLogFileSize') || 50000, 10) || 50000;
    if (lastSize + chunkSize > maxSize) idx = idx + 1;
    return `${datePrefix}-part-${idx}.log`;
}

// Shared builder used by tracker and history to produce identical entry boxes
function buildEntryCard(entry, globalIndex, opts = {}) {
    const mode = opts.mode || 'tracker'; // 'tracker' or 'history'
    const isRangeView = !!opts.isRangeView;

    const d = document.createElement('div');
    d.className = 'entry-card';
    d.id = `entry-${globalIndex}`;

    if (mode === 'history' && state.historySelectMode && state.historySelectedEntries.has(globalIndex)) {
        d.style.background = 'rgba(0, 122, 255, 0.1)';
        d.style.borderLeft = '4px solid var(--primary)';
    }

    // Left column: food, time, macros
    const left = document.createElement('div');
    left.style.flex = '1';
    left.style.minWidth = '0'; // allow content to truncate/wrap inside flex column

    const foodEl = document.createElement('div');
    foodEl.style.fontWeight = '700';
    foodEl.textContent = entry.food || '';

    const timeEl = document.createElement('div');
    timeEl.style.color = 'var(--text-secondary)';
    timeEl.style.fontSize = '13px';
    // Show time without seconds for cleaner display
    let displayTime = '';
    if (entry.timestamp) {
        try {
            displayTime = new Date(entry.timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        } catch (e) {
            displayTime = entry.time || '';
        }
    } else if (entry.time) {
        // Strip seconds if present (e.g. "12:34:56 AM" -> "12:34 AM")
        displayTime = String(entry.time).replace(/:(\d{2})(?=(?:\s?[APMapm]{2})?$)/, '');
    }
    timeEl.textContent = displayTime;

    left.appendChild(foodEl);
    left.appendChild(timeEl);

    if (entry.protein || entry.carbs || entry.fat) {
        const macros = [];
        if (entry.protein) macros.push(`P: ${entry.protein}g`);
        if (entry.carbs) macros.push(`C: ${entry.carbs}g`);
        if (entry.fat) macros.push(`F: ${entry.fat}g`);
        const m = document.createElement('div');
        m.style.fontSize = '11px';
        m.style.color = 'var(--text-secondary)';
        m.style.marginTop = '2px';
        m.innerText = macros.join(' | ');
        left.appendChild(m);
    }

    // Checkbox (history select mode)
    const checkboxWrapper = document.createElement('div');
    if (mode === 'history' && state.historySelectMode) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = state.historySelectedEntries.has(globalIndex);
        cb.style.width = '20px';
        cb.style.height = '20px';
        cb.style.cursor = 'pointer';
        cb.onchange = () => toggleHistoryEntrySelection(globalIndex);
        checkboxWrapper.appendChild(cb);
    }

    // Top-right: calories
    const topRight = document.createElement('div');
    topRight.style.display = 'flex';
    topRight.style.gap = '8px';
    topRight.style.alignItems = 'center';
    const kcal = document.createElement('div');
    kcal.style.fontWeight = '700';
    kcal.textContent = `${Math.round(entry.calories || 0)} kcal`;
    topRight.appendChild(kcal);

    // Top row (checkbox + content + calories)
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.alignItems = 'center';
    row.style.width = '100%';
    row.style.justifyContent = 'space-between'; // push calories to the far right
    if (mode === 'history' && state.historySelectMode) row.appendChild(checkboxWrapper);
    row.appendChild(left);
    row.appendChild(topRight);

    // Card container style
    d.style.cssText = 'padding:12px; margin-bottom:8px; background: var(--card-bg); border-radius:10px; box-shadow: var(--shadow); display:flex; flex-direction:column;';
    d.appendChild(row);

    // Action footer (history places buttons at end; tracker uses same footer for parity)
    const footer = document.createElement('div');
    footer.style.display = 'flex';
    footer.style.justifyContent = 'flex-end';
    footer.style.gap = '8px';
    footer.style.marginTop = '6px';
    footer.style.width = '100%';
    footer.style.alignItems = 'center';

    const showEdit = !isRangeView && !(mode === 'history' && state.historySelectMode);
    if (showEdit) {
        const edit = document.createElement('button');
        edit.style.cssText = 'background: #007aff; color: white; border: none; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; min-height:36px;';
        edit.textContent = 'Edit';
        edit.setAttribute('onclick', `editEntry(${globalIndex})`);
        footer.appendChild(edit);
    }

    if (!(mode === 'history' && state.historySelectMode)) {
        const del = document.createElement('button');
        del.style.cssText = 'background: #ff3b30; color: white; border: none; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; min-height:36px;';
        del.textContent = 'Delete';
        // history uses deleteEntryGlobal, tracker uses deleteEntry
        const delFn = (mode === 'history') ? `deleteEntryGlobal(${globalIndex})` : `deleteEntry(${globalIndex})`;
        del.setAttribute('onclick', delFn);
        footer.appendChild(del);
    }

    if (footer.children.length > 0) d.appendChild(footer);

    return d;
}

function updateRetention() {
    const sel = document.getElementById('log-retention');
    if (!sel) return;
    const v = parseInt(sel.value, 10);
    state.retentionMinutes = v;
    dbg(`Log retention set to ${v === 0 ? 'unlimited' : v + ' minutes'}`, 'debug');
    pruneLogs();
}

function updateLogLevel() {
    const sel = document.getElementById('log-level');
    state.logLevel = sel.value;
    dbg(`Log level changed to: ${sel.value.toUpperCase()}`, 'info');
}

async function copyLogs() {
    const txt = state.logs.map(l => l.text).join('\n\n');
    try {
        await navigator.clipboard.writeText(txt);
        dbg('Logs copied to clipboard.');
    } catch (e) {
        // fallback: create temporary textarea
        const ta = document.createElement('textarea');
        ta.value = txt;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        dbg('Logs copied (fallback).');
    }
}

async function saveLogs() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    
    if (!token || !repo) {
        dbg('Cannot save logs: Missing credentials', 'error');
        alert('Please configure GitHub credentials in Settings first.');
        return;
    }
    
    const logFile = getConfig('logFile');
    const maxSize = getConfig('maxLogFileSize');
    const url = `https://api.github.com/repos/${repo}/contents/${logFile}`;
    
    dbg('Saving logs to GitHub...', 'info');
    
    const saveBtn = event?.target;
    if (saveBtn) saveBtn.classList.add('loading');
    
    try {
        // Prepare new log content
        const timestamp = new Date().toISOString();
        const newLogContent = `\n\n=== Logs saved at ${timestamp} ===\n` + 
            state.logs.map(l => l.text).join('\n');
        
        // Try to fetch existing log file
        let existingContent = '';
        let fileSha = null;
        
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                fileSha = data.sha;
                existingContent = atob(data.content);
                dbg(`Existing log file size: ${existingContent.length} bytes`, 'debug');
            }
        } catch (err) {
            dbg('No existing log file found, will create new one', 'debug');
        }
        
        // Determine if we should append or overwrite
        let finalContent;
        let action;
        
        if (existingContent && (existingContent.length + newLogContent.length) < maxSize) {
            // Append to existing
            finalContent = existingContent + newLogContent;
            action = 'appended';
            dbg('Appending to existing log file', 'debug');
        } else if (existingContent && existingContent.length >= maxSize) {
            // Size limit reached, start fresh
            finalContent = `=== Log file reset due to size limit (${maxSize} bytes) ===\n` + newLogContent;
            action = 'reset and written';
            dbg('Log file size limit reached, resetting', 'warn');
        } else {
            // New file or small append that would exceed limit
            finalContent = newLogContent;
            action = 'created';
            dbg('Creating new log file', 'debug');
        }
        
        // Push to GitHub
        const body = {
            message: `Update logs: ${timestamp}`,
            content: btoa(finalContent)
        };
        
        if (fileSha) {
            body.sha = fileSha;
        }
        
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 
                'Authorization': `Bearer ${token}`, 
                'Content-Type': 'application/json' 
            },
            body: JSON.stringify(body)
        });
        
        if (res.ok) {
            dbg(`Logs successfully ${action} to ${logFile}`, 'info');
            dbg(`Final size: ${finalContent.length} bytes`, 'debug');
            alert(`Logs saved to ${logFile}!`);
        } else {
            const err = await res.json();
            dbg(`Failed to save logs: ${err.message}`, 'error', err);
            alert('Failed to save logs. Check the logs panel for details.');
        }
    } catch (err) {
        dbg(`Error saving logs: ${err.message}`, 'error');
        alert('Error saving logs. Check the logs panel for details.');
    } finally {
        if (saveBtn) saveBtn.classList.remove('loading');
    }
}

function showPage(p) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    
    // Auto-close logs panel when switching pages
    const logPanel = document.getElementById('log-panel');
    if (logPanel && logPanel.getAttribute('aria-hidden') === 'false') {
        logPanel.setAttribute('aria-hidden', 'true');
    }
    
    const page = document.getElementById(`page-${p}`);
    if (page) page.classList.add('active');
    
    const tab = document.getElementById(`tab-${p}`);
    if (tab) tab.classList.add('active');
    
    // Load page-specific content
    if (p === 'history') {
        // Default history view: show only today's entries to avoid an expensive
        // full-folder fetch on every navigation. If the user requests a range
        // or older data, a fetch will be triggered from the range handler.
        // Reset the prefetch attempts so returning to History can re-request
        // missing date files if the local `state.entries` has changed while
        // on other pages (e.g. tracker-only loads).
        state.historyPrefetchAttempts.clear();

        state.dateRangeStart = getTodayString();
        state.dateRangeEnd = getTodayString();
        try {
            fetchFromGit(true).then(() => {
                renderHistory();
            }).catch((err) => {
                dbg(`Fetch today's file for history failed: ${err?.message || err}`, 'warn');
                renderHistory();
            });
        } catch (e) {
            dbg(`Failed initiating today's fetch for history: ${e.message}`, 'error');
            renderHistory();
        }
    } else if (p === 'analytics') {
        // Set today's date by default
        const dateInput = document.getElementById('analytics-date');
        if (dateInput && !dateInput.value) {
            dateInput.value = new Date().toISOString().split('T')[0];
        }
        updateAnalytics();
    } else if (p === 'settings') {
        // Update settings display
        const dataFileEl = document.getElementById('settings-datafile');
        const schemaEl = document.getElementById('settings-schema');
        if (dataFileEl) dataFileEl.innerText = `${getConfig('dataFolder')}/<YYYY-MM-DD>.json`;
        if (schemaEl) schemaEl.innerText = state.schema ? state.schema.displayName : 'Loading...';
    }
}

function toggleLogs() {
    const panel = document.getElementById('log-panel');
    if (!panel) return;
    const hidden = panel.getAttribute('aria-hidden') === 'true';
    panel.setAttribute('aria-hidden', hidden ? 'false' : 'true');
    // When showing logs, also ensure it's scrolled to top for newest messages
    if (hidden) {
        const screen = document.getElementById('log-screen');
        if (screen) screen.scrollTop = 0;
    }
}

// --- SCHEMA MANAGEMENT ---
async function loadSchema() {
    try {
        dbg('Attempting to load schema.yaml', 'debug');
        const response = await fetch('schema.yaml');
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const yamlText = await response.text();
        dbg('Schema file fetched successfully', 'debug');
        
        const parsed = jsyaml.load(yamlText);
        if (!parsed || !parsed.schema) {
            throw new Error('Invalid schema format: missing "schema" key');
        }
        
        state.schema = parsed.schema;
        dbg(`Schema loaded: ${state.schema.displayName}`, 'info');
        dbg(`Schema has ${state.schema.fields.length} fields`, 'debug');
        
        renderFormFields();
        return true;
    } catch (err) {
        dbg(`Failed to load schema: ${err.message}`, 'error');
        dbg(`Make sure schema.yaml exists in the same directory`, 'error');
        
        // Show error in UI
        const errorHtml = `
            <div style="background: #fff3cd; color: #856404; padding: 20px; border-radius: 12px; margin: 20px 0;">
                <h3>⚠️ Schema Loading Error</h3>
                <p><strong>Error:</strong> ${err.message}</p>
                <p>The app cannot start without a valid schema.yaml file.</p>
                <hr style="border: none; border-top: 1px solid #d6c589; margin: 15px 0;">
                <p><strong>Common causes:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>Opening index.html directly (file:// protocol won't work)</li>
                    <li>schema.yaml file is missing</li>
                </ul>
                <p><strong>Solution:</strong> Run a local web server:</p>
                <pre style="background: #f8f4e6; padding: 10px; border-radius: 5px; overflow-x: auto;">python3 -m http.server 8000
open http://localhost:8000</pre>
            </div>
        `;
        
        const container = document.getElementById('list-container');
        if (container) container.innerHTML = errorHtml;
        
        const formContainer = document.getElementById('form-container');
        if (formContainer) formContainer.innerHTML = errorHtml;
        
        return false;
    }
}

function renderFormFields() {
    if (!state.schema) return;
    
    const container = document.getElementById('form-container');
    if (!container) return;
    
    // Clear all content
    container.innerHTML = '';
    
    const macroFields = ['protein', 'carbs', 'fat'];
    
    // Create input fields based on schema (skip hidden fields)
    state.schema.fields.forEach(field => {
        if (field.type === 'hidden') return; // Skip hidden fields
        
        // Handle macro fields separately
        if (macroFields.includes(field.name)) return;
        
        const wrapper = document.createElement('div');
        wrapper.className = 'form-field';
        wrapper.style.gridColumn = field.type === 'select' || field.type === 'date' ? '1' : 'auto';
        
        let input;
        
        if (field.type === 'select') {
            input = document.createElement('select');
            input.id = `field-${field.name}`;
            
            if (!field.required) {
                const emptyOption = document.createElement('option');
                emptyOption.value = '';
                emptyOption.textContent = `Select ${field.label}`;
                input.appendChild(emptyOption);
            }
            
            field.options.forEach(opt => {
                const option = document.createElement('option');
                option.value = opt;
                option.textContent = opt;
                if (field.default === opt) option.selected = true;
                input.appendChild(option);
            });
        } else {
            input = document.createElement('input');
            input.type = field.type;
            input.id = `field-${field.name}`;
            input.placeholder = field.placeholder || field.label;

            if (field.type === 'date' && field.default === 'today') {
                input.value = new Date().toISOString().split('T')[0];
            }
            if (field.min !== undefined) input.min = field.min;
            if (field.max !== undefined) input.max = field.max;
        }
        
        if (field.required) input.required = true;
        
        // If this is the time field, add a time-picker helper button
        if (field.name === 'time') {
            const timeWrap = document.createElement('div');
            timeWrap.style.display = 'flex';
            timeWrap.style.gap = '8px';
            timeWrap.appendChild(input);

            const pickerBtn = document.createElement('button');
            pickerBtn.type = 'button';
            pickerBtn.className = 'btn-secondary';
            pickerBtn.style.padding = '8px 10px';
            pickerBtn.textContent = '⏱️';
            pickerBtn.onclick = () => openTimePicker(input.id);
            timeWrap.appendChild(pickerBtn);

            wrapper.appendChild(timeWrap);
        } else {
            wrapper.appendChild(input);
        }
        container.appendChild(wrapper);
    });
    
    // Add macro toggle button
    const macroToggleWrapper = document.createElement('div');
    macroToggleWrapper.className = 'form-field';
    macroToggleWrapper.style.cssText = 'grid-column: span 2;';
    
    const macroToggleBtn = document.createElement('button');
    macroToggleBtn.type = 'button';
    macroToggleBtn.className = 'btn-secondary';
    macroToggleBtn.style.cssText = 'width: 100%; padding: 10px; font-size: 14px;';
    macroToggleBtn.textContent = '📊 Add Macros (Optional)';
    macroToggleBtn.onclick = () => {
        const macroSection = document.getElementById('macro-section');
        const isHidden = macroSection.style.display === 'none';
        macroSection.style.display = isHidden ? 'grid' : 'none';
        macroToggleBtn.textContent = isHidden ? '📊 Hide Macros' : '📊 Add Macros (Optional)';
    };
    
    macroToggleWrapper.appendChild(macroToggleBtn);
    container.appendChild(macroToggleWrapper);
    
    // Create collapsible macro section
    const macroSection = document.createElement('div');
    macroSection.id = 'macro-section';
    macroSection.style.display = 'none';
    macroSection.style.cssText = 'display: none; grid-column: span 2; grid-template-columns: 1fr 1fr; gap: 12px;';
    
    macroFields.forEach(macroName => {
        const field = state.schema.fields.find(f => f.name === macroName);
        if (!field) return;
        
        const wrapper = document.createElement('div');
        const input = document.createElement('input');
        input.type = 'number';
        input.id = `field-${field.name}`;
        input.placeholder = field.label;
        input.min = field.min || 0;
        
        // If this is the `time` field, add a small picker button next to the input
        if (field.name === 'time') {
            const timeWrap = document.createElement('div');
            timeWrap.style.cssText = 'display:flex; gap:8px; align-items:center;';
            timeWrap.appendChild(input);

            const tpBtn = document.createElement('button');
            tpBtn.type = 'button';
            tpBtn.className = 'btn-secondary';
            tpBtn.style.cssText = 'padding:8px 10px;';
            tpBtn.textContent = '⏰';
            tpBtn.onclick = () => openTimePicker(input.id);
            timeWrap.appendChild(tpBtn);

            wrapper.appendChild(timeWrap);
        } else {
            wrapper.appendChild(input);
        }
        macroSection.appendChild(wrapper);
    });
    
    container.appendChild(macroSection);
    
    // Add the submit button - use form-field wrapper for proper grid alignment
    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'form-field';
    buttonWrapper.style.cssText = 'grid-column: span 2; display: block;';
    
    const addButton = document.createElement('button');
    addButton.className = 'btn-primary';
    addButton.style.cssText = 'width: 100%; padding: 14px 20px; font-size: 15px;';
    addButton.type = 'button';
    addButton.onclick = addEntry;
    addButton.textContent = '➕ Add Entry';
    
    buttonWrapper.appendChild(addButton);
    container.appendChild(buttonWrapper);
    
    dbg('Form fields rendered successfully', 'debug');
}

function getFormData() {
    if (!state.schema) return null;
    
    const data = {};
    state.schema.fields.forEach(field => {
        // Auto-capture fields
        if (field.autoCapture) {
            if (field.name === 'timestamp') {
                data[field.name] = new Date().toISOString();
            }
            return;
        }
        
        const input = document.getElementById(`field-${field.name}`);
        if (input) {
            let value = input.value;
            if (field.type === 'number') {
                value = parseFloat(value);
                // Skip empty number fields (including macros)
                if (isNaN(value) || value === 0) {
                    return;
                }
            }
            // Handle "Current Time" option
            if (field.name === 'time' && value === 'Current Time') {
                const now = new Date();
                value = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            }
            // Skip empty text fields
            if (!value || value === '') {
                return;
            }
            data[field.name] = value;
        }
    });
    
    return data;
}

function clearFormFields() {
    if (!state.schema) return;
    
    state.schema.fields.forEach(field => {
        const input = document.getElementById(`field-${field.name}`);
        if (input) {
            if (field.type === 'date' && field.default === 'today') {
                input.value = new Date().toISOString().split('T')[0];
            } else if (field.type === 'select' && field.default) {
                input.value = field.default;
            } else {
                input.value = '';
            }
        }
    });
}

// --- CORE LOGIC ---
function saveSettings() {
    const t = document.getElementById('cfg-token').value.trim();
    const r = document.getElementById('cfg-repo').value.trim();
    const dailyBudgetInput = document.getElementById('cfg-daily-budget');
    const dailyBudget = dailyBudgetInput ? parseInt(dailyBudgetInput.value, 10) : null;
    
    localStorage.setItem('gt_token', t);
    localStorage.setItem('gt_repo', r);
    if (!isNaN(dailyBudget) && dailyBudget > 0) setConfig('dailyBudget', dailyBudget);
    
    dbg("Settings saved");
    toggleSettings();
    fetchFromGit();
}

function updateAutoSaveUI() {
    // Auto-save is now always enabled and publish buttons have been removed.
    // Remove any remaining legacy publish buttons from DOM to avoid accidental single-file pushes.
    const pushBtns = document.querySelectorAll('[onclick="pushToGit()"]');
    pushBtns.forEach(btn => btn.remove());
}

let autoSaveTimeout = null;
function autoSave() {
    clearTimeout(autoSaveTimeout);
    // Schedule the actual save work after a short debounce window.
    autoSaveTimeout = setTimeout(() => {
        try {
            performAutoSave();
        } catch (e) {
            dbg(`Auto-save failed: ${e && e.message ? e.message : String(e)}`, 'error');
        }
    }, 3000);
}

// Separated the actual auto-save work so the wrapper remains small.
function performAutoSave() {
    if (state.autoSyncing) return;
    // Always use per-date replace sync so edits/deletes persist.
    try {
        // Avoid replacing remote per-date files with an empty array if we have no local entries.
        if (!Array.isArray(state.entries) || state.entries.length === 0) {
            dbg('Auto-save skipped: no entries to persist', 'warn');
            return;
        }
        pushEntriesByDate(state.entries, { mode: 'replace' });
    } catch (e) {
        dbg(`performAutoSave error: ${e && e.message ? e.message : String(e)}`, 'error');
    }
}

async function fetchFromGit(onlyToday = false) {
    dbg(`fetchFromGit start (onlyToday=${onlyToday})`, 'debug');
    // Helper: fetch with timeout using AbortController to avoid hanging requests
    async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const res = await fetch(url, { ...options, signal: controller.signal });
            return res;
        } catch (err) {
            if (err.name === 'AbortError') {
                dbg(`Fetch aborted (timeout): ${url}`, 'warn');
            } else {
                dbg(`Fetch error for ${url}: ${err.message}`, 'error');
            }
            throw err;
        } finally {
            clearTimeout(id);
        }
    }
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');

    dbg(`fetchFromGit: token present=${!!token} repo present=${!!repo}`, 'debug');

    if (!token || !repo) {
        dbg("Missing credentials - skipping GitHub fetch (no cache)", "warn");
        alert('Missing GitHub credentials. Open Settings and configure your token and repo first.');
        try { showPage('settings'); } catch (e) { /* ignore */ }
        return;
    }

    let activeBtn = null;
    try {
        const dataFolder = getConfig('dataFolder');
        dbg(`Fetching data from GitHub`, 'info');
        dbg(`Repository: ${repo}`, 'debug');
        dbg(`Configured data folder: ${dataFolder}`, 'debug');
        dbg(`Data folder: ${dataFolder}`, 'debug');

        activeBtn = document.querySelector('[onclick^="fetchFromGit"]');
        dbg(`Active fetch button found: ${!!activeBtn}`, 'debug');
        if (activeBtn) activeBtn.classList.add('loading');

    // If a data folder is configured, prefer listing and fetching per-date files.
    if (dataFolder) {
        // If onlyToday is requested, fetch only today's file to speed up tracker view.
        if (onlyToday) {
            const today = getTodayString();
            const filePath = `${dataFolder}/${today}.json`;
            const fileUrl = `https://api.github.com/repos/${repo}/contents/${filePath}`;
            dbg(`Fetching only today's file: ${fileUrl}`, 'debug');
            try {
                const r = await fetchWithTimeout(fileUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }, 15000);
                dbg(`Today's file fetch status: ${r.status}`, 'debug');
                dbg(`Today's file fetch response ok=${r.ok} status=${r.status}`, 'debug');
                if (r.ok) {
                    const j = await r.json();
                    dbg(`Today's file response keys: ${Object.keys(j).join(', ')}`, 'debug');
                    const b64 = j.content || '';
                    dbg(`Today's file base64 length: ${b64.length}`, 'debug');
                    let decoded = '';
                    try { decoded = atob(b64); dbg(`Today's file decoded preview: ${decoded.slice(0,200)}`, 'debug'); } catch (e) { dbg(`Failed to base64-decode today's file content: ${e.message}`, 'warn'); }
                    let arr = [];
                    try { arr = JSON.parse(decoded || ''); if (!Array.isArray(arr)) arr = []; } catch (e) { dbg(`Invalid JSON in ${filePath}: ${e.message}`, 'warn', decoded ? decoded.slice(0,200) : null); arr = []; }
                    state.fileIndex[today] = j.sha;
                    state.entries = arr;
                    render();
                    renderHistory();
                    dbg(`Loaded ${arr.length} entries from ${filePath}`, 'info');
                    if (activeBtn) activeBtn.classList.remove('loading');
                    return;
                } else if (r.status === 404) {
                    dbg(`Today's data file not found: ${filePath}`, 'info');
                    state.entries = [];
                    render();
                    renderHistory();
                    if (activeBtn) activeBtn.classList.remove('loading');
                    return;
                } else {
                    const err = await r.json().catch(() => ({}));
                    dbg(`Error fetching today's file: ${err.message || r.statusText}`, 'error', err);
                    state.entries = [];
                    render();
                    renderHistory();
                    if (activeBtn) activeBtn.classList.remove('loading');
                    return;
                }
            } catch (e) {
                dbg(`Error fetching today's file: ${e.message}`, 'error');
                state.entries = [];
                render();
                renderHistory();
                if (activeBtn) activeBtn.classList.remove('loading');
                return;
            }
        }
        // Full listing: list folder and fetch recent per-date files
        const listUrl = `https://api.github.com/repos/${repo}/contents/${dataFolder}`;
        dbg(`Listing folder: ${listUrl}`, 'debug');
        try {
            const listRes = await fetchWithTimeout(listUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }, 15000);
            dbg(`Folder list status: ${listRes.status}`, 'debug');
                if (listRes.ok) {
                    const items = await listRes.json();
                    dbg(`Folder listing returned ${items.length} items`, 'debug');
                    dbg(`Folder items preview: ${items.slice(0,20).map(it=>it.name).join(', ')}`, 'debug');
                // Filter for YYYY-MM-DD.json files
                const dateItems = (items || []).filter(it => it.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(it.name));
                dateItems.sort((a, b) => b.name.localeCompare(a.name)); // newest first by name

                const limit = parseInt(getConfig('fetchDays') || 90, 10) || 90;
                const toFetch = dateItems.slice(0, limit);

                dbg(`Found ${dateItems.length} date files, fetching up to ${toFetch.length}`, 'info');

                const CHUNK = 5;
                const merged = [];
                for (let i = 0; i < toFetch.length; i += CHUNK) {
                    const chunk = toFetch.slice(i, i + CHUNK);
                    dbg(`Fetching chunk ${i / CHUNK + 1}: ${chunk.map(it => it.name).join(', ')}`, 'debug');
                    const promises = chunk.map(async (it) => {
                        try {
                            const r = await fetchWithTimeout(it.url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } }, 15000);
                            dbg(`Fetching file ${it.name} status: ${r.status}`, 'debug');
                            if (!r.ok) {
                                dbg(`Failed to fetch ${it.name}: ${r.status}`, 'warn');
                                return [];
                            }
                            const j = await r.json();
                            const b64 = j.content || '';
                            dbg(`File ${it.name} base64 length: ${b64.length}`, 'debug');
                            let decoded = '';
                            try { decoded = atob(b64); dbg(`Decoded preview ${it.name}: ${decoded.slice(0,200)}`, 'debug'); } catch (e) { dbg(`Failed to decode ${it.name}: ${e.message}`, 'warn'); }
                            let arr = [];
                            try { arr = JSON.parse(decoded || ''); if (!Array.isArray(arr)) arr = []; } catch (e) { dbg(`Invalid JSON in ${it.name}: ${e.message}`, 'warn', decoded ? decoded.slice(0,200) : null); arr = []; }
                            const dateStr = it.name.replace('.json', '');
                            state.fileIndex[dateStr] = j.sha;
                            return arr;
                        } catch (e) {
                            dbg(`Error fetching ${it.name}: ${e.message}`, 'error');
                            return [];
                        }
                    });
                    const results = await Promise.all(promises);
                    results.forEach(r => merged.push(...r));
                }

                state.entries = merged;
                render();
                renderHistory();
                dbg(`Successfully loaded ${state.entries.length} entries from ${toFetch.length} files`, 'info');
                if (activeBtn) activeBtn.classList.remove('loading');
                return;
            } else if (listRes.status === 404) {
                dbg('Data folder not found - no data loaded', 'warn');
                state.entries = [];
                render();
                renderHistory();
                if (activeBtn) activeBtn.classList.remove('loading');
                return;
            } else {
                const errBody = await listRes.json().catch(() => ({}));
                dbg(`Folder list error: ${errBody.message || listRes.statusText}`, 'error', errBody);
                state.entries = [];
                render();
                renderHistory();
                if (activeBtn) activeBtn.classList.remove('loading');
                return;
            }
        } catch (e) {
            dbg(`Folder list fetch error: ${e.message}`, 'error');
            state.entries = [];
            render();
            renderHistory();
            if (activeBtn) activeBtn.classList.remove('loading');
            return;
        }
    }
    } catch (err) {
        dbg(`fetchFromGit top-level error: ${err && err.message ? err.message : String(err)}`, 'error', err);
        try { if (activeBtn) activeBtn.classList.remove('loading'); } catch (e) { /* ignore */ }
        // Ensure caller doesn't hang; return after logging
        return;
    }
    // No legacy single-file behavior. If dataFolder is not configured we don't load or create data.json.
    dbg('No data folder configured; no data loaded', 'warn');
    state.entries = [];
    render();
    renderHistory();
    if (activeBtn) activeBtn.classList.remove('loading');
}

// Load a local copy of the data file (useful when not using GitHub)

async function pushToGit() {
    // Deprecated: single-file publishing removed in favor of per-day `data/` files.
    alert('Single-file publish (data.json) has been removed. The app now uses per-day files under the data/ folder and auto-syncs changes automatically.');
    dbg('pushToGit() called but single-file publishing is deprecated', 'warn');
}

// --- Phase 2 helpers: per-date pushes ---
async function pushEntryForDate(dateStr, entry) {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) {
        dbg('Cannot push entry: Missing credentials', 'error');
        return false;
    }

    const dataFolder = getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/${dateStr}.json`;
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    dbg(`Pushing 1 entry to ${filePath}`, 'info');

    try {
        // Try fetch existing file to get sha and existing content
        let existing = [];
        let fileSha = null;
        try {
            const getRes = await fetch(url, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (getRes.ok) {
                const j = await getRes.json();
                fileSha = j.sha;
                try { existing = JSON.parse(atob(j.content || '')); } catch (e) { existing = []; }
                if (!Array.isArray(existing)) existing = [];
            }
        } catch (e) {
            dbg(`No existing ${filePath} found, creating new file`, 'debug');
        }

        existing.push(entry);
        const jsonContent = JSON.stringify(existing, null, 2);
        dbg(`pushEntryForDate: prepared JSON content length=${jsonContent.length}`, 'debug');
        dbg(`pushEntryForDate: preview => ${jsonContent.slice(0,200)}`, 'debug');
        const body = {
            message: `Add entry ${dateStr}: ${new Date().toISOString()}`,
            content: btoa(unescape(encodeURIComponent(jsonContent)))
        };
        if (fileSha) body.sha = fileSha;

        const putRes = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        dbg(`pushEntryForDate PUT status: ${putRes.status}`, 'debug');
        const putBody = await putRes.text().catch(() => '');
        dbg(`pushEntryForDate PUT response preview: ${putBody.slice(0,200)}`, 'debug');
        if (putRes.ok) {
            const resj = JSON.parse(putBody || '{}');
            state.fileIndex[dateStr] = resj.content?.sha;
            dbg(`Pushed entry to ${filePath} (SHA: ${resj.content?.sha?.substring?.(0,8) || 'unknown'})`, 'info');
            return true;
        } else {
            let err = {};
            try { err = JSON.parse(putBody); } catch (e) { err = { message: putBody }; }
            dbg(`Failed to push entry to ${filePath}: ${err.message || putRes.statusText}`, 'error', err);
            return false;
        }
    } catch (err) {
        dbg(`pushEntryForDate error: ${err.message}`, 'error');
        return false;
    }
}

async function pushEntriesByDate(entries, options = { mode: 'append' }) {
    if (!Array.isArray(entries) || entries.length === 0) return;
    // Group entries by canonical date. Preserve undated entries by inferring from timestamp
    // or defaulting to today's date to avoid data loss for tracker view.
    const groups = {};
    entries.forEach(e => {
        let d = getEntryDate(e);
        if (!d) {
            if (e && e.timestamp) {
                try {
                    d = formatDateLocal(new Date(e.timestamp));
                    dbg(`pushEntriesByDate: inferred date from timestamp => ${d}`, 'debug', e);
                } catch (err) { /* ignore */ }
            }
        }
        if (!d) {
            d = getTodayString();
            dbg('pushEntriesByDate: defaulting undated entry to today to preserve tracker entries', 'warn', e);
        }
        if (!groups[d]) groups[d] = [];
        groups[d].push(e);
    });

    for (const dateStr of Object.keys(groups)) {
        const token = localStorage.getItem('gt_token');
        const repo = localStorage.getItem('gt_repo');
        if (!token || !repo) {
            dbg('Cannot push entries: Missing credentials', 'error');
            return;
        }

        const dataFolder = getConfig('dataFolder') || 'data';
        const filePath = `${dataFolder}/${dateStr}.json`;
        const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

        dbg(`Pushing ${groups[dateStr].length} entries to ${filePath}`, 'info');

        try {
            let existing = [];
            let fileSha = null;
            try {
                const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
                if (getRes.ok) {
                    const j = await getRes.json();
                    fileSha = j.sha;
                    try { existing = JSON.parse(atob(j.content || '')); } catch (e) { existing = []; }
                    if (!Array.isArray(existing)) existing = [];
                }
            } catch (e) { dbg(`No existing ${filePath} found, creating new file`, 'debug'); }

            // Determine write mode: 'append' merges new entries into existing content; 'replace' writes only the provided group
            let finalArray;
            if (options.mode === 'replace') {
                finalArray = groups[dateStr];
            } else {
                // append mode (default) — avoid duplicates by simple stringify check
                const existingKeys = new Set(existing.map(x => JSON.stringify(x)));
                finalArray = existing.slice();
                groups[dateStr].forEach(item => {
                    const key = JSON.stringify(item);
                    if (!existingKeys.has(key)) {
                        finalArray.push(item);
                        existingKeys.add(key);
                    }
                });
            }

            const jsonContent = JSON.stringify(finalArray, null, 2);
            const body = { message: `Import: ${dateStr} (${groups[dateStr].length} entries)`, content: btoa(unescape(encodeURIComponent(jsonContent))) };
            if (fileSha) body.sha = fileSha;

            const putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            dbg(`pushEntriesByDate PUT status for ${filePath}: ${putRes.status}`, 'debug');
            const putText = await putRes.text().catch(() => '');
            dbg(`pushEntriesByDate PUT response preview: ${putText.slice(0,200)}`, 'debug');
            if (putRes.ok) {
                const resj = JSON.parse(putText || '{}');
                state.fileIndex[dateStr] = resj.content?.sha;
                dbg(`Imported ${groups[dateStr].length} into ${filePath} (SHA: ${resj.content?.sha?.substring?.(0,8) || 'unknown'})`, 'info');
            } else {
                let err = {};
                try { err = JSON.parse(putText); } catch (e) { err = { message: putText }; }
                dbg(`Failed to import to ${filePath}: ${err.message || putRes.statusText}`, 'error', err);
            }
        } catch (err) {
            dbg(`pushEntriesByDate error (${dateStr}): ${err.message}`, 'error');
        }
    }
}

// Write a single date file (allows writing empty arrays to clear a date)
async function pushDateFile(dateStr, finalArray) {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) {
        dbg('Cannot push date file: Missing credentials', 'error');
        return false;
    }

    const dataFolder = getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/${dateStr}.json`;
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    // If caller is trying to write an empty array, prefer deleting the file instead
    // to avoid accidental clearing of user data. Use explicit delete if required.
    if (!Array.isArray(finalArray) || finalArray.length === 0) {
        dbg(`pushDateFile: finalArray empty for ${filePath}; deleting file instead of writing empty array`, 'warn');
        return await deleteDateFile(dateStr);
    }

    dbg(`Replacing ${filePath} with ${finalArray.length} entries`, 'info');

    try {
        // Try to fetch existing file to get SHA
        let fileSha = null;
        try {
            const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
            if (getRes.ok) {
                const j = await getRes.json();
                fileSha = j.sha;
            }
        } catch (e) { /* ignore */ }

        const jsonContent = JSON.stringify(finalArray || [], null, 2);
        const body = { message: `Sync date ${dateStr}: ${new Date().toISOString()}`, content: btoa(unescape(encodeURIComponent(jsonContent))) };
        if (fileSha) body.sha = fileSha;

        const putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        dbg(`pushDateFile PUT status for ${filePath}: ${putRes.status}`, 'debug');
        const putText = await putRes.text().catch(() => '');
        dbg(`pushDateFile PUT response preview: ${putText.slice(0,200)}`, 'debug');
        if (putRes.ok) {
            const resj = JSON.parse(putText || '{}');
            state.fileIndex[dateStr] = resj.content?.sha;
            dbg(`Wrote ${filePath} (SHA: ${resj.content?.sha?.substring?.(0,8) || 'unknown'})`, 'info');
            return true;
        } else {
            let err = {};
            try { err = JSON.parse(putText); } catch (e) { err = { message: putText }; }
            dbg(`Failed to write ${filePath}: ${err.message || putRes.statusText}`, 'error', err);
            return false;
        }
    } catch (err) {
        dbg(`pushDateFile error (${dateStr}): ${err.message}`, 'error');
        return false;
    }
}

// Delete a per-date file from the repo (used when a date becomes empty)
async function deleteDateFile(dateStr) {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) {
        dbg('Cannot delete date file: Missing credentials', 'error');
        return false;
    }

    const dataFolder = getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/${dateStr}.json`;
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    dbg(`Deleting ${filePath} from repo`, 'info');

    try {
        // Fetch existing to get sha
        let fileSha = null;
        try {
            const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
            if (getRes.ok) {
                const j = await getRes.json();
                fileSha = j.sha;
            } else if (getRes.status === 404) {
                dbg(`${filePath} not found when attempting delete`, 'debug');
                // Nothing to delete
                delete state.fileIndex[dateStr];
                return true;
            }
        } catch (e) { dbg(`Could not fetch ${filePath} before delete: ${e.message}`, 'warn'); }

        if (!fileSha) {
            dbg(`No SHA found for ${filePath}; aborting delete`, 'warn');
            return false;
        }

        const body = { message: `Delete date ${dateStr}: ${new Date().toISOString()}`, sha: fileSha };
        const delRes = await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const txt = await delRes.text().catch(() => '');
        if (delRes.ok) {
            delete state.fileIndex[dateStr];
            dbg(`Deleted ${filePath}`, 'info');
            return true;
        } else {
            let err = {};
            try { err = JSON.parse(txt); } catch (e) { err = { message: txt }; }
            dbg(`Failed to delete ${filePath}: ${err.message || delRes.statusText}`, 'error', err);
            return false;
        }
    } catch (err) {
        dbg(`deleteDateFile error (${dateStr}): ${err.message}`, 'error');
        return false;
    }
}

// NOTE: The original all-entries render implementation was removed.
// The app now uses the single, earlier `render()` function which
// filters entries to show only today's entries on the tracker page.

async function deleteEntry(index) {
    if (!confirm('Delete this entry?')) return;

    // Compute the removed entry and remaining entries for its date WITHOUT mutating state yet.
    const removed = state.entries[index];
    if (!removed) return;
    let dateStr = getEntryDate(removed) || null;
    if (!dateStr && removed && removed.timestamp) {
        try { dateStr = formatDateLocal(new Date(removed.timestamp)); dbg(`Inferred date from timestamp for removed entry: ${dateStr}`, 'debug'); } catch (e) {}
    }

    state.hasUnsavedChanges = true;

    try {
        if (dateStr) {
            const remaining = state.entries.filter((e, i) => {
                if (i === index) return false;
                const d = getEntryDate(e);
                return d === dateStr;
            });
            dbg(`Delete (pre-write): remaining entries for ${dateStr} = ${remaining.length}`, 'debug');

            let ok = false;
            if (remaining.length === 0) {
                dbg(`No remaining entries for ${dateStr}; deleting file instead of writing empty array`, 'info');
                ok = await deleteDateFile(dateStr);
                dbg(`deleteDateFile result for ${dateStr}: ${ok}`, ok ? 'info' : 'error');
            } else {
                ok = await pushDateFile(dateStr, remaining);
                dbg(`pushDateFile result for ${dateStr}: ${ok} (remaining=${remaining.length})`, ok ? 'info' : 'error');
            }

            if (ok) {
                // Now apply removal locally and re-render
                state.entries.splice(index, 1);
                state.hasUnsavedChanges = false;
                render();
                renderHistory();
            } else {
                dbg('Delete aborted: remote write/delete failed; local state preserved', 'error');
                alert('Failed to persist delete to repo. Check logs.');
                state.hasUnsavedChanges = false;
            }
        } else {
            dbg('Removed entry had no determinable date; performing full per-date replace for remaining dated entries', 'warn', removed);
            const ok = await pushEntriesByDate(state.entries.filter((e, i) => i !== index), { mode: 'replace' });
            if (ok !== false) {
                state.entries.splice(index, 1);
                render();
                renderHistory();
            } else {
                dbg('Full replace failed; local state preserved', 'error');
                alert('Failed to persist delete to repo. Check logs.');
            }
            state.hasUnsavedChanges = false;
        }
    } catch (e) {
        dbg(`Auto-save delete failed: ${e.message}`, 'error');
        alert('Error during delete persistence. Check logs.');
        state.hasUnsavedChanges = false;
    }
}

function toggleMacros(index) {
    const macrosDiv = document.getElementById(`macros-${index}`);
    const btn = event.target;
    if (macrosDiv.style.display === 'none') {
        macrosDiv.style.display = 'block';
        btn.textContent = '▼';
    } else {
        macrosDiv.style.display = 'none';
        btn.textContent = '▶';
    }
}

function toggleSelectMode() {
    state.selectMode = !state.selectMode;
    state.selectedEntries.clear();
    
    const btn = document.getElementById('select-mode-btn');
    const bulkActions = document.getElementById('bulk-actions');
    
    if (state.selectMode) {
        btn.textContent = '❌ Cancel Select';
        btn.style.background = 'var(--danger)';
        btn.style.color = 'white';
        bulkActions.classList.add('active');
    } else {
        btn.textContent = '☑️ Select';
        btn.style.background = '';
        btn.style.color = '';
        bulkActions.classList.remove('active');
    }
    
    updateSelectedCount();
    render();
}

function toggleEntrySelection(index) {
    if (state.selectedEntries.has(index)) {
        state.selectedEntries.delete(index);
    } else {
        state.selectedEntries.add(index);
    }
    updateSelectedCount();
    render();
}

function selectAll() {
    if (state.selectedEntries.size === state.entries.length) {
        // All selected, deselect all
        state.selectedEntries.clear();
    } else {
        // Select all
        state.entries.forEach((entry, index) => {
            state.selectedEntries.add(index);
        });
    }
    updateSelectedCount();
    render();
}

function updateSelectedCount() {
    const countEl = document.getElementById('selected-count');
    if (countEl) countEl.textContent = state.selectedEntries.size;
}

async function bulkDelete() {
    if (state.selectedEntries.size === 0) {
        alert('No entries selected.');
        return;
    }
    
    if (!confirm(`Delete ${state.selectedEntries.size} selected entries?`)) {
        return;
    }
    
    // Convert to array and sort ascending to compute removals
    const indices = Array.from(state.selectedEntries).sort((a, b) => a - b);

    // Compute affected dates and remaining arrays WITHOUT mutating local state
    const toRemove = new Set(indices);
    const affectedDates = new Set();
    let undatedRemoved = 0;
    const remainingByDate = {};

    for (let i = 0; i < state.entries.length; i++) {
        const e = state.entries[i];
        const d = getEntryDate(e) || null;
        if (!d) {
            if (toRemove.has(i)) undatedRemoved++;
            continue;
        }
        if (!remainingByDate[d]) remainingByDate[d] = [];
        if (!toRemove.has(i)) remainingByDate[d].push(e);
        if (toRemove.has(i)) affectedDates.add(d);
    }

    state.hasUnsavedChanges = true;
    dbg(`Bulk delete (pre-write): will remove ${indices.length} entries across ${Object.keys(remainingByDate).length} dates`, 'info');

    try {
        // Persist each affected date first
        for (const dateStr of affectedDates) {
            const remaining = remainingByDate[dateStr] || [];
            dbg(`Bulk delete: remaining entries for ${dateStr} = ${remaining.length}`, 'debug');
            if (remaining.length === 0) {
                dbg(`No remaining entries for ${dateStr}; deleting file instead of writing empty array`, 'info');
                const ok = await deleteDateFile(dateStr);
                dbg(`deleteDateFile result for ${dateStr}: ${ok}`, ok ? 'info' : 'error');
                if (!ok) throw new Error(`Failed to delete ${dateStr}`);
            } else {
                const ok = await pushDateFile(dateStr, remaining);
                dbg(`pushDateFile result for ${dateStr}: ${ok} (remaining=${remaining.length})`, ok ? 'info' : 'error');
                if (!ok) throw new Error(`Failed to write ${dateStr}`);
            }
        }

        if (undatedRemoved > 0) {
            dbg(`Bulk delete removed ${undatedRemoved} undated entries; performing best-effort full per-date replace for remaining dated entries`, 'warn');
            const ok = await pushEntriesByDate(state.entries.filter((e, i) => !toRemove.has(i)), { mode: 'replace' });
            if (ok === false) throw new Error('Failed to replace undated entries');
        }

        // All remote writes succeeded — now remove locally and update UI
        const removeIdx = indices.slice().sort((a, b) => b - a);
        for (const idx of removeIdx) state.entries.splice(idx, 1);
        state.selectedEntries.clear();
        state.hasUnsavedChanges = false;
        updateSelectedCount();
        render();
        renderHistory();
        dbg(`Bulk deleted ${indices.length} entries`, 'info');
    } catch (e) {
        dbg(`Bulk delete auto-save failed: ${e.message}`, 'error');
        alert('Failed to persist bulk delete. Check logs.');
        state.hasUnsavedChanges = false;
    }

    // Exit select mode after action
    toggleSelectMode();
}

function exportSelectedToCsv() {
    if (state.selectedEntries.size === 0) {
        alert('No entries selected.');
        return;
    }
    
    const indices = Array.from(state.selectedEntries).sort((a, b) => a - b);
    const selectedData = indices.map(i => state.entries[i]);
    
    // Build CSV
    const headers = ['Date', 'Time', 'Food', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)'];
    let csv = headers.join(',') + '\n';
    
    selectedData.forEach(entry => {
        const row = [
            entry.date || '',
            entry.time || '',
            entry.food || '',
            entry.calories || '',
            entry.protein || '',
            entry.carbs || '',
            entry.fat || ''
        ];
        csv += row.join(',') + '\n';
    });
    
    // Show export modal
    showCsvExportModal(csv, selectedData.length, 'tracker');
}

async function addEntry() {
    const data = getFormData();
    if (!data) return;
    
    // Validate required fields
    let hasError = false;
    state.schema.fields.forEach(field => {
        if (field.required && !data[field.name]) {
            dbg(`${field.label} is required`, "error");
            hasError = true;
        }
    });
    
    if (hasError) return;
    
    // Add loading animation briefly
    const addBtn = event?.target;
    if (addBtn) addBtn.classList.add('loading');
    
    state.entries.push(data);
    state.hasUnsavedChanges = true;
    render();
    renderHistory(); // Update history view
    clearFormFields();
    // Auto-save: push this entry to the per-date file
    try {
        const dateStr = getEntryDate(data) || getTodayString();
        try {
            const ok = await pushEntryForDate(dateStr, data);
            if (ok) state.hasUnsavedChanges = false;
        } catch (err) {
            dbg(`Auto-save per-date push failed: ${err.message}`, 'error');
        }
    } catch (e) {
        dbg(`Auto-save error: ${e.message}`, 'error');
    }
    
    // Remove loading after a short delay
    setTimeout(() => {
        if (addBtn) addBtn.classList.remove('loading');
    }, 500);
}

// --- HISTORY PAGE (refactored into helpers) ---
function ensureHistoryPrefetchIfNeeded() {
    try {
        if ((state.dateRangeStart || state.dateRangeEnd) && !state.historyFetchInProgress) {
            const targets = [];
            if (state.dateRangeStart && state.dateRangeEnd) {
                let cur = new Date(state.dateRangeStart);
                const end = new Date(state.dateRangeEnd);
                while (cur <= end) {
                    targets.push(formatDateLocal(cur));
                    cur.setDate(cur.getDate() + 1);
                }
            } else if (state.dateRangeStart) {
                targets.push(state.dateRangeStart);
            } else if (state.dateRangeEnd) {
                targets.push(state.dateRangeEnd);
            }

            const hasAll = targets.every(td => state.entries.some(e => getEntryDate(e) === td));
            if (!hasAll) {
                const key = targets.join(',');
                if (!state.historyPrefetchAttempts.has(key)) {
                    state.historyPrefetchAttempts.add(key);
                    state.historyFetchInProgress = true;
                    dbg(`History requested dates [${targets.join(',')}] not loaded; fetching full data folder`, 'info');
                    fetchFromGit(false).then(() => {
                        state.historyFetchInProgress = false;
                        renderHistory();
                    }).catch(err => {
                        state.historyFetchInProgress = false;
                        dbg(`Failed to fetch full data folder for history: ${err && err.message ? err.message : String(err)}`, 'error');
                    });
                    return true; // fetch kicked off
                } else {
                    dbg(`Already attempted prefetch for [${key}] — skipping additional fetch to avoid loop`, 'warn');
                }
            }
        }
    } catch (e) { dbg(`ensureHistoryPrefetchIfNeeded error: ${e && e.message ? e.message : String(e)}`, 'error'); }
    return false;
}

function computeFilteredEntries() {
    const foodFilter = document.getElementById('filter-food')?.value.toLowerCase();
    dbg(`computeFilteredEntries: totalEntries=${state.entries.length} dateRangeStart=${state.dateRangeStart} dateRangeEnd=${state.dateRangeEnd} foodFilter=${foodFilter || 'none'}`, 'debug');

    let filtered = state.entries.slice();

    if (state.dateRangeStart && state.dateRangeEnd) {
        if (state.dateRangeStart === state.dateRangeEnd) {
            filtered = filtered.filter(e => getEntryDate(e) === state.dateRangeStart);
        } else {
            filtered = filtered.filter(e => {
                const ed = getEntryDate(e);
                return ed && ed >= state.dateRangeStart && ed <= state.dateRangeEnd;
            });
        }
    }

    if (foodFilter) filtered = filtered.filter(e => e.food?.toLowerCase().includes(foodFilter));

    // newest-first
    filtered.sort((a, b) => {
        const timeA = new Date(a.timestamp || a.date).getTime();
        const timeB = new Date(b.timestamp || b.date).getTime();
        return timeB - timeA;
    });

    return filtered;
}

function buildHistoryStats(filtered) {
    try {
        document.getElementById('history-total-entries').innerText = filtered.length;
        const totalCal = filtered.reduce((sum, e) => sum + (parseFloat(e.calories) || 0), 0);
        document.getElementById('history-total-calories').innerText = Math.round(totalCal);
        const uniqueDates = [...new Set(filtered.map(e => getEntryDate(e)).filter(Boolean))];
        const avgPerDay = uniqueDates.length > 0 ? Math.round(totalCal / uniqueDates.length) : 0;
        document.getElementById('history-avg-calories').innerText = avgPerDay;
    } catch (e) { dbg(`buildHistoryStats error: ${e && e.message ? e.message : String(e)}`, 'error'); }
}

function buildPageControls(container, sortedDates) {
    const perPage = 5;
    if (!state.historyPage) state.historyPage = 1;
    const totalPages = Math.max(1, Math.ceil(sortedDates.length / perPage));
    if (state.historyPage > totalPages) state.historyPage = totalPages;

    const pageControls = document.createElement('div');
    pageControls.style.cssText = 'display:flex; justify-content:center; gap:8px; margin-bottom:12px;';
    const prevBtn = document.createElement('button');
    prevBtn.textContent = '← Prev';
    prevBtn.className = 'btn-secondary';
    prevBtn.onclick = () => { state.historyPage = Math.max(1, state.historyPage - 1); renderHistory(); };
    if (state.historyPage === 1) prevBtn.disabled = true;
    const nextBtn = document.createElement('button');
    nextBtn.textContent = 'Next →';
    nextBtn.className = 'btn-secondary';
    nextBtn.onclick = () => { state.historyPage = Math.min(totalPages, state.historyPage + 1); renderHistory(); };
    if (state.historyPage === totalPages) nextBtn.disabled = true;
    const pageInfo = document.createElement('div');
    pageInfo.style.cssText = 'align-self:center; color:var(--text-secondary);';
    pageInfo.textContent = `Page ${state.historyPage} / ${totalPages}`;
    pageControls.appendChild(prevBtn);
    pageControls.appendChild(pageInfo);
    pageControls.appendChild(nextBtn);

    container.appendChild(pageControls);

    const startIdx = (state.historyPage - 1) * perPage;
    const pageDates = sortedDates.slice(startIdx, startIdx + perPage);
    return pageDates;
}

function createEntryCard(entry, globalIndex, isRangeView, dateStr) {
    return buildEntryCard(entry, globalIndex, { mode: 'history', isRangeView: !!isRangeView });
}

function renderHistory() {
    const container = document.getElementById('history-container');
    if (!container) return;

    // Sync date-range from UI controls so returning to the page reflects
    // the dropdown/input selection (prevents visual selection without state match).
    try {
        const rangeSel = document.getElementById('range-select');
        if (rangeSel) {
            const v = rangeSel.value;
            const today = getTodayString();
            let newStart = null;
            let newEnd = null;
            if (!v || v === 'all') {
                newStart = null; newEnd = null;
            } else if (v === 'today') {
                newStart = today; newEnd = today;
            } else if (v === 'yesterday') {
                newStart = addDaysToDateString(today, -1);
                newEnd = newStart;
            } else {
                const days = parseInt(v, 10);
                if (!isNaN(days)) {
                    newStart = addDaysToDateString(today, -(days - 1));
                    newEnd = today;
                }
            }
            if (newStart !== state.dateRangeStart || newEnd !== state.dateRangeEnd) {
                state.dateRangeStart = newStart;
                state.dateRangeEnd = newEnd;
                state.historyPage = 1;
            }
        }
    } catch (e) { dbg(`renderHistory sync error: ${e && e.message ? e.message : String(e)}`, 'error'); }

    // If a prefetch was initiated, the helper already kicked off a fetch and will recall renderHistory when done.
    if (ensureHistoryPrefetchIfNeeded()) return;

    const filtered = computeFilteredEntries();
    buildHistoryStats(filtered);

    container.innerHTML = '';
    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:var(--text-secondary);">No entries found for the selected filters.</div>';
        return;
    }

    dbg(`Grouping ${filtered.length} entries by date`, 'debug');
    const groups = groupByDate(filtered);
    const sortedDates = Object.keys(groups).sort((a, b) => (new Date(b).getTime() - new Date(a).getTime()));
    dbg(`Found ${sortedDates.length} date groups`, 'info');

    const pageDates = buildPageControls(container, sortedDates);
    dbg(`Rendering history page ${state.historyPage} (dates on page: ${pageDates.join(', ')})`, 'debug');

    const isRangeView = state.dateRangeStart && state.dateRangeEnd && state.dateRangeStart !== state.dateRangeEnd;

    // Render each date group on the page
    pageDates.forEach(dateStr => {
        const group = groups[dateStr] || [];
        const header = document.createElement('div');
        header.style.cssText = 'font-weight:700; margin: 12px 0 8px 0;';
        header.textContent = `${dateStr} (${group.length})`;
        container.appendChild(header);

        group.sort((a, b) => {
            const ta = new Date(a.timestamp || (a.date + ' ' + (a.time || '00:00'))).getTime();
            const tb = new Date(b.timestamp || (b.date + ' ' + (b.time || '00:00'))).getTime();
            return tb - ta;
        });

        group.forEach(entry => {
            const globalIndex = state.entries.indexOf(entry);
            if (globalIndex === -1) dbg(`Warning: entry for date ${dateStr} not found in state.entries via indexOf — possible identity mismatch`, 'warn');
            const card = createEntryCard(entry, globalIndex, isRangeView, dateStr);
            container.appendChild(card);
        });
    });
    dbg('renderHistory complete', 'debug');
}

// Helper: group entries by `date` (returns { dateStr: [entries] })
function groupByDate(entries) {
    const map = {};
    entries.forEach(e => {
        const d = getEntryDate(e) || 'Unknown';
        if (!getEntryDate(e)) {
            dbg('Entry missing date/timestamp while grouping; assigning Unknown', 'warn', e);
        }
        if (!map[d]) map[d] = [];
        map[d].push(e);
    });
    return map;
}

// Helper: return canonical YYYY-MM-DD date for an entry (prefer `timestamp`, fall back to `date`)
function getEntryDate(entry) {
    if (!entry) return null;
    // Prefer an explicit ISO `date` field when provided (user intent).
    if (entry.date && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)) return entry.date;
    // Try parsing loose date strings next.
    if (entry.date) {
        try {
            const d2 = new Date(entry.date);
            if (!isNaN(d2.getTime())) return formatDateLocal(d2);
        } catch (e) { /* ignore */ }
    }
    // Finally, fall back to timestamp-derived local date.
    if (entry.timestamp) {
        try {
            const d = new Date(entry.timestamp);
            if (!isNaN(d.getTime())) return formatDateLocal(d);
        } catch (e) { /* ignore */ }
    }
    return null;
}

// Helper: format a Date object as local YYYY-MM-DD string
function formatDateLocal(d) {
    try {
        if (!(d instanceof Date)) d = new Date(d);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    } catch (e) {
        return null;
    }
}

function addDaysToDateString(dateStr, days) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
    d.setDate(d.getDate() + days);
    return formatDateLocal(d);
}

function handleRangeSelect() {
    const sel = document.getElementById('range-select');
    if (!sel) return;
    const v = sel.value;
    const today = getTodayString();

    if (!v || v === 'all') {
        state.dateRangeStart = null;
        state.dateRangeEnd = null;
    } else if (v === 'today') {
        state.dateRangeStart = today;
        state.dateRangeEnd = today;
    } else if (v === 'yesterday') {
        state.dateRangeStart = addDaysToDateString(today, -1);
        state.dateRangeEnd = state.dateRangeStart;
    } else {
        // numeric days (last N days)
        const days = parseInt(v, 10);
        const start = addDaysToDateString(today, -(days - 1));
        state.dateRangeStart = start;
        state.dateRangeEnd = today;
    }

    state.historyPage = 1;
    renderHistory();
}

function handleDateSelection() {
    const dateInput = document.getElementById('filter-date');
    const selectedDate = dateInput.value;
    
    if (!selectedDate) {
        state.dateRangeStart = null;
        state.dateRangeEnd = null;
        dateInput.setAttribute('placeholder', 'dd/mm/yyyy');
        return;
    }
    
    // If no start date, set it and keep calendar open
    if (!state.dateRangeStart) {
        state.dateRangeStart = selectedDate;
        dateInput.value = '';
        dateInput.setAttribute('placeholder', `Start: ${selectedDate} — pick end or click again for single day`);
        dbg(`Date range start: ${selectedDate}`, 'debug');
        // Keep calendar open by preventing blur and refocusing
        setTimeout(() => {
            dateInput.showPicker();
        }, 0);
    }
    // If clicking same date, it's single day and close
    else if (state.dateRangeStart === selectedDate) {
        state.dateRangeEnd = selectedDate;
        dateInput.value = '';
        dateInput.setAttribute('placeholder', `Single day: ${selectedDate}`);
        dbg(`Single day selected: ${selectedDate}`, 'debug');
        renderHistory();
        // Calendar will close naturally
    }
    // Different date = range and close
    else {
        state.dateRangeEnd = selectedDate;
        // Ensure start is before end
        if (state.dateRangeStart > state.dateRangeEnd) {
            [state.dateRangeStart, state.dateRangeEnd] = [state.dateRangeEnd, state.dateRangeStart];
        }
        dateInput.value = '';
        dateInput.setAttribute('placeholder', `${state.dateRangeStart} → ${state.dateRangeEnd}`);
        dbg(`Date range: ${state.dateRangeStart} to ${state.dateRangeEnd}`, 'debug');
        renderHistory();
        // Calendar will close naturally
    }
}

function filterHistory() {
    state.historyPage = 1;
    renderHistory();
}

function clearFilters() {
    const dateInput = document.getElementById('filter-date');
    dateInput.value = '';
    dateInput.setAttribute('placeholder', 'Select date');
    document.getElementById('filter-food').value = '';
    state.dateRangeStart = null;
    state.dateRangeEnd = null;
    state.historyPage = 1;
    renderHistory();
}

function toggleHistorySelectMode() {
    state.historySelectMode = !state.historySelectMode;
    state.historySelectedEntries.clear();
    
    const btn = document.getElementById('history-select-mode-btn');
    const bulkActions = document.getElementById('history-bulk-actions');
    
    if (state.historySelectMode) {
        btn.textContent = '❌ Cancel Select';
        btn.style.background = 'var(--danger)';
        btn.style.color = 'white';
        bulkActions.classList.add('active');
    } else {
        btn.textContent = '☑️ Select';
        btn.style.background = '';
        btn.style.color = '';
        bulkActions.classList.remove('active');
    }
    
    updateHistorySelectedCount();
    renderHistory();
}

function toggleHistoryEntrySelection(index) {
    if (state.historySelectedEntries.has(index)) {
        state.historySelectedEntries.delete(index);
    } else {
        state.historySelectedEntries.add(index);
    }
    updateHistorySelectedCount();
    renderHistory();
}

function historySelectAll() {
    // Get filtered entries to determine which to select
    const foodFilter = document.getElementById('filter-food')?.value.toLowerCase();
    let filtered = state.entries;
    
    if (state.dateRangeStart && state.dateRangeEnd) {
        if (state.dateRangeStart === state.dateRangeEnd) {
            filtered = filtered.filter(e => e.date === state.dateRangeStart);
        } else {
            filtered = filtered.filter(e => e.date >= state.dateRangeStart && e.date <= state.dateRangeEnd);
        }
    } // else: no date filter -> include all entries
    
    if (foodFilter) {
        filtered = filtered.filter(e => e.food?.toLowerCase().includes(foodFilter));
    }
    
    // Check if all filtered entries are already selected
    const filteredIndices = filtered.map(e => state.entries.indexOf(e));
    const allSelected = filteredIndices.every(idx => state.historySelectedEntries.has(idx));
    
    if (allSelected) {
        // Deselect all
        filteredIndices.forEach(idx => state.historySelectedEntries.delete(idx));
    } else {
        // Select all filtered
        filteredIndices.forEach(idx => state.historySelectedEntries.add(idx));
    }
    
    updateHistorySelectedCount();
    renderHistory();
}

function updateHistorySelectedCount() {
    const countEl = document.getElementById('history-selected-count');
    if (countEl) countEl.textContent = state.historySelectedEntries.size;
}

function historyBulkDelete() {
    if (state.historySelectedEntries.size === 0) {
        alert('No entries selected.');
        return;
    }
    
    if (!confirm(`Delete ${state.historySelectedEntries.size} selected entries?`)) {
        return;
    }
    
    const indices = Array.from(state.historySelectedEntries).sort((a, b) => b - a);
    indices.forEach(index => {
        state.entries.splice(index, 1);
    });
    
    state.historySelectedEntries.clear();
    state.hasUnsavedChanges = true;
    updateHistorySelectedCount();
    render();
    renderHistory();
    
    dbg(`Bulk deleted ${indices.length} entries from history`, 'info');
    try { autoSave(); } catch (e) { dbg(`Auto-save error: ${e.message}`, 'error'); }
    toggleHistorySelectMode();
}

function historyExportSelectedToCsv() {
    if (state.historySelectedEntries.size === 0) {
        alert('No entries selected.');
        return;
    }
    
    const indices = Array.from(state.historySelectedEntries).sort((a, b) => a - b);
    const selectedData = indices.map(i => state.entries[i]);
    
    const headers = ['Date', 'Time', 'Food', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)'];
    let csv = headers.join(',') + '\n';
    
    selectedData.forEach(entry => {
        const row = [
            entry.date || '',
            entry.time || '',
            entry.food || '',
            entry.calories || '',
            entry.protein || '',
            entry.carbs || '',
            entry.fat || ''
        ];
        csv += row.join(',') + '\n';
    });
    
    // Show export modal
    showCsvExportModal(csv, selectedData.length, 'history');
}

function editEntry(index) {
    const entry = state.entries[index];
    if (!entry) return;
    
    const card = document.getElementById(`entry-${index}`);
    if (!card) return;
    
    // Create edit form
    const editForm = document.createElement('div');
    editForm.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 12px; padding: 16px 0;';
    
    const fields = [
        { name: 'food', label: 'Food', type: 'text' },
        { name: 'calories', label: 'Calories', type: 'number' },
        { name: 'protein', label: 'Protein (g)', type: 'number' },
        { name: 'carbs', label: 'Carbs (g)', type: 'number' },
        { name: 'fat', label: 'Fat (g)', type: 'number' },
        { name: 'date', label: 'Date', type: 'date' }
    ];
    
    fields.forEach(field => {
        const input = document.createElement('input');
        input.type = field.type;
        input.id = `edit-${field.name}-${index}`;
        input.value = entry[field.name] || '';
        input.placeholder = field.label;
        input.style.cssText = 'padding: 10px; border: 1px solid var(--border); border-radius: 8px;';
        editForm.appendChild(input);
    });
    
    // Add time dropdown
    const timeSelect = document.createElement('select');
    timeSelect.id = `edit-time-${index}`;
    timeSelect.style.cssText = 'padding: 10px; border: 1px solid var(--border); border-radius: 8px;';
    ['Current Time', 'Breakfast (9:00 AM)', 'Lunch (1:00 PM)', 'Dinner (7:00 PM)', 'Snack (3:00 PM)'].forEach(opt => {
        const option = document.createElement('option');
        option.value = opt;
        option.textContent = opt;
        if (entry.time === opt) option.selected = true;
        timeSelect.appendChild(option);
    });
    editForm.appendChild(timeSelect);
    
    const buttonWrapper = document.createElement('div');
    buttonWrapper.style.cssText = 'grid-column: span 2; display: flex; gap: 8px;';
    
    const saveBtn = document.createElement('button');
    saveBtn.textContent = '💾 Save';
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'flex: 1; padding: 10px;';
    saveBtn.onclick = () => saveEdit(index);
    
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = '❌ Cancel';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.cssText = 'flex: 1; padding: 10px;';
    cancelBtn.onclick = () => renderHistory();
    
    buttonWrapper.appendChild(saveBtn);
    buttonWrapper.appendChild(cancelBtn);
    editForm.appendChild(buttonWrapper);
    
    card.innerHTML = '';
    card.appendChild(editForm);
}

function saveEdit(index) {
    const entry = state.entries[index];
    if (!entry) return;
    
    // Update entry with edited values
    entry.food = document.getElementById(`edit-food-${index}`).value;
    entry.calories = parseFloat(document.getElementById(`edit-calories-${index}`).value);
    entry.protein = parseFloat(document.getElementById(`edit-protein-${index}`).value) || undefined;
    entry.carbs = parseFloat(document.getElementById(`edit-carbs-${index}`).value) || undefined;
    entry.fat = parseFloat(document.getElementById(`edit-fat-${index}`).value) || undefined;
    entry.date = document.getElementById(`edit-date-${index}`).value;
    entry.time = document.getElementById(`edit-time-${index}`).value;
    
    // Handle Current Time conversion
    if (entry.time === 'Current Time') {
        const now = new Date();
        entry.time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
    }
    
    render();
    renderHistory();
    dbg(`Entry ${index} updated`, 'info');
    // Mark as changed and auto-save if configured
    state.hasUnsavedChanges = true;
    try { autoSave(); } catch (e) { dbg(`Auto-save error: ${e.message}`, 'error'); }
}

async function deleteEntryGlobal(index) {
    if (!confirm('Delete this entry?')) return;
    const removed = state.entries.splice(index, 1)[0];
    state.hasUnsavedChanges = true;
    render();
    renderHistory();
    try {
        const dateStr = getEntryDate(removed) || null;
        if (dateStr) {
            const remaining = state.entries.filter(e => {
                const d = getEntryDate(e) || getTodayString();
                return d === dateStr;
            });
            await pushDateFile(dateStr, remaining);
        } else {
            await pushEntriesByDate(state.entries, { mode: 'replace' });
        }
        state.hasUnsavedChanges = false;
    } catch (e) {
        dbg(`Auto-save delete failed: ${e.message}`, 'error');
    }
}

// --- ANALYTICS PAGE ---
let charts = {};

function updateAnalytics() {
    const dateInput = document.getElementById('analytics-date');
    const selectedDate = dateInput.value || new Date().toISOString().split('T')[0];
    
    showLoading(true);
    
    setTimeout(() => {
        renderAnalytics(selectedDate);
        showLoading(false);
    }, 500);
}

function showLoading(show) {
    const loading = document.getElementById('analytics-loading');
    const content = document.getElementById('analytics-content');
    if (show) {
        loading.style.display = 'block';
        content.style.display = 'none';
        animateProgress();
    } else {
        loading.style.display = 'none';
        content.style.display = 'block';
    }
}

function animateProgress() {
    const progress = document.getElementById('analytics-progress');
    let width = 0;
    const interval = setInterval(() => {
        width += 10;
        progress.style.width = width + '%';
        if (width >= 100) {
            clearInterval(interval);
        }
    }, 50);
}

function renderAnalytics(date) {
    if (!state.entries.length) {
        dbg('No data available for analytics', 'warn');
        return;
    }
    
    // Filter entries for selected date
    const filtered = state.entries.filter(e => e.date === date);
    
    if (filtered.length === 0) {
        dbg(`No entries found for ${date}`, 'warn');
        // Show empty state in charts
        Object.values(charts).forEach(chart => chart.destroy());
        charts = {};
        return;
    }
    
    // Destroy old charts
    Object.values(charts).forEach(chart => chart.destroy());
    charts = {};
    
    // Meal Distribution Chart (Calories by Time)
    const mealData = {};
    filtered.forEach(e => {
        const time = e.time || 'No Time';
        mealData[time] = (mealData[time] || 0) + (parseFloat(e.calories) || 0);
    });
    
    if (Object.keys(mealData).length > 0) {
        charts.meal = new Chart(document.getElementById('chart-meal-distribution'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(mealData),
                datasets: [{
                    data: Object.values(mealData),
                    backgroundColor: ['#007aff', '#5856d6', '#34c759', '#ff9500', '#ff3b30', '#af52de']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                return context.label + ': ' + Math.round(context.parsed) + ' kcal';
                            }
                        }
                    }
                }
            }
        });
    }
    
    // Macro Distribution Chart (Protein, Carbs, Fat in grams)
    let totalProtein = 0;
    let totalCarbs = 0;
    let totalFat = 0;
    
    filtered.forEach(e => {
        if (e.protein) totalProtein += parseFloat(e.protein);
        if (e.carbs) totalCarbs += parseFloat(e.carbs);
        if (e.fat) totalFat += parseFloat(e.fat);
    });
    
    // Only show macro chart if we have macro data
    if (totalProtein > 0 || totalCarbs > 0 || totalFat > 0) {
        charts.macro = new Chart(document.getElementById('chart-macro-distribution'), {
            type: 'doughnut',
            data: {
                labels: ['Protein', 'Carbs', 'Fat'],
                datasets: [{
                    data: [totalProtein, totalCarbs, totalFat],
                    backgroundColor: ['#007aff', '#5856d6', '#34c759']
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                plugins: {
                    legend: {
                        position: 'bottom'
                    },
                    tooltip: {
                        callbacks: {
                            label: function(context) {
                                const value = context.parsed || 0;
                                const dataArr = context.dataset.data || [];
                                const total = dataArr.reduce((s, v) => s + (parseFloat(v) || 0), 0);
                                const pct = total > 0 ? Math.round((value / total) * 100) : 0;
                                return `${context.label}: ${Math.round(value)}g (${pct}%)`;
                            }
                        }
                    },
                    // Optional: draw total in center for quick glance
                    beforeDraw: function(chart) {
                        // noop placeholder for Chart.js v4 plugin hook if needed later
                    }
                }
            }
        });
    } else {
        // Show message if no macro data
        const macroCanvas = document.getElementById('chart-macro-distribution');
        const ctx = macroCanvas.getContext('2d');
        ctx.clearRect(0, 0, macroCanvas.width, macroCanvas.height);
        ctx.font = '14px -apple-system, sans-serif';
        ctx.fillStyle = '#8e8e93';
        ctx.textAlign = 'center';
        ctx.fillText('No macro data available for this day', macroCanvas.width / 2, macroCanvas.height / 2);
    }
}

// --- CLEAR DATA ---
function clearAllData() {
    if (confirm('This will delete all local data. Data on GitHub will not be affected. Continue?')) {
        state.entries = [];
        state.sha = "";
        render();
        renderHistory();
        dbg('Local data cleared', 'info');
    }
}

// --- RELOAD APP ---
function reloadApp() {
    dbg('Reloading app...', 'info');
    location.reload();
}

function toggleSettings() {
    // Remove old modal code
}

function showCsvExportModal(csvData, entryCount, source) {
    state.tempCsvData = csvData;
    state.csvSource = source;
    
    document.getElementById('csv-export-count').textContent = entryCount;
    document.getElementById('csv-export-modal').style.display = 'flex';
}

function closeCsvExportModal() {
    document.getElementById('csv-export-modal').style.display = 'none';
    state.tempCsvData = null;
}

async function downloadCsv() {
    if (!state.tempCsvData) return;
    
    const blob = new Blob([state.tempCsvData], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `exported_entries_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
    
    dbg(`Downloaded CSV file`, 'info');
    
    closeCsvExportModal();
    
    // Exit select mode
    if (state.csvSource === 'tracker') {
        toggleSelectMode();
    } else if (state.csvSource === 'history') {
        toggleHistorySelectMode();
    }
}

async function copyCsvToClipboard() {
    if (!state.tempCsvData) return;
    
    try {
        await navigator.clipboard.writeText(state.tempCsvData);
        dbg('CSV copied to clipboard', 'info');
        
        // Show success feedback
        const btn = event.target;
        const originalText = btn.innerHTML;
        btn.innerHTML = '✅ Copied!';
        btn.style.background = 'var(--success)';
        
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.style.background = '';
            closeCsvExportModal();
            
            // Exit select mode
            if (state.csvSource === 'tracker') {
                toggleSelectMode();
            } else if (state.csvSource === 'history') {
                toggleHistorySelectMode();
            }
        }, 1500);
    } catch (err) {
        dbg(`Failed to copy to clipboard: ${err.message}`, 'error');
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = state.tempCsvData;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            showNotification('CSV copied to clipboard', 'success');
            closeCsvExportModal();
            
            // Exit select mode
            if (state.csvSource === 'tracker') {
                toggleSelectMode();
            } else if (state.csvSource === 'history') {
                toggleHistorySelectMode();
            }
        } catch (e) {
            showNotification('Failed to copy. Please try the download option.', 'error');
        }
        textarea.remove();
    }
}

window.onload = async () => {
    const t = localStorage.getItem('gt_token');
    const r = localStorage.getItem('gt_repo');
    if (t) document.getElementById('cfg-token').value = t;
    if (r) document.getElementById('cfg-repo').value = r;
    // Auto-save is always enabled; remove any legacy autosave UI element
    const autoCheckbox = document.getElementById('cfg-autosave');
    if (autoCheckbox) {
        try { autoCheckbox.closest('label')?.remove(); } catch (e) { autoCheckbox.remove(); }
    }
    updateAutoSaveUI();

    // Restore daily budget input
    const budgetInput = document.getElementById('cfg-daily-budget');
    if (budgetInput) {
        try {
            const b = getConfig('dailyBudget');
            if (b) budgetInput.value = b;
        } catch (e) { /* ignore */ }
    }
    
    // Load schema first
    const schemaLoaded = await loadSchema();
    
    // Auto-fetch only if schema loaded successfully
    if (schemaLoaded) {
        if (getConfig('autoFetch') && t && r) {
            // Only fetch today's file for the tracker on initial load for speed
            fetchFromGit(true);
        } else {
            dbg('No auto-fetch; entries remain as-is (no cache)', 'debug');
        }
    }
    
    // Initialize date input placeholder
    const dateInputInit = document.getElementById('filter-date');
    if (dateInputInit) dateInputInit.setAttribute('placeholder', 'dd/mm/yyyy');

    // Ensure date button and tracker render initialize even if no fetch occurs
    try {
        updateDateButton();
        updateBudgetUI();
        render();
    } catch (e) { /* ignore if DOM not ready */ }

    // Auto-save is always on; no unload warning necessary.
    window.addEventListener('beforeunload', (e) => {});
};

// Debug helper: write a small test entry to today's per-day file (call from browser console)
window.testWriteSample = async function() {
    try {
        const sample = {
            timestamp: new Date().toISOString(),
            date: getTodayString(),
            food: 'TEST ENTRY',
            calories: 1,
            time: new Date().toLocaleTimeString()
        };
        dbg('testWriteSample: calling pushEntryForDate with sample', 'info', sample);
        const ok = await pushEntryForDate(getTodayString(), sample);
        dbg('testWriteSample result: ' + (ok ? 'ok' : 'failed'), 'info');
        // Refresh today's file
        try { await fetchFromGit(true); } catch (e) { dbg('testWriteSample fetchFromGit failed: ' + e.message, 'error'); }
    } catch (e) {
        dbg('testWriteSample error: ' + e.message, 'error');
    }
};

// --- CSV IMPORT FUNCTIONALITY ---
let csvParsedData = [];
let csvTimeColumnFound = false;

function openCsvImport() {
    document.getElementById('csv-modal').style.display = 'flex';
    document.getElementById('csv-input').value = '';
    document.getElementById('csv-input-section').style.display = 'block';
    document.getElementById('csv-preview-section').style.display = 'none';
    csvParsedData = [];
}

function closeCsvImport() {
    document.getElementById('csv-modal').style.display = 'none';
    csvParsedData = [];
}

function parseCsv() {
    const input = document.getElementById('csv-input').value.trim();
    
    if (!input) {
        alert('Please paste CSV data first.');
        return;
    }
    
    try {
        const lines = input.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        if (lines.length < 1) {
            alert('CSV input is empty.');
            return;
        }

        // Determine whether the first row is a header (contains keywords) or data
        const firstCols = lines[0].split(',').map(h => h.trim());
        const firstLower = firstCols.map(c => c.toLowerCase());
        const looksLikeHeader = firstLower.some(h => h.includes('date') || h.includes('calor') || h.includes('food') || h.includes('time'));

        let header = [];
        let startRow = 0;

        if (looksLikeHeader) {
            header = firstLower;
            startRow = 1;

            // Validate required columns when a header is present
            const requiredCols = ['date', 'calories'];
            const missingCols = requiredCols.filter(col => !header.some(h => h.includes(col)));
            if (missingCols.length > 0) {
                alert(`Missing required columns in header: ${missingCols.join(', ')}`);
                return;
            }
        } else {
            // No header provided — assume default column order:
            // Date, Time, Food, Calories, Protein, Carbs, Fat
            header = ['date', 'time', 'food', 'calories', 'protein', 'carbs', 'fat'];
            startRow = 0;
        }

        // Find column indices based on resolved header
        const dateIdx = header.findIndex(h => h.includes('date'));
        const timeIdx = header.findIndex(h => h.includes('time'));
        const foodIdx = header.findIndex(h => h.includes('food'));
        const caloriesIdx = header.findIndex(h => h.includes('calor'));
        const proteinIdx = header.findIndex(h => h.includes('prot'));
        const carbsIdx = header.findIndex(h => h.includes('carb'));
        const fatIdx = header.findIndex(h => h.includes('fat'));

        csvTimeColumnFound = timeIdx >= 0;
        csvParsedData = [];

        // Parse data rows
        for (let i = startRow; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            
            if (values.length < 2) continue; // Skip invalid rows
            
            // Sanitize and validate
            const date = dateIdx >= 0 ? (values[dateIdx]?.trim()) : undefined;
            const calories = caloriesIdx >= 0 ? parseFloat(values[caloriesIdx]) : NaN;
            
            if (!date || isNaN(calories)) {
                dbg(`Skipping invalid row ${i}: ${lines[i]}`, 'warn');
                continue;
            }
            
            // Handle time - use provided time or current time if empty
            let time = 'Current Time';
            if (timeIdx >= 0 && values[timeIdx] && values[timeIdx].trim()) {
                time = values[timeIdx].trim();
            } else {
                // Auto-capture current time
                const now = new Date();
                time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
            }
            
            // Get food name from CSV or use default
            let food = 'Imported';
            if (foodIdx >= 0 && values[foodIdx] && values[foodIdx].trim()) {
                food = values[foodIdx].trim();
            }
            
            const entry = {
                timestamp: new Date().toISOString(),
                date: date,
                food: food,
                calories: calories,
                time: time
            };
            
            // Add optional fields if present
            if (proteinIdx >= 0 && values[proteinIdx]) {
                const protein = parseFloat(values[proteinIdx]);
                if (!isNaN(protein)) entry.protein = protein;
            }
            
            if (carbsIdx >= 0 && values[carbsIdx]) {
                const carbs = parseFloat(values[carbsIdx]);
                if (!isNaN(carbs)) entry.carbs = carbs;
            }
            
            if (fatIdx >= 0 && values[fatIdx]) {
                const fat = parseFloat(values[fatIdx]);
                if (!isNaN(fat)) entry.fat = fat;
            }
            
            csvParsedData.push(entry);
        }
        
        if (csvParsedData.length === 0) {
            alert('No valid entries found in CSV.');
            return;
        }
        
        // Show preview
        displayCsvPreview();
        
    } catch (err) {
        dbg(`CSV parse error: ${err.message}`, 'error');
        alert('Failed to parse CSV. Please check the format.');
    }
}

async function copyExampleCsv() {
    const pre = document.getElementById('example-csv');
    if (!pre) {
        showNotification('Example CSV not found', 'error');
        return;
    }
    const text = (pre.textContent || pre.innerText || '').trim();
    if (!text) {
        showNotification('Example CSV is empty', 'error');
        return;
    }

    const onSuccess = () => showNotification('📋 Example CSV copied to clipboard');

    // Try modern Clipboard API first (async/await for clearer error handling)
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            onSuccess();
            return;
        }
    } catch (err) {
        dbg(`navigator.clipboard.writeText failed: ${err && err.message ? err.message : String(err)}`, 'warn', err);
        // fall through to fallback below
    }

    // Fallback: use an offscreen textarea which is the most reliable cross-browser approach
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        // Move off-screen and make readonly to avoid mobile keyboards
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);

        const ok = document.execCommand('copy');
        document.body.removeChild(textarea);
        if (ok) {
            onSuccess();
            return;
        }
        throw new Error('execCommand(copy) returned false');
    } catch (err) {
        dbg(`Fallback copy failed: ${err && err.message ? err.message : String(err)}`, 'error', err);
                showNotification('Failed to copy example CSV to clipboard', 'error');
    }
}

function displayCsvPreview() {
    const inputSection = document.getElementById('csv-input-section');
    const previewSection = document.getElementById('csv-preview-section');
    const list = document.getElementById('csv-preview-list');
    const count = document.getElementById('csv-count');
    
    count.textContent = csvParsedData.length;
    list.innerHTML = '';
    
    csvParsedData.forEach((entry, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'background: var(--card-bg); padding: 12px; border-radius: 12px; margin-bottom: 10px; box-shadow: var(--shadow); border-left: 4px solid var(--primary); display: flex; gap: 12px; align-items: center;';

        // Build editable fields for each parsed entry so user can adjust before import
        const left = document.createElement('div');
        left.style.flex = '1';

        const foodInput = document.createElement('input');
        foodInput.type = 'text';
        foodInput.value = entry.food || '';
        foodInput.placeholder = 'Food';
        foodInput.style.cssText = 'width:100%; padding:8px; font-size:14px; margin-bottom:6px;';

        const caloriesInput = document.createElement('input');
        caloriesInput.type = 'number';
        caloriesInput.value = entry.calories || 0;
        caloriesInput.placeholder = 'Calories';
        caloriesInput.style.cssText = 'width:140px; padding:8px; font-size:14px; margin-right:8px;';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        try {
            const parsed = new Date(entry.date);
            if (!isNaN(parsed.getTime())) dateInput.value = parsed.toISOString().split('T')[0];
        } catch (e) {}
        dateInput.style.cssText = 'padding:8px; font-size:14px; margin-right:8px;';

        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        try {
            const t = entry.time;
            if (t && t !== 'Current Time') {
                const parsed = Date.parse(`1970-01-01 ${t}`);
                if (!isNaN(parsed)) {
                    const d2 = new Date(parsed);
                    timeInput.value = d2.toTimeString().slice(0,5);
                }
            }
        } catch (e) {}
        timeInput.style.cssText = 'padding:8px; font-size:14px;';

        const macroRow = document.createElement('div');
        macroRow.style.cssText = 'margin-top:8px; display:flex; gap:8px; align-items:center;';

        const proteinInput = document.createElement('input');
        proteinInput.type = 'number';
        proteinInput.value = entry.protein || '';
        proteinInput.placeholder = 'P (g)';
        proteinInput.style.cssText = 'width:80px; padding:8px; font-size:13px;';

        const carbsInput = document.createElement('input');
        carbsInput.type = 'number';
        carbsInput.value = entry.carbs || '';
        carbsInput.placeholder = 'C (g)';
        carbsInput.style.cssText = 'width:80px; padding:8px; font-size:13px;';

        const fatInput = document.createElement('input');
        fatInput.type = 'number';
        fatInput.value = entry.fat || '';
        fatInput.placeholder = 'F (g)';
        fatInput.style.cssText = 'width:80px; padding:8px; font-size:13px;';

        macroRow.appendChild(proteinInput);
        macroRow.appendChild(carbsInput);
        macroRow.appendChild(fatInput);

        left.appendChild(foodInput);

        const row2 = document.createElement('div');
        row2.style.cssText = 'display:flex; gap:8px; align-items:center; margin-top:6px;';
        row2.appendChild(caloriesInput);
        row2.appendChild(dateInput);
        row2.appendChild(timeInput);
        left.appendChild(row2);
        left.appendChild(macroRow);

        // Right actions: remove or reset
        const right = document.createElement('div');
        right.style.cssText = 'display:flex; flex-direction:column; gap:8px; align-items:flex-end;';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-secondary';
        removeBtn.textContent = 'Remove';
        removeBtn.onclick = () => {
            csvParsedData.splice(idx, 1);
            displayCsvPreview();
        };

        const resetBtn = document.createElement('button');
        resetBtn.className = 'btn-primary';
        resetBtn.style.padding = '8px 12px';
        resetBtn.textContent = 'Reset';
        resetBtn.onclick = () => {
            foodInput.value = entry.food || '';
            caloriesInput.value = entry.calories || '';
            try { dateInput.value = new Date(entry.date).toISOString().split('T')[0]; } catch (e) {}
            timeInput.value = '';
            proteinInput.value = entry.protein || '';
            carbsInput.value = entry.carbs || '';
            fatInput.value = entry.fat || '';
        };

        right.appendChild(removeBtn);
        right.appendChild(resetBtn);

        card.appendChild(left);
        card.appendChild(right);

        // Store inputs back into csvParsedData on any change
        const commitChanges = () => {
            const updated = {
                food: foodInput.value.trim(),
                calories: parseFloat(caloriesInput.value) || 0,
                date: dateInput.value || entry.date,
                time: timeInput.value ? timeInput.value : entry.time,
            };
            const p = parseFloat(proteinInput.value);
            if (!isNaN(p)) updated.protein = p; else delete updated.protein;
            const c = parseFloat(carbsInput.value);
            if (!isNaN(c)) updated.carbs = c; else delete updated.carbs;
            const f = parseFloat(fatInput.value);
            if (!isNaN(f)) updated.fat = f; else delete updated.fat;

            csvParsedData[idx] = { ...entry, ...updated };
            document.getElementById('csv-count').textContent = csvParsedData.length;
        };

        [foodInput, caloriesInput, dateInput, timeInput, proteinInput, carbsInput, fatInput].forEach(inp => {
            inp.addEventListener('change', commitChanges);
            inp.addEventListener('input', commitChanges);
        });

        list.appendChild(card);
    });
    
    // Hide input section and show preview section
    inputSection.style.display = 'none';
    previewSection.style.display = 'block';
    
    dbg(`Parsed ${csvParsedData.length} entries from CSV (Time column: ${csvTimeColumnFound ? 'found' : 'not found, using current time'})`, 'info');
}

function backToCsvInput() {
    const inputSection = document.getElementById('csv-input-section');
    const previewSection = document.getElementById('csv-preview-section');
    
    inputSection.style.display = 'block';
    previewSection.style.display = 'none';
}

// --- Time Picker Modal (iPhone-like) ---
let timePickerTargetId = null;
function populateTimePicker() {
    const hr = document.getElementById('tp-hour');
    const min = document.getElementById('tp-minute');
    if (!hr || !min) return;
    if (hr.children.length === 0) {
        for (let h = 0; h < 24; h++) {
            const o = document.createElement('option');
            o.value = String(h).padStart(2, '0');
            o.textContent = String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0') + (h < 12 ? ' AM' : ' PM');
            hr.appendChild(o);
        }
    }
    if (min.children.length === 0) {
        for (let m = 0; m < 60; m += 1) {
            const o = document.createElement('option');
            o.value = String(m).padStart(2, '0');
            o.textContent = String(m).padStart(2, '0');
            min.appendChild(o);
        }
    }
}

function openTimePicker(targetInputId) {
    populateTimePicker();
    timePickerTargetId = targetInputId;
    const modal = document.getElementById('time-picker-modal');
    const input = document.getElementById(targetInputId);
    if (input && input.value) {
        const v = input.value; // expects HH:MM
        const parts = v.split(':');
        if (parts.length === 2) {
            const hr = document.getElementById('tp-hour');
            const min = document.getElementById('tp-minute');
            hr.value = parts[0];
            min.value = parts[1];
        }
    }
    if (modal) modal.style.display = 'flex';
}

function closeTimePicker() {
    const modal = document.getElementById('time-picker-modal');
    if (modal) modal.style.display = 'none';
    timePickerTargetId = null;
}

function confirmTimePicker() {
    if (!timePickerTargetId) return closeTimePicker();
    const hr = document.getElementById('tp-hour');
    const min = document.getElementById('tp-minute');
    if (!hr || !min) return closeTimePicker();
    const value = `${hr.value}:${min.value}`;
    const input = document.getElementById(timePickerTargetId);
    if (input) {
        input.value = value;
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new Event('change'));
    }
    closeTimePicker();
}

async function importCsvEntries() {
    if (csvParsedData.length === 0) return;
    
    // Add all parsed entries
    state.entries.push(...csvParsedData);
    state.hasUnsavedChanges = true;

    render();
    renderHistory();

    dbg(`Imported ${csvParsedData.length} entries`, 'info');

    // Auto-save behavior: always push imported CSV to per-date files (append mode)
    try {
        dbg('Auto-save: pushing imported CSV to GitHub (per-date append)', 'info');
        await pushEntriesByDate(csvParsedData, { mode: 'append' });
    } catch (e) {
        dbg(`Auto-save push failed: ${e.message}`, 'error');
    }

    closeCsvImport();
}

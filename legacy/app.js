let state = { 
    entries: [], 
    sha: "", 
    logs: [], 
    retentionMinutes: 5, 
    schema: null,
    fileIndex: {},
    // streak: persisted streak information (current + best)
    streak: {
        currentStreak: 0,
        longestStreak: 0,
        lastActiveDate: null,
        computedAt: null,
        activeDates: []
    },
    // Calendar view state for streaks (month offset and per-month cache)
    streakCalendar: {
        offsetMonths: 0,
        cache: {}
    },
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

// Early listener: ensure clicks on the Toggles button are detected even if later initialization fails
try {
    console.log('[app.js] instrumentation loaded');
    document.addEventListener('click', function (ev) {
        try {
            if (!ev || !ev.target) return;
            const btn = ev.target.closest ? ev.target.closest('#open-toggles-btn') : null;
            if (btn) {
                try {
                    console.log('[debug] open-toggles-btn clicked (early listener)', ev.target && ev.target.tagName, ev.target && ev.target.id);
                    if (typeof openTogglesPopup === 'function') { openTogglesPopup(); return; }
                    if (typeof window.openTogglesPopup === 'function') { window.openTogglesPopup(); return; }
                    console.log('[debug] openTogglesPopup not defined at click time');
                } catch (err) {
                    console.error('[debug] openTogglesPopup call error', err);
                }
            }
        } catch (e) { console.error('[debug] early listener error', e); }
    }, true);

    // Fallback: attempt to attach a direct handler to the button until it exists
    const attachInterval = setInterval(() => {
        try {
            const directBtn = document.getElementById('open-toggles-btn');
            if (directBtn && !directBtn.__toggles_bound) {
                console.log('[debug] Attaching direct click handler to #open-toggles-btn');
                directBtn.addEventListener('click', (e) => {
                    console.log('[debug] direct handler: #open-toggles-btn clicked', e.target && e.target.tagName, e.target && e.target.id);
                    try { if (typeof openTogglesPopup === 'function') openTogglesPopup(); else if (typeof window.openTogglesPopup === 'function') window.openTogglesPopup(); else console.log('[debug] openTogglesPopup missing at direct handler'); } catch (err) { console.error('[debug] direct handler error', err); }
                });
                directBtn.__toggles_bound = true;
                clearInterval(attachInterval);
            }
        } catch (e) { /* ignore */ }
    }, 200);
} catch (e) { console.error('[debug] instrumentation setup failed', e); }

// allow toggling weight edit mode for the compact panel
state.weightEditMode = false;
// Track which date is being edited in the weight-edit modal (null when closed)
state.weightEditTargetDate = null;

// Track which history date-sets we've attempted to prefetch to avoid fetch loops
state.historyPrefetchAttempts = new Set();
// Track which history date-sets we've already notified as served from local cache
state.historyCacheNotified = new Set();

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

// Convert stored "H:MM AM/PM" → "HH:MM" for <input type="time">
function _timeTo24(t) {
    if (!t) return '';
    const m = t.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return '';
    let h = parseInt(m[1], 10);
    const ap = m[3].toUpperCase();
    if (ap === 'PM' && h !== 12) h += 12;
    if (ap === 'AM' && h === 12) h = 0;
    return `${String(h).padStart(2, '0')}:${m[2]}`;
}

// Convert "HH:MM" from <input type="time"> → stored "H:MM AM/PM"
function _time24to12(hhmm) {
    if (!hhmm) return '';
    const parts = hhmm.split(':');
    if (parts.length < 2) return '';
    const h = parseInt(parts[0], 10);
    const min = parts[1];
    const ap = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 || 12;
    return `${h12}:${min} ${ap}`;
}


function showFullNotification(message, type = 'info') {
    try {
        const n = document.createElement('div');
        n.className = 'gt-notification';
        n.textContent = message;
        // basic styling placed inline to avoid touching CSS files
        n.style.cssText = 'position: fixed; top: 16px; right: 16px; background: var(--card-bg); color: var(--text); padding: 10px 14px; border-radius: 10px; box-shadow: 0 6px 20px rgba(0,0,0,0.12); z-index: 10000; font-size: 13px; font-weight:600; opacity:1; transition: opacity 0.25s;';
        // Types: 'error'|'delete' (red), 'write'|'success' (green), 'read' (blue), default (card bg)
        if (type === 'error' || type === 'delete') {
            n.style.background = '#ff3b30';
            n.style.color = '#fff';
        } else if (type === 'success' || type === 'write') {
            n.style.background = 'linear-gradient(90deg,#34c759 0%, #30d158 100%)';
            n.style.color = '#fff';
        } else if (type === 'read') {
            n.style.background = '#007aff';
            n.style.color = '#fff';
        }
        document.body.appendChild(n);
        // Stagger multiple toasts by offsetting new ones downwards to avoid overlap
        const existing = Array.from(document.querySelectorAll('.gt-notification'));
        existing.forEach((el, idx) => { el.style.top = `${16 + idx * 56}px`; });
        setTimeout(() => { n.style.opacity = '0'; setTimeout(() => n.remove(), 300); }, 2500);
    } catch (e) { /* ignore */ }
}

// Lightweight notification wrapper: show full toast when enabled, otherwise show compact dot.
// `forceFull` allows callers to force a full toast regardless of user setting.
function showNotification(message, type = 'info', forceFull = false) {
    try {
        const alwaysFull = (type === 'error'); // errors always shown full
        const enabled = !!getConfig('showToasts');
        if (enabled || forceFull || alwaysFull) {
            try { showFullNotification(message, type); } catch (e) { /* ignore */ }
            return;
        }

        // Show compact colored dot instead of full toast
        const dot = document.createElement('div');
        dot.className = 'gt-notification-dot';
        dot.setAttribute('title', message || '');
        dot.setAttribute('aria-label', message || '');

        // Determine color based on type using CSS variables
        const style = getComputedStyle(document.documentElement);
        let bg = style.getPropertyValue('--primary').trim() || '#007aff';
        if (type === 'error' || type === 'delete') bg = style.getPropertyValue('--danger').trim() || '#ff3b30';
        else if (type === 'write' || type === 'success') bg = style.getPropertyValue('--success').trim() || '#34c759';
        else if (type === 'read') bg = style.getPropertyValue('--primary').trim() || '#007aff';

        dot.style.background = bg;

        // Stack multiple dots slightly to avoid full overlap
        const existingDots = Array.from(document.querySelectorAll('.gt-notification-dot'));
        existingDots.forEach((el, idx) => { el.style.top = `${16 + idx * 20}px`; });
        document.body.appendChild(dot);
        setTimeout(() => { dot.style.opacity = '0'; setTimeout(() => dot.remove(), 300); }, 2200);
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
    const el = document.getElementById('date-btn');
    if (!el) return;
    el.textContent = getTodayString();
}

// Helper: canonical today string used for filenames (YYYY-MM-DD)
function getTodayString() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

// Converts "YYYY-MM-DD" → "3rd April 2026"
function formatDateReadable(dateStr) {
    if (!dateStr) return '—';
    try {
        const [year, month, day] = dateStr.split('-').map(Number);
        const v = day % 100;
        const suffix = (v >= 11 && v <= 13) ? 'th' : (['th','st','nd','rd'][day % 10] || 'th');
        const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
        return `${day}${suffix} ${months[month - 1]} ${year}`;
    } catch(e) { return dateStr; }
}

function updateBudgetUI(todayTotal) {
    const budget = parseInt(getConfig('dailyBudget') || 0, 10) || 0;
    // Calculate total if not passed
    let total = 0;
    if (typeof todayTotal === 'number') {
        total = todayTotal;
    } else {
        const todayKey = getTodayString();
        total = state.entries.reduce((s, e) => {
            try {
                if (getEntryDate(e) !== todayKey) return s;
            } catch (ex) { return s; }
            const c = parseFloat(e.calories);
            return s + (isNaN(c) ? 0 : c);
        }, 0);
    }
    const pct = budget > 0 ? Math.min(100, Math.round((total / budget) * 100)) : 0;
    dbg(`Budget UI: total=${total} budget=${budget} pct=${pct}%`, 'debug');
    const fill = document.getElementById('budget-bar-fill');
    const vals = document.getElementById('budget-values');
    if (vals) vals.textContent = `${Math.round(total)} / ${budget} kcal`;

    // Compute macro calories for today's entries
    const todayKey = getTodayString();
    const macros = state.entries.reduce((acc, e) => {
        try {
            if (getEntryDate(e) !== todayKey) return acc;
        } catch (ex) { return acc; }
        const p = parseFloat(e.protein) || 0;
        const c = parseFloat(e.carbs) || 0;
        const f = parseFloat(e.fat) || 0;
        acc.protein += p;
        acc.carbs += c;
        acc.fat += f;
        return acc;
    }, { protein: 0, carbs: 0, fat: 0 });

    const calFromProtein = macros.protein * 4;
    const calFromCarbs = macros.carbs * 4;
    const calFromFat = macros.fat * 9;
    const totalMacroCalories = calFromProtein + calFromCarbs + calFromFat;

    // Set outer fill width relative to budget and ensure solid colored segments
    if (fill) {
        fill.style.width = pct + '%';
        // Remove any gradient background on the fill so segments show clearly
        fill.style.background = 'transparent';
        fill.style.display = 'flex';
        // Fill contains three child segments; compute widths inside the filled area
        const segFat = document.getElementById('budget-seg-fat');
        const segProtein = document.getElementById('budget-seg-protein');
        const segCarbs = document.getElementById('budget-seg-carbs');

        if (totalMacroCalories > 0) {
            // Compute each segment as a fraction of the filled portion
            const fracFat = calFromFat / totalMacroCalories;
            const fracProtein = calFromProtein / totalMacroCalories;
            const fracCarbs = calFromCarbs / totalMacroCalories;

            // Set child element widths for tooltips (kept) and a min-visible width
            if (segFat) { segFat.style.width = (fracFat * 100) + '%'; segFat.style.display = 'block'; segFat.style.minWidth = '2px'; segFat.title = `Fat: ${Math.round(macros.fat)} g (${Math.round(fracFat * 100)}%)`; }
            if (segProtein) { segProtein.style.width = (fracProtein * 100) + '%'; segProtein.style.display = 'block'; segProtein.style.minWidth = '2px'; segProtein.title = `Protein: ${Math.round(macros.protein)} g (${Math.round(fracProtein * 100)}%)`; }
            if (segCarbs) { segCarbs.style.width = (fracCarbs * 100) + '%'; segCarbs.style.display = 'block'; segCarbs.style.minWidth = '2px'; segCarbs.title = `Carbs: ${Math.round(macros.carbs)} g (${Math.round(fracCarbs * 100)}%)`; }

            // Also set a deterministic linear-gradient background on the fill so segments are visible
            const stop1 = Math.round(fracFat * 100);
            const stop2 = Math.round((fracFat + fracProtein) * 100);
            const colFat = '#ff3b30';
            const colProtein = '#34c759';
            const colCarbs = '#007aff';
            fill.style.background = `linear-gradient(90deg, ${colFat} 0% ${stop1}%, ${colProtein} ${stop1}% ${stop2}%, ${colCarbs} ${stop2}% 100%)`;
        } else {
            if (segFat) { segFat.style.width = '0%'; segFat.title = 'Fat: 0 g (0%)'; }
            if (segProtein) { segProtein.style.width = '0%'; segProtein.title = 'Protein: 0 g (0%)'; }
            if (segCarbs) { segCarbs.style.width = '0%'; segCarbs.title = 'Carbs: 0 g (0%)'; }
            fill.style.background = 'transparent';
        }

        // If over budget visually indicate by adding subtle outline to fill
        if (total > budget && budget > 0) {
            fill.style.boxShadow = 'inset 0 0 0 2px rgba(255,59,48,0.12)';
        } else {
            fill.style.boxShadow = 'none';
        }
    }
}

// Main render entry used across the app. Kept minimal so it's safe to call
// early in startup before other render helpers are defined.
function render() {
    // Ensure state.entries is an array (normalize possible malformed shapes)
    try {
        normalizeStateEntries();
    } catch (e) { dbg(`normalizeStateEntries error: ${e && e.message}`, 'error'); }
    try {
        // Compute today's total only from entries that match the canonical today date
        const today = getTodayString();
        const todayTotal = Array.isArray(state.entries)
            ? state.entries.reduce((s, e) => (getEntryDate(e) === today ? s + (parseFloat(e.calories) || 0) : s), 0)
            : 0;
        if (typeof updateBudgetUI === 'function') updateBudgetUI(todayTotal);
        if (typeof updateWeightTabUI === 'function') updateWeightTabUI(today);

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
                        // Exclude internal meta entries (dailyWeight) from the visible tracker list
                        if (d === today && !(e && e._meta === 'dailyWeight')) todayIdx.push({ entry: e, idx: i });
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
        // If analytics page is active, refresh charts to reflect latest entries
        if (activePage && activePage.id === 'page-analytics' && typeof updateAnalytics === 'function') {
            try { updateAnalytics(); } catch (e) { dbg(`updateAnalytics error: ${e && e.message}`, 'error'); }
        }
    } catch (e) {
        try { dbg(`render error: ${e && e.message ? e.message : String(e)}`, 'error', e); } catch (eee) { /* ignore */ }
    }
}

// Normalize `state.entries` into an array if it was accidentally set to an object
function normalizeStateEntries() {
    if (Array.isArray(state.entries)) return;
    if (!state.entries || typeof state.entries !== 'object') {
        state.entries = [];
        return;
    }
    // If it's a map of date => [entries], merge them
    const keys = Object.keys(state.entries);
    const looksLikeDateMap = keys.length > 0 && keys.every(k => /^\d{4}-\d{2}-\d{2}$/.test(k) && Array.isArray(state.entries[k]));
    if (looksLikeDateMap) {
        const merged = keys.sort().reduce((acc, k) => acc.concat(state.entries[k] || []), []);
        state.entries = merged;
        return;
    }
    // Otherwise try to flatten any array-like values
    try {
        const vals = keys.map(k => state.entries[k]).filter(v => Array.isArray(v)).flat();
        if (Array.isArray(vals) && vals.length > 0) {
            state.entries = vals;
            return;
        }
    } catch (e) { /* ignore */ }
    // Fallback: set to empty array
    state.entries = [];
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
            showNotification('Budget saved to repo', 'write');
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

async function loadBudgetFromRepo() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) return false;
    const url = `https://api.github.com/repos/${repo}/contents/budget.json`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (!res.ok) return false;
        const j = await res.json();
        if (j && j.content) {
            const decoded = decodeURIComponent(escape(atob(j.content)));
            const cfg = JSON.parse(decoded);
            if (cfg && typeof cfg.dailyBudget === 'number') {
                setConfig('dailyBudget', cfg.dailyBudget);
                const inp = document.getElementById('cfg-daily-budget');
                if (inp) inp.value = cfg.dailyBudget;
                dbg(`Loaded budget from repo: ${cfg.dailyBudget}`, 'info');
                return true;
            }
        }
        return false;
    } catch (e) {
        dbg('loadBudgetFromRepo error: ' + (e && e.message), 'error');
        return false;
    }
}

// Save current app configuration (from getAllConfig) to the repository as settings.json
async function saveSettingsToRepo() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) {
        dbg('Cannot save settings: missing GitHub credentials', 'warn');
        return false;
    }

    const filePath = 'settings.json';
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    // Build settings object from current config (do not include tokens)
    let configObj = {};
    try {
        if (typeof getAllConfig === 'function') {
            configObj = getAllConfig();
        } else {
            // Fallback: persist only known key
            configObj = { allowEditOlderWeights: getConfig('allowEditOlderWeights') };
        }
    } catch (e) {
        configObj = { allowEditOlderWeights: getConfig('allowEditOlderWeights') };
    }

    try {
        // Try to fetch existing file to include SHA
        let fileSha = null;
        try {
            const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
            if (getRes.ok) {
                const j = await getRes.json();
                fileSha = j.sha;
            }
        } catch (e) { /* ignore */ }

        const body = {
            message: `Update settings: ${new Date().toISOString()}`,
            content: btoa(unescape(encodeURIComponent(JSON.stringify(configObj, null, 2))))
        };
        if (fileSha) body.sha = fileSha;

        // Attempt initial PUT
        let putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (putRes.ok) {
            try { showNotification('Settings saved to repo', 'write'); } catch (e) {}
            dbg('Settings saved to GitHub', 'info');
            return true;
        }

        // Handle conflict (409) by re-fetching latest SHA and retrying once
        if (putRes.status === 409) {
            dbg('saveSettingsToRepo: conflict (409) — refreshing remote SHA and retrying', 'warn');
            try {
                const refreshRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
                if (refreshRes.ok) {
                    const refreshed = await refreshRes.json();
                    if (refreshed && refreshed.sha) {
                        body.sha = refreshed.sha;
                        dbg('saveSettingsToRepo: retrying PUT with refreshed sha=' + body.sha, 'debug');
                        putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                        if (putRes.ok) {
                            try { showNotification('Settings saved to repo', 'write'); } catch (e) {}
                            dbg('Settings saved to GitHub (after retry)', 'info');
                            return true;
                        }
                    }
                } else {
                    dbg('saveSettingsToRepo: failed to refresh settings.json after 409', 'error');
                }
            } catch (e) {
                dbg('saveSettingsToRepo retry error: ' + (e && e.message), 'error', e);
            }
        }

        // If we reach here, attempt to read error body for clearer message
        let errBody = null;
        try { errBody = await putRes.json(); } catch (e) { errBody = null; }
        const errMsg = (errBody && (errBody.message || JSON.stringify(errBody))) || putRes.statusText || `HTTP ${putRes.status}`;
        dbg('Failed to save settings: ' + errMsg, 'error', errBody);
        try { showNotification(`Failed to save settings to repo: ${errMsg}`, 'error', true); } catch (e) {}
        return false;
    } catch (err) {
        dbg('saveSettingsToRepo error: ' + err.message, 'error');
        try { showNotification('Error saving settings to repo', 'error'); } catch (e) {}
        return false;
    }
}

// Settings save queue to avoid concurrent PUTs causing SHA conflicts
let __settingsSaveQueue = [];
let __settingsSaveInProgress = false;
let __settingsSaveDebounceTimer = null;
const __SETTINGS_SAVE_DEBOUNCE_MS = 250;

function enqueueSettingsSave() {
    return new Promise((resolve, reject) => {
        __settingsSaveQueue.push({ resolve, reject });
        if (__settingsSaveDebounceTimer) clearTimeout(__settingsSaveDebounceTimer);
        __settingsSaveDebounceTimer = setTimeout(() => {
            __processSettingsSaveQueue();
        }, __SETTINGS_SAVE_DEBOUNCE_MS);
    });
}

async function __processSettingsSaveQueue() {
    if (__settingsSaveInProgress) return;
    if (__settingsSaveDebounceTimer) { clearTimeout(__settingsSaveDebounceTimer); __settingsSaveDebounceTimer = null; }
    if (__settingsSaveQueue.length === 0) return;
    __settingsSaveInProgress = true;
    try {
        // Perform a single save for all queued requests (coalesced)
        const ok = await saveSettingsToRepo();
        while (__settingsSaveQueue.length) {
            const { resolve } = __settingsSaveQueue.shift();
            try { resolve(ok); } catch (e) {}
        }
    } catch (err) {
        while (__settingsSaveQueue.length) {
            const { reject } = __settingsSaveQueue.shift();
            try { reject(err); } catch (e) {}
        }
    } finally {
        __settingsSaveInProgress = false;
    }
}

// Export enqueue function for debugging/usage from other scopes
try { window.enqueueSettingsSave = enqueueSettingsSave; } catch (e) { /* ignore */ }

// Load settings.json from repo (if present) and merge into local config
async function loadSettingsFromRepo() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) {
        dbg('loadSettingsFromRepo: missing credentials, skipping', 'debug');
        return false;
    }
    const filePath = 'settings.json';
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (!res.ok) {
            dbg('loadSettingsFromRepo: settings file not found or inaccessible', 'debug');
            return false;
        }
        const j = await res.json();
        if (j && j.content) {
            const decoded = decodeURIComponent(escape(atob(j.content)));
            try {
                const cfg = JSON.parse(decoded);
                if (cfg && typeof cfg === 'object') {
                    // Merge into local config using setConfig
                    Object.keys(cfg).forEach(k => {
                        try {
                            // Avoid overwriting GitHub tokens stored in localStorage
                            if (k === 'gt_token' || k === 'gt_repo') return;
                            setConfig(k, cfg[k]);
                        } catch (e) { dbg(`loadSettingsFromRepo: setConfig failed for ${k}`, 'warn'); }
                    });
                    dbg('Loaded settings from repo and merged into local config', 'info');
                    return true;
                }
            } catch (e) {
                dbg('loadSettingsFromRepo: failed to parse settings.json', 'error', e);
                return false;
            }
        }
        return false;
    } catch (e) {
        dbg('loadSettingsFromRepo error: ' + (e && e.message), 'error');
        return false;
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
    // Track selection highlight for tracker mode as well
    if (mode === 'tracker' && state.selectMode && state.selectedEntries.has(globalIndex)) {
        d.style.background = 'rgba(0, 122, 255, 0.06)';
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

    // Checkbox (history select mode OR tracker select mode)
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
    } else if (mode === 'tracker' && state.selectMode) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.checked = state.selectedEntries.has(globalIndex);
        cb.style.width = '20px';
        cb.style.height = '20px';
        cb.style.cursor = 'pointer';
        cb.onchange = () => toggleEntrySelection(globalIndex);
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
    // Optional Health Score badge (1-10)
    if (entry.healthScore || entry.healthScore === 0) {
        const score = document.createElement('div');
        score.style.fontSize = '12px';
        score.style.color = 'var(--text-secondary)';
        score.style.padding = '4px 8px';
        score.style.borderRadius = '8px';
        score.style.background = 'rgba(0,0,0,0.03)';
        score.textContent = `Score: ${Math.round(entry.healthScore)} / 10`;
        topRight.appendChild(score);
    }

    // Top row (checkbox + content + calories)
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.gap = '12px';
    row.style.alignItems = 'center';
    row.style.width = '100%';
    row.style.justifyContent = 'space-between'; // push calories to the far right
    if ((mode === 'history' && state.historySelectMode) || (mode === 'tracker' && state.selectMode)) row.appendChild(checkboxWrapper);
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

    // "Add to Today" — history mode only, outside select mode (always visible regardless of range view)
    if (mode === 'history' && !state.historySelectMode) {
        const addBtn = document.createElement('button');
        addBtn.style.cssText = 'background: #34c759; color: white; border: none; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; min-height:36px;';
        addBtn.textContent = 'Add to Today';
        addBtn.setAttribute('onclick', `addEntryToToday(${globalIndex})`);
        footer.appendChild(addBtn);
    }

    // "+1" quick-add another serving — tracker mode only, outside select mode
    if (mode === 'tracker' && !state.selectMode) {
        const plusBtn = document.createElement('button');
        plusBtn.style.cssText = 'background: #ff9500; color: white; border: none; padding: 6px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; min-height:36px;';
        plusBtn.textContent = '+1';
        plusBtn.title = 'Add another serving of this meal';
        plusBtn.setAttribute('onclick', `repeatEntryToday(${globalIndex})`);
        footer.appendChild(plusBtn);
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
            try { showNotification('Logs saved to GitHub', 'write'); } catch (e) {}
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

    // Persist current page in URL hash so refresh returns to same page
    history.replaceState(null, '', '#' + p);
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
        state.historyPrefetchAttempts.clear();

        const today = getTodayString();
        state.dateRangeStart = today;
        state.dateRangeEnd = today;

        // Initialise / reset filter controls to "Today"
        try {
            const rs = document.getElementById('range-select'); if (rs) rs.value = 'today';
            const s = document.getElementById('filter-date-start'); if (s) s.value = today;
            const e = document.getElementById('filter-date-end'); if (e) e.value = today;
            updateApplyButtonState();
        } catch (e) {}

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
        // Sync theme selector with current preference
        const themeSel = document.getElementById('theme-mode');
        if (themeSel) themeSel.value = localStorage.getItem('gt_theme') || 'auto';
        // Sync auto-increment streak toggle
        try {
            const autoChk = document.getElementById('cfg-auto-increment-streak');
            if (autoChk) {
                autoChk.checked = !!getConfig('autoIncrementStreakOnAdd');
                autoChk.onchange = () => { try { setConfig('autoIncrementStreakOnAdd', !!autoChk.checked); dbg('autoIncrementStreakOnAdd set to ' + !!autoChk.checked, 'info'); } catch (e) { dbg('cfg auto-increment handler error: ' + (e && e.message), 'warn'); } };
            }
        } catch (e) { /* ignore */ }
    }
    else if (p === 'streaks') {
        // Ensure the streaks page shows the latest persisted/computed values
        try {
            updateStreakUI();
            // Show current month view for streaks (lazy-load month data)
            try { showStreakMonth(state.streakCalendar.offsetMonths || 0); } catch (e) { /* ignore */ }
        } catch (e) { dbg('showPage(streaks) updateStreakUI failed', 'warn', e); }
    }
    // Ensure the newly shown page renders its latest state immediately
    try { render(); } catch (e) { dbg(`showPage render error: ${e && e.message ? e.message : String(e)}`, 'error'); }
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

    // Ensure runtime schema includes healthScore so the form shows it immediately
    try {
        if (!Array.isArray(state.schema.fields)) state.schema.fields = state.schema.fields || [];
        if (!state.schema.fields.some(f => f.name === 'healthScore')) {
            state.schema.fields.push({
                name: 'healthScore',
                type: 'number',
                label: 'Health Score (1-10)',
                required: false,
                min: 1,
                max: 10,
                placeholder: 'Optional - 1 (poor) .. 10 (excellent)'
            });
            dbg('Runtime: injected healthScore into schema.fields', 'debug');
        }
    } catch (e) { dbg('Failed to inject runtime healthScore field: ' + (e && e.message), 'warn'); }
    
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
        
        // Force time field to always use native picker regardless of schema type
        if (field.name === 'time') {
            const wrapper = document.createElement('div');
            wrapper.className = 'form-field';
            const inp = document.createElement('input');
            inp.type = 'time';
            inp.id = 'field-time';
            inp.placeholder = 'Meal time';
            inp.className = 'form-input';
            wrapper.appendChild(inp);
            container.appendChild(wrapper);
            return;
        }
        
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
        } else if (field.name === 'healthScore') {
            // Render healthScore as a dropdown (1-10)
            input = document.createElement('select');
            input.id = `field-${field.name}`;

            const emptyOption = document.createElement('option');
            emptyOption.value = '';
            emptyOption.textContent = `Select ${field.label}`;
            input.appendChild(emptyOption);

            for (let i = (field.min || 1); i <= (field.max || 10); i++) {
                const opt = document.createElement('option');
                opt.value = String(i);
                opt.textContent = String(i);
                input.appendChild(opt);
            }
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
        
        wrapper.appendChild(input);
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
        
        wrapper.appendChild(input);
        macroSection.appendChild(wrapper);
    });

    // Fallback: ensure healthScore input exists in the main form (not inside macros)
    try {
        if (!document.getElementById('field-healthScore')) {
            const hsField = state.schema.fields.find(f => f.name === 'healthScore');
            if (hsField) {
                const fb = document.createElement('div');
                fb.className = 'form-field';
                fb.style.gridColumn = 'span 2';

                const inp = document.createElement('select');
                inp.id = 'field-healthScore';
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = hsField.label ? `Select ${hsField.label}` : 'Select Health Score';
                inp.appendChild(emptyOpt);
                const minV = hsField.min !== undefined ? hsField.min : 1;
                const maxV = hsField.max !== undefined ? hsField.max : 10;
                for (let i = minV; i <= maxV; i++) {
                    const o = document.createElement('option');
                    o.value = String(i);
                    o.textContent = String(i);
                    inp.appendChild(o);
                }
                inp.style.cssText = 'width:100%; padding:8px;';

                fb.appendChild(inp);
                container.appendChild(fb);
            }
        }
    } catch (e) { /* ignore fallback errors */ }

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
            // Handle native time input (HH:MM → "H:MM AM/PM" stored format)
            if (field.name === 'time') {
                if (!value) {
                    value = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                } else {
                    value = _time24to12(value) || value;
                }
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

function toggleTokenVisibility() {
    const input = document.getElementById('cfg-token');
    const icon = document.getElementById('token-eye-icon');
    if (!input) return;
    const isHidden = input.type === 'password';
    input.type = isHidden ? 'text' : 'password';
    if (icon) icon.textContent = isHidden ? '🙈' : '👁️';
}

// ── Settings fuzzy search ────────────────────────────────────────────────────
function settingsSearch(query) {
    const clearBtn = document.getElementById('settings-search-clear');
    const resultsEl = document.getElementById('settings-search-results');
    const allCards = document.querySelectorAll('#page-settings [data-settings-tags]');

    if (clearBtn) clearBtn.style.display = query ? 'flex' : 'none';

    if (!query || query.trim().length < 1) {
        if (resultsEl) { resultsEl.style.display = 'none'; resultsEl.innerHTML = ''; }
        allCards.forEach(c => { c.style.display = ''; });
        const quickRow = document.querySelector('#page-settings .sc-quick-row');
        if (quickRow) quickRow.style.display = '';
        return;
    }

    const q = query.trim().toLowerCase();

    // Fuzzy score: count matching characters in sequence (subsequence), also straight substring bonus
    function fuzzyScore(text, q) {
        text = text.toLowerCase();
        if (text.includes(q)) return 100 + (1 / text.length); // exact substring wins
        let tIdx = 0, qIdx = 0, score = 0;
        while (tIdx < text.length && qIdx < q.length) {
            if (text[tIdx] === q[qIdx]) { score++; qIdx++; }
            tIdx++;
        }
        return qIdx === q.length ? score : 0;
    }

    const scored = [];
    allCards.forEach(card => {
        const tags = (card.getAttribute('data-settings-tags') || '') + ' ' + (card.querySelector('.sc-title')?.textContent || '');
        const score = Math.max(...tags.split(' ').map(t => fuzzyScore(t, q)));
        const title = (card.querySelector('.sc-title') || card.querySelector('.sc-quick-label'))?.textContent || 'Setting';
        if (score > 0) scored.push({ card, score, title });
    });

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, 3);

    // Hide all cards while searching, show only results summary
    allCards.forEach(c => { c.style.display = 'none'; });
    const quickRow = document.querySelector('#page-settings .sc-quick-row');
    if (quickRow) quickRow.style.display = 'none';

    if (!resultsEl) return;
    if (top.length === 0) {
        resultsEl.innerHTML = '<div class="settings-search-empty">No matching settings found.</div>';
        resultsEl.style.display = 'block';
        return;
    }

    resultsEl.innerHTML = '';
    resultsEl.style.display = 'block';

    top.forEach(({ card, title }) => {
        const btn = document.createElement('button');
        btn.className = 'settings-search-hit';
        const icon = (card.querySelector('.sc-icon') || card.querySelector('.sc-quick-icon'))?.textContent || '⚙️';
        btn.innerHTML = `<span class="ssh-icon">${icon}</span><span class="ssh-label">${title}</span><span class="ssh-arr">›</span>`;
        btn.onclick = () => {
            settingsSearchClear();
            card.style.display = '';
            // Show quick-row if needed
            if (card.closest('.sc-quick-row')) {
                const qr = document.querySelector('#page-settings .sc-quick-row');
                if (qr) qr.style.display = '';
            }
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.classList.add('sc-highlight');
            setTimeout(() => card.classList.remove('sc-highlight'), 1600);
        };
        resultsEl.appendChild(btn);
    });
}

function settingsSearchClear() {
    const input = document.getElementById('settings-search');
    if (input) { input.value = ''; }
    settingsSearch('');
}

// --- CORE LOGIC ---
async function validateRepoConnection() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) return { ok: false, message: 'Missing token or repo' };
    const url = `https://api.github.com/repos/${repo}`;
    try {
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }
        if (res.ok) return { ok: true };
        const msg = (body && body.message) ? body.message : res.statusText || `HTTP ${res.status}`;
        return { ok: false, message: msg + ` (${res.status})` };
    } catch (e) {
        return { ok: false, message: e && e.message ? e.message : 'Network error' };
    }
}

async function saveSettings() {
    const t = document.getElementById('cfg-token').value.trim();
    const r = document.getElementById('cfg-repo').value.trim();
    const dailyBudgetInput = document.getElementById('cfg-daily-budget');
    const dailyBudget = dailyBudgetInput ? parseInt(dailyBudgetInput.value, 10) : null;

    localStorage.setItem('gt_token', t);
    localStorage.setItem('gt_repo', r);
    if (!isNaN(dailyBudget) && dailyBudget > 0) setConfig('dailyBudget', dailyBudget);

    dbg('Settings saved');
    toggleSettings();

    // Validate GitHub connection and inform user
    try {
        const res = await validateRepoConnection();
        if (res.ok) {
            showNotification('GitHub repository validated', 'write');
        } else {
            showNotification(`GitHub validation failed: ${res.message}`, 'error');
        }
    } catch (e) { dbg('validateRepoConnection failed', 'warn', e); }

    // After saving settings, only fetch today's per-day file — never perform a full-folder fetch.
    fetchFromGit(true).catch(err => dbg(`fetchFromGit(today) after saving settings failed: ${err && err.message}`, 'warn'));
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
    // Enforce policy: do NOT allow full-folder listing/fetches.
    // Only per-day fetches (today or explicit per-date helpers) are permitted.
    if (!onlyToday) {
        dbg('fetchFromGit: full-folder fetch disabled by policy; aborting.', 'error');
        try { showNotification('Full-folder fetch disabled by policy; aborting.', 'error'); } catch (e) {}
        // Fail early so callers can handle the rejection explicitly.
        throw new Error('Full-folder fetch disabled by policy');
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
                    // Tag entries with source date so they are associated with the per-day file
                    arr = arr.map(e => ({ ...(e || {}), _sourceDate: today }));
                    state.fileIndex[today] = j.sha;
                    state.entries = arr;
                    try { showNotification(`Fetched 1 file (${arr.length} entries) for ${today}`, 'read'); } catch (e) {}
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
                            // Tag each entry with its source date
                            arr = arr.map(e => ({ ...(e || {}), _sourceDate: dateStr }));
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
                try { showNotification(`Fetched ${toFetch.length} files (${state.entries.length} entries) from GitHub`, 'read'); } catch (e) {}
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

// Fetch a single per-day file from GitHub and merge into state.entries
async function fetchDateFromGit(dateStr) {
    try {
        const token = localStorage.getItem('gt_token');
        const repo = localStorage.getItem('gt_repo');
        if (!token || !repo) {
            dbg('fetchDateFromGit: missing credentials', 'warn');
            return { status: 0, entries: null };
        }
        const dataFolder = getConfig('dataFolder') || 'data';
        const filePath = `${dataFolder}/${dateStr}.json`;
        const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
        dbg(`fetchDateFromGit: fetching ${filePath}`, 'info');
        const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        const status = res.status;
        if (!res.ok) {
            dbg(`fetchDateFromGit: ${filePath} fetch status ${status}`, status === 404 ? 'info' : 'warn');
            return { status: status, entries: (status === 404 ? [] : null) };
        }
        const j = await res.json();
        const b64 = j.content || '';
        let decoded = '';
        try { decoded = atob(b64); } catch (e) { dbg(`fetchDateFromGit decode error: ${e.message}`, 'error'); return false; }
        let arr = [];
        try { arr = JSON.parse(decoded || ''); if (!Array.isArray(arr)) arr = []; } catch (e) { dbg(`fetchDateFromGit JSON parse error: ${e.message}`, 'error'); arr = []; }
        // Tag entries with their source date
        arr = arr.map(e => ({ ...(e || {}), _sourceDate: dateStr }));
        // Record file SHA but do not mutate global entries (analytics should not overwrite tracker data)
        state.fileIndex = state.fileIndex || {};
        state.fileIndex[dateStr] = j.sha;
        dbg(`fetchDateFromGit: fetched ${arr.length} entries for ${dateStr} (returned, not merged)`, 'info');
        return { status: 200, entries: arr };
    } catch (e) {
        dbg(`fetchDateFromGit error: ${e && e.message ? e.message : String(e)}`, 'error');
        return { status: 0, entries: null };
    }
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
        const preActiveCount = existing.filter(en => !(en && en._meta === 'dailyWeight')).length;
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
            try { showNotification(`Wrote entry to ${filePath}`, 'write'); } catch (e) {}
            // If this was the first active entry for today, attempt to increment persisted streak
            try {
                if (dateStr === getTodayString() && preActiveCount === 0 && !(entry && entry._meta === 'dailyWeight')) {
                    incrementStreakOnAdd(dateStr).catch(err => dbg('incrementStreakOnAdd error: ' + (err && err.message), 'warn', err));
                }
            } catch (e) { /* ignore */ }
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
                try { showNotification(`Wrote ${groups[dateStr].length} entries to ${filePath}`, 'write'); } catch (e) {}
                // If we created the first active entries for today, trigger increment
                try {
                    const preActiveCount = existing.filter(en => !(en && en._meta === 'dailyWeight')).length;
                    const hasActiveNow = Array.isArray(finalArray) && finalArray.some(en => !(en && en._meta === 'dailyWeight'));
                    if (dateStr === getTodayString() && preActiveCount === 0 && hasActiveNow) {
                        incrementStreakOnAdd(dateStr).catch(err => dbg('incrementStreakOnAdd error: ' + (err && err.message), 'warn', err));
                    }
                } catch (e) { /* ignore */ }
            } else {
                let err = {};
                try { err = JSON.parse(putText); } catch (e) { err = { message: putText }; }
                dbg(`Failed to import to ${filePath}: ${err.message || putRes.statusText}`, 'error', err);
            }
        } catch (err) {
            dbg(`pushEntriesByDate error (${dateStr}): ${err.message}`, 'error');
        }
    }
    // Streak recompute intentionally disabled here; compute only via Settings actions.
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
        // Try to fetch existing file to get SHA and existing content
        let fileSha = null;
        let existing = [];
        let preActiveCount = 0;
        try {
            const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
            if (getRes.ok) {
                const j = await getRes.json();
                fileSha = j.sha;
                try { existing = JSON.parse(atob(j.content || '')); } catch (e) { existing = []; }
                if (!Array.isArray(existing)) existing = [];
                preActiveCount = existing.filter(en => !(en && en._meta === 'dailyWeight')).length;
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
            try { showNotification(`Saved ${filePath}`, 'write'); } catch (e) {}
            // If the file was previously empty of active entries and now contains at least one, increment streak
            try {
                const hasActiveNow = Array.isArray(finalArray) && finalArray.some(en => !(en && en._meta === 'dailyWeight'));
                if (dateStr === getTodayString() && preActiveCount === 0 && hasActiveNow) {
                    incrementStreakOnAdd(dateStr).catch(err => dbg('incrementStreakOnAdd error: ' + (err && err.message), 'warn', err));
                }
            } catch (e) { /* ignore */ }
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
            try { showNotification(`Deleted ${filePath}`, 'delete'); } catch (e) {}
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
    try { showNotification('Opening delete confirmation...', 'read'); } catch (e) {}
    const proceed = await showConfirm('Delete this entry?');
    if (!proceed) return;

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
                try { showNotification(`Deleted entry${removed && removed.food ? ': ' + removed.food : ''}`, 'delete'); } catch (e) {}
                closeConfirm();
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
                try { showNotification(`Deleted entry${removed && removed.food ? ': ' + removed.food : ''}`, 'delete'); } catch (e) {}
                closeConfirm();
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

// Application-level confirm dialog utilities
function showConfirm(message, title = 'Confirm', details = null) {
    return new Promise((resolve) => {
        try {
            const modal = document.getElementById('app-confirm-modal');
            const msgEl = document.getElementById('confirm-message');
            const detailsEl = document.getElementById('confirm-details');
            const titleEl = document.getElementById('confirm-title');
            const yesBtn = document.getElementById('confirm-yes');
            const noBtn = document.getElementById('confirm-no');
            if (!modal || !msgEl || !yesBtn || !noBtn) {
                // Fallback to browser confirm if modal missing
                resolve(window.confirm(message));
                return;
            }
            titleEl.textContent = title;
            msgEl.textContent = message;
            if (detailsEl) {
                if (details) {
                    detailsEl.innerHTML = details;
                    detailsEl.style.display = 'block';
                } else {
                    detailsEl.innerHTML = '';
                    detailsEl.style.display = 'none';
                }
            }
            modal.style.display = 'flex';
            // Reset button states
            yesBtn.disabled = false; yesBtn.textContent = 'Delete';
            noBtn.disabled = false;

            const cleanup = () => {
                yesBtn.removeEventListener('click', onYes);
                noBtn.removeEventListener('click', onNo);
            };

            const onYes = () => {
                // Keep modal visible and indicate pending state; caller will call closeConfirm()
                yesBtn.disabled = true;
                noBtn.disabled = true;
                yesBtn.textContent = 'Deleting...';
                cleanup();
                resolve(true);
            };

            const onNo = () => {
                cleanup();
                modal.style.display = 'none';
                if (detailsEl) { detailsEl.innerHTML = ''; detailsEl.style.display = 'none'; }
                resolve(false);
            };

            yesBtn.addEventListener('click', onYes);
            noBtn.addEventListener('click', onNo);
        } catch (e) {
            resolve(window.confirm(message));
        }
    });
}

function closeConfirm() {
    try {
        const modal = document.getElementById('app-confirm-modal');
        const yesBtn = document.getElementById('confirm-yes');
        const noBtn = document.getElementById('confirm-no');
        const detailsEl = document.getElementById('confirm-details');
        if (yesBtn) { yesBtn.disabled = false; yesBtn.textContent = 'Delete'; }
        if (noBtn) { noBtn.disabled = false; }
        if (detailsEl) { detailsEl.innerHTML = ''; detailsEl.style.display = 'none'; }
        if (modal) modal.style.display = 'none';
    } catch (e) { /* ignore */ }
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
    // If on the tracker page, only select today's visible entries.
    const activePage = document.querySelector('.page.active');
    if (state.selectedEntries.size === state.entries.length) {
        // All selected, deselect all
        state.selectedEntries.clear();
    } else if (activePage && activePage.id === 'page-tracker') {
        // Select only today's entries (visible in tracker)
        const today = getTodayString();
        state.entries.forEach((entry, index) => {
            if (getEntryDate(entry) === today) state.selectedEntries.add(index);
        });
    } else {
        // Select all entries across all dates
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
    // Convert to array and sort ascending to compute removals
    const indices = Array.from(state.selectedEntries).sort((a, b) => a - b);
    const toRemove = new Set(indices);

    // Build a details preview grouped by date for the confirm modal
    const previewByDate = {};
    for (const i of indices) {
        const e = state.entries[i];
        const d = getEntryDate(e) || 'Unknown';
        if (!previewByDate[d]) previewByDate[d] = [];
        previewByDate[d].push(e);
    }
    let detailsHtml = '<div style="display:flex; flex-direction:column; gap:8px;">';
    for (const d of Object.keys(previewByDate).sort().slice(0,50)) {
        const items = previewByDate[d];
        detailsHtml += `<div style="font-weight:600; margin-bottom:4px;">${d} (${items.length})</div><ul style="margin:0 0 8px 16px; padding:0; list-style:disc; max-height:120px; overflow:auto;">`;
        for (let j = 0; j < Math.min(items.length, 10); j++) {
            const f = items[j].food || '(no food)';
            detailsHtml += `<li>${escapeHtml(String(f))}</li>`;
        }
        if (items.length > 10) detailsHtml += `<li>...and ${items.length - 10} more</li>`;
        detailsHtml += '</ul>';
    }
    detailsHtml += '</div>';

    const proceed = await showConfirm(`Delete ${state.selectedEntries.size} selected entries?`, 'Confirm Delete', detailsHtml);
    if (!proceed) {
        return;
    }

    // Compute affected dates and remaining arrays WITHOUT mutating local state
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
        try { closeConfirm(); } catch (e) { /* ignore */ }
        dbg(`Bulk deleted ${indices.length} entries`, 'info');
    } catch (e) {
        dbg(`Bulk delete auto-save failed: ${e.message}`, 'error');
        try { closeConfirm(); } catch (ee) { /* ignore */ }
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
    // Add optional Health Score column
    headers.push('Health Score (1-10)');
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
        row.push(entry.healthScore || '');
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
            if (ok) {
                state.hasUnsavedChanges = false;
            }
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

    // ----------------------
    // Daily weight helpers
    // ----------------------

    function showEntryTab() {
        try {
            const fc = document.getElementById('form-container');
            const wc = document.getElementById('weight-container');
            const tabE = document.getElementById('form-tab-entry');
            const tabW = document.getElementById('form-tab-weight');
            if (fc) fc.style.display = 'grid';
            if (wc) wc.style.display = 'none';
            if (tabE) tabE.classList.add('active');
            if (tabW) tabW.classList.remove('active');
        } catch (e) { dbg(`showEntryTab error: ${e && e.message}`, 'error'); }
    }

    function showWeightTab() {
        try {
            const fc = document.getElementById('form-container');
            const wc = document.getElementById('weight-container');
            const tabE = document.getElementById('form-tab-entry');
            const tabW = document.getElementById('form-tab-weight');
            if (fc) fc.style.display = 'none';
            if (wc) wc.style.display = 'grid';
            if (tabE) tabE.classList.remove('active');
            if (tabW) tabW.classList.add('active');
            updateWeightTabUI(getTodayString());
        } catch (e) { dbg(`showWeightTab error: ${e && e.message}`, 'error'); }
    }

    function updateWeightTabUI(dateStr) {
        try {
            dbg(`updateWeightTabUI: refreshing UI for ${dateStr}`, 'debug');
            const w = findWeightInEntriesForDate(dateStr);
            const disp = document.getElementById('weight-saved-display');
            const input = document.getElementById('weight-input');
            const btn = document.getElementById('save-weight-btn');
            const editBtn = document.getElementById('edit-weight-btn');
            // If a weight exists for this date
            if (w !== null && w !== undefined) {
                dbg(`updateWeightTabUI: weight present ${w}`, 'debug');
                if (disp) disp.textContent = `${Number(w).toFixed(1)} kg`;
                // If currently in edit mode, allow updating
                if (state.weightEditMode) {
                    if (input) { input.value = Number(w).toFixed(1); input.disabled = false; }
                    if (btn) { btn.disabled = false; btn.textContent = 'Update'; }
                    if (editBtn) editBtn.style.display = 'none';
                } else {
                    if (input) { input.value = Number(w).toFixed(1); input.disabled = true; }
                    if (btn) { btn.disabled = true; btn.textContent = 'Save'; }
                    if (editBtn) editBtn.style.display = 'inline-block';
                }
            } else {
                dbg('updateWeightTabUI: no weight present for date', 'debug');
                if (disp) disp.textContent = '';
                if (input) { input.value = ''; input.disabled = false; }
                if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
                if (editBtn) editBtn.style.display = 'none';
            }
        } catch (e) { dbg(`updateWeightTabUI error: ${e && e.message}`, 'error'); }
    }

    function findWeightInEntriesForDate(dateStr) {
        try {
            for (const e of state.entries) {
                if (!e) continue;
                if (e._meta === 'dailyWeight') {
                    const d = getEntryDate(e) || e._sourceDate || e.date;
                    if (d === dateStr) {
                        const w = (e.weightKg !== undefined) ? Number(e.weightKg) : (e.weight !== undefined ? Number(e.weight) : NaN);
                        if (!isNaN(w)) {
                            dbg(`findWeightInEntriesForDate: found weight for ${dateStr} => ${w}`, 'debug');
                            return Math.round(w * 10) / 10;
                        }
                    }
                }
            }
        } catch (e) { dbg(`findWeightInEntriesForDate error: ${e && e.message}`, 'error'); }
        return null;
    }

    async function getDailyWeightForDate(dateStr) {
        try {
            dbg(`getDailyWeightForDate: checking local entries for ${dateStr}`, 'debug');
            const local = findWeightInEntriesForDate(dateStr);
            if (local !== null) { dbg(`getDailyWeightForDate: local hit ${dateStr} => ${local}`, 'debug'); return local; }
            dbg(`getDailyWeightForDate: local miss, fetching ${dateStr} from GitHub`, 'debug');
            const res = await fetchDateFromGit(dateStr);
            dbg(`getDailyWeightForDate: fetchDateFromGit status=${res && res.status}`, 'debug');
            if (res && res.status === 200 && Array.isArray(res.entries)) {
                for (const e of res.entries) {
                    if (e && e._meta === 'dailyWeight') {
                        const w = (e.weightKg !== undefined) ? Number(e.weightKg) : (e.weight !== undefined ? Number(e.weight) : NaN);
                        if (!isNaN(w)) { dbg(`getDailyWeightForDate: remote found ${dateStr} => ${w}`, 'debug'); return Math.round(w * 10) / 10; }
                    }
                }
            }
        } catch (e) { dbg(`getDailyWeightForDate error: ${e && e.message}`, 'error'); }
        return null;
    }

    async function handleSaveWeight() {
        try {
            const input = document.getElementById('weight-input');
            if (!input) return;
            const raw = parseFloat(input.value);
            if (!isFinite(raw)) { showNotification('Enter a valid numeric weight', 'error'); dbg('handleSaveWeight: invalid input=' + input.value, 'warn'); return; }
            const rounded = Math.round(raw * 10) / 10;
            dbg(`handleSaveWeight: input=${input.value} parsed=${raw} rounded=${rounded}`, 'info');
            const dateStr = getTodayString();
            const btn = document.getElementById('save-weight-btn');
            if (btn) btn.classList.add('loading');
            let res = null;
            if (state.weightEditMode) {
                dbg('handleSaveWeight: performing update (edit mode)', 'info');
                res = await updateDailyWeightForDate(dateStr, rounded);
            } else {
                res = await saveDailyWeightForDate(dateStr, rounded);
            }
            if (btn) btn.classList.remove('loading');
            if (res && res.ok) {
                if (res.action === 'removed') showNotification('Weight removed', 'write');
                else if (res.action === 'created' || res.action === 'updated') showNotification('Weight saved', 'write');
                else if (res.action === 'noop') showNotification('No weight change', 'info');
                dbg(`handleSaveWeight: result for ${dateStr} => ${rounded} action=${res.action}`, 'info');
                // exit edit mode after successful update/creation
                state.weightEditMode = false;
                try { updateWeightTabUI(dateStr); } catch (e) {}
            } else if (res && res.action === 'blocked') {
                // Already notified by helper
            } else {
                showNotification('Failed to save weight', 'error');
                dbg(`handleSaveWeight: saveDailyWeightForDate failed for ${dateStr}`, 'error');
            }
        } catch (e) { dbg(`handleSaveWeight error: ${e && e.message}`, 'error'); showNotification('Failed to save weight', 'error'); }
    }

    // Enable edit mode for the compact weight panel
    function enableWeightEdit() {
        try {
            const dateStr = getTodayString();
            dbg(`enableWeightEdit: enabling edit for ${dateStr}`, 'info');
            state.weightEditMode = true;
            updateWeightTabUI(dateStr);
            const input = document.getElementById('weight-input');
            if (input) { input.disabled = false; input.focus(); input.select(); }
        } catch (e) { dbg(`enableWeightEdit error: ${e && e.message}`, 'error'); }
    }

    // Toggle handler for settings checkbox: allow editing older weights
    async function toggleAllowEditWeights(checked) {
        try {
            // Update local config immediately so UI responds without delay
            setConfig('allowEditOlderWeights', !!checked);
            showNotification(checked ? 'Editing past weights enabled' : 'Editing past weights disabled', 'info');
            // Refresh history so buttons appear/disappear immediately
            try { renderHistory(); } catch (e) {}

            // Attempt to persist settings to repo if credentials are configured
            // Attempt to persist settings to repo if credentials are configured
            const token = localStorage.getItem('gt_token');
            const repo = localStorage.getItem('gt_repo');
            if (token && repo) {
                try {
                    const v = await validateRepoConnection();
                    if (!v.ok) {
                        showNotification(`Cannot persist to repo: ${v.message}`, 'error');
                        return;
                    }
                } catch (e) { /* continue to attempt save */ }
                const ok = await enqueueSettingsSave();
                if (ok) {
                    showNotification('Settings persisted to repository', 'write');
                } else {
                    showNotification('Failed to persist settings to repo — saved locally', 'error');
                }
            } else {
                // No credentials; inform the user that this is local-only
                showNotification('Saved locally. Configure GitHub to persist settings.', 'info');
            }
        } catch (e) { dbg(`toggleAllowEditWeights error: ${e && e.message}`, 'error'); }
    }

    // Toggle handler for settings checkbox: control full toasts vs compact dot
    async function toggleShowToasts(checked) {
        try {
            setConfig('showToasts', !!checked);
            // If enabling, show a full toast to confirm (forceFull ensures visibility)
            if (checked) showNotification('Notifications enabled', 'info', true);
            else showNotification('Notifications disabled', 'info');

            // Attempt to persist settings to repo if credentials are configured
            // Attempt to persist settings to repo if credentials are configured
            const token = localStorage.getItem('gt_token');
            const repo = localStorage.getItem('gt_repo');
            if (token && repo) {
                try {
                    const v = await validateRepoConnection();
                    if (!v.ok) {
                        showNotification(`Cannot persist to repo: ${v.message}`, 'error');
                        return;
                    }
                } catch (e) { /* continue to attempt save */ }
                const ok = await enqueueSettingsSave();
                if (ok) {
                    showNotification('Settings persisted to repository', 'write');
                } else {
                    showNotification('Failed to persist settings to repo — saved locally', 'error');
                }
            } else {
                showNotification('Saved locally. Configure GitHub to persist settings.', 'info');
            }
        } catch (e) { dbg(`toggleShowToasts error: ${e && e.message}`, 'error'); }
    }

    // Open the in-page weight edit modal for a given date
    function editWeightForDate(dateStr) {
        openWeightEditModal(dateStr);
    }

    async function openWeightEditModal(dateStr) {
        try {
            const today = getTodayString();
            if (dateStr !== today && !getConfig('allowEditOlderWeights')) {
                showNotification('Editing past weights is disabled in Settings', 'error');
                return;
            }
            const modal = document.getElementById('weight-edit-modal');
            const input = document.getElementById('weight-edit-input');
            if (!modal || !input) {
                showNotification('Edit modal not available', 'error');
                return;
            }
            // Prefer local value, fall back to remote
            let current = findWeightInEntriesForDate(dateStr);
            if (current === null || current === undefined) {
                current = await getDailyWeightForDate(dateStr);
            }
            // Allow opening the modal even if there's no recorded weight yet
            state.weightEditTargetDate = dateStr;
            if (current === null || current === undefined) {
                input.value = '';
            } else {
                input.value = Number(current).toFixed(1);
            }
            modal.style.display = 'flex';
            setTimeout(() => { try { input.focus(); input.select(); } catch (e) {} }, 50);
        } catch (e) {
            dbg(`openWeightEditModal error: ${e && e.message}`, 'error');
            showNotification('Error opening edit modal', 'error');
        }
    }

    function closeWeightEditModal() {
        try {
            const modal = document.getElementById('weight-edit-modal');
            const input = document.getElementById('weight-edit-input');
            if (modal) modal.style.display = 'none';
            if (input) input.value = '';
            state.weightEditTargetDate = null;
        } catch (e) { dbg(`closeWeightEditModal error: ${e && e.message}`, 'error'); }
    }

    async function saveWeightFromModal() {
        try {
            const input = document.getElementById('weight-edit-input');
            const saveBtn = document.getElementById('weight-edit-save');
            const dateStr = state.weightEditTargetDate || getTodayString();
            if (!input) return;
            const raw = parseFloat(input.value);
            if (!isFinite(raw)) { showNotification('Enter a valid numeric weight', 'error'); return; }
            const rounded = Math.round(raw * 10) / 10;
            if (saveBtn) saveBtn.classList.add('loading');
            const res = await updateDailyWeightForDate(dateStr, rounded);
            if (saveBtn) saveBtn.classList.remove('loading');
            if (res && res.ok) {
                if (res.action === 'removed') showNotification('Weight removed', 'write');
                else if (res.action === 'created' || res.action === 'updated') showNotification('Weight updated', 'write');
                else if (res.action === 'noop') showNotification('No weight change', 'info');
                closeWeightEditModal();
                try {
                    const modalOpen = document.getElementById('weight-modal')?.style.display === 'flex';
                    if (modalOpen && state.dateRangeStart && state.dateRangeEnd) renderWeightGraph(state.dateRangeStart, state.dateRangeEnd);
                } catch (e) {}
            } else if (res && res.action === 'blocked') {
                // blocked by settings; message already shown in helper
            } else {
                showNotification('Failed to update weight', 'error');
            }
        } catch (e) {
            dbg(`saveWeightFromModal error: ${e && e.message}`, 'error');
            showNotification('Failed to update weight', 'error');
            const saveBtn = document.getElementById('weight-edit-save');
            if (saveBtn) saveBtn.classList.remove('loading');
        }
    }

    // Create-only: double-check remote date file for existing dailyWeight before writing
    async function saveDailyWeightForDate(dateStr, weightKg) {
        // Enforce settings: disallow saving weights for past dates when disabled
        try {
            const today = getTodayString();
            if (dateStr !== today && !getConfig('allowEditOlderWeights')) {
                showNotification('Saving weight for past dates is disabled in Settings', 'error');
                dbg(`saveDailyWeightForDate blocked by settings for ${dateStr}`, 'info');
                return { ok: false, action: 'blocked' };
            }
        } catch (e) { dbg(`saveDailyWeightForDate pre-check error: ${e && e.message}`, 'error'); }
        try {
            const rounded = Math.round(Number(weightKg) * 10) / 10;
            dbg(`saveDailyWeightForDate: attempting save for ${dateStr} weightKg=${rounded}`, 'info');
            // If weight is zero, treat as removal request: delete any existing dailyWeight meta
            if (rounded === 0) {
                dbg(`saveDailyWeightForDate: zero weight detected; delegating to removal for ${dateStr}`, 'info');
                return await removeDailyWeightForDate(dateStr);
            }
            const res = await fetchDateFromGit(dateStr);
            dbg(`saveDailyWeightForDate: fetchDateFromGit returned status=${res && res.status}`, 'debug');
            if (!res || res.status === 0) {
                dbg('saveDailyWeightForDate: fetchDateFromGit returned no usable response; likely missing credentials or network error', 'error');
                showNotification('Cannot access GitHub (missing credentials or network error)', 'error');
                return { ok: false, action: 'error' };
            }
            if (res.status === 200 && Array.isArray(res.entries)) {
                const already = res.entries.some(x => x && x._meta === 'dailyWeight');
                dbg(`saveDailyWeightForDate: remote file entries=${res.entries.length} alreadyWeight=${already}`, 'debug');
                if (already) {
                    showNotification('Weight already recorded for this date', 'error');
                    updateWeightTabUI(dateStr);
                    return { ok: false, action: 'exists' };
                }
                const finalArray = res.entries.slice();
                const newMeta = { _meta: 'dailyWeight', weightKg: rounded, timestamp: new Date().toISOString(), date: dateStr };
                finalArray.push(newMeta);
                dbg('saveDailyWeightForDate: pushing updated file to repo', 'info');
                const ok = await pushDateFile(dateStr, finalArray);
                dbg(`saveDailyWeightForDate: pushDateFile result=${ok}`, ok ? 'info' : 'error');
                if (ok) {
                    // merge into local state (avoid duplicates)
                    state.entries = state.entries.filter(e => !(e && e._meta === 'dailyWeight' && getEntryDate(e) === dateStr));
                    state.entries.push({ ...newMeta, _sourceDate: dateStr });
                    render();
                    renderHistory();
                    updateWeightTabUI(dateStr);
                    return { ok: true, action: 'created' };
                }
                showNotification('Failed to save weight to repo', 'error');
                return { ok: false, action: 'error' };
            } else if (res.status === 404) {
                // no file exists; create new per-day file with just the meta
                const newMeta = { _meta: 'dailyWeight', weightKg: rounded, timestamp: new Date().toISOString(), date: dateStr };
                dbg('saveDailyWeightForDate: no remote file exists; creating new file with weight meta', 'info');
                const ok = await pushDateFile(dateStr, [newMeta]);
                dbg(`saveDailyWeightForDate: pushDateFile (create) result=${ok}`, ok ? 'info' : 'error');
                if (ok) {
                    state.entries = state.entries.filter(e => !(e && e._meta === 'dailyWeight' && getEntryDate(e) === dateStr));
                    state.entries.push({ ...newMeta, _sourceDate: dateStr });
                    render();
                    renderHistory();
                    updateWeightTabUI(dateStr);
                    return { ok: true, action: 'created' };
                }
                showNotification('Failed to create date file for weight', 'error');
                return { ok: false, action: 'error' };
            } else {
                dbg(`saveDailyWeightForDate: unexpected fetchDateFromGit status=${res.status}`, 'error');
                showNotification('Failed to verify remote date file', 'error');
                return { ok: false, action: 'error' };
            }
        } catch (e) {
            dbg(`saveDailyWeightForDate error: ${e && e.message}`, 'error');
            showNotification('Error while saving weight', 'error');
            return { ok: false, action: 'error' };
        }
    }

    // Remove dailyWeight meta from a date file (and delete file if empty)
    async function removeDailyWeightForDate(dateStr) {
        try {
            const today = getTodayString();
            if (dateStr !== today && !getConfig('allowEditOlderWeights')) {
                showNotification('Editing past weights is disabled in Settings', 'error');
                dbg(`removeDailyWeightForDate blocked by settings for ${dateStr}`, 'info');
                return { ok: false, action: 'blocked' };
            }
        } catch (e) { dbg(`removeDailyWeightForDate pre-check error: ${e && e.message}`, 'error'); }

        try {
            const res = await fetchDateFromGit(dateStr);
            if (!res || res.status === 0) {
                dbg('removeDailyWeightForDate: fetch failed; cannot remove', 'error');
                showNotification('Cannot access GitHub (missing credentials or network error)', 'error');
                return { ok: false, action: 'error' };
            }
            if (res.status === 200 && Array.isArray(res.entries)) {
                const entries = res.entries.slice();
                const idx = entries.findIndex(x => x && x._meta === 'dailyWeight');
                if (idx >= 0) {
                    entries.splice(idx, 1);
                    dbg(`removeDailyWeightForDate: removing dailyWeight at index ${idx} for ${dateStr}`, 'info');
                    const ok = await pushDateFile(dateStr, entries);
                    dbg(`removeDailyWeightForDate: pushDateFile result=${ok}`, ok ? 'info' : 'error');
                    if (ok) {
                        state.entries = state.entries.filter(e => !(e && e._meta === 'dailyWeight' && getEntryDate(e) === dateStr));
                        render(); renderHistory(); updateWeightTabUI(dateStr);
                        return { ok: true, action: 'removed' };
                    }
                    showNotification('Failed to remove weight from repo', 'error');
                    return { ok: false, action: 'error' };
                } else {
                    // No remote meta present; ensure local is cleaned
                    state.entries = state.entries.filter(e => !(e && e._meta === 'dailyWeight' && getEntryDate(e) === dateStr));
                    render(); renderHistory(); updateWeightTabUI(dateStr);
                    return { ok: true, action: 'noop' };
                }
            } else if (res.status === 404) {
                // Nothing remote; cleanup local state if any
                state.entries = state.entries.filter(e => !(e && e._meta === 'dailyWeight' && getEntryDate(e) === dateStr));
                render(); renderHistory(); updateWeightTabUI(dateStr);
                return { ok: true, action: 'noop' };
            } else {
                dbg(`removeDailyWeightForDate: unexpected status=${res && res.status}`, 'error');
                showNotification('Failed to verify remote date file', 'error');
                return { ok: false, action: 'error' };
            }
        } catch (err) {
            dbg(`removeDailyWeightForDate error: ${err && err.message}`, 'error');
            showNotification('Error while removing weight', 'error');
            return { ok: false, action: 'error' };
        }
    }

    // Update existing weight entry in the per-day file (edit flow)
    async function updateDailyWeightForDate(dateStr, weightKg) {
        // Enforce settings: disallow updating weights for past dates when disabled
        try {
            const today = getTodayString();
            if (dateStr !== today && !getConfig('allowEditOlderWeights')) {
                showNotification('Editing weight for past dates is disabled in Settings', 'error');
                dbg(`updateDailyWeightForDate blocked by settings for ${dateStr}`, 'info');
                return false;
            }
        } catch (e) { dbg(`updateDailyWeightForDate pre-check error: ${e && e.message}`, 'error'); }
        try {
            const rounded = Math.round(Number(weightKg) * 10) / 10;
            dbg(`updateDailyWeightForDate: attempting update for ${dateStr} weightKg=${rounded}`, 'info');
            // If weight is zero, treat as removal
            if (rounded === 0) {
                dbg(`updateDailyWeightForDate: zero weight detected; delegating to removal for ${dateStr}`, 'info');
                return await removeDailyWeightForDate(dateStr);
            }
            const res = await fetchDateFromGit(dateStr);
            dbg(`updateDailyWeightForDate: fetchDateFromGit status=${res && res.status}`, 'debug');
            if (!res || res.status === 0) {
                dbg('updateDailyWeightForDate: fetch failed; cannot update', 'error');
                showNotification('Cannot access GitHub (missing credentials or network error)', 'error');
                return { ok: false, action: 'error' };
            }
            const newMeta = { _meta: 'dailyWeight', weightKg: rounded, timestamp: new Date().toISOString(), date: dateStr };
            if (res.status === 200 && Array.isArray(res.entries)) {
                const entries = res.entries.slice();
                const idx = entries.findIndex(x => x && x._meta === 'dailyWeight');
                if (idx >= 0) {
                    entries[idx] = { ...entries[idx], ...newMeta };
                    dbg(`updateDailyWeightForDate: replacing remote meta at index ${idx}`, 'debug');
                } else {
                    dbg('updateDailyWeightForDate: no existing meta found remotely; appending new meta', 'warn');
                    entries.push(newMeta);
                }
                const ok = await pushDateFile(dateStr, entries);
                dbg(`updateDailyWeightForDate: pushDateFile result=${ok}`, ok ? 'info' : 'error');
                if (ok) {
                    // update local state
                    state.entries = state.entries.filter(e => !(e && e._meta === 'dailyWeight' && getEntryDate(e) === dateStr));
                    state.entries.push({ ...newMeta, _sourceDate: dateStr });
                    render(); renderHistory(); updateWeightTabUI(dateStr);
                    return { ok: true, action: (idx >= 0 ? 'updated' : 'created') };
                }
                showNotification('Failed to update weight on repo', 'error');
                return { ok: false, action: 'error' };
            } else if (res.status === 404) {
                // no file exists remotely; create one
                dbg('updateDailyWeightForDate: remote file missing; creating new file with updated meta', 'info');
                const ok = await pushDateFile(dateStr, [newMeta]);
                dbg(`updateDailyWeightForDate: pushDateFile (create) result=${ok}`, ok ? 'info' : 'error');
                if (ok) {
                    state.entries = state.entries.filter(e => !(e && e._meta === 'dailyWeight' && getEntryDate(e) === dateStr));
                    state.entries.push({ ...newMeta, _sourceDate: dateStr });
                    render(); renderHistory(); updateWeightTabUI(dateStr);
                    return { ok: true, action: 'created' };
                }
                showNotification('Failed to create date file for weight', 'error');
                return { ok: false, action: 'error' };
            } else {
                dbg(`updateDailyWeightForDate: unexpected fetch status=${res.status}`, 'error');
                showNotification('Failed to verify remote date file', 'error');
                return { ok: false, action: 'error' };
            }
        } catch (e) {
            dbg(`updateDailyWeightForDate error: ${e && e.message}`, 'error');
            showNotification('Error while updating weight', 'error');
            return { ok: false, action: 'error' };
        }
    }

    function openWeightModalForRange() {
        try {
            if (!state.dateRangeStart || !state.dateRangeEnd) { showNotification('Select a date range first', 'error'); return; }
            const modal = document.getElementById('weight-modal');
            if (!modal) return;
            modal.style.display = 'flex';
            // Render graph inside modal
            renderWeightGraph(state.dateRangeStart, state.dateRangeEnd);
        } catch (e) { dbg(`openWeightModalForRange error: ${e && e.message}`, 'error'); }
    }

    function closeWeightModal() {
        try {
            const modal = document.getElementById('weight-modal');
            if (modal) modal.style.display = 'none';
            if (typeof charts !== 'undefined' && charts && charts.weight) {
                try { charts.weight.destroy(); } catch (e) { /* ignore */ }
                delete charts.weight;
            }
        } catch (e) { dbg(`closeWeightModal error: ${e && e.message}`, 'error'); }
    }

    // Open Toggles popup (contains notification and weight toggles)
    function openTogglesPopup() {
        try {
            console.log('[openTogglesPopup] called');
            let modal = document.getElementById('toggles-modal');
            if (!modal) { console.warn('[openTogglesPopup] toggles-modal element not found'); return; }
            // If modal is not a direct child of body, move it to body to avoid stacking/overflow issues
            try {
                if (modal.parentElement !== document.body) {
                    document.body.appendChild(modal);
                    console.log('[openTogglesPopup] appended modal to document.body');
                }
            } catch (e) { console.warn('[openTogglesPopup] append to body failed', e); }

            // Ensure checkbox states reflect current config
            try { const t = document.getElementById('cfg-show-toasts'); if (t) t.checked = !!getConfig('showToasts'); } catch (e) { console.warn(e); }
            try { const w = document.getElementById('cfg-allow-edit-weights'); if (w) w.checked = !!getConfig('allowEditOlderWeights'); } catch (e) { console.warn(e); }

            // Force visible and on top
            modal.style.display = 'flex';
            modal.style.zIndex = '999999';
            modal.style.pointerEvents = 'auto';
            try { const focusable = modal.querySelector('input, button, [tabindex]'); if (focusable) focusable.focus(); } catch (e) {}
            console.log('[openTogglesPopup] modal displayed');
        } catch (e) { console.error('[openTogglesPopup] error', e); dbg(`openTogglesPopup error: ${e && e.message}`, 'error'); }
    }

    function closeTogglesPopup() {
        try {
            console.log('[closeTogglesPopup] called');
            const modal = document.getElementById('toggles-modal');
            if (modal) {
                modal.style.display = 'none';
            }
        } catch (e) { console.error('[closeTogglesPopup] error', e); dbg(`closeTogglesPopup error: ${e && e.message}`, 'error'); }
    }

    // Hard refresh the app: attempt to clear Cache Storage and reload with a cache-busting param
    async function hardRefreshApp() {
        try {
            const ok = confirm('Hard refresh will clear cached app resources (if possible) and reload from server. Continue?');
            if (!ok) return;
            try { showNotification('Clearing caches and reloading…', 'read'); } catch (e) {}
            // Close toggles UI to avoid visual artifacts
            try { closeTogglesPopup(); } catch (e) {}

            if ('caches' in window) {
                try {
                    const names = await caches.keys();
                    await Promise.all(names.map(n => caches.delete(n)));
                    dbg('Cleared Cache Storage entries', 'info');
                } catch (e) { dbg('Failed to clear Cache Storage: ' + (e && e.message), 'warn'); }
            } else {
                dbg('Cache Storage API not available in this browser', 'debug');
            }

            // Force navigation with a cache-busting query parameter
            try {
                const url = new URL(window.location.href);
                url.searchParams.set('_cachebust', Date.now().toString());
                // Use location.assign so history behaves like a normal navigation
                window.location.assign(url.toString());
            } catch (e) {
                // Fallback: use location.reload() if URL construction fails
                try { window.location.reload(); } catch (ex) { dbg('Reload fallback failed', 'error', ex); }
            }
        } catch (e) {
            dbg('hardRefreshApp failed: ' + (e && e.message), 'error', e);
            try { showNotification('Hard refresh failed', 'error', true); } catch (ex) {}
        }
    }

// Export toggle functions immediately to the global scope so inline handlers work
try {
    if (typeof openTogglesPopup === 'function') window.openTogglesPopup = openTogglesPopup;
    if (typeof closeTogglesPopup === 'function') window.closeTogglesPopup = closeTogglesPopup;
    if (typeof toggleShowToasts === 'function') window.toggleShowToasts = toggleShowToasts;
    if (typeof toggleAllowEditWeights === 'function') window.toggleAllowEditWeights = toggleAllowEditWeights;
    if (typeof hardRefreshApp === 'function') window.hardRefreshApp = hardRefreshApp;
} catch (e) { dbg('Export to window failed', 'debug', e); }

    async function renderWeightGraph(startDate, endDate) {
        try {
            dbg(`renderWeightGraph: start ${startDate} -> ${endDate}`, 'info');
            const canvas = document.getElementById('chart-weight-trend');
            if (!canvas) return;

            // Build inclusive date array
            const dates = [];
            let cur = new Date(startDate);
            const endD = new Date(endDate);
            while (cur <= endD) { dates.push(formatDateLocal(cur)); cur.setDate(cur.getDate() + 1); }

            const weights = await Promise.all(dates.map(d => getDailyWeightForDate(d)));

            if (typeof charts !== 'undefined' && charts && charts.weight) {
                try { charts.weight.destroy(); } catch (e) {}
                delete charts.weight;
            }

            // Stats
            const nonNull = weights.filter(w => w !== null && w !== undefined);
            const startW = nonNull.length > 0 ? nonNull[0] : null;
            const endW   = nonNull.length > 0 ? nonNull[nonNull.length - 1] : null;
            const avg    = nonNull.length > 0 ? nonNull.reduce((s, v) => s + v, 0) / nonNull.length : null;
            const delta  = (startW !== null && endW !== null) ? (endW - startW) : null;

            const fmtW = v => v !== null && v !== undefined ? `${Number(v).toFixed(1)} kg` : '—';
            const fmtD = v => v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + ' kg';
            const deltaColor = delta === null ? 'var(--text)' : delta > 0 ? '#ff3b30' : delta < 0 ? '#34c759' : 'var(--text)';

            const startEl = document.getElementById('weight-modal-start');
            const endEl   = document.getElementById('weight-modal-end');
            const deltaEl = document.getElementById('weight-modal-delta');
            const avgEl   = document.getElementById('weight-modal-avg');
            if (startEl) startEl.textContent = fmtW(startW);
            if (endEl)   endEl.textContent   = fmtW(endW);
            if (deltaEl) { deltaEl.textContent = fmtD(delta); deltaEl.style.color = deltaColor; }
            if (avgEl)   avgEl.textContent   = fmtW(avg);

            const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1c1c1e';
            const gridColor = 'rgba(128,128,128,0.08)';

            const ctx = canvas.getContext('2d');
            charts = charts || {};
            charts.weight = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: dates,
                    datasets: [{
                        label: 'Weight (kg)',
                        data: weights,
                        borderColor: '#007aff',
                        backgroundColor: 'rgba(0,122,255,0.08)',
                        fill: true,
                        tension: 0.4,
                        spanGaps: false,
                        pointRadius: 4,
                        pointHoverRadius: 7,
                        pointBackgroundColor: '#007aff',
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    scales: {
                        x: { ticks: { color: textColor, maxTicksLimit: 10 }, grid: { color: gridColor } },
                        y: { beginAtZero: false, ticks: { color: textColor }, title: { display: true, text: 'Weight (kg)', color: textColor }, grid: { color: gridColor } }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y ?? ''} kg` } }
                    }
                }
            });
        } catch (e) { dbg(`renderWeightGraph error: ${e && e.message}`, 'error'); }
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
            // If all requested dates are already present locally, notify once and skip network fetch
            if (hasAll) {
                try {
                    const key = targets.join(',');
                    if (!state.historyCacheNotified.has(key)) {
                        state.historyCacheNotified.add(key);
                        const entriesForTargets = state.entries.filter(e => targets.includes(getEntryDate(e)));
                        try { showNotification(`History: ${targets.length} date(s) served from local cache (${entriesForTargets.length} entries) — no GitHub fetch performed`, 'read'); } catch (e) {}
                    }
                } catch (e) { dbg(`history cache notification error: ${e && e.message ? e.message : String(e)}`, 'error'); }
                return false;
            }

            if (!hasAll) {
                const key = targets.join(',');
                if (!state.historyPrefetchAttempts.has(key)) {
                    state.historyPrefetchAttempts.add(key);
                    state.historyFetchInProgress = true;
                    // Compute missing dates early so we can provide immediate UI feedback
                    const missing = targets.filter(td => !state.entries.some(e => getEntryDate(e) === td));
                    try { document.body.__historyLoadingFlag = true; renderHistory(); } catch (e) {}
                    try { showNotification(`Fetching ${missing.length} date(s) from GitHub...`, 'read'); } catch (e) {}
                        // If only one date requested, fetch that single date file; otherwise
                        // fetch only the missing per-day files for the requested range in
                        // small chunks to avoid fetching the entire folder (which may be large).
                        if (targets.length === 1) {
                            const dateToFetch = missing[0] || targets[0];
                            dbg(`History requested date ${dateToFetch} not loaded; fetching single date file`, 'info');
                            fetchDateFromGit(dateToFetch).then(res => {
                                // Clear transient loading flag and update state
                                try { document.body.__historyLoadingFlag = false; } catch (e) {}
                                state.historyFetchInProgress = false;
                                if (res && res.status === 200 && Array.isArray(res.entries)) {
                                    // Merge entries for this date (avoid duplicates)
                                    const existingKeys = new Set(state.entries.map(e => JSON.stringify(e)));
                                    res.entries.forEach(en => { if (!existingKeys.has(JSON.stringify(en))) state.entries.push(en); });
                                    renderHistory();
                                } else if (res && res.status === 404) {
                                    dbg(`History: ${dateToFetch} not found on GitHub (404).`, 'info');
                                    renderHistory();
                                } else {
                                    dbg(`History single-date fetch returned status=${res && res.status}`, 'warn');
                                    // Full-folder fallback disabled by policy.
                                    if (!state.historyFetchFallbackAttempted) {
                                        state.historyFetchFallbackAttempted = true;
                                        dbg('History: full-folder fetch disabled by policy; aborting fallback', 'info');
                                        try { showNotification('History per-date fetch failed; full-folder fallback is disabled.', 'warn'); } catch (e) {}
                                        renderHistory();
                                    } else {
                                        renderHistory();
                                    }
                                }
                            }).catch(err => {
                                try { document.body.__historyLoadingFlag = false; } catch (e) {}
                                state.historyFetchInProgress = false;
                                dbg(`Failed to fetch single date file for history: ${err && err.message ? err.message : String(err)}`, 'error');
                                if (!state.historyFetchFallbackAttempted) {
                                    state.historyFetchFallbackAttempted = true;
                                    try { showNotification('History per-date fetch failed; full-folder fallback is disabled.', 'warn'); } catch (e) {}
                                    renderHistory();
                                } else {
                                    renderHistory();
                                }
                            });
                        } else {
                            dbg(`History requested dates [${targets.join(',')}] not loaded; fetching missing per-day files`, 'info');
                            // `missing` already computed above
                            const CHUNK = 5;
                            (async () => {
                                // Track how many files/entries we actually merged into local state
                                let filesFetched = 0;
                                let entriesFetched = 0;
                                try {
                                    for (let i = 0; i < missing.length; i += CHUNK) {
                                        const chunk = missing.slice(i, i + CHUNK);
                                        dbg(`Fetching chunk ${i / CHUNK + 1} for history: ${chunk.join(', ')}`, 'debug');
                                        const promises = chunk.map(async (dateStr) => {
                                            try {
                                                const res = await fetchDateFromGit(dateStr);
                                                if (res && res.status === 200 && Array.isArray(res.entries)) {
                                                    // Merge entries for this date (avoid duplicates) and count merged entries
                                                    const existingKeys = new Set(state.entries.map(e => JSON.stringify(e)));
                                                    let mergedCount = 0;
                                                    res.entries.forEach(en => {
                                                        try {
                                                            const key = JSON.stringify(en);
                                                            if (!existingKeys.has(key)) {
                                                                state.entries.push(en);
                                                                existingKeys.add(key);
                                                                mergedCount++;
                                                            }
                                                        } catch (e) {
                                                            // If stringify fails, still push to avoid data loss
                                                            state.entries.push(en);
                                                            mergedCount++;
                                                        }
                                                    });
                                                    // Record that we fetched a real file and how many entries were merged
                                                    return { date: dateStr, ok: true, status: res.status, entriesCount: mergedCount };
                                                } else if (res && res.status === 404) {
                                                    dbg(`History: ${dateStr} not found on GitHub (404).`, 'info');
                                                    return { date: dateStr, ok: true, status: 404, entriesCount: 0 };
                                                } else {
                                                    dbg(`fetchDateFromGit returned status ${res && res.status} for ${dateStr}`, 'warn');
                                                    return { date: dateStr, ok: false, status: res && res.status || 0, entriesCount: 0 };
                                                }
                                            } catch (err) {
                                                dbg(`Error fetching ${dateStr}: ${err && err.message}`, 'error');
                                                return { date: dateStr, ok: false, status: 0, entriesCount: 0 };
                                            }
                                        });
                                        const results = await Promise.all(promises);
                                        // Update counters from this chunk
                                        results.forEach(r => {
                                            if (r && r.ok && r.status === 200) {
                                                filesFetched += 1;
                                                entriesFetched += (r.entriesCount || 0);
                                            }
                                        });

                                        const anyFailed = results.some(r => !r.ok);
                                        if (anyFailed) {
                                            dbg('One or more per-date fetches failed; full-folder fallback disabled by policy', 'warn');
                                            if (!state.historyFetchFallbackAttempted) {
                                                state.historyFetchFallbackAttempted = true;
                                                try { showNotification('One or more per-day fetches failed; full-folder fallback is disabled.', 'warn'); } catch (e) {}
                                                break;
                                            }
                                        }
                                    }
                                } catch (err) {
                                    dbg(`Error during per-day fetch loop: ${err && err.message}`, 'error');
                                } finally {
                                    state.historyFetchInProgress = false;
                                    try {
                                        const cachedCount = Math.max(0, (targets ? targets.length : 0) - (missing ? missing.length : 0));
                                        if (cachedCount > 0) {
                                            showNotification(`Fetched ${filesFetched} files (${entriesFetched} entries); ${cachedCount} date(s) served from local cache`, 'read');
                                        } else {
                                            showNotification(`Fetched ${filesFetched} files (${entriesFetched} entries) for requested dates`, 'read');
                                        }
                                    } catch (e) {}
                                    try { document.body.__historyLoadingFlag = false; } catch (e) {}
                                    renderHistory();
                                }
                            })();
                        }
                    return true; // fetch kicked off
                } else {
                    dbg(`Already attempted prefetch for [${key}] — skipping additional fetch to avoid loop`, 'warn');
                }
            }
        }
    } catch (e) { dbg(`ensureHistoryPrefetchIfNeeded error: ${e && e.message ? e.message : String(e)}`, 'error'); }
    return false;
}
function buildHistoryStats(filtered) {
    console.warn('[buildHistoryStats] called, filtered.length=', filtered && filtered.length, 'first entry keys=', filtered && filtered[0] ? Object.keys(filtered[0]) : 'none');
    try {
        document.getElementById('history-total-entries').innerText = filtered.length;
        const totalCal = filtered.reduce((sum, e) => sum + (parseFloat(e.calories) || 0), 0);
        document.getElementById('history-total-calories').innerText = Math.round(totalCal);
        const uniqueDates = [...new Set(filtered.map(e => getEntryDate(e)).filter(Boolean))];
        const numDays = uniqueDates.length || 1;
        const avgPerDay = uniqueDates.length > 0 ? Math.round(totalCal / numDays) : 0;
        document.getElementById('history-avg-calories').innerText = avgPerDay;

        // Support multiple historical key formats for macros (e.g. protein_g, "Protein (g)").
        const resolveMacroValue = (entry, macroName) => {
            if (!entry || typeof entry !== 'object') return { value: 0, source: 'invalid-entry' };
            const aliasMap = {
                protein: ['protein', 'Protein', 'protein_g', 'protein(g)', 'protein (g)', 'Protein (g)'],
                carbs: ['carbs', 'Carbs', 'carbohydrates', 'carbohydrate', 'carbs_g', 'carbs(g)', 'carbs (g)', 'Carbs (g)'],
                fat: ['fat', 'Fat', 'fats', 'fat_g', 'fat(g)', 'fat (g)', 'Fat (g)']
            };

            const normalizeKey = (k) => String(k || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const parseNumeric = (v) => {
                if (v === undefined || v === null || v === '') return NaN;
                if (typeof v === 'number') return v;
                const m = String(v).match(/-?\d+(?:\.\d+)?/);
                return m ? parseFloat(m[0]) : NaN;
            };

            const aliases = aliasMap[macroName] || [macroName];
            for (const key of aliases) {
                if (entry[key] !== undefined && entry[key] !== null && entry[key] !== '') {
                    const v = parseNumeric(entry[key]);
                    if (!isNaN(v)) return { value: v, source: `direct:${key}` };
                }
            }

            // Fuzzy direct-key fallback (handles keys like "protein ", "Protein_g", etc.)
            const aliasNorm = aliases.map(normalizeKey);
            for (const [k, raw] of Object.entries(entry)) {
                const nk = normalizeKey(k);
                if (aliasNorm.some(a => nk === a || nk.includes(a) || a.includes(nk))) {
                    const v = parseNumeric(raw);
                    if (!isNaN(v)) return { value: v, source: `direct-fuzzy:${k}` };
                }
            }

            const nestedPools = [entry.macros, entry.macro, entry.nutrients];
            const poolNames = ['macros', 'macro', 'nutrients'];
            for (const pool of nestedPools) {
                if (!pool || typeof pool !== 'object') continue;
                const poolName = poolNames[nestedPools.indexOf(pool)] || 'nested';
                for (const key of aliases) {
                    if (pool[key] !== undefined && pool[key] !== null && pool[key] !== '') {
                        const v = parseNumeric(pool[key]);
                        if (!isNaN(v)) return { value: v, source: `nested:${poolName}.${key}` };
                    }
                }
                // Fuzzy nested-key fallback
                for (const [k, raw] of Object.entries(pool)) {
                    const nk = normalizeKey(k);
                    if (aliasNorm.some(a => nk === a || nk.includes(a) || a.includes(nk))) {
                        const v = parseNumeric(raw);
                        if (!isNaN(v)) return { value: v, source: `nested-fuzzy:${poolName}.${k}` };
                    }
                }
            }

            return { value: 0, source: 'missing' };
        };

        // Avg macros per day + debug source tracking
        let totalProtein = 0;
        let totalCarbs = 0;
        let totalFat = 0;
        const debugStats = {
            protein: { missing: 0, sources: {} },
            carbs: { missing: 0, sources: {} },
            fat: { missing: 0, sources: {} }
        };

        filtered.forEach((entry) => {
            const p = resolveMacroValue(entry, 'protein');
            const c = resolveMacroValue(entry, 'carbs');
            const f = resolveMacroValue(entry, 'fat');

            totalProtein += p.value;
            totalCarbs += c.value;
            totalFat += f.value;

            [
                ['protein', p],
                ['carbs', c],
                ['fat', f]
            ].forEach(([k, r]) => {
                if (r.source === 'missing') {
                    debugStats[k].missing += 1;
                } else {
                    debugStats[k].sources[r.source] = (debugStats[k].sources[r.source] || 0) + 1;
                }
            });
        });

        const elP = document.getElementById('history-avg-protein');
        const elC = document.getElementById('history-avg-carbs');
        const elF = document.getElementById('history-avg-fat');
        if (elP) elP.innerText = Math.round(totalProtein / numDays);
        if (elC) elC.innerText = Math.round(totalCarbs   / numDays);
        if (elF) elF.innerText = Math.round(totalFat     / numDays);

        dbg(
            `History macro avg: entries=${filtered.length} days=${numDays} totals(P/C/F)=${Math.round(totalProtein)}/${Math.round(totalCarbs)}/${Math.round(totalFat)} missing(P/C/F)=${debugStats.protein.missing}/${debugStats.carbs.missing}/${debugStats.fat.missing}`,
            'warn',
            {
                proteinSources: debugStats.protein.sources,
                carbsSources: debugStats.carbs.sources,
                fatSources: debugStats.fat.sources
            }
        );

        if (filtered.length > 0 && totalProtein === 0 && totalCarbs === 0 && totalFat === 0) {
            if (totalCal > 0) {
                dbg(
                    `History macro warning: calories are present (${Math.round(totalCal)}) but macros resolved to zero.`,
                    'warn'
                );
            }
            const sample = filtered.slice(0, 2).map((e) => ({
                keys: Object.keys(e || {}),
                direct: {
                    protein: e && e.protein,
                    carbs: e && e.carbs,
                    fat: e && e.fat,
                    protein_g: e && e.protein_g,
                    carbs_g: e && e.carbs_g,
                    fat_g: e && e.fat_g,
                    Protein_g: e && e['Protein (g)'],
                    Carbs_g: e && e['Carbs (g)'],
                    Fat_g: e && e['Fat (g)']
                },
                nestedKeys: {
                    macros: e && e.macros ? Object.keys(e.macros) : [],
                    macro: e && e.macro ? Object.keys(e.macro) : [],
                    nutrients: e && e.nutrients ? Object.keys(e.nutrients) : []
                }
            }));
            dbg('History macro values are all zero; sample entry structure for debugging', 'warn', sample);
            console.warn('[buildHistoryStats] macro zero — sample:', JSON.stringify(sample, null, 2));
        }
        console.warn('[buildHistoryStats] done — P/C/F=', Math.round(totalProtein), '/', Math.round(totalCarbs), '/', Math.round(totalFat));
    } catch (e) {
        console.error('[buildHistoryStats] EXCEPTION:', e);
        dbg(`buildHistoryStats error: ${e && e.message ? e.message : String(e)}`, 'error');
    }
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
    // Hide any previous transient loading state when rendering completes
    function hideHistoryLoading() {
        try {
            const ov = document.getElementById('history-loading-overlay');
            if (ov) ov.remove();
        } catch (e) { /* ignore */ }
    }

    // Ensure spinner keyframes exist
    function ensureSpinnerStyle() {
        if (document.getElementById('gt-spinner-style')) return;
        const s = document.createElement('style');
        s.id = 'gt-spinner-style';
        s.textContent = `@keyframes gt-spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`;
        document.head.appendChild(s);
    }

    // Show a translucent overlay with spinner inside the history container
    function showHistoryLoading() {
        try {
            const container = document.getElementById('history-container');
            if (!container) return;
            if (document.getElementById('history-loading-overlay')) return;
            ensureSpinnerStyle();
            const ov = document.createElement('div');
            ov.id = 'history-loading-overlay';
            ov.style.cssText = 'position: absolute; inset: 0; display:flex; align-items:center; justify-content:center; background: rgba(255,255,255,0.7); z-index: 1000; pointer-events: none;';
            const spinner = document.createElement('div');
            spinner.style.cssText = 'width:36px; height:36px; border-radius:50%; border:4px solid rgba(0,0,0,0.08); border-top:4px solid var(--primary); animation: gt-spin 1s linear infinite;';
            ov.appendChild(spinner);
            // Position overlay relative to container
            container.style.position = container.style.position || 'relative';
            container.appendChild(ov);
        } catch (e) { /* ignore */ }
    }

    // If a previous caller set a transient loading flag, show spinner now
    if (document.body.__historyLoadingFlag) showHistoryLoading();
    const container = document.getElementById('history-container');
    if (!container) return;

    // Sync date-range from UI controls so returning to the page reflects
    // the dropdown/input selection (prevents visual selection without state match).
    try {
        // Only sync the quick-range dropdown when the user is not actively
        // using the calendar picker — calendar selection should take precedence.
        if (!state.historyUsingCalendar) {
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
        }
    } catch (e) { dbg(`renderHistory sync error: ${e && e.message ? e.message : String(e)}`, 'error'); }

    // Kick off any needed prefetch for missing per-day files, but still
    // render the currently-loaded entries immediately so the user sees
    // the filtered results without waiting for network I/O.
    try { ensureHistoryPrefetchIfNeeded(); } catch (e) { dbg(`prefetch helper error: ${e && e.message}`, 'warn'); }

    const filtered = computeFilteredEntries();
    buildHistoryStats(filtered);

    container.innerHTML = '';
    // Small debug info to help verify which filter is active and how many
    // entries are displayed. This is intentionally minimal and useful while
    // developing; it can be removed later.
    try {
        const dbgId = 'history-debug-info';
        let dbgEl = document.getElementById(dbgId);
        if (!dbgEl) {
            dbgEl = document.createElement('div');
            dbgEl.id = dbgId;
            dbgEl.style.cssText = 'font-size:13px; color:var(--text-secondary); padding:6px 0;';
            container.appendChild(dbgEl);
        }
        dbgEl.textContent = `Filter: ${state.dateRangeStart || '-'} → ${state.dateRangeEnd || '-'} — showing ${0} entries (of ${state.entries.length})`;
    } catch (e) { /* ignore debug UI errors */ }
    if (filtered.length === 0) {
        container.innerHTML = '<div style="padding:20px; color:var(--text-secondary);">No entries found for the selected filters.</div>';
        try { const dbgEl = document.getElementById('history-debug-info'); if (dbgEl) dbgEl.textContent = `Filter: ${state.dateRangeStart || '-'} → ${state.dateRangeEnd || '-'} — showing 0 entries (of ${state.entries.length})`; } catch (e) {}
        return;
    }

    dbg(`Grouping ${filtered.length} entries by date`, 'debug');
    const groups = groupByDate(filtered);
    const sortedDates = Object.keys(groups).sort((a, b) => (new Date(b).getTime() - new Date(a).getTime()));
    dbg(`Found ${sortedDates.length} date groups`, 'info');

    const pageDates = buildPageControls(container, sortedDates);
    dbg(`Rendering history page ${state.historyPage} (dates on page: ${pageDates.join(', ')})`, 'debug');

    const isRangeView = state.dateRangeStart && state.dateRangeEnd && state.dateRangeStart !== state.dateRangeEnd;

    // Show / hide the View weight graph button when a multi-day range is active
    try {
        const viewBtn = document.getElementById('view-weight-graph-btn');
        if (viewBtn) {
            viewBtn.style.display = isRangeView ? 'inline-block' : 'none';
            viewBtn.disabled = !isRangeView;
        }
    } catch (e) { /* ignore DOM issues */ }

    // Render each date group on the page
    pageDates.forEach(dateStr => {
        const group = groups[dateStr] || [];
        // Exclude meta weight entries from the visible count
        const visibleCount = group.filter(e => !(e && e._meta === 'dailyWeight')).length;
        // Build a header row with optional 'Edit weight' action
        const headerWrap = document.createElement('div');
        headerWrap.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin: 12px 0 8px 0; gap:12px;';
        const left = document.createElement('div');
        left.style.cssText = 'font-weight:700;';
        let headerText = `${dateStr} (${visibleCount})`;
        // If a single-day view, append the day's weight if present
        let weightForDate = null;
        try {
            weightForDate = findWeightInEntriesForDate(dateStr);
            if (state.dateRangeStart === state.dateRangeEnd && state.dateRangeStart === dateStr) {
                headerText += weightForDate !== null && weightForDate !== undefined ? ` — ${Number(weightForDate).toFixed(1)} kg` : ` — No weight`;
            } else {
                if (weightForDate !== null && weightForDate !== undefined) headerText += ` — ${Number(weightForDate).toFixed(1)} kg`;
            }
        } catch (e) { /* ignore */ }
        left.textContent = headerText;
        headerWrap.appendChild(left);

        // Show 'Edit/Add weight' button when editing is allowed (even if no weight exists)
        try {
            const allowEdit = (dateStr === getTodayString()) || getConfig('allowEditOlderWeights');
            if (allowEdit) {
                const editBtn = document.createElement('button');
                editBtn.className = 'btn-secondary';
                editBtn.style.cssText = 'padding:8px 12px; min-width:96px; font-size:13px;';
                editBtn.textContent = (weightForDate !== null && weightForDate !== undefined) ? 'Edit weight' : 'Add weight';
                editBtn.addEventListener('click', (ev) => { ev.preventDefault(); editWeightForDate(dateStr); });
                // Fallback: ensure onclick also wired (helps environments where addEventListener may not attach)
                editBtn.onclick = function(ev) { ev && ev.preventDefault(); openWeightEditModal(dateStr); };
                headerWrap.appendChild(editBtn);
            }
        } catch (e) { /* ignore DOM issues */ }

        container.appendChild(headerWrap);

        group.sort((a, b) => {
            const ta = new Date(a.timestamp || (a.date + ' ' + (a.time || '00:00'))).getTime();
            const tb = new Date(b.timestamp || (b.date + ' ' + (b.time || '00:00'))).getTime();
            return tb - ta;
        });

        group.forEach(entry => {
            // Skip dailyWeight meta entries — they are rendered in the header only
            if (entry && entry._meta === 'dailyWeight') return;
            const globalIndex = state.entries.indexOf(entry);
            if (globalIndex === -1) dbg(`Warning: entry for date ${dateStr} not found in state.entries via indexOf — possible identity mismatch`, 'warn');
            const card = createEntryCard(entry, globalIndex, isRangeView, dateStr);
            container.appendChild(card);
        });
    });
    dbg('renderHistory complete', 'debug');
    try { const dbgEl = document.getElementById('history-debug-info'); if (dbgEl) dbgEl.textContent = `Filter: ${state.dateRangeStart || '-'} → ${state.dateRangeEnd || '-'} — showing ${filtered.length} entries (of ${state.entries.length})`; } catch (e) {}
    try { hideHistoryLoading(); document.body.__historyLoadingFlag = false; } catch (e) { /* ignore */ }
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

function computeFilteredEntries() {
    const foodFilter = document.getElementById('filter-food')?.value.toLowerCase();
    dbg(`computeFilteredEntries: totalEntries=${Array.isArray(state.entries) ? state.entries.length : 0} dateRangeStart=${state.dateRangeStart} dateRangeEnd=${state.dateRangeEnd} foodFilter=${foodFilter || 'none'}`, 'debug');

    let filtered = Array.isArray(state.entries) ? state.entries.slice() : [];

    if (state.dateRangeStart && state.dateRangeEnd) {
        if (state.dateRangeStart === state.dateRangeEnd) {
            filtered = filtered.filter(e => getEntryDate(e) === state.dateRangeStart);
        } else {
            filtered = filtered.filter(e => {
                const ed = getEntryDate(e);
                return ed && ed >= state.dateRangeStart && ed <= state.dateRangeEnd;
            });
        }
        // Additional debug: report how many entries fall into the requested
        // date range vs how many have unknown/mismatched dates. Helpful when
        // entries exist but aren't being matched due to date parsing differences.
        try {
            const total = (Array.isArray(state.entries) ? state.entries.length : 0);
            const matched = (Array.isArray(filtered) ? filtered.length : 0);
            const unknown = Array.isArray(state.entries) ? state.entries.reduce((acc, e) => acc + (getEntryDate(e) ? 0 : 1), 0) : 0;
            dbg(`computeFilteredEntries debug: total=${total} matched=${matched} unknownDates=${unknown}`, 'debug');
            // Also log a small sample of distinct dates present in entries
            const dateSet = new Set();
            if (Array.isArray(state.entries)) state.entries.forEach(e => { const d = getEntryDate(e); if (d) dateSet.add(d); });
            const sampleDates = Array.from(dateSet).sort().slice(0, 12).join(', ');
            dbg(`computeFilteredEntries distinctDatesSample: ${sampleDates}`, 'debug');
        } catch (e) { /* ignore debug errors */ }
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
    // Prefer a source-provided date (e.g., filename) when present
    if (entry._sourceDate && typeof entry._sourceDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry._sourceDate)) return entry._sourceDate;
    // Finally, fall back to timestamp-derived local date.
    if (entry.timestamp) {
        try {
            const d = new Date(entry.timestamp);
            if (!isNaN(d.getTime())) return formatDateLocal(d);
        } catch (e) { /* ignore */ }
    }
    return null;
}

// Helper: returns true if an entry corresponds to today's canonical date
function isTodayEntry(entry) {
    try {
        const d = getEntryDate(entry);
        return d === getTodayString();
    } catch (e) {
        return false;
    }
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

// ----------------------
// Streak helpers
// ----------------------
// Queue and debounce helpers for writing streak.json to repo
let __streakSaveQueue = [];
let __streakSaveInProgress = false;
let __streakSaveDebounceTimer = null;
const __STREAK_SAVE_DEBOUNCE_MS = 250;

function enqueueStreakSave() {
    return new Promise((resolve, reject) => {
        __streakSaveQueue.push({ resolve, reject });
        if (__streakSaveDebounceTimer) clearTimeout(__streakSaveDebounceTimer);
        __streakSaveDebounceTimer = setTimeout(() => { __processStreakSaveQueue(); }, __STREAK_SAVE_DEBOUNCE_MS);
    });
}

async function __processStreakSaveQueue() {
    if (__streakSaveInProgress) return;
    if (__streakSaveDebounceTimer) { clearTimeout(__streakSaveDebounceTimer); __streakSaveDebounceTimer = null; }
    if (__streakSaveQueue.length === 0) return;
    __streakSaveInProgress = true;
    try {
        // Persist a compact streak object (do NOT include activeDates array)
        const toPersist = {
            version: state.streak?.version || 1,
            currentStreak: state.streak?.currentStreak || 0,
            longestStreak: state.streak?.longestStreak || 0,
            lastActiveDate: state.streak?.lastActiveDate || null,
            updatedAt: state.streak?.updatedAt || new Date().toISOString()
        };
        const ok = await pushStreakFile(toPersist);
        while (__streakSaveQueue.length) {
            const { resolve } = __streakSaveQueue.shift();
            try { resolve(ok); } catch (e) { /* ignore */ }
        }
    } catch (err) {
        while (__streakSaveQueue.length) {
            const { reject } = __streakSaveQueue.shift();
            try { reject(err); } catch (e) { /* ignore */ }
        }
    } finally {
        __streakSaveInProgress = false;
    }
}

// Compute streak information from state.entries
function computeStreakFromEntries() {
    const activeDatesSet = new Set();
    try {
        (Array.isArray(state.entries) ? state.entries : []).forEach(e => {
            if (!e) return;
            if (e._meta === 'dailyWeight') return;
            const d = getEntryDate(e);
            if (d) activeDatesSet.add(d);
        });
    } catch (e) { dbg('computeStreakFromEntries: build activeDates error: ' + (e && e.message), 'error', e); }

    const activeDates = Array.from(activeDatesSet).sort(); // ascending
    if (activeDates.length === 0) {
        return { currentStreak: 0, longestStreak: state.streak?.longestStreak || 0, lastActiveDate: null, computedAt: new Date().toISOString(), activeDates: [] };
    }

    const lastActiveDate = activeDates[activeDates.length - 1];

    // Compute current streak as consecutive days up to TODAY only.
    let currentStreak = 0;
    try {
        let cur = new Date(getTodayString());
        while (true) {
            const s = formatDateLocal(cur);
            if (activeDatesSet.has(s)) {
                currentStreak++;
                cur.setDate(cur.getDate() - 1);
            } else break;
        }
    } catch (e) { dbg('computeStreakFromEntries: consecutive run (today-based) error: ' + (e && e.message), 'error', e); }

    // Compute longest streak across history
    let longest = 0;
    let run = 0;
    for (let i = 0; i < activeDates.length; i++) {
        if (i === 0) { run = 1; } else {
            const prev = new Date(activeDates[i - 1]);
            const cur = new Date(activeDates[i]);
            const diff = Math.round((cur - prev) / (24 * 3600 * 1000));
            if (diff === 1) run++; else { longest = Math.max(longest, run); run = 1; }
        }
    }
    longest = Math.max(longest, run, state.streak?.longestStreak || 0);

    return { currentStreak, longestStreak: longest, lastActiveDate, computedAt: new Date().toISOString(), activeDates };
}

// Compute streak, cache locally and enqueue remote save when possible
async function computeAndEnqueueStreakSave() {
    try {
        const newObj = computeStreakFromEntries();
        state.streak = Object.assign({}, state.streak || {}, newObj);
        try { localStorage.setItem('streak_cache', JSON.stringify(state.streak)); } catch (e) {}
        // Update UI immediately when recomputed
        try { updateStreakUI(); } catch (e) { dbg('updateStreakUI failed after compute', 'warn', e); }
        const token = localStorage.getItem('gt_token');
        const repo = localStorage.getItem('gt_repo');
        if (token && repo) {
            enqueueStreakSave().then(ok => { if (ok) dbg('Streak persisted to repo', 'info'); }).catch(err => { dbg('Streak save failed: ' + (err && err.message), 'error', err); });
        } else {
            dbg('Streak cached locally (no GitHub credentials)', 'info');
        }
    } catch (e) { dbg('computeAndEnqueueStreakSave error: ' + (e && e.message), 'error', e); }
}

// Push streak file (streak.json) to repo using SHA-aware PUT with retry-on-409
async function pushStreakFile(streakObj) {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) { dbg('pushStreakFile: missing credentials', 'warn'); return false; }
    const dataFolder = getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/streak.json`;
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

    // Try to fetch existing sha
    let fileSha = null;
    try {
        const getRes = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (getRes.ok) {
            const j = await getRes.json(); fileSha = j.sha;
        }
    } catch (e) { /* ignore */ }

    const body = { message: `Update streak: ${new Date().toISOString()}`, content: btoa(unescape(encodeURIComponent(JSON.stringify(streakObj, null, 2)))) };
    if (fileSha) body.sha = fileSha;

    try {
        let putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (putRes.ok) {
            const resj = await putRes.json(); state.fileIndex = state.fileIndex || {}; state.fileIndex['streak'] = resj.content?.sha; try { showNotification('Streak persisted to repo', 'write'); } catch (e) {}
            return true;
        }
        if (putRes.status === 409) {
            dbg('pushStreakFile: conflict (409), retrying with refreshed sha', 'warn');
            try {
                const refresh = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
                if (refresh.ok) {
                    const rj = await refresh.json(); body.sha = rj.sha;
                    putRes = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                    if (putRes.ok) {
                        const resj = await putRes.json(); state.fileIndex = state.fileIndex || {}; state.fileIndex['streak'] = resj.content?.sha; try { showNotification('Streak persisted to repo (after retry)', 'write'); } catch (e) {}
                        return true;
                    }
                }
            } catch (e) { dbg('pushStreakFile retry error: ' + (e && e.message), 'error', e); }
        }
        const txt = await putRes.text().catch(() => ''); dbg('pushStreakFile failed: ' + (txt || putRes.statusText), 'error', txt); return false;
    } catch (e) { dbg('pushStreakFile error: ' + (e && e.message), 'error', e); return false; }
}

// Incremental helper: when today's first active entry is created, update streak.json compactly.
async function incrementStreakOnAdd(dateStr) {
    try {
        // Respect settings toggle
        if (!getConfig('autoIncrementStreakOnAdd')) {
            dbg('incrementStreakOnAdd: auto-increment disabled by config', 'debug');
            return false;
        }
        const today = getTodayString();
        if (dateStr !== today) return false;

        // Check yesterday's activity (presence of any non-weight entry)
        function prevDate(ds) {
            const d = new Date(ds);
            d.setDate(d.getDate() - 1);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }
        const yesterday = prevDate(dateStr);
        let yesterdayHasActive = false;
        try {
            const y = await fetchDateFromGit(yesterday);
            if (y && y.status === 200 && Array.isArray(y.entries)) {
                yesterdayHasActive = y.entries.some(en => !(en && en._meta === 'dailyWeight'));
            }
        } catch (e) { dbg('incrementStreakOnAdd: failed to fetch yesterday: ' + (e && e.message), 'warn', e); }

        // Load existing persisted streak (prefer remote, fallback to cache)
        let remote = { currentStreak: 0, longestStreak: 0, lastActiveDate: null };
        const token = localStorage.getItem('gt_token');
        const repo = localStorage.getItem('gt_repo');
        const dataFolder = getConfig('dataFolder') || 'data';
        const filePath = `${dataFolder}/streak.json`;
        const url = token && repo ? `https://api.github.com/repos/${repo}/contents/${filePath}` : null;

        if (token && repo && url) {
            try {
                const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
                if (res.ok) {
                    const j = await res.json();
                    try { remote = JSON.parse(decodeURIComponent(escape(atob(j.content||'')))); } catch (e) { remote = remote; }
                } else {
                    // treat missing as fresh
                    remote = remote;
                }
            } catch (e) { dbg('incrementStreakOnAdd: failed to fetch streak.json: ' + (e && e.message), 'warn'); }
        } else {
            try { const raw = localStorage.getItem('streak_cache'); if (raw) remote = JSON.parse(raw); } catch (e) { /* ignore */ }
        }

        // Prevent double-counting same day
        if (remote && remote.lastActiveDate === dateStr) {
            dbg('incrementStreakOnAdd: already counted today', 'debug');
            return false;
        }

        const prevCount = parseInt(remote.currentStreak || 0, 10) || 0;
        const newCurrent = yesterdayHasActive ? (prevCount + 1) : 1;
        const newLongest = Math.max(parseInt(remote.longestStreak || 0, 10) || 0, newCurrent);
        const newObj = { version: 1, currentStreak: newCurrent, longestStreak: newLongest, lastActiveDate: dateStr, updatedAt: new Date().toISOString() };

        // Try to persist via pushStreakFile (handles SHA and retry)
        try {
            const ok = await pushStreakFile(newObj);
            state.streak = Object.assign({}, state.streak || {}, newObj);
            try { localStorage.setItem('streak_cache', JSON.stringify(state.streak)); } catch (e) {}
            try { updateStreakUI(); } catch (e) {}
            showNotification(ok ? `Current streak ${newCurrent}d` : `Current streak ${newCurrent}d (cached)`, ok ? 'write' : 'warn');
            return ok;
        } catch (e) {
            dbg('incrementStreakOnAdd: pushStreakFile failed: ' + (e && e.message), 'warn', e);
            // Fallback: persist locally
            state.streak = Object.assign({}, state.streak || {}, newObj);
            try { localStorage.setItem('streak_cache', JSON.stringify(state.streak)); } catch (e) {}
            try { updateStreakUI(); } catch (e) {}
            showNotification(`Current streak ${newCurrent}d (cached locally)`, 'warn');
            return false;
        }
    } catch (e) {
        dbg('incrementStreakOnAdd error: ' + (e && e.message), 'error', e);
        return false;
    }
}

// Load streak from repo (if creds present) or from local cache
async function loadStreakFromRepoOrCache() {
    state.streak = state.streak || { currentStreak: 0, longestStreak: 0, lastActiveDate: null, computedAt: null, activeDates: [] };
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    const dataFolder = getConfig('dataFolder') || 'data';
    const filePath = `${dataFolder}/streak.json`;
    const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;
    if (token && repo) {
        try {
            const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
            if (res.ok) {
                const j = await res.json(); if (j && j.content) {
                    const decoded = decodeURIComponent(escape(atob(j.content))); try { const obj = JSON.parse(decoded); state.streak = Object.assign({}, state.streak || {}, obj); state.fileIndex = state.fileIndex || {}; state.fileIndex['streak'] = j.sha; dbg('Loaded streak from repo', 'info'); return true; } catch (e) { dbg('Failed to parse streak.json from repo: ' + (e && e.message), 'warn'); }
                }
            } else { dbg('streak.json not found in repo (or inaccessible)', 'debug'); }
        } catch (e) { dbg('loadStreakFromRepo error: ' + (e && e.message), 'warn', e); }
    }
    // fallback to local cache
    try {
        const raw = localStorage.getItem('streak_cache'); if (raw) { const obj = JSON.parse(raw); if (obj) { state.streak = Object.assign({}, state.streak || {}, obj); dbg('Loaded streak from localStorage cache', 'info'); return true; } }
    } catch (e) { dbg('Local streak cache parse error: ' + (e && e.message), 'warn'); }
    return false;
}

// ----------------------
// Settings-driven streak compute helpers (sequential fetch + progress UI)
// These functions perform single-file, sequential network fetches and update
// a small progress UI in Settings. All streak calculations must be triggered
// explicitly via these actions — no automatic recompute occurs elsewhere.
// ----------------------

function _streakProgressShow() {
    try {
        const c = document.getElementById('streak-progress-container');
        const f = document.getElementById('streak-progress-fill');
        const t = document.getElementById('streak-progress-text');
        if (c) c.style.display = 'block';
        if (f) f.style.width = '0%';
        if (t) t.textContent = 'Starting...';
    } catch (e) { dbg('streakProgressShow error: ' + (e && e.message), 'warn'); }
}

function _streakProgressUpdate(done, total, currentDate) {
    try {
        const f = document.getElementById('streak-progress-fill');
        const t = document.getElementById('streak-progress-text');
        if (f && typeof done === 'number' && typeof total === 'number' && total > 0) {
            f.style.width = Math.round((done / total) * 100) + '%';
        }
        if (t) t.textContent = `${done}/${total}${currentDate ? ' — ' + currentDate : ''}`;
    } catch (e) { dbg('streakProgressUpdate error: ' + (e && e.message), 'warn'); }
}

function _streakProgressHide() {
    try {
        const c = document.getElementById('streak-progress-container');
        const f = document.getElementById('streak-progress-fill');
        const t = document.getElementById('streak-progress-text');
        if (f) f.style.width = '0%';
        if (t) t.textContent = '';
        if (c) setTimeout(() => { try { c.style.display = 'none'; } catch (e) {} }, 600);
    } catch (e) { dbg('streakProgressHide error: ' + (e && e.message), 'warn'); }
}

async function computeLongestStreakFullScanUI() {
    try {
        await computeLongestStreakFullScan();
    } catch (e) {
        dbg('computeLongestStreakFullScanUI error: ' + (e && e.message), 'error', e);
        showNotification('Failed to compute longest streak', 'error');
    }
}

async function computeLongestStreakFullScan() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) {
        showNotification('Missing GitHub credentials; configure in Settings first', 'error');
        showPage('settings');
        return false;
    }
    const dataFolder = getConfig('dataFolder') || 'data';
    const listUrl = `https://api.github.com/repos/${repo}/contents/${dataFolder}`;
    _streakProgressShow();
    const computeBtn = document.getElementById('compute-longest-btn');
    const currentBtn = document.getElementById('compute-current-btn');
    if (computeBtn) computeBtn.disabled = true;
    if (currentBtn) currentBtn.disabled = true;

    try {
        const res = await fetch(listUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            dbg('computeLongestStreakFullScan: failed to list folder: ' + (txt || res.statusText), 'error');
            showNotification('Failed to list data folder', 'error');
            _streakProgressHide();
            if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
            return false;
        }

        const items = await res.json();
        const dateItems = (items || []).filter(it => it && it.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(it.name)).sort((a, b) => a.name.localeCompare(b.name));

        // Prefer scanning the most-recent N days (config `fetchDays`) as a stable window.
        // If the folder listing is unexpectedly small, fall back to generating the last
        // `fetchDays` dates and attempt to fetch each date explicitly. This makes the
        // longest-streak full scan cover the same recent range the current-streak
        // compute traverses and avoids surprises from partial/limited directory listings.
        const limitDays = parseInt(getConfig('fetchDays') || 90, 10) || 90;
        let datesToCheck = [];
        if (dateItems && dateItems.length >= limitDays) {
            // We have at least `limitDays` files listed; take the newest `limitDays`.
            const newest = dateItems.slice(Math.max(0, dateItems.length - limitDays));
            datesToCheck = newest.map(it => it.name.replace('.json', '')).sort();
        } else {
            // Fallback: generate the last `limitDays` calendar dates (oldest->newest)
            const today = getTodayString();
            for (let i = limitDays - 1; i >= 0; i--) {
                datesToCheck.push(addDaysToDateString(today, -i));
            }
        }

        const total = datesToCheck.length;
        if (total === 0) {
            showNotification('No per-day files found in data folder', 'info');
            _streakProgressHide();
            if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
            return false;
        }

        const activeDates = [];
        const CHUNK = 5;
        for (let i = 0; i < total; i += CHUNK) {
            const chunk = datesToCheck.slice(i, i + CHUNK);
            const promises = chunk.map(async (dateStr, idx) => {
                const processedIndex = i + idx + 1;
                _streakProgressUpdate(processedIndex, total, dateStr);
                try {
                    const r = await fetchDateFromGit(dateStr);
                    if (r && r.status === 200 && Array.isArray(r.entries)) {
                        const hasActive = r.entries.some(en => !(en && en._meta === 'dailyWeight'));
                        if (hasActive) activeDates.push(dateStr);
                    }
                } catch (e) {
                    dbg('computeLongestStreakFullScan: fetchDateFromGit error for ' + dateStr + ' : ' + (e && e.message), 'warn', e);
                }
            });
            await Promise.all(promises);
        }

        // Compute longest consecutive run from activeDates (ascending)
        activeDates.sort();
        let longest = 0;
        let longestStart = null;
        let longestEnd = null;
        let run = 0;
        let runStart = null;
        for (let i = 0; i < activeDates.length; i++) {
            if (i === 0) {
                run = 1;
                runStart = activeDates[0];
            } else {
                const prev = new Date(activeDates[i - 1]);
                const cur = new Date(activeDates[i]);
                const diff = Math.round((cur - prev) / (24 * 3600 * 1000));
                if (diff === 1) {
                    run++;
                } else {
                    if (run > longest) {
                        longest = run;
                        longestStart = runStart;
                        longestEnd = activeDates[i - 1];
                    }
                    run = 1;
                    runStart = activeDates[i];
                }
            }
        }
        // Finalize last-run check
        if (run > longest) {
            longest = run;
            longestStart = runStart;
            longestEnd = activeDates.length ? activeDates[activeDates.length - 1] : runStart;
        }

        // Respect previously persisted longest streak if it's larger, but validate dates
        const persistedLongest = state.streak?.longestStreak || 0;
        let finalLongest = longest;
        let finalLongestStart = longestStart;
        let finalLongestEnd = longestEnd;

        // Helper: inclusive length between two YYYY-MM-DD strings
        function dateRangeLengthInclusive(a, b) {
            try {
                const sa = new Date(a);
                const sb = new Date(b);
                const diff = Math.round((sb - sa) / (24 * 3600 * 1000)) + 1;
                return diff > 0 ? diff : 0;
            } catch (e) { return 0; }
        }

        if (persistedLongest > finalLongest && state.streak?.longestStartDate && state.streak?.longestEndDate) {
            // Prefer persisted date range but compute its actual length to ensure consistency
            const len = dateRangeLengthInclusive(state.streak.longestStartDate, state.streak.longestEndDate);
            if (len > 0) {
                finalLongest = len;
                finalLongestStart = state.streak.longestStartDate;
                finalLongestEnd = state.streak.longestEndDate;
            } else {
                // Fallback to computed values if persisted dates are invalid
                finalLongest = longest;
            }
        } else {
            // If we have computed start/end, ensure numeric longest matches the date range
            if (finalLongestStart && finalLongestEnd) {
                const len = dateRangeLengthInclusive(finalLongestStart, finalLongestEnd);
                if (len > 0) finalLongest = len;
            }
        }

        const lastActiveDate = activeDates.length ? activeDates[activeDates.length - 1] : null;

        // Prepare small persisted object (do NOT include large arrays like activeDates)
        const persistObj = Object.assign({}, state.streak || {}, {
            currentStreak: state.streak?.currentStreak || 0,
            longestStreak: finalLongest,
            longestStartDate: finalLongestStart || null,
            longestEndDate: finalLongestEnd || null,
            lastActiveDate: lastActiveDate,
            computedAt: new Date().toISOString()
        });
        try { localStorage.setItem('streak_cache', JSON.stringify(persistObj)); } catch (e) {}
        // Keep an in-memory list of recent active dates for the UI (not persisted)
        state.streak = Object.assign({}, state.streak || {}, persistObj, { recentActiveDates: activeDates.slice(-90) });
        const ok = await pushStreakFile(persistObj);
        try { updateStreakUI(); } catch (e) {}
        _streakProgressHide();
        if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
        showNotification(ok ? 'Longest streak computed and persisted' : 'Longest streak computed (failed to persist)', ok ? 'write' : 'warn');
        return ok;
    } catch (e) {
        dbg('computeLongestStreakFullScan error: ' + (e && e.message), 'error', e);
        showNotification('Error computing longest streak', 'error');
        _streakProgressHide();
        if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
        return false;
    }
}

async function computeCurrentStreakUI() {
    try {
        await computeCurrentStreakSequential();
    } catch (e) {
        dbg('computeCurrentStreakUI error: ' + (e && e.message), 'error', e);
        showNotification('Failed to compute current streak', 'error');
    }
}

async function computeCurrentStreakSequential() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) { showNotification('Missing GitHub credentials; configure in Settings first', 'error'); showPage('settings'); return false; }
    const dataFolder = getConfig('dataFolder') || 'data';
    const listUrl = `https://api.github.com/repos/${repo}/contents/${dataFolder}`;
    const computeBtn = document.getElementById('compute-longest-btn');
    const currentBtn = document.getElementById('compute-current-btn');
    if (computeBtn) computeBtn.disabled = true;
    if (currentBtn) currentBtn.disabled = true;
    _streakProgressShow();

    try {
        const res = await fetch(listUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (!res.ok) { showNotification('Failed to list data folder for current-streak compute', 'error'); _streakProgressHide(); if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false; return false; }
        const items = await res.json();
        const existingDates = (items || []).filter(it => it && it.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(it.name)).map(it => it.name.replace('.json',''));
        if (existingDates.length === 0) { showNotification('No per-day files found', 'info'); _streakProgressHide(); if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false; return false; }

        // Build a set of available date filenames for fast membership checks
        const dateSet = new Set(existingDates);
        existingDates.sort(); // ascending (oldest -> newest)
        const earliest = existingDates[0];
        const today = getTodayString();
        // Compute total days to scan (cap to avoid extremely long progress bars)
        const capDays = 365;
        let totalDays = Math.round((new Date(today) - new Date(earliest)) / (24 * 3600 * 1000)) + 1;
        if (!totalDays || totalDays <= 0) totalDays = existingDates.length;
        if (totalDays > capDays) totalDays = capDays;

        let processed = 0;
        let count = 0;
        let lastActive = null;

        function prevDateStr(ds) {
            const d = new Date(ds);
            d.setDate(d.getDate() - 1);
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            return `${yyyy}-${mm}-${dd}`;
        }

        // Walk backwards day-by-day from today; stop on first missing or empty day
        let cursor = today;
        for (let i = 0; i < totalDays; i++) {
            processed++;
            _streakProgressUpdate(processed, totalDays, cursor);
            // Missing per-day file counts as a break
            if (!dateSet.has(cursor)) {
                break;
            }
            try {
                const r = await fetchDateFromGit(cursor);
                if (r && r.status === 200 && Array.isArray(r.entries)) {
                    const hasActive = r.entries.some(en => !(en && en._meta === 'dailyWeight'));
                    if (hasActive) { count++; if (!lastActive) lastActive = cursor; cursor = prevDateStr(cursor); continue; }
                }
                // Empty or non-active day -> break the streak
                break;
            } catch (e) {
                dbg('computeCurrentStreakSequential: fetchDateFromGit error for ' + cursor + ' : ' + (e && e.message), 'warn', e);
                break;
            }
        }

        // Update streak state
        const currentEnd = lastActive || null;
        let currentStart = null;
        if (currentEnd && count > 0) {
            // Derive start from end and count (inclusive)
            currentStart = addDaysToDateString(currentEnd, -(count - 1));
        }

        // Prepare small persisted object (exclude large arrays)
        const persistObj = Object.assign({}, state.streak || {}, {
            currentStreak: count,
            currentStartDate: currentStart,
            currentEndDate: currentEnd,
            lastActiveDate: currentEnd,
            computedAt: new Date().toISOString()
        });

        // If current exceeds stored longest, update longest fields as well
        const prevLongest = state.streak?.longestStreak || 0;
        if (count > prevLongest) {
            persistObj.longestStreak = count;
            persistObj.longestStartDate = currentStart;
            persistObj.longestEndDate = currentEnd;
        }

        try { localStorage.setItem('streak_cache', JSON.stringify(persistObj)); } catch (e) {}
        // Keep a short in-memory list of the current run's dates for the UI
        const runDates = (currentStart && currentEnd) ? (function() {
            const arr = [];
            let d = new Date(currentStart);
            const e = new Date(currentEnd);
            while (d <= e) {
                arr.push(formatDateLocal(d));
                d.setDate(d.getDate() + 1);
            }
            return arr;
        })() : [];
        state.streak = Object.assign({}, state.streak || {}, persistObj, { recentActiveDates: runDates.slice(-90) });
        const ok = await pushStreakFile(persistObj);
        try { updateStreakUI(); } catch (e) {}
        _streakProgressHide();
        if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
        showNotification(ok ? `Current streak ${count}d computed and saved` : `Current streak ${count}d computed (failed to persist)`, ok ? 'write' : 'warn');
        return ok;
    } catch (e) {
        dbg('computeCurrentStreakSequential error: ' + (e && e.message), 'error', e);
        showNotification('Error computing current streak', 'error');
        _streakProgressHide();
        if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
        return false;
    }
}

// Expose to window for inline onclick handlers
async function computeDateFilesCountUI() {
    try {
        await computeDateFilesCount();
    } catch (e) {
        dbg('computeDateFilesCountUI error: ' + (e && e.message), 'error', e);
        showNotification('Failed to count date files', 'error');
    }
}

async function computeDateFilesCount() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!token || !repo) { showNotification('Missing GitHub credentials; configure in Settings first', 'error'); showPage('settings'); return false; }
    const dataFolder = getConfig('dataFolder') || 'data';
    const listUrl = `https://api.github.com/repos/${repo}/contents/${dataFolder}`;
    _streakProgressShow();
    const countBtn = document.getElementById('count-datefiles-btn');
    const computeBtn = document.getElementById('compute-longest-btn');
    const currentBtn = document.getElementById('compute-current-btn');
    if (countBtn) countBtn.disabled = true;
    if (computeBtn) computeBtn.disabled = true;
    if (currentBtn) currentBtn.disabled = true;
    try {
        const res = await fetch(listUrl, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            dbg('computeDateFilesCount: failed to list folder: ' + (txt || res.statusText), 'error');
            showNotification('Failed to list data folder', 'error');
            _streakProgressHide();
            if (countBtn) countBtn.disabled = false; if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
            return false;
        }
        const items = await res.json();
        const dateItems = (items || []).filter(it => it && it.type === 'file' && /^\d{4}-\d{2}-\d{2}\.json$/.test(it.name));
        const total = dateItems.length;
        const el = document.getElementById('streak-datefiles-count');
        if (el) el.textContent = String(total);
        _streakProgressHide();
        if (countBtn) countBtn.disabled = false; if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
        showNotification(`Found ${total} date files in ${dataFolder}`, 'info');
        return total;
    } catch (e) {
        dbg('computeDateFilesCount error: ' + (e && e.message), 'error', e);
        _streakProgressHide();
        if (countBtn) countBtn.disabled = false; if (computeBtn) computeBtn.disabled = false; if (currentBtn) currentBtn.disabled = false;
        showNotification('Error counting date files', 'error');
        return false;
    }
}

try { window.computeLongestStreakFullScanUI = computeLongestStreakFullScanUI; window.computeCurrentStreakUI = computeCurrentStreakUI; window.computeDateFilesCountUI = computeDateFilesCountUI; } catch (e) { /* ignore */ }

function updateStreakUI() {
    try {
        const el = document.getElementById('streak-badge');
        const hs = document.getElementById('history-streak-count');
        const hb = document.getElementById('history-streak-best');
        const s = state.streak || {};
        const cur = s.currentStreak || 0;
        const best = s.longestStreak || 0;
        if (el) { el.textContent = `🔥 ${cur}d · best ${best}d`; el.title = `Current streak: ${cur} days — Best: ${best} days`; }
        if (hs) hs.textContent = cur;
        if (hb) hb.textContent = best;
        // Update Streaks page values when present
        const curEl = document.getElementById('streak-current-value');
        const bestEl = document.getElementById('streak-best-value');
        const lastEl = document.getElementById('streak-last-computed');
        if (curEl) curEl.textContent = cur;
        if (bestEl) bestEl.textContent = best;
        if (lastEl) lastEl.textContent = s.computedAt ? new Date(s.computedAt).toLocaleString() : 'Never';
        // Start/End ranges for current and best streaks
        const curStartEl = document.getElementById('streak-current-start');
        const curEndEl = document.getElementById('streak-current-end');
        const bestStartEl = document.getElementById('streak-best-start');
        const bestEndEl = document.getElementById('streak-best-end');
        const filesEl = document.getElementById('streak-datefiles-count');
        const recentEl = document.getElementById('streak-recent-dates');
        if (curStartEl) curStartEl.textContent = formatDateReadable(s.currentStartDate);
        if (curEndEl) curEndEl.textContent = formatDateReadable(s.currentEndDate || s.lastActiveDate);
        if (bestStartEl) bestStartEl.textContent = formatDateReadable(s.longestStartDate);
        if (bestEndEl) bestEndEl.textContent = formatDateReadable(s.longestEndDate);
        if (filesEl && typeof s.dateFilesCount !== 'undefined') filesEl.textContent = String(s.dateFilesCount);
        if (recentEl) {
            // Render small chips for recent active dates kept in-memory
            recentEl.innerHTML = '';
            if (Array.isArray(s.recentActiveDates) && s.recentActiveDates.length) {
                s.recentActiveDates.forEach(d => {
                    const sp = document.createElement('span');
                    sp.textContent = d;
                    sp.style.padding = '6px 8px';
                    sp.style.borderRadius = '6px';
                    sp.style.background = 'var(--bg)';
                    sp.style.border = '1px solid var(--muted)';
                    sp.style.fontSize = '12px';
                    sp.style.color = 'var(--text-secondary)';
                    sp.style.marginRight = '6px';
                    recentEl.appendChild(sp);
                });
            } else {
                recentEl.textContent = 'No recent active dates recorded';
            }
        }
        // Update hero elements if present
        const heroVal = document.getElementById('streak-hero-value');
        const heroSub = document.getElementById('streak-hero-sub');
        if (heroVal) heroVal.textContent = cur;
        if (heroSub) heroSub.textContent = (cur === 1) ? 'day streak' : 'days streak';
        // Render current month (lazy-loaded) if calendar is present
        try { showStreakMonth(state.streakCalendar.offsetMonths || 0); } catch (e) { /* ignore */ }
    } catch (e) { dbg('updateStreakUI error: ' + (e && e.message), 'warn'); }
}

// Render a simple calendar grid for the last `windowDays` days (default 30)
function renderStreakCalendar(windowDays) {
    try {
        windowDays = parseInt(windowDays || 30, 10) || 30;
        const container = document.getElementById('streak-calendar');
        if (!container) return;
        container.innerHTML = '';
        const today = new Date();
        const dates = [];
        for (let i = windowDays - 1; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            dates.push(formatDateLocal(d));
        }
        const activeSet = new Set((state.streak && Array.isArray(state.streak.recentActiveDates) ? state.streak.recentActiveDates : []).map(x => String(x)));
        const grid = document.createElement('div');
        grid.className = 'streak-calendar-grid';
        const frag = document.createDocumentFragment();
        dates.forEach(ds => {
            const chip = document.createElement('div');
            chip.className = 'streak-chip';
            chip.title = ds;
            if (activeSet.has(ds)) {
                chip.classList.add('active');
                const icon = document.createElement('span'); icon.className = 'chip-icon'; icon.textContent = '🔥';
                chip.appendChild(icon);
            }
            frag.appendChild(chip);
        });
        grid.appendChild(frag);
        container.appendChild(grid);
    } catch (e) { dbg('renderStreakCalendar error: ' + (e && e.message), 'warn'); }
}

// ---- Month navigation + lazy month loader ----
function computeYearMonthFromOffset(offset) {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() + (offset || 0));
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

function monthKey(year, monthIndex) {
    return `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
}

function formatMonthLabel(year, monthIndex) {
    try {
        return new Date(year, monthIndex, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' });
    } catch (e) { return `${year}-${monthIndex + 1}`; }
}

function streakChangeMonth(delta) {
    try {
        state.streakCalendar.offsetMonths = (state.streakCalendar.offsetMonths || 0) + delta;
        showStreakMonth(state.streakCalendar.offsetMonths);
    } catch (e) { dbg('streakChangeMonth error: ' + (e && e.message), 'warn', e); }
}

async function showStreakMonth(offset) {
    try {
        const { year, monthIndex } = computeYearMonthFromOffset(offset);
        const labelEl = document.getElementById('streak-calendar-month-label');
        if (labelEl) labelEl.textContent = formatMonthLabel(year, monthIndex);
        const key = monthKey(year, monthIndex);
        const cache = state.streakCalendar.cache || (state.streakCalendar.cache = {});
        if (cache[key] && cache[key].loaded) {
            renderCalendarFromCache(year, monthIndex, cache[key].activeSet);
            return;
        }
        // load lazily
        if (cache[key] && cache[key].loading) return; // already loading
        cache[key] = { loading: true, activeSet: new Set() };
        // disable nav while loading
        const prevBtn = document.getElementById('streak-prev-month');
        const nextBtn = document.getElementById('streak-next-month');
        if (prevBtn) prevBtn.disabled = true; if (nextBtn) nextBtn.disabled = true;
        _streakProgressShow();
        const days = [];
        const first = new Date(year, monthIndex, 1);
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        for (let d = 1; d <= daysInMonth; d++) {
            const ds = `${year}-${String(monthIndex + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            days.push(ds);
        }
        const CHUNK = 6;
        const activeSet = new Set();
        let processed = 0;
        for (let i = 0; i < days.length; i += CHUNK) {
            const chunk = days.slice(i, i + CHUNK);
            const promises = chunk.map(async (dateStr, idx) => {
                try {
                    const r = await fetchDateFromGit(dateStr);
                    processed++;
                    _streakProgressUpdate(processed, days.length, dateStr);
                    if (r && r.status === 200 && Array.isArray(r.entries)) {
                        const hasActive = r.entries.some(en => !(en && en._meta === 'dailyWeight'));
                        if (hasActive) activeSet.add(dateStr);
                    }
                } catch (e) {
                    processed++;
                    _streakProgressUpdate(processed, days.length, dateStr);
                    dbg('showStreakMonth fetch error for ' + dateStr + ' : ' + (e && e.message), 'warn', e);
                }
            });
            await Promise.all(promises);
        }
        cache[key].loaded = true;
        cache[key].loading = false;
        cache[key].activeSet = activeSet;
        _streakProgressHide();
        if (prevBtn) prevBtn.disabled = false; if (nextBtn) nextBtn.disabled = false;
        renderCalendarFromCache(year, monthIndex, activeSet);
    } catch (e) {
        dbg('showStreakMonth error: ' + (e && e.message), 'error', e);
        _streakProgressHide();
        const prevBtn = document.getElementById('streak-prev-month');
        const nextBtn = document.getElementById('streak-next-month');
        if (prevBtn) prevBtn.disabled = false; if (nextBtn) nextBtn.disabled = false;
    }
}

function renderCalendarFromCache(year, monthIndex, activeSet) {
    try {
        const grid = document.getElementById('streak-calendar-grid');
        if (!grid) return;
        grid.innerHTML = '';
        // Monday-first mapping
        const first = new Date(year, monthIndex, 1);
        const startOffset = (first.getDay() + 6) % 7; // 0=Mon
        const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
        const totalSlots = startOffset + daysInMonth;
        const rows = Math.ceil(totalSlots / 7);
        const frag = document.createDocumentFragment();
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < 7; c++) {
                const slot = r * 7 + c;
                const cell = document.createElement('div');
                cell.className = 'streak-chip';
                    if (slot < startOffset || slot >= startOffset + daysInMonth) {
                    // empty day
                    cell.classList.add('inactive');
                } else {
                    const day = slot - startOffset + 1;
                    const ds = `${year}-${String(monthIndex + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
                    cell.title = ds;
                    // annotate with day number
                    const dayEl = document.createElement('div'); dayEl.className = 'chip-day'; dayEl.textContent = String(day);
                    cell.appendChild(dayEl);
                    if (activeSet && activeSet.has && activeSet.has(ds)) {
                        cell.classList.add('active');
                        const icon = document.createElement('span'); icon.className = 'chip-icon'; icon.textContent = '🔥';
                        cell.appendChild(icon);
                    }
                }
                frag.appendChild(cell);
            }
        }
        grid.appendChild(frag);
    } catch (e) { dbg('renderCalendarFromCache error: ' + (e && e.message), 'warn', e); }
}

// NOTE: manual recompute helper removed — streak computations now only run
// when triggered explicitly via the Settings actions (compute buttons).


// Escape HTML for safe insertion into modal details
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function addDaysToDateString(dateStr, days) {
    const parts = dateStr.split('-');
    const d = new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
    d.setDate(d.getDate() + days);
    return formatDateLocal(d);
}

// Returns the dropdown value that matches a start+end pair, or '' if none.
function matchPreset(start, end) {
    const today = getTodayString();
    if (start === today && end === today) return 'today';
    if (start === addDaysToDateString(today, -1) && end === addDaysToDateString(today, -1)) return 'yesterday';
    if (start === addDaysToDateString(today, -6) && end === today) return '7';
    if (start === addDaysToDateString(today, -29) && end === today) return '30';
    return '';
}

function handleRangeSelect() {
    const sel = document.getElementById('range-select');
    if (!sel) return;
    state.historyUsingCalendar = false;
    const v = sel.value;
    const today = getTodayString();

    if (v === 'today') {
        state.dateRangeStart = today;
        state.dateRangeEnd = today;
    } else if (v === 'yesterday') {
        state.dateRangeStart = addDaysToDateString(today, -1);
        state.dateRangeEnd = state.dateRangeStart;
    } else {
        const days = parseInt(v, 10);
        state.dateRangeStart = addDaysToDateString(today, -(days - 1));
        state.dateRangeEnd = today;
    }

    // Sync date inputs to match the chosen preset
    const startEl = document.getElementById('filter-date-start');
    const endEl = document.getElementById('filter-date-end');
    if (startEl) startEl.value = state.dateRangeStart;
    if (endEl) endEl.value = state.dateRangeEnd;

    state.historyPage = 1;
    try { document.body.__historyLoadingFlag = true; } catch (e) {}
    try { updateApplyButtonState(); } catch (e) {}
    renderHistory();
}

function handleStartDateChange() {
    const startEl = document.getElementById('filter-date-start');
    const endEl = document.getElementById('filter-date-end');
    if (!startEl) return;
    const start = startEl.value;
    const end = endEl?.value || start; // if no end, treat end = start
    if (!end && endEl) endEl.value = start; // mirror to end if blank
    state.dateRangeStart = start || null;
    state.dateRangeEnd = endEl?.value || null;
    state.historyUsingCalendar = true;
    // Sync dropdown
    const sel = document.getElementById('range-select');
    if (sel) sel.value = matchPreset(state.dateRangeStart, state.dateRangeEnd);
    try { updateApplyButtonState(); } catch (e) {}
    if (state.dateRangeStart && state.dateRangeEnd) {
        state.historyPage = 1;
        try { document.body.__historyLoadingFlag = true; } catch (e) {}
        renderHistory();
    }
}

function handleEndDateChange() {
    const startEl = document.getElementById('filter-date-start');
    const endEl = document.getElementById('filter-date-end');
    if (!endEl) return;
    const end = endEl.value;
    const start = startEl?.value || end; // if no start, treat start = end
    if (!startEl?.value && startEl) startEl.value = end; // mirror to start if blank
    state.dateRangeStart = startEl?.value || null;
    state.dateRangeEnd = end || null;
    state.historyUsingCalendar = true;
    // Sync dropdown
    const sel = document.getElementById('range-select');
    if (sel) sel.value = matchPreset(state.dateRangeStart, state.dateRangeEnd);
    try { updateApplyButtonState(); } catch (e) {}
    if (state.dateRangeStart && state.dateRangeEnd) {
        state.historyPage = 1;
        try { document.body.__historyLoadingFlag = true; } catch (e) {}
        renderHistory();
    }
}

function applyDateRange() {
    // Read current inputs
    const startInput = document.getElementById('filter-date-start');
    const endInput = document.getElementById('filter-date-end');
    const start = startInput?.value || null;
    const end = endInput?.value || null;

    if (!start && !end) {
        // Nothing selected — clear filters
        clearFilters();
        return;
    }

    // If only one side provided, treat as single-day selection
    let s = start || end;
    let e = end || start;
    if (!s) s = e;
    if (!e) e = s;

    // Normalize order
    if (s > e) [s, e] = [e, s];

    state.dateRangeStart = s;
    state.dateRangeEnd = e;
    state.historyUsingCalendar = true;
    state.historyPage = 1;

    // Clear quick-range dropdown to avoid sync conflicts
    try { const rs = document.getElementById('range-select'); if (rs) rs.value = ''; } catch (e) {}

    // Show loading overlay while prefetch may occur
    try { document.body.__historyLoadingFlag = true; } catch (e) {}

    dbg(`applyDateRange: start=${state.dateRangeStart} end=${state.dateRangeEnd}`, 'debug');

    // If we previously attempted a prefetch for the same exact date list,
    // remove that key so the user forcing an Apply will re-attempt fetching.
    try {
        const targets = [];
        let cur = new Date(state.dateRangeStart);
        const endD = new Date(state.dateRangeEnd);
        while (cur <= endD) {
            targets.push(formatDateLocal(cur));
            cur.setDate(cur.getDate() + 1);
        }
        const key = targets.join(',');
        if (key && state.historyPrefetchAttempts && state.historyPrefetchAttempts.has(key)) {
            dbg(`applyDateRange: clearing previous prefetch attempt key ${key}`, 'debug');
            state.historyPrefetchAttempts.delete(key);
            state.historyFetchFallbackAttempted = false;
        }
    } catch (e) { dbg(`applyDateRange prefetch-key cleanup error: ${e && e.message}`, 'warn'); }

    // Kick off prefetch if needed but render immediately so user sees results.
    try { ensureHistoryPrefetchIfNeeded(); } catch (e) { dbg(`applyDateRange prefetch error: ${e && e.message}`, 'warn'); }
    try { showNotification(`Showing ${state.dateRangeStart} → ${state.dateRangeEnd}`, 'read'); } catch (e) {}
    renderHistory();
}

function updateApplyButtonState() {
    const btn = document.getElementById('apply-date-range-btn');
    if (!btn) return;
    const startVal = document.getElementById('filter-date-start')?.value;
    const endVal = document.getElementById('filter-date-end')?.value;
    // Button enabled only when both start and end are provided
    if (startVal && endVal) {
        btn.disabled = false;
    } else {
        btn.disabled = true;
    }
}

function filterHistory() {
    const foodVal = (document.getElementById('filter-food') || {}).value || '';
    const clearBtn = document.getElementById('hp-search-clear');
    if (clearBtn) clearBtn.style.display = foodVal ? 'block' : 'none';
    state.historyPage = 1;
    renderHistory();
}

function clearHistorySearch() {
    const input = document.getElementById('filter-food');
    if (input) input.value = '';
    const clearBtn = document.getElementById('hp-search-clear');
    if (clearBtn) clearBtn.style.display = 'none';
    state.historyPage = 1;
    renderHistory();
}

function clearFilters() {
    const today = getTodayString();
    const start = document.getElementById('filter-date-start');
    const end = document.getElementById('filter-date-end');
    if (start) start.value = today;
    if (end) end.value = today;
    const food = document.getElementById('filter-food');
    if (food) food.value = '';
    state.dateRangeStart = today;
    state.dateRangeEnd = today;
    state.historyUsingCalendar = false;
    try { const rs = document.getElementById('range-select'); if (rs) rs.value = 'today'; } catch (e) {}
    state.historyPage = 1;
    try { updateApplyButtonState(); } catch (e) {}
    renderHistory();
}

function toggleMacroPanel() {
    const panel = document.getElementById('history-macro-panel');
    const arrow = document.getElementById('macro-toggle-arrow');
    if (!panel) return;
    const isHidden = panel.classList.toggle('macro-panel-hidden');
    if (arrow) arrow.textContent = isHidden ? '▾' : '▴';
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

async function historyBulkDelete() {
    if (state.historySelectedEntries.size === 0) {
        alert('No entries selected.');
        return;
    }

    const indices = Array.from(state.historySelectedEntries).sort((a, b) => a - b);
    const toRemove = new Set(indices);

    // Determine which dates are affected by the selection and build preview
    const affectedDates = new Set();
    const previewByDate = {};
    state.entries.forEach((e, i) => {
        if (toRemove.has(i)) {
            const d = getEntryDate(e) || getTodayString();
            affectedDates.add(d);
            if (!previewByDate[d]) previewByDate[d] = [];
            previewByDate[d].push(e);
        }
    });

    let detailsHtml = '<div style="display:flex; flex-direction:column; gap:8px;">';
    for (const d of Object.keys(previewByDate).sort()) {
        const items = previewByDate[d];
        detailsHtml += `<div style="font-weight:600; margin-bottom:4px;">${d} (${items.length})</div><ul style="margin:0 0 8px 16px; padding:0; list-style:disc; max-height:120px; overflow:auto;">`;
        for (let j = 0; j < Math.min(items.length, 10); j++) {
            detailsHtml += `<li>${escapeHtml(String(items[j].food || '(no food)'))}</li>`;
        }
        if (items.length > 10) detailsHtml += `<li>...and ${items.length - 10} more</li>`;
        detailsHtml += '</ul>';
    }
    detailsHtml += '</div>';

    const proceed = await showConfirm(`Delete ${state.historySelectedEntries.size} selected entries?`, 'Confirm Delete', detailsHtml);
    if (!proceed) return;

    if (affectedDates.size === 0) {
        // Nothing to do
        try { closeConfirm(); } catch (e) { /* ignore */ }
        return;
    }

    state.hasUnsavedChanges = true;
    try {
        // For each affected date, compute remaining entries for that date and persist only that date
        for (const dateStr of Array.from(affectedDates)) {
            const remainingForDate = state.entries.filter((e, i) => {
                const d = getEntryDate(e) || getTodayString();
                if (d !== dateStr) return true; // keep entries for other dates
                return !toRemove.has(i);
            }).filter(e => getEntryDate(e) === dateStr);

            if (!remainingForDate || remainingForDate.length === 0) {
                // No remaining entries for this specific date -> delete date file
                dbg(`historyBulkDelete: deleting remote file for ${dateStr} (no remaining entries)`, 'info');
                const ok = await deleteDateFile(dateStr);
                if (!ok) throw new Error(`Failed to delete ${dateStr}`);
            } else {
                const ok = await pushDateFile(dateStr, remainingForDate);
                if (!ok) throw new Error(`Failed to write ${dateStr}`);
            }
        }

        // After successful remote writes for affected dates, apply local removals
        const remaining = state.entries.filter((e, i) => !toRemove.has(i));
        state.entries = remaining;
        state.historySelectedEntries.clear();
        state.hasUnsavedChanges = false;
        updateHistorySelectedCount();
        render();
        renderHistory();

        try { closeConfirm(); } catch (e) { /* ignore */ }
        dbg(`Bulk deleted ${toRemove.size} entries from history`, 'info');
        try { autoSave(); } catch (e) { dbg(`Auto-save error: ${e.message}`, 'error'); }
        toggleHistorySelectMode();
    } catch (e) {
        dbg(`historyBulkDelete persistence error: ${e && e.message}`, 'error');
        try { closeConfirm(); } catch (ee) { /* ignore */ }
        alert('Failed to persist history bulk delete. Check logs.');
        state.hasUnsavedChanges = false;
    }
}

function historyExportSelectedToCsv() {
    if (state.historySelectedEntries.size === 0) {
        alert('No entries selected.');
        return;
    }
    
    const indices = Array.from(state.historySelectedEntries).sort((a, b) => a - b);
    const selectedData = indices.map(i => state.entries[i]);
    
    const headers = ['Date', 'Time', 'Food', 'Calories', 'Protein (g)', 'Carbs (g)', 'Fat (g)'];
    // Add optional Health Score column
    headers.push('Health Score (1-10)');
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
        row.push(entry.healthScore || '');
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
    editForm.className = 'edit-form-grid';

    const fields = [
        { name: 'food',        label: 'Food',                type: 'text',   span: 2 },
        { name: 'calories',    label: 'Calories (kcal)',      type: 'number' },
        { name: 'date',        label: 'Date',                type: 'date'   },
        { name: 'protein',     label: 'Protein (g)',          type: 'number' },
        { name: 'carbs',       label: 'Carbs (g)',            type: 'number' },
        { name: 'fat',         label: 'Fat (g)',              type: 'number' },
        { name: 'healthScore', label: 'Health Score (1–10)',  type: 'select' },
    ];

    fields.forEach(field => {
        const wrap = document.createElement('div');
        wrap.className = 'sc-field' + (field.span === 2 ? ' efg-span2' : '');
        const lbl = document.createElement('label');
        lbl.className = 'sc-label';
        lbl.htmlFor = `edit-${field.name}-${index}`;
        lbl.textContent = field.label;
        wrap.appendChild(lbl);

        let input;
        if (field.name === 'healthScore') {
            input = document.createElement('select');
            input.id = `edit-${field.name}-${index}`;
            input.className = 'form-input sc-input';
            const empty = document.createElement('option'); empty.value = ''; empty.textContent = '— Score —'; input.appendChild(empty);
            for (let s = 1; s <= 10; s++) {
                const o = document.createElement('option'); o.value = String(s); o.textContent = String(s);
                if (entry[field.name] !== undefined && parseInt(entry[field.name], 10) === s) o.selected = true;
                input.appendChild(o);
            }
        } else {
            input = document.createElement('input');
            input.type = field.type;
            input.id = `edit-${field.name}-${index}`;
            input.className = 'form-input sc-input';
            input.value = entry[field.name] || '';
            input.placeholder = field.label;
        }
        wrap.appendChild(input);
        editForm.appendChild(wrap);
    });

    // Time field — native <input type="time">
    const timeWrap = document.createElement('div');
    timeWrap.className = 'sc-field';
    const timeLbl = document.createElement('label');
    timeLbl.className = 'sc-label';
    timeLbl.htmlFor = `edit-time-${index}`;
    timeLbl.textContent = 'Meal Time';
    const timeInpE = document.createElement('input');
    timeInpE.type = 'time';
    timeInpE.id = `edit-time-${index}`;
    timeInpE.className = 'form-input sc-input';
    timeInpE.value = _timeTo24(entry.time || '');
    timeWrap.appendChild(timeLbl);
    timeWrap.appendChild(timeInpE);
    editForm.appendChild(timeWrap);

    const buttonWrapper = document.createElement('div');
    buttonWrapper.className = 'efg-span2 efg-actions';

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save';
    saveBtn.className = 'btn-primary';
    saveBtn.style.cssText = 'font-size:15px; padding:12px 0;';
    saveBtn.onclick = () => saveEdit(index);

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.className = 'btn-secondary';
    cancelBtn.style.cssText = 'font-size:15px; padding:12px 0; margin:0;';
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
    // Health score is optional; keep undefined if not a valid number
    const hsVal = parseInt(document.getElementById(`edit-healthScore-${index}`).value, 10);
    entry.healthScore = (!isNaN(hsVal) ? hsVal : undefined);
    entry.date = document.getElementById(`edit-date-${index}`).value;
    const rawTime = document.getElementById(`edit-time-${index}`).value;
    entry.time = rawTime
        ? _time24to12(rawTime)
        : (entry.time || new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }));
    
    render();
    renderHistory();
    dbg(`Entry ${index} updated`, 'info');
    // Mark as changed and auto-save if configured
    state.hasUnsavedChanges = true;
    try { autoSave(); } catch (e) { dbg(`Auto-save error: ${e.message}`, 'error'); }
}

async function deleteEntryGlobal(index) {
    try { showNotification('Opening delete confirmation...', 'read'); } catch (e) {}
    const proceed = await showConfirm('Delete this entry?');
    if (!proceed) return;
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
        try { showNotification(`Deleted entry${removed && removed.food ? ': ' + removed.food : ''}`, 'delete'); } catch (e) {}
        closeConfirm();
        state.hasUnsavedChanges = false;
    } catch (e) {
        dbg(`Auto-save delete failed: ${e.message}`, 'error');
    }
}

// ── Entry Preview Modal (pre-filled before saving) ───────────────────────────
// Shared state for the preview modal
const _entryPreviewState = { entry: null, mode: null /* 'today' | 'repeat' */ };

    const TIME_OPTIONS = ['Current Time', 'Breakfast (9:00 AM)', 'Lunch (1:00 PM)', 'Dinner (7:00 PM)', 'Snack (3:00 PM)', 'Evening (8:00 PM)'];

    function _smartTimeDefault() {
        const h = new Date().getHours();
        if (h >= 5  && h < 11) return 'Breakfast (9:00 AM)';
        if (h >= 11 && h < 15) return 'Lunch (1:00 PM)';
        if (h >= 15 && h < 18) return 'Snack (3:00 PM)';
        if (h >= 18 && h < 22) return 'Dinner (7:00 PM)';
        return 'Current Time';
    }

function openEntryPreviewModal(source, mode) {
    const today = getTodayString();
    const now = new Date();
    const entry = {
        food:        source.food        || '',
        calories:    source.calories    || 0,
        protein:     source.protein     || '',
        carbs:       source.carbs       || '',
        fat:         source.fat         || '',
        healthScore: source.healthScore != null ? source.healthScore : '',
        date:        today,
        time:        source.time || _smartTimeDefault(),
        timestamp:   now.toISOString(),
    };
    _entryPreviewState.entry = entry;
    _entryPreviewState.mode  = mode;

    const titleEl = document.getElementById('entry-preview-title');
    const hintEl  = document.getElementById('entry-preview-hint');
    if (titleEl) titleEl.textContent = mode === 'repeat' ? '🔁 Add Another Serving' : '➕ Add to Today';
    if (hintEl) hintEl.textContent = mode === 'repeat'
        ? 'Review and adjust the entry before adding another serving.'
        : 'Review and adjust the entry before adding it to today\'s log.';

    const form = document.getElementById('entry-preview-form');
    if (!form) return;
    form.innerHTML = '';

    const fields = [
        { id: 'ep-food',        label: 'Food',               type: 'text',   val: entry.food,        required: true },
        { id: 'ep-calories',    label: 'Calories (kcal)',     type: 'number', val: entry.calories,    required: true, min: 0 },
        { id: 'ep-date',        label: 'Date',               type: 'date',   val: entry.date,        required: true },
        { id: 'ep-protein',     label: 'Protein (g)',         type: 'number', val: entry.protein,     required: false, min: 0 },
        { id: 'ep-carbs',       label: 'Carbs (g)',           type: 'number', val: entry.carbs,       required: false, min: 0 },
        { id: 'ep-fat',         label: 'Fat (g)',             type: 'number', val: entry.fat,         required: false, min: 0 },
        { id: 'ep-healthScore', label: 'Health Score (1–10)', type: 'number', val: entry.healthScore, required: false, min: 1, max: 10 },
    ];

    fields.forEach(f => {
        const wrap = document.createElement('div');
        wrap.className = 'sc-field';
        const lbl = document.createElement('label');
        lbl.className = 'sc-label';
        lbl.htmlFor = f.id;
        lbl.textContent = f.label + (f.required ? ' *' : '');
        const inp = document.createElement('input');
        inp.type = f.type;
        inp.id = f.id;
        inp.className = 'form-input sc-input';
        inp.style.marginBottom = '0';
        if (f.val !== '' && f.val != null) inp.value = f.val;
        if (f.min !== undefined) inp.min = f.min;
        if (f.max !== undefined) inp.max = f.max;
        if (f.required) inp.required = true;
        wrap.appendChild(lbl); wrap.appendChild(inp);
        form.appendChild(wrap);
    });

    // Time field with drum-picker trigger (consistent across all edit forms)
    const timeWrap = document.createElement('div');
    timeWrap.className = 'sc-field';
    const timeLbl = document.createElement('label');
    timeLbl.className = 'sc-label';
    timeLbl.htmlFor = 'ep-time';
    timeLbl.textContent = 'Meal Time';
    const timeInp = document.createElement('input');
    timeInp.type = 'time';
    timeInp.id = 'ep-time';
    timeInp.className = 'form-input sc-input';
    timeInp.style.marginBottom = '0';
    // Smart default in 24h
    const defaultTime = (() => {
        const h = new Date().getHours();
        if (h >= 5  && h < 11) return '09:00';
        if (h >= 11 && h < 15) return '13:00';
        if (h >= 15 && h < 18) return '15:00';
        if (h >= 18 && h < 22) return '19:00';
        return '20:00';
    })();
    timeInp.value = entry.time && entry.time !== 'Current Time' ? _timeTo24(entry.time) : defaultTime;
    timeWrap.appendChild(timeLbl);
    timeWrap.appendChild(timeInp);
    form.appendChild(timeWrap);

    const modal = document.getElementById('entry-preview-modal');
    if (modal) modal.style.display = 'flex';
}

function closeEntryPreviewModal() {
    const modal = document.getElementById('entry-preview-modal');
    if (modal) modal.style.display = 'none';
    _entryPreviewState.entry = null;
    _entryPreviewState.mode  = null;
}

async function commitEntryPreview() {
    const food     = document.getElementById('ep-food')?.value?.trim();
    const calories = parseFloat(document.getElementById('ep-calories')?.value);
    const date     = document.getElementById('ep-date')?.value || getTodayString();
    const rawTime  = document.getElementById('ep-time')?.value?.trim() || '';
    const time     = rawTime
        ? _time24to12(rawTime)
        : new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

    if (!food || isNaN(calories)) {
        alert('Food name and calories are required.');
        return;
    }

    const now = new Date(`${date}T${new Date().toTimeString().slice(0,8)}`);
    const newEntry = {
        food, calories,
        date,
        time,
        timestamp: now.toISOString(),
    };

    const rawProtein = parseFloat(document.getElementById('ep-protein')?.value);
    const rawCarbs   = parseFloat(document.getElementById('ep-carbs')?.value);
    const rawFat     = parseFloat(document.getElementById('ep-fat')?.value);
    const rawHs      = parseInt(document.getElementById('ep-healthScore')?.value, 10);
    if (!isNaN(rawProtein) && rawProtein > 0)  newEntry.protein     = rawProtein;
    if (!isNaN(rawCarbs)   && rawCarbs   > 0)  newEntry.carbs       = rawCarbs;
    if (!isNaN(rawFat)     && rawFat     > 0)  newEntry.fat         = rawFat;
    if (!isNaN(rawHs)      && rawHs >= 1 && rawHs <= 10) newEntry.healthScore = rawHs;

    const saveBtn = document.getElementById('entry-preview-save-btn');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = '⏳ Saving…'; }

    const ok = await pushEntryForDate(date, newEntry);

    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = '💾 Save Entry'; }

    if (ok) {
        state.entries.push(newEntry);
        closeEntryPreviewModal();
        // Navigate to tracker if adding to today
        if (date === getTodayString()) showPage('tracker');
        render();
        renderHistory();
        showNotification(`Added "${food}" to ${date}`, 'write');
    } else {
        alert('Failed to save entry. Check logs.');
    }
}

// Clone a history entry → open pre-fill modal
function addEntryToToday(globalIndex) {
    const source = state.entries[globalIndex];
    if (!source) { dbg('addEntryToToday: not found ' + globalIndex, 'warn'); return; }
    openEntryPreviewModal(source, 'today');
}

// Repeat tracker entry → open pre-fill modal
function repeatEntryToday(globalIndex) {
    const source = state.entries[globalIndex];
    if (!source) { dbg('repeatEntryToday: not found ' + globalIndex, 'warn'); return; }
    openEntryPreviewModal(source, 'repeat');
}

// Open the Trend Explorer in a new window, sharing current entries via localStorage
function openGraphingCalculator() {
    try {
        localStorage.setItem('gt_graphing_entries', JSON.stringify(state.entries || []));
    } catch (e) { dbg('openGraphingCalculator: failed to write entries to localStorage: ' + e.message, 'warn'); }
    window.open('graphing-calculator.html', '_blank', 'width=960,height=720,resizable=yes');
}

// Download a full JSON report of all tracked data
function openReportPage() {
    try {
        // Pass all entries to report page via localStorage
        localStorage.setItem('gt_report_entries', JSON.stringify(state.entries || []));
        window.open('report-generator.html', '_blank', 'width=800,height=700,resizable=yes');
        dbg('Opened Report Generator page', 'info');
    } catch (e) {
        dbg('openReportPage error: ' + e.message, 'error');
        alert('Failed to open report page. Check logs.');
    }
}

// Legacy alias
function downloadJsonReport() { openReportPage(); }

// --- ANALYTICS PAGE ---
let charts = {};

function updateAnalytics() {
    const dateInput = document.getElementById('analytics-date');
    const selectedDate = dateInput.value || new Date().toISOString().split('T')[0];
    renderAnalytics(selectedDate);
}


async function renderAnalytics(date) {
    const dateStr = date || (new Date().toISOString().split('T')[0]);
    // Determine initial entries source (temporary per-date or global state)
    let entriesForAnalytics = (state._tempEntriesForAnalytics && state._tempEntriesForAnalytics.date === dateStr) ? state._tempEntriesForAnalytics.entries : state.entries;

    // Ensure attempt tracking exists
    state._analytics_dateAttempts = state._analytics_dateAttempts || new Set();

    // If no entries or the requested date isn't present locally, try fetching the single date first
    const hasDateLocally = Array.isArray(entriesForAnalytics) && entriesForAnalytics.some(e => getEntryDate(e) === dateStr);
    if (!hasDateLocally) {
        if (!state._analytics_dateAttempts.has(dateStr)) {
            state._analytics_dateAttempts.add(dateStr);
            dbg(`Analytics: attempting to fetch only ${dateStr} and retrying`, 'info');
            try {
                const res = await fetchDateFromGit(dateStr);
                if (res && res.status === 200 && Array.isArray(res.entries)) {
                    entriesForAnalytics = res.entries;
                    // Cache temporarily for this analytics render
                    state._tempEntriesForAnalytics = { date: dateStr, entries: res.entries };
                } else if (res && res.status === 404) {
                    dbg(`Analytics: ${dateStr} not found on GitHub (404). Showing empty history view.`, 'info');
                    entriesForAnalytics = [];
                } else {
                    dbg(`Analytics: fetchDateFromGit returned no data for ${dateStr} (status=${res && res.status})`, 'warn');
                    // Fallback to a single full-folder fetch once
                    if (!state._analytics_fetchAttempted) {
                        state._analytics_fetchAttempted = true;
                        dbg('Analytics: full-folder fetch disabled by policy; skipping fallback', 'info');
                        try { showNotification('Analytics per-date fetch failed; full-folder fallback is disabled.', 'warn'); } catch (e) {}
                        entriesForAnalytics = state.entries || [];
                    } else {
                        entriesForAnalytics = [];
                    }
                }
            } catch (err) {
                dbg(`Analytics: fetchDateFromGit failed: ${err && err.message}`, 'error');
                // Fallback to folder fetch once
                if (!state._analytics_fetchAttempted) {
                    state._analytics_fetchAttempted = true;
                    try { showNotification('Analytics per-date fetch failed; full-folder fallback is disabled.', 'warn'); } catch (e) {}
                    entriesForAnalytics = state.entries || [];
                } else {
                    entriesForAnalytics = [];
                }
            }
        } else {
            // Already attempted; treat as no data
            entriesForAnalytics = [];
        }
    }

    if (!Array.isArray(entriesForAnalytics)) entriesForAnalytics = [];

    try {
        const uniqueDates = Array.from(new Set(entriesForAnalytics.map(e => getEntryDate(e)).filter(Boolean))).sort();
        dbg(`Analytics requested date=${dateStr} totalEntries=${entriesForAnalytics.length} uniqueDates=${uniqueDates.join(',')}`, 'debug');
    } catch (e) { dbg(`Analytics diagnostic error: ${e && e.message}`, 'warn'); }

    const filtered = entriesForAnalytics.filter(e => getEntryDate(e) === dateStr);

    if (filtered.length === 0) {
        dbg(`No entries found for ${date}`, 'warn');
        // If we have any entries at all, pick the most recent date and render that instead
        if (Array.isArray(state.entries) && state.entries.length > 0) {
            const dates = Array.from(new Set(state.entries.map(e => e.date).filter(d => !!d))).sort();
            const latest = dates.length > 0 ? dates[dates.length - 1] : null;
            if (latest && latest !== date && state._analytics_autoRedirectedTo !== latest) {
                state._analytics_autoRedirectedTo = latest;
                dbg(`Analytics: switching to latest available date ${latest}`, 'info');
                renderAnalytics(latest);
                return;
            }
        }
        // Show empty state in charts
        // Clear any displayed meal total
        try { const mealTotalEl = document.getElementById('meal-total'); if (mealTotalEl) mealTotalEl.textContent = 'Total: 0 kcal'; } catch (e) {}
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
    
    // Shared doughnut chart options factory
    function _doughnutOptions(labelFormatter, tooltipFormatter) {
        const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1c1c1e';
        return {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            layout: { padding: { right: 12 } },
            animation: { animateRotate: true, duration: 500 },
            plugins: {
                legend: {
                    position: 'right',
                    labels: {
                        color: textColor,
                        boxWidth: 12,
                        padding: 14,
                        font: { size: 12, weight: '500' },
                        generateLabels: function(chart) {
                            const tc = getComputedStyle(document.documentElement).getPropertyValue('--text').trim() || '#1c1c1e';
                            const data = (chart.data.datasets[0] && chart.data.datasets[0].data) || [];
                            const labels = chart.data.labels || [];
                            const total = data.reduce((s, v) => s + (parseFloat(v) || 0), 0) || 1;
                            return labels.map((lab, i) => ({
                                text: labelFormatter(lab, parseFloat(data[i]) || 0, total),
                                fillStyle: (chart.data.datasets[0].backgroundColor || [])[i] || '#999',
                                strokeStyle: 'transparent',
                                lineWidth: 0,
                                color: tc,
                                fontColor: tc,
                                hidden: false,
                                index: i
                            }));
                        }
                    }
                },
                tooltip: { callbacks: { label: tooltipFormatter } }
            }
        };
    }
    const _DONUT_COLORS = ['#007aff', '#5856d6', '#34c759', '#ff9500', '#ff3b30', '#af52de', '#ff6b00', '#30b0c7'];

    if (Object.keys(mealData).length > 0) {
        charts.meal = new Chart(document.getElementById('chart-meal-distribution'), {
            type: 'doughnut',
            data: {
                labels: Object.keys(mealData),
                datasets: [{ data: Object.values(mealData), backgroundColor: _DONUT_COLORS }]
            },
            options: _doughnutOptions(
                (lab, val, total) => `${lab}: ${Math.round(val)} kcal (${Math.round(val/total*100)}%)`,
                ctx => `${ctx.label}: ${Math.round(ctx.parsed)} kcal`
            )
        });
        // Compute and display total calories for the meal distribution chart
        try {
            const totalCalories = Object.values(mealData).reduce((acc, v) => acc + (parseFloat(v) || 0), 0);
            const mealTotalEl = document.getElementById('meal-total');
            if (mealTotalEl) mealTotalEl.textContent = `Total: ${Math.round(totalCalories)} kcal`;
        } catch (e) { dbg('Could not update meal total display', 'debug'); }
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
        try {
            charts.macro = new Chart(document.getElementById('chart-macro-distribution'), {
                type: 'doughnut',
                data: {
                    labels: ['Protein', 'Carbs', 'Fat'],
                    datasets: [{ data: [totalProtein, totalCarbs, totalFat], backgroundColor: _DONUT_COLORS }]
                },
                options: _doughnutOptions(
                    (lab, val, total) => `${lab}: ${Math.round(val)}g (${Math.round(val/total*100)}%)`,
                    ctx => {
                        const val = ctx.parsed || 0;
                        const total = (ctx.dataset.data || []).reduce((s,v) => s+(parseFloat(v)||0), 0);
                        return `${ctx.label}: ${Math.round(val)}g (${total>0?Math.round(val/total*100):0}%)`;
                    }
                )
            });
        } catch (e) {
            dbg(`Macro chart render error: ${e && e.message}`, 'error', e);
            // Fallback: draw placeholder and append textual legend
            try {
                const macroCanvas = document.getElementById('chart-macro-distribution');
                if (macroCanvas && macroCanvas.getContext) {
                    const ctx = macroCanvas.getContext('2d');
                    ctx.clearRect(0, 0, macroCanvas.width, macroCanvas.height);
                    ctx.font = '14px -apple-system, sans-serif';
                    ctx.fillStyle = '#8e8e93';
                    ctx.textAlign = 'center';
                    ctx.fillText('Macro chart unavailable', macroCanvas.width / 2, macroCanvas.height / 2 - 10);
                }
                const container = document.getElementById('chart-macro-distribution')?.parentElement;
                if (container) {
                    // Remove existing fallback if present
                    const existing = container.querySelector('.macro-legend-list');
                    if (existing) existing.remove();
                    const list = document.createElement('div');
                    list.className = 'macro-legend-list';
                    list.style.cssText = 'margin-top:8px; font-size:13px; color:var(--text-secondary); display:flex; flex-direction:column; gap:6px;';
                    const total = totalProtein + totalCarbs + totalFat || 1;
                    const items = [
                        { label: 'Protein', value: totalProtein, color: '#007aff' },
                        { label: 'Carbs', value: totalCarbs, color: '#5856d6' },
                        { label: 'Fat', value: totalFat, color: '#34c759' }
                    ];
                    items.forEach(it => {
                        const pct = Math.round((it.value / total) * 100);
                        const row = document.createElement('div');
                        row.style.cssText = 'display:flex; align-items:center; gap:8px;';
                        const sw = document.createElement('span'); sw.style.cssText = `width:12px; height:12px; background:${it.color}; display:inline-block; border-radius:2px;`;
                        const txt = document.createElement('span'); txt.textContent = `${it.label}: ${Math.round(it.value)}g (${pct}%)`; txt.style.color = 'inherit';
                        row.appendChild(sw); row.appendChild(txt); list.appendChild(row);
                    });
                    container.appendChild(list);
                }
            } catch (ee) { dbg(`Macro chart fallback error: ${ee && ee.message}`, 'error', ee); }
        }
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

    // Nutrition Quality Breakdown (replaces Health Score vs Macro)
    // Spirit: show how THIS day's meals rank in health quality, and what proportion of
    // total calories come from "quality" meals (score ≥ 7) vs "moderate" (4–6) vs "low" (1–3)
    try {
        const nqbEl = document.getElementById('ac-nqb-content');
        if (nqbEl) {
            nqbEl.innerHTML = '';

            const hasMacros = totalProtein > 0 || totalCarbs > 0 || totalFat > 0;
            const totalCals = filtered.reduce((s, e) => s + (parseFloat(e.calories) || 0), 0);

            // ── Calorie quality tiers ──
            const tiers = { high: 0, mid: 0, low: 0, unscored: 0 };
            filtered.forEach(e => {
                const hs = parseInt(e.healthScore, 10);
                const kcal = parseFloat(e.calories) || 0;
                if (isNaN(hs)) { tiers.unscored += kcal; }
                else if (hs >= 7) { tiers.high += kcal; }
                else if (hs >= 4) { tiers.mid  += kcal; }
                else              { tiers.low  += kcal; }
            });

            const scored = filtered.filter(e => !isNaN(parseInt(e.healthScore, 10)));
            const hasScores = scored.length > 0;

            // ── Overall day score ──
            if (hasScores && totalCals > 0) {
                const scoredCals = tiers.high + tiers.mid + tiers.low;
                // Weighted average: (kcal contribution of each meal × its score) / total scored cals
                const weightedScore = scored.reduce((s, e) => {
                    const hs = parseInt(e.healthScore, 10);
                    const kcal = parseFloat(e.calories) || 0;
                    return s + (hs * kcal);
                }, 0) / (scoredCals || 1);
                const pct = Math.round(weightedScore * 10);

                const scoreBar = document.createElement('div');
                scoreBar.className = 'nqb-score-row';
                scoreBar.innerHTML = `
                    <div class="nqb-score-label">Day Quality Score</div>
                    <div class="nqb-score-bar-wrap">
                        <div class="nqb-score-bar-fill" style="width:${pct}%; background:${weightedScore >= 7 ? '#34c759' : weightedScore >= 4 ? '#ff9500' : '#ff3b30'};"></div>
                    </div>
                    <div class="nqb-score-number" style="color:${weightedScore >= 7 ? '#34c759' : weightedScore >= 4 ? '#ff9500' : '#ff3b30'}">${weightedScore.toFixed(1)} / 10</div>`;
                nqbEl.appendChild(scoreBar);

                // ── Tier breakdown bar ──
                if (scoredCals > 0) {
                    const tierWrap = document.createElement('div');
                    tierWrap.className = 'nqb-tier-wrap';
                    tierWrap.innerHTML = `<div class="nqb-tier-label">Calories by Quality</div>`;
                    const bar = document.createElement('div');
                    bar.className = 'nqb-tier-bar';
                    [
                        { val: tiers.high,     color: '#34c759', lbl: '🟢 Quality' },
                        { val: tiers.mid,      color: '#ff9500', lbl: '🟡 Moderate' },
                        { val: tiers.low,      color: '#ff3b30', lbl: '🔴 Low' },
                    ].forEach(t => {
                        if (t.val <= 0) return;
                        const seg = document.createElement('div');
                        seg.className = 'nqb-tier-seg';
                        const w = Math.round((t.val / totalCals) * 100);
                        seg.style.cssText = `width:${w}%; background:${t.color};`;
                        seg.title = `${t.lbl}: ${Math.round(t.val)} kcal`;
                        bar.appendChild(seg);
                    });
                    tierWrap.appendChild(bar);
                    const legend = document.createElement('div');
                    legend.className = 'nqb-tier-legend';
                    [
                        { val: tiers.high, color: '#34c759', lbl: 'Quality (7–10)' },
                        { val: tiers.mid,  color: '#ff9500', lbl: 'Moderate (4–6)' },
                        { val: tiers.low,  color: '#ff3b30', lbl: 'Low (1–3)' },
                    ].filter(t => t.val > 0).forEach(t => {
                        const pctTier = Math.round((t.val / totalCals) * 100);
                        const item = document.createElement('div');
                        item.className = 'nqb-tier-item';
                        item.innerHTML = `<span class="nqb-dot" style="background:${t.color}"></span><span>${t.lbl}: <b>${pctTier}%</b> (${Math.round(t.val)} kcal)</span>`;
                        legend.appendChild(item);
                    });
                    tierWrap.appendChild(legend);
                    nqbEl.appendChild(tierWrap);
                }
            }

            // ── Per-meal health score mini list ──
            const scoredMeals = filtered.filter(e => !isNaN(parseInt(e.healthScore, 10)));
            if (scoredMeals.length > 0) {
                const listWrap = document.createElement('div');
                listWrap.className = 'nqb-meal-list';
                const listTitle = document.createElement('div');
                listTitle.className = 'nqb-meal-list-title';
                listTitle.textContent = 'Health Score per Meal';
                listWrap.appendChild(listTitle);
                scoredMeals.sort((a, b) => parseInt(b.healthScore) - parseInt(a.healthScore)).forEach(e => {
                    const hs = parseInt(e.healthScore, 10);
                    const color = hs >= 7 ? '#34c759' : hs >= 4 ? '#ff9500' : '#ff3b30';
                    const row = document.createElement('div');
                    row.className = 'nqb-meal-row';
                    row.innerHTML = `
                        <div class="nqb-meal-name">${e.food || 'Meal'}</div>
                        <div class="nqb-meal-bar-wrap">
                            <div class="nqb-meal-bar" style="width:${hs*10}%; background:${color};"></div>
                        </div>
                        <div class="nqb-meal-score" style="color:${color};">${hs}/10</div>`;
                    listWrap.appendChild(row);
                });
                nqbEl.appendChild(listWrap);
            }

            if (!hasScores) {
                nqbEl.innerHTML = '<div style="text-align:center; padding:24px; color:var(--text-secondary); font-size:14px;">Add health scores to your meals to see the Nutrition Quality Breakdown.</div>';
            }
        }
    } catch (e) { dbg(`NQB chart error: ${e && e.message}`, 'error', e); }
}

// --- CLEAR DATA ---
async function clearAllData() {
    const proceed = await showConfirm('This will delete all local data. Data on GitHub will not be affected. Continue?');
    if (!proceed) return;
    state.entries = [];
    state.sha = "";
    render();
    renderHistory();
    dbg('Local data cleared', 'info');
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

// ── Theme management ──────────────────────────────────────────────────────────
function applyTheme(mode) {
    const html = document.documentElement;
    if (mode === 'dark') {
        html.setAttribute('data-theme', 'dark');
    } else if (mode === 'light') {
        html.setAttribute('data-theme', 'light');
    } else {
        html.removeAttribute('data-theme');
    }
    // Update the non-media theme-color meta so Safari toolbar matches
    const meta = document.getElementById('theme-color-meta');
    if (meta) {
        const isDark = mode === 'dark' ||
            (mode === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        meta.content = isDark ? '#000000' : '#ffffff';
    }
}

function setTheme(mode) {
    localStorage.setItem('gt_theme', mode);
    applyTheme(mode);
}

function initTheme() {
    const saved = localStorage.getItem('gt_theme') || 'auto';
    applyTheme(saved);
    const sel = document.getElementById('theme-mode');
    if (sel) sel.value = saved;
    // Reapply when system preference changes (only matters in auto mode)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const current = localStorage.getItem('gt_theme') || 'auto';
        if (current === 'auto') applyTheme('auto');
    });
}
// ─────────────────────────────────────────────────────────────────────────────

window.onload = async () => {
    initTheme();
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
    // Attempt to load persisted settings from the repository (if configured)
    try { await loadSettingsFromRepo(); } catch (e) { dbg('loadSettingsFromRepo failed', 'debug', e); }
    // Load budget separately — budget.json takes precedence over settings.json for dailyBudget
    try { await loadBudgetFromRepo(); } catch (e) { dbg('loadBudgetFromRepo failed', 'debug', e); }

    // Load streak from repo or local cache and update UI (do not auto-recompute)
    try {
        await loadStreakFromRepoOrCache();
        try { updateStreakUI(); } catch (e) {}
    } catch (e) { dbg('loadStreakFromRepoOrCache failed', 'debug', e); }

    // Initialize weight-editing setting checkbox from merged config
    try {
        const allowChk = document.getElementById('cfg-allow-edit-weights');
        if (allowChk) {
            allowChk.checked = !!getConfig('allowEditOlderWeights');
            try { allowChk.addEventListener('change', (e) => toggleAllowEditWeights(e.target.checked)); } catch (e) {}
        }
    } catch (e) { /* ignore */ }

    // Initialize show-toasts setting checkbox
    try {
        const toastChk = document.getElementById('cfg-show-toasts');
        if (toastChk) {
            toastChk.checked = !!getConfig('showToasts');
            try { toastChk.addEventListener('change', (e) => toggleShowToasts(e.target.checked)); } catch (e) {}
        }
    } catch (e) { /* ignore */ }

    // Attach click handler to Toggles button as a robust fallback to inline onclick
    try {
        const openBtn = document.getElementById('open-toggles-btn');
        if (openBtn) openBtn.addEventListener('click', (e) => { try { openTogglesPopup(); } catch (err) { dbg('open-toggles-btn click failed', 'error', err); } });
    } catch (e) { /* ignore */ }

    // Ensure popup/toggle functions are available globally for inline onclick attributes
    try {
        if (typeof openTogglesPopup === 'function') window.openTogglesPopup = openTogglesPopup;
        if (typeof closeTogglesPopup === 'function') window.closeTogglesPopup = closeTogglesPopup;
        if (typeof toggleShowToasts === 'function') window.toggleShowToasts = toggleShowToasts;
        if (typeof toggleAllowEditWeights === 'function') window.toggleAllowEditWeights = toggleAllowEditWeights;
    } catch (e) { dbg('Failed to export toggle functions to window', 'debug', e); }

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
    
    // Initialize date input placeholders (start/end)
    const startInit = document.getElementById('filter-date-start');
    if (startInit) startInit.setAttribute('placeholder', 'Start');
    const endInit = document.getElementById('filter-date-end');
    if (endInit) endInit.setAttribute('placeholder', 'End');
    try { updateApplyButtonState(); } catch (e) {}

    // Restore last active page from URL hash (survives browser refresh)
    const validPages = ['tracker', 'history', 'analytics', 'settings', 'logs'];
    const hashPage = window.location.hash.replace('#', '');
    if (validPages.includes(hashPage)) {
        showPage(hashPage);
    }

    // Ensure date button and tracker render initialize even if no fetch occurs
    try {
        updateDateButton();
        updateBudgetUI();
        render();
    } catch (e) { /* ignore if DOM not ready */ }

    // Auto-save is always on; no unload warning necessary.
    window.addEventListener('beforeunload', (e) => {});

    // Ensure example CSV shows today's date and current time (AM/PM) and includes healthScore
    try {
        const pre = document.getElementById('example-csv');
        if (pre) {
            const today = getTodayString();
            const now = new Date();
            const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true });
            pre.textContent = `date,time,food,calories,protein,carbs,fat,healthScore\n${today},${timeStr},Eggs (2 whole + 2 whites),220,20.0,2.0,10.0,7\n${today},,Korean BBQ noodles (90 g),289,7.4,37.4,12.2,6`;
        }
    } catch (e) { dbg('Failed to set example CSV: ' + (e && e.message), 'debug'); }
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
        const healthScoreIdx = header.findIndex(h => h.includes('score') || h.includes('health'));

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
                timestamp: (() => {
                    // Build timestamp from date+time when the CSV provides a time value
                    // so history sort order and display reflect the actual meal time
                    if (time !== 'Current Time') {
                        try {
                            const ts = new Date(date + ' ' + time);
                            if (!isNaN(ts.getTime())) return ts.toISOString();
                        } catch(e) {}
                    }
                    return new Date().toISOString();
                })(),
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

            if (healthScoreIdx >= 0 && values[healthScoreIdx]) {
                const hs = parseInt(values[healthScoreIdx], 10);
                if (!isNaN(hs)) entry.healthScore = hs;
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
        card.className = 'csv-card';

        // ── food name ──────────────────────────────────────────
        const foodInput = document.createElement('input');
        foodInput.type = 'text';
        foodInput.value = entry.food || '';
        foodInput.placeholder = 'Food name';
        foodInput.className = 'csv-inp csv-food';

        // ── details row: calories | date | time ────────────────
        const detailRow = document.createElement('div');
        detailRow.className = 'csv-detail-row';

        const caloriesInput = document.createElement('input');
        caloriesInput.type = 'number';
        caloriesInput.value = entry.calories || 0;
        caloriesInput.placeholder = 'kcal';
        caloriesInput.className = 'csv-inp csv-cal';

        const dateInput = document.createElement('input');
        dateInput.type = 'date';
        try {
            const parsed = new Date(entry.date);
            if (!isNaN(parsed.getTime())) dateInput.value = parsed.toISOString().split('T')[0];
        } catch (e) {}
        dateInput.className = 'csv-inp csv-date';

        const timeInput = document.createElement('input');
        timeInput.type = 'time';
        timeInput.value = entry.time && entry.time !== 'Current Time' ? _timeTo24(entry.time) : '';
        timeInput.className = 'csv-inp csv-time';

        detailRow.appendChild(caloriesInput);
        detailRow.appendChild(dateInput);
        detailRow.appendChild(timeInput);

        // ── macros row: protein | carbs | fat | score ──────────
        const macroRow = document.createElement('div');
        macroRow.className = 'csv-macro-row';

        const proteinInput = document.createElement('input');
        proteinInput.type = 'number'; proteinInput.value = entry.protein || '';
        proteinInput.placeholder = 'Protein g'; proteinInput.className = 'csv-inp';

        const carbsInput = document.createElement('input');
        carbsInput.type = 'number'; carbsInput.value = entry.carbs || '';
        carbsInput.placeholder = 'Carbs g'; carbsInput.className = 'csv-inp';

        const fatInput = document.createElement('input');
        fatInput.type = 'number'; fatInput.value = entry.fat || '';
        fatInput.placeholder = 'Fat g'; fatInput.className = 'csv-inp';

        const scoreInput = document.createElement('select');
        scoreInput.className = 'csv-inp';
        const emptyScore = document.createElement('option');
        emptyScore.value = ''; emptyScore.textContent = 'Score';
        scoreInput.appendChild(emptyScore);
        for (let s = 1; s <= 10; s++) {
            const o = document.createElement('option');
            o.value = String(s); o.textContent = String(s);
            if (entry.healthScore && parseInt(entry.healthScore, 10) === s) o.selected = true;
            scoreInput.appendChild(o);
        }

        macroRow.appendChild(proteinInput);
        macroRow.appendChild(carbsInput);
        macroRow.appendChild(fatInput);
        macroRow.appendChild(scoreInput);

        // ── remove button ───────────────────────────────────────
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-secondary csv-remove-btn';
        removeBtn.textContent = '✕ Remove';
        removeBtn.onclick = () => { csvParsedData.splice(idx, 1); displayCsvPreview(); };

        card.appendChild(foodInput);
        card.appendChild(detailRow);
        card.appendChild(macroRow);
        card.appendChild(removeBtn);

        // ── live sync back to csvParsedData ────────────────────
        const commitChanges = () => {
            const updDate = dateInput.value || entry.date;
            const updTime24 = timeInput.value;
            const updated = {
                food: foodInput.value.trim(),
                calories: parseFloat(caloriesInput.value) || 0,
                date: updDate,
                time: updTime24 ? _time24to12(updTime24) : (entry.time || ''),
            };
            if (updDate && updTime24) {
                try {
                    const ts = new Date(`${updDate}T${updTime24}`);
                    if (!isNaN(ts.getTime())) updated.timestamp = ts.toISOString();
                } catch (e) {}
            }
            const p = parseFloat(proteinInput.value);
            if (!isNaN(p)) updated.protein = p; else delete updated.protein;
            const c = parseFloat(carbsInput.value);
            if (!isNaN(c)) updated.carbs = c; else delete updated.carbs;
            const f = parseFloat(fatInput.value);
            if (!isNaN(f)) updated.fat = f; else delete updated.fat;
            const hs = parseInt(scoreInput.value, 10);
            if (!isNaN(hs)) updated.healthScore = hs; else delete updated.healthScore;
            csvParsedData[idx] = { ...entry, ...updated };
            document.getElementById('csv-count').textContent = csvParsedData.length;
        };

        [foodInput, caloriesInput, dateInput, timeInput, proteinInput, carbsInput, fatInput, scoreInput].forEach(inp => {
            inp.addEventListener('change', commitChanges);
            inp.addEventListener('input', commitChanges);
        });

        list.appendChild(card);
    });

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

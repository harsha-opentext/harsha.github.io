// Core state and helpers (moved from app.js)
// --- Editing State ---
let editingTaskId = null;

// State
let state = {
    todos: [],
    sha: "",
    filter: "all",
    hasUnsavedChanges: false,
    autoSyncing: false
};
// Tag filter state
state.tags = [];
state.activeTagFilter = null; // when set, filter by this tag

// Search state
state.searchQuery = '';
// Fuse.js instance
state.fuse = null;
state.fuseOptions = {
    keys: ['text', 'description'],
    threshold: 0.4,
    ignoreLocation: true,
    includeScore: true,
    minMatchCharLength: 1
};

// Logging state and levels
state.logs = [];
state.retentionMinutes = 5;
state.logLevel = 'info';

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };

function dbg(msg, type = 'info', raw = null) {
    const currentLevel = LOG_LEVELS[state.logLevel] || 1;
    const messageLevel = LOG_LEVELS[type] || 1;
    if (messageLevel < currentLevel) return;
    const screen = document.getElementById('log-screen');
    if (!screen) return;
    const item = document.createElement('div');
    item.className = `log-item ${type === 'error' ? 'log-error' : type === 'warn' ? 'log-warn' : type === 'debug' ? 'log-debug' : ''}`;
    const timestamp = new Date().toLocaleTimeString();
    let text = `[${timestamp}] [${type.toUpperCase()}] ${msg}`;
    if (raw) text += `\nRAW: ${JSON.stringify(raw, null, 2)}`;
    item.innerText = text;
    screen.prepend(item);
    try { state.logs.unshift({ ts: Date.now(), text, type }); pruneLogs(); } catch (e) { /* ignore */ }
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

function updateRetention() { const sel = document.getElementById('log-retention'); if (!sel) return; state.retentionMinutes = parseInt(sel.value,10); dbg(`Log retention set to ${state.retentionMinutes === 0 ? 'unlimited' : state.retentionMinutes + ' minutes'}`, 'debug'); pruneLogs(); }

function updateLogLevel() { const sel = document.getElementById('log-level'); if (!sel) return; state.logLevel = sel.value; dbg(`Log level changed to: ${sel.value.toUpperCase()}`, 'info'); }

async function copyLogs() { const txt = state.logs.map(l => l.text).join('\n\n'); try { await navigator.clipboard.writeText(txt); dbg('Logs copied to clipboard.'); } catch (e) { const ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); dbg('Logs copied (fallback).'); } }

async function saveLogs() {
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    if (!token || !repo) { dbg('Cannot save logs: Missing credentials', 'error'); alert('Please configure GitHub credentials in Settings first.'); return; }
    const logFile = 'app-todo-logs.txt';
    const url = `https://api.github.com/repos/${repo}/contents/${logFile}`;
    dbg('Saving logs to GitHub...', 'info');
    try {
        const timestamp = new Date().toISOString();
        const newLogContent = `\n\n=== Logs saved at ${timestamp} ===\n` + state.logs.map(l=>l.text).join('\n');
        let existingContent = '';
        let fileSha = null;
        try {
            const response = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/vnd.github.v3+json' } });
            if (response.ok) { const data = await response.json(); fileSha = data.sha; existingContent = atob(data.content); dbg(`Existing log file size: ${existingContent.length} bytes`, 'debug'); }
        } catch (err) { dbg('No existing log file found, will create new one', 'debug'); }
        let finalContent = existingContent + newLogContent;
        const body = { message: `Update logs: ${timestamp}`, content: btoa(finalContent) };
        if (fileSha) body.sha = fileSha;
        const res = await fetch(url, { method: 'PUT', headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (res.ok) { dbg('Logs saved to GitHub', 'info'); alert('Logs saved to ' + logFile); } else { const err = await res.json(); dbg(`Failed to save logs: ${err.message}`, 'error', err); alert('Failed to save logs. See logs panel.'); }
    } catch (err) { dbg(`Error saving logs: ${err.message}`, 'error'); alert('Error saving logs. See logs panel.'); }
}

function toggleLogs() { const panel = document.getElementById('log-panel'); if (!panel) return; const hidden = panel.getAttribute('aria-hidden') === 'true'; panel.setAttribute('aria-hidden', hidden ? 'false' : 'true'); if (!hidden) return; const screen = document.getElementById('log-screen'); if (screen) screen.scrollTop = 0; }

function rebuildFuse() {
    try {
        state.fuse = new Fuse(state.todos, state.fuseOptions);
    } catch (e) {
        dbg('Failed to initialize Fuse: ' + (e && e.message ? e.message : e), 'warn', e);
        state.fuse = null;
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDate(isoString) {
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function showNotification(message) {
    // Simple alert for now - can be enhanced later
    const notification = document.createElement('div');
    notification.className = 'notification';
    notification.textContent = message;
    notification.style.cssText = 'position: fixed; top: 80px; left: 50%; transform: translateX(-50%); background: var(--card-bg); padding: 12px 24px; border-radius: 20px; box-shadow: var(--shadow-lg); z-index: 1000; font-size: 14px; font-weight: 500;';
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.opacity = '0';
        notification.style.transition = 'opacity 0.3s';
        setTimeout(() => notification.remove(), 300);
    }, 2000);
}

function saveToLocalStorage() {
    localStorage.setItem('todos_backup', JSON.stringify(state.todos));
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        addTodo();
    }
}

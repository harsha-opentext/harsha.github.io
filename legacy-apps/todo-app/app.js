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

// Tag storage helpers
function loadTags() {
    // Try to load from local backup first
    const stored = localStorage.getItem('todo_tags');
    if (stored) {
        try {
            state.tags = JSON.parse(stored);
        } catch (e) { state.tags = []; }
    }
    // If GitHub configured, try to fetch config file and merge
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    if (token && repo) {
        const cfgPath = 'todo-app/app-todo-user-config.json';
        const url = `https://api.github.com/repos/${repo}/contents/${cfgPath}`;
        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(res => {
                if (!res.ok) throw new Error('no-config');
                return res.json();
            })
            .then(json => {
                try {
                    const content = decodeURIComponent(escape(atob(json.content)));
                    const cfg = JSON.parse(content);
                    if (cfg && Array.isArray(cfg.tags)) {
                        state.tags = cfg.tags.slice();
                        // persist local copy as backup
                        localStorage.setItem('todo_tags', JSON.stringify(state.tags));
                        populateTagSelects();
                        renderTagsList();
                    }
                } catch (e) {
                    dbg('Failed to parse user config from GitHub', 'warn', e);
                }
            }).catch(() => {
                // ignore if not present
            });
    }
    // Ensure default
    if (!state.tags || state.tags.length === 0) state.tags = ['in-progress'];
}

function saveTags() {
    localStorage.setItem('todo_tags', JSON.stringify(state.tags));
    // Also persist to GitHub user config file if configured
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    if (token && repo) {
        saveUserConfigToGit({ tags: state.tags }).catch(err => dbg('Failed to save user config to GitHub', 'warn', err));
    }
}

async function saveUserConfigToGit(obj) {
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    if (!token || !repo) throw new Error('github-not-configured');
    const cfgPath = 'todo-app/app-todo-user-config.json';
    const url = `https://api.github.com/repos/${repo}/contents/${cfgPath}`;
    // Try to fetch existing file to get SHA
    let sha = null;
    try {
        const r = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
        if (r.ok) {
            const j = await r.json();
            sha = j.sha;
        }
    } catch (e) {
        // ignore, we'll create new
    }

    const body = {
        message: 'Update user config: ' + new Date().toISOString(),
        content: btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))))
    };
    if (sha) body.sha = sha;

    const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!res.ok) {
        const te = await res.text();
        throw new Error('failed-push:' + te);
    }
    return await res.json();
}

function populateTagSelects() {
    const newSelect = document.getElementById('new-tags-select');
    const searchDropdown = document.getElementById('search-tag-dropdown');
    if (newSelect) {
        newSelect.innerHTML = '<option value="">No tag</option>' + state.tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }
    if (searchDropdown) {
        // will be populated when opened, but keep a minimal inline display when present
        searchDropdown.innerHTML = '<div class="tag-option" data-tag="">All tags</div>' + state.tags.map(t => `<div class="tag-option" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`).join('');
        // mark selection
        searchDropdown.querySelectorAll('.tag-option').forEach(el => {
            const tag = el.getAttribute('data-tag') || '';
            el.classList.toggle('selected', (!!state.activeTagFilter && state.activeTagFilter === tag));
        });
    }
}

function showCustomize() {
    showPage('customize');
    const mtEl = document.getElementById('max-tags-text'); if (mtEl) mtEl.textContent = getConfig('maxTags') || DEFAULT_CONFIG.maxTags;
    renderTagsList();
}

function closeCustomize() {
    showPage('main');
}

function renderTagsList() {
    const list = document.getElementById('tags-list');
    if (!list) return;
    list.innerHTML = state.tags.map(t => {
        const isDefault = (t === 'in-progress');
        return `<div style="display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#f2f2f7;margin-right:6px;">${escapeHtml(t)} ${isDefault ? '<span style="margin-left:8px;color:var(--text-secondary);font-size:12px;">(default)</span>' : `<button style="margin-left:8px;background:transparent;border:none;cursor:pointer;" data-tag="${escapeHtml(t)}" class="delete-tag-btn">✖️</button>`}</div>`;
    }).join('');
    // attach delete listeners
    list.querySelectorAll('.delete-tag-btn').forEach(btn => {
        btn.onclick = () => {
            const tag = btn.getAttribute('data-tag');
            state.tags = state.tags.filter(t => t !== tag);
            saveTags();
            populateTagSelects();
            renderTagsList();
        };
    });
}

function createTag(name) {
    const max = getConfig('maxTags') || DEFAULT_CONFIG.maxTags;
    if (!name) return { ok:false, msg:'Empty' };
    if (state.tags.includes(name)) return { ok:false, msg:'Exists' };
    if (state.tags.length >= max) return { ok:false, msg:'Limit' };
    state.tags.push(name);
    saveTags();
    populateTagSelects();
    renderTagsList();
    return { ok:true };
}

// Update tag-filter UI: clear button visibility and blinking state
function updateTagFilterUI() {
    const tagFilterBtn = document.getElementById('tag-filter-btn');
    const clearTagBtn = document.getElementById('clear-tag-filter-btn');
    if (!tagFilterBtn) return;
    if (state.activeTagFilter) {
        if (clearTagBtn) clearTagBtn.style.display = 'inline-flex';
        tagFilterBtn.classList.add('tag-blink-pulse');
    } else {
        if (clearTagBtn) clearTagBtn.style.display = 'none';
        tagFilterBtn.classList.remove('tag-blink-pulse');
    }
}

// Initialize
window.onload = async () => {
    const t = localStorage.getItem('todo_token');
    const r = localStorage.getItem('todo_repo');
    if (t) document.getElementById('cfg-token').value = t;
    if (r) document.getElementById('cfg-repo').value = r;
    
    // Load auto-save config
    const autoSave = getConfig('autoSave');
    document.getElementById('cfg-autosave').checked = autoSave;
    updateAutoSaveUI();
    
    // Load from localStorage as backup
    const stored = localStorage.getItem('todos_backup');
    if (stored) {
        try {
            state.todos = JSON.parse(stored);
            // Ensure backward compatibility: add important flag if missing
            state.todos = state.todos.map(t => ({ important: false, description: '', tags: [], ...t }));
        } catch (e) {
            dbg('Failed to load backup: ' + (e && e.message ? e.message : e), 'error', e);
        }
    }
    // Build search index from backup data
    rebuildFuse();

    // Initialize log UI if present
    const ll = document.getElementById('log-level'); if (ll) ll.value = state.logLevel;
    const lr = document.getElementById('log-retention'); if (lr) lr.value = String(state.retentionMinutes);
    dbg('Todo app started', 'info');
    
    // Try to fetch from GitHub
    if (t && r) {
        await fetchFromGit();
    }
    
    // Wire search input
    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');
    if (searchInput) {
        let searchDebounce = null;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                state.searchQuery = e.target.value.trim();
                render();
            }, 200);
        });
    }
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            const si = document.getElementById('searchInput');
            if (si) si.value = '';
            state.searchQuery = '';
            render();
        });
    }

    // Load tags and populate selects
    loadTags();
    populateTagSelects();
    updateTagFilterUI();

    // Customize modal create tag
    const createTagBtn = document.getElementById('create-tag-btn');
    const newTagInput = document.getElementById('new-tag-input');
    if (createTagBtn && newTagInput) {
        createTagBtn.onclick = () => {
            const name = newTagInput.value.trim();
            const res = createTag(name);
            if (res.ok) {
                newTagInput.value = '';
            } else {
                alert(res.msg);
            }
        };
    }
    const clearAllTagsBtn = document.getElementById('clear-all-tags-btn');
    if (clearAllTagsBtn) {
        clearAllTagsBtn.onclick = () => {
            if (!confirm('Clear all tags? This will remove all tags except the default in-progress.')) return;
            state.tags = ['in-progress'];
            saveTags();
            populateTagSelects();
            renderTagsList();
            render();
        };
    }

    // Tag filter button near search
    const tagFilterBtn = document.getElementById('tag-filter-btn');
    const searchTagDropdown = document.getElementById('search-tag-dropdown');
    if (tagFilterBtn && searchTagDropdown) {
        // Populate dropdown
        function populateSearchDropdown() {
            const items = [''].concat(state.tags);
            searchTagDropdown.innerHTML = items.map(t => {
                if (!t) return `<div class="tag-option" data-tag="">All tags</div>`;
                return `<div class="tag-option" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`;
            }).join('');
            // mark selected
            searchTagDropdown.querySelectorAll('.tag-option').forEach(el => {
                const tag = el.getAttribute('data-tag') || '';
                el.classList.toggle('selected', (!!state.activeTagFilter && state.activeTagFilter === tag));
                el.onclick = (e) => {
                    const v = el.getAttribute('data-tag') || null;
                    state.activeTagFilter = v || null;
                    searchTagDropdown.style.display = 'none';
                    render();
                    // Keep blinking while a tag filter is active
                    const btn = document.getElementById('tag-filter-btn');
                    const clearBtnEl = document.getElementById('clear-tag-filter-btn');
                    if (btn) {
                        btn.classList.remove('tag-blink');
                        void btn.offsetWidth;
                        btn.classList.add('tag-blink-pulse');
                    }
                    if (clearBtnEl) clearBtnEl.style.display = 'inline-flex';
                    e.stopPropagation();
                };
            });
        }

        // Show/hide dropdown on button click
        tagFilterBtn.onclick = (e) => {
            if (searchTagDropdown.style.display === 'none' || !searchTagDropdown.style.display) {
                populateSearchDropdown();
                searchTagDropdown.style.display = 'block';
            } else {
                searchTagDropdown.style.display = 'none';
            }
            e.stopPropagation();
        };

        // Clear active tag filter button
        const clearTagBtn = document.getElementById('clear-tag-filter-btn');
        function updateClearTagBtn() {
            if (!clearTagBtn) return;
            if (state.activeTagFilter) {
                clearTagBtn.style.display = 'inline-flex';
                // keep blinking while active
                tagFilterBtn.classList.add('tag-blink-pulse');
            } else {
                clearTagBtn.style.display = 'none';
                tagFilterBtn.classList.remove('tag-blink-pulse');
            }
        }
        updateClearTagBtn();
        if (clearTagBtn) {
            clearTagBtn.onclick = (e) => {
                state.activeTagFilter = null;
                updateClearTagBtn();
                render();
                e.stopPropagation();
            };
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (ev) => {
            const target = ev.target;
            if (!target.closest('#search-tag-dropdown') && !target.closest('#tag-filter-btn')) {
                if (searchTagDropdown) searchTagDropdown.style.display = 'none';
            }
        });
    }

    render();
    // Wire new-item star button
    const newStar = document.getElementById('new-star-btn');
    if (newStar) {
        newStar.onclick = () => {
            newStar.classList.toggle('starred');
            newStar.textContent = newStar.classList.contains('starred') ? '★' : '☆';
        };
    }
    // Wire new-item info button and textarea
    const newInfoBtn = document.getElementById('new-info-btn');
    const newDescWrapper = document.getElementById('new-desc-wrapper');
    const newDesc = document.getElementById('new-desc');
    const newDescCount = document.getElementById('new-desc-count');
    const newDescMax = document.getElementById('new-desc-max');
    const maxLen = getConfig('descriptionMaxLength') || 2000;
    if (newDescMax) newDescMax.textContent = maxLen;
    if (newInfoBtn && newDescWrapper) {
        newInfoBtn.onclick = () => {
            if (newDescWrapper.style.display === 'none') {
                newDescWrapper.style.display = 'block';
                newDesc.focus();
            } else {
                newDescWrapper.style.display = 'none';
            }
        };
    }
    if (newDesc) {
        newDesc.addEventListener('input', () => {
            const v = newDesc.value || '';
            if (v.length > maxLen) {
                newDesc.value = v.slice(0, maxLen);
            }
                    if (newDescCount) newDescCount.textContent = newDesc.value.length;
        });
    }
    // Render new desc button
    const renderNewBtn = document.getElementById('render-new-desc');
    if (renderNewBtn) {
        renderNewBtn.onclick = () => {
            const text = (document.getElementById('new-desc')||{value:''}).value || '';
            openMarkdownModal(text);
        };
    }
};

// Warn user about unsaved changes before leaving only when auto-save is OFF
window.addEventListener('beforeunload', (e) => {
    try {
        const autoSaveEnabled = getConfig('autoSave');
        if (!autoSaveEnabled && state.hasUnsavedChanges) {
            const msg = 'Auto-save is off and you have unsaved changes. These changes will NOT be stored if you leave or refresh.';
            e.preventDefault();
            e.returnValue = msg;
            return msg;
        }
    } catch (err) {
        if (state.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = '';
            return '';
        }
    }
});

// Add Todo
function addTodo() {
    const input = document.getElementById('todo-input');
    const text = input.value.trim();
    
    if (!text) return;
    
    const newStar = document.getElementById('new-star-btn');
    const todo = {
        id: Date.now(),
        text: text,
        completed: false,
        important: newStar ? newStar.classList.contains('starred') : false,
        description: (document.getElementById('new-desc') && document.getElementById('new-desc').value) ? document.getElementById('new-desc').value.trim() : '',
        tags: (() => { const s = document.getElementById('new-tags-select'); return s && s.value ? [s.value] : []; })(),
        createdAt: new Date().toISOString()
    };

    // Handle expiry: allow setting expires in N days via #new-expire-select
    try {
        const expireSelect = document.getElementById('new-expire-select');
        if (expireSelect && expireSelect.value) {
            const days = parseInt(expireSelect.value, 10);
            if (!isNaN(days) && days > 0) {
                const expires = new Date();
                expires.setDate(expires.getDate() + days);
                todo.expiresAt = expires.toISOString();
            }
        }
    } catch (e) { /* ignore */ }
    
    state.todos.unshift(todo);
    state.hasUnsavedChanges = true;
    input.value = '';
    // Clear description and reset new-item controls
    const newDescEl = document.getElementById('new-desc');
    if (newDescEl) {
        newDescEl.value = '';
        const cnt = document.getElementById('new-desc-count'); if (cnt) cnt.textContent = '0';
        const wrapper = document.getElementById('new-desc-wrapper'); if (wrapper) wrapper.style.display = 'none';
    }
    if (newStar) { newStar.classList.remove('starred'); newStar.textContent = '☆'; }
    // Reset expiry select
    const expireSelect = document.getElementById('new-expire-select'); if (expireSelect) expireSelect.value = '';
    const newInfoBtn = document.getElementById('new-info-btn'); if (newInfoBtn) {/* no visual toggle for info button */}
    
    rebuildFuse();
    
    saveToLocalStorage();
    render();
    
    // Auto-save if enabled
    if (getConfig('autoSave')) {
        autoSave();
    }
}

// Simple markdown -> HTML renderer (very small subset)
function renderMarkdown(md) {
    if (!md) return '';
    // Use marked + DOMPurify if available
    try {
        if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            const html = marked.parse(md);
            return DOMPurify.sanitize(html);
        }
    } catch (e) {
        dbg('marked/DOMPurify render failed, falling back', 'warn', e);
    }
    // Fallback to simple renderer
    // Escape HTML
    let s = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // Code blocks (```) - simple
    s = s.replace(/```([\s\S]*?)```/g, (m, p1) => `<pre><code>${p1.replace(/</g,'&lt;')}</code></pre>`);
    // Inline code
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    // Bold **text**
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    // Italic *text*
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    // Links [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    // Line breaks -> paragraphs
    s = s.split('\n\n').map(p => p.replace(/\n/g,'<br/>')).map(p => `<p>${p}</p>`).join('');
    return s;
}

// Open modal and render sanitized markdown (read-only)
function openMarkdownModal(mdText) {
    const mdModal = document.getElementById('md-modal');
    const mdBody = document.getElementById('md-body');
    if (!mdModal || !mdBody) return;
    const html = renderMarkdown(mdText || '');
    mdBody.innerHTML = html || '<div style="color:var(--text-secondary)">Empty</div>';
    mdModal.style.display = 'flex';
}

// Whenever todos are modified programmatically, call rebuildFuse
const origPushToState = pushToGit;

// Toggle Todo
function toggleTodo(id) {
    const todo = state.todos.find(t => t.id === id);
    if (todo) {
        todo.completed = !todo.completed;
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        rebuildFuse();
        render();
        
        // Auto-save if enabled
        const autoSaveEnabled = getConfig('autoSave');
        dbg('Auto-save enabled: ' + !!autoSaveEnabled, 'debug');
        if (autoSaveEnabled) {
            dbg('Triggering auto-save...', 'debug');
            autoSave();
        }
    }
}

// Delete Todo
function deleteTodo(id) {
    if (confirm('Delete this todo?')) {
        state.todos = state.todos.filter(t => t.id !== id);
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        rebuildFuse();
        render();
        
        // Auto-save if enabled
        if (getConfig('autoSave')) {
            autoSave();
        }
    }
}

// Filter
function setFilter(filter) {
    state.filter = filter;
    document.querySelectorAll('.filter-tab').forEach(tab => {
        tab.classList.toggle('active', tab.dataset.filter === filter);
    });
    render();
}

// Get Filtered Todos
function getFilteredTodos() {
    // Start from all todos
    let base = state.todos.slice();
    // Apply tag filter first (if any)
    if (state.activeTagFilter) {
        base = base.filter(t => Array.isArray(t.tags) && t.tags.includes(state.activeTagFilter));
    }
    // Apply status filter
    if (state.filter === 'active') {
        base = base.filter(t => !t.completed);
    } else if (state.filter === 'completed') {
        base = base.filter(t => t.completed);
    } else if (state.filter === 'important') {
        base = base.filter(t => t.important && !t.completed);
    }

    // If no search, return base
    if (!state.searchQuery) return base;
    // Use Fuse.js when available but restrict to base subset
    if (state.fuse) {
        // Temporarily create a fuse instance for the base subset to respect prior filters
        try {
            const f = new Fuse(base, state.fuseOptions);
            const results = f.search(state.searchQuery);
            return results.map(r => r.item);
        } catch (e) {
            dbg('Fuse search failed on subset, falling back', 'warn', e);
        }
    }
    // Fallback simple substring match
    const q = state.searchQuery.toLowerCase();
    return base.filter(t => (t.text || '').toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q));
}

// Render
function render() {
    const container = document.getElementById('todo-list');
    const emptyState = document.getElementById('empty-state');
    const filtered = getFilteredTodos();
    
    // Update counts
    const total = state.todos.length;
    const active = state.todos.filter(t => !t.completed).length;
    const completed = state.todos.filter(t => t.completed).length;
    // Important count should reflect important tasks that are not completed
    const important = state.todos.filter(t => t.important && !t.completed).length;
    
    const ca = document.getElementById('count-all'); if (ca) ca.textContent = total;
    const ca2 = document.getElementById('count-active'); if (ca2) ca2.textContent = active;
    const cc = document.getElementById('count-completed'); if (cc) cc.textContent = completed;
    const tt = document.getElementById('total-todos-count'); if (tt) tt.textContent = total;
    // Update important count if present in DOM
    const impEl = document.getElementById('count-important');
    if (impEl) impEl.textContent = important;

    // Keep tag-filter UI in sync
    try { updateTagFilterUI(); } catch (e) {}
    
    // Show empty state if no todos after filtering/search
    if (filtered.length === 0) {
        if (container) container.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        // Show helpful hint when search is active
        const hint = state.searchQuery ? `No results for "${state.searchQuery}"` : 'No todos yet';
        if (emptyState) {
            const p = emptyState.querySelector('p'); if (p) p.textContent = hint;
        }
        return;
    }
    
    container.style.display = 'block';
    emptyState.style.display = 'none';
    
    // Render todos
    container.innerHTML = filtered.map((todo, idx) => {
        if (editingTaskId === todo.id) {
            return `
                <div class="todo-item editing">
                    <input type="text" class="edit-input" value="${escapeHtml(todo.text)}" />
                    <div class="todo-actions">
                        <button class="save-edit-btn" data-id="${todo.id}">💾</button>
                        <button class="cancel-edit-btn" data-id="${todo.id}">✖️</button>
                    </div>
                </div>
            `;
        } else {
            return `
                <div class="todo-item ${todo.completed ? 'completed' : ''}">
                    <button class="checkbox ${todo.completed ? 'checked' : ''}" onclick="toggleTodo(${todo.id})">
                        ${todo.completed ? '✓' : ''}
                    </button>
                    <div class="todo-content">
                        <div class="todo-text">${escapeHtml(todo.text)}</div>
                        <div class="todo-date">${formatDate(todo.createdAt)}</div>
                    </div>
                    <button class="edit-btn" data-id="${todo.id}">✏️</button>
                    <button class="star-btn item ${todo.important ? 'starred' : ''}" data-id="${todo.id}" title="Mark important">${todo.important ? '★' : '☆'}</button>
                    <button class="delete-btn" onclick="deleteTodo(${todo.id})">🗑️</button>
                    <div class="todo-description" id="desc-${todo.id}" style="display:none; margin-top:8px; width:100%;">
                        <textarea class="desc-input" data-id="${todo.id}" rows="3" style="width:100%; padding:10px; border-radius:10px; border:1px solid #ddd;">${escapeHtml(todo.description || '')}</textarea>
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;">
                            <div style="display:flex;align-items:center;gap:8px;"><button class="render-desc-btn render-btn" data-id="${todo.id}">Render</button><div style="font-size:13px;color:var(--text-secondary);">Preview (off by default)</div></div>
                            <div style="font-size:13px;color:var(--text-secondary);"><span class="desc-count" data-id="${todo.id}">${(todo.description||'').length}</span>/<span class="desc-max">${getConfig('descriptionMaxLength')||2000}</span></div>
                        </div>
                        <div style="display:flex;gap:8px;margin-top:8px;">
                            <button class="save-desc-btn" data-id="${todo.id}">Save</button>
                            <button class="cancel-desc-btn" data-id="${todo.id}">Close</button>
                        </div>
                    </div>
                </div>
            `;
        }
    }).join('');

    // Attach edit/save/cancel listeners after rendering
    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = Number(btn.getAttribute('data-id'));
            startEdit(id);
        };
    });
    document.querySelectorAll('.save-edit-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = Number(btn.getAttribute('data-id'));
            saveEdit(id);
        };
    });
    document.querySelectorAll('.cancel-edit-btn').forEach(btn => {
        btn.onclick = (e) => {
            cancelEdit();
        };
    });

    // Attach star toggle listeners for each rendered item (star is placed next to edit button)
    document.querySelectorAll('.star-btn.item').forEach(btn => {
        btn.onclick = (e) => {
            const id = Number(btn.getAttribute('data-id'));
            toggleImportant(id);
            e.stopPropagation();
        };
    });
    // Toggle description panel by clicking the todo row (ignore clicks on buttons/inputs)
    document.querySelectorAll('.todo-item').forEach(item => {
        item.onclick = (e) => {
            // Ignore clicks that originate from interactive controls
            if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('a')) return;
            const panel = item.querySelector('.todo-description');
            if (!panel) return;
            panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
            // Do not auto-render preview; rendering is explicit via Render button
        };
    });
    // Attach description input handlers (count + live preview)
    document.querySelectorAll('.desc-input').forEach(ta => {
        const id = ta.getAttribute('data-id');
        const maxLen = getConfig('descriptionMaxLength') || 2000;
        const countEl = document.querySelector(`.desc-count[data-id="${id}"]`);
        const previewEl = document.querySelector(`.desc-preview[data-id="${id}"]`);
        ta.addEventListener('input', () => {
            if (ta.value.length > maxLen) ta.value = ta.value.slice(0, maxLen);
            if (countEl) countEl.textContent = ta.value.length;
            if (previewEl) previewEl.innerHTML = renderMarkdown(ta.value || '');
        });
        // Initialize preview
        if (previewEl) previewEl.innerHTML = renderMarkdown(ta.value || '');
    });
    // Attach save/close handlers for description
    document.querySelectorAll('.save-desc-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = Number(btn.getAttribute('data-id'));
            const panel = document.getElementById(`desc-${id}`);
            if (!panel) return;
            const ta = panel.querySelector('.desc-input');
            if (!ta) return;
            const idx = state.todos.findIndex(t => t.id === id);
            if (idx !== -1) {
                state.todos[idx].description = ta.value.trim();
                state.hasUnsavedChanges = true;
                saveToLocalStorage();
                rebuildFuse();
                if (getConfig('autoSave')) autoSave();
            }
            panel.style.display = 'none';
        };
    });
    document.querySelectorAll('.cancel-desc-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = Number(btn.getAttribute('data-id'));
            const panel = document.getElementById(`desc-${id}`);
            if (panel) panel.style.display = 'none';
        };
    });

    // Attach render (open modal) handlers for per-item descriptions
    document.querySelectorAll('.render-desc-btn').forEach(btn => {
        btn.onclick = (e) => {
            const id = Number(btn.getAttribute('data-id'));
            const ta = document.querySelector(`.desc-input[data-id="${id}"]`);
            const text = ta ? ta.value : '';
            openMarkdownModal(text);
        };
    });

    // Modal wiring (close handlers)
    const mdModal = document.getElementById('md-modal');
    const mdClose = document.getElementById('md-close');
    if (mdClose) mdClose.onclick = () => { if (mdModal) mdModal.style.display = 'none'; };
    if (mdModal) mdModal.onclick = (e) => { if (e.target === mdModal) mdModal.style.display = 'none'; };

// --- Edit Handlers ---
function startEdit(id) {
    editingTaskId = id;
    render();
    // Focus input
    const input = document.querySelector('.edit-input');
    if (input) input.focus();
}

function saveEdit(id) {
    const input = document.querySelector('.edit-input');
    if (!input) return;
    const newText = input.value.trim();
    if (!newText) return;
    const idx = state.todos.findIndex(t => t.id === id);
    if (idx !== -1) {
        state.todos[idx].text = newText;
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        rebuildFuse();
        if (getConfig('autoSave')) autoSave();
    }
    editingTaskId = null;
    render();
}

function cancelEdit() {
    editingTaskId = null;
    render();
}
}

// GitHub Functions
async function fetchFromGit() {
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    
    if (!token || !repo) {
        alert('Please configure GitHub settings first');
        showSettings();
        return;
    }
    
    const dataFile = getConfig('dataFile');
    const url = `https://api.github.com/repos/${repo}/contents/${dataFile}`;
    
    try {
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (res.ok) {
            const json = await res.json();
            state.sha = json.sha;
            const content = decodeURIComponent(escape(atob(json.content)));
            state.todos = JSON.parse(content);
            // Ensure backward compatibility: add important and description if missing
            state.todos = state.todos.map(t => ({ important: false, description: '', ...t }));
            state.hasUnsavedChanges = false;
            saveToLocalStorage();
            rebuildFuse();
            render();
            showNotification('✅ Fetched from GitHub');
        } else if (res.status === 404) {
            showNotification('📝 No data file found - will create on first push');
        } else {
            throw new Error('Fetch failed');
        }
    } catch (err) {
        dbg('Fetch error: ' + (err && err.message ? err.message : err), 'error', err);
        showNotification('❌ Failed to fetch from GitHub');
    }
}

async function pushToGit(isAutoSave = false) {
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    
    if (!token || !repo) {
        if (!isAutoSave) {
            alert('Please configure GitHub settings first');
            showSettings();
        }
        return;
    }
    
    if (state.autoSyncing) return; // Prevent concurrent syncs
    
    state.autoSyncing = true;
    
    const dataFile = getConfig('dataFile');
    const jsonContent = JSON.stringify(state.todos, null, 2);
    const url = `https://api.github.com/repos/${repo}/contents/${dataFile}`;
    
    try {
        const body = {
            message: "Update todos: " + new Date().toISOString(),
            content: btoa(unescape(encodeURIComponent(jsonContent)))
        };
        
        if (state.sha) {
            body.sha = state.sha;
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
            const json = await res.json();
            state.sha = json.content.sha;
            state.hasUnsavedChanges = false;
            dbg('✅ Successfully saved to GitHub. New SHA: ' + state.sha.substring(0, 8), 'info');
            if (!isAutoSave) {
                showNotification(`✅ Pushed ${state.todos.length} todos to GitHub`);
            }
        } else {
            throw new Error('Push failed');
        }
    } catch (err) {
        dbg('Push error: ' + (err && err.message ? err.message : err), 'error', err);
        if (!isAutoSave) {
            showNotification('❌ Failed to push to GitHub');
        }
    } finally {
        state.autoSyncing = false;
        dbg('Auto-syncing flag cleared', 'debug');
    }
}

// Settings
function showSettings() { showPage('admin'); }

function closeSettings() { showPage('main'); }

function saveSettings() {
    const token = (document.getElementById('cfg-token')||{value:''}).value.trim();
    const repo = (document.getElementById('cfg-repo')||{value:''}).value.trim();
    const autoSave = (document.getElementById('cfg-autosave')||{checked:false}).checked;
    
    if (!token || !repo) {
        alert('Please enter both token and repository');
        return;
    }
    
    localStorage.setItem('todo_token', token);
    localStorage.setItem('todo_repo', repo);
    setConfig('autoSave', autoSave);
    
    updateAutoSaveUI();
    closeSettings();
    showNotification('✅ Settings saved');
    fetchFromGit();
}

function updateAutoSaveUI() {
    const autoSave = getConfig('autoSave');
    const pushBtns = document.querySelectorAll('[onclick="pushToGit()"]');
    
    pushBtns.forEach(btn => {
        if (autoSave) {
            btn.classList.add('auto-syncing');
            if (!btn.querySelector('.sync-icon')) {
                const icon = document.createElement('span');
                icon.className = 'sync-icon';
                icon.textContent = '🔄';
                btn.insertBefore(icon, btn.firstChild);
            }
        } else {
            btn.classList.remove('auto-syncing');
            const icon = btn.querySelector('.sync-icon');
            if (icon) icon.remove();
        }
    });
}

let autoSaveTimeout = null;
function autoSave() {
    // Debounce auto-save (wait 1 second after last change - reduced from 2s)
    clearTimeout(autoSaveTimeout);
    
    // Show saving indicator
    const pushBtns = document.querySelectorAll('[onclick="pushToGit()"]');
    pushBtns.forEach(btn => {
        btn.style.opacity = '0.6';
        const originalText = btn.innerHTML;
        if (!btn.dataset.originalText) {
            btn.dataset.originalText = originalText;
        }
    });
    
    autoSaveTimeout = setTimeout(async () => {
        if (!state.autoSyncing) {
            dbg('Executing auto-save to GitHub...', 'debug');
            await pushToGit(true);
            
            // Restore button opacity and show success briefly
            pushBtns.forEach(btn => {
                btn.style.opacity = '1';
            });
            showNotification('💾 Auto-saved');
        }
    }, 1000); // Reduced to 1 second for faster saves
}

function clearAllData() {
    if (confirm('Delete all todos? This cannot be undone.')) {
        state.todos = [];
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        rebuildFuse();
        render();
        showNotification('🗑️ All todos cleared');
    }
}

// Helpers
function saveToLocalStorage() {
    localStorage.setItem('todos_backup', JSON.stringify(state.todos));
}

function handleKeyPress(event) {
    if (event.key === 'Enter') {
        addTodo();
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

// Toggle important/star
function toggleImportant(id) {
    const todo = state.todos.find(t => t.id === id);
    if (todo) {
        todo.important = !todo.important;
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        rebuildFuse();
        render();

        if (getConfig('autoSave')) {
            autoSave();
        }
    }
}

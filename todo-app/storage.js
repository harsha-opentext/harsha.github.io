// Storage and GitHub-related functions

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

function saveUserConfigToGit(obj) {
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    if (!token || !repo) throw new Error('github-not-configured');
    const cfgPath = 'todo-app/app-todo-user-config.json';
    const url = `https://api.github.com/repos/${repo}/contents/${cfgPath}`;
    // Try to fetch existing file to get SHA
    let sha = null;
    return fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
        .then(r => { if (r.ok) return r.json(); throw new Error('no-file'); })
        .then(j => { sha = j.sha; })
        .catch(() => {})
        .then(() => {
            const body = {
                message: 'Update user config: ' + new Date().toISOString(),
                content: btoa(unescape(encodeURIComponent(JSON.stringify(obj, null, 2))))
            };
            if (sha) body.sha = sha;
            return fetch(url, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            }).then(res => { if (!res.ok) throw new Error('failed-push'); return res.json(); });
        });
}

// Tag storage helpers
function loadTags() {
    const stored = localStorage.getItem('todo_tags');
    if (stored) {
        try { state.tags = JSON.parse(stored); } catch (e) { state.tags = []; }
    }
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    if (token && repo) {
        const cfgPath = 'todo-app/app-todo-user-config.json';
        const url = `https://api.github.com/repos/${repo}/contents/${cfgPath}`;
        fetch(url, { headers: { 'Authorization': `Bearer ${token}` } })
            .then(res => { if (!res.ok) throw new Error('no-config'); return res.json(); })
            .then(json => {
                try {
                    const content = decodeURIComponent(escape(atob(json.content)));
                    const cfg = JSON.parse(content);
                    if (cfg && Array.isArray(cfg.tags)) {
                        state.tags = cfg.tags.slice();
                        localStorage.setItem('todo_tags', JSON.stringify(state.tags));
                        populateTagSelects();
                        renderTagsList();
                    }
                } catch (e) { dbg('Failed to parse user config from GitHub', 'warn', e); }
            }).catch(() => {});
    }
    if (!state.tags || state.tags.length === 0) state.tags = ['in-progress'];
}

function saveTags() {
    localStorage.setItem('todo_tags', JSON.stringify(state.tags));
    const token = localStorage.getItem('todo_token');
    const repo = localStorage.getItem('todo_repo');
    if (token && repo) {
        saveUserConfigToGit({ tags: state.tags }).catch(err => dbg('Failed to save user config to GitHub', 'warn', err));
    }
}

// State
let state = {
    todos: [],
    sha: "",
    filter: "all",
    hasUnsavedChanges: false,
    autoSyncing: false
};

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
        } catch (e) {
            console.error('Failed to load backup:', e);
        }
    }
    
    // Try to fetch from GitHub
    if (t && r) {
        await fetchFromGit();
    }
    
    render();
};

// Add Todo
function addTodo() {
    const input = document.getElementById('todo-input');
    const text = input.value.trim();
    
    if (!text) return;
    
    const todo = {
        id: Date.now(),
        text: text,
        completed: false,
        createdAt: new Date().toISOString()
    };
    
    state.todos.unshift(todo);
    state.hasUnsavedChanges = true;
    input.value = '';
    
    saveToLocalStorage();
    render();
    
    // Auto-save if enabled
    if (getConfig('autoSave')) {
        autoSave();
    }
}

// Toggle Todo
function toggleTodo(id) {
    const todo = state.todos.find(t => t.id === id);
    if (todo) {
        todo.completed = !todo.completed;
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        render();
        
        // Auto-save if enabled
        const autoSaveEnabled = getConfig('autoSave');
        console.log('Auto-save enabled:', autoSaveEnabled);
        if (autoSaveEnabled) {
            console.log('Triggering auto-save...');
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
    if (state.filter === 'active') {
        return state.todos.filter(t => !t.completed);
    } else if (state.filter === 'completed') {
        return state.todos.filter(t => t.completed);
    }
    return state.todos;
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
    
    document.getElementById('count-all').textContent = total;
    document.getElementById('count-active').textContent = active;
    document.getElementById('count-completed').textContent = completed;
    document.getElementById('total-todos-count').textContent = total;
    
    // Show empty state if no todos
    if (filtered.length === 0) {
        container.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }
    
    container.style.display = 'block';
    emptyState.style.display = 'none';
    
    // Render todos
    container.innerHTML = filtered.map(todo => `
        <div class="todo-item ${todo.completed ? 'completed' : ''}">
            <button class="checkbox ${todo.completed ? 'checked' : ''}" onclick="toggleTodo(${todo.id})">
                ${todo.completed ? '✓' : ''}
            </button>
            <div class="todo-content">
                <div class="todo-text">${escapeHtml(todo.text)}</div>
                <div class="todo-date">${formatDate(todo.createdAt)}</div>
            </div>
            <button class="delete-btn" onclick="deleteTodo(${todo.id})">🗑️</button>
        </div>
    `).join('');
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
            state.hasUnsavedChanges = false;
            saveToLocalStorage();
            render();
            showNotification('✅ Fetched from GitHub');
        } else if (res.status === 404) {
            showNotification('📝 No data file found - will create on first push');
        } else {
            throw new Error('Fetch failed');
        }
    } catch (err) {
        console.error('Fetch error:', err);
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
            console.log('✅ Successfully saved to GitHub. New SHA:', state.sha.substring(0, 8));
            if (!isAutoSave) {
                showNotification(`✅ Pushed ${state.todos.length} todos to GitHub`);
            }
        } else {
            throw new Error('Push failed');
        }
    } catch (err) {
        console.error('Push error:', err);
        if (!isAutoSave) {
            showNotification('❌ Failed to push to GitHub');
        }
    } finally {
        state.autoSyncing = false;
        console.log('Auto-syncing flag cleared');
    }
}

// Settings
function showSettings() {
    document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

function saveSettings() {
    const token = document.getElementById('cfg-token').value.trim();
    const repo = document.getElementById('cfg-repo').value.trim();
    const autoSave = document.getElementById('cfg-autosave').checked;
    
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
            console.log('Executing auto-save to GitHub...');
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

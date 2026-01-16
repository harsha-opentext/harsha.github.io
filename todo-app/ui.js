// UI rendering and DOM helpers

function populateTagSelects() {
    const newSelect = document.getElementById('new-tags-select');
    const searchDropdown = document.getElementById('search-tag-dropdown');
    if (newSelect) {
        newSelect.innerHTML = '<option value="">No tag</option>' + state.tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
    }
    if (searchDropdown) {
        searchDropdown.innerHTML = '<div class="tag-option" data-tag="">All tags</div>' + state.tags.map(t => `<div class="tag-option" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`).join('');
        searchDropdown.querySelectorAll('.tag-option').forEach(el => {
            const tag = el.getAttribute('data-tag') || '';
            el.classList.toggle('selected', (!!state.activeTagFilter && state.activeTagFilter === tag));
        });
    }
}

function renderTagsList() {
    const list = document.getElementById('tags-list');
    if (!list) return;
    list.innerHTML = state.tags.map(t => {
        const isDefault = (t === 'in-progress');
        return `<div style="display:inline-flex;align-items:center;padding:6px 10px;border-radius:999px;background:#f2f2f7;margin-right:6px;">${escapeHtml(t)} ${isDefault ? '<span style="margin-left:8px;color:var(--text-secondary);font-size:12px;">(default)</span>' : `<button style="margin-left:8px;background:transparent;border:none;cursor:pointer;" data-tag="${escapeHtml(t)}" class="delete-tag-btn">✖️</button>`}</div>`;
    }).join('');
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

function showCustomize() {
    const modal = document.getElementById('customize-modal'); if (modal) modal.style.display = 'flex';
    const mt = document.getElementById('max-tags-text'); if (mt) mt.textContent = getConfig('maxTags') || DEFAULT_CONFIG.maxTags;
    renderTagsList();
}

function closeCustomize() { const m = document.getElementById('customize-modal'); if (m) m.style.display = 'none'; }

// Simple markdown -> HTML renderer (very small subset)
function renderMarkdown(md) {
    if (!md) return '';
    try {
        if (typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
            const html = marked.parse(md);
            return DOMPurify.sanitize(html);
        }
    } catch (e) {
        dbg('marked/DOMPurify render failed, falling back', 'warn', e);
    }
    let s = md.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    s = s.replace(/```([\s\S]*?)```/g, (m, p1) => `<pre><code>${p1.replace(/</g,'&lt;')}</code></pre>`);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.split('\n\n').map(p => p.replace(/\n/g,'<br/>')).map(p => `<p>${p}</p>`).join('');
    return s;
}

function openMarkdownModal(mdText) {
    const mdModal = document.getElementById('md-modal');
    const mdBody = document.getElementById('md-body');
    if (!mdModal || !mdBody) return;
    const html = renderMarkdown(mdText || '');
    mdBody.innerHTML = html || '<div style="color:var(--text-secondary)">Empty</div>';
    mdModal.style.display = 'flex';
}

// Edit handlers
function startEdit(id) {
    editingTaskId = id;
    render();
    const input = document.querySelector('.edit-input'); if (input) input.focus();
}

function saveEdit(id) {
    const input = document.querySelector('.edit-input');
    if (!input) return;
    const newText = input.value.trim(); if (!newText) return;
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

function cancelEdit() { editingTaskId = null; render(); }

// Render list and wiring
function getFilteredTodos() {
    let base = state.todos.slice();
    if (state.activeTagFilter) {
        base = base.filter(t => Array.isArray(t.tags) && t.tags.includes(state.activeTagFilter));
    }
    if (state.filter === 'active') { base = base.filter(t => !t.completed); }
    else if (state.filter === 'completed') { base = base.filter(t => t.completed); }
    else if (state.filter === 'important') { base = base.filter(t => t.important && !t.completed); }
    if (!state.searchQuery) return base;
    if (state.fuse) {
        try { const f = new Fuse(base, state.fuseOptions); const results = f.search(state.searchQuery); return results.map(r => r.item); } catch (e) { dbg('Fuse search failed on subset, falling back', 'warn', e); }
    }
    const q = state.searchQuery.toLowerCase();
    return base.filter(t => (t.text || '').toLowerCase().includes(q) || (t.description||'').toLowerCase().includes(q));
}

function render() {
    const container = document.getElementById('todo-list');
    const emptyState = document.getElementById('empty-state');
    const filtered = getFilteredTodos();
    const total = state.todos.length;
    const active = state.todos.filter(t => !t.completed).length;
    const completed = state.todos.filter(t => t.completed).length;
    const important = state.todos.filter(t => t.important && !t.completed).length;
    document.getElementById('count-all').textContent = total;
    document.getElementById('count-active').textContent = active;
    document.getElementById('count-completed').textContent = completed;
    document.getElementById('total-todos-count').textContent = total;
    const impEl = document.getElementById('count-important'); if (impEl) impEl.textContent = important;
    try { updateTagFilterUI(); } catch (e) {}
    if (filtered.length === 0) {
        if (container) container.style.display = 'none';
        if (emptyState) emptyState.style.display = 'flex';
        const hint = state.searchQuery ? `No results for "${state.searchQuery}"` : 'No todos yet';
        if (emptyState) emptyState.querySelector('p').textContent = hint;
        return;
    }
    if (container) container.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';
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
            // Determine expiry display
            const expiresAt = todo.expiresAt ? new Date(todo.expiresAt) : null;
            const now = new Date();
            const isExpired = expiresAt ? (expiresAt.getTime() < now.getTime()) : false;
            const expiredClass = isExpired ? ' expired' : '';
            const expiryLabel = expiresAt ? `<div style="font-size:12px; color:${isExpired ? '#ff3b30' : 'var(--text-secondary)'}; margin-top:4px;">Expires: ${formatDate(expiresAt.toISOString())}</div>` : '';

            return `
                <div class="todo-item ${todo.completed ? 'completed' : ''}${expiredClass}">
                    <button class="checkbox ${todo.completed ? 'checked' : ''}" onclick="toggleTodo(${todo.id})">
                        ${todo.completed ? '✓' : ''}
                    </button>
                    <div class="todo-content">
                        <div class="todo-text">${escapeHtml(todo.text)}</div>
                        <div class="todo-date">${formatDate(todo.createdAt)}</div>
                        ${expiryLabel}
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

    // Attach listeners
    document.querySelectorAll('.edit-btn').forEach(btn => { btn.onclick = (e) => { const id = Number(btn.getAttribute('data-id')); startEdit(id); }; });
    document.querySelectorAll('.save-edit-btn').forEach(btn => { btn.onclick = (e) => { const id = Number(btn.getAttribute('data-id')); saveEdit(id); }; });
    document.querySelectorAll('.cancel-edit-btn').forEach(btn => { btn.onclick = (e) => { cancelEdit(); }; });
    document.querySelectorAll('.star-btn.item').forEach(btn => { btn.onclick = (e) => { const id = Number(btn.getAttribute('data-id')); toggleImportant(id); e.stopPropagation(); }; });
    document.querySelectorAll('.todo-item').forEach(item => { item.onclick = (e) => { if (e.target.closest('button') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('a')) return; const panel = item.querySelector('.todo-description'); if (!panel) return; panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; }; });
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
        if (previewEl) previewEl.innerHTML = renderMarkdown(ta.value || '');
    });
    document.querySelectorAll('.save-desc-btn').forEach(btn => { btn.onclick = (e) => { const id = Number(btn.getAttribute('data-id')); const panel = document.getElementById(`desc-${id}`); if (!panel) return; const ta = panel.querySelector('.desc-input'); if (!ta) return; const idx = state.todos.findIndex(t => t.id === id); if (idx !== -1) { state.todos[idx].description = ta.value.trim(); state.hasUnsavedChanges = true; saveToLocalStorage(); rebuildFuse(); if (getConfig('autoSave')) autoSave(); } panel.style.display = 'none'; }; });
    document.querySelectorAll('.cancel-desc-btn').forEach(btn => { btn.onclick = (e) => { const id = Number(btn.getAttribute('data-id')); const panel = document.getElementById(`desc-${id}`); if (panel) panel.style.display = 'none'; }; });
    document.querySelectorAll('.render-desc-btn').forEach(btn => { btn.onclick = (e) => { const id = Number(btn.getAttribute('data-id')); const ta = document.querySelector(`.desc-input[data-id="${id}"]`); const text = ta ? ta.value : ''; openMarkdownModal(text); }; });

    // Modal wiring
    const mdModal = document.getElementById('md-modal');
    const mdClose = document.getElementById('md-close');
    if (mdClose) mdClose.onclick = () => { if (mdModal) mdModal.style.display = 'none'; };
    if (mdModal) mdModal.onclick = (e) => { if (e.target === mdModal) mdModal.style.display = 'none'; };
}

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
    state.todos.unshift(todo);
    state.hasUnsavedChanges = true;
    input.value = '';
    const newDescEl = document.getElementById('new-desc');
    if (newDescEl) { newDescEl.value = ''; const cnt = document.getElementById('new-desc-count'); if (cnt) cnt.textContent = '0'; const wrapper = document.getElementById('new-desc-wrapper'); if (wrapper) wrapper.style.display = 'none'; }
    if (newStar) { newStar.classList.remove('starred'); newStar.textContent = '☆'; }
    rebuildFuse();
    saveToLocalStorage();
    render();
    if (getConfig('autoSave')) { autoSave(); }
}

function toggleTodo(id) {
    const todo = state.todos.find(t => t.id === id);
    if (todo) {
        todo.completed = !todo.completed;
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        rebuildFuse();
        render();
        const autoSaveEnabled = getConfig('autoSave');
        dbg('Auto-save enabled: ' + !!autoSaveEnabled, 'debug');
        if (autoSaveEnabled) { dbg('Triggering auto-save...', 'debug'); autoSave(); }
    }
}

function deleteTodo(id) {
    if (confirm('Delete this todo?')) {
        state.todos = state.todos.filter(t => t.id !== id);
        state.hasUnsavedChanges = true;
        saveToLocalStorage();
        rebuildFuse();
        render();
        if (getConfig('autoSave')) { autoSave(); }
    }
}

function setFilter(filter) { state.filter = filter; document.querySelectorAll('.filter-tab').forEach(tab => { tab.classList.toggle('active', tab.dataset.filter === filter); }); render(); }

function clearAllData() { if (confirm('Delete all todos? This cannot be undone.')) { state.todos = []; state.hasUnsavedChanges = true; saveToLocalStorage(); rebuildFuse(); render(); showNotification('🗑️ All todos cleared'); } }

function toggleImportant(id) { const todo = state.todos.find(t => t.id === id); if (todo) { todo.important = !todo.important; state.hasUnsavedChanges = true; saveToLocalStorage(); rebuildFuse(); render(); if (getConfig('autoSave')) autoSave(); } }

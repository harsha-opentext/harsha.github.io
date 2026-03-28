// Event wiring and initialization

function initApp() {
    const t = localStorage.getItem('todo_token');
    const r = localStorage.getItem('todo_repo');
    const cfgTokenEl = document.getElementById('cfg-token'); if (t && cfgTokenEl) cfgTokenEl.value = t;
    const cfgRepoEl = document.getElementById('cfg-repo'); if (r && cfgRepoEl) cfgRepoEl.value = r;
    const autoSave = getConfig('autoSave');
    const cfgAutosaveEl = document.getElementById('cfg-autosave'); if (cfgAutosaveEl) cfgAutosaveEl.checked = autoSave;
    updateAutoSaveUI();
    const stored = localStorage.getItem('todos_backup');
    if (stored) {
        try { state.todos = JSON.parse(stored); state.todos = state.todos.map(t => ({ important: false, description: '', tags: [], ...t })); } catch (e) { dbg('Failed to load backup: ' + (e && e.message ? e.message : e), 'error', e); }
    }
    rebuildFuse();
    const ll = document.getElementById('log-level'); if (ll) ll.value = state.logLevel;
    const lr = document.getElementById('log-retention'); if (lr) lr.value = String(state.retentionMinutes);
    dbg('Todo app started', 'info');
    if (t && r) { fetchFromGit(); }

    const searchInput = document.getElementById('searchInput');
    const clearBtn = document.getElementById('clearSearch');
    if (searchInput) {
        let searchDebounce = null;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchDebounce);
            searchDebounce = setTimeout(() => {
                state.searchQuery = e.target.value.trim(); render();
            }, 200);
        });
    }
    if (clearBtn) { clearBtn.addEventListener('click', () => { const si = document.getElementById('searchInput'); if (si) si.value = ''; state.searchQuery = ''; render(); }); }

    loadTags();
    populateTagSelects();
    updateTagFilterUI();

    const createTagBtn = document.getElementById('create-tag-btn');
    const newTagInput = document.getElementById('new-tag-input');
    if (createTagBtn && newTagInput) {
        createTagBtn.onclick = () => {
            const name = newTagInput.value.trim();
            const res = createTag(name);
            if (res.ok) { newTagInput.value = ''; }
            else alert(res.msg);
        };
    }
    const clearAllTagsBtn = document.getElementById('clear-all-tags-btn');
    if (clearAllTagsBtn) {
        clearAllTagsBtn.onclick = () => { if (!confirm('Clear all tags? This will remove all tags except the default in-progress.')) return; state.tags = ['in-progress']; saveTags(); populateTagSelects(); renderTagsList(); render(); };
    }

    // Tag filter button wiring
    const tagFilterBtn = document.getElementById('tag-filter-btn');
    const searchTagDropdown = document.getElementById('search-tag-dropdown');
    if (tagFilterBtn && searchTagDropdown) {
        function populateSearchDropdown() {
            const items = [''].concat(state.tags);
            searchTagDropdown.innerHTML = items.map(t => { if (!t) return `<div class="tag-option" data-tag="">All tags</div>`; return `<div class="tag-option" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</div>`; }).join('');
            searchTagDropdown.querySelectorAll('.tag-option').forEach(el => {
                const tag = el.getAttribute('data-tag') || '';
                el.classList.toggle('selected', (!!state.activeTagFilter && state.activeTagFilter === tag));
                el.onclick = (e) => {
                    const v = el.getAttribute('data-tag') || null;
                    state.activeTagFilter = v || null;
                    searchTagDropdown.style.display = 'none'; render();
                    const btn = document.getElementById('tag-filter-btn'); const clearBtnEl = document.getElementById('clear-tag-filter-btn'); if (btn) { btn.classList.remove('tag-blink'); void btn.offsetWidth; btn.classList.add('tag-blink-pulse'); } if (clearBtnEl) clearBtnEl.style.display = 'inline-flex'; e.stopPropagation();
                };
            });
        }
        tagFilterBtn.onclick = (e) => { if (searchTagDropdown.style.display === 'none' || !searchTagDropdown.style.display) { populateSearchDropdown(); searchTagDropdown.style.display = 'block'; } else { searchTagDropdown.style.display = 'none'; } e.stopPropagation(); };

        const clearTagBtn = document.getElementById('clear-tag-filter-btn');
        function updateClearTagBtn() { if (!clearTagBtn) return; if (state.activeTagFilter) { clearTagBtn.style.display = 'inline-flex'; tagFilterBtn.classList.add('tag-blink-pulse'); } else { clearTagBtn.style.display = 'none'; tagFilterBtn.classList.remove('tag-blink-pulse'); } }
        updateClearTagBtn();
        if (clearTagBtn) { clearTagBtn.onclick = (e) => { state.activeTagFilter = null; updateClearTagBtn(); render(); e.stopPropagation(); }; }
        document.addEventListener('click', (ev) => { const target = ev.target; if (!target.closest('#search-tag-dropdown') && !target.closest('#tag-filter-btn')) { if (searchTagDropdown) searchTagDropdown.style.display = 'none'; } });
    }

    render();

    // Ensure the correct page is shown (main by default)
    showPage('main');

    // New-item controls
    const newStar = document.getElementById('new-star-btn');
    if (newStar) { newStar.onclick = () => { newStar.classList.toggle('starred'); newStar.textContent = newStar.classList.contains('starred') ? '★' : '☆'; }; }
    const newInfoBtn = document.getElementById('new-info-btn');
    const newDescWrapper = document.getElementById('new-desc-wrapper');
    const newDesc = document.getElementById('new-desc');
    const newDescCount = document.getElementById('new-desc-count');
    const newDescMax = document.getElementById('new-desc-max');
    const maxLen = getConfig('descriptionMaxLength') || 2000;
    if (newDescMax) newDescMax.textContent = maxLen;
    if (newInfoBtn && newDescWrapper) { newInfoBtn.onclick = () => { if (newDescWrapper.style.display === 'none') { newDescWrapper.style.display = 'block'; newDesc.focus(); } else { newDescWrapper.style.display = 'none'; } }; }
    if (newDesc) { newDesc.addEventListener('input', () => { const v = newDesc.value || ''; if (v.length > maxLen) { newDesc.value = v.slice(0, maxLen); } if (newDescCount) newDescCount.textContent = newDesc.value.length; }); }
    const renderNewBtn = document.getElementById('render-new-desc'); if (renderNewBtn) { renderNewBtn.onclick = () => { const text = (document.getElementById('new-desc')||{value:''}).value || ''; openMarkdownModal(text); }; }

    // Customize modal close/create hooked earlier
}

// Simple SPA page switcher
function showPage(name) {
    const pages = ['main','admin','customize','analytics'];
    pages.forEach(p => {
        const id = (p === 'main') ? 'page-tracker' : `page-${p}`;
        const el = document.getElementById(id);
        if (!el) return;
        if ((p === 'main' && name === 'main') || p === name) el.style.display = 'block'; else el.style.display = 'none';
    });
    // When showing analytics, trigger render
    if (name === 'analytics') {
        if (typeof renderAnalytics === 'function') renderAnalytics();
    }
    if (name === 'customize') {
        // render customize page UI
        const mt = document.getElementById('max-tags-text'); if (mt) mt.textContent = getConfig('maxTags') || DEFAULT_CONFIG.maxTags;
        renderTagsList();
    }
    updateNavActive(name);
}

// Highlight nav
function updateNavActive(name) {
    const mapping = { main: 'nav-tasks', analytics: 'nav-analytics', admin: 'nav-admin', customize: 'nav-customize' };
    Object.values(mapping).forEach(id => { if (!id) return; const el = document.getElementById(id); if (el) el.classList.remove('active'); });
    const id = mapping[name]; if (id) { const el = document.getElementById(id); if (el) el.classList.add('active'); }
}

// Settings
function showSettings() { showPage('admin'); }
function closeSettings() { showPage('main'); }
function saveSettings() {
    const token = document.getElementById('cfg-token').value.trim();
    const repo = document.getElementById('cfg-repo').value.trim();
    const autoSave = document.getElementById('cfg-autosave').checked;
    if (!token || !repo) { alert('Please enter both token and repository'); return; }
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
                const icon = document.createElement('span'); icon.className = 'sync-icon'; icon.textContent = '🔄'; btn.insertBefore(icon, btn.firstChild);
            }
        } else {
            btn.classList.remove('auto-syncing');
            const icon = btn.querySelector('.sync-icon'); if (icon) icon.remove();
        }
    });
}

// Hook init to window load
window.addEventListener('load', initApp);

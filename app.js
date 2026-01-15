let state = { 
    entries: [], 
    sha: "", 
    logs: [], 
    retentionMinutes: 5, 
    schema: null,
    logLevel: 'info', // debug, info, warn, error
    dateRangeStart: null,
    dateRangeEnd: null,
    selectMode: false,
    selectedEntries: new Set(),
    hasUnsavedChanges: false,
    historySelectMode: false,
    historySelectedEntries: new Set(),
    tempCsvData: null,
    csvSource: null
};

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
    if (!sel) return;
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
    
    const page = document.getElementById(`page-${p}`);
    if (page) page.classList.add('active');
    
    const tab = document.getElementById(`tab-${p}`);
    if (tab) tab.classList.add('active');
    
    // Load page-specific content
    if (p === 'history') {
        renderHistory();
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
        if (dataFileEl) dataFileEl.innerText = getConfig('dataFile');
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
    localStorage.setItem('gt_token', t);
    localStorage.setItem('gt_repo', r);
    dbg("Settings saved");
    toggleSettings();
    fetchFromGit();
}

async function fetchFromGit() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');

    if (!token || !repo) {
        dbg("Missing credentials - please configure in Settings", "error");
        return;
    }

    const dataFile = getConfig('dataFile');
    const url = `https://api.github.com/repos/${repo}/contents/${dataFile}`;
    
    dbg(`Fetching data from GitHub`, 'info');
    dbg(`Repository: ${repo}`, 'debug');
    dbg(`Data file: ${dataFile}`, 'debug');
    dbg(`URL: ${url}`, 'debug');

    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { 
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        dbg(`Response status: ${response.status}`, 'debug');

        if (!response.ok) {
            if (response.status === 404) {
                dbg("Data file not found - will create on first push", "warn");
                state.entries = [];
                render();
                return;
            }
            const errBody = await response.json();
            dbg(`GitHub API error: ${errBody.message || response.statusText}`, "error", errBody);
            return;
        }

        const data = await response.json();
        state.sha = data.sha;
        dbg(`Retrieved file SHA: ${state.sha.substring(0, 8)}...`, 'debug');
        
        const content = atob(data.content);
        dbg(`Content decoded, size: ${content.length} bytes`, 'debug');
        
        state.entries = JSON.parse(content);
        render();
        dbg(`Successfully loaded ${state.entries.length} entries`, 'info');

    } catch (err) {
        dbg(`Fetch error: ${err.message}`, "error");
        dbg(`Stack trace: ${err.stack}`, 'debug');
    }
}

async function pushToGit() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    
    if (!token || !repo) {
        dbg("Cannot push: Missing credentials", "error");
        return;
    }

    const dataFile = getConfig('dataFile');
    const jsonContent = JSON.stringify(state.entries, null, 2);
    const url = `https://api.github.com/repos/${repo}/contents/${dataFile}`;

    dbg(`Pushing ${state.entries.length} entries to GitHub`, 'info');
    dbg(`Data size: ${jsonContent.length} bytes`, 'debug');
    
    // Add loading state to push button
    const pushBtn = event?.target;
    if (pushBtn) pushBtn.classList.add('loading');

    try {
        const body = {
            message: "Sync: " + new Date().toISOString(),
            content: btoa(unescape(encodeURIComponent(jsonContent)))
        };
        
        // Include SHA only if we have it (for updates)
        if (state.sha) {
            body.sha = state.sha;
            dbg(`Updating existing file (SHA: ${state.sha.substring(0, 8)}...)`, 'debug');
        } else {
            dbg('Creating new file', 'debug');
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
            dbg("Successfully saved to GitHub", 'info');
            dbg(`New SHA: ${state.sha.substring(0, 8)}...`, 'debug');
            
            // Format nice success message
            const [owner, repoName] = repo.split('/');
            alert(`✅ Successfully published!\n\n📁 Repository: ${repoName}\n👤 Owner: ${owner}\n📄 File: ${dataFile}\n\n${state.entries.length} entries saved`);
        } else {
            const err = await res.json();
            dbg(`Push failed: ${err.message || 'Unknown error'}`, "error", err);
            alert("❌ Failed to publish. Check logs for details.");
        }
    } catch (err) {
        dbg(`Push error: ${err.message}`, "error");
        alert("❌ Failed to publish. Check logs for details.");
    } finally {
        if (pushBtn) pushBtn.classList.remove('loading');
    }
}

function render() {
    const container = document.getElementById('list-container');
    const totalEl = document.getElementById('total-kcal');
    
    if (!state.schema) {
        container.innerHTML = '<p>Loading schema...</p>';
        return;
    }
    
    container.innerHTML = '';
    let total = 0;
    
    const totalField = state.schema.totalField;
    
    state.entries.forEach((entry, index) => {
        if (totalField && entry[totalField]) {
            total += parseFloat(entry[totalField]);
        }
        
        const d = document.createElement('div');
        d.className = 'entry-card';
        if (state.selectMode && state.selectedEntries.has(index)) {
            d.style.background = 'rgba(0, 122, 255, 0.1)';
            d.style.borderLeft = '4px solid var(--primary)';
        }
        
        // Format display based on schema displayFormat
        let display = state.schema.displayFormat;
        Object.keys(entry).forEach(key => {
            display = display.replace(`{${key}}`, entry[key]);
        });
        
        // Check if entry has macros
        const hasMacros = entry.protein || entry.carbs || entry.fat;
        let macroHtml = '';
        if (hasMacros) {
            const macros = [];
            if (entry.protein) macros.push(`Protein: ${entry.protein}g`);
            if (entry.carbs) macros.push(`Carbs: ${entry.carbs}g`);
            if (entry.fat) macros.push(`Fat: ${entry.fat}g`);
            macroHtml = `
                <div id="macros-${index}" style="display: none; margin-top: 8px; padding: 8px; background: var(--bg); border-radius: 6px; font-size: 12px; color: var(--text-secondary);">
                    ${macros.join(' | ')}
                </div>
            `;
        }
        
        const checkbox = state.selectMode ? `<input type="checkbox" ${state.selectedEntries.has(index) ? 'checked' : ''} onchange="toggleEntrySelection(${index})" style="width: 20px; height: 20px; cursor: pointer;">` : '';
        const expandBtn = hasMacros && !state.selectMode ? `<button onclick="toggleMacros(${index})" style="background: var(--bg); border: 1px solid var(--border); cursor: pointer; font-size: 16px; padding: 6px 10px; border-radius: 8px; color: var(--primary); font-weight: bold; transition: all 0.2s;" onmouseover="this.style.background='var(--primary)'; this.style.color='white';" onmouseout="this.style.background='var(--bg)'; this.style.color='var(--primary)';">▶</button>` : '';
        const deleteBtn = !state.selectMode ? `<button onclick="deleteEntry(${index})" style="background: #ff3b30; color: white; border: none; padding: 5px 10px; border-radius: 5px; cursor: pointer;">Delete</button>` : '';
        
        d.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: center; width: 100%;">
                ${checkbox}
                ${expandBtn}
                <span style="flex: 1;">${display}</span>
                ${deleteBtn}
            </div>
            ${macroHtml}
        `;
        container.appendChild(d);
    });
    
    totalEl.innerText = `${total} ${totalField || 'total'}`;
}

function deleteEntry(index) {
    if (confirm('Delete this entry?')) {
        state.entries.splice(index, 1);
        state.hasUnsavedChanges = true;
        render();
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

function bulkDelete() {
    if (state.selectedEntries.size === 0) {
        alert('No entries selected.');
        return;
    }
    
    if (!confirm(`Delete ${state.selectedEntries.size} selected entries?`)) {
        return;
    }
    
    // Convert to array and sort descending to delete from end first
    const indices = Array.from(state.selectedEntries).sort((a, b) => b - a);
    indices.forEach(index => {
        state.entries.splice(index, 1);
    });
    
    state.selectedEntries.clear();
    state.hasUnsavedChanges = true;
    updateSelectedCount();
    render();
    renderHistory();
    
    dbg(`Bulk deleted ${indices.length} entries`, 'info');
    
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

function addEntry() {
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
    
    // Remove loading after a short delay
    setTimeout(() => {
        if (addBtn) addBtn.classList.remove('loading');
    }, 500);
}

// --- HISTORY PAGE ---
function renderHistory() {
    const container = document.getElementById('history-container');
    if (!container) return;
    
    const foodFilter = document.getElementById('filter-food')?.value.toLowerCase();
    
    let filtered = state.entries;
    
    // Apply date range filter
    if (state.dateRangeStart && state.dateRangeEnd) {
        if (state.dateRangeStart === state.dateRangeEnd) {
            // Single day
            filtered = filtered.filter(e => e.date === state.dateRangeStart);
        } else {
            // Date range
            filtered = filtered.filter(e => e.date >= state.dateRangeStart && e.date <= state.dateRangeEnd);
        }
    } else {
        // Default to today's entries when no date filter is applied
        const today = new Date().toISOString().split('T')[0];
        filtered = filtered.filter(e => e.date === today);
    }
    
    if (foodFilter) {
        filtered = filtered.filter(e => e.food?.toLowerCase().includes(foodFilter));
    }
    
    // Sort by timestamp descending (newest first)
    filtered.sort((a, b) => {
        const timeA = new Date(a.timestamp || a.date).getTime();
        const timeB = new Date(b.timestamp || b.date).getTime();
        return timeB - timeA;
    });
    
    // Update stats
    document.getElementById('history-total-entries').innerText = filtered.length;
    const totalCal = filtered.reduce((sum, e) => sum + (parseFloat(e.calories) || 0), 0);
    document.getElementById('history-total-calories').innerText = Math.round(totalCal);
    
    // Calculate avg per day
    const uniqueDates = [...new Set(filtered.map(e => e.date))];
    const avgPerDay = uniqueDates.length > 0 ? Math.round(totalCal / uniqueDates.length) : 0;
    document.getElementById('history-avg-calories').innerText = avgPerDay;
    
    // Determine if showing single day (allows edit) or range (no edit)
    const isSingleDay = state.dateRangeStart && state.dateRangeEnd && state.dateRangeStart === state.dateRangeEnd;
    const isRangeView = state.dateRangeStart && state.dateRangeEnd && state.dateRangeStart !== state.dateRangeEnd;
    
    // Render entries
    container.innerHTML = '';
    filtered.forEach((entry, index) => {
        const globalIndex = state.entries.indexOf(entry);
        const d = document.createElement('div');
        d.className = 'entry-card';
        d.id = `entry-${globalIndex}`;
        
        if (state.historySelectMode && state.historySelectedEntries.has(globalIndex)) {
            d.style.background = 'rgba(0, 122, 255, 0.1)';
            d.style.borderLeft = '4px solid var(--primary)';
        }
        
        const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
        let display = `${entry.food} - ${entry.calories} kcal`;
        if (entry.time) display += ` at ${entry.time}`;
        
        let macroInfo = '';
        if (entry.protein || entry.carbs || entry.fat) {
            const macros = [];
            if (entry.protein) macros.push(`P: ${entry.protein}g`);
            if (entry.carbs) macros.push(`C: ${entry.carbs}g`);
            if (entry.fat) macros.push(`F: ${entry.fat}g`);
            macroInfo = `<div style="font-size: 11px; color: var(--text-secondary); margin-top: 2px;">${macros.join(' | ')}</div>`;
        }
        
        // Show checkbox in select mode, edit button only in single day view or when no date filter
        const checkbox = state.historySelectMode ? `<input type="checkbox" ${state.historySelectedEntries.has(globalIndex) ? 'checked' : ''} onchange="toggleHistoryEntrySelection(${globalIndex})" style="width: 20px; height: 20px; cursor: pointer;">` : '';
        const showEdit = !isRangeView && !state.historySelectMode;
        const editButton = showEdit ? `<button onclick="editEntry(${globalIndex})" style="background: #007aff; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;">Edit</button>` : '';
        const deleteButton = !state.historySelectMode ? `<button onclick="deleteEntryGlobal(${globalIndex})" style="background: #ff3b30; color: white; border: none; padding: 8px 16px; border-radius: 8px; cursor: pointer; font-size: 13px;">Delete</button>` : '';
        
        d.innerHTML = `
            <div style="display: flex; gap: 12px; align-items: center;">
                ${checkbox}
                <div style="flex: 1;">
                    <div style="font-weight: 500;">${display}</div>
                    ${macroInfo}
                    <div style="font-size: 12px; color: var(--text-secondary); margin-top: 4px;">
                        ${entry.date} ${time}
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    ${editButton}
                    ${deleteButton}
                </div>
            </div>
        `;
        container.appendChild(d);
    });
}

function handleDateSelection() {
    const dateInput = document.getElementById('filter-date');
    const selectedDate = dateInput.value;
    
    if (!selectedDate) {
        state.dateRangeStart = null;
        state.dateRangeEnd = null;
        dateInput.setAttribute('placeholder', 'Select date');
        return;
    }
    
    // If no start date, set it and keep calendar open
    if (!state.dateRangeStart) {
        state.dateRangeStart = selectedDate;
        dateInput.value = '';
        dateInput.setAttribute('placeholder', `Start: ${selectedDate} (pick end or same)`);
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
        dateInput.setAttribute('placeholder', `${state.dateRangeStart} to ${state.dateRangeEnd}`);
        dbg(`Date range: ${state.dateRangeStart} to ${state.dateRangeEnd}`, 'debug');
        // Calendar will close naturally
    }
}

function filterHistory() {
    renderHistory();
}

function clearFilters() {
    const dateInput = document.getElementById('filter-date');
    dateInput.value = '';
    dateInput.setAttribute('placeholder', 'Select date');
    document.getElementById('filter-food').value = '';
    state.dateRangeStart = null;
    state.dateRangeEnd = null;
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
    } else {
        const today = new Date().toISOString().split('T')[0];
        filtered = filtered.filter(e => e.date === today);
    }
    
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
}

function deleteEntryGlobal(index) {
    if (confirm('Delete this entry?')) {
        state.entries.splice(index, 1);
        render();
        renderHistory();
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
                                return context.label + ': ' + Math.round(context.parsed) + 'g';
                            }
                        }
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
            alert('CSV copied to clipboard!');
            closeCsvExportModal();
            
            // Exit select mode
            if (state.csvSource === 'tracker') {
                toggleSelectMode();
            } else if (state.csvSource === 'history') {
                toggleHistorySelectMode();
            }
        } catch (e) {
            alert('Failed to copy. Please try the download option.');
        }
        textarea.remove();
    }
}

window.onload = async () => {
    const t = localStorage.getItem('gt_token');
    const r = localStorage.getItem('gt_repo');
    if (t) document.getElementById('cfg-token').value = t;
    if (r) document.getElementById('cfg-repo').value = r;
    
    // Load schema first
    const schemaLoaded = await loadSchema();
    
    // Auto-fetch only if schema loaded successfully
    if (schemaLoaded && getConfig('autoFetch') && t && r) {
        fetchFromGit();
    }
    
    // Warn user about unsaved changes before leaving
    window.addEventListener('beforeunload', (e) => {
        if (state.hasUnsavedChanges) {
            e.preventDefault();
            e.returnValue = ''; // Modern browsers require this
            return ''; // Some older browsers need a return value
        }
    });
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
        const lines = input.split('\n').filter(line => line.trim());
        
        if (lines.length < 2) {
            alert('CSV must have at least a header row and one data row.');
            return;
        }
        
        // Parse header
        const header = lines[0].split(',').map(h => h.trim().toLowerCase());
        
        // Validate required columns
        const requiredCols = ['date', 'calories'];
        const missingCols = requiredCols.filter(col => !header.some(h => h.includes(col)));
        
        if (missingCols.length > 0) {
            alert(`Missing required columns: ${missingCols.join(', ')}`);
            return;
        }
        
        // Find column indices
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
        for (let i = 1; i < lines.length; i++) {
            const values = lines[i].split(',').map(v => v.trim());
            
            if (values.length < 2) continue; // Skip invalid rows
            
            // Sanitize and validate
            const date = values[dateIdx]?.trim();
            const calories = parseFloat(values[caloriesIdx]);
            
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

function displayCsvPreview() {
    const inputSection = document.getElementById('csv-input-section');
    const previewSection = document.getElementById('csv-preview-section');
    const list = document.getElementById('csv-preview-list');
    const count = document.getElementById('csv-count');
    
    count.textContent = csvParsedData.length;
    list.innerHTML = '';
    
    csvParsedData.forEach((entry, idx) => {
        const card = document.createElement('div');
        card.style.cssText = 'background: var(--card-bg); padding: 16px; border-radius: 12px; margin-bottom: 10px; box-shadow: var(--shadow); border-left: 4px solid var(--primary);';
        
        let macroStr = '';
        if (entry.protein || entry.carbs || entry.fat) {
            const macros = [];
            if (entry.protein) macros.push(`<span style="color: var(--primary);">P: ${entry.protein}g</span>`);
            if (entry.carbs) macros.push(`<span style="color: var(--secondary);">C: ${entry.carbs}g</span>`);
            if (entry.fat) macros.push(`<span style="color: var(--success);">F: ${entry.fat}g</span>`);
            macroStr = `<div style="font-size: 12px; color: var(--text-secondary); margin-top: 6px;">${macros.join(' • ')}</div>`;
        }
        
        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div style="flex: 1;">
                    <div style="font-weight: 600; font-size: 16px; color: var(--text); margin-bottom: 6px;">${entry.food}</div>
                    <div style="font-weight: 600; font-size: 18px; color: var(--primary); margin-bottom: 4px;">${entry.calories} kcal</div>
                    <div style="font-size: 13px; color: var(--text-secondary);">
                        <span style="margin-right: 12px;">📅 ${entry.date}</span>
                        <span>🕐 ${entry.time}</span>
                    </div>
                    ${macroStr}
                </div>
            </div>
        `;
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

function importCsvEntries() {
    if (csvParsedData.length === 0) return;
    
    // Add all parsed entries
    state.entries.push(...csvParsedData);
    state.hasUnsavedChanges = true;
    
    render();
    renderHistory();
    
    dbg(`Imported ${csvParsedData.length} entries`, 'info');
    
    closeCsvImport();
}

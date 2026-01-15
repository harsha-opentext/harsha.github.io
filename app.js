let state = { entries: [], sha: "" };

// --- EXTENSIVE LOGGING SYSTEM ---
function dbg(msg, type = 'info', raw = null) {
    const screen = document.getElementById('log-screen');
    const item = document.createElement('div');
    item.className = `log-item ${type === 'error' ? 'log-error' : type === 'warn' ? 'log-warn' : ''}`;
    
    const timestamp = new Date().toLocaleTimeString();
    let text = `[${timestamp}] ${msg}`;
    if (raw) text += `\nRAW: ${JSON.stringify(raw, null, 2)}`;
    
    item.innerText = text;
    screen.prepend(item); // Newest logs at top
}

function clearLogs() { document.getElementById('log-screen').innerHTML = ''; }

function showPage(p) {
    document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('nav button').forEach(el => el.classList.remove('active'));
    document.getElementById(`page-${p}`).classList.add('active');
    document.getElementById(`tab-${p}`).classList.add('active');
}

// --- CORE LOGIC ---
function saveSettings() {
    const t = document.getElementById('cfg-token').value.trim();
    const r = document.getElementById('cfg-repo').value.trim();
    localStorage.setItem('gt_token', t);
    localStorage.setItem('gt_repo', r);
    dbg("Settings saved to LocalStorage");
    dbg(`Token starts with: ${t.substring(0, 4)}...`);
    dbg(`Repo path: ${r}`);
    toggleSettings();
    fetchFromGit();
}

async function fetchFromGit() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');

    if (!token || !repo) {
        dbg("CRITICAL: Missing Token or Repo path in settings", "error");
        return;
    }

    const url = `https://api.github.com/repos/${repo}/contents/data.csv`;
    dbg(`INITIATING FETCH`, "log-header");
    dbg(`URL: ${url}`);

    try {
        dbg("Calling fetch()...");
        const response = await fetch(url, {
            method: 'GET',
            headers: { 
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Cache-Control': 'no-cache'
            }
        });

        dbg(`HTTP Status: ${response.status} (${response.statusText})`);

        if (!response.ok) {
            const errBody = await response.json();
            dbg(`GitHub API Error`, "error", errBody);
            return;
        }

        const data = await response.json();
        state.sha = data.sha;
        dbg(`SHA Received: ${state.sha}`);

        const content = atob(data.content);
        dbg("Base64 Content Decoded successfully.");
        
        state.entries = parseCSV(content);
        render();
        dbg(`Successfully parsed ${state.entries.length} rows.`);

    } catch (err) {
        dbg("NETWORK ERROR DETECTED", "error");
        dbg(`Message: ${err.message}`);
        dbg(`Stack: ${err.stack}`);
        if (navigator.onLine) {
            dbg("Device is Online. This might be a CORS block or malformed URL.");
        } else {
            dbg("Device appears to be OFFLINE.", "warn");
        }
    }
}

async function pushToGit() {
    const token = localStorage.getItem('gt_token');
    const repo = localStorage.getItem('gt_repo');
    if (!state.sha) { dbg("Cannot push: No SHA found. Fetch first.", "error"); return; }

    const csvContent = ["date,food,calories", ...state.entries.map(e => `${e.date},${e.food},${e.kcal}`)].join('\n');
    const url = `https://api.github.com/repos/${repo}/contents/data.csv`;

    dbg("INITIATING PUSH", "log-header");
    try {
        const res = await fetch(url, {
            method: 'PUT',
            headers: { 'Authorization': `token ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "Sync: " + new Date().toISOString(),
                content: btoa(csvContent),
                sha: state.sha
            })
        });

        if (res.ok) {
            const json = await res.json();
            state.sha = json.content.sha;
            dbg("PUSH SUCCESSFUL", "info");
            alert("Saved to GitHub!");
        } else {
            const err = await res.json();
            dbg("PUSH FAILED", "error", err);
        }
    } catch (err) {
        dbg("PUSH NETWORK ERROR", "error", err);
    }
}

function parseCSV(str) {
    const lines = str.trim().split('\n');
    if (lines.length <= 1) return [];
    return lines.slice(1).map(l => {
        const [date, food, kcal] = l.split(',');
        return { date, food, kcal: parseInt(kcal) };
    });
}

function render() {
    const container = document.getElementById('list-container');
    const totalEl = document.getElementById('total-kcal');
    container.innerHTML = '';
    let total = 0;
    state.entries.forEach(e => {
        total += e.kcal;
        const d = document.createElement('div');
        d.className = 'entry-card';
        d.innerHTML = `<span>${e.food}</span><b>${e.kcal} kcal</b>`;
        container.appendChild(d);
    });
    totalEl.innerText = `${total} kcal`;
}

function addEntry() {
    const f = document.getElementById('food-name').value;
    const k = parseInt(document.getElementById('food-kcal').value);
    if (!f || !k) return;
    state.entries.push({ date: new Date().toISOString().split('T')[0], food: f, kcal: k });
    render();
    dbg(`Added ${f} locally. Pending Push.`);
}

function toggleSettings() {
    const m = document.getElementById('settings-modal');
    m.style.display = m.style.display === 'flex' ? 'none' : 'flex';
}

window.onload = () => {
    dbg("Application Started");
    const t = localStorage.getItem('gt_token');
    const r = localStorage.getItem('gt_repo');
    if (t) document.getElementById('cfg-token').value = t;
    if (r) document.getElementById('cfg-repo').value = r;
    if (t && r) fetchFromGit();
};

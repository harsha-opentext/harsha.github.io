// history.js - history UI helpers for Body Measurement
// Renders index.history and allows viewing per-date entries

async function bm_showHistory() {
  const modal = document.getElementById('bm-history-modal'); if (!modal) return;
  modal.style.display = 'flex';
  await bm_renderHistory();
}

function bm_closeHistory() { const modal = document.getElementById('bm-history-modal'); if (!modal) return; modal.style.display = 'none'; }

async function bm_renderHistory() {
  const list = document.getElementById('bm-history-list'); if (!list) return;
  list.innerHTML = 'Loading...';
  try {
    const idx = await bm_loadIndex();
    const keys = Object.keys(idx.history || {}).sort((a,b) => b.localeCompare(a));
    if (keys.length === 0) { list.innerHTML = '<div class="bm-empty">No history yet.</div>'; return; }
    list.innerHTML = '';
    for (const d of keys) {
      const li = document.createElement('div'); li.className = 'bm-history-row';
      const btn = document.createElement('button'); btn.className = 'btn-secondary'; btn.textContent = 'View';
      btn.onclick = (async ()=>{
        const entries = await bm_getEntriesByDate(d);
        const detail = document.getElementById('bm-history-detail');
        if (!detail) return;
        detail.innerHTML = `<h4>${d} — ${entries.length} entries</h4>`;
        entries.forEach(e=>{ const c = bm_buildEntryCard(e); detail.appendChild(c); });
      });
      li.innerHTML = `<div style="flex:1"><strong>${d}</strong> <span style="color:var(--text-secondary); font-size:13px;">${idx.history[d]}</span></div>`;
      li.style.display = 'flex'; li.style.gap = '8px'; li.style.alignItems = 'center';
      li.appendChild(btn);
      list.appendChild(li);
    }
  } catch (e) { list.innerHTML = `<div class="bm-error">Failed to load history: ${e.message}</div>`; }
}

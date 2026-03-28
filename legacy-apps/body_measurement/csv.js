// csv.js - CSV import/export helpers for Body Measurement
let bm_csvParsedData = [];
let bm_csvTimeColumnFound = false;

function bm_openCsvImport() {
  const modal = document.getElementById('bm-csv-modal');
  if (!modal) return;
  modal.style.display = 'flex';
  const input = document.getElementById('bm-csv-input'); if (input) input.value = '';
  const inputSection = document.getElementById('bm-csv-input-section');
  const previewSection = document.getElementById('bm-csv-preview-section');
  if (inputSection) inputSection.style.display = 'block';
  if (previewSection) previewSection.style.display = 'none';
  bm_csvParsedData = [];
}

function bm_closeCsvImport() { const modal = document.getElementById('bm-csv-modal'); if (!modal) return; modal.style.display = 'none'; bm_csvParsedData = []; }

function bm_backToCsvInput() { const inSec = document.getElementById('bm-csv-input-section'); const pv = document.getElementById('bm-csv-preview-section'); if (inSec) inSec.style.display='block'; if (pv) pv.style.display='none'; }

function bm_parseCsv() {
  const input = (document.getElementById('bm-csv-input') || {}).value || '';
  if (!input.trim()) { alert('Please paste CSV data first.'); return; }
  try {
    if (typeof bm_log === 'function') bm_log('bm_parseCsv: starting parse', 'info');
    const lines = input.split('\n').map(l=>l.trim()).filter(l=>l.length>0);
    if (lines.length < 1) { alert('CSV input is empty.'); return; }

    const firstCols = lines[0].split(',').map(c=>c.trim().toLowerCase());
    const looksLikeHeader = firstCols.some(h => h.includes('date') || h.includes('weight') || h.includes('body') || h.includes('bmi'));
    let header = [];
    let startRow = 0;
    if (looksLikeHeader) { header = firstCols; startRow = 1; }
    else { header = ['date','weight','bodyFat','bmi','muscleMass','fatMass']; startRow = 0; }

    const dateIdx = header.findIndex(h=>h.includes('date'));
    const timeIdx = header.findIndex(h=>h.includes('time'));
    const weightIdx = header.findIndex(h=>h.includes('weight'));
    const bfIdx = header.findIndex(h=>h.includes('body') || h.includes('fat'));
    const bmiIdx = header.findIndex(h=>h.includes('bmi'));
    const mmIdx = header.findIndex(h=>h.includes('muscle'));
    const fmIdx = header.findIndex(h=>h.includes('fatmass') || h.includes('fat_mass') || h.includes('fatmass'));

    bm_csvTimeColumnFound = timeIdx >= 0;
    bm_csvParsedData = [];

    for (let i = startRow; i < lines.length; i++) {
      const cols = lines[i].split(',').map(v=>v.trim());
      if (cols.length < 2) continue;
      const date = dateIdx >= 0 ? cols[dateIdx] : undefined;
      const weight = weightIdx >= 0 ? parseFloat(cols[weightIdx]) : NaN;
      if (!date || isNaN(weight)) { continue; }
      let time = 'Current Time';
      if (timeIdx >= 0 && cols[timeIdx]) time = cols[timeIdx]; else time = new Date().toLocaleTimeString();

      const entry = {
        timestamp: new Date().toISOString(),
        date,
        time,
        weight
      };
      if (bfIdx >= 0 && cols[bfIdx]) { const v=parseFloat(cols[bfIdx]); if (!isNaN(v)) entry.bodyFat = v; }
      if (bmiIdx >= 0 && cols[bmiIdx]) { const v=parseFloat(cols[bmiIdx]); if (!isNaN(v)) entry.bmi = v; }
      if (mmIdx >= 0 && cols[mmIdx]) { const v=parseFloat(cols[mmIdx]); if (!isNaN(v)) entry.muscleMass = v; }
      if (fmIdx >= 0 && cols[fmIdx]) { const v=parseFloat(cols[fmIdx]); if (!isNaN(v)) entry.fatMass = v; }

      bm_csvParsedData.push(entry);
    }
    if (bm_csvParsedData.length === 0) { if (typeof bm_log === 'function') bm_log('bm_parseCsv: no valid entries parsed', 'warn'); alert('No valid entries found in CSV.'); return; }
    if (typeof bm_log === 'function') bm_log(`bm_parseCsv: parsed ${bm_csvParsedData.length} entries`, 'info');
    bm_displayCsvPreview();
  } catch (err) { console.error(err); alert('Failed to parse CSV. Please check the format.'); }
}

async function bm_copyExampleCsv() {
  const pre = document.getElementById('bm-example-csv'); if (!pre) { alert('Example CSV not found'); return; }
  const txt = (pre.textContent || pre.innerText || '').trim(); if (!txt) { alert('Example CSV is empty'); return; }
  try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(txt); if (typeof showNotification==='function') showNotification('📋 Example CSV copied to clipboard'); return; } } catch(e){}
  try { const ta = document.createElement('textarea'); ta.value = txt; ta.setAttribute('readonly',''); ta.style.position='fixed'; ta.style.left='-9999px'; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta); if (typeof showNotification==='function') showNotification('📋 Example CSV copied to clipboard'); } catch(e){ alert('Failed to copy example CSV'); }
}

function bm_displayCsvPreview() {
  const inputSection = document.getElementById('bm-csv-input-section');
  const previewSection = document.getElementById('bm-csv-preview-section');
  const list = document.getElementById('bm-csv-preview-list');
  const count = document.getElementById('bm-csv-count');
  if (count) count.textContent = String(bm_csvParsedData.length);
  if (!list) return;
  list.innerHTML = '';
  bm_csvParsedData.forEach((entry, idx) => {
    const card = document.createElement('div');
    card.style.cssText = 'background: var(--card-bg); padding:12px; border-radius:12px; margin-bottom:10px; border-left:4px solid var(--primary); display:flex; gap:12px; align-items:center;';
    const left = document.createElement('div'); left.style.flex='1';
    const dateInput = document.createElement('input'); dateInput.type='date'; try{ dateInput.value = new Date(entry.date).toISOString().slice(0,10); }catch(e){}
    dateInput.style.cssText='padding:8px;margin-bottom:6px;';
    const weightInput = document.createElement('input'); weightInput.type='number'; weightInput.step='0.1'; weightInput.value = entry.weight; weightInput.style.cssText='padding:8px;margin-right:8px; width:120px;';
    const row = document.createElement('div'); row.style.cssText='display:flex;gap:8px;align-items:center;';
    row.appendChild(weightInput); row.appendChild(dateInput);
    left.appendChild(row);
    const meta = document.createElement('div'); meta.style.cssText='margin-top:6px;color:var(--text-secondary);font-size:13px;';
    const parts = [];
    if (entry.bodyFat !== undefined) parts.push(`BF: ${entry.bodyFat}%`);
    if (entry.bmi !== undefined) parts.push(`BMI: ${entry.bmi}`);
    if (entry.muscleMass !== undefined) parts.push(`MM: ${entry.muscleMass}kg`);
    if (entry.fatMass !== undefined) parts.push(`FM: ${entry.fatMass}kg`);
    meta.textContent = parts.join(' | ');
    left.appendChild(meta);

    const right = document.createElement('div'); right.style.cssText='display:flex;flex-direction:column;gap:8px;align-items:flex-end;';
    const removeBtn = document.createElement('button'); removeBtn.className='btn-secondary'; removeBtn.textContent='Remove'; removeBtn.onclick = ()=>{ bm_csvParsedData.splice(idx,1); bm_displayCsvPreview(); };
    const resetBtn = document.createElement('button'); resetBtn.className='btn-primary'; resetBtn.textContent='Reset'; resetBtn.onclick = ()=>{ weightInput.value=entry.weight; try{ dateInput.value=new Date(entry.date).toISOString().slice(0,10); }catch(e){} };
    right.appendChild(removeBtn); right.appendChild(resetBtn);

    // commit changes back to parsed array
    const commit = ()=>{
      const updated = { ...entry };
      updated.weight = parseFloat(weightInput.value) || entry.weight;
      updated.date = dateInput.value || entry.date;
      bm_csvParsedData[idx] = updated;
      if (count) count.textContent = String(bm_csvParsedData.length);
    };
    [dateInput, weightInput].forEach(i=>{ i.addEventListener('change',commit); i.addEventListener('input',commit); });

    card.appendChild(left); card.appendChild(right);
    list.appendChild(card);
  });
  if (inputSection) inputSection.style.display='none';
  if (previewSection) previewSection.style.display='block';
}

async function bm_importCsvEntries() {
  if (!bm_csvParsedData || bm_csvParsedData.length === 0) return;
  if (typeof bm_log === 'function') bm_log(`bm_importCsvEntries: importing ${bm_csvParsedData.length} parsed entries`, 'info');
  // Group by date and check for collisions with index
  const byDate = {};
  for (const e of bm_csvParsedData) {
    const d = e.date || (new Date(e.timestamp || Date.now()).toISOString().slice(0,10));
    byDate[d] = byDate[d] || [];
    byDate[d].push(e);
  }
  const collisionDates = [];
  for (const d of Object.keys(byDate)) {
    const f = await bm_getFileForDate(d);
    if (f) collisionDates.push(d);
  }

  if (collisionDates.length > 0) {
    if (typeof bm_log === 'function') bm_log(`bm_importCsvEntries: detected collisions for dates ${collisionDates.join(',')}`, 'warn');
    const txt = `Entries already exist for these dates: ${collisionDates.join(', ')}.\n\nChoose OK to OVERWRITE those dates, or Cancel to abort the import.`;
    const ok = window.confirm(txt);
    if (!ok) { if (typeof bm_log === 'function') bm_log('bm_importCsvEntries: user cancelled import due to collisions', 'info'); return; } // abort import
    // user confirmed overwrite for collisionDates
    const overwriteSet = new Set(collisionDates);
    try { await bm_addOrReplaceEntries(bm_csvParsedData, overwriteSet); if (typeof bm_log === 'function') bm_log('bm_importCsvEntries: overwrite import complete', 'info'); } catch (err) { console.warn('bm_importCsvEntries failed overwrite', err); if (typeof bm_log === 'function') bm_log('bm_importCsvEntries failed overwrite: '+err.message, 'error'); }
  } else {
    // no collisions - append normally
    if (typeof bm_log === 'function') bm_log('bm_importCsvEntries: no collisions detected, appending entries', 'info');
    for (const e of bm_csvParsedData) {
      try { await bm_appendEntry(e); } catch (err) { console.warn('bm_importCsvEntries append failed', err); if (typeof bm_log === 'function') bm_log('bm_importCsvEntries append failed: '+err.message, 'error'); }
    }
  }
  // Refresh list
  await bm_renderList(50);
  if (typeof showNotification === 'function') showNotification(`Imported ${bm_csvParsedData.length} entries`, 'write');
  bm_closeCsvImport();
}

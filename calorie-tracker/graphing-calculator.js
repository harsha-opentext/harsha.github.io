/**
 * Trend Explorer — Graphing Calculator
 * Standalone page that plots correlations between nutritional variables.
 * Data is shared from the main app via localStorage key 'gt_graphing_entries'.
 */

const GE = (() => {
    let chart = null;

    const VARIABLE_LABELS = {
        calories:   'Total Calories (kcal)',
        protein:    'Protein (g)',
        carbs:      'Carbs (g)',
        fat:        'Fat (g)',
        bodyWeight: 'Body Weight (kg)',
    };

    function loadEntries() {
        try {
            const raw = localStorage.getItem('gt_graphing_entries');
            if (!raw) return [];
            return JSON.parse(raw);
        } catch (e) { return []; }
    }

    function getEntryDate(e) {
        if (e.date) return e.date;
        if (e.timestamp) return e.timestamp.split('T')[0];
        return null;
    }

    /** Aggregate all entries into a per-day map. */
    function buildDailyMap(entries) {
        const byDate = {};
        entries.forEach(e => {
            const d = getEntryDate(e);
            if (!d) return;
            if (!byDate[d]) {
                byDate[d] = { calories: 0, protein: 0, carbs: 0, fat: 0, bodyWeight: null, _count: 0 };
            }
            if (e._meta === 'dailyWeight') {
                byDate[d].bodyWeight = parseFloat(e.weight) || null;
            } else {
                byDate[d].calories += parseFloat(e.calories) || 0;
                byDate[d].protein  += parseFloat(e.protein)  || 0;
                byDate[d].carbs    += parseFloat(e.carbs)    || 0;
                byDate[d].fat      += parseFloat(e.fat)      || 0;
                byDate[d]._count++;
            }
        });
        return byDate;
    }

    function filterByDateRange(byDate, startDate, endDate) {
        const result = {};
        Object.keys(byDate).sort().forEach(d => {
            if (startDate && d < startDate) return;
            if (endDate   && d > endDate)   return;
            result[d] = byDate[d];
        });
        return result;
    }

    function getValue(dayData, variable) {
        return variable === 'bodyWeight' ? dayData.bodyWeight : dayData[variable];
    }

    /** Pearson correlation coefficient */
    function pearsonR(pts) {
        const n = pts.length;
        if (n < 2) return null;
        const mx = pts.reduce((s, p) => s + p.x, 0) / n;
        const my = pts.reduce((s, p) => s + p.y, 0) / n;
        let num = 0, dx2 = 0, dy2 = 0;
        pts.forEach(p => {
            const dx = p.x - mx, dy = p.y - my;
            num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
        });
        const denom = Math.sqrt(dx2 * dy2);
        return denom === 0 ? null : num / denom;
    }

    /** Two-point trend line via linear regression */
    function trendLine(pts) {
        const n = pts.length;
        if (n < 2) return null;
        const mx = pts.reduce((s, p) => s + p.x, 0) / n;
        const my = pts.reduce((s, p) => s + p.y, 0) / n;
        let num = 0, denom = 0;
        pts.forEach(p => { const dx = p.x - mx; num += dx * (p.y - my); denom += dx * dx; });
        if (denom === 0) return null;
        const m = num / denom, b = my - m * mx;
        const xs = pts.map(p => p.x);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        return [{ x: minX, y: m * minX + b }, { x: maxX, y: m * maxX + b }];
    }

    function renderStats(pts, xLbl, yLbl) {
        const el = document.getElementById('ge-stats');
        if (!el) return;
        if (!pts.length) { el.innerHTML = ''; return; }
        const r = pearsonR(pts);
        const rStr = r !== null ? r.toFixed(3) : 'N/A';
        const rInterp = r !== null
            ? (Math.abs(r) >= 0.7 ? (r > 0 ? 'Strong +' : 'Strong −')
             : Math.abs(r) >= 0.4 ? (r > 0 ? 'Moderate +' : 'Moderate −')
             : 'Weak / None')
            : '';
        const fmt = v => v.toFixed(1);
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        el.innerHTML = [
            { val: pts.length,  lbl: 'Data Points' },
            { val: rStr,        lbl: 'Pearson r' },
            { val: rInterp,     lbl: 'Correlation' },
            { val: fmt(Math.min(...xs)), lbl: `Min ${xLbl.split(' ')[0]}` },
            { val: fmt(Math.max(...xs)), lbl: `Max ${xLbl.split(' ')[0]}` },
            { val: fmt(Math.min(...ys)), lbl: `Min ${yLbl.split(' ')[0]}` },
            { val: fmt(Math.max(...ys)), lbl: `Max ${yLbl.split(' ')[0]}` },
        ].map(s => `<div class="ge-stat-card"><div class="ge-stat-val">${s.val}</div><div class="ge-stat-lbl">${s.lbl}</div></div>`).join('');
    }

    function getChartColors() {
        const style = getComputedStyle(document.documentElement);
        return {
            text:    style.getPropertyValue('--text').trim()           || '#1c1c1e',
            muted:   style.getPropertyValue('--text-secondary').trim() || '#8e8e93',
            grid:    style.getPropertyValue('--border').trim()         || '#d1d1d6',
        };
    }

    function _fmt(d) {
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }

    function _getDatesFromPeriod() {
        const period = document.getElementById('ge-period')?.value || '30';
        if (period === 'custom') {
            return {
                startDate: document.getElementById('ge-start-date')?.value || null,
                endDate:   document.getElementById('ge-end-date')?.value   || null,
            };
        }
        const today = new Date();
        const end = _fmt(today);
        if (period === '0') return { startDate: null, endDate: end };
        const start = new Date(today);
        start.setDate(start.getDate() - parseInt(period, 10) + 1);
        return { startDate: _fmt(start), endDate: end };
    }

    function onPeriodChange() {
        const val = document.getElementById('ge-period')?.value;
        const row = document.getElementById('ge-custom-date-row');
        if (row) row.style.display = val === 'custom' ? 'grid' : 'none';
    }

    function applyTemplate(xVar, yVar) {
        const xSel = document.getElementById('ge-x-axis');
        const ySel = document.getElementById('ge-y-axis');
        if (xSel) xSel.value = xVar;
        if (ySel) ySel.value = yVar;
        GE.plot();
    }

    function _setProgress(step, total, msg) {
        const el = document.getElementById('ge-progress');
        if (!el) return;
        const pct = Math.round((step / total) * 100);
        el.innerHTML = `
            <div class="ge-progress-bar"><div class="ge-progress-fill" style="width:${pct}%"></div></div>
            <div class="ge-progress-label">${msg}</div>`;
        el.style.display = 'block';
    }

    function _clearProgress() {
        const el = document.getElementById('ge-progress');
        if (el) el.style.display = 'none';
    }

    function showLoading() {
        const el = document.getElementById('ge-chart-area');
        if (el) el.innerHTML = `<div class="ge-loading"><div class="ge-loading-msg">Loading data…</div></div>`;
        const statsEl = document.getElementById('ge-stats');
        if (statsEl) statsEl.innerHTML = '';
        const btn = document.getElementById('ge-plot-btn');
        if (btn) { btn.disabled = true; btn.textContent = 'Computing…'; }
        _setProgress(1, 4, 'Loading entries…');
    }

    function hideLoading(btn) {
        if (btn) { btn.disabled = false; btn.textContent = 'Plot'; }
        _clearProgress();
    }

    function plot() {
        const xVar = document.getElementById('ge-x-axis').value;
        const yVar = document.getElementById('ge-y-axis').value;
        const { startDate, endDate } = _getDatesFromPeriod();
        const btn = document.getElementById('ge-plot-btn');

        showLoading();

        // Step 1 → 2: let browser paint, then load entries
        setTimeout(() => {
            _setProgress(2, 4, 'Building daily map…');
            setTimeout(() => {
                try {
                    _setProgress(3, 4, 'Computing correlation…');
                    _plotWork(xVar, yVar, startDate, endDate);
                    _setProgress(4, 4, 'Done');
                } finally {
                    hideLoading(btn);
                }
            }, 20);
        }, 30);
    }

    function _plotWork(xVar, yVar, startDate, endDate) {
        const entries = loadEntries();
        if (!entries.length) {
            showErr('No data found. Make sure you have data in the tracker before opening Trend Explorer.');
            return;
        }

        const byDate  = buildDailyMap(entries);
        const filtered = filterByDateRange(byDate, startDate, endDate);

        const pts = [];
        Object.keys(filtered).sort().forEach(date => {
            const day = filtered[date];
            if (day._count === 0 && xVar !== 'bodyWeight' && yVar !== 'bodyWeight') return;
            const x = getValue(day, xVar);
            const y = getValue(day, yVar);
            if (x == null || y == null || isNaN(x) || isNaN(y)) return;
            pts.push({ x: parseFloat(x.toFixed(2)), y: parseFloat(y.toFixed(2)), date });
        });

        const xLbl = VARIABLE_LABELS[xVar];
        const yLbl = VARIABLE_LABELS[yVar];
        const titleEl = document.getElementById('ge-chart-title');
        if (titleEl) titleEl.textContent = `${yLbl} vs ${xLbl}`;

        const chartArea = document.getElementById('ge-chart-area');
        if (!pts.length) {
            if (chart) { chart.destroy(); chart = null; }
            chartArea.innerHTML = '<div class="ge-empty">No data found for the selected variables and date range. Try widening the date range or choosing different axes.</div>';
            renderStats([], xLbl, yLbl);
            return;
        }

        // Recreate canvas
        chartArea.innerHTML = '<canvas id="ge-chart-canvas"></canvas>';
        if (chart) { try { chart.destroy(); } catch (e) {} chart = null; }

        const trend = trendLine(pts);
        const c = getChartColors();

        const datasets = [{
            label: 'Daily values',
            data: pts,
            backgroundColor: 'rgba(0, 122, 255, 0.65)',
            pointRadius: 6,
            pointHoverRadius: 9,
            type: 'scatter',
        }];

        if (trend) {
            datasets.push({
                label: 'Trend line',
                data: trend,
                borderColor: '#ff3b30',
                backgroundColor: 'transparent',
                borderWidth: 2,
                pointRadius: 0,
                type: 'line',
                tension: 0,
            });
        }

        const ctx = document.getElementById('ge-chart-canvas').getContext('2d');
        chart = new Chart(ctx, {
            type: 'scatter',
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: true,
                aspectRatio: window.innerWidth < 600 ? 1.2 : 1.8,
                plugins: {
                    legend: { labels: { color: c.text } },
                    tooltip: {
                        callbacks: {
                            label: ctx => {
                                const p = ctx.raw;
                                return p.date ? `${p.date}: (${p.x}, ${p.y})` : `(${p.x}, ${p.y})`;
                            },
                        },
                    },
                },
                scales: {
                    x: {
                        title: { display: true, text: xLbl, color: c.muted },
                        ticks: { color: c.muted },
                        grid:  { color: c.grid },
                    },
                    y: {
                        title: { display: true, text: yLbl, color: c.muted },
                        ticks: { color: c.muted },
                        grid:  { color: c.grid },
                    },
                },
            },
        });

        renderStats(pts, xLbl, yLbl);
    } // end _plotWork

    function showErr(msg) {
        const el = document.getElementById('ge-chart-area');
        if (el) el.innerHTML = `<div class="ge-empty">${msg}</div>`;
    }

    // Init: prefill custom date range inputs to last 60 days (hidden by default)
    document.addEventListener('DOMContentLoaded', () => {
        const today = new Date();
        const start = new Date(today);
        start.setDate(start.getDate() - 59);
        const startEl = document.getElementById('ge-start-date');
        const endEl   = document.getElementById('ge-end-date');
        if (startEl) startEl.value = _fmt(start);
        if (endEl)   endEl.value   = _fmt(today);
    });

    return { plot, onPeriodChange, applyTemplate };
})();

/**
 * Report Generator — Calorie Tracker Pro
 * Generates structured, machine-readable JSON reports from tracker data.
 *
 * Usage (called from app.js):
 *   const report = ReportGenerator.generateReport(state.entries, { dailyBudget, streak });
 *   ReportGenerator.downloadReport(report);
 */

const ReportGenerator = (() => {
    const APP_VERSION = '2.0.0';

    // ── Utilities ────────────────────────────────────────────────────────────

    function getEntryDate(e) {
        if (e && e.date) return e.date;
        if (e && e.timestamp) return e.timestamp.split('T')[0];
        return null;
    }

    function round1(v) { return Math.round((v || 0) * 10) / 10; }
    function roundInt(v) { return Math.round(v || 0); }

    // ── Section builders ─────────────────────────────────────────────────────

    function buildMetadata(entries) {
        const foodEntries = entries.filter(e => !(e && e._meta === 'dailyWeight'));
        const dates = foodEntries.map(getEntryDate).filter(Boolean).sort();
        return {
            exportedAt:   new Date().toISOString(),
            appVersion:   APP_VERSION,
            exportedBy:   'Calorie Tracker Pro',
            totalEntries: foodEntries.length,
            dateRange: {
                start: dates[0]               || null,
                end:   dates[dates.length - 1] || null,
            },
        };
    }

    function buildSummary(entries, options = {}) {
        const food = entries.filter(e => !(e && e._meta === 'dailyWeight'));
        const dates = new Set(food.map(getEntryDate).filter(Boolean));
        const activeDays = dates.size;

        let totCal = 0, totProt = 0, totCarbs = 0, totFat = 0;
        let hsSum = 0, hsCount = 0;

        food.forEach(e => {
            totCal   += parseFloat(e.calories) || 0;
            totProt  += parseFloat(e.protein)  || 0;
            totCarbs += parseFloat(e.carbs)    || 0;
            totFat   += parseFloat(e.fat)      || 0;
            if (e.healthScore != null) { hsSum += parseFloat(e.healthScore); hsCount++; }
        });

        const avg = (total, days) => days > 0 ? round1(total / days) : 0;

        return {
            activeDays,
            totalCalories:     roundInt(totCal),
            avgCaloriesPerDay: avg(totCal, activeDays),
            totalProtein:      round1(totProt),
            avgProteinPerDay:  avg(totProt, activeDays),
            totalCarbs:        round1(totCarbs),
            avgCarbsPerDay:    avg(totCarbs, activeDays),
            totalFat:          round1(totFat),
            avgFatPerDay:      avg(totFat, activeDays),
            avgHealthScore:    hsCount > 0 ? round1(hsSum / hsCount) : null,
            settings: {
                dailyBudget: options.dailyBudget || null,
            },
            streaks: options.streak ? {
                currentStreak:    options.streak.currentStreak    || 0,
                longestStreak:    options.streak.longestStreak    || 0,
                currentStartDate: options.streak.currentStartDate || null,
                currentEndDate:   options.streak.currentEndDate   || null,
                longestStartDate: options.streak.longestStartDate || null,
                longestEndDate:   options.streak.longestEndDate   || null,
            } : null,
        };
    }

    function buildDailySummaries(entries) {
        const byDate = {};

        entries.forEach(e => {
            const d = getEntryDate(e);
            if (!d) return;
            if (!byDate[d]) {
                byDate[d] = {
                    date: d,
                    totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0,
                    entryCount: 0, _hsSum: 0, _hsCount: 0,
                    bodyWeightKg: null,
                };
            }
            if (e._meta === 'dailyWeight') {
                byDate[d].bodyWeightKg = parseFloat(e.weight) || null;
            } else {
                byDate[d].totalCalories += parseFloat(e.calories) || 0;
                byDate[d].totalProtein  += parseFloat(e.protein)  || 0;
                byDate[d].totalCarbs    += parseFloat(e.carbs)    || 0;
                byDate[d].totalFat      += parseFloat(e.fat)      || 0;
                byDate[d].entryCount++;
                if (e.healthScore != null) {
                    byDate[d]._hsSum   += parseFloat(e.healthScore);
                    byDate[d]._hsCount++;
                }
            }
        });

        return Object.values(byDate)
            .sort((a, b) => a.date.localeCompare(b.date))
            .map(d => ({
                date:          d.date,
                totalCalories: roundInt(d.totalCalories),
                totalProtein:  round1(d.totalProtein),
                totalCarbs:    round1(d.totalCarbs),
                totalFat:      round1(d.totalFat),
                entryCount:    d.entryCount,
                avgHealthScore: d._hsCount > 0 ? round1(d._hsSum / d._hsCount) : null,
                bodyWeightKg:  d.bodyWeightKg,
            }));
    }

    function buildEntries(entries) {
        return entries
            .filter(e => !(e && e._meta === 'dailyWeight'))
            .map(e => ({
                date:        e.date || getEntryDate(e),
                timestamp:   e.timestamp || null,
                time:        e.time      || null,
                food:        e.food      || '',
                calories:    parseFloat(e.calories) || 0,
                protein:     e.protein    != null ? round1(e.protein)    : null,
                carbs:       e.carbs      != null ? round1(e.carbs)      : null,
                fat:         e.fat        != null ? round1(e.fat)        : null,
                healthScore: e.healthScore != null ? parseFloat(e.healthScore) : null,
            }))
            .sort((a, b) => (a.timestamp || a.date || '').localeCompare(b.timestamp || b.date || ''));
    }

    function buildBodyWeightLog(entries) {
        return entries
            .filter(e => e && e._meta === 'dailyWeight')
            .map(e => ({
                date:       getEntryDate(e),
                weightKg:   parseFloat(e.weight) || null,
                timestamp:  e.timestamp || null,
            }))
            .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Generate a full structured report object.
     * @param {Array}  entries - state.entries from the main app
     * @param {Object} options - { dailyBudget, streak }
     * @returns {Object} Report JSON
     */
    function generateReport(entries, options = {}) {
        if (!Array.isArray(entries)) entries = [];
        return {
            metadata:       buildMetadata(entries),
            summary:        buildSummary(entries, options),
            dailySummaries: buildDailySummaries(entries),
            entries:        buildEntries(entries),
            bodyWeightLog:  buildBodyWeightLog(entries),
        };
    }

    /**
     * Trigger a JSON file download in the browser.
     * @param {Object} report - output of generateReport()
     * @param {string} [filename] - optional custom filename
     */
    function downloadReport(report, filename) {
        const json = JSON.stringify(report, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement('a');
        a.href     = url;
        a.download = filename || `calorie-tracker-report-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    return { generateReport, downloadReport };
})();

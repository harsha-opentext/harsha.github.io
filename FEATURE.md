# Per-Date Data Files (scalable sync)

This document describes a phased implementation to change the Calorie Tracker app from overwriting a single large file to a scalable per-day file layout under a `data/` folder in the repository. Each phase is independent and testable.

Goals
- Avoid sending (and re-sending) whole-app JSON payloads on every change.
- Keep history/analytics working unchanged for end users.
- Make pushes small (per-day) to avoid browser memory/network limits and GitHub size limits.
- Provide a safe, incremental migration path and backward compatibility.
- Use `data/<YYYY-MM-DD>.json` files as the primary data storage (the app no longer writes a single `data.json`).

Summary of phases
- Phase 1: Safe preparatory changes (config + push size guard + `state.fileIndex`).
- Phase 2: Per-date push helpers and non-destructive integration into `addEntry()` and CSV import.
- Phase 3: History — folder-aware fetch that aggregates per-day files into `state.entries` and maintains per-file SHAs.
- Phase 4: Statistics/Analytics — ensure analytics and aggregates work with per-date data and support incremental updates.
- Phase 5: Manifest/index file, performance optimizations, retry/rate-limit, and migration UI.

Phase 1 — Safeguards & config (small, non-invasive)

Objective
- Add a `dataFolder` config default and a size guard in `pushToGit()` to prevent large/unsafe pushes.
- Introduce `state.fileIndex = {}` placeholder to store per-file SHAs (no behaviour change yet).

Files to change
- `calorie-tracker/config.js` — add `dataFolder` default.
- `calorie-tracker/app.js` — add `state.fileIndex` initialization and a size guard inside `pushToGit()`.
- Documentation: this `FEATURE.md` and small entry in `README` if desired.

Detailed changes
1. `calorie-tracker/config.js`
   - Add `dataFolder: 'data'` to `DEFAULT_CONFIG`.

2. `calorie-tracker/app.js` (top-level `state`)
   - Add `fileIndex: {}` to `state`.

3. `pushToGit()` size guard (inside `calorie-tracker/app.js`)
   - Before building the `body`, measure `jsonContent.length` (UTF-16 char count) and estimate encoded size, e.g.:
     - encodedSizeEstimate = Math.ceil((jsonContent.length * 3) / 2 * 4 / 3); // rough, or use btoa to measure safely for smaller inputs
   - If encodedSizeEstimate > configurable threshold (default 5 * 1024 * 1024 bytes), abort push and log an error (do NOT change the rest of the flow).
   - Show a clear `dbg()` message and an `alert()` (or UI notification) telling user to use per-date push or manual publish.

Acceptance tests
- With large `state.entries` (simulate by creating many entries in dev), calling the manual "Publish Data" should be aborted with a clear log message and no network `PUT` request recorded.
- The existing single-file flow (small payloads) remains unchanged.

Rollback plan
- Remove the guard if needed; no other code paths changed.

Phase 2 — Per-date push (small number of edits; non-destructive)

Objective
- Add functions to push small per-date JSON files under `data/<YYYY-MM-DD>.json`.
- Integrate these pushes into `addEntry()` and `importCsvEntries()` when `getConfig('autoSave')` is enabled.
- Preserve existing full-file `pushToGit()` and manual publish buttons.

Files to change
- `calorie-tracker/app.js` — add `pushEntryForDate()` and `pushEntriesByDate()` helpers; make `addEntry()` async to optionally await per-date push; update `importCsvEntries()` auto-save block to call `pushEntriesByDate()`.
- `calorie-tracker/config.js` — already updated in Phase 1.

Detailed changes (key points)
1. `pushEntryForDate(dateStr, entry)`
   - Behavior:
     - Build `filePath = `${dataFolder}/${dateStr}.json`.
     - GET existing file through Contents API to obtain `sha` and content (if exists).
     - Parse existing JSON array (or treat as empty array if not found).
     - Append new `entry` to array, `JSON.stringify` and `PUT` the file with commit message.
     - Update `state.fileIndex[dateStr] = newSha` on success.
   - Error handling: log errors; retry is optional in Phase 2.

2. `pushEntriesByDate(entries)`
   - Group the `entries` by `date` (prefer `entry.date` or derive from `timestamp`).
   - For each date group, fetch existing per-date file, append the group, and PUT once per date.
   - Run pushes in parallel (Promise.all) with a sensible concurrency limit in Phase 3.

3. `addEntry()` modification
   - After pushing to `state.entries` and rendering, if `getConfig('autoSave')` is true, compute `dateStr` and `await pushEntryForDate(dateStr, data)`.
   - If push fails, keep local `state.entries` unchanged; set `state.hasUnsavedChanges = true` so user can fallback to manual publish.

4. `importCsvEntries()` modification
   - Replace `await pushToGit()` with `await pushEntriesByDate(csvParsedData)` when `autoSave` is enabled.

Acceptance tests
- Add an entry and confirm Network tab shows a `PUT` to `https://api.github.com/repos/<owner>/<repo>/contents/data/<YYYY-MM-DD>.json`.
- Import CSV with multiple dates; confirm a `PUT` per distinct date.
- Confirm logs show `Pushed entry to data/2026-01-21.json`.

Rollback plan
- Revert `addEntry()` and `importCsvEntries()` to previous behavior; helpers can remain harmless.

Phase 3 — Folder-aware fetch & merge (moderate change; keeps UI logic unchanged)

Objective
- Modify `fetchFromGit()` to support both legacy single-file fetch and the new folder-based layout.
- When `dataFolder` exists in config, `fetchFromGit()` should list the folder, fetch a limited set of per-date files (e.g., last N days or files matching pattern), merge their contents into `state.entries`, populate `state.fileIndex` with per-file SHAs, then call `render()`/`renderHistory()`.

Files to change
- `calorie-tracker/app.js` — update `fetchFromGit()` and add helper `fetchPerDateFiles(datesToFetch)`; initialize and persist `state.fileIndex`.

Detailed changes (key points)
1. High-level algorithm for `fetchFromGit()`:
   - If `getConfig('dataFolder')` is falsy or `dataFile` mode is explicitly configured, keep legacy behavior: GET single `dataFile` URL, set `state.sha` and `state.entries` as before.
   - Else:
     - GET `https://api.github.com/repos/${repo}/contents/${dataFolder}`.
     - If response is 200, the body is an array of items; filter items where `name` matches `^\d{4}-\d{2}-\d{2}\.json$` (or `.json` files), sort descending by name.
     - Decide files to fetch: default: newest 90 files (configurable). Build `datesToFetch` from names.
     - For each selected item, GET its content (or use `download_url`) and decode JSON → merge arrays into a master list.
     - Populate `state.fileIndex[dateStr] = sha` for each fetched file.
     - `state.entries = mergedArray` and call `render()` / `renderHistory()`.

2. Efficiency & safety:
   - Avoid fetching hundreds of files by default. Provide `getConfig('fetchDays')` or similar (e.g., 90 days), or fetch files present in the manifest (Phase 4).
   - Use `Accept: application/vnd.github.v3+json` and prefer the API `content` payload (which contains `sha` and base64 content) to avoid extra requests when listing directory returns sufficient info; however, the directory listing returns only metadata and `download_url` — you still need to GET the file contents. The code should carefully parallelize these GETs with a concurrency cap (e.g., 5 at a time).

3. `state.fileIndex` usage:
   - After fetching, `state.fileIndex = { '2026-01-21': 'sha...', ... }`.
   - `pushEntryForDate()` and `pushEntriesByDate()` should consult `state.fileIndex[dateStr]` first to avoid an extra GET; if missing, they should GET the file to obtain a SHA (or create it if 404).

Acceptance tests
- With `dataFolder` set, `fetchFromGit()` loads aggregated entries and `renderHistory()` shows records unchanged relative to previous single-file load (for the same data set).
- `state.fileIndex` contains SHAs for each fetched date file.
- If the folder does not exist or is empty, fall back to `data.json` legacy behavior.

Rollback plan
- Keep the old `fetchFromGit()` logic in code as an alternate path under `if (legacyMode) { ... }` until confident; toggled by config.

Phase 4 — Statistics/Analytics (moderate)

Objective
- Ensure analytics (charts, averages, meal distribution, and aggregates) produce identical results when `state.entries` is built from per-date files.
- Add incremental-update hooks so that when a per-date file is pushed the app can update cached statistics/charts for that date without re-fetching all files.

Files to change
- `calorie-tracker/app.js` — add `recomputeAnalyticsForDates(dates)` helper and integration points in `pushEntryForDate()` / `pushEntriesByDate()` to call it after successful PUTs.
- `calorie-tracker/index.html` — minor UI hooks for forcing analytics refresh (optional).

Detailed changes (key points)
1. Analytics data source
   - No structural change in analytics code is required if `fetchFromGit()` supplies `state.entries` in the same shape and order; however, charts that cache derived datasets should be able to accept incremental updates.

2. `recomputeAnalyticsForDates(dates)`
   - Implement a helper that filters `state.entries` for the given date(s) and updates Chart.js datasets and summary stats for only the impacted range. This avoids a full re-render or re-fetch when a single per-date file changes.

3. Integration
   - After per-date PUT succeeds, call `recomputeAnalyticsForDates([dateStr])` to update charts and UI. If Charts are not yet initialized, fall back to `updateAnalytics()` which performs full-chart render.

4. Back-compat
   - If the app is still using the monolithic `data.json` flow, analytics operate unchanged. The incremental hook is only invoked by the per-date push paths.

Acceptance tests
- Add an entry for today with `autoSave` enabled and verify charts update without performing a full `fetchFromGit()` (watch Network – only the per-date PUT should occur and no bulk GETs).
- Import CSV for a specific date and ensure analytics for that date update after the per-date PUTs.

Rollback plan
- Remove the incremental hook calls; full `updateAnalytics()` will continue to work and produce correct results.

Phase 5 — Manifest, UX, and scaling improvements (optional but recommended)

Objective
- Add an optional `data/index.json` manifest to make fetches efficient (single GET for the list of available dates + SHAs).
- Add UI controls for retention window (how many days to fetch), migration helper to convert existing `data.json` into per-day files, and robust retry/backoff for many small requests.

Files to change
- `calorie-tracker/app.js` — implement manifest logic and migration helpers; add rate-limited fetch utilities.
- `calorie-tracker/index.html` — add small settings UI for migration/retention.
- `calorie-tracker/config.js` — add defaults for `fetchDays`, `useManifest`.

Detailed changes
1. `data/index.json` manifest format
   - Example:
```json
{
  "dates": [
    { "date": "2026-01-21", "sha": "abcd1234", "entries": 12 },
    ...
  ],
  "generated": "2026-01-21T12:00:00Z"
}
```
   - On per-date write, update `data/index.json` alongside the per-date file (two PUTs) OR use a single commit via Git Data API (Phase 4 advanced).

2. Migration helper
   - Provide `migrateDataJsonToPerDate()` which:
     - Reads the existing `data.json` (if present), groups entries by date, writes each `data/<date>.json`, and writes `data/index.json` manifest.
     - This is an action the user triggers explicitly (Settings → Migrate) and should be idempotent.

3. UI changes
   - Settings: `Fetch window (days)`, `Use manifest` toggle, `Migrate now` button, and informative logs.

4. Reliability
   - Implement concurrency-limited fetch/put with retries and exponential backoff.
   - Graceful error handling and informative logs.

Acceptance tests
- Manifest fetch loads quickly; older files skipped if outside retention window.
- Migration produces expected per-date files and manifest; verify by checking the repository.
- Large repositories (many files) no longer cause the browser to crash; only the recent window is fetched.

Compatibility notes
- The app uses per-day `data/<YYYY-MM-DD>.json` files as its primary storage and no longer writes a single `data.json` file.
- A repository may contain older `data.json` artifacts; the app prefers `data/` files and will not create or update `data.json`.

Testing guidance (per-phase)

Phase 1 tests (manual)
- 1a. Set `gt_token` and `gt_repo` in localStorage (app Settings).
- 1b. In dev console, populate `state.entries` with a large synthetic array and call `pushToGit()`; confirm it aborts when over threshold and logs the message.

Phase 2 tests (manual)
- 2a. Enable `autoSave` in Settings.
- 2b. Add a single entry; watch Network → confirm `PUT` to `data/<YYYY-MM-DD>.json`.
- 2c. Import a CSV that contains entries for multiple dates; confirm one `PUT` per date.
- 2d. Confirm manual Publish still writes `data.json`.

Phase 3 tests (manual)
- 3a. Configure `dataFolder = 'data'`.
- 3b. Run `fetchFromGit()`; confirm Network shows `GET` to `contents/data` then a limited number of `GET` requests for per-date files.
- 3c. Verify `state.entries` matches expected merged content and `state.fileIndex` contains SHAs.

Phase 4 tests (manual)
- 4a. Add an entry for today with `autoSave` enabled and verify charts update without a full `fetchFromGit()` (watch Network — only the per-date PUT should occur and no bulk GETs).
- 4b. Import a CSV containing entries for a single date and ensure analytics for that date update after the per-date PUTs.
- 4c. Verify `recomputeAnalyticsForDates([date])` updates Chart.js datasets and summary stats for the impacted date without full re-render.

Phase 5 tests (manual)
- 5a. Trigger `Migrate` (if implemented) and check repository for `data/<date>.json` files and `data/index.json` manifest.
- 5b. Toggle `useManifest` and ensure fetch uses manifest to limit requests.
- 5c. With a very large repo, verify fetch performance remains acceptable and browser memory is stable when using manifest + retention window.

Developer notes & code style
- Keep changes small and grouped by phase.
- Avoid changing field names in `state.schema` or UI templates — the UI reads from `state.entries` and will continue to work if `fetchFromGit()` returns the same array shape.
- Use existing logging helper `dbg(msg, type)` for all informative messages and errors.
- Make helper functions `async` and careful about concurrency (do not parallelize more than 5 simultaneous HTTP requests).

Migration and rollout strategy
1. Implement Phase 1 and deploy to users who want to test locally. This prevents catastrophic pushes early.
2. Implement Phase 2 and announce opt-in `autoSave` behavior for per-date pushes.
3. Implement Phase 3; encourage users to test fetch and report issues.
4. Implement Phase 4 manifest & migration; offer a migration button that users run when comfortable.

Appendix — Example snippets

Push single-date file (example):

```js
// simplified example
async function pushEntryForDate(dateStr, entry) {
  const repo = localStorage.getItem('gt_repo');
  const token = localStorage.getItem('gt_token');
  const filePath = `data/${dateStr}.json`;
  const url = `https://api.github.com/repos/${repo}/contents/${filePath}`;

  // GET existing file to obtain sha
  const getRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  let existing = [];
  let sha = null;
  if (getRes.ok) {
    const j = await getRes.json();
    sha = j.sha;
    existing = JSON.parse(atob(j.content));
  }

  existing.push(entry);
  const body = { message: `Add entry ${dateStr}`, content: btoa(unescape(encodeURIComponent(JSON.stringify(existing, null, 2))))) };
  if (sha) body.sha = sha;
  await fetch(url, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
```

Notes about encoding and size
- Base64 increases size ~33%.
- GitHub Contents API has a 100MB file limit per file. Browsers will run out of memory well before that for base64 strings.
- Per-date files keep each PUT small and safe.

End of document.

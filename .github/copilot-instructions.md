# GitHub Pages Tracker - AI Coding Guide

## Architecture Overview

This is a **schema-driven, single-page web app** that uses GitHub as a backend storage layer. The entire application runs client-side with no server required.

**Core Components:**
- [index.html](../index.html) - Multi-page SPA with navigation (tracker/history/analytics/settings/logs)
- [app.js](../app.js) - ~730 lines containing ALL application logic
- [schema.yaml](../schema.yaml) - Dynamic schema definition that auto-generates UI
- [config.js](../config.js) - Default configuration with localStorage override pattern
- [styles.css](../styles.css) - Modern iOS-inspired UI with card-based layouts

**Data Flow:**
1. Schema defines data structure → Form fields auto-generated
2. User adds entries → Stored in `state.entries` array
3. Push to GitHub → JSON stored in repo via GitHub API
4. Fetch from GitHub → Updates local state and re-renders

## Schema-Driven Architecture

**CRITICAL:** The entire UI is generated from [schema.yaml](../schema.yaml). Never hardcode field names or types.

```yaml
schema:
  fields:
    - name: "timestamp"
      type: "hidden"
      autoCapture: true  # Auto-populates on entry creation
```

**Field Types:** `text`, `number`, `date`, `select`, `hidden`
- `hidden` fields with `autoCapture: true` are automatically populated (see `addEntry()` in [app.js](../app.js#L255))
- `date` fields with `default: "today"` auto-fill current date
- Schema changes require page refresh (loaded once at startup)

**Form Generation:** See `renderFormFields()` in [app.js](../app.js#L177) - loops through `state.schema.fields` to create inputs dynamically.

## GitHub API Integration

**Authentication:** Uses Personal Access Token stored in localStorage (no backend authentication).

**Key Functions:**
- `fetchFromGit()` ([app.js](../app.js#L307)) - GET from GitHub Contents API
- `pushToGit()` ([app.js](../app.js#L360)) - PUT with base64-encoded JSON content
- **SHA tracking:** `state.sha` is critical - must be included in PUT requests to update existing files

**Important:** Base64 encode/decode is done with `btoa()`/`atob()` native functions.

## State Management

Single global `state` object holds everything:
```javascript
state = {
    entries: [],     // Main data array
    sha: "",        // GitHub file SHA for updates
    logs: [],       // Debug logs with timestamps
    schema: null,   // Loaded schema object
    logLevel: 'info'
}
```

**No React/Vue:** Direct DOM manipulation with `render()` function. All UI updates go through `render()` or page-specific render functions (`renderHistory()`, `updateAnalytics()`).

## Page Navigation System

Multi-page SPA with function `showPage(pageName)`:
- Toggles `.active` class on pages and nav buttons
- Each page has lazy rendering (e.g., analytics charts only build when page is shown)
- Pages: `tracker` (default), `history`, `analytics`, `settings`, `logs`

## Logging System

**Extensive debug logging** with retention and log levels (see [app.js](../app.js#L17-L85)):
- `dbg(msg, type, raw)` - type: `debug`, `info`, `warn`, `error`
- Log retention configurable (default: 5 minutes)
- Logs prepended to DOM (newest first) and stored in `state.logs`
- **Pattern:** Always log before/after API calls and major state changes

## Chart.js Integration

Analytics page uses Chart.js v4 ([CDN loaded in index.html](../index.html#L10)):
- Three chart types: Line (daily trend), Doughnut (meal distribution), Bar (weekly comparison)
- Charts cached in `window.analyticsCharts` object to allow destroy/recreate
- Time period filtering via dropdown (7/14/30/90 days, all time)

## Development Workflow

**No build process** - pure HTML/CSS/JS served statically:
```bash
python3 -m http.server 8000  # Run local server
open http://localhost:8000
```

**Key conventions:**
- All paths are relative (no leading `/`) for GitHub Pages compatibility
- External libs loaded via CDN (js-yaml, Chart.js)
- Browser storage persists credentials and config overrides

## Configuration Override Pattern

See [config.js](../config.js):
```javascript
function getConfig(key) {
    const stored = localStorage.getItem(`config_${key}`);
    return stored !== null ? JSON.parse(stored) : DEFAULT_CONFIG[key];
}
```

Users can override `dataFile`, `schemaFile`, `logRetentionMinutes` without editing code.

## Common Patterns

**Adding new schema fields:** Edit [schema.yaml](../schema.yaml), refresh page - form auto-updates
**Filtering data:** See `filterHistory()` - filters `state.entries` and re-renders
**Auto-capture fields:** Check `field.autoCapture` in `addEntry()` function
**Error handling:** Always log with `dbg(msg, 'error')` before showing user alert

## Common Issues

**Schema fails to load ("Failed to fetch"):**
- User opened `index.html` directly as file:// - fetch() API requires HTTP
- Solution: Run `python3 -m http.server 8000` and open `http://localhost:8000`
- Error shows in both main container and form panel with setup instructions

**404 on first GitHub fetch:**
- Normal behavior - `data.json` doesn't exist yet
- App will create file on first push with commit message "Sync: <timestamp>"

## Testing Checklist

1. ✅ **Always run via HTTP server** - never open index.html directly
2. Verify schema loads: Check logs for "Schema loaded" message
3. Test without GitHub credentials: Should show config prompt
4. Test 404 on first fetch: Should create file on first push
5. Verify SHA updates: Check logs for "New SHA" after push
6. Test date filters: History page with various date ranges

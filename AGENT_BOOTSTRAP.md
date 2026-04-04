# Agent Bootstrap — Calorie & Workout Tracker (Angular)

> Load this file before working on any feature. It is the single source of truth for project architecture, patterns, and conventions. Do not explore the codebase from scratch — use this file first.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Repo Layout](#2-repo-layout)
3. [Technology Stack & Angular Patterns](#3-technology-stack--angular-patterns)
4. [App Bootstrap](#4-app-bootstrap)
5. [Routing Structure](#5-routing-structure)
6. [State Management](#6-state-management)
7. [Core Services Reference](#7-core-services-reference)
8. [Models / Interfaces Reference](#8-models--interfaces-reference)
9. [Feature Components Reference](#9-feature-components-reference)
10. [Shared Components, Pipes & Utilities](#10-shared-components-pipes--utilities)
11. [Data Storage Patterns](#11-data-storage-patterns)
12. [Schema YAML](#12-schema-yaml)
13. [Build & Dev Workflow](#13-build--dev-workflow)
14. [Checklist for Adding a New Feature](#14-checklist-for-adding-a-new-feature)
15. [Critical Safety Rules](#15-critical-safety-rules)
16. [Common Pitfalls](#16-common-pitfalls)

---

## 1. Project Overview

This is a **client-side-only Angular SPA** that runs on GitHub Pages. There is no backend. GitHub itself is the storage layer: data is stored as per-day JSON files in a private repo via the GitHub Contents REST API. Users authenticate with a Personal Access Token stored in localStorage.

There are **two main tracker domains:**
- **Calorie Tracker** — log food entries, macros, body weight; view analytics and streaks.
- **Workout Tracker** — log gym sessions, track exercises/sets/reps, manage workout definitions, session templates, weekly streaks.

Everything is driven by a `schema.yaml` file that auto-generates UI form fields.

---

## 2. Repo Layout

```
harsha.github.io/
├── AGENT_BOOTSTRAP.md         ← this file
├── build.sh                   ← CI build script (npm ci + ng build)
├── start.sh                   ← dev server launcher (ng serve)
├── index.html                 ← static redirect page (root of GitHub Pages)
├── calorie-tracker-ng/        ← THE ANGULAR APP (everything lives here)
│   ├── angular.json
│   ├── package.json
│   ├── tsconfig*.json
│   ├── public/
│   │   └── schema.yaml        ← dynamic schema definition
│   └── src/
│       ├── index.html
│       ├── main.ts
│       ├── styles.scss
│       └── app/
│           ├── app.ts             ← root component
│           ├── app.config.ts      ← Angular providers (router, http, animations)
│           ├── app.routes.ts      ← top-level route definitions
│           ├── app.html
│           ├── app.scss
│           ├── core/
│           │   ├── models/        ← TypeScript interfaces (see §8)
│           │   └── services/      ← global singleton services (see §7)
│           ├── features/          ← one folder per page/route (see §9)
│           └── shared/
│               ├── components/    ← reusable modal/UI components (see §10)
│               ├── pipes/         ← format pipes (see §10)
│               └── utils/         ← pure utility functions (see §10)
└── legacy/                    ← OLD vanilla-JS version; do not modify
```

All work happens inside `calorie-tracker-ng/`.

---

## 3. Technology Stack & Angular Patterns

| Concern | Choice |
|---|---|
| Framework | Angular **21.2.x** |
| Language | TypeScript **~5.9** |
| Reactivity | **Angular Signals** (`signal`, `computed`) — primary approach |
| RxJS | Used minimally; converted to signals via `toSignal()` |
| DI | **`inject()` function** — no constructor injection |
| Components | **Standalone** — zero NgModules |
| Templates | Angular **17+ control flow** (`@if`, `@for`, `@let`) |
| Routing | **Hash-based** (`withHashLocation()`) for GitHub Pages (`/#/route`) |
| HTTP | `HttpClient` with `firstValueFrom()` + `async/await` |
| Lazy loading | Every route uses `loadChildren: () => import(...)` |
| Charts | **Chart.js v4** |
| YAML parsing | **js-yaml** |
| Testing | **Vitest** + jsdom |
| Styles | SCSS; dark theme by default; iOS-inspired cards |

**Angular-specific conventions to follow:**
- Always use `inject()` instead of constructor DI.
- All state = `signal()`. Derived state = `computed()`. No direct mutation of signals — use `.set()` or `.update()`.
- New components must be `standalone: true` in the `@Component` decorator.
- Use `@if` / `@for` / `@let` in templates (not `*ngIf` / `*ngFor` / `ngLet`).
- Use `firstValueFrom(observable)` in async service methods; avoid `.subscribe()` in services.
- `ChangeDetectionStrategy.Default` is acceptable for chart-heavy components.

---

## 4. App Bootstrap

### `app.config.ts`
```typescript
providers: [
  provideBrowserGlobalErrorListeners(),
  provideRouter(routes, withHashLocation()),
  provideHttpClient(),
  provideAnimations(),
]
```
No interceptors — auth headers are added manually in each API service.

### `app.ts` — Root Component
- Selector: `app-root`
- Renders `<router-outlet>` plus four **global modals**: `ConfirmModal`, `NotificationToast`, `EntryPreviewModal`, `CsvExportModal`
- `ngOnInit()`: initialises theme → loads schema → restores streak from localStorage
- Signals: `isWorkoutContext`, `isHomePage` (derived from router URL via `toSignal()`)

---

## 5. Routing Structure

```
/                    → smartRedirect() → reads localStorage 'lastUsedTracker'
/home                → HomeComponent
/calorie-hub         → CalorieHubComponent   (tile launcher dashboard)
/tracker             → TrackerComponent
/history             → HistoryComponent
/analytics           → AnalyticsComponent
/settings            → SettingsComponent
/logs                → LogsComponent
/streaks             → StreaksComponent
/apps                → MiniAppsComponent
/trend               → TrendExplorerComponent
/report              → ReportGeneratorComponent
/workout             → WORKOUT_ROUTES (nested lazy)
  /workout/hub       → WorkoutHubComponent
  /workout/log       → SessionLogComponent
  /workout/workouts  → WorkoutsComponent
  /workout/history   → WorkoutHistoryComponent
  /workout/streaks   → WorkoutStreaksComponent
  /workout/analytics → WorkoutAnalyticsComponent
  /workout/settings  → WorkoutSettingsComponent
  /workout/templates → SessionTemplatesComponent
  /workout/logs      → WorkoutLogsComponent
  /workout/report    → WorkoutReportComponent
```

Each feature folder contains a `*.routes.ts` file that exports its route array and is referenced from `app.routes.ts` via `loadChildren`.

---

## 6. State Management

There is **one global signal store per domain**, no Redux/NgRx.

### `StateService` — Calorie domain
File: `core/services/state.service.ts`

All fields are `signal()`:

| Signal | Type | Purpose |
|---|---|---|
| `entries` | `AnyEntry[]` | In-memory loaded entries |
| `fileIndex` | `Record<string,string>` | `YYYY-MM-DD → GitHub SHA` |
| `schema` | `Schema \| null` | Loaded schema object |
| `streak` | `StreakData` | Streak counters |
| `streakCalendar` | `{offsetMonths, cache}` | Calendar month cache |
| `logLevel` | `LogType` | Debug log filter |
| `retentionMinutes` | `number` | Log purge window |
| `dateRangeStart/End` | `string` | History filter range |
| `historyPage` | `number` | Current history page |
| `historyFetchInProgress` | `boolean` | Fetch lock |
| `historyFoodFilter` | `string` | Text filter for history |
| `selectMode` | `boolean` | Tracker multi-select |
| `selectedEntries` | `number[]` | Tracker selected indices |
| `historySelectMode` | `boolean` | History multi-select |
| `historySelectedEntries` | `number[]` | History selected indices |
| `hasUnsavedChanges` | `boolean` | Unsaved indicator |
| `autoSyncing` | `boolean` | Background sync flag |
| `weightEditMode` | `boolean` | Weight edit panel open |
| `weightEditTargetDate` | `string` | Date for weight edit |
| `tempCsvData` | `string \| null` | CSV export buffer |
| `csvSource` | `string` | Source label for CSV |
| `analyticsDate` | `string` | Date shown on analytics page |

**Computed signals:**
- `todayEntries` — today's food entries (excludes weight entries)
- `todayCalories` — sum of today's calories
- `todayMacros` — `{ protein, carbs, fat }` float totals for today

### `WorkoutStateService` — Workout domain
File: `core/services/workout-state.service.ts`

All `signal()`: `workouts`, `sessions`, `templates`, `fileIndex`, `streakData`, `config`, `templateSession`, `appliedTemplate`, `workoutsLoaded`, `sessionsLoaded`, `templatesLoaded`.

---

## 7. Core Services Reference

### `AuthService` — `core/services/auth.service.ts`
| Method/Prop | Purpose |
|---|---|
| `getToken()` | Read PAT from `localStorage['gt_token']` |
| `getRepo()` | Read `owner/repo` from `localStorage['gt_repo']` |
| `hasCredentials()` | Boolean guard — call before any GitHub API |
| `setCredentials(token, repo)` | Save to localStorage |

---

### `ConfigService` — `core/services/config.service.ts`
| Method | Purpose |
|---|---|
| `getConfig(key)` | Read `config_<key>` from localStorage; falls back to `DEFAULT_CONFIG` |
| `setConfig(key, value)` | Write `config_<key>` as JSON |
| `getAllConfig()` | Returns merged `AppConfig` (defaults + all localStorage overrides) |

---

### `SchemaService` — `core/services/schema.service.ts`
| Method | Purpose |
|---|---|
| `loadSchema()` | `GET schema.yaml` → parse with js-yaml → inject `healthScore` if absent → set `state.schema` |

The schema path comes from `configService.getConfig('schemaFile')`. Schema is loaded once at app boot.

---

### `GithubApiService` — `core/services/github-api.service.ts`
Calorie data I/O. All requests have a **15-second timeout**. Data files live at `data/YYYY-MM-DD.json`.

| Method | Signature | Purpose |
|---|---|---|
| `validateRepoConnection()` | `→ Promise<ValidationResult>` | GET `/repos/{repo}` to verify credentials |
| `fetchFromGit(onlyToday?)` | `→ Promise<void>` | Fetch today's file; populate `state.entries` + `state.fileIndex` |
| `fetchDateFromGit(dateStr)` | `→ Promise<FetchDateResult>` | Fetch single date; returns `{status, entries}` |
| `pushEntryForDate(dateStr, entry)` | `→ Promise<void>` | Append entry to date file (creates if new) |
| `pushDateFile(dateStr, entries[])` | `→ Promise<void>` | PUT full array for a date |
| `deleteDateFile(dateStr)` | `→ Promise<void>` | DELETE a per-day file |
| `pushStreakFile(data)` | `→ Promise<void>` | PUT `data/streak.json` |
| `saveSettingsToRepo(config)` | `→ Promise<void>` | PUT `data/settings.json` |
| `loadSettingsFromRepo()` | `→ Promise<AppConfig \| null>` | GET `data/settings.json` |
| `bulkSaveDates(dateMap)` | `→ Promise<void>` | Batch PUT multiple date files |

**SHA handling:** SHA for each file is tracked in `state.fileIndex`. A `409 Conflict` triggers a re-fetch of the file's current SHA and a single retry — this logic is already implemented; do not duplicate it.

---

### `WorkoutGithubApiService` — `core/services/workout-github-api.service.ts`
Workout data I/O. All files live under `workout-data/`.

| Method | Purpose |
|---|---|
| `loadWorkouts()` / `saveWorkouts(w[])` | `workout-data/workouts.json` |
| `loadSession(date)` / `saveSession(date, s)` / `deleteSession(date)` | `workout-data/YYYY-MM-DD.json` |
| `loadSessions(dateRange)` | Parallel fetch for a date range |
| `loadStreakData()` / `saveStreakData(d)` | `workout-data/streak.json` |
| `loadConfig()` / `saveConfig(c)` | `workout-data/config.json` |
| `loadTemplates()` / `saveTemplates(t[])` | `workout-data/templates.json` |

---

### `LoggingService` — `core/services/logging.service.ts`
| Method | Purpose |
|---|---|
| `dbg(msg, type?, raw?)` | Append a log entry (`debug\|info\|warn\|error`); auto-prunes by retention time |
| `logs` signal | `LogEntry[]` newest-first |
| `clearLogs()` | Empty the log array |
| `copyLogs()` | Copy to clipboard |
| `setLogLevel(level)` | Filter threshold |
| `setRetentionMinutes(n)` | Purge window |

**Convention:** always call `dbg()` before and after GitHub API calls, and on every error branch.

---

### `NotificationService` — `core/services/notification.service.ts`
| Method | Purpose |
|---|---|
| `showNotification(msg, type, forceFull?)` | Show toast or dot; type = `'info'\|'write'\|'read'\|'error'\|'delete'\|'success'` |
| `toasts` signal | Active full toasts (auto-removed after 2800 ms) |
| `dots` signal | Active small dots (auto-removed after 2200 ms) |

Toasts are suppressed to dots when `config.showToasts === false`, **except** for `error` type which always shows full.

---

### `ThemeService` — `core/services/theme.service.ts`
| Method | Purpose |
|---|---|
| `initTheme()` | Read `gt_theme` from localStorage, apply, attach media-query listener |
| `setTheme(mode)` | `'auto'\|'light'\|'dark'`; sets `data-theme` on `<html>`, saves to config |

---

## 8. Models / Interfaces Reference

### Calorie models (`core/models/`)

#### `Entry` (entry.model.ts)
```typescript
{
  timestamp: string       // ISO datetime — auto-captured
  date: string            // YYYY-MM-DD
  food: string
  calories: number
  protein?: number
  carbs?: number
  fat?: number
  healthScore?: number    // 1-10; injected by SchemaService if missing
  time?: string           // "3:00 PM" (12h)
  _sourceDate?: string    // set by fetchDateFromGit
  [key: string]: unknown  // other dynamic schema fields
}
```

#### `WeightEntry` (entry.model.ts)
```typescript
{
  _meta: 'dailyWeight'    // discriminant — use isWeightEntry() to check
  weightKg: number
  weight?: number         // legacy compat alias
  timestamp: string
  date: string
  _sourceDate?: string
}
```

**`isWeightEntry(e)`** — exported type guard; always use it to differentiate.  
**`AnyEntry`** = `Entry | WeightEntry`

#### `Schema` / `SchemaField` (schema.model.ts)
```typescript
SchemaField {
  name: string
  type: 'text' | 'number' | 'date' | 'time' | 'select' | 'hidden'
  label?: string
  required?: boolean
  placeholder?: string
  default?: string | number    // "today" triggers date auto-fill
  autoCapture?: boolean        // auto-populates timestamp on entry creation
  min?: number; max?: number
  options?: string[]           // for select type
}

Schema {
  name: string
  displayName: string
  fields: SchemaField[]
  totalField: string           // "calories"
  displayFormat?: string
}
```

#### `AppConfig` (config.model.ts)
```typescript
{
  dataFolder: string           // default: "data"
  schemaFile: string           // default: "schema.yaml"
  logFile: string
  maxLogFileSize: number
  fetchDays: number            // default: 90
  dateFormat: string
  autoFetch: boolean
  autoSave: boolean
  dailyBudget: number          // default: 2000
  theme: 'auto' | 'dark' | 'light'   // default: 'dark'
  showLogs: boolean
  showToasts: boolean
  allowEditOlderWeights: boolean
  autoIncrementStreakOnAdd: boolean
  logRetentionMinutes: number  // default: 5
  logFolder: string
}
```

#### `StreakData` (streak.model.ts)
```typescript
{
  currentStreak: number
  longestStreak: number
  lastActiveDate: string | null
  currentStartDate?: string | null
  currentEndDate?: string | null
  longestStartDate?: string | null
  longestEndDate?: string | null
  computedAt: string | null
  activeDates: string[]
  recentActiveDates?: string[]   // last 30 active dates
}
```

#### GitHub models (github.model.ts)
```typescript
GitHubFileResponse  { name, path, sha, size, url, content, encoding, type? }
GitHubContentsItem  { name, path, sha, size, url, download_url, type: 'file'|'dir' }
GitHubPutResponse   { content: GitHubFileResponse, commit: { sha, message } }
ValidationResult    { ok: boolean, message?: string }
FetchDateResult     { status: number, entries: AnyEntry[] | null }
```

#### `LogEntry` (log.model.ts)
```typescript
{ ts: number, text: string, type: 'debug'|'info'|'warn'|'error' }
```

### Workout models (`core/models/`)

#### `Workout` (workout.model.ts)
```typescript
{
  id: string
  name: string
  muscleGroups?: MuscleGroup[]
  muscleGroup?: MuscleGroup    // legacy single-value compat
  description?: string
  cues?: string
  createdAt: string
}
MuscleGroup = 'chest'|'back'|'legs'|'shoulders'|'arms'|'core'|'cardio'|'full body'
```

#### `Session` (session.model.ts)
```typescript
{
  id: string
  date: string
  gymName?: string
  startTime?: string
  endTime?: string
  mood?: 1|2|3|4|5
  entries: SessionEntry[]
}
SessionEntry { id, workoutId, sets: WorkoutSet[] }
WorkoutSet   { setNumber, reps, weightKg, breakSeconds? }
```

#### `SessionTemplate` (session-template.model.ts)
```typescript
{ id, name, gymName?, entries: TemplateEntry[], createdAt }
TemplateEntry { workoutId, sets: TemplateSet[] }
```

#### `WorkoutStreakData` (workout-streak.model.ts)
```typescript
{ currentStreak, bestStreak, weeklyTarget, lastUpdated }
```

#### `WorkoutConfig` (workout-config.model.ts)
```typescript
{ weeklyTarget: number, defaultGymName?: string }
DEFAULT_WORKOUT_CONFIG = { weeklyTarget: 5 }
```

---

## 9. Feature Components Reference

| Route | Component file | Key responsibility |
|---|---|---|
| `/home` | `features/home/home.component.ts` | Two-card launcher; sets `lastUsedTracker` |
| `/calorie-hub` | `features/calorie-hub/calorie-hub.component.ts` | 9-tile app launcher for calorie features |
| `/tracker` | `features/tracker/tracker.component.ts` | Log food entries + body weight; uses `TrackerService` |
| `/history` | `features/history/history.component.ts` | Date-grouped paginated history; bulk select/delete |
| `/analytics` | `features/analytics/analytics.component.ts` | Per-day charts (meal distribution, macros, quality score) |
| `/settings` | `features/settings/settings.component.ts` | All config; GitHub credentials; streak compute |
| `/logs` | `features/logs/logs.component.ts` | Debug log viewer |
| `/streaks` | `features/streaks/streaks.component.ts` | Streak hero numbers + calendar grid |
| `/apps` | `features/mini-apps/mini-apps.component.ts` | Tile launcher for mini-apps |
| `/trend` | `features/trend-explorer/trend-explorer.component.ts` | Variable-vs-variable scatter chart |
| `/report` | `features/report-generator/report-generator.component.ts` | JSON report generate/download |
| `/workout/hub` | Workout Hub | 9-tile launcher for workout features |
| `/workout/log` | Session Log | Log today's session (exercises/sets/reps/mood) |
| `/workout/workouts` | Workouts | CRUD workout definitions |
| `/workout/history` | Workout History | Browse past sessions |
| `/workout/streaks` | Workout Streaks | Weekly streak + calendar |
| `/workout/analytics` | Workout Analytics | Per-workout progression charts |
| `/workout/settings` | Workout Settings | Weekly target, gym name |
| `/workout/templates` | Session Templates | Create/apply session templates |

### Sub-components (under features/)

**`features/tracker/components/`**
- `BudgetBarComponent` — calorie progress bar (calories vs `dailyBudget`)
- `EntryFormComponent` — schema-driven form; emits `(entryAdded)`; handles `autoCapture`, `hidden`, date/time defaults  
- `EntryCardComponent` — single entry card; modes `'tracker'` and `'history'`; emits events up to parent
- `CsvImportModalComponent` + `CsvImportService` — CSV paste/upload; column mapping; emits `(importEntries)`

**`features/history/components/`**
- `WeightGraphModalComponent` — line chart of body weight over time

---

### Service Layer (features)

#### `TrackerService` — `features/tracker/tracker.service.ts`
| Method | Purpose |
|---|---|
| `getFormData(formValues)` | Map form values → `AnyEntry` using schema; handles `autoCapture`, type coercion, 24h→12h time |
| `validateRequiredFields(data)` | Check schema `required` fields |
| `addEntry(data)` | Append to `state.entries`; call `github.pushEntryForDate()` |
| `editEntry(idx, updated)` | Rebuild date array; call `github.pushDateFile()` |
| `deleteEntry(idx)` | Confirm modal → remove from file; delete file if empty |
| `deleteEntryDirect(idx)` | Same without confirm |
| `repeatEntryToday(idx)` / `addEntryToToday(idx)` | Clone entry to today's date |
| `bulkDelete(indices[])` | Confirm modal with preview → parallel writes to affected dates |

#### `HistoryService` — `features/history/history.service.ts`
All state via `computed()`:
- `filteredEntries` — date range + food text filter
- `stats` — aggregate totals/averages (handles macro field name aliases: `protein(g)`, `Protein`, etc.)
- `groupedDates` — `GroupedDate[]` (date-keyed, weight extracted)
- `totalPages`, `pagedDates` — pagination (5 dates/page)
- `weightDataForGraph` — sorted `{date, weight}[]`
- `setRangePreset(preset)` — map preset → `state.dateRangeStart/End`; triggers GitHub fetch if needed
- `fetchRangeFromGit(start, end)` — parallel fetch of missing dates

#### `AnalyticsService` — `features/analytics/analytics.service.ts`
- `selectedDate` — alias to `state.analyticsDate`
- `entriesForDate` — from local state or `tempCache`
- `mealData` — `Record<timeSlot, calories>` for doughnut chart
- `macroData` — `{protein, carbs, fat}` totals
- `nutritionQuality` — day score, calorie tier breakdown, per-meal health score
- `loadDateIfNeeded(dateStr)` — fetch from GitHub only if not loaded

#### `SettingsService` — `features/settings/settings.service.ts`
- `saving`, `validating`, `loadingFromRepo` — loading state signals
- `saveCredentials(token, repo, budget)` — save to Auth + Config; validate; trigger fetch
- `persistSettingsToRepo()` — debounced (250ms) via RxJS Subject
- `loadFromRepo()` — GET `settings.json`; apply locally
- `validateConnection()` — call `github.validateRepoConnection()`
- `computeStreak()` — scan `state.entries` for active dates → compute → push to GitHub

#### `StreaksService` — `features/streaks/streaks.service.ts`
- `computeCurrentStreak()` — walk backwards from today; fetch missing dates from GitHub; save
- `showMonth(offset)` — fetch all days in a month (6 concurrent); build `MonthCalendarData`; cache by `YYYY-MM`
- `buildCalendarCells()` — Monday-aligned grid generation
- `offsetMonths` signal — derived from `state.streakCalendar.offsetMonths`

---

## 10. Shared Components, Pipes & Utilities

### Shared Components (`shared/components/`)

#### `ConfirmService` + `ConfirmModalComponent`
Promise-based confirm dialog.
```typescript
confirmService.show(message, title?, details?) → Promise<boolean>
```
`details` is rendered as HTML in an expandable section. Always use this instead of `window.confirm()`.

#### `NotificationToastComponent`
Renders `NotificationService.toasts()` and `dots()` — already mounted globally in `app.ts`.

#### `CsvExportService` + `CsvExportModalComponent`
```typescript
csvExportService.show(csv: string, count: number, source: string)
// Modal provides download + clipboard copy
```

#### `EntryPreviewService` + `EntryPreviewModalComponent`
```typescript
entryPreviewService.prompt(entry, title, confirmLabel) → Promise<AnyEntry | null>
```
Used when repeating entries from history.

---

### Pipes (`shared/pipes/`)

| Pipe selector | Transform |
|---|---|
| `formatDateReadable` | `"2026-04-04"` → `"4th April 2026"` |
| `timeDisplay` | identity passthrough (placeholder) |

---

### Utilities (`shared/utils/`)

| File | Exported functions |
|---|---|
| `date.utils.ts` | `getTodayString()`, `formatDateLocal(Date)`, `formatDateReadable(str)`, `addDaysToDateString(str, n)`, `getEntryDate(entry)`, `buildDateRange(start, end)`, `escapeHtml(str)` |
| `base64.utils.ts` | `encodeBase64(str)`, `decodeBase64(b64)` — UTF-8 safe |
| `time.utils.ts` | `timeTo24(t)` (12h→24h), `time24To12(hhmm)` (24h→12h) |
| `uuid.utils.ts` | `generateUUID()` — `crypto.randomUUID()` with fallback |

---

## 11. Data Storage Patterns

### GitHub repository file layout
```
<private-repo>/
├── data/
│   ├── 2026-04-04.json     → AnyEntry[]
│   ├── 2026-04-03.json
│   ├── streak.json          → StreakData
│   └── settings.json        → AppConfig snapshot
└── workout-data/
    ├── workouts.json        → Workout[]
    ├── 2026-04-04.json      → Session (single workout session)
    ├── streak.json          → WorkoutStreakData
    ├── config.json          → WorkoutConfig
    └── templates.json       → SessionTemplate[]
```

All content is **base64-encoded** when PUT via the GitHub Contents API. Use `encodeBase64()` / `decodeBase64()` from `base64.utils.ts`.

### SHA conflict handling
1. Every PUT requires the file's current `sha`.
2. `state.fileIndex` (`Record<string,string>`) tracks `date → sha` for calorie files.
3. `workoutState.fileIndex` tracks workout file SHAs.
4. On `409 Conflict`: re-fetch the file to get the latest SHA, then retry once. This is already implemented in `GithubApiService` — do not duplicate.

### localStorage keys

| Key | Value |
|---|---|
| `gt_token` | GitHub Personal Access Token |
| `gt_repo` | `owner/repo` string |
| `gt_theme` | `'auto' \| 'dark' \| 'light'` |
| `streak_cache` | Serialized `StreakData` (restored on boot) |
| `lastUsedTracker` | `'calorie' \| 'workout'` |
| `config_<key>` | Per-field `AppConfig` override (JSON-serialized) |

---

## 12. Schema YAML

File: `calorie-tracker-ng/public/schema.yaml`

```yaml
schema:
  name: "calorie_tracker"
  displayName: "Calorie Tracker"
  totalField: "calories"
  displayFormat: "{date} at {time} - {food} - {calories} kcal"
  fields:
    - name: "timestamp"   type: "hidden"    autoCapture: true
    - name: "date"        type: "date"      required: true   default: "today"
    - name: "food"        type: "text"      required: true
    - name: "calories"    type: "number"    required: true   min: 0
    - name: "protein"     type: "number"    required: false  min: 0
    - name: "carbs"       type: "number"    required: false  min: 0
    - name: "fat"         type: "number"    required: false  min: 0
    - name: "time"        type: "time"      required: false
```

**Runtime injection by `SchemaService`:** if `healthScore` is absent from the YAML, it is injected automatically as `{ name: 'healthScore', type: 'number', min: 1, max: 10 }`.

**Adding a new field:** edit this YAML and reload — `EntryFormComponent` and `TrackerService.getFormData()` will pick it up automatically. No code changes needed for standard fields.

---

## 13. Build & Dev Workflow

```bash
# Dev server (from workspace root)
./start.sh                  # binds 0.0.0.0:4200 — accessible on LAN
# or
cd calorie-tracker-ng && npx ng serve

# Production build (from workspace root)
./build.sh
# Output: calorie-tracker-ng/dist/calorie-tracker-ng/browser/

# Tests
cd calorie-tracker-ng && npm test    # Vitest

# Environment variables for local GitHub API scripts
export GITHUB_TOKEN="ghp_..."
export GITHUB_REPO_PATH="owner/repo"

# Decode today's data file
DATE=$(date +%F)
curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
  "https://api.github.com/repos/${GITHUB_REPO_PATH}/contents/data/${DATE}.json" \
  | python3 -c "import sys,json,base64; j=json.load(sys.stdin); print(base64.b64decode(j.get('content','')).decode('utf-8'))"
```

**Hash routing note:** all routes use `/#/route`. Links must account for this — never use relative paths that bypass the hash.

**GitHub Pages note:** all asset paths must be relative (no leading `/`). The base href is set in `angular.json`.

---

## 14. Checklist for Adding a New Feature

Follow these steps in order. Each step references the exact file to modify.

### A) New page / route

1. Create `src/app/features/<name>/<name>.component.ts` — standalone, uses `inject()`, signals for state.
2. Create `src/app/features/<name>/<name>.routes.ts` — exports `<NAME>_ROUTES`.
3. Add lazy route entry in `src/app/app.routes.ts`:
   ```typescript
   { path: 'my-feature', loadChildren: () => import('./features/my-feature/my-feature.routes').then(m => m.MY_FEATURE_ROUTES) }
   ```
4. If it belongs in the **Calorie Hub** dashboard, add a tile in `CalorieHubComponent`.
5. If it belongs in the **Workout Hub**, add a tile in `WorkoutHubComponent`.
6. If it needs bottom-nav access, add to the nav in `app.html`.

### B) New service

1. Create `src/app/core/services/<name>.service.ts`:
   ```typescript
   @Injectable({ providedIn: 'root' })
   export class MyService {
     private state = inject(StateService);
     myData = signal<MyType[]>([]);
     derived = computed(() => this.myData().filter(...));
   }
   ```
2. Inject in consumer with `inject(MyService)`.

### C) New schema field (calorie entries)

1. Add entry to `public/schema.yaml`.
2. Nothing else required — `EntryFormComponent` auto-generates the input, `TrackerService.getFormData()` auto-maps it.

### D) New GitHub-stored data file

1. Decide the file path (e.g. `data/my-file.json`).
2. Add load/save methods to `GithubApiService` (calorie domain) or `WorkoutGithubApiService` (workout domain).
3. Track SHA in `state.fileIndex` or `workoutState.fileIndex`.
4. Handle 404 (new file, `sha = undefined`) and 409 (conflict: re-fetch SHA + retry).

### E) New config option

1. Add field to `AppConfig` interface in `core/models/config.model.ts`.
2. Add default value to `DEFAULT_CONFIG` in the same file.
3. Access anywhere: `configService.getConfig('myKey')`.
4. Expose in `SettingsComponent` so users can change it.

### F) New model

1. Create `src/app/core/models/<name>.model.ts`.
2. Export interface + any const defaults.
3. Import directly in consuming services/components.

### G) New notification type

1. Add to `NotificationType` union in `NotificationService`.
2. Add color entry to `colorMap` in the same service.

### H) New shared utility

1. Add pure function to the appropriate file in `shared/utils/` (or create a new file if the domain is new).
2. Never add side effects to utils. Keep them pure.

### I) New Chart.js chart

1. Use `ViewChild` for the canvas ref.
2. Cache the chart instance in a local variable; call `chart.destroy()` before recreating.
3. Chart.js is already available globally (loaded from CDN in `index.html`).

---

## 15. Critical Safety Rules

> These encode lessons from past bugs — follow them without exception.

### Delete safety
- **Never** perform bulk deletes without showing the user exactly what will be deleted (date labels + entry previews).
- Use `ConfirmService.show()` — never `window.confirm()`.
- **Remote writes first:** update/delete GitHub files before mutating `state.entries`.
- **Scope writes:** only touch affected dates — never reconcile the entire `data/` folder unless explicitly intended.
- Add detailed `dbg()` logging around all delete and write operations; never swallow errors silently.
- For any large bulk-changing operation: create a backup branch in the target repo first (e.g. `backup-before-<action>-<timestamp>`).

### API safety
- Always call `authService.hasCredentials()` before making any GitHub API call.
- Always handle the case where a per-day file does not exist (404 = normal for new dates).
- Never expose the GitHub PAT in logs, HTML, or error messages.

### State mutation safety
- Never mutate signal values directly. Always use `.set()` or `.update()`.
- Never mutate objects inside signals in-place — produce new objects/arrays.

---

## 16. Common Pitfalls

| Symptom | Root Cause | Fix |
|---|---|---|
| Schema fails to load ("Failed to fetch") | `index.html` opened as `file://` | Run `./start.sh` and use `http://localhost:4200` |
| 404 on GitHub fetch | Per-day file doesn't exist yet | Expected; the app creates it on first push |
| 409 on GitHub push | SHA mismatch (file changed between read and write) | Already handled with retry in `GithubApiService` — check that `state.fileIndex` is populated |
| Macro stats show 0 for some entries | Field name aliases not covered | Check `HistoryService.stats()` — it handles `protein`, `protein(g)`, `Protein`, etc. |
| Chart doesn't re-render | Stale Chart.js instance | Call `chart.destroy()` before `new Chart()` |
| `@let` not recognised in template | Angular version < 19 | Already on Angular 21 — ensure you're not importing from Angular < 17 |
| Routes not resolving | Missing `withHashLocation()` | Already in `app.config.ts` — don't remove it |
| Dark mode not applied | `gt_theme` key missing | `ThemeService.initTheme()` handles this on boot; call it if adding a new bootstrap step |

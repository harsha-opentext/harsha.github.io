# Calorie Tracker — Improvements & Feature Backlog

> Status key: 🔴 Bug/Broken · 🟡 UX Fix · 🟢 New Feature · ⭐ VIP (user-flagged critical) · 👤 You raised this

---

## Bugs & Broken Behaviour

1. 🔴 👤 **Weight entries have no per-entry timestamp in the workout context** — `WorkoutSet` objects (sets logged in the workout session log) have no timestamp field. On the calorie side, the `_meta: 'dailyWeight'` entry does record a `timestamp` on create, but editing an existing weight entry resets the timestamp to the edit time rather than preserving the original entry time. Separate the `recordedAt` (original entry time) from `updatedAt` (last edit time), and display the original timestamp in history.

2. 🔴 **Analytics page is single-date only with no trend view** — The analytics page shows per-day breakdowns (meal distribution, macros, nutrition quality) but only for one selected date at a time. There are no range-based trend charts. This is a design gap — the tracker collects multi-day data but the only way to see trends is via the calorie hub or streak page. The analytics page needs at least a weekly/monthly calorie trend line chart.

3. 🔴 **Nutrition quality score (healthScore) is not visible on the tracker page** — The `healthScore` field exists, can be entered, and is analysed on the analytics page, but there is no in-line display of health scores on the main tracker page or on entry cards. A user adding entries gets no immediate quality feedback.

---

## UX & Quality-of-Life Fixes

4. 🟡 **No autocomplete or recent foods on the food entry field** — The `food` field is a plain text input with zero suggestions. Given that most users log the same foods repeatedly, the absence of a recent-foods list or quick-repeat mechanism creates unnecessary friction. A datalist / dropdown showing the 10 most recently logged unique food names would significantly speed up entry.

5. 🟡 **No quick-repeat for recent entries** — From the tracker page there is no "Add same as yesterday" or "Add last entry again" shortcut. The user must navigate to history, find the entry, and use "Add to today" for each item individually. A "Recent" panel on the tracker page with one-tap re-add would address this.

6. 🟡 **Daily budget bar shows total calories only — no meal or macro breakdown** — The `BudgetBarComponent` is a single progress bar for total calories vs daily budget. There is no breakdown of remaining protein/carbs/fat vs. any macro goals. A user tracking macros has to add up numbers manually from the entry cards.

7. 🟡 **Calorie deficit/surplus is not surfaced anywhere** — The app tracks `dailyBudget` and sums today's calories, but never explicitly shows "deficit: 350 kcal" or "surplus: +200 kcal". This is the single most important number for a calorie tracker user.

8. 🟡 **Streak does not auto-update when an entry is added** — The streak is only recomputed when the user explicitly presses "Compute Streak" in Settings. If a user adds an entry and checks the streak page, the streak is stale. Streak should recompute (or at least invalidate its cache) automatically when a new entry is saved on a new day.

9. 🟡 **Settings changes have no visible save confirmation** — Like the workout settings issue, calorie config saves are debounced and silent. No spinner, no "saved ✓" badge, no error feedback if the GitHub write fails.

10. 🟡 **History bulk delete is the only bulk action — no bulk edit** — Users can multi-select entries for deletion but cannot bulk-edit a field (e.g. correct a calories value across multiple entries). At minimum, bulk-edit of the `date` field would let users fix entries logged on the wrong date.

11. 🟡 **Analytics date navigation is manual — no "next/previous day" arrows** — On the analytics page the user must type or pick a date. Simple previous/next day navigation buttons would make it much faster to browse day-by-day.

12. 🟡 **No meal category tagging (breakfast / lunch / dinner / snack)** — The `time` field is a free-text time value. There is no concept of a meal category. Users who think in terms of meals rather than times cannot filter or aggregate by meal type. An optional `meal` field (select: breakfast/lunch/dinner/snack/other) would make history and analytics significantly more useful.

---

## New Features

13. 🟢 **Weekly and monthly trend charts on the analytics page** — Add a date-range mode to analytics with line charts showing: daily calorie intake vs budget, daily macro totals, and rolling 7-day average. Reuse the existing Chart.js integration. Correlate with body weight data if present.

14. 🟢 **Macro goal tracking** — Alongside the calorie `dailyBudget`, allow users to set daily protein/carbs/fat targets in Settings. These goals appear as targets on the budget bar and analytics charts, and a macro target completion indicator appears on the tracker page.

15. 🟢 **Body weight trend chart directly on the tracker or hub page** — The weight graph modal exists in history but is buried. Surface a mini body weight sparkline on the Calorie Hub dashboard or the tracker weight tab so the trend is immediately visible.

16. 🟢 **Monthly summary / calendar heatmap** — A calendar view (similar to GitHub's contribution graph) where each day is colour-coded by calorie intake relative to budget (e.g. green = within budget, red = over, grey = no data). Viewable by month with navigation. Could live on the streaks page or analytics.

17. 🟢 **Calorie burn integration from workout tracker** — When a workout session is logged on the same day, factor in an estimated calorie burn (user-configurable estimate per session, or manually entered) to show a "net calories" figure on the tracker page. This bridges the two tracker domains meaningfully.

18. 🟢 **Favorite / pinned foods** — Allow users to pin frequently logged foods. Pinned foods appear at the top of the recent foods list (see item 4) and can be re-added with one tap, pre-filling all fields including calories and macros.

19. 🟢 **Clone yesterday's full meal log** — A single "Repeat yesterday" button on the tracker page that copies all food entries from the previous day to today, with a preview confirmation that lets the user remove or modify items before committing. Significantly reduces friction for users with consistent eating patterns.

20. 🟢 **Daily intake reminder notification (PWA)** — Using the Web Notifications API, allow the user to set a reminder time (e.g. 8:00 PM) to log any unlogged meals. The reminder is only sent if no entries have been logged for today at the time it fires.

21. 🟢 **Configurable entry form field order and visibility** — Let users reorder or hide schema fields via Settings without editing the YAML file. Store field order and visibility overrides in localStorage / the settings repo file. The form renders according to the user's preferred layout.

22. 🟢 **Micronutrient / vitamin tracking** — Optional extra fields (fibre, sugar, sodium, vitamins) that advanced users can add to entries. These would be additional schema fields (added via YAML) but the Settings UI could offer a toggle to "enable advanced nutrition fields" that injects them automatically.

23. 🟢 **CSV import for food entries** — A bulk import flow similar to the workout CSV importer. Lets users paste a CSV from a spreadsheet or third-party app and map columns to entry fields. The import preview/confirm pattern already exists in the workout side — the same modal can be adapted.

24. 🟢 **Per-entry notes field** — A free-text `notes` field on each food entry (e.g. "post-workout meal", "restaurant estimate"). Not included in analytics but visible in history for context.

25. 🟢 **Water intake tracker** — A simple daily water log (number of glasses or ml) separate from food entries. Shows a small progress indicator on the tracker page or hub. Stored as a lightweight metadata entry in the per-day file.

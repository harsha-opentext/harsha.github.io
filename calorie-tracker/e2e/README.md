# Playwright E2E for Calorie Tracker

This folder contains Playwright end-to-end tests for the Calorie Tracker app.

Quick start:

1. Install dependencies:

```bash
cd calorie-tracker/e2e
npm install
npx playwright install
```

2. Run tests (default headless):

```bash
TEST_PORT=8000 npm test
```

3. Run headed for debugging:

```bash
TEST_PORT=8000 npm run test:headed
```

Notes:
- `TEST_PORT` defaults to `8000` if not set. The test runner expects the static server to serve the `calorie-tracker` folder at `http://localhost:<TEST_PORT>/calorie-tracker`.
- Tests are intentionally lightweight smoke tests to validate UI flows; adjust selectors in `tests/smoke.spec.ts` if your app uses custom modal selectors.

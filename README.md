# Charcoal Peak Taskflow

Taskflow is a task manager with offline-aware task mutations, recurring reminders, recently deleted recovery, customizable navigation/priorities, and a local first-party backend that no longer depends on Base44 infrastructure.

## Requirements

- Node.js `22.14.0`
- npm `10.9.2`

This repo includes:

- `.nvmrc` and `.node-version` for version pinning
- `.editorconfig` for consistent formatting defaults across editors
- `.env.example` as the starter environment template
- `./scripts/bootstrap-node.sh` to download a local Node runtime into `tools/` when a system install is unavailable
- `./scripts/npmw` as a local npm wrapper that works with either system Node or the local runtime

## Quick Start

For the easiest local experience:

```bash
./scripts/dev.sh
```

That starts Vite with the local backend embedded into the dev server and opens the app in your browser.

If Node is already installed and you only want the frontend:

```bash
npm ci
npm run dev
```

To start only the backend:

```bash
./scripts/npmw run backend:start
```

If Node is not installed on the machine:

```bash
./scripts/bootstrap-node.sh
./scripts/setup.sh
./scripts/dev.sh
```

## Verification

Run the full verification suite with either:

```bash
npm run verify
```

or the wrapper script:

```bash
./scripts/verify.sh
```

For the full local check including Playwright:

```bash
./scripts/verify.sh --e2e
```

The verification suite runs:

- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
- `npm run build`

`npm run test:run` now includes backend contract tests as well as the existing frontend/unit tests.

To run the automated tests directly:

```bash
npm run test:run
```

## End-to-End Tests

Playwright coverage is available for browser-level task flows like recurring deletion, undo recovery, recurring completion, and offline replay.

Install the browser runtime once:

```bash
npm run playwright:install
```

Then run the suite:

```bash
npm run test:e2e
```

For the full local check including E2E:

```bash
npm run verify:all
```

## Environment

Copy `.env.example` to `.env.local` and `.env.backend.example` to `.env.backend.local` if you want to customize backend behavior.

Frontend:

```bash
VITE_APP_ID=your_app_id
VITE_API_BASE_URL=http://127.0.0.1:8787
```

Backend:

```bash
TASKFLOW_BACKEND_PORT=8787
TASKFLOW_APP_ID=your_app_id
TASKFLOW_ALLOW_ANY_PASSWORD=true
```

Optional Google auth:

```bash
TASKFLOW_GOOGLE_CLIENT_ID=your_google_client_id
TASKFLOW_GOOGLE_CLIENT_SECRET=your_google_client_secret
TASKFLOW_GOOGLE_REDIRECT_URL=http://127.0.0.1:8787/api/apps/auth/google/callback
```

## CI

GitHub Actions now runs `.github/workflows/verify.yml` on pushes and pull requests. It runs the standard verification pipeline plus a Playwright Chromium job for browser-level coverage.

## Backend Contract

The frontend expects a backend that exposes:

- `GET /api/apps/public/prod/public-settings/by-id/:appId`
- CRUD endpoints under `/api/apps/:appId/entities/:entityName`
- auth/session endpoints under `/api/apps/auth/*`

The shipped client is generic fetch-based, so you can point the app at any backend that honors that contract without depending on a vendor SDK or build plugin.

## Local Backend

The repo now includes a Node + SQLite backend under [/Users/isaacshmidman/Documents/New project/backend](/Users/isaacshmidman/Documents/New%20project/backend) with:

- cookie and bearer-token session auth
- permissive email/password login for local use
- Google OAuth support when credentials are configured
- app-scoped CRUD for `Task`, `DeletedTask`, `Priority`, and `SavedTag`
- system-managed deleted-task retention via `expires_at`
- CSV import tooling for migrating Base44 exports

Useful commands:

```bash
./scripts/dev.sh
./scripts/npmw run backend:start
./scripts/npmw run backend:dev
./scripts/npmw run backend:import -- --tasks "/path/to/Task Export.csv" --deleted-tasks "/path/to/DeletedTask Export.csv" --priorities "/path/to/Priority Export.csv" --saved-tags "/path/to/Saved Tags Export.csv" --replace
```

Imported SQLite data lives in `backend/data/` and is ignored by git so your local data stays local.

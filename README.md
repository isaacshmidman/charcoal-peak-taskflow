# Zephyrly

Zephyrly (internal repo name: `charcoal-peak-taskflow`) is a calm task manager with offline-aware task mutations, recurring reminders, recently deleted recovery, customizable navigation/priorities, and a local first-party backend that no longer depends on Base44 infrastructure.

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
# DEV ONLY — accepts any password, auto-creates users on login.
# Leave unset or set to false in production.
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

## Calendar Integrations

Zephyrly can sync Google Calendar and iCloud Calendar with your task list. Provider events become Zephyrly tasks, and Zephyrly task edits push back to writable provider calendars.

### One-time setup

1. **Generate the encryption key** that protects OAuth tokens at rest:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Paste the output as `INTEGRATIONS_ENCRYPTION_KEY` in `.env.backend.local` (and in Render / your prod secret store). **Never commit this value. Rotating it invalidates every existing connection — users must reconnect.**

2. **Create an OAuth 2.0 client for Google Calendar** in the Google Cloud Console:
   - Enable the "Google Calendar API" on the project
   - On the OAuth consent screen, add `.../auth/calendar.events`, `.../auth/calendar.calendars.readonly`, `.../auth/calendar.calendarlist.readonly`, `openid`, `email`, and `profile` (calendar scopes are marked "sensitive" — fine for testing, requires Google verification for public release)
   - Add yourself as a test user while unverified
   - Add the redirect URI: `http://127.0.0.1:8787/api/apps/taskflow-local/integrations/google/callback` (dev) and the equivalent production URL
   - Paste the client id / secret into `TASKFLOW_GOOGLE_CALENDAR_CLIENT_ID` / `TASKFLOW_GOOGLE_CALENDAR_CLIENT_SECRET` (or reuse your login credentials — same vars with `TASKFLOW_GOOGLE_` prefix also work)

3. **For Apple Calendar**, create an app-specific password at appleid.apple.com. Users enter their Apple ID and that app-specific password in Settings; the backend encrypts it with `INTEGRATIONS_ENCRYPTION_KEY`.

4. Restart the backend. The Settings page's "Calendar Integrations" panel now shows Google and iCloud connect buttons.

### How sync works

- Polling every 1 min by default (configurable via `TASKFLOW_SYNC_INTERVAL_MS`).
- Uses Google incremental `syncToken` and Apple CalDAV `sync-token` so each tick only fetches changes since the last run.
- Tokens encrypted with AES-256-GCM using the master key above, with the row's id as AAD (so blobs can't be swapped between rows).
- Disabling a provider calendar removes imported read-only event clutter from Zephyrly, pauses inbound/outbound writes for that calendar, clears its cursor, and preserves non-event mappings so re-enabling does not create duplicate provider events.
- Disconnecting revokes the Google token when possible, removes imported calendar events from Zephyrly, and keeps Zephyrly-native tasks.

### Security posture

- Tokens never appear in logs or error messages (responses are redacted before inclusion).
- OAuth state is bound to the user who started the flow; an attacker who steals a callback URL can't use it from another session.
- Integration routes require an active session; missing integrations return 404 (never 403) to avoid existence leaks.
- Encryption key is loaded once at boot; if missing, integration routes return 503 rather than silently falling back to plaintext storage.

## Offline Mode

Zephyrly is designed to stay useful when the network drops. Everything the user touches regularly keeps working offline; only things that require a round-trip to a remote server are disabled.

**Works offline:**

- Creating, editing, completing, and deleting tasks and subtasks
- Reordering subtasks and skipping/completing recurring tasks
- Soft-deleting into Recently Deleted and restoring from it
- Priority CRUD (create/rename/reorder/delete) from the Settings page
- SavedTag CRUD from the Settings page
- Reading any previously-fetched data — task lists, priorities, tags, recently-deleted history
- Navigating between pages — the service worker serves the cached `index.html` shell

**How it works (one-line version):** every mutation goes through `useOfflineMutation` (tasks), `useDeletedTasks` (deleted tasks), or the Settings queues (priorities/tags). Each hook applies the change optimistically to the React Query cache, persists the cache to `localStorage`, and — if the network call fails or the browser is offline — pushes a replay record onto a per-entity queue. `useOfflineData` mounts once at the app root and drains those queues when any of the following fire: the `online` event, the `focus` event, `visibilitychange → visible`, or the initial mount if `navigator.onLine` is already true. ID remapping handles optimistic `offline_*` IDs so parent/subtask references resolve correctly after replay.

**Does NOT work offline (by design):**

- **Sign-in / Google OAuth** — requires a live round-trip. If the session cookie is still valid the app loads straight into the cached shell; if it expires while offline, you'll see the login screen until you reconnect.
- **Conflict resolution across devices** — last write wins. Editing the same task on two offline devices will collapse to whichever mutation replays last.
- **Fetching data the app has never seen** — the offline cache only contains data you loaded at least once while online.

If you find a user-facing action that isn't in either list, it probably isn't wired through the offline queue yet — please file an issue.

## Production Deployment (Self-Hosted)

Zephyrly is designed to run as a single Docker container serving both the built frontend and the API on the same origin. The included `Dockerfile` and `docker-compose.yml` target a ZimaOS NAS with Cloudflare Tunnel for secure public access.

### Prerequisites

- A machine running Docker (ZimaOS, any Linux, etc.)
- A domain (e.g. zephyrly.app) with DNS managed by Cloudflare
- A Cloudflare Tunnel token (free, from Zero Trust dashboard)
- Google OAuth credentials (from Google Cloud Console)

### Setup

1. Clone the repo on your server:

```bash
git clone https://github.com/isaacshmidman/charcoal-peak-taskflow.git
cd charcoal-peak-taskflow
```

2. Copy the environment template and fill in your secrets:

```bash
cp .env.production.example .env
```

3. Start everything:

```bash
docker compose up -d --build
```

This starts two containers:
- **taskflow** — your app (Node.js + SQLite)
- **cloudflared** — Cloudflare Tunnel (routes zephyrly.app to the app)

### Data Persistence

SQLite data is stored on the host at `/DATA/AppData/taskflow/data/` (ZimaOS convention) and mounted into the container. Data survives container rebuilds and restarts.

### Updating

After pushing code changes to GitHub:

```bash
git pull
docker compose up -d --build
```

### Importing Base44 Data

To import CSV exports from Base44 into the production database:

```bash
docker compose exec taskflow node backend/import-base44-exports.js \
  --tasks "/app/backend/data/Task Export.csv" \
  --deleted-tasks "/app/backend/data/DeletedTask Export.csv" \
  --priorities "/app/backend/data/Priority Export.csv" \
  --saved-tags "/app/backend/data/Saved Tags Export.csv" \
  --replace
```

Copy CSV files into `/DATA/AppData/taskflow/data/` on the host first so the container can see them.

# Charcoal Peak Taskflow

Taskflow is a Base44-backed task manager with offline-aware task mutations, recurring reminders, recently deleted recovery, and customizable navigation/priorities.

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

If Node is already installed:

```bash
npm ci
npm run dev
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

Copy `.env.example` to `.env.local` and fill in:

```bash
VITE_BASE44_APP_ID=your_app_id
VITE_BASE44_APP_BASE_URL=your_backend_url
```

Example:

```bash
VITE_BASE44_APP_ID=cbef744a8545c389ef439ea6
VITE_BASE44_APP_BASE_URL=https://my-to-do-list-81bfaad7.base44.app
```

## CI

GitHub Actions now runs `.github/workflows/verify.yml` on pushes and pull requests. It runs the standard verification pipeline plus a Playwright Chromium job for browser-level coverage.

## Base44

Changes pushed to the repo are reflected in the Base44 Builder. Publish changes from Base44 when you are ready.

Docs: [Base44 GitHub integration docs](https://docs.base44.com/Integrations/Using-GitHub)

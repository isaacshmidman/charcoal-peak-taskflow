# What is left

Written 2026-11-17, after the November list was finished (page code on
first use, error reports, calendar reconnect, server timings, backups and
the restore rehearsal, the offline copy in IndexedDB). Nothing here is
built. Each item says what it is for, exactly what would change, and how
to tell it is done. Delete an item when it ships.

## 1. Only Isaac can do these

| What | How | Why it matters |
|---|---|---|
| Deploy | `cd /media/Isaac_Zima_Storage/taskflow && sudo git pull origin codex/taskflow-hardening && sudo HOME=/media/Isaac_Zima_Storage docker compose build --no-cache taskflow && sudo HOME=/media/Isaac_Zima_Storage docker compose up -d taskflow` | Nothing below is live until then. |
| See the first backup | Two minutes after the deploy: `sudo HOME=/media/Isaac_Zima_Storage docker compose logs taskflow \| grep backup` should show `[backup] made …`. Then `… docker compose exec taskflow node backend/scripts/backup.js rehearse`. | The backup code has only ever run on test data and a scratch server, never on the real box or its drive. |
| Look at `manifest.json` in that backup | `files.linked` against `files.copied` | If the drive can't hard-link, every backup holds its own copy of every attachment: 14 backups, 14 times the space. Then set `TASKFLOW_BACKUP_KEEP` lower in `.env`. |
| Keep `.env` somewhere else | A password manager | A restored server without the same `.env` has everyone's tasks but every calendar must be connected again. |
| Four checks on a real calendar | In `docs/calendar-sync.md`, "Checking it for real" | Google and iCloud are stood in for by fakes in every test. The fourth check (Reconnect sends what was kept) is new. |
| Google Cloud → OAuth consent screen → Publishing status | Must not say "Testing" | In Testing, Google ends every sign-in after 7 days, which is what makes a calendar ask to be reconnected weekly. |
| Confirm the data folder move | `scripts/move-data-dir-to-env.sh` reports what it did | Until then, never discard changes to `docker-compose.yml` on the box. |
| Move the repo out of iCloud-synced Documents, or free disk space | Finder | iCloud offloading made source files read back empty in earlier sessions, and its indexing slowed the Mac enough to time out two browser tests this round. |

## 2. Backups that survive the drive

**For:** the daily backups sit on the same drive as the data. They undo a
mistake or a bad update; they do not survive that drive dying.

**Change:**
- `backend/backup.js`: `copyBackupTo(folder, secondRoot)` copies a finished
  backup (real copies, never links: the second place is another disk) as
  `<name>.partial`, renames it when whole, then runs `checkBackup` on the
  copy. `startBackupLoop` calls it after each backup and keeps
  `TASKFLOW_BACKUP_COPY_KEEP` (default 14) there with `removeOldBackups`.
- `backend/config.js`: `backupCopyDir` from `TASKFLOW_BACKUP_COPY_DIR`.
- `docker-compose.yml`: a second volume,
  `${TASKFLOW_BACKUP_COPY_HOST_DIR}:/app/backups-copy`, and
  `TASKFLOW_BACKUP_COPY_DIR=/app/backups-copy` only when it is set. Docker
  refuses an empty mount, so this needs a compose override file or a
  profile rather than a default; decide which when building it.
- Log: `[backup] copied 2026-… to the second drive` or `[backup] second copy FAILED: …`.
- `docs/backups.md`: the drive is no longer listed under what a backup
  doesn't cover.

**Done when:** a test makes a backup with a second folder set and finds a
whole, checked copy there; a second folder that is missing or full fails
loudly in the log without stopping the first backup.

**Needs from Isaac:** which drive or machine. A USB disk on the box is
free; anything in the cloud costs money and is his call.

## 3. Backups and speed, visible in the app

**For:** both now exist only as log lines. A backup that stopped being
made three weeks ago should be seen without opening a terminal.

**Change:**
- `backend/routes/server-status.js`: `GET /api/apps/:appId/server-status`,
  admins only (`user.role === "admin"`, from the session), answering
  `{ backup: { newest, count, age_hours, sound }, timings: { requests, half_ms, p95_ms, slow, failed, since } }`.
  `sound` is the result of the last `checkBackup`, kept in memory by the
  backup loop. `timings` is `createTimings().summary()` given as numbers
  (add a `numbers()` beside `summary()` in `backend/lib/timings.js`).
- `src/components/settings/ServerSection.jsx`, shown in Settings only to
  an admin: "Last backup: today, 03:12 · 14 kept" and "Last hour: 1,204
  requests, 95% under 28 ms". Red (the only place red is allowed: trouble)
  when the newest backup is over 48 hours old or the last check failed.
- No button that makes or restores a backup: a restore stays a deliberate
  act at the terminal.

**Done when:** a server test covers the route (admin sees it, anyone else
gets 403, signed out 401) and a browser test shows the row for an admin
and not for another person.

## 4. A rehearsal every week, by itself

**For:** `rehearse` proves a backup can be put back, but only when someone
remembers to run it.

**Change:** in `startBackupLoop`, once the newest backup is made and the
last rehearsal is over 7 days old, run `rehearseRestore` on it and log
`[backup] rehearsal passed: …` or `[backup] REHEARSAL FAILED: …` with the
reasons. Remember when in `<backups>/last-rehearsal.json`. It starts a
second server on a copy for a few seconds, so run it only between 02:00
and 05:00 server time.

**Done when:** a test with a fake clock sees one rehearsal in eight days,
not eight; item 3's row shows its result.

## 5. Tests that run here the way CI runs them

**For:** this round CI failed twice on things that passed here. Both
causes were differences between this Mac and CI: a settings file CI
doesn't have (`.env.local`, `.env.e2e` name an app id; both are
git-ignored), and speed (CI's browser is several times slower, so a key
pressed the instant a dialog appeared was lost).

**Change:**
- `scripts/verify-as-ci.sh`: `VITE_APP_ID= npx vitest run`, then
  `CI=1 VITE_APP_ID= npx playwright test --project=chromium --workers=2`
  with `node_modules/.vite` moved aside for the run and put back after.
  Add it to the pre-push gates in the README.
- `.github/workflows/*.yml`, e2e job: after "Run Playwright", an
  `actions/upload-artifact@v4` step with `if: failure()` and
  `path: test-results/`, so a CI failure comes with its screenshot and
  video. This round the cause had to be guessed and then reproduced.
- `e2e/utils/dialogs.ts`: move `closeDialogWithEscape` (now in
  `e2e/navigation.spec.ts`) and `dismissByClickingOutside` (in
  `e2e/task-flows.spec.ts`) there, and use the first at the 18 other
  places a test presses Escape straight after a dialog or popover appears
  (`home.spec.ts`, `task-flows.spec.ts`, `notes.spec.ts`). They pass in
  CI today; they have the same race.

**Done when:** the script passes here, and breaking either thing on
purpose (remove the app id line from the test, press Escape once) makes
it fail here before CI sees it.

## 6. The offline copy: kept by the browser, and checked on a phone

**For:** two things about the IndexedDB move were not proven.

- **Only Chromium was run.** The unit tests use a stand-in IndexedDB and
  the browser tests and the real-server run use Chromium. Safari on an
  iPhone and Firefox were not. The fallback (lists stay in localStorage
  when IndexedDB doesn't answer in 1.5 seconds) is tested, but what
  Safari actually does is not. **To check:** on the phone, open the app,
  turn on aeroplane mode, close and reopen it from the home screen: the
  tasks should be there. Then add a task, turn aeroplane mode off: it
  should reach the server once.
- **A browser may clear a site's storage** when the disk is short, and
  Safari clears a site not opened for 7 days unless it was added to the
  home screen. This was equally true of localStorage. **Change:** in
  `src/lib/offlineCache.js`, the first time a change is queued offline,
  call `navigator.storage.persist()` if it exists and the answer isn't
  already yes (`navigator.storage.persisted()`). Chrome answers without
  asking; Firefox shows a prompt, which is why it should happen at the
  moment someone is relying on offline, not at startup. No UI of our own.
  **Done when:** a unit test sees it asked once, and never before a
  change is queued.

## 7. If `[slow]` lines show the task list

**For:** every page asks for every task. `keptAnswer` and ETags make the
repeat cheap, but the first ask after any change still builds the whole
list in the one thread that answers everyone. The new `[slow]` and
`[timings]` lines will show whether this matters on the box. Build this
only if they do.

**Change (only then):**
- `backend/routes/entities.js`: `GET …/entities/Task?since=<updated_date>`
  answers only tasks changed after that moment, plus
  `{ deleted: [ids] }` for tasks removed since (from `deleted_tasks` and a
  small `removed_ids` table for hard deletes, kept 30 days).
- `src/api/apiClient.js`: `Task.list` keeps the newest `updated_date` it
  has seen, asks with `since`, and merges into the list it holds; a full
  ask once a day and whenever the server says the `since` is too old.
- The offline copy and the query cache are unchanged: they still hold the
  whole list.

**Done when:** ticking a task with 5,000 on the server sends and receives
one task, measured on the real-server check, and a test proves a task
deleted on another device disappears here.

## 8. Decisions that are Isaac's, not work to start

- **Zephyrly Plus** ($9 once) is finished on the branch
  `claude/elegant-euclid-23b0a1` and not on the main branch. Shipping it
  needs Stripe set up on the server and his say-so.
- **Lowering `TASKFLOW_SLOW_REQUEST_MS`** from 500 once a week of
  `[timings]` lines shows what normal is on the box.

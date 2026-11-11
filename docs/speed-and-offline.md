# Speed, and working with no connection

How the app stays quick with thousands of tasks, and what it promises
offline. Each rule here was put in after measuring the problem it fixes
(November 2026); the numbers are from a laptop with 1,500 tasks and the
home server is several times slower, so they matter more there.

## Speed

**The task list is the heavy thing.** Every page asks for all of it when
it opens and again when the window is focused. For 4,000 tasks that was
5 MB of JSON, worked out from scratch each time (about 140 ms during
which the server answers nobody else) and sent uncompressed.

| Rule | Where | What it saves |
|---|---|---|
| A list is worked out once per state of the database | `keptAnswer` in `backend/routes/entities.js` | Repeat asks cost under 1 ms. "State" is exact: SQLite's `total_changes()` and `data_version`, so any write by anything invalidates it. Not used for the Recently Deleted lists, whose answer depends on the clock. |
| An unchanged answer isn't sent again | `sendJsonText` in `backend/http.js` (ETag, `304`), `unchanged` in `src/api/apiClient.js` | The app sends the fingerprint of what it has; the server answers "same" with no body. The app hands back the *same object*, so nothing re-renders and nothing is rewritten. |
| Everything over 1 KB goes out gzipped | `sendJsonText`, `serveStaticFile` in `backend/server.js` | The list shrinks about 25-fold on the leg between the house and Cloudflare. |
| Every page asks for tasks the same way | `Task.list("-created_date", 5000)` | One address, so one kept answer and one fingerprint. A page that wants another order sorts it itself. |
| A long list is drawn a part at a time | `src/hooks/useGrowingList.js` | 60 rows, more as the end nears the screen. Opening a page and ticking a task no longer cost in proportion to the whole list. Sorting, searching and counts still see everything. |
| The offline copy is written only when the list changed | `saveSnapshot` in `src/lib/offlineCache.js` | It was rewritten, megabytes at a time, six times per page opened and three per task ticked. |

If you add a list page: use `useGrowingList`, and ask for tasks with the
shared call above.

## Offline

What is promised: after one visit, the app opens and works with no
connection; changes made offline are queued on the device and sent when
the connection returns, once each.

- **The whole build is kept after one visit.** The build writes
  `asset-list.json`; the service worker (`public/sw.js`) fetches every
  file on it at install and on each page load. Before, files were kept
  only as the page happened to ask for them, so the first visit and the
  task form's editor (loaded on first use) were not.
- **Kept files are looked up by address only** (`ignoreVary`). The server
  marks answers `Vary: Origin, Accept-Encoding`; a plain cache lookup
  honours that and misses, so cached fonts and scripts failed offline.
- **A create is never made twice.** Every create carries its temporary
  id as `Idempotency-Key`; the server remembers which record it made
  (`created_once`, 30 days) and answers a repeat with that record.
- **The queue is never overwritten.** A replay takes out only what it
  settled, so a change queued while it ran survives. A create edited
  while in flight is followed by an update.
- **A change the server will never accept is dropped and reported**
  (400/413/422: a notice; 404 on an edit or delete: silently, the record
  is gone). Everything else stays queued.
- **One tab replays at a time** (`navigator.locks`).
- **A full device says so.** A queued change that can't be stored makes
  room by dropping the Recently Deleted copies, and if that isn't enough
  the person is told. A list whose copy can't be updated keeps its older
  copy and the person is told once.

Known limits: the lists live in `localStorage` (about 5 MB per site), so
beyond roughly 5,000 to 10,000 tasks the offline copy stops updating
(with a notice). Moving them to IndexedDB removes the limit but makes
start-up asynchronous. Deleting an offline-made record during the instant
its create is in flight can bring it back on the next refresh.

## Checking it for real

The e2e suite runs against a mock backend, so none of the server rules
above, nor the service worker, are exercised there.

1. Build to a scratch folder (`npx vite build --outDir <scratch>/dist-real`).
2. Start `createRequestHandler` on a scratch database with that folder as
   `distRoot`; make a user and session with `findOrCreateUserByEmail` and
   `createSession`, and put the access token in `localStorage`
   (`taskflow_access_token`). Never the real database, never a password.
3. For the service worker, open the app as `http://anything.localhost:<port>`:
   a secure context, and not one of the two names `sw.js` treats as
   development (where it caches nothing).

// @ts-check
/**
 * Task → Google Calendar push (outbound half of two-way sync).
 *
 * Design:
 *   - Every time a Task is created / updated / deleted via the backend's
 *     entity CRUD, we enqueue a push job.
 *   - Jobs drain asynchronously via setImmediate so the HTTP response
 *     returns immediately; failures log + mark the integration's last_error
 *     without blocking the user.
 *   - Loop prevention: when the inbound sync (sync.js) applies a change from
 *     Google to the local DB, it calls `suppressPush(taskId)` to mark the
 *     next mutation on that task as "originating from the provider, don't
 *     echo back". Suppression auto-expires after SUPPRESS_MS.
 *
 * Mapping rules:
 *   - Task must have a due_date to live on a calendar. Tasks without a
 *     due_date either delete any existing mapping or skip entirely.
 *   - due_date only              → all-day event (start.date, end.date+1)
 *   - due_date + task_time       → timed event (start.dateTime, end = start+1h)
 *   - due_date + task_time + end → timed event (start.dateTime, end.dateTime)
 *
 * Safety:
 *   - We only push to integrations the task's owner has connected.
 *   - We push to ALL of that user's active Google integrations (for now
 *     that's always at most one; architecture allows multiple accounts).
 *   - Errors are caught per-integration; one failing integration cannot
 *     break another, and never breaks the originating Task mutation.
 */
import { randomUUID } from "node:crypto";
import { getFreshAccessToken, getAppleCredentials } from "./integrations.js";
import {
  createEvent as createGoogleEvent,
  updateEvent as updateGoogleEvent,
  deleteEvent as deleteGoogleEvent,
} from "./providers/google-calendar.js";
import {
  buildVEvent,
  putEvent as putAppleEvent,
  deleteEvent as deleteAppleEvent,
  eventHrefForUid,
  newEventUid,
} from "./providers/apple-calendar.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

const SUPPRESS_MS = 30 * 1000;

// Coalesce + rate-limit outbound writes per task. Google Calendar's per-user
// quota is ~600 reads/min and far stricter on writes; bulk operations from
// the user (e.g. mass-completing tasks) used to fire one PATCH each, which
// blew through the quota and produced the 403 the user hit.
//
// Strategy: queue per-task with a small debounce (so rapid edits collapse
// into a single push), then drain at most MAX_PUSH_PER_SEC across all
// integrations. Deletes still fire immediately because they aren't
// coalesce-able with subsequent upserts.
const PUSH_DEBOUNCE_MS = 350;
const MAX_PUSH_PER_SEC = 4; // generous — Google allows much more, but this
                            // keeps us safely under per-minute quota even
                            // during a 20-task bulk update.

/** @type {Map<string, number>} taskId → expiresAt epoch ms */
const suppressUntil = new Map();

/** @type {Map<string, NodeJS.Timeout>} taskId → pending debounce timer */
const debounceTimers = new Map();

/** @type {Array<() => Promise<void>>} */
const pushQueue = [];
let queueRunning = false;
let lastPushAt = 0;

/**
 * Called by the inbound sync after it applies a Google event to a task. The
 * subsequent `updateEntityRecord` triggers our push hook — we skip that push
 * so we don't echo the change back to Google.
 */
export function suppressPush(taskId, ttlMs = SUPPRESS_MS) {
  if (!taskId) return;
  suppressUntil.set(taskId, Date.now() + ttlMs);
  // Opportunistic cleanup of expired entries so the map doesn't grow.
  if (suppressUntil.size > 256) {
    const now = Date.now();
    for (const [k, v] of suppressUntil) if (v <= now) suppressUntil.delete(k);
  }
}

function isSuppressed(taskId) {
  const exp = suppressUntil.get(taskId);
  if (!exp) return false;
  if (exp <= Date.now()) {
    suppressUntil.delete(taskId);
    return false;
  }
  return true;
}

/**
 * Public entrypoint. Hooked into server.js after Task CRUD.
 *
 * @param {DB} db
 * @param {import("./config.js").backendConfig} config
 * @param {{
 *   op: "upsert" | "delete",
 *   appId: string,
 *   taskSnapshot: any,   // the task row (for upsert) or last-known state (for delete)
 * }} payload
 */
export function enqueueTaskPush(db, config, payload) {
  if (!config.integrationsEnabled) return;
  if (!payload || !payload.taskSnapshot) return;
  if (isSuppressed(payload.taskSnapshot.id)) return;
  // Tasks created by the inbound sync (source_provider!=null) only need to
  // be echoed back if the user later edited them — but the suppression
  // window above already covers that. We don't push events at all back to
  // Google's read-only calendars.
  if (
    payload.taskSnapshot.source_provider &&
    payload.taskSnapshot.source_writable === false
  ) {
    return;
  }

  const taskId = payload.taskSnapshot.id;

  // Deletes need their own queue slot — they can't be debounced into a
  // subsequent upsert because the snapshot is already gone.
  if (payload.op === "delete") {
    enqueueDrain(() => runPush(db, config, payload));
    return;
  }

  // Debounce upserts: rapid sequential mutations on the same task collapse
  // into one final push. Cancel any existing timer for this task.
  const existing = debounceTimers.get(taskId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    debounceTimers.delete(taskId);
    enqueueDrain(() => runPush(db, config, payload));
  }, PUSH_DEBOUNCE_MS);
  // Don't keep the process alive just for this timer.
  timer.unref?.();
  debounceTimers.set(taskId, timer);
}

/**
 * Add a job to the rate-limited push queue and start the drain loop.
 * The drain enforces an aggregate ceiling of MAX_PUSH_PER_SEC across
 * all integrations.
 *
 * @param {() => Promise<void>} job
 */
function enqueueDrain(job) {
  pushQueue.push(job);
  if (queueRunning) return;
  queueRunning = true;
  setImmediate(drainQueue);
}

async function drainQueue() {
  try {
    while (pushQueue.length) {
      const minSpacing = Math.ceil(1000 / MAX_PUSH_PER_SEC);
      const now = Date.now();
      const wait = Math.max(0, lastPushAt + minSpacing - now);
      if (wait > 0) {
        await new Promise((r) => {
          const t = setTimeout(r, wait);
          t.unref?.();
        });
      }
      const job = pushQueue.shift();
      if (!job) break;
      lastPushAt = Date.now();
      try {
        await job();
      } catch (err) {
        // Already logged inside runPush; keep draining.
        console.warn(`[push] queued job error: ${err?.message || err}`);
      }
    }
  } finally {
    queueRunning = false;
  }
}

async function runPush(db, config, { op, appId, taskSnapshot }) {
  const integrations = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM calendar_integrations
         WHERE app_id = ? AND user_id = ? AND status = 'active'
           AND provider IN ('google', 'apple')`
      )
      .all(appId, taskSnapshot.created_by_id || "")
  );
  if (integrations.length === 0) return;

  // If the task already has an existing event mapping on a given integration,
  // we always keep round-tripping it on that integration (the user expects
  // edits to propagate where the event lives). For a brand-new task with no
  // mappings, we ONLY push to the user's default integration so connecting
  // both Google and Apple doesn't silently fan out duplicates.
  const mappedIntegrationIds = new Set(
    /** @type {any[]} */ (
      db
        .prepare(
          `SELECT integration_id FROM external_event_map WHERE task_id = ?`
        )
        .all(taskSnapshot.id)
    ).map((r) => r.integration_id)
  );

  const eligible = integrations.filter((integration) => {
    if (mappedIntegrationIds.has(integration.id)) return true;
    // Imported tasks always round-trip on the integration that owns them,
    // identified by source_provider matching.
    if (
      taskSnapshot.source_provider &&
      taskSnapshot.source_provider === integration.provider &&
      taskSnapshot.source_calendar_id
    ) {
      return true;
    }
    return !!integration.is_default;
  });

  for (const integration of eligible) {
    try {
      await pushOne(db, config, { op, integration, taskSnapshot });
    } catch (err) {
      // Per-integration failure already logged + marked; keep going.
      console.warn(
        `[push] integration ${integration.id} task ${taskSnapshot.id}: ${err.message}`
      );
    }
  }
}

/**
 * Run an async fn with up to 2 retries on 429 / 5xx, with exponential
 * backoff. Anything else (4xx, network errors) propagates immediately so
 * the caller can mark the integration's last_error.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withRetry(fn) {
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = /** @type {any} */ (err)?.statusCode;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || attempt >= 2) throw err;
      const delay = 500 * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => {
        const t = setTimeout(r, delay);
        t.unref?.();
      });
      attempt++;
    }
  }
}

async function pushOne(db, config, { op, integration, taskSnapshot }) {
  // Don't push back at calendars the user can't write to (Birthdays, Holidays,
  // shared read-only calendars). Inbound sync still imports them as 'event'-
  // kind tasks marked source_writable=false.
  if (taskSnapshot.source_writable === false) return;

  // Apple integrations write a different shape (CalDAV PUT/DELETE of ICS
  // bodies). The mapping table layout is the same, so we only fork the
  // network shape — read-side helpers below stay shared.
  if (integration.provider === "apple") {
    await pushOneApple(db, integration, taskSnapshot, op);
    return;
  }

  const mapRow = /** @type {any} */ (
    db
      .prepare(
        `SELECT * FROM external_event_map WHERE integration_id = ? AND task_id = ?`
      )
      .get(integration.id, taskSnapshot.id)
  );

  // For tasks created locally (no source_calendar_id), we push to the
  // integration's primary calendar. For tasks imported from Google we
  // round-trip them on whichever calendar they came from.
  const targetCalendarId =
    taskSnapshot.source_calendar_id ||
    integration.primary_calendar_id ||
    "primary";
  const calendarId = targetCalendarId;
  const tz = integration.primary_calendar_timezone || "UTC";

  // Delete path: task was hard/soft-deleted. Remove mapped event if present.
  if (op === "delete") {
    if (!mapRow) return;
    let accessToken;
    try {
      accessToken = await getFreshAccessToken(db, config, integration);
    } catch (err) {
      markPushError(db, integration.id, err);
      return;
    }
    try {
      await withRetry(() =>
        deleteGoogleEvent(accessToken, mapRow.external_calendar_id || calendarId, mapRow.external_event_id)
      );
    } catch (err) {
      markPushError(db, integration.id, err);
      return;
    }
    db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(mapRow.id);
    markPushOk(db, integration.id);
    return;
  }

  // Upsert path.
  const body = taskToEventBody(taskSnapshot, tz);
  if (!body) {
    // Task no longer belongs on a calendar (e.g. user removed its due_date).
    // If we had an event, delete it; otherwise noop.
    if (!mapRow) return;
    let accessToken;
    try {
      accessToken = await getFreshAccessToken(db, config, integration);
    } catch (err) {
      markPushError(db, integration.id, err);
      return;
    }
    try {
      await withRetry(() =>
        deleteGoogleEvent(accessToken, mapRow.external_calendar_id || calendarId, mapRow.external_event_id)
      );
    } catch (err) {
      markPushError(db, integration.id, err);
      return;
    }
    db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(mapRow.id);
    markPushOk(db, integration.id);
    return;
  }

  let accessToken;
  try {
    accessToken = await getFreshAccessToken(db, config, integration);
  } catch (err) {
    markPushError(db, integration.id, err);
    return;
  }

  const now = new Date().toISOString();

  if (mapRow) {
    // Update existing event. If Google returns 404/410 (user deleted event
    // on their end), drop the mapping and re-create below.
    let result;
    try {
      result = await withRetry(() =>
        updateGoogleEvent(
          accessToken,
          mapRow.external_calendar_id || calendarId,
          mapRow.external_event_id,
          body,
          mapRow.etag || undefined
        )
      );
    } catch (err) {
      markPushError(db, integration.id, err);
      return;
    }
    if (result.status === 404 || result.status === 410) {
      db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(mapRow.id);
    } else {
      db.prepare(
        `UPDATE external_event_map SET etag = ?, last_synced_at = ?, updated_date = ? WHERE id = ?`
      ).run(result.etag || null, now, now, mapRow.id);
      markPushOk(db, integration.id);
      return;
    }
  }

  // Create. Either first time we've seen this task, or we just dropped a
  // stale mapping above.
  let created;
  try {
    created = await withRetry(() => createGoogleEvent(accessToken, calendarId, body));
  } catch (err) {
    markPushError(db, integration.id, err);
    return;
  }
  db.prepare(
    `INSERT INTO external_event_map (
       id, app_id, integration_id, task_id, external_event_id,
       external_calendar_id, etag, last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `emap_${randomUUID()}`,
    integration.app_id,
    integration.id,
    taskSnapshot.id,
    created.id,
    calendarId,
    created.etag || null,
    now,
    now,
    now
  );
  markPushOk(db, integration.id);
}

/**
 * Apple iCloud push. We don't have a "primary calendar id" concept the way
 * Google does — for tasks created locally with no source we route them to
 * the integration's `primary_calendar_id` (the absolute URL we picked at
 * connect-time). Tasks imported from Apple keep their original calendar URL
 * stored on `source_calendar_id`.
 *
 * @param {DB} db
 * @param {any} integration
 * @param {any} taskSnapshot
 * @param {"upsert" | "delete"} op
 */
async function pushOneApple(db, integration, taskSnapshot, op) {
  const mapRow = /** @type {any} */ (
    db
      .prepare(
        `SELECT * FROM external_event_map WHERE integration_id = ? AND task_id = ?`
      )
      .get(integration.id, taskSnapshot.id)
  );

  const targetCalendarId =
    taskSnapshot.source_calendar_id || integration.primary_calendar_id || "";
  if (!targetCalendarId && op === "upsert") {
    // Nothing to write to — silently no-op rather than hard-error. The user
    // probably hasn't enabled any calendar yet.
    return;
  }

  let creds;
  try {
    creds = getAppleCredentials(db, integration);
  } catch (err) {
    markPushError(db, integration.id, err);
    return;
  }

  if (op === "delete") {
    if (!mapRow) return;
    try {
      await withRetry(() => deleteAppleEvent(creds, mapRow.external_event_id, mapRow.etag || undefined));
    } catch (err) {
      markPushError(db, integration.id, err);
      return;
    }
    db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(mapRow.id);
    markPushOk(db, integration.id);
    return;
  }

  // Upsert path. Build a VEVENT either updating in place or creating a new one.
  if (!taskSnapshot.due_date) {
    if (!mapRow) return;
    try {
      await withRetry(() => deleteAppleEvent(creds, mapRow.external_event_id, mapRow.etag || undefined));
    } catch (err) {
      markPushError(db, integration.id, err);
      return;
    }
    db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(mapRow.id);
    markPushOk(db, integration.id);
    return;
  }

  // We need a stable UID per task. For mapped tasks reuse what we pulled
  // out of the URL on first sync; for new ones mint one and embed in the URL.
  const uid =
    extractUidFromHref(mapRow?.external_event_id || "") ||
    deriveStableUid(taskSnapshot.id);

  const tz = integration.primary_calendar_timezone || "UTC";
  const ics = buildVEvent({
    uid,
    summary: taskSnapshot.title || "(Untitled task)",
    description: taskSnapshot.description || "",
    ...buildAppleStartEnd(taskSnapshot, tz),
    rrule: stripRrulePrefix(taskSnapshot.source_recurrence_rule || ""),
  });

  // For an existing mapping, PUT to the same href; otherwise PUT to a new
  // <UID>.ics path inside the target calendar.
  const href =
    mapRow?.external_event_id ||
    eventHrefForUid(targetCalendarId, uid);

  let result;
  try {
    result = await withRetry(() => putAppleEvent(creds, href, ics, mapRow?.etag || undefined));
  } catch (err) {
    markPushError(db, integration.id, err);
    return;
  }

  const now = new Date().toISOString();
  if (mapRow) {
    db.prepare(
      `UPDATE external_event_map SET etag = ?, last_synced_at = ?, updated_date = ? WHERE id = ?`
    ).run(result.etag || null, now, now, mapRow.id);
  } else {
    db.prepare(
      `INSERT INTO external_event_map (
         id, app_id, integration_id, task_id, external_event_id,
         external_calendar_id, etag, last_synced_at, created_date, updated_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      `emap_${randomUUID()}`,
      integration.app_id,
      integration.id,
      taskSnapshot.id,
      href,
      targetCalendarId,
      result.etag || null,
      now,
      now,
      now
    );
  }
  markPushOk(db, integration.id);
}

function buildAppleStartEnd(task, tz) {
  if (!task.task_time) {
    return {
      start: { date: task.due_date },
      end: { date: addOneDay(task.due_date) },
    };
  }
  const startMins = parseTaskTime(task.task_time);
  if (startMins == null) {
    return {
      start: { date: task.due_date },
      end: { date: addOneDay(task.due_date) },
    };
  }
  const startStr = toLocalIcsDateTime(task.due_date, startMins);
  const endMins = task.task_end_time ? parseTaskTime(task.task_end_time) : null;
  const endStr = toLocalIcsDateTime(
    task.due_date,
    endMins != null && endMins > startMins ? endMins : startMins + 60
  );
  return {
    start: { dateTime: startStr, tzid: tz },
    end: { dateTime: endStr, tzid: tz },
  };
}

function toLocalIcsDateTime(ymd, mins) {
  const [y, m, d] = ymd.split("-").map(Number);
  const h = Math.floor(mins / 60);
  const mm = mins % 60;
  const pad = (n) => String(n).padStart(2, "0");
  // Floating local time tagged with TZID — iCloud handles the offset.
  return `${y}${pad(m)}${pad(d)}T${pad(h)}${pad(mm)}00`;
}

function deriveStableUid(taskId) {
  // Stable per task so reconnects don't create duplicate events.
  return `zephyrly-${taskId}@zephyrly`;
}

function extractUidFromHref(href) {
  if (!href) return "";
  try {
    const last = href.split("/").pop() || "";
    const decoded = decodeURIComponent(last.replace(/\.ics$/i, ""));
    return decoded || "";
  } catch {
    return "";
  }
}

function stripRrulePrefix(rule) {
  return String(rule || "").replace(/^RRULE:/i, "");
}

// Suppress unused-import warning if buildVEvent etc. are flagged before we
// reference them above. (No-op at runtime.)
void newEventUid;

function markPushError(db, integrationId, err) {
  const msg = String((err && err.message) || "push_failed").slice(0, 200);
  db.prepare(
    `UPDATE calendar_integrations SET last_error = ?, updated_date = ? WHERE id = ?`
  ).run(msg, new Date().toISOString(), integrationId);
}

function markPushOk(db, integrationId) {
  // Don't clobber last_synced_at (that's for inbound sync). Just clear any
  // lingering last_error when the most recent push succeeded.
  db.prepare(
    `UPDATE calendar_integrations SET last_error = NULL, updated_date = ? WHERE id = ?`
  ).run(new Date().toISOString(), integrationId);
}

/**
 * Build a Google Calendar event resource from a Task row. Returns null if
 * the task has no due_date (i.e. isn't on a calendar).
 *
 * @param {any} task
 * @param {string} timeZone — IANA tz for timed events
 */
export function taskToEventBody(task, timeZone) {
  if (!task || !task.due_date) return null;

  const summary = String(task.title || "(Untitled task)").slice(0, 200);
  const description = String(task.description || "").slice(0, 5000);

  // All-day event — Google expects end.date to be exclusive (next day).
  if (!task.task_time) {
    return {
      summary,
      description,
      start: { date: task.due_date },
      end: { date: addOneDay(task.due_date) },
    };
  }

  const startDt = isoFromDateAndTime(task.due_date, task.task_time, timeZone);
  if (!startDt) return null;
  const endDt =
    task.task_end_time
      ? isoFromDateAndTime(task.due_date, task.task_end_time, timeZone) || plusHours(startDt, 1)
      : plusHours(startDt, 1);

  return {
    summary,
    description,
    start: { dateTime: startDt, timeZone },
    end: { dateTime: endDt, timeZone },
  };
}

function addOneDay(ymd) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Convert a Zephyrly date + "H:MMAM|PM" time into an ISO string (wall-clock
 * in the given IANA timezone). We emit the ISO without an offset and let
 * Google interpret it via the `timeZone` field on the event — this avoids
 * us having to compute the offset ourselves (which would require access to
 * a tz database at runtime).
 */
function isoFromDateAndTime(ymd, timeStr, _timeZone) {
  const parsed = parseTaskTime(timeStr);
  if (parsed == null) return null;
  const [y, m, d] = ymd.split("-").map(Number);
  const h = Math.floor(parsed / 60);
  const mm = parsed % 60;
  // Format: "YYYY-MM-DDTHH:MM:00" (no tz suffix — Google uses event.timeZone).
  const pad = (n) => String(n).padStart(2, "0");
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mm)}:00`;
}

function plusHours(iso, hours) {
  // Works on the "YYYY-MM-DDTHH:MM:00" format above.
  const [datePart, timePart] = iso.split("T");
  const [y, m, d] = datePart.split("-").map(Number);
  const [h, mm] = timePart.split(":").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, h, mm));
  dt.setUTCHours(dt.getUTCHours() + hours);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}:00`;
}

/**
 * Parse "H:MMAM|PM" → minutes since midnight. Matches the frontend helper
 * but we duplicate it here so the backend doesn't depend on /src.
 */
function parseTaskTime(s) {
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (h === 12) h = 0;
  if (ampm === "PM") h += 12;
  if (h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return h * 60 + mm;
}

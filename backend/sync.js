// @ts-check
/**
 * Calendar sync engine — inbound half (provider → Zephyrly).
 * Outbound half (Zephyrly → provider) lives in push.js and runs on
 * every Task mutation. This file polls Google for changes via per-calendar
 * syncTokens and applies them locally, suppressing the outbound echo via
 * push.js's suppressPush() so we don't bounce changes back.
 *
 * Each integration may have many provider calendars (one row per calendar
 * in `integration_calendars`); we only iterate the ones the user enabled
 * via the Configure modal in Settings. This is what keeps Birthdays /
 * Holidays / shared calendars from auto-importing — and crucially keeps
 * the initial sync from creating hundreds of "tasks".
 *
 * Recurring events:
 *   - We list with `singleEvents: false`, so the master series (with its
 *     RRULE) is what we see — not every expanded instance. We map the
 *     master into a single Zephyrly task whose `recurrence` field reflects
 *     the series. The user can then edit the Zephyrly recurrence freely;
 *     our changes never touch the other Google instances. (See user spec.)
 *   - Modified single instances (with `recurringEventId`) are skipped. The
 *     master alone represents the series here.
 *
 * Inbound design notes:
 *   - NEVER starts a sync for a calendar whose sync_enabled=0.
 *   - An in-process flag prevents overlapping ticks from double-syncing.
 *   - Errors on one integration / calendar don't abort the loop.
 *   - Tokens never appear in error messages / logs written from here.
 *
 */
import { randomUUID } from "node:crypto";
import {
  getFreshAccessToken,
  getAppleCredentials,
  markSyncResult,
  markCalendarSyncResult,
  clearCalendarSyncToken,
  refreshIntegrationCalendars,
} from "./integrations.js";
import { listEventsIncremental } from "./providers/google-calendar.js";
import {
  listEventsIncremental as listAppleEventsIncremental,
  parseVEvent,
  mapVEventToTaskInput,
} from "./providers/apple-calendar.js";
import { buildUserForSync } from "./sync-user.js";
import { createEntityRecord, updateEntityRecord, deleteEntityRecord } from "./store.js";
import { suppressPush } from "./push.js";

// Ensure we don't run two sync cycles for the same integration simultaneously.
const inFlight = new Set();

/** @type {NodeJS.Timeout | null} */
let intervalHandle = null;

/**
 * Start the background poller.
 *
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {import("./config.js").backendConfig} config
 */
export function startSyncLoop(db, config) {
  if (!config.integrationsEnabled) {
    return { stop() {} };
  }
  if (intervalHandle) return { stop: stopSyncLoop };

  // Run once at boot (delayed) so the server starts listening immediately.
  const initialDelay = Math.min(30_000, config.syncIntervalMs);
  setTimeout(() => {
    runAllDueSyncs(db, config).catch((err) => {
      console.warn("[sync] initial tick failed:", err.message);
    });
  }, initialDelay);

  intervalHandle = setInterval(() => {
    runAllDueSyncs(db, config).catch((err) => {
      console.warn("[sync] tick failed:", err.message);
    });
  }, config.syncIntervalMs);
  // Don't keep the process alive just for the sync timer.
  intervalHandle.unref?.();

  return { stop: stopSyncLoop };
}

export function stopSyncLoop() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

async function runAllDueSyncs(db, config) {
  const rows = db
    .prepare(`SELECT * FROM calendar_integrations WHERE status = 'active'`)
    .all();
  for (const row of rows) {
    if (inFlight.has(row.id)) continue;
    inFlight.add(row.id);
    try {
      await syncIntegration(db, config, row);
    } catch (err) {
      // Log without tokens; integration row already marked with last_error.
      console.warn(`[sync] integration ${row.id} failed:`, err.message);
    } finally {
      inFlight.delete(row.id);
    }
  }
}

/**
 * Sync one integration. Iterates each enabled calendar and pulls changes.
 * Exported for the manual-trigger route.
 */
export async function syncIntegration(db, config, integrationRow) {
  if (integrationRow.provider === "apple") {
    return syncAppleIntegration(db, config, integrationRow);
  }
  if (integrationRow.provider !== "google") {
    return;
  }

  // Make sure we have a CalendarList row for every provider calendar so
  // newly-shared calendars appear in the Configure modal even before the
  // user opens it. Best-effort: failures here are non-fatal.
  try {
    await refreshIntegrationCalendars(db, config, integrationRow);
  } catch (err) {
    // Often a 403 quota or transient network blip — just continue with
    // whatever calendars we have on record.
    console.warn(
      `[sync] refresh calendars for integration ${integrationRow.id} failed: ${err.message}`
    );
  }

  // Build the synthetic user object store.js needs to write tasks on
  // behalf of this integration's owner.
  const user = buildUserForSync(db, integrationRow);
  if (!user) {
    markSyncResult(db, integrationRow.id, { error: "Owner user not found" });
    return;
  }

  const calendars = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM integration_calendars WHERE integration_id = ? AND sync_enabled = 1`
      )
      .all(integrationRow.id)
  );

  if (calendars.length === 0) {
    // Nothing the user wants synced — clear last_error and bail. The user
    // will pick calendars via the Configure modal.
    markSyncResult(db, integrationRow.id, {});
    return;
  }

  let accessToken;
  try {
    accessToken = await getFreshAccessToken(db, config, integrationRow);
  } catch (err) {
    markSyncResult(db, integrationRow.id, { error: err.message });
    throw err;
  }

  for (const cal of calendars) {
    try {
      await syncOneCalendar(db, config, {
        integration: integrationRow,
        accessToken,
        user,
        calendarRow: cal,
      });
    } catch (err) {
      // Per-calendar failure shouldn't abort other calendars on the same
      // integration.
      markCalendarSyncResult(db, integrationRow.id, cal.external_calendar_id, {
        error: err.message,
      });
      console.warn(
        `[sync] calendar ${cal.external_calendar_id} on integration ${integrationRow.id}: ${err.message}`
      );
    }
  }

  // Top-level integration last_synced_at updates whenever any of its
  // calendars completed a tick. The per-calendar syncToken is what we
  // actually use for incremental fetching.
  markSyncResult(db, integrationRow.id, {});
}

async function syncOneCalendar(db, config, { integration, accessToken, user, calendarRow }) {
  const externalCalendarId = calendarRow.external_calendar_id;

  let result;
  try {
    result = await listEventsIncremental(
      accessToken,
      externalCalendarId,
      calendarRow.sync_token
    );
  } catch (err) {
    throw err;
  }

  if (result.fullResync) {
    // Google invalidated our sync token (typically >7 days idle). Drop it
    // and next tick will do a windowed re-fetch.
    clearCalendarSyncToken(db, integration.id, externalCalendarId);
    return;
  }

  for (const event of result.events) {
    try {
      // Skip individual recurring instances; we represent the series by
      // its master ('recurringEventId' is set on instances).
      if (event.recurringEventId) continue;
      await applyEventToTasks(db, config, {
        integration,
        user,
        calendarRow,
        event,
      });
    } catch (err) {
      // Keep going — one bad event shouldn't break the cycle.
      console.warn(
        `[sync] event ${event?.id || "?"} on integration ${integration.id}: ${err.message}`
      );
    }
  }

  markCalendarSyncResult(db, integration.id, externalCalendarId, {
    syncToken: result.nextSyncToken || null,
  });
}

/**
 * Map a single Google event → Task upsert (or delete when cancelled).
 */
async function applyEventToTasks(db, config, { integration, user, calendarRow, event }) {
  const existing = db
    .prepare(
      `SELECT * FROM external_event_map WHERE integration_id = ? AND external_event_id = ?`
    )
    .get(integration.id, event.id);

  // Cancelled events: Google marks them with status='cancelled'. Delete our
  // local copy.
  if (event.status === "cancelled") {
    if (existing) {
      // Suppress outbound echo: the upcoming delete would otherwise try to
      // re-DELETE this event at Google, which already sent us the cancel.
      suppressPush(existing.task_id);
      try {
        deleteEntityRecord(db, {
          entityName: "Task",
          appId: integration.app_id,
          user,
          id: existing.task_id,
        });
      } catch {
        // Task already gone; fine.
      }
      db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
    }
    return;
  }

  const mapped = mapGoogleEventToTaskInput(event, calendarRow);
  if (!mapped) return; // skip events we can't represent (e.g. no start)

  const now = new Date().toISOString();

  if (existing) {
    // Skip if etag matches — nothing changed.
    if (event.etag && existing.etag === event.etag) return;

    // Suppress outbound echo of the inbound change.
    suppressPush(existing.task_id);
    try {
      updateEntityRecord(db, {
        entityName: "Task",
        appId: integration.app_id,
        user,
        id: existing.task_id,
        input: mapped,
      });
    } catch (err) {
      if (/not found/i.test(err.message)) {
        // Local task was deleted by the user. Remove the map entry so we
        // don't keep trying to update it. Event stays on Google.
        db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
        return;
      }
      throw err;
    }

    db.prepare(
      `UPDATE external_event_map SET etag = ?, last_synced_at = ?, updated_date = ? WHERE id = ?`
    ).run(event.etag || null, now, now, existing.id);
    return;
  }

  const task = createEntityRecord(db, {
    entityName: "Task",
    appId: integration.app_id,
    user,
    input: mapped,
    config,
  });
  // The create above didn't route through server.js so our push hook isn't
  // fired — but suppress anyway as a belt-and-suspenders in case something
  // else tries to echo this task right back.
  suppressPush(task.id);

  db.prepare(
    `INSERT INTO external_event_map (
       id, app_id, integration_id, task_id, external_event_id,
       external_calendar_id, etag, last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `emap_${randomUUID()}`,
    integration.app_id,
    integration.id,
    task.id,
    event.id,
    calendarRow.external_calendar_id,
    event.etag || null,
    now,
    now,
    now
  );
}

/**
 * Decide whether a Google event represents a "task" or a "non-task" calendar
 * item (events / birthdays / holidays). Heuristics:
 *   - eventType field on the event itself (Google adds 'birthday' / 'fromGmail'
 *     / 'workingLocation' etc.).
 *   - read-only calendars (accessRole=reader/freeBusyReader) are events.
 *   - Holiday calendars summary contains "Holidays".
 * Anything else defaults to 'task' for the user's writable calendars and
 * 'event' for everything else.
 *
 * @param {any} event
 * @param {any} calendarRow
 */
function classifySource(event, calendarRow) {
  const writable =
    calendarRow.access_role === "owner" || calendarRow.access_role === "writer";
  const eventType = String(event.eventType || "default");
  const summary = String(calendarRow.summary || "").toLowerCase();
  const isHolidayCal = /holiday/.test(summary);
  const isBirthdayCal = /birthday/.test(summary) || eventType === "birthday";
  if (!writable || isHolidayCal || isBirthdayCal || eventType === "fromGmail") {
    return "event";
  }
  return "task";
}

/**
 * Convert a Google Calendar RRULE recurrence array into the Zephyrly
 * recurrence shape (recurrence + recurrence_days + recurrence_end_date).
 * Returns null if the event isn't recurring or the rule isn't representable.
 */
function parseRecurrence(event) {
  const rrules = Array.isArray(event.recurrence) ? event.recurrence : [];
  const rrule = rrules.find((r) => typeof r === "string" && r.startsWith("RRULE:"));
  if (!rrule) return null;
  const parts = rrule.slice("RRULE:".length).split(";").reduce((acc, p) => {
    const [k, v] = p.split("=");
    if (k && v) acc[k.toUpperCase()] = v.toUpperCase();
    return acc;
  }, /** @type {Record<string,string>} */ ({}));

  const freq = parts.FREQ;
  const interval = Number(parts.INTERVAL || "1");
  const until = parts.UNTIL ? googleUntilToYmd(parts.UNTIL) : "";
  const byday = parts.BYDAY ? parts.BYDAY.split(",") : [];

  // Map BYDAY tokens (MO/TU/...) → Zephyrly day numbers (0=Sun..6=Sat) used
  // in `recurrence_days_json`. (Frontend uses date-fns-style 0..6.)
  const dayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
  const days = byday.map((d) => dayMap[d.replace(/^[+-]?\d+/, "")]).filter((n) => n != null);

  if (freq === "DAILY" && interval === 1) {
    return { recurrence: "daily", recurrence_days: [], recurrence_end_date: until };
  }
  if (freq === "WEEKLY") {
    return { recurrence: "weekly", recurrence_days: days, recurrence_end_date: until };
  }
  if (freq === "MONTHLY") {
    return { recurrence: "monthly", recurrence_days: [], recurrence_end_date: until };
  }
  if (freq === "YEARLY") {
    return { recurrence: "yearly", recurrence_days: [], recurrence_end_date: until };
  }
  // Fallback: still mark recurring so the UI shows the violet dot, but use
  // 'custom' which the frontend treats as "won't auto-roll, just one card".
  return { recurrence: "custom", recurrence_days: [], recurrence_end_date: until };
}

function googleUntilToYmd(until) {
  // RRULE UNTIL is YYYYMMDD or YYYYMMDDTHHMMSSZ.
  if (!until) return "";
  const ymd = until.slice(0, 8);
  if (ymd.length !== 8) return "";
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

/**
 * Convert a Google Calendar event into our Task shape. Returns null if the
 * event is malformed or not representable (e.g. multi-day events — we'd
 * need range support which we don't have yet).
 *
 * @param {any} event
 * @param {any} [calendarRow]
 */
export function mapGoogleEventToTaskInput(event, calendarRow) {
  if (!event || !event.start) return null;

  const summary = String(event.summary || "(No title)").slice(0, 200);
  const description = String(event.description || "").slice(0, 5000);

  // All-day events use `date`; timed events use `dateTime`.
  let due_date = "";
  let task_time = "";
  let task_end_time = "";

  if (event.start.date) {
    // All-day: prefer the start date. Multi-day all-day events collapse
    // to the start date for now (TODO: multi-day spans).
    due_date = event.start.date; // YYYY-MM-DD
  } else if (event.start.dateTime) {
    const startDt = new Date(event.start.dateTime);
    if (Number.isNaN(startDt.getTime())) return null;
    due_date = toYMD(startDt);
    task_time = toTaskTime(startDt);
    if (event.end && event.end.dateTime) {
      const endDt = new Date(event.end.dateTime);
      if (!Number.isNaN(endDt.getTime()) && toYMD(endDt) === due_date) {
        task_end_time = toTaskTime(endDt);
      }
    }
  } else {
    return null;
  }

  const sourceKind = calendarRow ? classifySource(event, calendarRow) : "event";
  const writable =
    !calendarRow ||
    calendarRow.access_role === "owner" ||
    calendarRow.access_role === "writer";
  const colorHex = calendarRow?.color_hex || "";
  const calendarName = calendarRow?.summary || "";

  // Recurrence — pulled off the master series, since we list with
  // singleEvents=false.
  const recurrenceMapped = /** @type {{ recurrence?: string, recurrence_days?: number[], recurrence_end_date?: string }} */ (
    parseRecurrence(event) || {}
  );
  const taskType = recurrenceMapped.recurrence ? "recurring" : "one_time";
  const rawRrule = Array.isArray(event.recurrence)
    ? event.recurrence.find((r) => typeof r === "string" && r.startsWith("RRULE:")) || ""
    : "";

  return {
    title: summary,
    description,
    due_date,
    task_time,
    task_end_time,
    status: "todo",
    task_type: taskType,
    recurrence: recurrenceMapped.recurrence || "none",
    recurrence_days: recurrenceMapped.recurrence_days || [],
    recurrence_end_date: recurrenceMapped.recurrence_end_date || "",
    source_provider: "google",
    source_kind: sourceKind,
    source_calendar_id: calendarRow?.external_calendar_id || "",
    source_calendar_name: calendarName,
    source_color_hex: colorHex,
    source_writable: writable,
    source_recurrence_rule: rawRrule,
  };
}

function toYMD(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Apple iCloud (CalDAV) inbound sync
// ---------------------------------------------------------------------------
//
// Mirrors the Google path structurally:
//   - Refresh integration_calendars from CalDAV principal/home discovery so
//     calendars added on the user's other devices appear here.
//   - For each enabled calendar, REPORT changes (sync-collection if we have
//     a token, else windowed calendar-query).
//   - For each VEVENT, map → Task and upsert through the same store.js path
//     Google uses, with suppressPush() to prevent the inbound change from
//     being echoed back out.
//
// Differences from Google:
//   - Auth is HTTP Basic on every call (no token refresh), so we don't
//     pre-fetch an access token.
//   - The provider's listEventsIncremental returns a (href, etag, ics)
//     triple per change instead of a Google event object — we parse the ICS
//     ourselves with parseVEvent before mapping.

async function syncAppleIntegration(db, config, integrationRow) {
  // Re-discover calendars so newly-added shared calendars appear in Configure.
  try {
    await refreshIntegrationCalendars(db, config, integrationRow);
  } catch (err) {
    console.warn(
      `[sync] apple refresh calendars for integration ${integrationRow.id} failed: ${err.message}`
    );
  }

  const user = buildUserForSync(db, integrationRow);
  if (!user) {
    markSyncResult(db, integrationRow.id, { error: "Owner user not found" });
    return;
  }

  const calendars = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM integration_calendars WHERE integration_id = ? AND sync_enabled = 1`
      )
      .all(integrationRow.id)
  );
  if (calendars.length === 0) {
    markSyncResult(db, integrationRow.id, {});
    return;
  }

  let creds;
  try {
    creds = getAppleCredentials(db, integrationRow);
  } catch (err) {
    markSyncResult(db, integrationRow.id, { error: err.message });
    throw err;
  }

  for (const cal of calendars) {
    try {
      await syncOneAppleCalendar(db, config, {
        integration: integrationRow,
        creds,
        user,
        calendarRow: cal,
      });
    } catch (err) {
      markCalendarSyncResult(db, integrationRow.id, cal.external_calendar_id, {
        error: err.message,
      });
      console.warn(
        `[sync] apple calendar ${cal.external_calendar_id} on integration ${integrationRow.id}: ${err.message}`
      );
    }
  }

  markSyncResult(db, integrationRow.id, {});
}

async function syncOneAppleCalendar(db, config, { integration, creds, user, calendarRow }) {
  const externalCalendarId = calendarRow.external_calendar_id; // absolute calendar URL
  let result;
  try {
    result = await listAppleEventsIncremental(creds, externalCalendarId, calendarRow.sync_token);
  } catch (err) {
    throw err;
  }

  if (result.fullResync) {
    clearCalendarSyncToken(db, integration.id, externalCalendarId);
    return;
  }

  for (const change of result.changes) {
    try {
      await applyAppleChangeToTasks(db, config, {
        integration,
        user,
        calendarRow,
        change,
      });
    } catch (err) {
      console.warn(
        `[sync] apple event ${change.href || "?"} on integration ${integration.id}: ${err.message}`
      );
    }
  }

  markCalendarSyncResult(db, integration.id, externalCalendarId, {
    syncToken: result.nextSyncToken || null,
  });
}

/**
 * @param {any} db
 * @param {any} config
 * @param {{
 *   integration: any,
 *   user: any,
 *   calendarRow: any,
 *   change: { href: string, etag: string, ics: string, deleted: boolean },
 * }} ctx
 */
async function applyAppleChangeToTasks(db, config, { integration, user, calendarRow, change }) {
  // We key external_event_map.external_event_id off the event's full href —
  // it's stable, unique within the calendar, and is what we need to PUT/DELETE
  // back to. (UID would also work; href is what CalDAV calls us back with so
  // it's friction-free here.)
  const existing = db
    .prepare(
      `SELECT * FROM external_event_map WHERE integration_id = ? AND external_event_id = ?`
    )
    .get(integration.id, change.href);

  if (change.deleted) {
    if (existing) {
      suppressPush(existing.task_id);
      try {
        deleteEntityRecord(db, {
          entityName: "Task",
          appId: integration.app_id,
          user,
          id: existing.task_id,
        });
      } catch {
        // already gone
      }
      db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
    }
    return;
  }

  // Skip override-instance VEVENTs (RECURRENCE-ID set) — we represent the
  // master series as one task, same as Google's `recurringEventId` filter.
  const ev = parseVEvent(change.ics);
  if (!ev) return;
  if (ev.recurrenceId) return;
  if (ev.status === "CANCELLED") {
    if (existing) {
      suppressPush(existing.task_id);
      try {
        deleteEntityRecord(db, {
          entityName: "Task",
          appId: integration.app_id,
          user,
          id: existing.task_id,
        });
      } catch {
        // already gone
      }
      db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
    }
    return;
  }

  const mapped = mapVEventToTaskInput(ev, calendarRow);
  if (!mapped) return;

  const now = new Date().toISOString();

  if (existing) {
    if (change.etag && existing.etag === change.etag) return;
    suppressPush(existing.task_id);
    try {
      updateEntityRecord(db, {
        entityName: "Task",
        appId: integration.app_id,
        user,
        id: existing.task_id,
        input: mapped,
      });
    } catch (err) {
      if (/not found/i.test(err.message)) {
        db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(existing.id);
        return;
      }
      throw err;
    }
    db.prepare(
      `UPDATE external_event_map SET etag = ?, last_synced_at = ?, updated_date = ? WHERE id = ?`
    ).run(change.etag || null, now, now, existing.id);
    return;
  }

  const task = createEntityRecord(db, {
    entityName: "Task",
    appId: integration.app_id,
    user,
    input: mapped,
    config,
  });
  suppressPush(task.id);

  // Stash the VEVENT UID alongside the href so push.js can rebuild PUT
  // bodies that match what iCloud expects on update.
  db.prepare(
    `INSERT INTO external_event_map (
       id, app_id, integration_id, task_id, external_event_id,
       external_calendar_id, etag, last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `emap_${randomUUID()}`,
    integration.app_id,
    integration.id,
    task.id,
    change.href,
    calendarRow.external_calendar_id,
    change.etag || null,
    now,
    now,
    now
  );
}

function toTaskTime(date) {
  // Match the frontend's `H:MMAM|PM` format (see src/lib/sort-helpers).
  const h24 = date.getHours();
  const m = date.getMinutes();
  const ampm = h24 < 12 ? "AM" : "PM";
  const hour = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  return `${hour}:${String(m).padStart(2, "0")}${ampm}`;
}

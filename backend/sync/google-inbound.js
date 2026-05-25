// @ts-check
/**
 * @file Google Calendar inbound sync — per-calendar event pull + map
 * to Zephyrly tasks. Calls suppressPush() before each store mutation
 * to break the inbound→outbound echo loop.
 */
import { randomUUID } from "node:crypto";
import { listEventsIncremental } from "../providers/google-calendar.js";
import { clearCalendarSyncToken, markCalendarSyncResult } from "../integrations.js";
import { createEntityRecord, updateEntityRecord, deleteEntityRecord } from "../store.js";
import { suppressPush } from "../push.js";
import { parseRruleValueToTaskRecurrence } from "../recurrence-rrule.js";
import { log } from "../log.js";
import {
  findZephyrlyTaskForProviderEvent,
  mappedInputForExistingZephyrlyTask,
  insertExternalEventMap,
  formatYmdInTz,
  formatTaskTimeInTz,
} from "./shared.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

export async function syncOneCalendar(db, config, { integration, accessToken, user, calendarRow }) {
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
      log.warn(
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

  const linkedTask = findZephyrlyTaskForProviderEvent(db, {
    integration,
    user,
    taskId: googleZephyrlyTaskId(event, integration.app_id),
  });
  if (linkedTask) {
    suppressPush(linkedTask.id);
    updateEntityRecord(db, {
      entityName: "Task",
      appId: integration.app_id,
      user,
      id: linkedTask.id,
      input: mappedInputForExistingZephyrlyTask(mapped, linkedTask),
    });
    insertExternalEventMap(db, {
      appId: integration.app_id,
      integrationId: integration.id,
      taskId: linkedTask.id,
      externalEventId: event.id,
      externalCalendarId: calendarRow.external_calendar_id,
      etag: event.etag || null,
      now,
    });
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
 * Unsupported RRULEs become recurrence="custom" so the provider series stays
 * marked recurring without pretending Zephyrly can auto-roll that shape.
 */
function parseRecurrence(event, dtstartYmd = "") {
  const rrules = Array.isArray(event.recurrence) ? event.recurrence : [];
  const rrule = rrules.find((r) => typeof r === "string" && r.startsWith("RRULE:"));
  if (!rrule) return null;
  return parseRruleValueToTaskRecurrence(rrule, { dtstartYmd });
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
    // to the start date for now (KNOWN-LIMITATION: multi-day spans are flattened — fix tracked separately).
    due_date = event.start.date; // YYYY-MM-DD
  } else if (event.start.dateTime) {
    const startDt = new Date(event.start.dateTime);
    if (Number.isNaN(startDt.getTime())) return null;
    // Format the start in the calendar's display timezone, NOT the server's
    // local TZ. The Docker container runs in UTC, so a naive `getHours()` on
    // a Date parsed from "2026-04-29T08:00:00-04:00" returns 12 (UTC), and
    // an 8AM Eastern event would import as 12PM. Use the calendar row's
    // `time_zone` (populated from Google's calendars.list `timeZone`
    // response) — that's the calendar owner's home tz, which is what users
    // think of as "the time on the event".
    //   • Per-event tz override (event.start.timeZone) is intentionally
    //     ignored: we render in the calendar's tz so all events read as a
    //     single coherent local-day grid in Zephyrly.
    const tz = String(calendarRow?.time_zone || "UTC") || "UTC";
    due_date = formatYmdInTz(startDt, tz);
    task_time = formatTaskTimeInTz(startDt, tz);
    if (event.end && event.end.dateTime) {
      const endDt = new Date(event.end.dateTime);
      if (!Number.isNaN(endDt.getTime()) && formatYmdInTz(endDt, tz) === due_date) {
        task_end_time = formatTaskTimeInTz(endDt, tz);
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
    parseRecurrence(event, due_date) || {}
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

export function googleZephyrlyTaskId(event, appId) {
  const props = event?.extendedProperties?.private || {};
  const eventAppId = String(props.zephyrlyAppId || "");
  if (eventAppId && eventAppId !== appId) return "";
  return String(props.zephyrlyTaskId || "");
}

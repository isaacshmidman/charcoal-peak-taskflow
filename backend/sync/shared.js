// @ts-check
/**
 * @file Helpers used by BOTH inbound paths (Google + Apple):
 *   - finding a pre-existing local Zephyrly task by id (when a provider
 *     event was originally created by us and round-trips back)
 *   - merging mapped fields into an existing task without overwriting
 *     its native (non-provider) provenance
 *   - inserting/upserting the external_event_map row that links a task
 *     to a provider event
 *   - timezone-safe date + time formatting (used to render a calendar's
 *     home-tz wall-clock, regardless of the server's local TZ)
 */
import { randomUUID } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * @param {DB} db
 * @param {{ integration: any, user: any, taskId: string }} ctx
 */
export function findZephyrlyTaskForProviderEvent(db, { integration, user, taskId }) {
  if (!taskId) return null;
  return /** @type {any} */ (
    db
      .prepare(
        `SELECT * FROM tasks
         WHERE id = ?
           AND app_id = ?
           AND (
             (created_by_id = ? AND created_by_id != '')
             OR LOWER(created_by) = ?
           )`
      )
      .get(taskId, integration.app_id, user.id || "", String(user.email || "").toLowerCase())
  );
}

export function mappedInputForExistingZephyrlyTask(mapped, task) {
  const input = { ...mapped };
  if (!task.source_provider) {
    delete input.source_provider;
    delete input.source_kind;
    delete input.source_calendar_id;
    delete input.source_calendar_name;
    delete input.source_color_hex;
    delete input.source_writable;
    delete input.source_recurrence_rule;
  }
  return input;
}

export function insertExternalEventMap(db, {
  appId,
  integrationId,
  taskId,
  externalEventId,
  externalCalendarId,
  etag,
  now,
}) {
  db.prepare(`DELETE FROM external_event_map WHERE integration_id = ? AND task_id = ?`).run(
    integrationId,
    taskId
  );
  db.prepare(
    `INSERT INTO external_event_map (
       id, app_id, integration_id, task_id, external_event_id,
       external_calendar_id, etag, last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    `emap_${randomUUID()}`,
    appId,
    integrationId,
    taskId,
    externalEventId,
    externalCalendarId,
    etag || null,
    now,
    now,
    now
  );
}

// Format helpers operate in a target timezone (the calendar's home TZ
// from `integration_calendars.time_zone`) so events render at the wall-clock
// time the user actually scheduled, regardless of the server's local TZ
// (Docker containers default to UTC, so without this an 8AM Eastern event
// would import as 12PM).
export function formatYmdInTz(date, tz) {
  try {
    return formatInTimeZone(date, tz || "UTC", "yyyy-MM-dd");
  } catch {
    return formatInTimeZone(date, "UTC", "yyyy-MM-dd");
  }
}

export function formatTaskTimeInTz(date, tz) {
  // Match frontend's `H:MMAM|PM` — no leading zero on hour, uppercase AM/PM.
  try {
    return formatInTimeZone(date, tz || "UTC", "h:mmaaa")
      .replace("am", "AM")
      .replace("pm", "PM");
  } catch {
    return formatInTimeZone(date, "UTC", "h:mmaaa")
      .replace("am", "AM")
      .replace("pm", "PM");
  }
}

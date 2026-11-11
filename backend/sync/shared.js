// @ts-check
/**
 * @file Helpers used by BOTH inbound paths (Google + Apple):
 *   - finding a pre-existing local Zephyrly task by id (when a provider
 *     event was originally created by us and round-trips back)
 *   - deciding what a change at the calendar may alter on a task that
 *     already exists here (inboundUpdateFor)
 *   - inserting/upserting the external_event_map row that links a task
 *     to a provider event
 *   - timezone-safe date + time formatting (used to render a calendar's
 *     home-tz wall-clock, regardless of the server's local TZ)
 */
import { randomUUID } from "node:crypto";
import { formatInTimeZone } from "date-fns-tz";
import { withTransaction } from "../db.js";
import { createEntityRecord, deleteEntityRecord, hydrateRecord } from "../store.js";
import { enqueueTaskPush } from "../push.js";
import { recentlyDeletedRecord } from "../lib/recently-deleted.js";
import { markSyncResult } from "../integrations.js";

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

/**
 * What a change at the calendar may alter on a task Zephyrly already has.
 *
 * A calendar event knows a title, a time, a description and a repeat rule.
 * It does not know whether the task is done, and it is not where a task
 * made in Zephyrly came from. So an update coming in:
 *
 *   - never touches `status`. (It used to carry "todo", which un-ticked a
 *     finished task whenever its event changed at the calendar.)
 *   - never rewrites where a Zephyrly-made task came from. (It used to
 *     stamp the calendar's name on it, turning the task into a calendar
 *     event: gone from Today and All Tasks, no longer editable.)
 *   - leaves a Zephyrly-made task's repeat alone when the calendar's rule
 *     is one Zephyrly can't express.
 *   - leaves the description alone unless the calendar's text is really
 *     different. The task may hold formatted text, of which the calendar
 *     only ever saw the plain words; writing those words back would throw
 *     the formatting away for nothing. When the text did change there, the
 *     calendar's words win and the formatted copy goes, so the editor shows
 *     what the calendar says rather than a stale version.
 *
 * @param {Record<string, any>} mapped  the event, as task fields
 * @param {Record<string, any>} task    the task as it is stored now
 */
export function inboundUpdateFor(mapped, task) {
  const input = { ...mapped };
  delete input.status;
  if (!task.source_provider) {
    delete input.source_provider;
    delete input.source_kind;
    delete input.source_calendar_id;
    delete input.source_calendar_name;
    delete input.source_color_hex;
    delete input.source_writable;
    delete input.source_recurrence_rule;
    // A repeat rule Zephyrly can't express comes in as "custom", which only
    // means something next to the calendar's own rule, and a Zephyrly-made
    // task doesn't keep that. Its own repeat stays as it was.
    if (input.recurrence === "custom") {
      delete input.recurrence;
      delete input.task_type;
      delete input.recurrence_days;
      delete input.recurrence_end_date;
    }
  }
  if ("description" in input) {
    if (sameText(input.description, task.description)) delete input.description;
    else input.description_json = "";
  }
  return input;
}

/** @param {unknown} a @param {unknown} b */
function sameText(a, b) {
  const plain = (/** @type {unknown} */ value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
  return plain(a) === plain(b);
}

/**
 * The stored task a calendar change is about, or null when it has been
 * deleted here since.
 *
 * @param {DB} db
 * @param {string} appId
 * @param {string} taskId
 */
export function storedTask(db, appId, taskId) {
  return /** @type {any} */ (db.prepare(`SELECT * FROM tasks WHERE id = ? AND app_id = ?`).get(taskId, appId)) || null;
}

/**
 * The calendar says an event is gone. What happens to the task it was
 * linked to depends on whose task it is:
 *
 *   - It came from the calendar: it goes too. Everything about it lives at
 *     the calendar, and there it no longer exists.
 *   - It was made in Zephyrly and only shown on the calendar: it moves to
 *     Recently Deleted with its subtasks and files, exactly as if deleted
 *     in the app, and can be restored from there. (It used to be removed
 *     for good, files and all: deleting a calendar entry, or moving it to
 *     another calendar, destroyed the task with no way back.)
 *   - It is a subtask: it stays. A subtask can't sit in Recently Deleted on
 *     its own, and losing it for good over a calendar entry isn't right.
 *
 * The caller removes the link either way.
 *
 * @param {DB} db
 * @param {any} config
 * @param {{ integration: any, user: any, taskId: string }} ctx
 * @returns {"removed" | "recently_deleted" | "kept" | "already_gone"}
 */
export function removeTaskForCalendarDelete(db, config, { integration, user, taskId }) {
  const appId = integration.app_id;
  const row = storedTask(db, appId, taskId);
  if (!row) return "already_gone";

  if (row.source_provider) {
    try {
      deleteEntityRecord(db, { entityName: "Task", appId, user, id: taskId, config });
    } catch {
      return "already_gone";
    }
    return "removed";
  }
  if (row.parent_id) return "kept";

  const task = hydrateRecord("Task", row);
  const subtasks = /** @type {any[]} */ (
    db.prepare(`SELECT * FROM tasks WHERE parent_id = ? AND app_id = ?`).all(taskId, appId)
  ).map((subtask) => hydrateRecord("Task", subtask));
  const priority = /** @type {any} */ (
    task.priority_id ? db.prepare(`SELECT color FROM priorities WHERE id = ? AND app_id = ?`).get(task.priority_id, appId) : null
  );
  try {
    withTransaction(db, () => {
      createEntityRecord(db, {
        entityName: "DeletedTask",
        appId,
        user,
        input: recentlyDeletedRecord(task, subtasks, priority?.color),
        config,
      });
      // Takes the subtasks with it and holds the files for a restore.
      deleteEntityRecord(db, { entityName: "Task", appId, user, id: taskId, config, holdFiles: true });
    });
  } catch (error) {
    if (/not found/i.test(/** @type {any} */ (error)?.message || "")) return "already_gone";
    throw error;
  }
  // Subtasks shown on a calendar had events of their own.
  for (const subtask of subtasks) enqueueTaskPush(db, config, { op: "delete", appId, taskSnapshot: subtask });
  return "recently_deleted";
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

/**
 * Record how a sync round went on the connection itself. "Synced" means
 * at least one calendar was read; when none could be, the connection says
 * why instead of claiming a sync that didn't happen. (Every round used to
 * be recorded as a success, whatever the calendars had answered.)
 *
 * @param {DB} db
 * @param {string} integrationId
 * @param {{ calendars: number, failed: number, firstError: string }} outcome
 */
export function markSyncOutcome(db, integrationId, { calendars, failed, firstError }) {
  if (calendars > 0 && failed === calendars) {
    markSyncResult(db, integrationId, { error: firstError });
    return;
  }
  markSyncResult(db, integrationId, {});
}

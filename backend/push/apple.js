// @ts-check
/**
 * @file Apple iCloud (CalDAV) branch of the push runner. Builds an ICS
 * VEVENT, PUTs/DELETEs against the calendar URL.
 */
import { randomUUID } from "node:crypto";
import { getAppleCredentials } from "../integrations.js";
import {
  buildVEvent,
  putEvent as putAppleEvent,
  deleteEvent as deleteAppleEvent,
  eventHrefForUid,
} from "../providers/apple-calendar.js";
import { taskToRruleLine } from "../recurrence-rrule.js";
import { lookupPriorityColor, colorNameToHex } from "../priority-color.js";
import { parseTaskTime, addOneDay } from "./shape.js";
import { markPushError, markPushOk, withRetry, isCalendarSyncDisabled } from "./errors.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

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
export async function pushOneApple(db, integration, taskSnapshot, op) {
  const mapRow = /** @type {any} */ (
    db
      .prepare(
        `SELECT * FROM external_event_map WHERE integration_id = ? AND task_id = ?`
      )
      .get(integration.id, taskSnapshot.id)
  );

  const targetCalendarId =
    taskSnapshot.source_calendar_id || integration.primary_calendar_id || "";
  if (isCalendarSyncDisabled(db, integration.id, mapRow?.external_calendar_id || targetCalendarId)) {
    return;
  }
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
  // RRULE handling is centralized: native Zephyrly recurrence fields are
  // serialized directly, while unsupported imported `custom` series can still
  // round-trip their original source_recurrence_rule.
  // buildVEvent expects the RRULE *value* (no "RRULE:" prefix), so strip it.
  const rruleFullLine = taskToRruleLine(taskSnapshot);
  const rrule = rruleFullLine ? rruleFullLine.replace(/^RRULE:/i, "") : "";

  // Priority → ICS COLOR property (RFC 7986 §5.9). Apple Calendar
  // honors per-event color overrides on iOS/macOS; iCloud.com is
  // hit-or-miss but doesn't reject the property either way.
  const priorityColorName = lookupPriorityColor(db, integration.app_id, taskSnapshot.priority_id);
  const color = priorityColorName ? colorNameToHex(priorityColorName) : "";

  const ics = buildVEvent({
    uid,
    summary: taskSnapshot.title || "(Untitled task)",
    description: taskSnapshot.description || "",
    ...buildAppleStartEnd(taskSnapshot, tz),
    rrule,
    color,
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
  const dt = new Date(Date.UTC(y, m - 1, d, 0, mins));
  const pad = (n) => String(n).padStart(2, "0");
  // Floating local time tagged with TZID — iCloud handles the offset.
  return `${dt.getUTCFullYear()}${pad(dt.getUTCMonth() + 1)}${pad(dt.getUTCDate())}T${pad(dt.getUTCHours())}${pad(dt.getUTCMinutes())}00`;
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

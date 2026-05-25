// @ts-check
/**
 * @file Google Calendar branch of the push runner. Handles create/update/
 * delete via the Calendar REST API + maintains the external_event_map
 * rows that link a Zephyrly task to a Google event.
 */
import { randomUUID } from "node:crypto";
import { getFreshAccessToken } from "../integrations.js";
import {
  createEvent as createGoogleEvent,
  updateEvent as updateGoogleEvent,
  deleteEvent as deleteGoogleEvent,
} from "../providers/google-calendar.js";
import {
  lookupPriorityColor,
  colorNameToGoogleColorId,
} from "../priority-color.js";
import { taskToEventBody } from "./shape.js";
import { markPushError, markPushOk, withRetry, isCalendarSyncDisabled } from "./errors.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * @param {DB} db
 * @param {import("../config.js").backendConfig} config
 * @param {{ op: "upsert" | "delete", integration: any, taskSnapshot: any }} args
 */
export async function pushOneGoogle(db, config, { op, integration, taskSnapshot }) {
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
  if (isCalendarSyncDisabled(db, integration.id, mapRow?.external_calendar_id || calendarId)) {
    return;
  }
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

  // Upsert path. Resolve priority → Google colorId here in the caller so
  // taskToEventBody stays a pure shape function (no DB access). Tasks
  // without a priority, or whose priority color doesn't have a Google
  // mapping, fall through and let the event use the calendar's default.
  const priorityColorName = lookupPriorityColor(db, integration.app_id, taskSnapshot.priority_id);
  const colorId = priorityColorName ? colorNameToGoogleColorId(priorityColorName) : undefined;
  const body = taskToEventBody(taskSnapshot, tz, colorId);
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
        `UPDATE external_event_map
         SET etag = ?,
             zephyrly_metadata_synced_at = ?,
             last_synced_at = ?,
             updated_date = ?
         WHERE id = ?`
      ).run(result.etag || null, now, now, now, mapRow.id);
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
       external_calendar_id, etag, zephyrly_metadata_synced_at,
       last_synced_at, created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    now,
    now
  );
  markPushOk(db, integration.id);
}

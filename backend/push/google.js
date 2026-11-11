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
  findEventForTask as findGoogleEventForTask,
} from "../providers/google-calendar.js";
import {
  lookupPriorityColor,
  colorNameToGoogleColorId,
} from "../priority-color.js";
import { taskToEventBody } from "./shape.js";
import { pushFailed, markPushOk, withRetry, isCalendarSyncDisabled } from "./errors.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * The event body as a CHANGE to an event that exists.
 *
 * Google applies an update field by field: whatever isn't mentioned stays.
 * So a body that is right for a new event is wrong for an old one in three
 * places, each of which used to leave the calendar out of step:
 *
 *   - An all-day event has `start.date`; a timed one has `start.dateTime`.
 *     Giving a task a time sent only `dateTime`, the old `date` stayed
 *     beside it, and Google refused the event as having two starts (400).
 *     The one that no longer applies has to be sent as null.
 *   - A task that stopped repeating sent no repeat rule, so the event kept
 *     repeating. "No rule" has to be said: null.
 *   - Likewise the colour, when the task no longer has a priority. Only for
 *     tasks made here: an event that came from the calendar keeps whatever
 *     colour was chosen for it there.
 *
 * @param {any} body  from taskToEventBody
 * @param {any} task
 */
export function asChangeToExistingEvent(body, task) {
  const allDay = Boolean(body.start?.date);
  const side = (/** @type {any} */ value) => (allDay ? { ...value, dateTime: null } : { ...value, date: null });
  return {
    ...body,
    start: side(body.start),
    end: side(body.end),
    recurrence: body.recurrence || null,
    ...(task?.source_provider || body.colorId ? {} : { colorId: null }),
  };
}

/**
 * @param {DB} db
 * @param {import("../config.js").backendConfig} config
 * @param {{ op: "upsert" | "delete", integration: any, taskSnapshot: any, retry?: boolean }} args
 */
export async function pushOneGoogle(db, config, { op, integration, taskSnapshot, retry = false }) {
  let mapRow = /** @type {any} */ (
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
      throw pushFailed(db, integration.id, err);
    }
    try {
      await withRetry(() =>
        deleteGoogleEvent(accessToken, mapRow.external_calendar_id || calendarId, mapRow.external_event_id)
      );
    } catch (err) {
      throw pushFailed(db, integration.id, err);
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
      throw pushFailed(db, integration.id, err);
    }
    try {
      await withRetry(() =>
        deleteGoogleEvent(accessToken, mapRow.external_calendar_id || calendarId, mapRow.external_event_id)
      );
    } catch (err) {
      throw pushFailed(db, integration.id, err);
    }
    db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(mapRow.id);
    markPushOk(db, integration.id);
    return;
  }

  let accessToken;
  try {
    accessToken = await getFreshAccessToken(db, config, integration);
  } catch (err) {
    throw pushFailed(db, integration.id, err);
  }

  const now = new Date().toISOString();

  // A second try at a NEW event: the first may have made it and only the
  // answer was lost. Look for it (every event we make carries the task's
  // id) and change that one, rather than make a twin.
  if (!mapRow && retry) {
    let found;
    try {
      found = await withRetry(() => findGoogleEventForTask(accessToken, calendarId, taskSnapshot.id));
    } catch (err) {
      throw pushFailed(db, integration.id, err);
    }
    if (found) {
      const id = `emap_${randomUUID()}`;
      db.prepare(`DELETE FROM external_event_map WHERE integration_id = ? AND external_event_id = ?`).run(
        integration.id,
        found.id
      );
      db.prepare(
        `INSERT INTO external_event_map (
           id, app_id, integration_id, task_id, external_event_id,
           external_calendar_id, etag, last_synced_at, created_date, updated_date
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`
      ).run(id, integration.app_id, integration.id, taskSnapshot.id, found.id, calendarId, now, now, now);
      mapRow = db.prepare(`SELECT * FROM external_event_map WHERE id = ?`).get(id);
    }
  }

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
          asChangeToExistingEvent(body, taskSnapshot),
          mapRow.etag || undefined
        )
      );
    } catch (err) {
      throw pushFailed(db, integration.id, err);
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
    throw pushFailed(db, integration.id, err);
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

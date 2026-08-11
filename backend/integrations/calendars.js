// @ts-check
/**
 * @file Per-calendar mutations on `integration_calendars`:
 *   - color updates (provider-side + local mirror)
 *   - sync-enabled toggle (with imported-event cleanup on disable)
 *   - calendar-list refresh from the provider
 *   - sync-result bookkeeping (token + last_error, per-calendar and
 *     per-integration)
 *
 * Disabling a calendar is a HARD cleanup (see setEnabledCalendars
 * docstring) — purely flipping the flag was insufficient and produced
 * two user-visible bugs (orphan events lingering in the Calendar nav;
 * re-enable importing nothing because the cached sync_token was stale).
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "../http.js";
import {
  listCalendarList as listGoogleCalendarList,
  setCalendarColor as setGoogleCalendarColor,
} from "../providers/google-calendar.js";
import {
  discoverAppleCalendars,
  setCalendarColor as setAppleCalendarColor,
} from "../providers/apple-calendar.js";
import { getIntegrationForUser, listIntegrationCalendars } from "./queries.js";
import { isWritableCalendar } from "./serialize.js";
import { getFreshAccessToken } from "./google-connect.js";
import { getAppleCredentials } from "./apple-connect.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * Update a calendar's color on the provider AND in our local mirror.
 *
 * Why both:
 *   - Provider update is what the user actually sees on their other
 *     devices (other Macs, the Google Calendar mobile app, etc.).
 *   - Local update is for the next render of the Configure modal and
 *     the Calendar nav swatches — without it the new color wouldn't
 *     show until the next sync pass.
 *
 * Failure mode: if the provider call fails (network, permission, rate
 * limit) we propagate the error and DON'T touch local state, so the
 * user gets a clear error and the swatch stays in the old color until
 * a successful retry.
 *
 * @param {DB} db
 * @param {any} config
 * @param {{ appId: string, userId: string, integrationId: string,
 *           externalCalendarId: string, colorHex: string }} args
 */
export async function setCalendarColor(db, config, args) {
  const { appId, userId, integrationId, externalCalendarId, colorHex } = args;
  if (!/^#[0-9a-f]{6}$/i.test(colorHex)) {
    throw new HttpError(400, "color_hex must be #RRGGBB.", "invalid_request");
  }
  const integration = getIntegrationForUser(db, { appId, userId, id: integrationId });
  if (!integration) throw new HttpError(404, "Integration not found.", "not_found");

  const cal = /** @type {any} */ (
    db
      .prepare(
        `SELECT * FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`
      )
      .get(integrationId, externalCalendarId)
  );
  if (!cal) throw new HttpError(404, "Calendar not found on this integration.", "not_found");

  if (integration.provider === "google") {
    const accessToken = await getFreshAccessToken(db, config, integration);
    await setGoogleCalendarColor(accessToken, externalCalendarId, colorHex);
  } else if (integration.provider === "apple") {
    const creds = getAppleCredentials(db, integration);
    await setAppleCalendarColor(creds, externalCalendarId, colorHex);
  } else {
    throw new HttpError(400, `Color update not supported for provider ${integration.provider}.`, "unsupported");
  }

  // Mirror the new color locally so the UI re-paints immediately.
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE integration_calendars SET color_hex = ?, updated_date = ? WHERE id = ?`
  ).run(colorHex, now, cal.id);
}

/**
 * Refresh the integration_calendars table for an integration by calling
 * the provider's CalendarList API. Existing rows keep their sync_enabled
 * + sync_token + last_synced_at; new rows default to disabled.
 *
 * @param {DB} db
 * @param {import("../config.js").backendConfig} config
 * @param {any} integrationRow
 */
export async function refreshIntegrationCalendars(db, config, integrationRow) {
  let calendars;
  if (integrationRow.provider === "google") {
    const accessToken = await getFreshAccessToken(db, config, integrationRow);
    calendars = await listGoogleCalendarList(accessToken);
  } else if (integrationRow.provider === "apple") {
    const creds = getAppleCredentials(db, integrationRow);
    const result = await discoverAppleCalendars({ email: creds.email, password: creds.password });
    calendars = result.calendars;
  } else {
    return [];
  }
  const now = new Date().toISOString();

  for (const c of calendars) {
    const existing = /** @type {any} */ (
      db
        .prepare(
          `SELECT * FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`
        )
        .get(integrationRow.id, c.id)
    );
    if (existing) {
      db.prepare(
        `UPDATE integration_calendars SET
           summary = ?,
           description = ?,
           time_zone = ?,
           color_hex = ?,
           access_role = ?,
           primary_flag = ?,
           updated_date = ?
         WHERE id = ?`
      ).run(
        c.summary,
        c.description,
        c.timeZone,
        c.colorHex,
        c.accessRole,
        c.primary ? 1 : 0,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO integration_calendars (
           id, app_id, integration_id, external_calendar_id, summary, description,
           time_zone, color_hex, access_role, primary_flag, sync_enabled,
           created_date, updated_date
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `icl_${randomUUID()}`,
        integrationRow.app_id,
        integrationRow.id,
        c.id,
        c.summary,
        c.description,
        c.timeZone,
        c.colorHex,
        c.accessRole,
        c.primary ? 1 : 0,
        // Default the user's primary calendar to enabled on first discovery so
        // the connection isn't useless out of the box. Other calendars are
        // opt-in via the Configure modal.
        c.primary ? 1 : 0,
        now,
        now
      );
    }
  }

  return listIntegrationCalendars(db, integrationRow.id);
}

/**
 * Set the sync_enabled flag for one or many calendars. The caller's
 * payload is `{ [external_calendar_id]: boolean }` so the UI can submit
 * the whole list at once.
 *
 * Disabling a calendar is treated as a local cleanup + sync stop, not just
 * a flag flip — the previous "just turn the flag off" semantics caused two
 * user-visible bugs:
 *
 *   1. Imported events (source_kind='event') from the now-disabled
 *      calendar lingered in the local DB indefinitely. They kept
 *      showing up in the Calendar nav and the Calendar Order section
 *      of Settings even though the user had explicitly hidden the
 *      source.
 *   2. Re-enabling later didn't pull a fresh import because the per-
 *      calendar sync_token was still cached, so Google reported "no
 *      changes since last token" — but everything from before was
 *      already gone, leading to an empty calendar.
 *
 * Cleanup on disable:
 *   - DELETE imported events (tasks where source_calendar_id matches
 *     and source_kind='event'). These were never user-authored, so
 *     it's safe to drop them entirely.
 *   - DELETE only the event_map rows for those deleted imported events.
 *     Keep mappings for Zephyrly-native tasks and writable provider tasks:
 *     push.js checks sync_enabled before writing, so disabled calendars stay
 *     quiet, while the preserved map lets a later re-enable resume without
 *     creating duplicate provider events.
 *   - CLEAR sync_token so a future re-enable starts with a full
 *     initial import instead of an empty incremental delta.
 *
 * Enabling is unchanged — just flip the flag, and the next sync tick
 * picks up the calendar.
 *
 * @param {DB} db
 * @param {string} integrationId
 * @param {Record<string, boolean>} updates
 */
export function setEnabledCalendars(db, integrationId, updates) {
  const now = new Date().toISOString();
  const integration = /** @type {any} */ (
    db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(integrationId)
  );
  if (!integration) return;

  const enableStmt = db.prepare(
    `UPDATE integration_calendars
     SET sync_enabled = 1, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  );
  const disableStmt = db.prepare(
    `UPDATE integration_calendars
     SET sync_enabled = 0, sync_token = NULL, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  );
  const deleteImportedTasksStmt = db.prepare(
    `DELETE FROM tasks
     WHERE app_id = ?
       AND source_provider = ?
       AND source_calendar_id = ?
       AND source_kind = 'event'`
  );
  const deleteImportedEventMapsStmt = db.prepare(
    `DELETE FROM external_event_map
     WHERE integration_id = ?
       AND external_calendar_id = ?
       AND task_id IN (
         SELECT id FROM tasks
         WHERE app_id = ?
           AND source_provider = ?
           AND source_calendar_id = ?
           AND source_kind = 'event'
       )`
  );

  db.exec("BEGIN");
  try {
    for (const [extId, enabled] of Object.entries(updates || {})) {
      if (enabled) {
        enableStmt.run(now, integrationId, extId);
      } else {
        deleteImportedEventMapsStmt.run(
          integrationId,
          extId,
          integration.app_id,
          integration.provider,
          extId
        );
        deleteImportedTasksStmt.run(integration.app_id, integration.provider, extId);
        disableStmt.run(now, integrationId, extId);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Set whether a calendar holds tasks or events, and re-stamp the items it
 * already imported to match.
 *
 * The re-stamp is the whole point. Inbound sync is INCREMENTAL — each
 * calendar carries a sync_token and the provider only returns what changed
 * since it. Items imported before the toggle are never revisited, so
 * flipping the column alone would leave every existing row on the old
 * classification, possibly forever.
 *
 * Safety property worth naming: these are direct SQL writes, so they never
 * pass through routes/entities.js and never reach enqueueTaskPush. Changing
 * a calendar's kind reclassifies rows locally and CANNOT write anything back
 * to the user's Google or Apple calendar.
 *
 * Read-only calendars can't be marked as tasks — completing or re-dating a
 * task pushes back to the provider, which we have no access to do. Callers
 * should surface this as a 400; classify.js enforces the same rule on read.
 *
 * @param {DB} db
 * @param {string} integrationId
 * @param {string} externalCalendarId
 * @param {"task" | "event"} kind
 * @returns {{ ok: boolean, reason?: string }}
 */
export function setCalendarItemKind(db, integrationId, externalCalendarId, kind) {
  const nextKind = kind === "task" ? "task" : "event";
  const now = new Date().toISOString();

  const integration = /** @type {any} */ (
    db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(integrationId)
  );
  if (!integration) return { ok: false, reason: "not_found" };

  const calendar = /** @type {any} */ (
    db
      .prepare(
        `SELECT * FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`
      )
      .get(integrationId, externalCalendarId)
  );
  if (!calendar) return { ok: false, reason: "not_found" };

  if (nextKind === "task" && !isWritableCalendar(calendar)) {
    return { ok: false, reason: "read_only" };
  }

  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE integration_calendars
          SET item_kind = ?, updated_date = ?
        WHERE integration_id = ? AND external_calendar_id = ?`
    ).run(nextKind, now, integrationId, externalCalendarId);

    // Re-stamp what this calendar already imported. Scoped by provider +
    // calendar id so it can only ever touch rows this calendar produced —
    // Zephyrly-native tasks have an empty source_provider and are excluded.
    db.prepare(
      `UPDATE tasks
          SET source_kind = ?, updated_date = ?
        WHERE app_id = ?
          AND source_provider = ?
          AND source_calendar_id = ?`
    ).run(nextKind, now, integration.app_id, integration.provider, externalCalendarId);

    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  return { ok: true };
}

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {string} externalCalendarId
 * @param {{ syncToken?: any, error?: any }} result
 */
export function markCalendarSyncResult(db, integrationId, externalCalendarId, { syncToken, error } = {}) {
  const now = new Date().toISOString();
  if (error) {
    db.prepare(
      `UPDATE integration_calendars SET last_error = ?, updated_date = ?
       WHERE integration_id = ? AND external_calendar_id = ?`
    ).run(String(error).slice(0, 200), now, integrationId, externalCalendarId);
    return;
  }
  db.prepare(
    `UPDATE integration_calendars
     SET sync_token = ?, last_synced_at = ?, last_error = NULL, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  ).run(syncToken || null, now, now, integrationId, externalCalendarId);
}

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {string} externalCalendarId
 */
export function clearCalendarSyncToken(db, integrationId, externalCalendarId) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE integration_calendars SET sync_token = NULL, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  ).run(now, integrationId, externalCalendarId);
}

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {{ syncToken?: any, error?: any }} result
 */
export function markSyncResult(db, integrationId, { syncToken, error } = {}) {
  const now = new Date().toISOString();
  if (error) {
    db.prepare(
      `UPDATE calendar_integrations SET last_error = ?, updated_date = ? WHERE id = ?`
    ).run(String(error).slice(0, 200), now, integrationId);
    return;
  }
  db.prepare(
    `UPDATE calendar_integrations SET sync_token = ?, last_synced_at = ?, last_error = NULL, updated_date = ? WHERE id = ?`
  ).run(syncToken || null, now, now, integrationId);
}

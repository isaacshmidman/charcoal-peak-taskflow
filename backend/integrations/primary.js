// @ts-check
/**
 * @file Per-integration "primary calendar" setter. The primary calendar
 * is the destination for newly-created Zephyrly tasks pushed outbound
 * (when this integration is also the user's default — see defaults.js).
 *
 * For Google: externalCalendarId is the calendar id (e.g. "primary" or an email).
 * For Apple:  externalCalendarId is the absolute calendar URL.
 */
import { HttpError } from "../http.js";
import { getIntegrationForUser } from "./queries.js";
import { isWritableCalendar } from "./serialize.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * @param {DB} db
 * @param {{ appId: string, userId: string, integrationId: string, externalCalendarId: string }} args
 */
export function setPrimaryCalendar(db, { appId, userId, integrationId, externalCalendarId }) {
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
  if (!isWritableCalendar(cal)) {
    throw new HttpError(
      400,
      "Primary calendar must be writable.",
      "calendar_not_writable"
    );
  }

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE integration_calendars SET primary_flag = 0, updated_date = ?
       WHERE integration_id = ?`
    ).run(now, integrationId);
    db.prepare(
      `UPDATE integration_calendars SET primary_flag = 1, updated_date = ? WHERE id = ?`
    ).run(now, cal.id);
    db.prepare(
      `UPDATE calendar_integrations SET
         primary_calendar_id = ?,
         primary_calendar_timezone = ?,
         updated_date = ?
       WHERE id = ?`
    ).run(externalCalendarId, cal.time_zone || "UTC", now, integrationId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

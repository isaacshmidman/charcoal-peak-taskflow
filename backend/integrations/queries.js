// @ts-check
/**
 * @file Read-only queries against calendar_integrations + integration_calendars.
 * No mutations here — anything that writes lives in a peer module
 * (defaults.js, primary.js, calendars.js, etc.). Ownership scoping is
 * enforced by every function: pass appId + userId and the query returns
 * `null` (never a 403) if the row isn't owned by that user.
 */
import { serializeIntegration, serializeIntegrationCalendar } from "./serialize.js";
import { waitingChanges } from "../push/outbox.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * @param {DB} db
 * @param {{ appId: string, userId: string }} args
 */
export function listIntegrationsForUser(db, { appId, userId }) {
  const rows = db
    .prepare(
      `SELECT * FROM calendar_integrations WHERE app_id = ? AND user_id = ? ORDER BY created_date ASC`
    )
    .all(appId, userId);
  return rows.map((row) => ({
    ...serializeIntegration(row),
    // Changes made here that this calendar hasn't taken yet and is still
    // owed (backend/push/outbox.js). Settings shows the number.
    waiting_changes: waitingChanges(db, /** @type {any} */ (row).id),
  }));
}

/**
 * @param {DB} db
 * @param {{ appId: string, userId: string, id: string }} args
 */
export function getIntegrationForUser(db, { appId, userId, id }) {
  return db
    .prepare(
      `SELECT * FROM calendar_integrations WHERE id = ? AND app_id = ? AND user_id = ?`
    )
    .get(id, appId, userId);
}

/**
 * @param {DB} db
 * @param {string} integrationId
 */
export function listIntegrationCalendars(db, integrationId) {
  const rows = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM integration_calendars WHERE integration_id = ? ORDER BY primary_flag DESC, summary ASC`
      )
      .all(integrationId)
  );
  return rows.map(serializeIntegrationCalendar);
}

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {string} externalCalendarId
 */
export function getIntegrationCalendar(db, integrationId, externalCalendarId) {
  return db
    .prepare(
      `SELECT * FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`
    )
    .get(integrationId, externalCalendarId);
}

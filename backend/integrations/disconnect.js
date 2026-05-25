// @ts-check
/**
 * @file Disconnect an integration. Best-effort token revoke at the
 * provider, then a careful local cleanup:
 *   - Imported read-only events (source_kind='event') for this
 *     integration's calendars are deleted entirely (they were never
 *     user-authored).
 *   - Writable provider-origin tasks are KEPT but have their provider
 *     provenance stripped so they show up as plain Zephyrly tasks
 *     (instead of ghost-named items pointing at a calendar that no
 *     longer exists).
 *   - external_event_map rows for this integration are deleted.
 *   - integration_calendars + calendar_integrations rows are deleted.
 *   - If we just removed the user's default integration, promote the
 *     oldest remaining active one so they're never left without one.
 *
 * All of the above happens in a single transaction.
 */
import { HttpError } from "../http.js";
import { decryptSecret, isEncryptionAvailable } from "../crypto.js";
import { revokeToken as revokeGoogleToken } from "../providers/google-calendar.js";
import { getIntegrationForUser } from "./queries.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * @param {DB} db
 * @param {{ appId: string, userId: string, id: string }} args
 */
export async function disconnectIntegration(db, { appId, userId, id }) {
  const row = getIntegrationForUser(db, { appId, userId, id });
  if (!row) throw new HttpError(404, "Integration not found.", "not_found");

  // Best-effort revoke. We hold the refresh token (longer-lived) so prefer that.
  if (row.provider === "google" && isEncryptionAvailable()) {
    try {
      const token = row.refresh_token_enc
        ? decryptSecret(row.refresh_token_enc, row.id)
        : row.access_token_enc
          ? decryptSecret(row.access_token_enc, row.id)
          : "";
      if (token) await revokeGoogleToken(token);
    } catch {
      // ignore — we're tearing down anyway
    }
  }

  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    // Cleanup mirror of setEnabledCalendars's per-calendar disable, but at
    // the integration level: drop imported read-only events that came from
    // this integration's calendars. Without this they linger as orphans after
    // disconnect, still cluttering the Calendar nav and Settings.
    db.prepare(
      `DELETE FROM tasks
       WHERE app_id = ?
         AND source_provider = ?
         AND source_kind = 'event'
         AND source_calendar_id IN (
           SELECT external_calendar_id FROM integration_calendars WHERE integration_id = ?
         )`
    ).run(appId, row.provider, row.id);

    // Writable provider-origin tasks are real user tasks. Keep them, but strip
    // provider provenance before deleting the integration rows so the UI no
    // longer renders ghost calendar names/colors and future pushes treat them
    // as ordinary Zephyrly tasks.
    db.prepare(
      `UPDATE tasks
       SET source_provider = '',
           source_kind = '',
           source_calendar_id = '',
           source_calendar_name = '',
           source_color_hex = '',
           source_writable = 1,
           source_recurrence_rule = '',
           updated_date = ?
       WHERE app_id = ?
         AND source_provider = ?
         AND COALESCE(source_kind, '') != 'event'
         AND source_calendar_id IN (
           SELECT external_calendar_id FROM integration_calendars WHERE integration_id = ?
         )`
    ).run(now, appId, row.provider, row.id);

    db.prepare(`DELETE FROM external_event_map WHERE integration_id = ?`).run(row.id);
    db.prepare(`DELETE FROM integration_calendars WHERE integration_id = ?`).run(row.id);
    db.prepare(`DELETE FROM calendar_integrations WHERE id = ?`).run(row.id);

    // If we just removed the default, promote the oldest remaining active integration
    // so the user is never left without one.
    if (row.is_default) {
      const next = /** @type {any} */ (
        db
          .prepare(
            `SELECT id FROM calendar_integrations
             WHERE app_id = ? AND user_id = ? AND status = 'active'
             ORDER BY created_date ASC LIMIT 1`
          )
          .get(appId, userId)
      );
      if (next) {
        db.prepare(
          `UPDATE calendar_integrations SET is_default = 1, updated_date = ? WHERE id = ?`
        ).run(now, next.id);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

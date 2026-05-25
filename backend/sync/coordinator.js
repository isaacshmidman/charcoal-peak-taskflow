// @ts-check
/**
 * @file syncIntegration entrypoint — dispatches to the Google or Apple
 * inbound runner based on the integration's provider. Called by the
 * tick loop (state.js → runAllDueSyncs) and the manual-trigger HTTP
 * route in server.js.
 */
import {
  getFreshAccessToken,
  refreshIntegrationCalendars,
  markSyncResult,
  markCalendarSyncResult,
} from "../integrations.js";
import { buildUserForSync } from "../sync-user.js";
import { backfillGoogleEventMetadata } from "../google-metadata-backfill.js";
import { log } from "../log.js";
import { syncOneCalendar } from "./google-inbound.js";
import { syncAppleIntegration } from "./apple-inbound.js";

/**
 * Sync one integration. Iterates each enabled calendar and pulls changes.
 * Exported for the manual-trigger route.
 */
export async function syncIntegration(db, config, integrationRow) {
  if (integrationRow.provider === "apple") {
    return syncAppleIntegration(db, config, integrationRow);
  }
  if (integrationRow.provider !== "google") {
    return;
  }

  // Make sure we have a CalendarList row for every provider calendar so
  // newly-shared calendars appear in the Configure modal even before the
  // user opens it. Best-effort: failures here are non-fatal.
  try {
    await refreshIntegrationCalendars(db, config, integrationRow);
  } catch (err) {
    // Often a 403 quota or transient network blip — just continue with
    // whatever calendars we have on record.
    log.warn(
      `[sync] refresh calendars for integration ${integrationRow.id} failed: ${err.message}`
    );
  }

  // Build the synthetic user object store.js needs to write tasks on
  // behalf of this integration's owner.
  const user = buildUserForSync(db, integrationRow);
  if (!user) {
    markSyncResult(db, integrationRow.id, { error: "Owner user not found" });
    return;
  }

  const calendars = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT * FROM integration_calendars WHERE integration_id = ? AND sync_enabled = 1`
      )
      .all(integrationRow.id)
  );

  if (calendars.length === 0) {
    // Nothing the user wants synced — clear last_error and bail. The user
    // will pick calendars via the Configure modal.
    markSyncResult(db, integrationRow.id, {});
    return;
  }

  let accessToken;
  try {
    accessToken = await getFreshAccessToken(db, config, integrationRow);
  } catch (err) {
    markSyncResult(db, integrationRow.id, { error: err.message });
    throw err;
  }

  try {
    const backfill = await backfillGoogleEventMetadata(db, {
      integration: integrationRow,
      accessToken,
    });
    if (backfill.errors) {
      log.warn(
        `[sync] Google metadata backfill for integration ${integrationRow.id}: ${backfill.lastError}`
      );
    }
  } catch (err) {
    log.warn(
      `[sync] Google metadata backfill for integration ${integrationRow.id} failed: ${err.message}`
    );
  }

  for (const cal of calendars) {
    try {
      await syncOneCalendar(db, config, {
        integration: integrationRow,
        accessToken,
        user,
        calendarRow: cal,
      });
    } catch (err) {
      // Per-calendar failure shouldn't abort other calendars on the same
      // integration.
      markCalendarSyncResult(db, integrationRow.id, cal.external_calendar_id, {
        error: err.message,
      });
      log.warn(
        `[sync] calendar ${cal.external_calendar_id} on integration ${integrationRow.id}: ${err.message}`
      );
    }
  }

  // Top-level integration last_synced_at updates whenever any of its
  // calendars completed a tick. The per-calendar syncToken is what we
  // actually use for incremental fetching.
  markSyncResult(db, integrationRow.id, {});
}

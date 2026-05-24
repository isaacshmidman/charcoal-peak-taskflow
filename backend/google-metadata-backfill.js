// @ts-check
/**
 * @file PER-SYNC BACKFILL.
 * Runs on every sync cycle (called from backend/sync.js) to patch older
 * Google events that lack Zephyrly's `extendedProperties` metadata. Safe
 * to keep indefinitely — short-circuits when the metadata is already
 * present, so the steady-state cost is roughly zero per tick.
 */
import {
  getEvent as getGoogleEvent,
  updateEvent as updateGoogleEvent,
} from "./providers/google-calendar.js";

const DEFAULT_BATCH_LIMIT = 25;

/**
 * Older outbound Google events were created before Zephyrly wrote private
 * extendedProperties. Backfill those mapped native tasks so a future lost map
 * row can be relinked during inbound sync instead of imported as a duplicate.
 *
 * @param {import("node:sqlite").DatabaseSync} db
 * @param {{
 *   integration: any,
 *   accessToken: string,
 *   limit?: number,
 * }} ctx
 */
export async function backfillGoogleEventMetadata(db, { integration, accessToken, limit = DEFAULT_BATCH_LIMIT }) {
  if (!integration || integration.provider !== "google" || !accessToken) {
    return emptyResult();
  }

  const rows = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT m.*
         FROM external_event_map m
         JOIN tasks t ON t.id = m.task_id AND t.app_id = m.app_id
         LEFT JOIN integration_calendars ic
           ON ic.integration_id = m.integration_id
          AND ic.external_calendar_id = m.external_calendar_id
         WHERE m.integration_id = ?
           AND COALESCE(m.zephyrly_metadata_synced_at, '') = ''
           AND COALESCE(t.source_provider, '') = ''
           AND COALESCE(t.due_date, '') != ''
           AND (ic.id IS NULL OR ic.sync_enabled = 1)
           AND (ic.id IS NULL OR COALESCE(ic.access_role, '') IN ('owner', 'writer', ''))
         ORDER BY m.created_date ASC
         LIMIT ?`
      )
      .all(integration.id, Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH_LIMIT, 100)))
  );

  const result = emptyResult();
  for (const row of rows) {
    result.checked += 1;
    try {
      const outcome = await backfillOne(db, { accessToken, row });
      result[outcome] += 1;
    } catch (err) {
      result.errors += 1;
      result.lastError = String(err?.message || err);
      const status = /** @type {any} */ (err)?.statusCode;
      if (status === 429 || (status >= 500 && status < 600)) {
        break;
      }
    }
  }
  return result;
}

function emptyResult() {
  return {
    checked: 0,
    patched: 0,
    alreadyTagged: 0,
    skipped: 0,
    deleted: 0,
    errors: 0,
    lastError: "",
  };
}

async function backfillOne(db, { accessToken, row }) {
  const event = await getGoogleEvent(
    accessToken,
    row.external_calendar_id,
    row.external_event_id
  );
  if (event.status === 404 || event.status === 410) {
    db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(row.id);
    return "deleted";
  }

  const privateProps = { ...(event.extendedProperties?.private || {}) };
  const existingTaskId = String(privateProps.zephyrlyTaskId || "");
  const existingAppId = String(privateProps.zephyrlyAppId || "");
  if (existingTaskId && existingTaskId !== String(row.task_id)) {
    return "skipped";
  }
  if (existingAppId && existingAppId !== String(row.app_id)) {
    return "skipped";
  }

  if (
    existingTaskId === String(row.task_id) &&
    existingAppId === String(row.app_id)
  ) {
    markMetadataSynced(db, row, event.etag || row.etag || null);
    return "alreadyTagged";
  }

  const patch = {
    extendedProperties: {
      private: {
        ...privateProps,
        zephyrlyTaskId: String(row.task_id),
        zephyrlyAppId: String(row.app_id),
      },
    },
  };

  const updated = await updateGoogleEvent(
    accessToken,
    row.external_calendar_id,
    row.external_event_id,
    patch,
    event.etag || row.etag || undefined
  );
  if (updated.status === 404 || updated.status === 410) {
    db.prepare(`DELETE FROM external_event_map WHERE id = ?`).run(row.id);
    return "deleted";
  }

  markMetadataSynced(db, row, updated.etag || event.etag || row.etag || null);
  return "patched";
}

function markMetadataSynced(db, row, etag) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE external_event_map
     SET etag = ?,
         zephyrly_metadata_synced_at = ?,
         last_synced_at = ?,
         updated_date = ?
     WHERE id = ?`
  ).run(etag, now, now, now, row.id);
}

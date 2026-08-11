// @ts-check
/**
 * @file Row → API-safe object serializers. NEVER include encrypted blobs
 * or decrypted tokens. Also hosts `isWritableCalendar` — used both by
 * `serializeIntegrationCalendar` (for the `writable` field) and by
 * `primary.js` (to enforce that the primary calendar can be written to).
 */

/**
 * Serialize an integration row for the API.
 * @param {any} row
 */
export function serializeIntegration(row) {
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    external_account_email: row.external_account_email,
    status: row.status,
    scopes: row.scopes,
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    is_default: !!row.is_default,
    primary_calendar_id: row.primary_calendar_id,
    created_date: row.created_date,
    updated_date: row.updated_date,
  };
}

/**
 * Serialize an integration_calendars row for the API.
 * @param {any} row
 */
export function serializeIntegrationCalendar(row) {
  if (!row) return null;
  return {
    id: row.id,
    integration_id: row.integration_id,
    external_calendar_id: row.external_calendar_id,
    summary: row.summary,
    description: row.description,
    time_zone: row.time_zone,
    color_hex: row.color_hex,
    access_role: row.access_role,
    primary: !!row.primary_flag,
    sync_enabled: !!row.sync_enabled,
    item_kind: row.item_kind === "task" ? "task" : "event",
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    writable: isWritableCalendar(row),
  };
}

/**
 * Internal helper — does the user have write access on this calendar?
 * Exported so sibling modules (notably primary.js) can reuse without
 * duplicating the role check.
 * @param {any} row
 * @returns {boolean}
 */
export function isWritableCalendar(row) {
  return row?.access_role === "owner" || row?.access_role === "writer";
}

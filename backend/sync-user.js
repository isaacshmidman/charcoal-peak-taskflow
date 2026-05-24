// @ts-check
/**
 * @file SYNC AUTHORIZATION HELPER.
 * Builds a user payload suitable for passing into store.js entity calls
 * on behalf of a sync job. Mirrors the shape produced by
 * `auth.requireAuthenticatedUser` so the authorization scope clauses in
 * store.js continue to apply. Sole consumer: backend/sync.js.
 */

export function buildUserForSync(db, integrationRow) {
  const row = db
    .prepare(`SELECT * FROM users WHERE id = ? AND app_id = ?`)
    .get(integrationRow.user_id, integrationRow.app_id);
  if (!row) return null;
  return {
    id: row.id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    full_name: row.full_name || "",
    email: row.email,
    role: row.role || "user",
    auth_provider: row.auth_provider || "local",
    avatar_url: row.avatar_url || "",
    preferences: row.preferences_json ? JSON.parse(row.preferences_json) : {},
  };
}

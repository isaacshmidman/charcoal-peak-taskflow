// @ts-check
/**
 * @file Default-integration management. The `is_default` flag controls
 * which integration receives outbound pushes for newly-created tasks;
 * we keep it on exactly one integration per (app, user) at any time.
 */
import { HttpError } from "../http.js";
import { getIntegrationForUser } from "./queries.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * If the user has no default integration yet, mark the given one as default.
 * Idempotent.
 *
 * @param {DB} db
 * @param {{ appId: string, userId: string, integrationId: string }} args
 */
export function ensureDefaultIntegration(db, { appId, userId, integrationId }) {
  const existing = /** @type {any} */ (
    db
      .prepare(
        `SELECT id FROM calendar_integrations
         WHERE app_id = ? AND user_id = ? AND status = 'active' AND is_default = 1
         LIMIT 1`
      )
      .get(appId, userId)
  );
  if (existing) return;
  db.prepare(
    `UPDATE calendar_integrations SET is_default = 1, updated_date = ? WHERE id = ?`
  ).run(new Date().toISOString(), integrationId);
}

/**
 * Mark exactly one of the user's integrations as default. Clears the flag
 * on every other row of theirs in a single transaction.
 *
 * @param {DB} db
 * @param {{ appId: string, userId: string, integrationId: string }} args
 */
export function setDefaultIntegration(db, { appId, userId, integrationId }) {
  const target = getIntegrationForUser(db, { appId, userId, id: integrationId });
  if (!target) throw new HttpError(404, "Integration not found.", "not_found");
  const now = new Date().toISOString();
  db.exec("BEGIN");
  try {
    db.prepare(
      `UPDATE calendar_integrations SET is_default = 0, updated_date = ?
       WHERE app_id = ? AND user_id = ?`
    ).run(now, appId, userId);
    db.prepare(
      `UPDATE calendar_integrations SET is_default = 1, updated_date = ? WHERE id = ?`
    ).run(now, integrationId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

// @ts-check
/**
 * @file Tiny helpers that mutate `calendar_integrations.last_error` after
 * a push attempt. Kept separate so the runners (push/google.js,
 * push/apple.js) can both import them without going through state.js.
 */

/** @typedef {import("node:sqlite").DatabaseSync} DB */

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {unknown} err
 */
export function markPushError(db, integrationId, err) {
  const msg = String((err && /** @type {any} */ (err).message) || "push_failed").slice(0, 200);
  db.prepare(
    `UPDATE calendar_integrations SET last_error = ?, updated_date = ? WHERE id = ?`
  ).run(msg, new Date().toISOString(), integrationId);
}

/**
 * Note the failure on the connection and hand the error back, to be thrown:
 * the queue needs to know the change didn't arrive, so it can keep it and
 * try again (push/outbox.js).
 *
 * @param {DB} db
 * @param {string} integrationId
 * @param {unknown} err
 * @returns {Error}
 */
export function pushFailed(db, integrationId, err) {
  markPushError(db, integrationId, err);
  return err instanceof Error ? err : new Error(String(err || "push_failed"));
}

/**
 * @param {DB} db
 * @param {string} integrationId
 */
export function markPushOk(db, integrationId) {
  // Don't clobber last_synced_at (that's for inbound sync). Just clear any
  // lingering last_error when the most recent push succeeded.
  db.prepare(
    `UPDATE calendar_integrations SET last_error = NULL, updated_date = ? WHERE id = ?`
  ).run(new Date().toISOString(), integrationId);
}

/**
 * Run an async fn with up to 2 retries on 429 / 5xx, with exponential
 * backoff: the provider answered, and said "not now". Everything else
 * propagates at once, a provider that couldn't be reached included (asking
 * again immediately would only hold the queue up); the outbox tries the
 * change again later.
 *
 * @template T
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withRetry(fn) {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      const status = /** @type {any} */ (err)?.statusCode;
      const retryable = !(/** @type {any} */ (err)?.unreachable) && (status === 429 || (status >= 500 && status < 600));
      if (!retryable || attempt >= 2) throw err;
      const delay = 500 * Math.pow(2, attempt) + Math.random() * 200;
      await new Promise((r) => {
        const t = setTimeout(r, delay);
        t.unref?.();
      });
      attempt++;
    }
  }
}

/**
 * Shared "is sync disabled for this calendar?" gate that both the Google
 * and Apple runners consult before writing.
 *
 * @param {DB} db
 * @param {string} integrationId
 * @param {string | null | undefined} externalCalendarId
 * @returns {boolean}
 */
export function isCalendarSyncDisabled(db, integrationId, externalCalendarId) {
  if (!externalCalendarId) return false;
  const row = /** @type {any} */ (
    db
      .prepare(
        `SELECT sync_enabled FROM integration_calendars
         WHERE integration_id = ? AND external_calendar_id = ?`
      )
      .get(integrationId, externalCalendarId)
  );
  return !!row && Number(row.sync_enabled) === 0;
}

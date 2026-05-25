// @ts-check
/**
 * @file Google Calendar integration: OAuth start, OAuth completion,
 * and fresh-access-token retrieval (with automatic refresh).
 *
 * Singleton: `refreshLocks` (Map<integrationId, Promise>) — keeps two
 * concurrent sync cycles from racing the same integration's token
 * refresh. MUST live in exactly one module — only `getFreshAccessToken`
 * mutates it.
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "../http.js";
import {
  decryptSecret,
  encryptSecret,
} from "../crypto.js";
import {
  buildAuthUrl as buildGoogleAuthUrl,
  exchangeCode as exchangeGoogleCode,
  refreshAccessToken as refreshGoogleAccessToken,
  getCalendarMeta as getGoogleCalendarMeta,
} from "../providers/google-calendar.js";
import { ensureIntegrationsRuntimeReady } from "./runtime.js";
import { ensureDefaultIntegration } from "./defaults.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

const REFRESH_LEAD_MS = 60 * 1000; // refresh if token expires in < 60s

// In-process mutex so concurrent sync cycles don't both try to refresh the
// same integration at once. Keyed by integration id.
/** @type {Map<string, Promise<void>>} */
const refreshLocks = new Map();

/**
 * Start the Google Calendar OAuth flow for an authenticated user.
 * Persists an oauth_states row bound to this user — the callback verifies.
 */
export function startGoogleConnect(db, config, { user, appId, fromUrl }) {
  ensureIntegrationsRuntimeReady(config);
  if (!config.hasGoogleCalendarCredentials) {
    throw new HttpError(
      503,
      "Google Calendar client credentials are not configured on this backend.",
      "google_calendar_not_configured"
    );
  }

  const { authUrl, stateRow } = buildGoogleAuthUrl(config, {
    userId: user.id,
    appId,
    fromUrl,
  });
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  db.prepare(
    `INSERT INTO oauth_states (id, app_id, provider, from_url, code_verifier, expires_at, created_date, kind, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    stateRow.id,
    stateRow.app_id,
    stateRow.provider,
    stateRow.from_url,
    stateRow.code_verifier,
    expiresAt,
    new Date().toISOString(),
    stateRow.kind,
    stateRow.user_id
  );

  return { authUrl };
}

/**
 * Complete the Google Calendar OAuth callback.
 *
 * Security checks:
 *   - State row must exist, unexpired, kind='integration', provider='google'.
 *   - State row's user_id must match the currently-authenticated user. This
 *     prevents a "callback hijack" where an attacker sends a victim a URL
 *     containing a pre-minted state id.
 *   - Scope must include calendar.events (enforced inside exchangeCode).
 *
 * @returns {Promise<{ integrationId: string, redirectTo: string }>}
 */
export async function completeGoogleConnect(db, config, { user, state, code }) {
  ensureIntegrationsRuntimeReady(config);

  const row = db
    .prepare(
      `SELECT * FROM oauth_states WHERE id = ? AND provider = 'google' AND kind = 'integration' AND expires_at > ?`
    )
    .get(state, new Date().toISOString());
  if (!row) {
    throw new HttpError(400, "OAuth state is invalid or expired.", "invalid_oauth_state");
  }
  if (row.user_id !== user.id) {
    // Don't reveal WHY we rejected — generic 400.
    throw new HttpError(400, "OAuth state does not match the current session.", "oauth_state_mismatch");
  }

  const result = await exchangeGoogleCode(config, {
    code,
    codeVerifier: row.code_verifier || "",
  });

  if (!result.refreshToken) {
    // Google only issues refresh tokens on first consent (or with prompt=consent).
    // If we didn't get one, sync will break silently after 1 hour. Reject up front.
    throw new HttpError(
      400,
      "Google did not return a refresh token. Disconnect this app at https://myaccount.google.com/permissions and reconnect to grant offline access.",
      "no_refresh_token"
    );
  }

  // Delete the used state row (whether or not insert succeeds — it's consumed).
  db.prepare(`DELETE FROM oauth_states WHERE id = ?`).run(state);

  // Fetch the primary calendar's timezone so we can push timed events
  // correctly. If this fails we fall back to UTC — sync still works.
  let primaryCalendarId = "primary";
  let primaryCalendarTimezone = "UTC";
  try {
    const meta = await getGoogleCalendarMeta(result.accessToken, "primary");
    primaryCalendarId = meta.id || "primary";
    primaryCalendarTimezone = meta.timeZone || "UTC";
  } catch {
    // Non-fatal — we'll retry on first sync.
  }

  const integrationId = `intg_${randomUUID()}`;
  const now = new Date().toISOString();

  // Check whether the user already has an integration for this Google account
  // — if so, update tokens in place rather than create a duplicate.
  const existing = db
    .prepare(
      `SELECT * FROM calendar_integrations
       WHERE app_id = ? AND user_id = ? AND provider = 'google' AND external_account_id = ?`
    )
    .get(row.app_id, user.id, result.account.sub);

  if (existing) {
    db.prepare(
      `UPDATE calendar_integrations SET
         access_token_enc = ?,
         refresh_token_enc = ?,
         token_expires_at = ?,
         scopes = ?,
         external_account_email = ?,
         primary_calendar_id = ?,
         primary_calendar_timezone = ?,
         status = 'active',
         last_error = NULL,
         updated_date = ?
       WHERE id = ?`
    ).run(
      encryptSecret(result.accessToken, existing.id),
      encryptSecret(result.refreshToken, existing.id),
      result.expiresAt,
      result.scope,
      result.account.email,
      primaryCalendarId,
      primaryCalendarTimezone,
      now,
      existing.id
    );
    ensureDefaultIntegration(db, { appId: row.app_id, userId: user.id, integrationId: existing.id });
    return { integrationId: existing.id, redirectTo: row.from_url };
  }

  db.prepare(
    `INSERT INTO calendar_integrations (
       id, app_id, user_id, provider, external_account_id, external_account_email,
       access_token_enc, refresh_token_enc, token_expires_at, scopes,
       primary_calendar_id, primary_calendar_timezone, sync_token, last_synced_at, last_error, status,
       created_date, updated_date
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    integrationId,
    row.app_id,
    user.id,
    "google",
    result.account.sub,
    result.account.email,
    encryptSecret(result.accessToken, integrationId),
    encryptSecret(result.refreshToken, integrationId),
    result.expiresAt,
    result.scope,
    primaryCalendarId,
    primaryCalendarTimezone,
    null,
    null,
    null,
    "active",
    now,
    now
  );

  ensureDefaultIntegration(db, { appId: row.app_id, userId: user.id, integrationId });
  return { integrationId, redirectTo: row.from_url };
}

/**
 * Return a valid access token for an integration, refreshing if near expiry.
 * Uses an in-process lock so concurrent callers serialize the refresh.
 *
 * On invalid_grant (user revoked at Google), marks the integration
 * `needs_reauth` and throws.
 *
 * @param {DB} db
 * @param {import("../config.js").backendConfig} config
 * @param {any} integrationRow
 * @returns {Promise<string>} access token
 */
export async function getFreshAccessToken(db, config, integrationRow) {
  const existingLock = refreshLocks.get(integrationRow.id);
  if (existingLock) await existingLock;

  // Re-read row in case another process refreshed it while we waited.
  const row = /** @type {any} */ (
    db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(integrationRow.id)
  );
  if (!row) throw new Error("Integration row disappeared during refresh");

  const expiresAt = row.token_expires_at ? Date.parse(row.token_expires_at) : 0;
  const needsRefresh = !row.access_token_enc || Date.now() + REFRESH_LEAD_MS >= expiresAt;
  if (!needsRefresh) {
    return decryptSecret(row.access_token_enc, row.id);
  }
  if (!row.refresh_token_enc) {
    db.prepare(
      `UPDATE calendar_integrations SET status = 'needs_reauth', last_error = 'no refresh token', updated_date = ? WHERE id = ?`
    ).run(new Date().toISOString(), row.id);
    throw new Error("No refresh token available; user must reconnect");
  }

  const lock = (async () => {
    const refreshToken = decryptSecret(row.refresh_token_enc, row.id);
    try {
      const fresh = await refreshGoogleAccessToken(config, refreshToken);
      const now = new Date().toISOString();
      db.prepare(
        `UPDATE calendar_integrations SET
           access_token_enc = ?,
           refresh_token_enc = ?,
           token_expires_at = ?,
           status = 'active',
           last_error = NULL,
           updated_date = ?
         WHERE id = ?`
      ).run(
        encryptSecret(fresh.accessToken, row.id),
        fresh.refreshToken
          ? encryptSecret(fresh.refreshToken, row.id)
          : row.refresh_token_enc,
        fresh.expiresAt,
        now,
        row.id
      );
    } catch (err) {
      const status = /** @type {any} */ (err).statusCode;
      if (status === 400 || status === 401) {
        db.prepare(
          `UPDATE calendar_integrations SET status = 'needs_reauth', last_error = ?, updated_date = ? WHERE id = ?`
        ).run(String(err.message || "invalid_grant").slice(0, 200), new Date().toISOString(), row.id);
      } else {
        db.prepare(
          `UPDATE calendar_integrations SET last_error = ?, updated_date = ? WHERE id = ?`
        ).run(String(err.message || "refresh_failed").slice(0, 200), new Date().toISOString(), row.id);
      }
      throw err;
    }
  })();

  refreshLocks.set(row.id, lock);
  try {
    await lock;
  } finally {
    refreshLocks.delete(row.id);
  }

  const refreshed = /** @type {any} */ (
    db.prepare(`SELECT access_token_enc FROM calendar_integrations WHERE id = ?`).get(row.id)
  );
  return decryptSecret(refreshed.access_token_enc, row.id);
}

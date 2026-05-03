// @ts-check
/**
 * Calendar integrations: connect / disconnect / list / ensure-fresh-token.
 *
 * All rows are scoped by (app_id, user_id). Any route that touches an
 * integration MUST pass both, and the helpers enforce that the caller owns
 * the row — otherwise queries return null and the route returns 404 (never
 * 403, to avoid leaking existence).
 *
 * Tokens are encrypted with AES-256-GCM using the integration id as AAD
 * so ciphertext blobs can't be swapped between rows.
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "./http.js";
import {
  decryptSecret,
  encryptSecret,
  isEncryptionAvailable,
  getEncryptionUnavailableReason,
} from "./crypto.js";
import {
  buildAuthUrl as buildGoogleAuthUrl,
  exchangeCode as exchangeGoogleCode,
  refreshAccessToken as refreshGoogleAccessToken,
  revokeToken as revokeGoogleToken,
  getCalendarMeta as getGoogleCalendarMeta,
  listCalendarList as listGoogleCalendarList,
  setCalendarColor as setGoogleCalendarColor,
} from "./providers/google-calendar.js";
import {
  discoverAppleCalendars,
  setCalendarColor as setAppleCalendarColor,
} from "./providers/apple-calendar.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

const REFRESH_LEAD_MS = 60 * 1000; // refresh if token expires in < 60s

// In-process mutex so concurrent sync cycles don't both try to refresh the
// same integration at once. Keyed by integration id.
/** @type {Map<string, Promise<void>>} */
const refreshLocks = new Map();

export function ensureIntegrationsRuntimeReady(config) {
  if (!config.integrationsEnabled) {
    throw new HttpError(
      503,
      "Calendar integrations are disabled on this backend.",
      "integrations_disabled"
    );
  }
  if (!isEncryptionAvailable()) {
    throw new HttpError(
      503,
      `Calendar integrations unavailable: ${getEncryptionUnavailableReason()}`,
      "encryption_key_missing"
    );
  }
}

/**
 * Serialize an integration row for the API (NEVER include encrypted blobs
 * or decrypted tokens).
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

/**
 * Set the primary calendar for an integration. The provider's primary calendar
 * is where new locally-created tasks get pushed (when this integration is the
 * default). Existing mapped events continue round-tripping on whatever calendar
 * they came from.
 *
 * For Google: externalCalendarId is the calendar id (e.g. "primary" or an email).
 * For Apple:  externalCalendarId is the absolute calendar URL.
 *
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

/**
 * Update a calendar's color on the provider AND in our local mirror.
 *
 * Why both:
 *   - Provider update is what the user actually sees on their other
 *     devices (other Macs, the Google Calendar mobile app, etc.).
 *   - Local update is for the next render of the Configure modal and
 *     the Calendar nav swatches — without it the new color wouldn't
 *     show until the next sync pass.
 *
 * Failure mode: if the provider call fails (network, permission, rate
 * limit) we propagate the error and DON'T touch local state, so the
 * user gets a clear error and the swatch stays in the old color until
 * a successful retry.
 *
 * @param {DB} db
 * @param {any} config
 * @param {{ appId: string, userId: string, integrationId: string,
 *           externalCalendarId: string, colorHex: string }} args
 */
export async function setCalendarColor(db, config, args) {
  const { appId, userId, integrationId, externalCalendarId, colorHex } = args;
  if (!/^#[0-9a-f]{6}$/i.test(colorHex)) {
    throw new HttpError(400, "color_hex must be #RRGGBB.", "invalid_request");
  }
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

  if (integration.provider === "google") {
    const accessToken = await getFreshAccessToken(db, config, integration);
    await setGoogleCalendarColor(accessToken, externalCalendarId, colorHex);
  } else if (integration.provider === "apple") {
    const creds = getAppleCredentials(db, integration);
    await setAppleCalendarColor(creds, externalCalendarId, colorHex);
  } else {
    throw new HttpError(400, `Color update not supported for provider ${integration.provider}.`, "unsupported");
  }

  // Mirror the new color locally so the UI re-paints immediately.
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE integration_calendars SET color_hex = ?, updated_date = ? WHERE id = ?`
  ).run(colorHex, now, cal.id);
}

export function listIntegrationsForUser(db, { appId, userId }) {
  const rows = db
    .prepare(
      `SELECT * FROM calendar_integrations WHERE app_id = ? AND user_id = ? ORDER BY created_date ASC`
    )
    .all(appId, userId);
  return rows.map(serializeIntegration);
}

export function getIntegrationForUser(db, { appId, userId, id }) {
  return db
    .prepare(
      `SELECT * FROM calendar_integrations WHERE id = ? AND app_id = ? AND user_id = ?`
    )
    .get(id, appId, userId);
}

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
 * Connect an Apple iCloud Calendar account using an Apple ID + app-specific
 * password. We probe CalDAV synchronously to verify the credentials and
 * discover the principal, calendar home, and full calendar list before
 * persisting anything — failed probes never write to the database.
 *
 * Storage:
 *   - external_account_id      = the Apple ID (lowercased)
 *   - external_account_email   = the Apple ID (display copy)
 *   - refresh_token_enc        = the app-specific password (encrypted)
 *   - access_token_enc         = NULL  (CalDAV uses Basic auth every call)
 *   - token_expires_at         = NULL  (no token to expire)
 *   - primary_calendar_id      = absolute URL of the primary calendar
 *   - primary_calendar_timezone= timezone of that calendar (or UTC fallback)
 *   - scopes                   = "caldav"  (informational)
 *
 * @param {DB} db
 * @param {import("./config.js").backendConfig} config
 * @param {{ user: any, appId: string, email: string, password: string }} args
 */
export async function connectApple(db, config, { user, appId, email, password }) {
  ensureIntegrationsRuntimeReady(config);

  const normalizedEmail = String(email || "").trim().toLowerCase();
  const cleanedPassword = String(password || "").replace(/\s+/g, "");
  if (!normalizedEmail || !cleanedPassword) {
    throw new HttpError(400, "Apple ID and app-specific password are required.", "invalid_credentials");
  }
  if (!/.+@.+\..+/.test(normalizedEmail)) {
    throw new HttpError(400, "Apple ID must be an email address.", "invalid_credentials");
  }

  let discovered;
  try {
    discovered = await discoverAppleCalendars({ email: normalizedEmail, password: cleanedPassword });
  } catch (err) {
    const status = /** @type {any} */ (err).statusCode;
    if (status === 401) {
      throw new HttpError(
        401,
        "Apple Calendar rejected the credentials. Generate a new app-specific password at appleid.apple.com and try again.",
        "invalid_credentials"
      );
    }
    throw new HttpError(
      502,
      `Couldn't reach iCloud CalDAV: ${String(err.message || err).slice(0, 200)}`,
      "caldav_unreachable"
    );
  }

  const primary = discovered.calendars.find((c) => c.primary) || discovered.calendars[0] || null;
  const now = new Date().toISOString();

  // Existing row? Update credentials + origin in place.
  const existing = /** @type {any} */ (
    db
      .prepare(
        `SELECT * FROM calendar_integrations
         WHERE app_id = ? AND user_id = ? AND provider = 'apple' AND external_account_id = ?`
      )
      .get(appId, user.id, normalizedEmail)
  );

  let integrationId;
  if (existing) {
    integrationId = existing.id;
    db.prepare(
      `UPDATE calendar_integrations SET
         refresh_token_enc = ?,
         access_token_enc = NULL,
         token_expires_at = NULL,
         scopes = 'caldav',
         external_account_email = ?,
         primary_calendar_id = ?,
         primary_calendar_timezone = ?,
         status = 'active',
         last_error = NULL,
         updated_date = ?
       WHERE id = ?`
    ).run(
      encryptSecret(cleanedPassword, existing.id),
      normalizedEmail,
      primary?.url || null,
      primary?.timeZone || "UTC",
      now,
      existing.id
    );
  } else {
    integrationId = `intg_${randomUUID()}`;
    db.prepare(
      `INSERT INTO calendar_integrations (
         id, app_id, user_id, provider, external_account_id, external_account_email,
         access_token_enc, refresh_token_enc, token_expires_at, scopes,
         primary_calendar_id, primary_calendar_timezone, sync_token, last_synced_at, last_error, status,
         created_date, updated_date
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      integrationId,
      appId,
      user.id,
      "apple",
      normalizedEmail,
      normalizedEmail,
      null,
      encryptSecret(cleanedPassword, integrationId),
      null,
      "caldav",
      primary?.url || null,
      primary?.timeZone || "UTC",
      null,
      null,
      null,
      "active",
      now,
      now
    );
  }

  // Seed integration_calendars from the discovery result so the user's
  // Configure modal works immediately (no extra round trip needed).
  for (const c of discovered.calendars) {
    const exists = /** @type {any} */ (
      db
        .prepare(
          `SELECT id FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`
        )
        .get(integrationId, c.id)
    );
    if (exists) {
      db.prepare(
        `UPDATE integration_calendars SET
           summary = ?, description = ?, time_zone = ?, color_hex = ?,
           access_role = ?, primary_flag = ?, updated_date = ?
         WHERE id = ?`
      ).run(
        c.summary,
        c.description,
        c.timeZone,
        c.colorHex,
        c.accessRole,
        c.primary ? 1 : 0,
        now,
        exists.id
      );
    } else {
      db.prepare(
        `INSERT INTO integration_calendars (
           id, app_id, integration_id, external_calendar_id, summary, description,
           time_zone, color_hex, access_role, primary_flag, sync_enabled,
           created_date, updated_date
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `icl_${randomUUID()}`,
        appId,
        integrationId,
        c.id,
        c.summary,
        c.description,
        c.timeZone,
        c.colorHex,
        c.accessRole,
        c.primary ? 1 : 0,
        // Same default-on-primary policy as Google.
        c.primary ? 1 : 0,
        now,
        now
      );
    }
  }

  ensureDefaultIntegration(db, { appId, userId: user.id, integrationId });
  return { integrationId };
}

/**
 * Decrypt the Apple app-specific password for an integration row and return
 * the auth context CalDAV requests need. Discovers the redirected CalDAV
 * origin on every call (cheap PROPFIND) so we don't have to persist it.
 *
 * @param {DB} db
 * @param {any} integrationRow
 * @returns {{ email: string, password: string, origin: string }}
 */
export function getAppleCredentials(db, integrationRow) {
  void db;
  if (!integrationRow.refresh_token_enc) {
    throw new Error("Apple integration is missing its credential blob.");
  }
  const password = decryptSecret(integrationRow.refresh_token_enc, integrationRow.id);
  return {
    email: String(integrationRow.external_account_email || ""),
    password,
    // Filled in lazily by the sync path on the first request — see
    // ensureAppleOrigin in sync.js.
    origin: "https://caldav.icloud.com",
  };
}

/**
 * Disconnect an integration. Revokes the token at Google (best effort), drops
 * imported read-only events from Zephyrly, localizes kept provider-origin tasks,
 * then deletes the row + event maps. Zephyrly-native tasks stay untouched.
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

/**
 * Return a valid access token for an integration, refreshing if near expiry.
 * Uses an in-process lock so concurrent callers serialize the refresh.
 *
 * On invalid_grant (user revoked at Google), marks the integration
 * `needs_reauth` and throws.
 *
 * @param {DB} db
 * @param {import("./config.js").backendConfig} config
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

/**
 * Refresh the integration_calendars table for an integration by calling
 * the provider's CalendarList API. Existing rows keep their sync_enabled
 * + sync_token + last_synced_at; new rows default to disabled.
 *
 * @param {DB} db
 * @param {import("./config.js").backendConfig} config
 * @param {any} integrationRow
 */
export async function refreshIntegrationCalendars(db, config, integrationRow) {
  let calendars;
  if (integrationRow.provider === "google") {
    const accessToken = await getFreshAccessToken(db, config, integrationRow);
    calendars = await listGoogleCalendarList(accessToken);
  } else if (integrationRow.provider === "apple") {
    const creds = getAppleCredentials(db, integrationRow);
    const result = await discoverAppleCalendars({ email: creds.email, password: creds.password });
    calendars = result.calendars;
  } else {
    return [];
  }
  const now = new Date().toISOString();

  for (const c of calendars) {
    const existing = /** @type {any} */ (
      db
        .prepare(
          `SELECT * FROM integration_calendars WHERE integration_id = ? AND external_calendar_id = ?`
        )
        .get(integrationRow.id, c.id)
    );
    if (existing) {
      db.prepare(
        `UPDATE integration_calendars SET
           summary = ?,
           description = ?,
           time_zone = ?,
           color_hex = ?,
           access_role = ?,
           primary_flag = ?,
           updated_date = ?
         WHERE id = ?`
      ).run(
        c.summary,
        c.description,
        c.timeZone,
        c.colorHex,
        c.accessRole,
        c.primary ? 1 : 0,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO integration_calendars (
           id, app_id, integration_id, external_calendar_id, summary, description,
           time_zone, color_hex, access_role, primary_flag, sync_enabled,
           created_date, updated_date
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        `icl_${randomUUID()}`,
        integrationRow.app_id,
        integrationRow.id,
        c.id,
        c.summary,
        c.description,
        c.timeZone,
        c.colorHex,
        c.accessRole,
        c.primary ? 1 : 0,
        // Default the user's primary calendar to enabled on first discovery so
        // the connection isn't useless out of the box. Other calendars are
        // opt-in via the Configure modal.
        c.primary ? 1 : 0,
        now,
        now
      );
    }
  }

  return listIntegrationCalendars(db, integrationRow.id);
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
    last_synced_at: row.last_synced_at,
    last_error: row.last_error,
    writable: isWritableCalendar(row),
  };
}

function isWritableCalendar(row) {
  return row?.access_role === "owner" || row?.access_role === "writer";
}

/**
 * Set the sync_enabled flag for one or many calendars. The caller's
 * payload is `{ [external_calendar_id]: boolean }` so the UI can submit
 * the whole list at once.
 *
 * Disabling a calendar is treated as a local cleanup + sync stop, not just
 * a flag flip — the previous "just turn the flag off" semantics caused two
 * user-visible bugs:
 *
 *   1. Imported events (source_kind='event') from the now-disabled
 *      calendar lingered in the local DB indefinitely. They kept
 *      showing up in the Calendar nav and the Calendar Order section
 *      of Settings even though the user had explicitly hidden the
 *      source.
 *   2. Re-enabling later didn't pull a fresh import because the per-
 *      calendar sync_token was still cached, so Google reported "no
 *      changes since last token" — but everything from before was
 *      already gone, leading to an empty calendar.
 *
 * Cleanup on disable:
 *   - DELETE imported events (tasks where source_calendar_id matches
 *     and source_kind='event'). These were never user-authored, so
 *     it's safe to drop them entirely.
 *   - DELETE only the event_map rows for those deleted imported events.
 *     Keep mappings for Zephyrly-native tasks and writable provider tasks:
 *     push.js checks sync_enabled before writing, so disabled calendars stay
 *     quiet, while the preserved map lets a later re-enable resume without
 *     creating duplicate provider events.
 *   - CLEAR sync_token so a future re-enable starts with a full
 *     initial import instead of an empty incremental delta.
 *
 * Enabling is unchanged — just flip the flag, and the next sync tick
 * picks up the calendar.
 *
 * @param {DB} db
 * @param {string} integrationId
 * @param {Record<string, boolean>} updates
 */
export function setEnabledCalendars(db, integrationId, updates) {
  const now = new Date().toISOString();
  const integration = /** @type {any} */ (
    db.prepare(`SELECT * FROM calendar_integrations WHERE id = ?`).get(integrationId)
  );
  if (!integration) return;

  const enableStmt = db.prepare(
    `UPDATE integration_calendars
     SET sync_enabled = 1, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  );
  const disableStmt = db.prepare(
    `UPDATE integration_calendars
     SET sync_enabled = 0, sync_token = NULL, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  );
  const deleteImportedTasksStmt = db.prepare(
    `DELETE FROM tasks
     WHERE app_id = ?
       AND source_provider = ?
       AND source_calendar_id = ?
       AND source_kind = 'event'`
  );
  const deleteImportedEventMapsStmt = db.prepare(
    `DELETE FROM external_event_map
     WHERE integration_id = ?
       AND external_calendar_id = ?
       AND task_id IN (
         SELECT id FROM tasks
         WHERE app_id = ?
           AND source_provider = ?
           AND source_calendar_id = ?
           AND source_kind = 'event'
       )`
  );

  db.exec("BEGIN");
  try {
    for (const [extId, enabled] of Object.entries(updates || {})) {
      if (enabled) {
        enableStmt.run(now, integrationId, extId);
      } else {
        deleteImportedEventMapsStmt.run(
          integrationId,
          extId,
          integration.app_id,
          integration.provider,
          extId
        );
        deleteImportedTasksStmt.run(integration.app_id, integration.provider, extId);
        disableStmt.run(now, integrationId, extId);
      }
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {string} externalCalendarId
 * @param {{ syncToken?: any, error?: any }} result
 */
export function markCalendarSyncResult(db, integrationId, externalCalendarId, { syncToken, error } = {}) {
  const now = new Date().toISOString();
  if (error) {
    db.prepare(
      `UPDATE integration_calendars SET last_error = ?, updated_date = ?
       WHERE integration_id = ? AND external_calendar_id = ?`
    ).run(String(error).slice(0, 200), now, integrationId, externalCalendarId);
    return;
  }
  db.prepare(
    `UPDATE integration_calendars
     SET sync_token = ?, last_synced_at = ?, last_error = NULL, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  ).run(syncToken || null, now, now, integrationId, externalCalendarId);
}

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {string} externalCalendarId
 */
export function clearCalendarSyncToken(db, integrationId, externalCalendarId) {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE integration_calendars SET sync_token = NULL, updated_date = ?
     WHERE integration_id = ? AND external_calendar_id = ?`
  ).run(now, integrationId, externalCalendarId);
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

/**
 * @param {DB} db
 * @param {string} integrationId
 * @param {{ syncToken?: any, error?: any }} result
 */
export function markSyncResult(db, integrationId, { syncToken, error } = {}) {
  const now = new Date().toISOString();
  if (error) {
    db.prepare(
      `UPDATE calendar_integrations SET last_error = ?, updated_date = ? WHERE id = ?`
    ).run(String(error).slice(0, 200), now, integrationId);
    return;
  }
  db.prepare(
    `UPDATE calendar_integrations SET sync_token = ?, last_synced_at = ?, last_error = NULL, updated_date = ? WHERE id = ?`
  ).run(syncToken || null, now, now, integrationId);
}

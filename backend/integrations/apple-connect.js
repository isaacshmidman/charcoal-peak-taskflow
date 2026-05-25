// @ts-check
/**
 * @file Apple iCloud Calendar integration via CalDAV. Apple doesn't expose
 * OAuth — users authenticate with an Apple ID + app-specific password
 * generated at appleid.apple.com. We probe CalDAV synchronously to
 * verify the credentials and discover their calendar list BEFORE
 * persisting anything (so a wrong password never produces a row).
 */
import { randomUUID } from "node:crypto";
import { HttpError } from "../http.js";
import { decryptSecret, encryptSecret } from "../crypto.js";
import { discoverAppleCalendars } from "../providers/apple-calendar.js";
import { ensureIntegrationsRuntimeReady } from "./runtime.js";
import { ensureDefaultIntegration } from "./defaults.js";

/** @typedef {import("node:sqlite").DatabaseSync} DB */

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
 * @param {import("../config.js").backendConfig} config
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
